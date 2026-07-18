import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { computeStableHash, immutableJson, isPlainRecord } from "../canonical.mjs";
import {
  createCommandSubject,
  normalizeActorIdentity,
  normalizeExactRefs,
} from "./command-subject.mjs";
import {
  evaluateGovernancePolicy,
  validateGovernanceDecisionIntegrity,
  validateGovernancePolicyIntegrity,
} from "./policy-engine.mjs";

export const MUTATION_GOVERNANCE_MODES = Object.freeze(["disabled", "audit", "enforce"]);
export const DEFAULT_GOVERNANCE_POLICY_MAX_BYTES = 256 * 1024;

const MODE_RANK = Object.freeze({ disabled: 0, audit: 1, enforce: 2 });
const ACTION_PATTERN = /^[a-z0-9][a-z0-9._-]*$/u;
const OPERATION_PATTERN = /^[a-z0-9][a-z0-9._-]*$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const MAX_EVIDENCE_BYTES = 4 * 1024 * 1024;
const NO_FOLLOW_FLAG = fs.constants.O_NOFOLLOW || 0;
const storage = new AsyncLocalStorage();
let decisionSequence = 0;

export class MutationGovernanceError extends Error {
  constructor(message, code = "MUTATION_GOVERNANCE_DENIED", details = {}) {
    super(message);
    this.name = "MutationGovernanceError";
    this.code = code;
    this.details = immutableJson(details);
  }
}

/**
 * Runs one command inside an isolated mutation-governance context. The context
 * is inherited by asynchronous work spawned by the command, while concurrent
 * invocations remain isolated by AsyncLocalStorage. A nested invocation may
 * tighten the mode but cannot silently downgrade an active parent policy.
 */
export function runWithMutationGovernance(context, callback) {
  if (typeof callback !== "function") {
    throw new TypeError("mutation governance callback must be a function");
  }
  const normalized = normalizeRuntimeContext(context);
  const parent = storage.getStore();
  if (parent && MODE_RANK[normalized.mode] < MODE_RANK[parent.context.mode]) {
    throw new MutationGovernanceError(
      "Nested mutation governance cannot reduce the active protection mode",
      "MUTATION_GOVERNANCE_DOWNGRADE",
      { parent_mode: parent.context.mode, requested_mode: normalized.mode },
    );
  }
  return storage.run({ context: normalized, authorizations: Object.freeze([]) }, callback);
}

export function currentMutationGovernance() {
  return storage.getStore()?.context ?? null;
}

/**
 * Synchronously decides one logical mutation before the callback can write its
 * first byte. The callback executes with one exact authorization in scope so
 * lower-level gateways can prove that they are part of the decided operation.
 */
export function withGovernedMutation(request, callback) {
  if (typeof callback !== "function") {
    throw new TypeError("governed mutation callback must be a function");
  }
  const store = storage.getStore();
  if (!store || store.context.mode === "disabled") return callback();
  const normalizedRequest = normalizeMutationRequest(store.context, request);
  const outcome = decideMutation(store.context, normalizedRequest);
  recordOutcome(store.context, outcome);
  if (store.context.mode === "enforce" && outcome.allowed !== true) {
    throw denialError(outcome);
  }
  const authorization = immutableJson({
    request: normalizedRequest,
    allowed: outcome.allowed === true,
    audited: store.context.mode === "audit",
    decision_hash: outcome.decision?.decision_hash ?? null,
  });
  return storage.run({
    context: store.context,
    authorizations: Object.freeze([...store.authorizations, authorization]),
  }, callback);
}

/**
 * Used by physical writer helpers. It never evaluates prefixes or globs: the
 * exact operation and normalized project path must match an active logical
 * authorization. In audit mode a missing authorization is recorded; enforce
 * mode fails before the helper opens or mutates a filesystem entry.
 */
