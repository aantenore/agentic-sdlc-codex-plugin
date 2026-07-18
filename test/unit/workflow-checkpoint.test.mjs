import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateAgainstSchema } from "../../lib/json-schema-validator.mjs";
import {
  applyWorkflowOverlay,
  computeWorkflowCheckpointHash,
  createWorkflowCheckpoint,
  createWorkflowInstance,
  createWorkflowTransition,
  replayWorkflowEvents,
  validateWorkflowCheckpoint,
} from "../../lib/workflow-engine.mjs";
import { buildWorkflowPreset } from "../../lib/workflow-presets.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CREATED_AT = "2026-07-18T10:00:00.000Z";
const EVENT_AT = "2026-07-18T10:01:00.000Z";
const ACTOR = Object.freeze({ id: "checkpoint-test", type: "agent", name: "Checkpoint test" });
const INITIAL_TRACE_CHAIN = "1".repeat(64);
const ADVANCED_TRACE_CHAIN = "2".repeat(64);

function runtime(id = "checkpoint-instance") {
  const definition = buildWorkflowPreset("software-project", { created_at: CREATED_AT });
  const effective = applyWorkflowOverlay(definition);
  const instance = createWorkflowInstance({
    id,
    effective_definition: effective,
    created_at: CREATED_AT,
    actor: ACTOR,
  });
  return { effective, instance };
}

function rehash(checkpoint, overrides) {
  const candidate = { ...checkpoint, ...overrides };
  return { ...candidate, checkpoint_hash: computeWorkflowCheckpointHash(candidate) };
}

function createCheckpoint(input, traceChainHash = INITIAL_TRACE_CHAIN) {
  return createWorkflowCheckpoint({ ...input, trace_chain_hash: traceChainHash });
}

function assertFailClosed(projection) {
  assert.equal(projection.valid, false);
  assert.equal(projection.state, null);
  assert.equal(projection.current_state, null);
  assert.equal(projection.sequence, null);
  assert.equal(projection.event_count, null);
  assert.equal(projection.last_event_hash, null);
  assert.equal(projection.updated_at, null);
  assert.equal(projection.terminal, false);
  assert.deepEqual(projection.allowed_transitions, []);
  assert.equal(projection.diagnostics.operational, false);
}

test("durable checkpoint pins the instance, effective definition and exact verified tail", () => {
  const { effective, instance } = runtime();
  const initial = createCheckpoint({ instance, effective_definition: effective, events: [] });

  assert.deepEqual(initial, {
    kind: "workflow_checkpoint",
    schema_version: "workflow-checkpoint:v1",
    instance_id: instance.id,
    instance_hash: instance.instance_hash,
    effective_hash: effective.effective_hash,
    sequence: 0,
    last_event_hash: null,
    current_state: instance.initial_state,
    updated_at: instance.created_at,
    trace_chain_hash: INITIAL_TRACE_CHAIN,
    checkpoint_hash: initial.checkpoint_hash,
    hash_algorithm: "sha256:stable-json:v1",
  });
  assert.equal(initial.checkpoint_hash, computeWorkflowCheckpointHash(initial));
  assert.equal(Object.isFrozen(initial), true);
  assert.equal(validateWorkflowCheckpoint(initial, { instance, effective_definition: effective, events: [] }).valid, true);

  const schema = validateAgainstSchema(initial, "workflow-checkpoint.schema.json", {
    schemaDir: path.join(ROOT, "schemas"),
  });
  assert.equal(schema.valid, true, JSON.stringify(schema.errors));
});

test("protected replay and transition fail closed without the durable checkpoint", () => {
  const { effective, instance } = runtime();
  const missing = replayWorkflowEvents(
    { instance, effective_definition: effective, events: [] },
    { require_checkpoint: true },
  );
  assertFailClosed(missing);
  assert.match(missing.errors.join("\n"), /durable workflow checkpoint is required/u);

  const legacy = { sequence: 0, last_event_hash: null, state: instance.initial_state };
  assert.equal(replayWorkflowEvents({ instance, effective_definition: effective, events: [], checkpoint: legacy }).valid, true);
  const protectedLegacy = replayWorkflowEvents(
    { instance, effective_definition: effective, events: [], checkpoint: legacy },
    { require_checkpoint: true },
  );
  assertFailClosed(protectedLegacy);
  assert.match(protectedLegacy.errors.join("\n"), /durable workflow checkpoint schema/u);

  assert.throws(
    () => createWorkflowTransition({
      instance,
      effective_definition: effective,
      events: [],
      to: "analysis",
      timestamp: EVENT_AT,
      actor: ACTOR,
      idempotency_key: "missing-checkpoint",
    }, { require_checkpoint: true }),
    /event stream failed integrity validation/u,
  );
});

