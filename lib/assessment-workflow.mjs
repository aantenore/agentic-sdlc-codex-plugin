import {
  DomainValidationError,
  STABLE_JSON_HASH_ALGORITHM,
  cloneJson,
  computeStableHash,
  immutableJson,
  isPlainRecord,
  normalizeIsoInstant,
  normalizeOptionalString,
  normalizeStringList,
  omitKeys,
  requireNonEmptyString,
  requirePlainRecord,
} from "./canonical.mjs";

export const ASSESSMENT_WORKFLOW_STATES = Object.freeze([
  "context_pending",
  "proposal_pending",
  "authorized",
  "running",
  "verifying",
  "completed",
  "exception_pending",
  "failed",
  "cancelled",
]);

const TERMINAL_STATES = new Set(["completed", "cancelled"]);
const TRANSITIONS = Object.freeze({
  context_pending: Object.freeze(["proposal_pending", "cancelled"]),
  proposal_pending: Object.freeze(["authorized", "cancelled"]),
  authorized: Object.freeze(["proposal_pending", "running", "cancelled"]),
  running: Object.freeze(["verifying", "exception_pending", "failed", "cancelled"]),
  verifying: Object.freeze(["running", "completed", "exception_pending", "failed", "cancelled"]),
  exception_pending: Object.freeze(["authorized", "running", "failed", "cancelled"]),
  failed: Object.freeze(["authorized", "cancelled"]),
  completed: Object.freeze([]),
  cancelled: Object.freeze([]),
});

const PROPOSAL_FIELDS = Object.freeze([
  "schema_version",
  "status",
  "created_at",
  "updated_at",
  "baseline_ref",
  "scope",
  "story_reservation",
  "deliverable",
  "capabilities",
  "contract_draft",
  "route_intent",
  "write_set",
  "execution_budget",
  "security",
  "approvals",
  "authorization_ref",
  "application",
]);

export function buildAssessmentProposal(input) {
  requirePlainRecord(input, "proposal");
  const id = requireNonEmptyString(input.id ?? input.proposal_id, "proposal.id");
  const createdAt = normalizeIsoInstant(input.created_at, "proposal.created_at");
  const updatedAt = normalizeIsoInstant(input.updated_at, "proposal.updated_at");
  if (updatedAt < createdAt) {
    throw new DomainValidationError("proposal.updated_at must not be earlier than proposal.created_at");
  }
  const proposal = {
    kind: "assessment_proposal",
    schema_version: "assessment-proposal:v1",
    version: Number.isSafeInteger(input.version) && input.version > 0 ? input.version : 1,
    id,
    status: "proposal_pending",
    created_at: createdAt,
    updated_at: updatedAt,
    objective: normalizeOptionalString(input.objective, "proposal.objective"),
    baseline_ref: normalizeNullableJson(input.baseline_ref, "proposal.baseline_ref"),
    scope: normalizeObject(input.scope, "proposal.scope"),
    story_reservation: normalizeNullableObject(input.story_reservation, "proposal.story_reservation"),
    deliverable: normalizeObject(input.deliverable, "proposal.deliverable"),
    capabilities: normalizeObject(input.capabilities, "proposal.capabilities"),
    contract_draft: normalizeNullableObject(input.contract_draft, "proposal.contract_draft"),
    route_intent: normalizeNullableObject(input.route_intent, "proposal.route_intent"),
    write_set: normalizeJsonArray(input.write_set, "proposal.write_set"),
    execution_budget: normalizeNullableObject(input.execution_budget, "proposal.execution_budget"),
    security: normalizeObject(input.security, "proposal.security"),
    approvals: normalizeJsonArray(input.approvals, "proposal.approvals"),
    authorization_ref: normalizeNullableJson(input.authorization_ref, "proposal.authorization_ref"),
    application: normalizeObject(input.application, "proposal.application"),
    extensions: normalizeObject(input.extensions, "proposal.extensions"),
  };
  const proposalHash = computeProposalHash(proposal);
  return immutableJson({
    ...proposal,
    proposal_hash: proposalHash,
    hash_algorithm: STABLE_JSON_HASH_ALGORITHM,
  });
}

export function computeProposalHash(proposal) {
  requirePlainRecord(proposal, "proposal");
  return computeStableHash(omitKeys(proposal, ["proposal_hash", "hash_algorithm"]));
}