export function assertMutationExecutionAuthorized(request) {
  const store = storage.getStore();
  if (!store || store.context.mode === "disabled") return true;
  const normalized = normalizeMutationRequest(store.context, request);
  const match = [...store.authorizations].reverse().find((entry) => (
    entry.request.canonical_action === normalized.canonical_action
    && entry.request.operation === normalized.operation
    && entry.request.project_path === normalized.project_path
    && computeStableHash(entry.request.evidence_refs) === computeStableHash(normalized.evidence_refs)
  ));
  if (match && (match.allowed || store.context.mode === "audit")) return true;
  const outcome = immutableJson({
    allowed: false,
    request: normalized,
    reason_codes: ["mutation.no_exact_active_authorization"],
    decision: null,
    error: null,
  });
  recordOutcome(store.context, outcome);
  if (store.context.mode === "enforce") throw denialError(outcome);
  return false;
}

/**
 * Converts the optional project config into a runtime guard. Inline policies
 * are enforced directly. Pointer policies are read once through a bounded,
 * no-symlink reader. Decision/use observations stay in memory: persisting them
 * through the same writer would require an independently authorized receipt
 * write and must never be implemented as a global bypass.
 */
export function createProjectMutationGovernance(input) {
  if (!isPlainRecord(input)) throw new TypeError("project mutation governance input must be an object");
  const root = normalizeRoot(input.root);
  const configured = input.governance_policy;
  const observations = [];
  if (configured === undefined || configured === null) {
    return normalizeRuntimeContext({
      mode: "disabled",
      root,
      observations,
      canonical_action: input.canonical_action,
      command_path: input.command_path,
    });
  }

  let mode;
  let failClosed;
  let policy;
  let setupError = null;
  let evidenceRefs = immutableJson([]);
  let actor = null;
  try {
    if (configured.kind === "governance_policy") {
      mode = "enforce";
      failClosed = true;
      policy = configured;
    } else {
      mode = normalizeMode(configured.mode);
      if (mode === "disabled") {
        throw new MutationGovernanceError(
          "Configured governance_policy cannot disable governance; remove it for 0.11 compatibility",
          "MUTATION_GOVERNANCE_CONFIG_INVALID",
        );
      }
      failClosed = configured.fail_closed === true;
      if (mode === "enforce" && !failClosed) {
        throw new MutationGovernanceError(
          "Enforced governance requires fail_closed=true",
          "MUTATION_GOVERNANCE_CONFIG_INVALID",
        );
      }
      policy = readBoundedProjectJson(root, configured.policy_file, {
        maxBytes: input.max_policy_bytes ?? DEFAULT_GOVERNANCE_POLICY_MAX_BYTES,
        label: "governance policy",
      });
    }
    const integrity = validateGovernancePolicyIntegrity(policy);
    if (!integrity.valid) {
      throw new MutationGovernanceError(
        `Governance policy integrity failed: ${integrity.errors.join("; ")}`,
        "MUTATION_GOVERNANCE_POLICY_INVALID",
      );
    }
    evidenceRefs = collectEvidenceRefs(root, input.evidence_paths ?? []);
    actor = normalizeActorIdentity(input.actor ?? { type: "system", id: "local-cli" });
  } catch (error) {
    setupError = error instanceof Error ? error : new Error(String(error));
    if (mode === undefined) mode = configured?.mode === "audit" ? "audit" : "enforce";
    failClosed = mode === "enforce";
  }

  const approvals = Array.isArray(input.approvals) ? input.approvals : [];
  const revocations = Array.isArray(input.revocations) ? input.revocations : [];
  const decisionProvider = setupError
    ? () => { throw setupError; }
    : ({ subject }) => evaluateGovernancePolicy({
        policy,
        subject,
        actor: actor ?? { type: "system", id: "invalid-governance-identity" },
        approvals,
        revocations,
        evaluated_at: resolveNow(input.now),
        decision_id: nextDecisionId(input.id),
      });
  return normalizeRuntimeContext({
    mode,
    fail_closed: failClosed,
    root,
    canonical_action: input.canonical_action,
    command_path: input.command_path,
    evidence_refs: evidenceRefs,
    decision_provider: decisionProvider,
    observations,
    configuration_error: setupError?.message ?? null,
  });
}

