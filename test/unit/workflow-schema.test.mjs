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
    story_id: "ST-SCHEMA",
    checked_at: AT,
    errors: [],
  }, {
    final_receipt_path: ".sdlc/gates/ST-SCHEMA-final.json",
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
    ["workflow-final-gate-receipt.schema.json", finalGateReceipt],
    ["workflow-transition-event.schema.json", transition.event],
    ["workflow-checkpoint.schema.json", checkpoint],
  ]) {
    const result = validate(schema, value);
    assert.equal(result.valid, true, `${schema}: ${JSON.stringify(result.errors)}`);
  }
});

test("workflow schemas reject structural additions to immutable records", () => {
  const definition = buildWorkflowPreset("software-project", { created_at: AT });
  const tampered = { ...definition, execute: "shell command" };
  const result = validate("workflow-definition.schema.json", tampered);

  assert.equal(result.valid, false);
  assert.ok(result.errors.some(({ keyword }) => keyword === "additionalProperties"));
});
