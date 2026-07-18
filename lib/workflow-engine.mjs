import {
  DomainValidationError,
  STABLE_JSON_HASH_ALGORITHM,
  cloneJson,
  computeStableHash,
  immutableJson,
  isPlainRecord,
  normalizeIsoInstant,
  normalizeOptionalString,
  requireNonEmptyString,
  requirePlainRecord,
} from "./canonical.mjs";

const SHA256 = /^[a-f0-9]{64}$/;
const DEFINITION_SCHEMA = "workflow-definition:v1";
const OVERLAY_SCHEMA = "workflow-overlay:v1";
const EFFECTIVE_SCHEMA = "effective-workflow-definition:v1";
const INSTANCE_SCHEMA = "workflow-instance:v1";
const EVENT_SCHEMA = "workflow-transition-event:v1";

/** Built-in, deterministic guards. Callers may add named pure functions explicitly. */
export const DEFAULT_WORKFLOW_GUARD_ALLOWLIST = Object.freeze({
  always: () => Object.freeze({ allowed: true, reason: "always" }),
  "context-equals": ({ parameters, context }) => {
    const key = requireNonEmptyString(parameters?.key, "guard.parameters.key");
    return Object.freeze({
      allowed: Object.hasOwn(context, key) && context[key] === parameters.value,
      reason: `context.${key} must equal the configured value`,
    });
  },
  "context-present": ({ parameters, context }) => {
    const key = requireNonEmptyString(parameters?.key, "guard.parameters.key");
    return Object.freeze({
      allowed: Object.hasOwn(context, key) && context[key] !== null && context[key] !== undefined,
      reason: `context.${key} must be present`,
    });
  },
  "checkpoint-approved": ({ parameters, context }) => {
    const checkpoint = requireNonEmptyString(String(parameters?.checkpoint ?? ""), "guard.parameters.checkpoint");
    const approvals = isPlainRecord(context?.checkpoint_approvals) ? context.checkpoint_approvals : {};
    return Object.freeze({
      allowed: approvals[checkpoint] === true,
      reason: `checkpoint ${checkpoint} must be approved`,
    });
  },
});

/** Create a canonical, deeply immutable, versioned workflow definition. */
export function buildWorkflowDefinition(input, options = {}) {
  requirePlainRecord(input, "workflow_definition");
  assertOnlyKeys(input, [
    "kind", "schema_version", "id", "version", "status", "label", "name", "title", "description", "summary",
    "initial_state", "states", "transitions", "phase_order", "normal_checkpoints", "metadata", "created_at",
    "approval", "definition_hash", "hash_algorithm",
  ], "workflow_definition");
  const definition = {
    kind: "workflow_definition",
    schema_version: DEFINITION_SCHEMA,
    id: requireNonEmptyString(input.id, "workflow_definition.id"),
    version: normalizeVersion(input.version, "workflow_definition.version"),
    status: normalizeStatus(input.status),
    label: requireNonEmptyString(input.label ?? input.name ?? input.title ?? input.id, "workflow_definition.label"),
    description: normalizeOptionalString(input.description ?? input.summary, "workflow_definition.description"),
    initial_state: requireNonEmptyString(input.initial_state, "workflow_definition.initial_state"),
    states: normalizeStates(input.states),
    transitions: normalizeTransitions(input.transitions, options.guard_allowlist),
    phase_order: normalizeIdentifierList(input.phase_order, "workflow_definition.phase_order"),
    normal_checkpoints: normalizeIdentifierList(input.normal_checkpoints, "workflow_definition.normal_checkpoints"),
    metadata: normalizeJsonRecord(input.metadata, "workflow_definition.metadata"),
    created_at: normalizeIsoInstant(input.created_at ?? new Date().toISOString(), "workflow_definition.created_at"),
    approval: input.approval == null ? null : normalizeApproval(input.approval),
  };
  validateDefinitionGraph(definition);
  validateLifecycle(definition.status, definition.approval, "workflow_definition");
  return sealDefinition(definition);
}

/** Return integrity and graph errors without mutating the supplied definition. */
export function validateWorkflowDefinition(definition, options = {}) {
  const errors = [];
  let rebuilt = null;
  try {
    rebuilt = buildWorkflowDefinition(definition, options);
  } catch (error) {
    errors.push(...errorMessages(error));
  }
  const actualHash = typeof definition?.definition_hash === "string" ? definition.definition_hash : null;
  const expectedHash = rebuilt?.definition_hash ?? null;
  if (rebuilt && actualHash !== expectedHash) errors.push("workflow_definition.definition_hash does not match its canonical content");
  if (definition?.hash_algorithm !== STABLE_JSON_HASH_ALGORITHM) errors.push(`workflow_definition.hash_algorithm must be '${STABLE_JSON_HASH_ALGORITHM}'`);
  return immutableJson({ valid: errors.length === 0, errors, actual_hash: actualHash, expected_hash: expectedHash });
}