/** Strictly validates the only three recovery/bootstrap shapes. */
export function createBootstrapMutationGrant(input) {
  if (!isPlainRecord(input)) throw new TypeError("bootstrap mutation grant input must be an object");
  const action = normalizeAction(input.canonical_action);
  if (!new Set(["init", "config.migrate", "migration.identity"]).has(action)) {
    throw new MutationGovernanceError("Unsupported bootstrap action", "MUTATION_BOOTSTRAP_DENIED", { action });
  }
  if (action === "init" && input.first_time !== true) {
    throw new MutationGovernanceError("Initialization bootstrap is only valid before project initialization", "MUTATION_BOOTSTRAP_DENIED");
  }
  if (action === "config.migrate") {
    assertExactHashPair(input.plan_hash, input.expected_plan_hash, "configuration migration plan");
  }
  if (action === "migration.identity") {
    if (input.recover !== true || !safeExactToken(input.nonce) || input.nonce !== input.expected_nonce) {
      throw new MutationGovernanceError("Identity recovery requires its exact transaction nonce", "MUTATION_BOOTSTRAP_DENIED");
    }
    assertExactHashPair(input.plan_hash, input.expected_plan_hash, "identity recovery plan");
  }
  const exactMutations = normalizeBootstrapMutations(input.root, action, input.exact_mutations);
  return immutableJson({
    kind: "mutation_bootstrap_grant",
    canonical_action: action,
    exact_mutations: exactMutations,
    binding_hash: computeStableHash({ canonical_action: action, exact_mutations: exactMutations }),
  });
}

export function normalizeProjectMutationPath(rootValue, targetValue) {
  const root = normalizeRoot(rootValue);
  if (typeof targetValue !== "string" || !targetValue.trim() || targetValue.includes("\0")) {
    throw new MutationGovernanceError("Mutation path must be a non-empty filesystem path", "MUTATION_PATH_INVALID");
  }
  if (/[*?\[\]{}]/u.test(targetValue)) {
    throw new MutationGovernanceError("Mutation paths must be exact and cannot contain glob syntax", "MUTATION_PATH_INVALID");
  }
  const target = path.resolve(root, targetValue);
  const relative = path.relative(root, target);
  if (relative === "" || relative === "." || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new MutationGovernanceError("Mutation path must identify one entry inside the project root", "MUTATION_PATH_OUTSIDE_ROOT");
  }
  assertNoSymlinkSegments(root, target);
  return relative.split(path.sep).join("/");
}

/**
 * Performs one no-follow O_APPEND write. Callers must hold their exact file
 * lock before invoking it; one JSON record is issued as one write syscall so a
 * cooperating set of locked writers cannot interleave record fragments.
 */
