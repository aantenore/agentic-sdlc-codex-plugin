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
  createGovernanceUseReceipt,
  evaluateGovernancePolicy,
  validateGovernanceDecisionIntegrity,
  validateGovernancePolicyIntegrity,
  validateGovernanceRevocationIntegrity,
} from "./policy-engine.mjs";

export const MUTATION_GOVERNANCE_MODES = Object.freeze(["disabled", "audit", "enforce"]);
export const DEFAULT_GOVERNANCE_POLICY_MAX_BYTES = 256 * 1024;

const MODE_RANK = Object.freeze({ disabled: 0, audit: 1, enforce: 2 });
const ACTION_PATTERN = /^[a-z0-9][a-z0-9._-]*$/u;
const OPERATION_PATTERN = /^[a-z0-9][a-z0-9._-]*$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const MAX_EVIDENCE_BYTES = 4 * 1024 * 1024;
const MAX_REVOCATION_BYTES = 256 * 1024;
const MAX_REVOCATION_FILES = 512;
const MAX_REVOCATION_TOTAL_BYTES = 4 * 1024 * 1024;
const MAX_APPROVALS = 512;
const MAX_APPROVAL_BYTES = 4 * 1024 * 1024;
const NO_FOLLOW_FLAG = fs.constants.O_NOFOLLOW || 0;
const storage = new AsyncLocalStorage();
const consumedBootstrapGrants = new WeakSet();
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
  if (outcome.allowed === true) {
    const persistenceFailure = callSynchronousHook(
      store.context.on_authorization,
      { outcome },
      "mutation.decision_receipt_persistence_failed",
      normalizedRequest,
    );
    if (persistenceFailure) {
      recordOutcome(store.context, persistenceFailure);
      if (store.context.mode === "enforce") throw denialError(persistenceFailure);
    }
  }
  const token = {
    active: true,
    used: false,
    decision: outcome.decision ?? null,
    valid_until: outcome.decision?.valid_until ?? null,
  };
  const authorization = Object.freeze({
    request: normalizedRequest,
    allowed: outcome.allowed === true,
    audited: store.context.mode === "audit",
    decision_hash: outcome.decision?.decision_hash ?? null,
    token,
  });
  let result;
  try {
    result = storage.run({
      context: store.context,
      authorizations: Object.freeze([...store.authorizations, authorization]),
    }, callback);
  } catch (error) {
    token.active = false;
    throw error;
  }
  try {
    if (result && typeof result.then === "function") {
      return Promise.resolve(result).finally(() => {
        token.active = false;
      });
    }
  } catch (error) {
    token.active = false;
    throw error;
  }
  token.active = false;
  return result;
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
  if (match && (match.allowed || store.context.mode === "audit")) {
    const authorizationFailure = validateActiveAuthorization(store.context, match, normalized);
    if (!authorizationFailure) return true;
    recordOutcome(store.context, authorizationFailure);
    if (store.context.mode === "enforce") throw denialError(authorizationFailure);
    return false;
  }
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

function validateActiveAuthorization(context, authorization, request) {
  if (authorization.token?.active !== true) {
    return deniedOutcome(request, null, "mutation.authorization_inactive");
  }
  const checkedAt = resolveNow(context.now);
  if (authorization.token.valid_until !== null && checkedAt >= authorization.token.valid_until) {
    authorization.token.active = false;
    return deniedOutcome(request, null, "mutation.authorization_expired");
  }
  const revalidationFailure = callSynchronousHook(
    context.decision_revalidator,
    { authorization, request, checked_at: checkedAt },
    "mutation.authorization_revalidation_failed",
    request,
    { requireTrue: true },
  );
  if (revalidationFailure) {
    authorization.token.active = false;
    return revalidationFailure;
  }
  if (authorization.token.used !== true) {
    const useFailure = callSynchronousHook(
      context.on_use,
      { authorization, request, used_at: checkedAt },
      "mutation.use_receipt_persistence_failed",
      request,
    );
    if (useFailure) {
      authorization.token.active = false;
      return useFailure;
    }
    authorization.token.used = true;
  }
  return null;
}