export function validateProposalIntegrity(proposal) {
  const errors = [];
  if (!isPlainRecord(proposal)) {
    return Object.freeze({
      valid: false,
      actual_hash: null,
      expected_hash: null,
      errors: Object.freeze(["proposal must be a plain object"]),
    });
  }
  if (proposal.kind !== "assessment_proposal") {
    errors.push("proposal.kind must be 'assessment_proposal'");
  }
  if (proposal.schema_version !== "assessment-proposal:v1") {
    errors.push("proposal.schema_version must be 'assessment-proposal:v1'");
  }
  if (proposal.status !== "proposal_pending") {
    errors.push("proposal.status must be 'proposal_pending'");
  }
  if (typeof proposal.id !== "string" || proposal.id.trim() === "") {
    errors.push("proposal.id must be a non-empty string");
  }
  if (!Number.isSafeInteger(proposal.version) || proposal.version < 1) {
    errors.push("proposal.version must be a positive integer");
  }
  for (const field of PROPOSAL_FIELDS) {
    if (!Object.hasOwn(proposal, field)) {
      errors.push(`proposal.${field} is required`);
    }
  }
  if (!isPlainRecord(proposal.scope)) {
    errors.push("proposal.scope must be an object");
  }
  if (!isPlainRecord(proposal.deliverable)) {
    errors.push("proposal.deliverable must be an object");
  }
  if (!Array.isArray(proposal.write_set)) {
    errors.push("proposal.write_set must be an array");
  }
  if (!Array.isArray(proposal.approvals)) {
    errors.push("proposal.approvals must be an array");
  }
  let createdAt = null;
  let updatedAt = null;
  try {
    createdAt = normalizeIsoInstant(proposal.created_at, "proposal.created_at");
    if (createdAt !== proposal.created_at) {
      errors.push("proposal.created_at must be in canonical ISO-8601 UTC form");
    }
  } catch (error) {
    errors.push(error.message);
  }
  try {
    updatedAt = normalizeIsoInstant(proposal.updated_at, "proposal.updated_at");
    if (updatedAt !== proposal.updated_at) {
      errors.push("proposal.updated_at must be in canonical ISO-8601 UTC form");
    }
  } catch (error) {
    errors.push(error.message);
  }
  if (createdAt && updatedAt && updatedAt < createdAt) {
    errors.push("proposal.updated_at must not be earlier than proposal.created_at");
  }
  let expectedHash = null;
  try {
    expectedHash = computeProposalHash(proposal);
  } catch (error) {
    errors.push(`proposal cannot be hashed: ${error.message}`);
  }
  const actualHash = typeof proposal.proposal_hash === "string" ? proposal.proposal_hash : null;
  if (!actualHash) {
    errors.push("proposal.proposal_hash is required");
  } else if (expectedHash && actualHash !== expectedHash) {
    errors.push("proposal.proposal_hash does not match the canonical proposal content");
  }
  if (proposal.hash_algorithm !== STABLE_JSON_HASH_ALGORITHM) {
    errors.push(`proposal.hash_algorithm must be '${STABLE_JSON_HASH_ALGORITHM}'`);
  }
  return Object.freeze({
    valid: errors.length === 0,
    actual_hash: actualHash,
    expected_hash: expectedHash,
    errors: Object.freeze(errors),
  });
}

export function createAssessmentWorkflow({ proposal, state = "proposal_pending", created_at, metadata = {} }) {
  const integrity = validateProposalIntegrity(proposal);
  if (!integrity.valid) {
    throw new DomainValidationError("Cannot create workflow for an invalid proposal", integrity.errors);
  }
  const normalizedState = normalizeWorkflowState(state, "workflow.state");
  if (!["context_pending", "proposal_pending"].includes(normalizedState)) {
    throw new DomainValidationError("A new assessment workflow must start in context_pending or proposal_pending");
  }
  const createdAt = normalizeIsoInstant(created_at, "workflow.created_at");
  const workflow = {
    kind: "assessment_workflow",
    schema_version: "assessment-workflow:v1",
    version: 1,
    proposal_id: proposal.id,
    proposal_hash: proposal.proposal_hash,
    initial_state: normalizedState,
    state: normalizedState,
    revision: 0,
    terminal: false,
    created_at: createdAt,
    updated_at: createdAt,
    authorization_ref: null,
    history: [],
    metadata: normalizeObject(metadata, "workflow.metadata"),
  };
  return sealWorkflow(workflow);
}