export function appendJsonLineNoFollow(filePath, value) {
  const absolutePath = path.resolve(String(filePath ?? ""));
  const parent = path.dirname(absolutePath);
  const parentEntry = fs.lstatSync(parent);
  if (parentEntry.isSymbolicLink() || !parentEntry.isDirectory()) {
    throw new MutationGovernanceError("JSONL parent must be a real directory", "MUTATION_PATH_SYMLINK");
  }
  if (fs.existsSync(absolutePath) && fs.lstatSync(absolutePath).isSymbolicLink()) {
    throw new MutationGovernanceError("Mutation path cannot traverse a symbolic link", "MUTATION_PATH_SYMLINK");
  }
  const parentBefore = fs.statSync(parent);
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  let descriptor;
  try {
    descriptor = fs.openSync(
      absolutePath,
      fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | NO_FOLLOW_FLAG,
      0o600,
    );
    const descriptorStat = fs.fstatSync(descriptor);
    const pathStat = fs.lstatSync(absolutePath);
    const parentAfter = fs.statSync(parent);
    if (!descriptorStat.isFile()
      || pathStat.isSymbolicLink()
      || descriptorStat.dev !== pathStat.dev
      || descriptorStat.ino !== pathStat.ino
      || parentBefore.dev !== parentAfter.dev
      || parentBefore.ino !== parentAfter.ino) {
      throw new MutationGovernanceError("JSONL target changed while opening it", "MUTATION_PATH_UNSTABLE");
    }
    const written = fs.writeSync(descriptor, bytes, 0, bytes.length, null);
    if (written !== bytes.length) {
      throw new MutationGovernanceError("JSONL append did not commit one complete record", "MUTATION_APPEND_INCOMPLETE");
    }
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  return bytes.length;
}

function normalizeRuntimeContext(raw) {
  if (!isPlainRecord(raw)) throw new TypeError("mutation governance context must be an object");
  const mode = normalizeMode(raw.mode ?? "disabled");
  const root = normalizeRoot(raw.root);
  const observations = Array.isArray(raw.observations) ? raw.observations : [];
  const context = {
    mode,
    fail_closed: mode === "enforce" ? raw.fail_closed !== false : raw.fail_closed === true,
    root,
    canonical_action: raw.canonical_action === undefined || raw.canonical_action === null
      ? null
      : normalizeAction(raw.canonical_action),
    command_path: raw.command_path === undefined || raw.command_path === null
      ? null
      : normalizeCommandPath(raw.command_path),
    evidence_refs: normalizeExactRefs(raw.evidence_refs ?? [], "mutation_context.evidence_refs", { requireHash: true }),
    decision_provider: raw.decision_provider,
    observations,
    on_decision: typeof raw.on_decision === "function" ? raw.on_decision : null,
    configuration_error: raw.configuration_error ?? null,
  };
  if (mode === "enforce" && context.fail_closed !== true) {
    throw new MutationGovernanceError("Enforce mode must be fail closed", "MUTATION_GOVERNANCE_CONFIG_INVALID");
  }
  return Object.freeze(context);
}

function normalizeMutationRequest(context, raw) {
  if (!isPlainRecord(raw)) {
    throw new MutationGovernanceError("Mutation metadata is missing", "MUTATION_METADATA_MISSING");
  }
  const canonicalAction = normalizeAction(raw.canonical_action ?? context.canonical_action);
  const commandPath = normalizeCommandPath(raw.command_path ?? context.command_path);
  const operation = normalizeOperation(raw.operation);
  const projectPath = normalizeProjectMutationPath(context.root, raw.path ?? raw.project_path);
  const evidenceRefs = normalizeExactRefs(
    raw.evidence_refs ?? context.evidence_refs,
    "mutation_request.evidence_refs",
    { requireHash: true },
  );
  return immutableJson({
    canonical_action: canonicalAction,
    command_path: commandPath,
    operation,
    project_path: projectPath,
    evidence_refs: evidenceRefs,
  });
}

function decideMutation(context, request) {
  let subject;
  try {
    subject = createCommandSubject({
      command_path: request.command_path,
      canonical_action: request.canonical_action,
      scope_refs: [
        { kind: "mutation_operation", id: request.operation },
        { kind: "project_path", id: request.project_path },
      ],
      evidence_refs: request.evidence_refs,
    });
    if (typeof context.decision_provider !== "function") {
      return deniedOutcome(request, subject, "mutation.decision_provider_missing");
    }
    const decision = context.decision_provider({ request, subject });
    if (decision && typeof decision.then === "function") {
      return deniedOutcome(request, subject, "mutation.async_decision_forbidden");
    }
    const integrity = validateGovernanceDecisionIntegrity(decision);
    if (!integrity.valid) {
      return deniedOutcome(request, subject, "mutation.decision_invalid", integrity.errors.join("; "));
    }
    if (decision.subject_hash !== subject.subject_hash
      || decision.subject.command.action !== request.canonical_action
      || decision.subject.command.path !== request.command_path) {
      return deniedOutcome(request, subject, "mutation.decision_subject_mismatch");
    }
    if (decision.decision !== "allow") {
      return immutableJson({
        allowed: false,
        request,
        subject,
        decision,
        reason_codes: decision.reason_codes.length > 0 ? decision.reason_codes : ["mutation.policy_denied"],
        error: null,
      });
    }
    return immutableJson({ allowed: true, request, subject, decision, reason_codes: [], error: null });
  } catch (error) {
    return deniedOutcome(request, subject ?? null, "mutation.decision_error", error?.message ?? String(error));
  }
}

function deniedOutcome(request, subject, reason, error = null) {
  return immutableJson({
    allowed: false,
    request,
    subject,
    decision: null,
    reason_codes: [reason],
    error,
  });
}

function denialError(outcome) {
  return new MutationGovernanceError(
    "The change was not made because this project has no approval for this exact action and file",
    "MUTATION_GOVERNANCE_DENIED",
    {
      canonical_action: outcome.request?.canonical_action ?? null,
      operation: outcome.request?.operation ?? null,
      project_path: outcome.request?.project_path ?? null,
      reason_codes: outcome.reason_codes ?? ["mutation.unknown_denial"],
    },
  );
}

function recordOutcome(context, outcome) {
  context.observations.push(outcome);
  if (context.on_decision) {
    try {
      const result = context.on_decision(outcome);
      if (result && typeof result.then === "function") {
        context.observations.push(immutableJson({
          allowed: false,
          reason_codes: ["mutation.async_observer_ignored"],
          request: outcome.request,
          subject: outcome.subject ?? null,
          decision: null,
          error: null,
        }));
      }
    } catch (error) {
      context.observations.push(immutableJson({
        allowed: false,
        reason_codes: ["mutation.observer_error"],
        request: outcome.request,
        subject: outcome.subject ?? null,
        decision: null,
        error: error?.message ?? String(error),
      }));
    }
  }
}

function collectEvidenceRefs(root, values) {
  if (!Array.isArray(values)) throw new TypeError("governance evidence paths must be an array");
  return normalizeExactRefs(values.map((value) => {
    const projectPath = normalizeProjectMutationPath(root, value);
    const absolutePath = path.join(root, ...projectPath.split("/"));
    const bytes = readBoundedProjectFile(root, absolutePath, {
      maxBytes: MAX_EVIDENCE_BYTES,
      label: "governance evidence",
    });
    return {
      kind: "project_evidence",
      id: projectPath,
      hash: crypto.createHash("sha256").update(bytes).digest("hex"),
    };
  }), "mutation_context.evidence_refs", { requireHash: true });
}

function readBoundedProjectJson(root, projectPath, options) {
  const normalized = normalizeProjectMutationPath(root, projectPath);
  const absolutePath = path.join(root, ...normalized.split("/"));
  const bytes = readBoundedProjectFile(root, absolutePath, options);
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new MutationGovernanceError(
      `${options.label} is not valid JSON: ${error.message}`,
      "MUTATION_GOVERNANCE_POLICY_INVALID",
    );
  }
}