function callSynchronousHook(hook, input, reason, request, options = {}) {
  if (typeof hook !== "function") return null;
  try {
    const result = hook(input);
    if (result && typeof result.then === "function") {
      return deniedOutcome(request, null, `${reason}.async_forbidden`);
    }
    if (options.requireTrue === true && result !== true) {
      return deniedOutcome(request, null, reason);
    }
    return null;
  } catch (error) {
    return deniedOutcome(request, null, reason, error?.message ?? String(error));
  }
}

/**
 * Converts the optional project config into a runtime guard. Inline policies
 * are enforced directly. Pointer policies and revocations are re-read through
 * bounded, no-follow readers before physical use. Decision and use receipts go
 * only to their exact configured roots through the private receipt sink below;
 * that sink is not exposed to project writers and cannot authorize another path.
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
  let policyLoader;
  let revocationLoader;
  let receiptRoots = null;
  let setupError = null;
  let evidenceRefs = immutableJson([]);
  let approvals = immutableJson([]);
  let actor = null;
  try {
    if (configured.kind === "governance_policy") {
      mode = "enforce";
      failClosed = true;
      policy = configured;
      policyLoader = () => policy;
      revocationLoader = () => normalizeInputRevocations(input.revocations ?? []);
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
      const policyPath = normalizeProjectMutationPath(root, configured.policy_file);
      receiptRoots = normalizeReceiptRoots(root, configured);
      policyLoader = () => readBoundedProjectJson(root, policyPath, {
        maxBytes: input.max_policy_bytes ?? DEFAULT_GOVERNANCE_POLICY_MAX_BYTES,
        label: "governance policy",
      });
      revocationLoader = () => mergeRevocations(
        normalizeInputRevocations(input.revocations ?? []),
        readBoundedRevocations(root, receiptRoots.revocations),
      );
      policy = policyLoader();
    }
    const integrity = validateGovernancePolicyIntegrity(policy);
    if (!integrity.valid) {
      throw new MutationGovernanceError(
        `Governance policy integrity failed: ${integrity.errors.join("; ")}`,
        "MUTATION_GOVERNANCE_POLICY_INVALID",
      );
    }
    evidenceRefs = collectEvidenceRefs(root, input.evidence_paths ?? []);
    approvals = normalizeInputApprovals(input.approvals ?? []);
    actor = mode === "enforce"
      ? normalizeVerifiedActor(input.verified_actor)
      : normalizeActorIdentity(input.verified_actor?.actor ?? input.actor ?? { type: "system", id: "local-cli" });
    revocationLoader();
  } catch (error) {
    setupError = error instanceof Error ? error : new Error(String(error));
    if (mode === undefined) mode = configured?.mode === "audit" ? "audit" : "enforce";
    failClosed = mode === "enforce";
  }
  const decisionProvider = setupError
    ? () => { throw setupError; }
    : ({ subject }) => evaluateGovernancePolicy({
        policy: policyLoader(),
        subject,
        actor: actor ?? { type: "system", id: "invalid-governance-identity" },
        approvals,
        revocations: revocationLoader(),
        evaluated_at: resolveNow(input.now),
        decision_id: nextDecisionId(input.id),
      });
  const decisionRevalidator = setupError
    ? () => false
    : ({ authorization, checked_at: checkedAt }) => {
        if (authorization.allowed !== true || authorization.token?.decision === null) return false;
        const currentPolicy = policyLoader();
        const decision = authorization.token.decision;
        if (currentPolicy.policy_hash !== decision.policy_ref.hash) return false;
        const currentRevocations = revocationLoader();
        createGovernanceUseReceipt({
          policy: currentPolicy,
          decision,
          approvals,
          revocations: currentRevocations,
          receipt_id: nextRecordId(input.id, "revalidation"),
          used_at: checkedAt,
          evidence_refs: authorization.request.evidence_refs,
        });
        const replay = evaluateGovernancePolicy({
          policy: currentPolicy,
          subject: decision.subject,
          actor,
          approvals,
          revocations: currentRevocations,
          evaluated_at: checkedAt,
          decision_id: nextDecisionId(input.id),
        });
        return replay.decision === "allow";
      };
  const onAuthorization = setupError || !receiptRoots
    ? null
    : ({ outcome }) => persistGovernanceReceipt(
        root,
        receiptRoots.decisions,
        "decision",
        outcome.decision.decision_hash,
        outcome.decision,
      );
  const onUse = setupError || !receiptRoots
    ? null
    : ({ authorization, used_at: usedAt }) => {
        const decision = authorization.token.decision;
        const receipt = createGovernanceUseReceipt({
          policy: policyLoader(),
          decision,
          approvals,
          revocations: revocationLoader(),
          receipt_id: nextRecordId(input.id, "use-receipt"),
          used_at: usedAt,
          evidence_refs: authorization.request.evidence_refs,
        });
        persistGovernanceReceipt(
          root,
          receiptRoots.uses,
          "use",
          receipt.receipt_hash,
          receipt,
        );
      };
  return normalizeRuntimeContext({
    mode,
    fail_closed: failClosed,
    root,
    canonical_action: input.canonical_action,
    command_path: input.command_path,
    evidence_refs: evidenceRefs,
    decision_provider: decisionProvider,
    decision_revalidator: decisionRevalidator,
    on_authorization: onAuthorization,
    on_use: onUse,
    now: input.now,
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
  const root = normalizeRoot(input.root);
  const binding = {
    root,
    canonical_action: action,
    exact_mutations: exactMutations,
  };
  return immutableJson({
    kind: "mutation_bootstrap_grant",
    ...binding,
    binding_hash: computeStableHash(binding),
  });
}

/**
 * Consumes one validated bootstrap grant exactly once. The callback is the
 * independently transactional init/config/recovery routine; this gate does not
 * provide a reusable writer bypass and cannot be nested around another action.
 */