/** Approve the exact material content without changing its content hash or mutating the proposal. */
export function approveWorkflowDefinition(definition, options = {}) {
  const integrity = validateWorkflowDefinition(definition, options);
  if (!integrity.valid) throw new DomainValidationError("Workflow definition failed integrity validation", integrity.errors);
  if (definition.status === "approved") return immutableJson(definition);
  return buildWorkflowDefinition({ ...cloneJson(definition), status: "approved", approval: approvalFromOptions(options) }, options);
}

export function computeWorkflowDefinitionHash(definition) {
  requirePlainRecord(definition, "workflow_definition");
  return computeStableHash(withoutKeys(definition, ["status", "approval", "definition_hash", "hash_algorithm"]));
}

/** Build a governed overlay. Structural fields are deliberately not accepted. */
export function buildWorkflowOverlay(input, options = {}) {
  requirePlainRecord(input, "workflow_overlay");
  assertOnlyKeys(input, [
    "kind", "schema_version", "id", "version", "status", "definition_ref", "label", "name", "title", "description", "summary",
    "metadata", "state_overrides", "transition_overrides", "created_at", "approval", "overlay_hash", "hash_algorithm",
  ], "workflow_overlay");
  const definition = options.definition;
  assertApprovedOrProposedDefinition(definition, options);
  const overlay = {
    kind: "workflow_overlay",
    schema_version: OVERLAY_SCHEMA,
    id: requireNonEmptyString(input.id, "workflow_overlay.id"),
    version: normalizeVersion(input.version, "workflow_overlay.version"),
    status: normalizeStatus(input.status),
    definition_ref: normalizeDefinitionRef(input.definition_ref),
    label: normalizeOptionalString(input.label ?? input.name ?? input.title, "workflow_overlay.label"),
    description: normalizeOptionalString(input.description ?? input.summary, "workflow_overlay.description"),
    metadata: normalizeJsonRecord(input.metadata, "workflow_overlay.metadata"),
    state_overrides: normalizeStateOverrides(input.state_overrides),
    transition_overrides: normalizeTransitionOverrides(input.transition_overrides),
    created_at: normalizeIsoInstant(input.created_at ?? new Date().toISOString(), "workflow_overlay.created_at"),
    approval: input.approval == null ? null : normalizeApproval(input.approval),
  };
  validateLifecycle(overlay.status, overlay.approval, "workflow_overlay");
  validateOverlayTargets(overlay, definition);
  return sealOverlay(overlay);
}

export function validateWorkflowOverlay(overlay, options = {}) {
  const errors = [];
  let rebuilt = null;
  try {
    rebuilt = buildWorkflowOverlay(overlay, options);
  } catch (error) {
    errors.push(...errorMessages(error));
  }
  const actualHash = typeof overlay?.overlay_hash === "string" ? overlay.overlay_hash : null;
  const expectedHash = rebuilt?.overlay_hash ?? null;
  if (rebuilt && actualHash !== expectedHash) errors.push("workflow_overlay.overlay_hash does not match its canonical content");
  if (overlay?.hash_algorithm !== STABLE_JSON_HASH_ALGORITHM) errors.push(`workflow_overlay.hash_algorithm must be '${STABLE_JSON_HASH_ALGORITHM}'`);
  return immutableJson({ valid: errors.length === 0, errors, actual_hash: actualHash, expected_hash: expectedHash });
}

export function approveWorkflowOverlay(overlay, options = {}) {
  const integrity = validateWorkflowOverlay(overlay, options);
  if (!integrity.valid) throw new DomainValidationError("Workflow overlay failed integrity validation", integrity.errors);
  if (overlay.status === "approved") return immutableJson(overlay);
  return buildWorkflowOverlay({ ...cloneJson(overlay), status: "approved", approval: approvalFromOptions(options) }, options);
}

export function computeWorkflowOverlayHash(overlay) {
  requirePlainRecord(overlay, "workflow_overlay");
  return computeStableHash(withoutKeys(overlay, ["status", "approval", "overlay_hash", "hash_algorithm"]));
}