function readBoundedProjectFile(root, absolutePath, { maxBytes, label }) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new TypeError(`${label} maxBytes must be positive`);
  normalizeProjectMutationPath(root, absolutePath);
  const parent = path.dirname(absolutePath);
  const parentBefore = fs.statSync(parent);
  let descriptor;
  try {
    descriptor = fs.openSync(absolutePath, fs.constants.O_RDONLY | NO_FOLLOW_FLAG);
    const before = fs.fstatSync(descriptor);
    if (!before.isFile()) throw new MutationGovernanceError(`${label} must be a regular file`, "MUTATION_PATH_INVALID");
    if (before.size > maxBytes) throw new MutationGovernanceError(`${label} exceeds its bounded read limit`, "MUTATION_GOVERNANCE_POLICY_TOO_LARGE");
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    const parentAfter = fs.statSync(parent);
    if (bytes.length > maxBytes
      || before.dev !== after.dev
      || before.ino !== after.ino
      || before.size !== after.size
      || parentBefore.dev !== parentAfter.dev
      || parentBefore.ino !== parentAfter.ino) {
      throw new MutationGovernanceError(`${label} changed while it was read`, "MUTATION_GOVERNANCE_POLICY_UNSTABLE");
    }
    return bytes;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function normalizeBootstrapMutations(root, action, values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new MutationGovernanceError("Bootstrap grants require exact mutations", "MUTATION_BOOTSTRAP_DENIED");
  }
  const normalized = values.map((value) => {
    if (!isPlainRecord(value)) throw new MutationGovernanceError("Bootstrap mutation is invalid", "MUTATION_BOOTSTRAP_DENIED");
    return immutableJson({
      canonical_action: action,
      operation: normalizeOperation(value.operation),
      project_path: normalizeProjectMutationPath(root, value.path ?? value.project_path),
    });
  });
  const byHash = new Map(normalized.map((value) => [computeStableHash(value), value]));
  if (byHash.size !== normalized.length) {
    throw new MutationGovernanceError("Bootstrap mutations must be unique", "MUTATION_BOOTSTRAP_DENIED");
  }
  return immutableJson([...byHash.values()].sort((left, right) => (
    `${left.operation}\u0000${left.project_path}`.localeCompare(`${right.operation}\u0000${right.project_path}`, "en")
  )));
}