export function consumeBootstrapMutationGrant(grant, request, callback) {
  if (typeof callback !== "function") throw new TypeError("bootstrap mutation callback must be a function");
  if (!isPlainRecord(grant) || grant.kind !== "mutation_bootstrap_grant") {
    throw new MutationGovernanceError("Bootstrap grant is missing or invalid", "MUTATION_BOOTSTRAP_DENIED");
  }
  const binding = {
    root: normalizeRoot(grant.root),
    canonical_action: normalizeAction(grant.canonical_action),
    exact_mutations: normalizeBootstrapMutations(grant.root, grant.canonical_action, grant.exact_mutations),
  };
  if (grant.binding_hash !== computeStableHash(binding) || consumedBootstrapGrants.has(grant)) {
    throw new MutationGovernanceError("Bootstrap grant is invalid or was already consumed", "MUTATION_BOOTSTRAP_DENIED");
  }
  if (!isPlainRecord(request)) {
    throw new MutationGovernanceError("Bootstrap mutation metadata is missing", "MUTATION_BOOTSTRAP_DENIED");
  }
  const exact = {
    canonical_action: normalizeAction(request.canonical_action),
    operation: normalizeOperation(request.operation),
    project_path: normalizeProjectMutationPath(binding.root, request.path ?? request.project_path),
  };
  if (exact.canonical_action !== binding.canonical_action
    || !binding.exact_mutations.some((candidate) => computeStableHash(candidate) === computeStableHash(exact))) {
    throw new MutationGovernanceError(
      "Bootstrap grant does not match this exact transaction",
      "MUTATION_BOOTSTRAP_DENIED",
      exact,
    );
  }
  consumedBootstrapGrants.add(grant);
  return callback();
}