export function transitionAssessmentWorkflow(workflow, next, metadata = {}) {
  requirePlainRecord(workflow, "workflow");
  requirePlainRecord(metadata, "transition.metadata");
  const workflowIntegrity = validateAssessmentWorkflowIntegrity(workflow);
  if (!workflowIntegrity.valid) {
    throw new DomainValidationError("Assessment workflow failed integrity validation", workflowIntegrity.errors);
  }
  const current = normalizeWorkflowState(workflow.state, "workflow.state");
  const target = normalizeWorkflowState(next, "workflow.next");
  const history = Array.isArray(workflow.history) ? cloneJson(workflow.history) : [];
  const idempotencyKey = normalizeOptionalString(metadata.idempotency_key, "transition.idempotency_key");
  const previousWithKey = idempotencyKey
    ? [...history].reverse().find((entry) => entry.idempotency_key === idempotencyKey)
    : null;

  if (previousWithKey) {
    if (previousWithKey.to !== target) {
      throw new DomainValidationError(
        `Idempotency key '${idempotencyKey}' was already used for transition to ${previousWithKey.to}`,
      );
    }
    return immutableJson(workflow);
  }
  if (metadata.proposal_hash && metadata.proposal_hash !== workflow.proposal_hash) {
    throw new DomainValidationError("Transition proposal_hash does not match the workflow proposal_hash");
  }
  if (current === target) {
    const suppliedAuthorizationRef = normalizeOptionalString(
      metadata.authorization_ref,
      "transition.authorization_ref",
    );
    if (suppliedAuthorizationRef && suppliedAuthorizationRef !== workflow.authorization_ref) {
      throw new DomainValidationError("Idempotent transition authorization_ref conflicts with the workflow");
    }
    return immutableJson(workflow);
  }
  if (!(TRANSITIONS[current] || []).includes(target)) {
    throw new DomainValidationError(`Invalid assessment workflow transition: ${current} -> ${target}`, [
      { path: "workflow.state", code: "invalid_transition", from: current, to: target },
    ]);
  }
  const authorizationRef = normalizeOptionalString(
    metadata.authorization_ref ?? workflow.authorization_ref,
    "transition.authorization_ref",
  );
  if (target === "authorized" && !authorizationRef) {
    throw new DomainValidationError("Transition to authorized requires metadata.authorization_ref");
  }
  const at = normalizeIsoInstant(metadata.at, "transition.at");
  if (at < workflow.updated_at) {
    throw new DomainValidationError("transition.at must not be earlier than workflow.updated_at");
  }
  const entry = {
    from: current,
    to: target,
    at,
    proposal_hash: workflow.proposal_hash,
    authorization_ref: authorizationRef,
    idempotency_key: idempotencyKey,
    actor: normalizeNullableJson(metadata.actor, "transition.actor"),
    reason: normalizeOptionalString(metadata.reason, "transition.reason"),
    evidence: normalizeStringList(metadata.evidence, "transition.evidence"),
  };
  const transitioned = {
    ...omitKeys(workflow, ["workflow_hash", "hash_algorithm"]),
    state: target,
    revision: Number.isSafeInteger(workflow.revision) ? workflow.revision + 1 : history.length + 1,
    terminal: TERMINAL_STATES.has(target),
    updated_at: at,
    authorization_ref: authorizationRef,
    history: [...history, entry],
  };
  return sealWorkflow(transitioned);
}

