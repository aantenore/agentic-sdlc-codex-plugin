import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_WORKFLOW_GUARD_ALLOWLIST,
  allowedWorkflowTransitions,
  applyWorkflowOverlay,
  approveWorkflowDefinition,
  approveWorkflowOverlay,
  buildWorkflowDefinition,
  buildWorkflowOverlay,
  computeWorkflowDefinitionHash,
  createWorkflowInstance,
  createWorkflowTransition,
  evaluateWorkflowGuards,
  explainWorkflowConfiguration,
  replayWorkflowEvents,
  validateWorkflowDefinition,
  validateWorkflowOverlay,
} from "../../lib/workflow-engine.mjs";

const CREATED_AT = "2026-07-18T08:00:00.000Z";
const ACTOR = Object.freeze({ id: "codex", type: "agent", name: "Codex" });

function definitionInput(overrides = {}) {
  return {
    id: "travel-change",
    version: 1,
    label: "Travel change",
    description: "A small governed workflow.",
    initial_state: "intake",
    states: [
      { id: "intake", label: "Intake", terminal: false, metadata: { order: 1 } },
      { id: "review", label: "Review", terminal: false, metadata: { order: 2 } },
      { id: "completed", label: "Completed", terminal: true, metadata: { order: 3 } },
    ],
    transitions: [
      {
        id: "submit",
        from: "intake",
        to: "review",
        label: "Submit",
        guards: [{ id: "context-present", parameters: { key: "ticket" } }],
        metadata: {},
      },
      {
        id: "approve",
        from: "review",
        to: "completed",
        label: "Approve",
        guards: [{ id: "context-equals", parameters: { key: "approved", value: true } }],
        metadata: {},
      },
    ],
    metadata: { owner: "travel" },
    created_at: CREATED_AT,
    ...overrides,
  };
}

function approvalOptions(overrides = {}) {
  return {
    approved_at: "2026-07-18T08:01:00.000Z",
    actor: ACTOR,
    approval_source: "automation",
    authorization_ref: "AUTH-001",
    summary: "Exact workflow content approved.",
    evidence: [{ id: "receipt-1" }],
    ...overrides,
  };
}

function approvedDefinition() {
  return approveWorkflowDefinition(buildWorkflowDefinition(definitionInput()), approvalOptions());
}

function overlayInput(definition, overrides = {}) {
  return {
    id: "travel-change-it",
    version: 1,
    definition_ref: {
      id: definition.id,
      version: definition.version,
      definition_hash: definition.definition_hash,
    },
    label: "Modifica viaggio",
    description: null,
    metadata: { locale: "it" },
    state_overrides: [{ state_id: "review", label: "Revisione", metadata: { audience: "business" } }],
    transition_overrides: [{
      transition_id: "approve",
      label: "Conferma",
      metadata: { explained: true },
      guard_parameters: [{ guard_id: "context-equals", parameters: { key: "accepted", value: true } }],
    }],
    created_at: "2026-07-18T08:02:00.000Z",
    ...overrides,
  };
}

function runtime() {
  const definition = approvedDefinition();
  const overlay = approveWorkflowOverlay(
    buildWorkflowOverlay(overlayInput(definition), { definition }),
    { ...approvalOptions(), approved_at: "2026-07-18T08:03:00.000Z", definition },
  );
  const effective = applyWorkflowOverlay(definition, overlay);
  const instance = createWorkflowInstance({
    id: "workflow-001",
    effective_definition: effective,
    created_at: "2026-07-18T08:04:00.000Z",
    actor: ACTOR,
    metadata: { ticket: "TRAVEL-42" },
  });
  return { definition, overlay, effective, instance };
}

test("workflow definition hashing is deterministic, canonical, and deeply immutable", () => {
  const first = buildWorkflowDefinition(definitionInput());
  const reordered = buildWorkflowDefinition(definitionInput({
    metadata: { owner: "travel" },
    states: definitionInput().states.map(({ id, label, terminal, metadata }) => ({ metadata, terminal, label, id })),
  }));

  assert.equal(first.definition_hash, reordered.definition_hash);
  assert.equal(first.definition_hash, computeWorkflowDefinitionHash(first));
  assert.equal(validateWorkflowDefinition(first).valid, true);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.states[0].metadata), true);
  assert.throws(() => first.states.push({}), TypeError);
});