/** Apply labels, metadata and guard parameters only; topology and phase order remain unchanged. */
export function applyWorkflowOverlay(definition, overlay = null, options = {}) {
  assertDefinitionIntegrity(definition, options);
  if (definition.status !== "approved") throw new DomainValidationError("Workflow definition must be approved before use");
  if (overlay !== null) {
    const integrity = validateWorkflowOverlay(overlay, { ...options, definition });
    if (!integrity.valid) throw new DomainValidationError("Workflow overlay failed integrity validation", integrity.errors);
    if (overlay.status !== "approved" && options.allow_proposed !== true) {
      throw new DomainValidationError("Workflow overlay must be approved before use");
    }
  }
  const stateOverrides = new Map((overlay?.state_overrides ?? []).map((entry) => [entry.state_id, entry]));
  const transitionOverrides = new Map((overlay?.transition_overrides ?? []).map((entry) => [entry.transition_id, entry]));
  const states = definition.states.map((state) => {
    const override = stateOverrides.get(state.id);
    return { ...state, label: override?.label ?? state.label, metadata: mergeRecords(state.metadata, override?.metadata) };
  });
  const transitions = definition.transitions.map((transition) => {
    const override = transitionOverrides.get(transition.id);
    const parameters = new Map((override?.guard_parameters ?? []).map((entry) => [entry.guard_id, entry.parameters]));
    return {
      ...transition,
      label: override?.label ?? transition.label,
      metadata: mergeRecords(transition.metadata, override?.metadata),
      guards: transition.guards.map((guard) => ({ ...guard, parameters: parameters.has(guard.id) ? parameters.get(guard.id) : guard.parameters })),
    };
  });
  const effective = {
    kind: "effective_workflow_definition",
    schema_version: EFFECTIVE_SCHEMA,
    definition_ref: definitionRef(definition),
    overlay_ref: overlay ? overlayRef(overlay) : null,
    id: definition.id,
    version: definition.version,
    label: overlay?.label ?? definition.label,
    description: overlay?.description ?? definition.description,
    initial_state: definition.initial_state,
    states,
    transitions,
    phase_order: cloneJson(definition.phase_order),
    normal_checkpoints: cloneJson(definition.normal_checkpoints),
    metadata: mergeRecords(definition.metadata, overlay?.metadata),
    hash_algorithm: STABLE_JSON_HASH_ALGORITHM,
  };
  return immutableJson({ ...effective, effective_hash: computeEffectiveWorkflowHash(effective) });
}

export function computeEffectiveWorkflowHash(effective) {
  requirePlainRecord(effective, "effective_workflow_definition");
  return computeStableHash(withoutKeys(effective, ["effective_hash", "hash_algorithm"]));
}

/** Create the immutable instance header; mutable progress lives only in its event stream. */
export function createWorkflowInstance(input) {
  requirePlainRecord(input, "workflow_instance");
  const effective = requireEffectiveDefinition(input.effective_definition);
  const createdAt = normalizeIsoInstant(input.created_at, "workflow_instance.created_at");
  const instance = {
    kind: "workflow_instance",
    schema_version: INSTANCE_SCHEMA,
    id: requireNonEmptyString(input.id, "workflow_instance.id"),
    definition_ref: cloneJson(effective.definition_ref),
    overlay_ref: cloneJson(effective.overlay_ref),
    effective_hash: effective.effective_hash,
    initial_state: effective.initial_state,
    created_at: createdAt,
    actor: normalizeActor(input.actor, "workflow_instance.actor"),
    metadata: normalizeJsonRecord(input.metadata, "workflow_instance.metadata"),
    hash_algorithm: STABLE_JSON_HASH_ALGORITHM,
  };
  return immutableJson({ ...instance, instance_hash: computeWorkflowInstanceHash(instance) });
}

export const startWorkflowInstance = createWorkflowInstance;

export function computeWorkflowInstanceHash(instance) {
  requirePlainRecord(instance, "workflow_instance");
  return computeStableHash(withoutKeys(instance, ["instance_hash", "hash_algorithm"]));
}

/** Build one append-only transition event, or return the original event for an idempotent replay. */
export function createWorkflowTransition(input, options = {}) {
  requirePlainRecord(input, "workflow_transition");
  const instance = validateInstance(input.instance);
  const effective = requireEffectiveDefinition(input.effective_definition);
  assertInstancePins(instance, effective);
  const events = Array.isArray(input.events) ? input.events : [];
  const replay = replayWorkflowEvents({ instance, effective_definition: effective, events }, options);
  if (!replay.valid) throw new DomainValidationError("Workflow event stream failed integrity validation", replay.errors);
  const key = requireNonEmptyString(input.idempotency_key, "workflow_transition.idempotency_key");
  const target = requireNonEmptyString(input.to, "workflow_transition.to");
  const prior = events.find((event) => event.idempotency_key === key);
  if (prior) {
    if (prior.to !== target) throw new DomainValidationError(`Idempotency key '${key}' was already used for transition to ${prior.to}`);
    return immutableJson({ event: prior, replay, idempotent: true, state: replay.state, sequence: replay.sequence });
  }
  const expectedSequence = input.expected_sequence ?? replay.sequence;
  if (!Number.isSafeInteger(expectedSequence) || expectedSequence !== replay.sequence) {
    throw new DomainValidationError(`Optimistic sequence conflict: expected ${expectedSequence}, current ${replay.sequence}`);
  }
  const expectedPreviousHash = input.expected_previous_hash ?? replay.last_event_hash;
  if (expectedPreviousHash !== replay.last_event_hash) throw new DomainValidationError("Optimistic previous hash conflict");
  const transition = effective.transitions.find((candidate) => candidate.from === replay.state && candidate.to === target);
  if (!transition) throw new DomainValidationError(`Invalid workflow transition: ${replay.state} -> ${target}`);
  const timestamp = normalizeIsoInstant(input.timestamp, "workflow_transition.timestamp");
  if (timestamp < replay.updated_at) throw new DomainValidationError("workflow_transition.timestamp must not be earlier than the event stream");
  const context = normalizeJsonRecord(input.context, "workflow_transition.context");
  const guardResult = evaluateWorkflowGuards(transition.guards, context, options.guard_allowlist);
  if (!guardResult.allowed) throw new DomainValidationError("Workflow transition guards denied the transition", guardResult.results);
  const event = {
    kind: "workflow_transition_event",
    schema_version: EVENT_SCHEMA,
    instance_id: instance.id,
    instance_hash: instance.instance_hash,
    effective_hash: effective.effective_hash,
    sequence: replay.sequence + 1,
    previous_hash: replay.last_event_hash,
    transition_id: transition.id,
    from: replay.state,
    to: target,
    timestamp,
    actor: normalizeActor(input.actor, "workflow_transition.actor"),
    idempotency_key: key,
    context_hash: computeStableHash(context),
    guard_results: guardResult.results,
    hash_algorithm: STABLE_JSON_HASH_ALGORITHM,
  };
  const sealed = immutableJson({ ...event, event_hash: computeWorkflowEventHash(event) });
  const nextReplay = replayWorkflowEvents({ instance, effective_definition: effective, events: [...events, sealed] }, options);
  if (!nextReplay.valid) throw new DomainValidationError("Created workflow event failed replay validation", nextReplay.errors);
  return immutableJson({ event: sealed, replay: nextReplay, idempotent: false, state: target, sequence: sealed.sequence });
}