export function validateAssessmentWorkflowIntegrity(workflow) {
  const errors = [];
  if (!isPlainRecord(workflow)) {
    return Object.freeze({ valid: false, expected_hash: null, errors: Object.freeze(["workflow must be a plain object"]) });
  }
  if (workflow.kind !== "assessment_workflow") {
    errors.push("workflow.kind must be 'assessment_workflow'");
  }
  if (workflow.schema_version !== "assessment-workflow:v1") {
    errors.push("workflow.schema_version must be 'assessment-workflow:v1'");
  }
  if (!ASSESSMENT_WORKFLOW_STATES.includes(workflow.state)) {
    errors.push(`workflow.state must be one of ${ASSESSMENT_WORKFLOW_STATES.join(", ")}`);
  }
  if (typeof workflow.proposal_id !== "string" || workflow.proposal_id.trim() === "") {
    errors.push("workflow.proposal_id must be a non-empty string");
  }
  if (typeof workflow.proposal_hash !== "string" || !/^[a-f0-9]{64}$/.test(workflow.proposal_hash)) {
    errors.push("workflow.proposal_hash must be a SHA-256 hex digest");
  }
  const history = Array.isArray(workflow.history) ? workflow.history : [];
  if (!Array.isArray(workflow.history)) {
    errors.push("workflow.history must be an array");
  }
  if (!Number.isSafeInteger(workflow.revision) || workflow.revision < 0 || workflow.revision !== history.length) {
    errors.push("workflow.revision must equal workflow.history.length");
  }
  if (workflow.terminal !== TERMINAL_STATES.has(workflow.state)) {
    errors.push("workflow.terminal does not match workflow.state");
  }
  let createdAt = null;
  let updatedAt = null;
  try {
    createdAt = normalizeIsoInstant(workflow.created_at, "workflow.created_at");
    if (createdAt !== workflow.created_at) {
      errors.push("workflow.created_at must be in canonical ISO-8601 UTC form");
    }
  } catch (error) {
    errors.push(error.message);
  }
  try {
    updatedAt = normalizeIsoInstant(workflow.updated_at, "workflow.updated_at");
    if (updatedAt !== workflow.updated_at) {
      errors.push("workflow.updated_at must be in canonical ISO-8601 UTC form");
    }
  } catch (error) {
    errors.push(error.message);
  }
  const initialState = workflow.initial_state
    ?? (history.length > 0 && isPlainRecord(history[0]) ? history[0].from : workflow.state);
  if (!["context_pending", "proposal_pending"].includes(initialState)) {
    errors.push("workflow.initial_state must be context_pending or proposal_pending");
  }
  let expectedState = initialState;
  let previousAt = createdAt;
  const seenIdempotencyKeys = new Set();
  for (let index = 0; index < history.length; index += 1) {
    const entry = history[index];
    if (!isPlainRecord(entry)) {
      errors.push(`workflow.history[${index}] must be an object`);
      continue;
    }
    if (entry.from !== expectedState) {
      errors.push(`workflow.history[${index}].from does not continue the state history`);
    }
    if (!ASSESSMENT_WORKFLOW_STATES.includes(entry.to) || !(TRANSITIONS[entry.from] || []).includes(entry.to)) {
      errors.push(`workflow.history[${index}] contains an invalid transition`);
    } else {
      expectedState = entry.to;
    }
    if (entry.proposal_hash !== workflow.proposal_hash) {
      errors.push(`workflow.history[${index}].proposal_hash does not match workflow.proposal_hash`);
    }
    if (entry.to === "authorized" && !entry.authorization_ref) {
      errors.push(`workflow.history[${index}] authorization requires authorization_ref`);
    }
    try {
      const entryAt = normalizeIsoInstant(entry.at, `workflow.history[${index}].at`);
      if (entryAt !== entry.at) {
        errors.push(`workflow.history[${index}].at must be in canonical ISO-8601 UTC form`);
      }
      if (previousAt && entryAt < previousAt) {
        errors.push(`workflow.history[${index}].at is earlier than the preceding event`);
      }
      previousAt = entryAt;
    } catch (error) {
      errors.push(error.message);
    }
    if (entry.idempotency_key) {
      if (seenIdempotencyKeys.has(entry.idempotency_key)) {
        errors.push(`workflow.history[${index}].idempotency_key is duplicated`);
      }
      seenIdempotencyKeys.add(entry.idempotency_key);
    }
  }
  if (expectedState !== workflow.state) {
    errors.push("workflow.state does not match the final history state");
  }
  if (previousAt && updatedAt && previousAt !== updatedAt) {
    errors.push("workflow.updated_at must equal the latest history event time");
  }
  let expectedHash = null;
  try {
    expectedHash = computeStableHash(omitKeys(workflow, ["workflow_hash", "hash_algorithm"]));
  } catch (error) {
    errors.push(`workflow cannot be hashed: ${error.message}`);
  }
  if (!workflow.workflow_hash || workflow.workflow_hash !== expectedHash) {
    errors.push("workflow.workflow_hash does not match canonical workflow content");
  }
  if (workflow.hash_algorithm !== STABLE_JSON_HASH_ALGORITHM) {
    errors.push(`workflow.hash_algorithm must be '${STABLE_JSON_HASH_ALGORITHM}'`);
  }
  return Object.freeze({
    valid: errors.length === 0,
    expected_hash: expectedHash,
    errors: Object.freeze(Array.from(new Set(errors))),
  });
}