test("definition validation rejects unknown topology, unreachable states, duplicate ids, and executable fields", () => {
  assert.throws(
    () => buildWorkflowDefinition(definitionInput({
      transitions: [{ id: "bad", from: "missing", to: "completed", guards: [] }],
    })),
    /unknown state|unreachable/u,
  );
  assert.throws(
    () => buildWorkflowDefinition(definitionInput({
      states: [...definitionInput().states, { id: "orphan", terminal: false }],
    })),
    /unreachable/u,
  );
  assert.throws(
    () => buildWorkflowDefinition(definitionInput({
      states: [definitionInput().states[0], definitionInput().states[0]],
    })),
    /Duplicate workflow state/u,
  );
  assert.throws(
    () => buildWorkflowDefinition({ ...definitionInput(), execute: "shell command" }),
    /unsupported fields/u,
  );
});

test("only explicitly allowlisted declarative guards are accepted", () => {
  const unknown = definitionInput();
  unknown.transitions[0].guards = [{ id: "dynamic-import", parameters: { module: "unsafe.mjs" } }];
  assert.throws(() => buildWorkflowDefinition(unknown), /not allowlisted/u);

  const customAllowlist = {
    ...DEFAULT_WORKFLOW_GUARD_ALLOWLIST,
    "minimum-score": ({ parameters, context }) => ({
      allowed: context.score >= parameters.minimum,
      reason: "minimum score",
    }),
  };
  const result = evaluateWorkflowGuards(
    [{ id: "minimum-score", parameters: { minimum: 8 } }],
    { score: 9 },
    customAllowlist,
  );
  assert.equal(result.allowed, true);
  assert.equal(result.results[0].guard_id, "minimum-score");
});

test("approval binds governance evidence without changing material definition identity", () => {
  const proposed = buildWorkflowDefinition(definitionInput());
  const approved = approveWorkflowDefinition(proposed, approvalOptions());

  assert.equal(proposed.status, "proposed");
  assert.equal(proposed.approval, null);
  assert.equal(approved.status, "approved");
  assert.equal(approved.definition_hash, proposed.definition_hash);
  assert.equal(approved.approval.authorization_ref, "AUTH-001");
  assert.deepEqual(approved.approval.evidence, [{ id: "receipt-1" }]);
  assert.equal(validateWorkflowDefinition(approved).valid, true);
});

test("overlay is hash-bound and can change presentation and guard parameters only", () => {
  const definition = approvedDefinition();
  const proposed = buildWorkflowOverlay(overlayInput(definition), { definition });
  assert.throws(() => applyWorkflowOverlay(definition, proposed), /must be approved/u);
  const preview = applyWorkflowOverlay(definition, proposed, { allow_proposed: true });
  const approved = approveWorkflowOverlay(proposed, { ...approvalOptions(), definition });
  const effective = applyWorkflowOverlay(definition, approved);

  assert.equal(preview.effective_hash, effective.effective_hash);
  assert.equal(validateWorkflowOverlay(approved, { definition }).valid, true);
  assert.equal(proposed.overlay_hash, approved.overlay_hash);
  assert.equal(effective.label, "Modifica viaggio");
  assert.equal(effective.initial_state, definition.initial_state);
  assert.deepEqual(effective.states.map(({ id }) => id), definition.states.map(({ id }) => id));
  assert.deepEqual(
    effective.transitions.map(({ id, from, to }) => ({ id, from, to })),
    definition.transitions.map(({ id, from, to }) => ({ id, from, to })),
  );
  assert.equal(effective.states[1].label, "Revisione");
  assert.deepEqual(effective.transitions[1].guards[0].parameters, { key: "accepted", value: true });
  assert.equal(Object.isFrozen(effective), true);
});

test("overlay refuses stale references, unknown targets, and structural rewrites", () => {
  const definition = approvedDefinition();
  assert.throws(
    () => buildWorkflowOverlay(overlayInput(definition, {
      definition_ref: { id: definition.id, version: definition.version, definition_hash: "f".repeat(64) },
    }), { definition }),
    /does not match/u,
  );
  assert.throws(
    () => buildWorkflowOverlay(overlayInput(definition, {
      state_overrides: [{ state_id: "missing", label: "Missing" }],
    }), { definition }),
    /unknown state/u,
  );
  assert.throws(
    () => buildWorkflowOverlay({ ...overlayInput(definition), initial_state: "completed" }, { definition }),
    /unsupported fields/u,
  );
  assert.throws(
    () => buildWorkflowOverlay({ ...overlayInput(definition), history: [] }, { definition }),
    /unsupported fields/u,
  );
});