export function normalizeProjectMutationPath(rootValue, targetValue) {
  const root = normalizeRoot(rootValue);
  if (typeof targetValue !== "string" || !targetValue.trim() || targetValue.includes("\0")) {
    throw new MutationGovernanceError("Mutation path must be a non-empty filesystem path", "MUTATION_PATH_INVALID");
  }
  if (/[*?\[\]{}]/u.test(targetValue)) {
    throw new MutationGovernanceError("Mutation paths must be exact and cannot contain glob syntax", "MUTATION_PATH_INVALID");
  }
  let boundary = root;
  let target = path.resolve(root, targetValue);
  let relative = path.relative(boundary, target);
  if (pathIsOutsideBoundary(relative)) {
    const canonicalRoot = fs.realpathSync.native?.(root) ?? fs.realpathSync(root);
    const canonicalRelative = path.relative(canonicalRoot, target);
    if (!pathIsOutsideBoundary(canonicalRelative)) {
      boundary = canonicalRoot;
      relative = canonicalRelative;
      target = path.resolve(canonicalRoot, canonicalRelative);
    }
  }
  if (relative === "" || relative === "." || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new MutationGovernanceError("Mutation path must identify one entry inside the project root", "MUTATION_PATH_OUTSIDE_ROOT");
  }
  assertNoSymlinkSegments(boundary, target);
  return relative.split(path.sep).join("/");
}

function pathIsOutsideBoundary(relative) {
  return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
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
    decision_revalidator: typeof raw.decision_revalidator === "function" ? raw.decision_revalidator : null,
    on_authorization: typeof raw.on_authorization === "function" ? raw.on_authorization : null,
    on_use: typeof raw.on_use === "function" ? raw.on_use : null,
    now: typeof raw.now === "function" ? raw.now : null,
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

function normalizeVerifiedActor(value) {
  if (!isPlainRecord(value)
    || value.verified !== true
    || !new Set(["host_verified", "ci_verified", "host_os_identity"]).has(value.assurance)) {
    throw new MutationGovernanceError(
      "Enforced mutation governance needs an identity verified by the host or CI; CLI actor names are not identity proof",
      "MUTATION_GOVERNANCE_IDENTITY_UNVERIFIED",
    );
  }
  return normalizeActorIdentity(value.actor, "verified mutation governance actor");
}

function normalizeReceiptRoots(root, configured) {
  const result = {
    decisions: normalizeProjectMutationPath(root, configured.decision_receipts_root),
    uses: normalizeProjectMutationPath(root, configured.use_receipts_root),
    revocations: normalizeProjectMutationPath(root, configured.revocations_root),
  };
  const entries = Object.entries(result);
  for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
      const [leftName, leftPath] = entries[leftIndex];
      const [rightName, rightPath] = entries[rightIndex];
      if (leftPath === rightPath
        || leftPath.startsWith(`${rightPath}/`)
        || rightPath.startsWith(`${leftPath}/`)) {
        throw new MutationGovernanceError(
          `Governance ${leftName} and ${rightName} roots must be separate, non-nested directories`,
          "MUTATION_GOVERNANCE_CONFIG_INVALID",
        );
      }
    }
  }
  return Object.freeze(result);
}

function normalizeInputRevocations(values) {
  if (!Array.isArray(values)) {
    throw new MutationGovernanceError(
      "Mutation governance revocations must be an array",
      "MUTATION_GOVERNANCE_REVOCATIONS_INVALID",
    );
  }
  for (const [index, value] of values.entries()) {
    const integrity = validateGovernanceRevocationIntegrity(value);
    if (!integrity.valid) {
      throw new MutationGovernanceError(
        `Governance revocation ${index} is invalid: ${integrity.errors.join("; ")}`,
        "MUTATION_GOVERNANCE_REVOCATIONS_INVALID",
      );
    }
  }
  return immutableJson(values);
}

