import test from "node:test";
import assert from "node:assert/strict";

import { applyWorkflowOverlay, validateWorkflowDefinition } from "../../lib/workflow-engine.mjs";
import {
  SOFTWARE_PROJECT_PHASES,
  buildWorkflowPreset,
  getWorkflowPreset,
  listWorkflowPresets,
} from "../../lib/workflow-presets.mjs";

const EXPECTED_PRESETS = [
  "software-project",
  "change-request",
  "technical-assessment",
  "generic-governed-process",
];

test("catalog exposes exactly the four governed presets", () => {
  assert.deepEqual(listWorkflowPresets().map(({ id }) => id), EXPECTED_PRESETS);
  assert.throws(() => getWorkflowPreset("unknown"), /Unknown workflow preset/u);
});

test("software-project preserves the exact six existing SDLC phases and order", () => {
  const preset = getWorkflowPreset("software-project");
  assert.deepEqual(SOFTWARE_PROJECT_PHASES, [
    "discovery", "analysis", "design", "implementation", "validation", "release",
  ]);
  assert.deepEqual(preset.states.map(({ id }) => id), SOFTWARE_PROJECT_PHASES);
  assert.equal(preset.initial_state, "discovery");
  assert.equal(preset.states.at(-1).terminal, true);
});

test("technical-assessment has exactly two normal approval checkpoints", () => {
  const preset = getWorkflowPreset("technical-assessment");
  const checkpointTransitions = preset.transitions.filter((transition) =>
    transition.guards.some((guard) => guard.id === "checkpoint-approved"));

  assert.equal(preset.metadata.workflow_kind, "technical_assessment");
  assert.equal(preset.metadata.normal_checkpoint_count, 2);
  assert.equal(checkpointTransitions.length, 2);
  assert.deepEqual(checkpointTransitions.map(({ guards }) => guards[0].parameters.checkpoint), ["context", "combined-proposal"]);
  assert.deepEqual(preset.normal_checkpoints, ["context", "combined-proposal"]);
  assert.deepEqual(preset.states.map(({ id }) => id), [
    "context_pending", "proposal_pending", "authorized", "running", "verifying", "completed",
    "exception_pending", "failed", "cancelled",
  ]);
});

test("every preset materializes as a deterministic approved immutable definition", () => {
  for (const id of EXPECTED_PRESETS) {
    const first = buildWorkflowPreset(id);
    const second = buildWorkflowPreset(id);
    assert.equal(first.status, "approved", id);
    assert.equal(first.definition_hash, second.definition_hash, id);
    assert.equal(validateWorkflowDefinition(first).valid, true, id);
    assert.equal(Object.isFrozen(first), true, id);
    const effective = applyWorkflowOverlay(first);
    assert.equal(effective.overlay_ref, null, id);
    assert.equal(effective.states.at(-1).terminal, true, id);
  }
});

test("preset templates are immutable and custom ids create a distinct definition identity", () => {
  const template = getWorkflowPreset("change-request");
  assert.equal(Object.isFrozen(template), true);
  assert.throws(() => template.states.push({}), TypeError);

  const builtIn = buildWorkflowPreset("change-request");
  const customized = buildWorkflowPreset("change-request", { id: "travel-change-request" });
  assert.notEqual(customized.definition_hash, builtIn.definition_hash);
  assert.equal(customized.id, "travel-change-request");
  assert.deepEqual(customized.states.map(({ id }) => id), builtIn.states.map(({ id }) => id));
});