test("instance header pins definition, overlay, and effective hashes and stays immutable", () => {
  const { definition, overlay, effective, instance } = runtime();
  assert.deepEqual(instance.definition_ref, {
    id: definition.id,
    version: definition.version,
    definition_hash: definition.definition_hash,
  });
  assert.deepEqual(instance.overlay_ref, {
    id: overlay.id,
    version: overlay.version,
    overlay_hash: overlay.overlay_hash,
  });
  assert.equal(instance.effective_hash, effective.effective_hash);
  assert.equal(Object.isFrozen(instance), true);
  assert.throws(() => { instance.initial_state = "completed"; }, TypeError);
});

test("transition applies guards, chronology, idempotency, and optimistic sequence control", () => {
  const { effective, instance } = runtime();
  const base = {
    instance,
    effective_definition: effective,
    events: [],
    to: "review",
    timestamp: "2026-07-18T08:05:00.000Z",
    actor: ACTOR,
    idempotency_key: "request-1",
    context: { ticket: "TRAVEL-42" },
  };
  const first = createWorkflowTransition(base);
  assert.equal(first.idempotent, false);
  assert.equal(first.replay.valid, true);
  assert.equal(first.event.sequence, 1);
  assert.equal(first.event.previous_hash, null);

  const duplicate = createWorkflowTransition({ ...base, events: [first.event] });
  assert.equal(duplicate.idempotent, true);
  assert.equal(duplicate.replay.valid, true);
  assert.equal(duplicate.event.event_hash, first.event.event_hash);

  assert.throws(
    () => createWorkflowTransition({ ...base, events: [first.event], idempotency_key: "request-2", to: "completed", context: { accepted: false }, timestamp: "2026-07-18T08:06:00.000Z" }),
    /guards denied/u,
  );
  assert.throws(
    () => createWorkflowTransition({ ...base, expected_sequence: 7 }),
    /sequence conflict/u,
  );
  assert.throws(
    () => createWorkflowTransition({ ...base, timestamp: "2026-07-18T08:03:00.000Z" }),
    /earlier/u,
  );
});

test("replay reconstructs state and detects tamper, deletion, reorder, and duplicate idempotency", () => {
  const { effective, instance } = runtime();
  const first = createWorkflowTransition({
    instance,
    effective_definition: effective,
    events: [],
    to: "review",
    timestamp: "2026-07-18T08:05:00.000Z",
    actor: ACTOR,
    idempotency_key: "request-1",
    context: { ticket: "TRAVEL-42" },
  }).event;
  const second = createWorkflowTransition({
    instance,
    effective_definition: effective,
    events: [first],
    to: "completed",
    timestamp: "2026-07-18T08:06:00.000Z",
    actor: ACTOR,
    idempotency_key: "request-2",
    context: { accepted: true },
  }).event;
  const checkpoint = { sequence: 2, last_event_hash: second.event_hash, state: "completed" };
  const valid = replayWorkflowEvents({ instance, effective_definition: effective, events: [first, second], checkpoint });
  assert.equal(valid.valid, true);
  assert.equal(valid.state, "completed");
  assert.equal(valid.terminal, true);

  const tampered = structuredClone(second);
  tampered.to = "review";
  assert.equal(replayWorkflowEvents({ instance, effective_definition: effective, events: [first, tampered] }).valid, false);
  assert.match(replayWorkflowEvents({ instance, effective_definition: effective, events: [first], checkpoint }).errors.join("\n"), /truncated/u);
  assert.equal(replayWorkflowEvents({ instance, effective_definition: effective, events: [second, first] }).valid, false);
  const duplicate = structuredClone(second);
  duplicate.idempotency_key = first.idempotency_key;
  assert.match(replayWorkflowEvents({ instance, effective_definition: effective, events: [first, duplicate] }).errors.join("\n"), /duplicates idempotency/u);
});

test("status and explanation expose exact pinned configuration without executable behavior", () => {
  const { effective } = runtime();
  assert.deepEqual(allowedWorkflowTransitions(effective, "intake").map(({ to }) => to), ["review"]);
  const explanation = explainWorkflowConfiguration(effective);
  assert.equal(explanation.effective_hash, effective.effective_hash);
  assert.deepEqual(explanation.phase_order, []);
  assert.deepEqual(explanation.normal_checkpoints, []);
  assert.deepEqual(explanation.guard_ids, ["context-equals", "context-present"]);
});