function normalizeInputApprovals(values) {
  if (!Array.isArray(values) || values.length > MAX_APPROVALS) {
    throw new MutationGovernanceError(
      `Mutation governance approvals must be an array of at most ${MAX_APPROVALS} records`,
      "MUTATION_GOVERNANCE_APPROVALS_INVALID",
    );
  }
  let encoded;
  try {
    encoded = JSON.stringify(values);
  } catch (error) {
    throw new MutationGovernanceError(
      `Mutation governance approvals are not bounded JSON: ${error.message}`,
      "MUTATION_GOVERNANCE_APPROVALS_INVALID",
    );
  }
  if (Buffer.byteLength(encoded, "utf8") > MAX_APPROVAL_BYTES) {
    throw new MutationGovernanceError(
      "Mutation governance approvals exceed their bounded total size",
      "MUTATION_GOVERNANCE_APPROVALS_INVALID",
    );
  }
  return immutableJson(values);
}

function readBoundedRevocations(root, projectRoot) {
  const absoluteRoot = path.join(root, ...projectRoot.split("/"));
  assertNoSymlinkSegments(root, absoluteRoot);
  let entry;
  try {
    entry = fs.lstatSync(absoluteRoot);
  } catch (error) {
    if (error?.code === "ENOENT") return immutableJson([]);
    throw error;
  }
  if (entry.isSymbolicLink() || !entry.isDirectory()) {
    throw new MutationGovernanceError(
      "Governance revocations root must be a real directory",
      "MUTATION_GOVERNANCE_REVOCATIONS_INVALID",
    );
  }
  const before = fs.statSync(absoluteRoot);
  const names = fs.readdirSync(absoluteRoot).sort();
  if (names.length > MAX_REVOCATION_FILES) {
    throw new MutationGovernanceError(
      "Governance revocations root exceeds its bounded file count",
      "MUTATION_GOVERNANCE_REVOCATIONS_INVALID",
    );
  }
  const revocations = [];
  let totalBytes = 0;
  for (const name of names) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/u.test(name)) {
      throw new MutationGovernanceError(
        `Governance revocation filename '${name}' is not an exact JSON record`,
        "MUTATION_GOVERNANCE_REVOCATIONS_INVALID",
      );
    }
    const fileEntry = fs.lstatSync(path.join(absoluteRoot, name));
    if (fileEntry.isSymbolicLink() || !fileEntry.isFile()) {
      throw new MutationGovernanceError(
        `Governance revocation '${name}' must be a real regular file`,
        "MUTATION_GOVERNANCE_REVOCATIONS_INVALID",
      );
    }
    totalBytes += fileEntry.size;
    if (totalBytes > MAX_REVOCATION_TOTAL_BYTES) {
      throw new MutationGovernanceError(
        "Governance revocations exceed their bounded total size",
        "MUTATION_GOVERNANCE_REVOCATIONS_INVALID",
      );
    }
    revocations.push(readBoundedProjectJson(root, path.join(projectRoot, name), {
      maxBytes: MAX_REVOCATION_BYTES,
      label: `governance revocation ${name}`,
    }));
  }
  const after = fs.statSync(absoluteRoot);
  if (before.dev !== after.dev || before.ino !== after.ino) {
    throw new MutationGovernanceError(
      "Governance revocations root changed while it was read",
      "MUTATION_GOVERNANCE_REVOCATIONS_INVALID",
    );
  }
  return normalizeInputRevocations(revocations);
}

function mergeRevocations(left, right) {
  const byId = new Map();
  for (const revocation of [...left, ...right]) {
    const existing = byId.get(revocation.id);
    if (existing && existing.revocation_hash !== revocation.revocation_hash) {
      throw new MutationGovernanceError(
        `Governance revocation '${revocation.id}' has conflicting immutable records`,
        "MUTATION_GOVERNANCE_REVOCATIONS_INVALID",
      );
    }
    byId.set(revocation.id, revocation);
  }
  return immutableJson([...byId.values()].sort((leftValue, rightValue) =>
    leftValue.id.localeCompare(rightValue.id, "en")));
}