export function preflightAssessmentProposal({
  candidate,
  existing = null,
  idempotency_key = null,
  idempotency_record = null,
  expected_proposal_hash = null,
}) {
  const proposal = candidate?.kind === "assessment_proposal" ? immutableJson(candidate) : buildAssessmentProposal(candidate);
  const integrity = validateProposalIntegrity(proposal);
  if (!integrity.valid) {
    return immutableJson({
      ok: false,
      status: "invalid",
      action: null,
      proposal,
      reasons: integrity.errors,
    });
  }
  if (expected_proposal_hash && expected_proposal_hash !== proposal.proposal_hash) {
    return immutableJson({
      ok: false,
      status: "conflict",
      action: null,
      proposal,
      reasons: ["expected_proposal_hash does not match the candidate proposal"],
    });
  }
  const key = normalizeOptionalString(idempotency_key, "idempotency_key");
  const requestHash = computeStableHash({
    operation: "assessment.proposal.apply",
    idempotency_key: key,
    proposal_id: proposal.id,
    proposal_hash: proposal.proposal_hash,
  });
  if (key && idempotency_record && idempotency_record.key === key) {
    const sameRequest = idempotency_record.request_hash === requestHash;
    return immutableJson({
      ok: sameRequest,
      status: sameRequest ? "idempotent_replay" : "conflict",
      action: sameRequest ? "reuse" : null,
      proposal,
      request_hash: requestHash,
      reasons: sameRequest ? [] : ["idempotency key is already bound to different proposal content"],
    });
  }
  if (existing) {
    const existingIntegrity = validateProposalIntegrity(existing);
    if (!existingIntegrity.valid) {
      return immutableJson({
        ok: false,
        status: "blocked",
        action: null,
        proposal,
        request_hash: requestHash,
        reasons: ["existing proposal failed integrity validation", ...existingIntegrity.errors],
      });
    }
    if (existing.id === proposal.id && existing.proposal_hash === proposal.proposal_hash) {
      return immutableJson({
        ok: true,
        status: "idempotent_replay",
        action: "reuse",
        proposal: existing,
        request_hash: requestHash,
        idempotency_record: key ? { key, request_hash: requestHash, proposal_hash: proposal.proposal_hash } : null,
        reasons: [],
      });
    }
    if (existing.id === proposal.id) {
      return immutableJson({
        ok: false,
        status: "conflict",
        action: null,
        proposal,
        request_hash: requestHash,
        reasons: [`proposal id '${proposal.id}' is already bound to different content`],
      });
    }
  }
  return immutableJson({
    ok: true,
    status: "ready",
    action: "create",
    proposal,
    request_hash: requestHash,
    idempotency_record: key ? { key, request_hash: requestHash, proposal_hash: proposal.proposal_hash } : null,
    reasons: [],
  });
}