function assertExactHashPair(value, expected, label) {
  if (!SHA256_PATTERN.test(String(value ?? "")) || value !== expected) {
    throw new MutationGovernanceError(`${label} hash does not match exactly`, "MUTATION_BOOTSTRAP_DENIED");
  }
}

function safeExactToken(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{7,255}$/u.test(value);
}

function normalizeMode(value) {
  const mode = String(value ?? "").trim().toLowerCase();
  if (!MUTATION_GOVERNANCE_MODES.includes(mode)) {
    throw new MutationGovernanceError(`Unsupported mutation governance mode '${mode || "(missing)"}'`, "MUTATION_GOVERNANCE_CONFIG_INVALID");
  }
  return mode;
}

function normalizeAction(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!ACTION_PATTERN.test(normalized)) {
    throw new MutationGovernanceError("Mutation canonical action is missing or invalid", "MUTATION_METADATA_MISSING");
  }
  return normalized;
}

function normalizeCommandPath(value) {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/\s+/gu, " ");
  if (!normalized || !/^[a-z0-9][a-z0-9._-]*(?: [a-z0-9][a-z0-9._-]*)*$/u.test(normalized)) {
    throw new MutationGovernanceError("Mutation command path is missing or invalid", "MUTATION_METADATA_MISSING");
  }
  return normalized;
}

function normalizeOperation(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!OPERATION_PATTERN.test(normalized)) {
    throw new MutationGovernanceError("Mutation operation is missing or invalid", "MUTATION_METADATA_MISSING");
  }
  return normalized;
}

function normalizeRoot(value) {
  const root = path.resolve(String(value ?? ""));
  if (!value || !fs.existsSync(root)) {
    throw new MutationGovernanceError("Mutation governance root must exist", "MUTATION_ROOT_INVALID");
  }
  const entry = fs.lstatSync(root);
  if (entry.isSymbolicLink() || !entry.isDirectory()) {
    throw new MutationGovernanceError("Mutation governance root must be a real directory", "MUTATION_ROOT_INVALID");
  }
  return root;
}

function assertNoSymlinkSegments(root, target) {
  let current = root;
  const relative = path.relative(root, target);
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) {
        throw new MutationGovernanceError("Mutation path cannot traverse a symbolic link", "MUTATION_PATH_SYMLINK");
      }
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
  }
}

function resolveNow(provider) {
  const value = typeof provider === "function" ? provider() : new Date().toISOString();
  return value;
}

function nextDecisionId(provider) {
  if (typeof provider === "function") return provider("decision");
  decisionSequence += 1;
  return `decision-${process.pid}-${decisionSequence}`;
}