function persistGovernanceReceipt(root, receiptRoot, kind, contentHash, value) {
  if (!SHA256_PATTERN.test(contentHash)) {
    throw new MutationGovernanceError(
      `Governance ${kind} receipt has no valid content hash`,
      "MUTATION_GOVERNANCE_RECEIPT_INVALID",
    );
  }
  const absoluteRoot = ensurePrivateDirectoryTree(root, receiptRoot);
  const target = path.join(absoluteRoot, `${kind}-${contentHash}.json`);
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  writeExclusiveStableFile(root, absoluteRoot, target, bytes, `governance ${kind} receipt`);
  return target;
}

function ensurePrivateDirectoryTree(root, projectRoot) {
  const normalized = normalizeProjectMutationPath(root, projectRoot);
  let current = root;
  for (const segment of normalized.split("/")) {
    const next = path.join(current, segment);
    const currentEntry = fs.lstatSync(current);
    if (currentEntry.isSymbolicLink() || !currentEntry.isDirectory()) {
      throw new MutationGovernanceError(
        "Governance receipt parent must remain a real directory",
        "MUTATION_PATH_UNSTABLE",
      );
    }
    const parentBefore = fs.statSync(current);
    try {
      fs.mkdirSync(next, { mode: 0o700 });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    const entry = fs.lstatSync(next);
    const parentAfter = fs.statSync(current);
    if (entry.isSymbolicLink()
      || !entry.isDirectory()
      || parentBefore.dev !== parentAfter.dev
      || parentBefore.ino !== parentAfter.ino) {
      throw new MutationGovernanceError(
        "Governance receipt directory changed while it was prepared",
        "MUTATION_PATH_UNSTABLE",
      );
    }
    current = next;
  }
  return current;
}

function writeExclusiveStableFile(root, parent, target, bytes, label) {
  const parentBefore = fs.statSync(parent);
  let descriptor;
  let created = false;
  try {
    try {
      descriptor = fs.openSync(
        target,
        fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | NO_FOLLOW_FLAG,
        0o600,
      );
      created = true;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const existing = readBoundedProjectFile(root, target, {
        maxBytes: Math.max(bytes.length, 1),
        label,
      });
      if (!existing.equals(bytes)) {
        throw new MutationGovernanceError(
          `${label} hash path already contains different bytes`,
          "MUTATION_GOVERNANCE_RECEIPT_CONFLICT",
        );
      }
      return;
    }
    assertOpenTargetStable(descriptor, parent, target, parentBefore, label);
    let offset = 0;
    while (offset < bytes.length) {
      const written = fs.writeSync(descriptor, bytes, offset, bytes.length - offset, null);
      if (!Number.isInteger(written) || written <= 0) {
        throw new MutationGovernanceError(`${label} write was incomplete`, "MUTATION_APPEND_INCOMPLETE");
      }
      offset += written;
    }
    fs.fsyncSync(descriptor);
    assertOpenTargetStable(descriptor, parent, target, parentBefore, label);
  } catch (error) {
    if (created && descriptor !== undefined) {
      try {
        assertOpenTargetStable(descriptor, parent, target, parentBefore, label);
        fs.unlinkSync(target);
      } catch { /* preserve an unstable target instead of deleting an entry we cannot prove we created */ }
    }
    throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function assertOpenTargetStable(descriptor, parent, target, expectedParent, label) {
  const descriptorStat = fs.fstatSync(descriptor);
  const pathStat = fs.lstatSync(target);
  const parentAfter = fs.statSync(parent);
  if (!descriptorStat.isFile()
    || pathStat.isSymbolicLink()
    || descriptorStat.dev !== pathStat.dev
    || descriptorStat.ino !== pathStat.ino
    || expectedParent.dev !== parentAfter.dev
    || expectedParent.ino !== parentAfter.ino) {
    throw new MutationGovernanceError(`${label} target changed while it was written`, "MUTATION_PATH_UNSTABLE");
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
  return nextRecordId(provider, "decision");
}

function nextRecordId(provider, kind) {
  if (typeof provider === "function") return provider(kind);
  decisionSequence += 1;
  return `${kind}-${process.pid}-${decisionSequence}`;
}