export const transitionWorkflowInstance = createWorkflowTransition;

export function computeWorkflowEventHash(event) {
  requirePlainRecord(event, "workflow_event");
  return computeStableHash(withoutKeys(event, ["event_hash", "hash_algorithm"]));
}

/** Replay and verify the hash chain. A supplied checkpoint also exposes truncation. */
export function replayWorkflowEvents(input, options = {}) {
  const errors = [];
  let instance;
  let effective;
  try {
    instance = validateInstance(input?.instance);
    effective = requireEffectiveDefinition(input?.effective_definition);
    assertInstancePins(instance, effective);
  } catch (error) {
    return replayProjection({ valid: false, errors: errorMessages(error), state: null, sequence: 0, last_event_hash: null, updated_at: null, terminal: false, effective: null });
  }
  const events = Array.isArray(input.events) ? input.events : [];
  let state = instance.initial_state;
  let lastHash = null;
  let updatedAt = instance.created_at;
  const keys = new Set();
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    const sequence = index + 1;
    const errorCountBeforeEvent = errors.length;
    if (!isPlainRecord(event)) { errors.push(`event ${sequence} must be an object`); continue; }
    if (event.kind !== "workflow_transition_event" || event.schema_version !== EVENT_SCHEMA) errors.push(`event ${sequence} has an unsupported schema`);
    if (event.sequence !== sequence) errors.push(`event ${sequence} is missing, duplicated, or reordered`);
    if (event.previous_hash !== lastHash) errors.push(`event ${sequence} previous_hash does not match the chain`);
    if (event.instance_id !== instance.id || event.instance_hash !== instance.instance_hash) errors.push(`event ${sequence} does not belong to this instance`);
    if (event.effective_hash !== effective.effective_hash) errors.push(`event ${sequence} does not match the pinned effective definition`);
    if (event.from !== state) errors.push(`event ${sequence} from state does not match replay state`);
    const transition = effective.transitions.find((candidate) => candidate.id === event.transition_id);
    if (!transition || transition.from !== event.from || transition.to !== event.to) errors.push(`event ${sequence} transition does not match the effective definition`);
    if (typeof event.idempotency_key !== "string" || event.idempotency_key.length === 0) errors.push(`event ${sequence} idempotency_key is required`);
    else if (keys.has(event.idempotency_key)) errors.push(`event ${sequence} duplicates idempotency_key '${event.idempotency_key}'`);
    keys.add(event.idempotency_key);
    let timestamp = null;
    try { timestamp = normalizeIsoInstant(event.timestamp, `event ${sequence}.timestamp`); } catch (error) { errors.push(error.message); }
    if (timestamp && timestamp < updatedAt) errors.push(`event ${sequence} timestamp is not monotonic`);
    let expectedHash = null;
    try { expectedHash = computeWorkflowEventHash(event); } catch (error) { errors.push(`event ${sequence} cannot be hashed: ${error.message}`); }
    if (!expectedHash || event.event_hash !== expectedHash) errors.push(`event ${sequence} event_hash does not match its content`);
    if (event.hash_algorithm !== STABLE_JSON_HASH_ALGORITHM) errors.push(`event ${sequence} hash_algorithm is invalid`);
    if (errors.length === errorCountBeforeEvent) {
      state = event.to;
      lastHash = event.event_hash;
      if (timestamp) updatedAt = timestamp;
    }
  }
  const checkpoint = input.checkpoint;
  if (checkpoint !== undefined && checkpoint !== null) {
    try {
      requirePlainRecord(checkpoint, "workflow_checkpoint");
      if (checkpoint.sequence !== events.length) errors.push(`event stream is truncated or has uncheckpointed events: checkpoint sequence ${checkpoint.sequence}, actual ${events.length}`);
      if (checkpoint.last_event_hash !== lastHash) errors.push("workflow checkpoint last_event_hash does not match the stream");
      if (checkpoint.state !== state) errors.push("workflow checkpoint state does not match replay state");
    } catch (error) { errors.push(...errorMessages(error)); }
  }
  const terminal = effective.states.find((candidate) => candidate.id === state)?.terminal === true;
  return replayProjection({ valid: errors.length === 0, errors, state, sequence: events.length, last_event_hash: lastHash, updated_at: updatedAt, terminal, effective });
}