test("invalid event replay never exposes partially verified state as operational", () => {
  const { effective, instance } = runtime();
  const first = createWorkflowTransition({
    instance,
    effective_definition: effective,
    events: [],
    to: "analysis",
    timestamp: EVENT_AT,
    actor: ACTOR,
    idempotency_key: "adversarial-first",
  }).event;
  const second = createWorkflowTransition({
    instance,
    effective_definition: effective,
    events: [first],
    to: "design",
    timestamp: "2026-07-18T10:02:00.000Z",
    actor: ACTOR,
    idempotency_key: "adversarial-second",
  }).event;
  const tampered = { ...second, event_hash: "f".repeat(64) };

  const replay = replayWorkflowEvents({ instance, effective_definition: effective, events: [first, tampered] });
  assertFailClosed(replay);
  assert.match(replay.errors.join("\n"), /event_hash does not match/u);
  assert.equal(replay.diagnostics.last_verified_state, "analysis");
  assert.equal(replay.diagnostics.last_verified_sequence, 1);
  assert.equal(replay.diagnostics.last_verified_event_hash, first.event_hash);
  assert.equal(replay.diagnostics.last_verified_at, EVENT_AT);
  assert.equal(replay.diagnostics.observed_event_count, 2);
});

test("checkpoint advances with the event and detects both truncated and uncheckpointed tails", () => {
  const { effective, instance } = runtime();
  const initial = createCheckpoint({ instance, effective_definition: effective, events: [] });
  const transition = createWorkflowTransition({
    instance,
    effective_definition: effective,
    events: [],
    checkpoint: initial,
    to: "analysis",
    timestamp: EVENT_AT,
    actor: ACTOR,
    idempotency_key: "advance-checkpoint",
  }, { require_checkpoint: true });
  const advanced = createCheckpoint({
    instance,
    effective_definition: effective,
    events: [transition.event],
  }, ADVANCED_TRACE_CHAIN);

  assert.equal(advanced.sequence, 1);
  assert.equal(advanced.last_event_hash, transition.event.event_hash);
  assert.equal(advanced.current_state, "analysis");
  assert.equal(advanced.updated_at, EVENT_AT);
  const validReplay = replayWorkflowEvents({
    instance,
    effective_definition: effective,
    events: [transition.event],
    checkpoint: advanced,
  }, { require_checkpoint: true });
  assert.equal(validReplay.valid, true);
  assert.equal(validReplay.diagnostics.operational, true);

  const truncated = replayWorkflowEvents({
    instance,
    effective_definition: effective,
    events: [],
    checkpoint: advanced,
  }, { require_checkpoint: true });
  assertFailClosed(truncated);
  assert.match(truncated.errors.join("\n"), /truncated or has uncheckpointed events/u);

  const uncheckpointed = replayWorkflowEvents({
    instance,
    effective_definition: effective,
    events: [transition.event],
    checkpoint: initial,
  }, { require_checkpoint: true });
  assertFailClosed(uncheckpointed);
  assert.match(uncheckpointed.errors.join("\n"), /truncated or has uncheckpointed events/u);
});

test("checkpoint schema binds an empty stream to null and a non-empty stream to an event hash", () => {
  const { effective, instance } = runtime();
  const initial = createCheckpoint({ instance, effective_definition: effective, events: [] });
  const event = createWorkflowTransition({
    instance,
    effective_definition: effective,
    events: [],
    to: "analysis",
    timestamp: EVENT_AT,
    actor: ACTOR,
    idempotency_key: "schema-checkpoint-tail",
  }).event;
  const advanced = createCheckpoint(
    { instance, effective_definition: effective, events: [event] },
    ADVANCED_TRACE_CHAIN,
  );
  const schemaOptions = { schemaDir: path.join(ROOT, "schemas") };

  for (const invalid of [
    rehash(initial, { last_event_hash: "a".repeat(64) }),
    rehash(advanced, { last_event_hash: null }),
    { sequence: 0, last_event_hash: "b".repeat(64), state: "discovery" },
    { sequence: 1, last_event_hash: null, state: "analysis" },
  ]) {
    const result = validateAgainstSchema(invalid, "workflow-checkpoint.schema.json", schemaOptions);
    assert.equal(result.valid, false, JSON.stringify(invalid));
  }
});

test("checkpoint validation rejects rehashed pin, state, time and stream-tail substitutions", () => {
  const { effective, instance } = runtime();
  const event = createWorkflowTransition({
    instance,
    effective_definition: effective,
    events: [],
    to: "analysis",
    timestamp: EVENT_AT,
    actor: ACTOR,
    idempotency_key: "tamper-checkpoint",
  }).event;
  const checkpoint = createCheckpoint(
    { instance, effective_definition: effective, events: [event] },
    ADVANCED_TRACE_CHAIN,
  );
  const cases = [
    rehash(checkpoint, { instance_id: "another-instance" }),
    rehash(checkpoint, { instance_hash: "a".repeat(64) }),
    rehash(checkpoint, { effective_hash: "b".repeat(64) }),
    rehash(checkpoint, { sequence: 2 }),
    rehash(checkpoint, { last_event_hash: "c".repeat(64) }),
    rehash(checkpoint, { current_state: "release" }),
    rehash(checkpoint, { updated_at: "2026-07-18T10:02:00.000Z" }),
  ];

  for (const candidate of cases) {
    const validation = validateWorkflowCheckpoint(candidate, {
      instance,
      effective_definition: effective,
      events: [event],
    });
    assert.equal(validation.valid, false, JSON.stringify(candidate));
  }

  const contentTamper = { ...checkpoint, current_state: "release" };
  const integrity = validateWorkflowCheckpoint(contentTamper, { instance, effective_definition: effective, events: [event] });
  assert.equal(integrity.valid, false);
  assert.match(integrity.errors.join("\n"), /checkpoint_hash does not match/u);
});
