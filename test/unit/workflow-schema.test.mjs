import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateAgainstSchema } from "../../lib/json-schema-validator.mjs";
import { STABLE_JSON_HASH_ALGORITHM } from "../../lib/canonical.mjs";
import {
  applyWorkflowOverlay,
  approveWorkflowOverlay,
  buildWorkflowOverlay,
  createWorkflowInstance,
  createWorkflowTransition,
} from "../../lib/workflow-engine.mjs";
import {
  WORKFLOW_CANONICAL_EVIDENCE_SCHEMA,
  buildWorkflowFinalGateReceipt,
  buildWorkflowStrictGateReceipt,
  computeWorkflowCanonicalEvidenceHash,
} from "../../lib/workflow-canonical-evidence.mjs";
import { buildWorkflowPreset } from "../../lib/workflow-presets.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SCHEMA_DIR = path.join(ROOT, "schemas");
const AT = "2026-07-18T09:00:00.000Z";
const ACTOR = Object.freeze({ id: "schema-test", type: "agent", name: "Schema test" });

function validate(schema, value) {
  return validateAgainstSchema(value, schema, { schemaDir: SCHEMA_DIR });
}

test("workflow domain records conform to their published JSON schemas", () => {
  const definition = buildWorkflowPreset("software-project", { created_at: AT });
  const proposedOverlay = buildWorkflowOverlay({
    id: "software-project-it",
    version: "1",
    definition_ref: {
      id: definition.id,
      version: definition.version,
      definition_hash: definition.definition_hash,
    },
    label: "Progetto software",
    state_overrides: [{ state_id: "analysis", label: "Analisi" }],
    created_at: AT,
  }, { definition });
  const overlay = approveWorkflowOverlay(proposedOverlay, {
    definition,
    approved_at: AT,
    actor: ACTOR,
    approval_source: "test",
    authorization_ref: "AUTH-SCHEMA-001",
  });
  const effective = applyWorkflowOverlay(definition, overlay);
  const instance = createWorkflowInstance({
    id: "schema-instance",
    effective_definition: effective,
    created_at: AT,
    actor: ACTOR,
    metadata: { governance_binding: { story_id: "ST-SCHEMA" } },
  });
  const evidenceSubject = {
    kind: "workflow_canonical_evidence",
    schema_version: WORKFLOW_CANONICAL_EVIDENCE_SCHEMA,
    instance_id: instance.id,
    story_id: "ST-SCHEMA",
    observed_at: AT,
    checks: Object.fromEntries([
      "requirement_approved",
      "contract_approved",
      "required_output_linked",
      "strict_gate_passed",
      "delivery_terminal",
    ].map((id) => [id, { satisfied: true, issues: [] }])),
    hash_algorithm: STABLE_JSON_HASH_ALGORITHM,
  };
  const canonicalEvidence = {
    ...evidenceSubject,
    evidence_hash: computeWorkflowCanonicalEvidenceHash(evidenceSubject),
  };
  const finalGateReceipt = buildWorkflowFinalGateReceipt({
    status: "passed",
    strict: true,
    scope: "story",
    lifecycle_complete: true,
    certification_level: "lifecycle_complete",
    lifecycle_workflow: {
      selection_policy: "latest-created-at-then-instance-id:v1",
      story_id: "ST-SCHEMA",
      instance_id: instance.id,
      instance_hash: instance.instance_hash,
      effective_hash: effective.effective_hash,
      checkpoint_ref: {
        path: ".sdlc/workflows/instances/schema-instance/checkpoint.json",
        checkpoint_hash: "1".repeat(64),
        sequence: 1,
        last_event_hash: "2".repeat(64),
        trace_chain_hash: "3".repeat(64),
      },
      terminal_state: "release",
      terminal_event_ref: {
        event_hash: "2".repeat(64),
        sequence: 1,
        timestamp: AT,
      },
      event_count: 1,
      task_start_ref: {
        id: "START-ST-SCHEMA",
        path: ".sdlc/stories/ST-SCHEMA/task-start.json",
        hash: "4".repeat(64),
        confirmed_at: AT,
      },
      phase_timeline: [
        {
          phase: "discovery",
          entered_at: AT,
          entry_event_hash: null,
          completed_at: AT,
          completion_record_id: "STEP-ST-SCHEMA-discovery",
        },
        ...["analysis", "design", "implementation", "validation", "release"].map((phase) => ({
          phase,
          entered_at: AT,
          entry_event_hash: "2".repeat(64),
          completed_at: AT,
          completion_record_id: `STEP-ST-SCHEMA-${phase}`,
        })),
      ],
      release_trace_at: AT,
      delivery_closed_at: AT,
    },
    story_id: "ST-SCHEMA",
    checked_at: AT,
    errors: [],
  }, {
    final_receipt_path: ".sdlc/gates/ST-SCHEMA-final.json",
  });
  const strictGateReceipt = buildWorkflowStrictGateReceipt({
    status: "passed",
    strict: true,
    scope: "story",
    lifecycle_complete: false,
    certification_level: "strict_intermediate",
    story_id: "ST-SCHEMA",
    checked_at: AT,
    errors: [],
  }, {
    strict_receipt_path: ".sdlc/gates/ST-SCHEMA-strict.json",
  });
  const transition = createWorkflowTransition({
    instance,
    effective_definition: effective,
    events: [],
    to: "analysis",
    timestamp: AT,
    actor: ACTOR,
    idempotency_key: "schema-transition-1",
  }, { canonical_evidence: canonicalEvidence });
  const checkpoint = {
    sequence: transition.event.sequence,
    last_event_hash: transition.event.event_hash,
    state: transition.replay.current_state,
  };

  for (const [schema, value] of [
    ["workflow-definition.schema.json", definition],
    ["workflow-overlay.schema.json", overlay],
    ["workflow-effective-definition.schema.json", effective],
    ["workflow-instance.schema.json", instance],
    ["workflow-canonical-evidence.schema.json", canonicalEvidence],
    ["workflow-strict-gate-receipt.schema.json", strictGateReceipt],
    ["workflow-final-gate-receipt.schema.json", finalGateReceipt],
    ["workflow-transition-event.schema.json", transition.event],
    ["workflow-checkpoint.schema.json", checkpoint],
  ]) {
    const result = validate(schema, value);
    assert.equal(result.valid, true, `${schema}: ${JSON.stringify(result.errors)}`);
  }

  const legacyFinalGateReceipt = {
    kind: "workflow_final_gate_receipt",
    schema_version: "workflow-final-gate-receipt:v1",
    status: "passed",
    strict: true,
    scope: "story",
    story_id: "ST-SCHEMA",
    checked_at: AT,
    errors: [],
    final_receipt_path: ".sdlc/gates/ST-SCHEMA-final.json",
    hash_algorithm: STABLE_JSON_HASH_ALGORITHM,
    receipt_hash: "4".repeat(64),
  };
  assert.equal(
    validate("workflow-final-gate-receipt-v1.schema.json", legacyFinalGateReceipt).valid,
    true,
  );

  const incompleteFinalGateReceipt = structuredClone(finalGateReceipt);
  delete incompleteFinalGateReceipt.lifecycle_workflow.checkpoint_ref.trace_chain_hash;
  assert.equal(
    validate("workflow-final-gate-receipt.schema.json", incompleteFinalGateReceipt).valid,
    false,
  );
});

test("workflow schemas reject structural additions to immutable records", () => {
  const definition = buildWorkflowPreset("software-project", { created_at: AT });
  const tampered = { ...definition, execute: "shell command" };
  const result = validate("workflow-definition.schema.json", tampered);

  assert.equal(result.valid, false);
  assert.ok(result.errors.some(({ keyword }) => keyword === "additionalProperties"));
});