export const validateWorkflowEventStream = replayWorkflowEvents;

export function allowedWorkflowTransitions(effectiveDefinition, state) {
  const effective = requireEffectiveDefinition(effectiveDefinition);
  const normalized = requireNonEmptyString(state, "workflow.state");
  return immutableJson(effective.transitions.filter((transition) => transition.from === normalized).map((transition) => ({ id: transition.id, to: transition.to, label: transition.label, guards: transition.guards })));
}

export function evaluateWorkflowGuards(guards, context = {}, guardAllowlist = undefined) {
  const allowlist = normalizeGuardAllowlist(guardAllowlist);
  const normalizedContext = normalizeJsonRecord(context, "guard.context");
  const results = (guards ?? []).map((guard, index) => {
    const normalized = normalizeGuard(guard, index, allowlist);
    const raw = allowlist[normalized.id]({ parameters: immutableJson(normalized.parameters), context: immutableJson(normalizedContext) });
    const result = typeof raw === "boolean" ? { allowed: raw, reason: null } : raw;
    if (!isPlainRecord(result) || typeof result.allowed !== "boolean") throw new DomainValidationError(`Guard '${normalized.id}' returned an invalid result`);
    return { guard_id: normalized.id, allowed: result.allowed, reason: normalizeOptionalString(result.reason, `guard '${normalized.id}'.reason`) };
  });
  return immutableJson({ allowed: results.every((result) => result.allowed), results });
}

export function explainWorkflowConfiguration(effectiveDefinition) {
  const effective = requireEffectiveDefinition(effectiveDefinition);
  return immutableJson({
    definition_ref: effective.definition_ref,
    overlay_ref: effective.overlay_ref,
    effective_hash: effective.effective_hash,
    phase_order: effective.phase_order,
    normal_checkpoints: effective.normal_checkpoints,
    guard_ids: [...new Set(effective.transitions.flatMap((transition) => transition.guards.map((guard) => guard.id)))].sort(),
  });
}

function sealDefinition(definition) {
  const record = { ...definition, definition_hash: computeWorkflowDefinitionHash(definition), hash_algorithm: STABLE_JSON_HASH_ALGORITHM };
  return immutableJson(record);
}

function sealOverlay(overlay) {
  const record = { ...overlay, overlay_hash: computeWorkflowOverlayHash(overlay), hash_algorithm: STABLE_JSON_HASH_ALGORITHM };
  return immutableJson(record);
}

function normalizeStates(states) {
  if (!Array.isArray(states) || states.length === 0) throw new DomainValidationError("workflow_definition.states must contain at least one state");
  const ids = new Set();
  return states.map((state, index) => {
    requirePlainRecord(state, `workflow_definition.states[${index}]`);
    assertOnlyKeys(state, ["id", "label", "terminal", "metadata"], `workflow_definition.states[${index}]`);
    const id = requireNonEmptyString(state.id, `workflow_definition.states[${index}].id`);
    if (ids.has(id)) throw new DomainValidationError(`Duplicate workflow state '${id}'`);
    ids.add(id);
    return { id, label: requireNonEmptyString(state.label ?? id, `workflow_definition.states[${index}].label`), terminal: state.terminal === true, metadata: normalizeJsonRecord(state.metadata, `workflow_definition.states[${index}].metadata`) };
  });
}