export function buildAssessmentUserMessage(proposal, options = {}) {
  const integrity = validateProposalIntegrity(proposal);
  if (!integrity.valid) {
    throw new DomainValidationError("Cannot build a user message for an invalid proposal", integrity.errors);
  }
  const language = String(options.language || "en").toLowerCase().startsWith("it") ? "it" : "en";
  const scope = compactValue(proposal.scope);
  const deliverable = compactValue(proposal.deliverable);
  const capabilities = compactValue(proposal.capabilities);
  const writeSet = proposal.write_set.length ? proposal.write_set.map(compactValue).join("; ") : "none";
  const security = compactValue(proposal.security);
  const budget = proposal.execution_budget ? compactValue(proposal.execution_budget) : "not specified";
  const approvalScope = {
    proposal_id: proposal.id,
    proposal_hash: proposal.proposal_hash,
    applies_only_to_presented_content: true,
    authorizes_future_material_changes: false,
  };
  const examples = language === "it"
    ? {
        approve: `Approvo la proposta ${proposal.id} con hash ${proposal.proposal_hash}.`,
        revise: `Rivedi la proposta ${proposal.id}: <indica modifica precisa>.`,
        reject: `Non autorizzo la proposta ${proposal.id}.`,
      }
    : {
        approve: `I approve proposal ${proposal.id} with hash ${proposal.proposal_hash}.`,
        revise: `Revise proposal ${proposal.id}: <state the exact change>.`,
        reject: `I do not authorize proposal ${proposal.id}.`,
      };
  const reviewItems = language === "it"
    ? [
        `Obiettivo: ${proposal.objective || "assessment concordato"}`,
        `Ambito: ${scope}`,
        `Deliverable: ${deliverable}`,
        `Capacita e strumenti: ${capabilities}`,
        `Scritture autorizzabili: ${writeSet}`,
        `Sicurezza e confini: ${security}`,
        `Budget di esecuzione: ${budget}`,
      ]
    : [
        `Objective: ${proposal.objective || "the agreed assessment"}`,
        `Scope: ${scope}`,
        `Deliverable: ${deliverable}`,
        `Capabilities and tools: ${capabilities}`,
        `Potential writes: ${writeSet}`,
        `Security and boundaries: ${security}`,
        `Execution budget: ${budget}`,
      ];
  const title = language === "it" ? `Proposta assessment ${proposal.id}` : `Assessment proposal ${proposal.id}`;
  const decision = language === "it"
    ? "Approva questo contenuto esatto, chiedi una modifica precisa oppure rifiuta. Una modifica materiale produce un nuovo hash e richiede una nuova autorizzazione."
    : "Approve this exact content, request a precise change, or reject it. A material change produces a new hash and requires new authorization.";
  const nonAuthorization = language === "it"
    ? "L'approvazione non autorizza azioni fuori dallo scope, nuove scritture, accessi esterni, segreti, produzione o budget aggiuntivo."
    : "Approval does not authorize out-of-scope actions, new writes, external access, secrets, production access, or extra budget.";
  const text = [
    title,
    `ID: ${proposal.id}`,
    `Hash: ${proposal.proposal_hash}`,
    "",
    ...reviewItems.map((item) => `- ${item}`),
    "",
    decision,
    nonAuthorization,
    "",
    language === "it" ? "Esempi di risposta:" : "Example responses:",
    `- ${examples.approve}`,
    `- ${examples.revise}`,
    `- ${examples.reject}`,
  ].join("\n");
  return immutableJson({
    title,
    proposal_id: proposal.id,
    proposal_hash: proposal.proposal_hash,
    review_items: reviewItems,
    decision_required: decision,
    not_authorized: nonAuthorization,
    approval_scope: approvalScope,
    examples,
    text,
  });
}

export function allowedAssessmentTransitions(state) {
  const normalized = normalizeWorkflowState(state, "state");
  return Object.freeze([...(TRANSITIONS[normalized] || [])]);
}

function sealWorkflow(workflow) {
  const base = omitKeys(workflow, ["workflow_hash", "hash_algorithm"]);
  return immutableJson({
    ...base,
    workflow_hash: computeStableHash(base),
    hash_algorithm: STABLE_JSON_HASH_ALGORITHM,
  });
}

function normalizeWorkflowState(value, label) {
  const normalized = requireNonEmptyString(value, label);
  if (!ASSESSMENT_WORKFLOW_STATES.includes(normalized)) {
    throw new DomainValidationError(`${label} must be one of ${ASSESSMENT_WORKFLOW_STATES.join(", ")}`);
  }
  return normalized;
}

function normalizeObject(value, label) {
  if (value === undefined || value === null) {
    return {};
  }
  requirePlainRecord(value, label);
  return cloneJson(value);
}

function normalizeNullableObject(value, label) {
  if (value === undefined || value === null) {
    return null;
  }
  return normalizeObject(value, label);
}

function normalizeNullableJson(value, label) {
  if (value === undefined || value === null) {
    return null;
  }
  try {
    return cloneJson(value);
  } catch (error) {
    throw new DomainValidationError(`${label} must be canonical JSON: ${error.message}`);
  }
}

function normalizeJsonArray(value, label) {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new DomainValidationError(`${label} must be an array`);
  }
  return cloneJson(value);
}

function compactValue(value) {
  if (value === null || value === undefined) {
    return "none";
  }
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.length ? value.map(compactValue).join(", ") : "none";
  }
  if (isPlainRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return "none";
    }
    return entries.map(([key, item]) => `${key}=${compactValue(item)}`).join(", ");
  }
  return String(value);
}