function normalizeTransitions(transitions, guardAllowlist) {
  if (!Array.isArray(transitions)) throw new DomainValidationError("workflow_definition.transitions must be an array");
  const allowlist = normalizeGuardAllowlist(guardAllowlist);
  const ids = new Set();
  return transitions.map((transition, index) => {
    requirePlainRecord(transition, `workflow_definition.transitions[${index}]`);
    assertOnlyKeys(transition, ["id", "from", "to", "label", "guards", "metadata"], `workflow_definition.transitions[${index}]`);
    const id = requireNonEmptyString(transition.id, `workflow_definition.transitions[${index}].id`);
    if (ids.has(id)) throw new DomainValidationError(`Duplicate workflow transition '${id}'`);
    ids.add(id);
    const guards = transition.guards === undefined ? [] : transition.guards;
    if (!Array.isArray(guards)) throw new DomainValidationError(`workflow_definition.transitions[${index}].guards must be an array`);
    const normalizedGuards = guards.map((guard, guardIndex) => normalizeGuard(guard, guardIndex, allowlist));
    if (new Set(normalizedGuards.map((guard) => guard.id)).size !== normalizedGuards.length) throw new DomainValidationError(`Transition '${id}' contains duplicate guard ids`);
    return { id, from: requireNonEmptyString(transition.from, `workflow_definition.transitions[${index}].from`), to: requireNonEmptyString(transition.to, `workflow_definition.transitions[${index}].to`), label: requireNonEmptyString(transition.label ?? id, `workflow_definition.transitions[${index}].label`), guards: normalizedGuards, metadata: normalizeJsonRecord(transition.metadata, `workflow_definition.transitions[${index}].metadata`) };
  });
}

function normalizeGuard(guard, index, allowlist) {
  requirePlainRecord(guard, `guard[${index}]`);
  assertOnlyKeys(guard, ["id", "parameters"], `guard[${index}]`);
  const id = requireNonEmptyString(guard.id, `guard[${index}].id`);
  if (!Object.hasOwn(allowlist, id)) throw new DomainValidationError(`Workflow guard '${id}' is not allowlisted`);
  return { id, parameters: normalizeJsonRecord(guard.parameters, `guard[${index}].parameters`) };
}

function normalizeGuardAllowlist(value) {
  const source = value ?? DEFAULT_WORKFLOW_GUARD_ALLOWLIST;
  requirePlainRecord(source, "guard_allowlist");
  const normalized = Object.create(null);
  for (const [id, evaluator] of Object.entries(source)) {
    requireNonEmptyString(id, "guard_allowlist.id");
    if (typeof evaluator !== "function") throw new DomainValidationError(`Guard allowlist entry '${id}' must be a function`);
    normalized[id] = evaluator;
  }
  return normalized;
}

function validateDefinitionGraph(definition) {
  const stateIds = new Set(definition.states.map((state) => state.id));
  if (!stateIds.has(definition.initial_state)) throw new DomainValidationError("workflow_definition.initial_state must reference a declared state");
  if (!definition.states.some((state) => state.terminal)) throw new DomainValidationError("workflow_definition.states must include a terminal state");
  for (const transition of definition.transitions) {
    if (!stateIds.has(transition.from) || !stateIds.has(transition.to)) throw new DomainValidationError(`Transition '${transition.id}' references an unknown state`);
    if (transition.from === transition.to) throw new DomainValidationError(`Transition '${transition.id}' cannot be a self transition`);
    if (definition.states.find((state) => state.id === transition.from)?.terminal) throw new DomainValidationError(`Terminal state '${transition.from}' cannot have outgoing transitions`);
  }
  const routes = new Set();
  for (const transition of definition.transitions) {
    const route = `${transition.from}\u0000${transition.to}`;
    if (routes.has(route)) throw new DomainValidationError(`Workflow contains more than one transition for ${transition.from} -> ${transition.to}`);
    routes.add(route);
  }
  if (definition.phase_order.length > 0) {
    const phaseSet = new Set(definition.phase_order);
    if (phaseSet.size !== definition.phase_order.length) throw new DomainValidationError("workflow_definition.phase_order must not contain duplicates");
    for (const phase of definition.phase_order) {
      if (!stateIds.has(phase)) throw new DomainValidationError(`workflow_definition.phase_order references unknown state '${phase}'`);
    }
  }
  const reachable = new Set([definition.initial_state]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const transition of definition.transitions) if (reachable.has(transition.from) && !reachable.has(transition.to)) { reachable.add(transition.to); changed = true; }
  }
  const unreachable = definition.states.filter((state) => !reachable.has(state.id)).map((state) => state.id);
  if (unreachable.length) throw new DomainValidationError(`Workflow states are unreachable from initial_state: ${unreachable.join(", ")}`);
}

function normalizeDefinitionRef(value) {
  requirePlainRecord(value, "workflow_overlay.definition_ref");
  const ref = {
    id: requireNonEmptyString(value.id, "workflow_overlay.definition_ref.id"),
    version: normalizeVersion(value.version, "workflow_overlay.definition_ref.version"),
    definition_hash: requireHash(value.definition_hash ?? value.hash, "workflow_overlay.definition_ref.definition_hash"),
  };
  return ref;
}

function definitionRef(definition) { return { id: definition.id, version: definition.version, definition_hash: definition.definition_hash }; }
function overlayRef(overlay) { return { id: overlay.id, version: overlay.version, overlay_hash: overlay.overlay_hash }; }

function normalizeStateOverrides(value) {
  const source = value ?? [];
  if (!Array.isArray(source)) throw new DomainValidationError("workflow_overlay.state_overrides must be an array");
  return source.map((entry, index) => {
    requirePlainRecord(entry, `workflow_overlay.state_overrides[${index}]`);
    assertOnlyKeys(entry, ["state_id", "label", "metadata"], `workflow_overlay.state_overrides[${index}]`);
    return { state_id: requireNonEmptyString(entry.state_id, `workflow_overlay.state_overrides[${index}].state_id`), label: normalizeOptionalString(entry.label, `workflow_overlay.state_overrides[${index}].label`), metadata: normalizeJsonRecord(entry.metadata, `workflow_overlay.state_overrides[${index}].metadata`) };
  });
}

function normalizeTransitionOverrides(value) {
  const source = value ?? [];
  if (!Array.isArray(source)) throw new DomainValidationError("workflow_overlay.transition_overrides must be an array");
  return source.map((entry, index) => {
    requirePlainRecord(entry, `workflow_overlay.transition_overrides[${index}]`);
    assertOnlyKeys(entry, ["transition_id", "label", "metadata", "guard_parameters"], `workflow_overlay.transition_overrides[${index}]`);
    const parameters = entry.guard_parameters ?? [];
    if (!Array.isArray(parameters)) throw new DomainValidationError(`workflow_overlay.transition_overrides[${index}].guard_parameters must be an array`);
    return { transition_id: requireNonEmptyString(entry.transition_id, `workflow_overlay.transition_overrides[${index}].transition_id`), label: normalizeOptionalString(entry.label, `workflow_overlay.transition_overrides[${index}].label`), metadata: normalizeJsonRecord(entry.metadata, `workflow_overlay.transition_overrides[${index}].metadata`), guard_parameters: parameters.map((item, guardIndex) => { requirePlainRecord(item, `guard_parameters[${guardIndex}]`); assertOnlyKeys(item, ["guard_id", "parameters"], `guard_parameters[${guardIndex}]`); return { guard_id: requireNonEmptyString(item.guard_id, `guard_parameters[${guardIndex}].guard_id`), parameters: normalizeJsonRecord(item.parameters, `guard_parameters[${guardIndex}].parameters`) }; }) };
  });
}

function validateOverlayTargets(overlay, definition) {
  const ref = definitionRef(definition);
  if (JSON.stringify(overlay.definition_ref) !== JSON.stringify(ref)) throw new DomainValidationError("Workflow overlay definition_ref does not match the exact definition version and hash");
  const states = new Set(definition.states.map((state) => state.id));
  const transitions = new Map(definition.transitions.map((transition) => [transition.id, transition]));
  const seenStates = new Set();
  for (const override of overlay.state_overrides) {
    if (!states.has(override.state_id)) throw new DomainValidationError(`Overlay references unknown state '${override.state_id}'`);
    if (seenStates.has(override.state_id)) throw new DomainValidationError(`Overlay duplicates state '${override.state_id}'`);
    seenStates.add(override.state_id);
  }
  const seenTransitions = new Set();
  for (const override of overlay.transition_overrides) {
    const transition = transitions.get(override.transition_id);
    if (!transition) throw new DomainValidationError(`Overlay references unknown transition '${override.transition_id}'`);
    if (seenTransitions.has(override.transition_id)) throw new DomainValidationError(`Overlay duplicates transition '${override.transition_id}'`);
    seenTransitions.add(override.transition_id);
    const guards = new Set(transition.guards.map((guard) => guard.id));
    for (const parameter of override.guard_parameters) if (!guards.has(parameter.guard_id)) throw new DomainValidationError(`Overlay references unknown guard '${parameter.guard_id}' on transition '${transition.id}'`);
  }
}

function normalizeStatus(value) {
  const status = value ?? "proposed";
  if (!["proposed", "approved"].includes(status)) throw new DomainValidationError("Workflow lifecycle status must be proposed or approved");
  return status;
}

function validateLifecycle(status, approval, label) {
  if (status === "approved" && !approval) throw new DomainValidationError(`${label}.approval is required when approved`);
  if (status === "proposed" && approval) throw new DomainValidationError(`${label}.approval must be null while proposed`);
}

function normalizeApproval(value) {
  requirePlainRecord(value, "workflow_approval");
  return {
    id: normalizeOptionalString(value.id, "workflow_approval.id"),
    approved_at: normalizeIsoInstant(value.approved_at, "workflow_approval.approved_at"),
    approved_by: normalizeActor(value.approved_by ?? value.actor, "workflow_approval.approved_by"),
    approval_source: requireNonEmptyString(value.approval_source ?? "automation", "workflow_approval.approval_source"),
    summary: normalizeOptionalString(value.summary, "workflow_approval.summary"),
    evidence: normalizeJsonArray(value.evidence, "workflow_approval.evidence"),
    authorization_ref: normalizeOptionalString(value.authorization_ref, "workflow_approval.authorization_ref"),
    authorization_use_ref: normalizeOptionalString(value.authorization_use_ref, "workflow_approval.authorization_use_ref"),
  };
}

function approvalFromOptions(options) {
  if (options.approval) return options.approval;
  return { id: options.approval_id ?? null, approved_at: options.approved_at, approved_by: options.actor, approval_source: options.approval_source ?? "automation", summary: options.summary ?? null, evidence: options.evidence ?? [], authorization_ref: options.authorization_ref ?? null };
}

function normalizeActor(value, label) {
  requirePlainRecord(value, label);
  return { id: requireNonEmptyString(value.id, `${label}.id`), type: requireNonEmptyString(value.type, `${label}.type`), name: normalizeOptionalString(value.name, `${label}.name`) };
}

function assertApprovedOrProposedDefinition(definition, options) { assertDefinitionIntegrity(definition, options); }
function assertDefinitionIntegrity(definition, options) { const result = validateWorkflowDefinition(definition, options); if (!result.valid) throw new DomainValidationError("Workflow definition failed integrity validation", result.errors); }

function requireEffectiveDefinition(value) {
  requirePlainRecord(value, "effective_workflow_definition");
  if (value.kind === "workflow_definition" && value.schema_version === DEFINITION_SCHEMA) {
    return applyWorkflowOverlay(value, null);
  }
  if (value.kind !== "effective_workflow_definition" || value.schema_version !== EFFECTIVE_SCHEMA) throw new DomainValidationError("Unsupported effective workflow definition schema");
  const expected = computeEffectiveWorkflowHash(value);
  if (value.effective_hash !== expected) throw new DomainValidationError("effective_workflow_definition.effective_hash does not match its content");
  return value;
}

function validateInstance(value) {
  requirePlainRecord(value, "workflow_instance");
  if (value.kind !== "workflow_instance" || value.schema_version !== INSTANCE_SCHEMA) throw new DomainValidationError("Unsupported workflow instance schema");
  requireNonEmptyString(value.id, "workflow_instance.id");
  normalizeIsoInstant(value.created_at, "workflow_instance.created_at");
  if (value.instance_hash !== computeWorkflowInstanceHash(value)) throw new DomainValidationError("workflow_instance.instance_hash does not match its content");
  return value;
}

function assertInstancePins(instance, effective) {
  if (instance.effective_hash !== effective.effective_hash || JSON.stringify(instance.definition_ref) !== JSON.stringify(effective.definition_ref) || JSON.stringify(instance.overlay_ref) !== JSON.stringify(effective.overlay_ref)) throw new DomainValidationError("Workflow instance does not pin the supplied effective definition");
}

function mergeRecords(base, override) { return { ...(base ?? {}), ...(override ?? {}) }; }

function normalizeIdentifierList(value, label) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new DomainValidationError(`${label} must be an array`);
  const result = value.map((item, index) => requireNonEmptyString(item, `${label}[${index}]`));
  if (new Set(result).size !== result.length) throw new DomainValidationError(`${label} must not contain duplicates`);
  return result;
}

function replayProjection({ valid, errors, state, sequence, last_event_hash, updated_at, terminal, effective }) {
  const allowed = effective && state
    ? effective.transitions.filter((transition) => transition.from === state).map((transition) => ({
        id: transition.id,
        to: transition.to,
        label: transition.label,
      }))
    : [];
  return immutableJson({
    valid,
    integrity: valid ? "valid" : "invalid",
    errors,
    state,
    current_state: state,
    sequence,
    event_count: sequence,
    last_event_hash,
    updated_at,
    terminal,
    allowed_transitions: allowed,
  });
}

function normalizeJsonRecord(value, label) {
  if (value === undefined || value === null) return {};
  requirePlainRecord(value, label);
  return cloneJson(value);
}

function normalizeJsonArray(value, label) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new DomainValidationError(`${label} must be an array`);
  return cloneJson(value);
}

function normalizeVersion(value, label) {
  const version = String(value ?? "").trim();
  if (!/^[0-9][A-Za-z0-9._-]*$/u.test(version) || version.endsWith(".")) {
    throw new DomainValidationError(`${label} must be a portable version beginning with a number`);
  }
  return version;
}
function requireHash(value, label) { const hash = requireNonEmptyString(value, label); if (!SHA256.test(hash)) throw new DomainValidationError(`${label} must be a lowercase SHA-256 digest`); return hash; }
function withoutKeys(value, keys) { const excluded = new Set(keys); return Object.fromEntries(Object.entries(value).filter(([key, item]) => !excluded.has(key) && item !== undefined)); }
function assertOnlyKeys(value, allowed, label) { const accepted = new Set(allowed); const extras = Object.keys(value).filter((key) => !accepted.has(key)); if (extras.length) throw new DomainValidationError(`${label} contains unsupported fields: ${extras.join(", ")}`); }
function errorMessages(error) { if (error instanceof DomainValidationError && error.issues.length) return [error.message, ...error.issues.map((issue) => typeof issue === "string" ? issue : JSON.stringify(issue))]; return [error?.message ?? String(error)]; }
