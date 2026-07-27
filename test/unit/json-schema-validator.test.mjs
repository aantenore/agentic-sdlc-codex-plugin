import assert from "node:assert/strict";
import test from "node:test";

import { validateAgainstSchema } from "../../lib/json-schema-validator.mjs";

test("propertyNames rejects invalid execution-budget metric names", () => {
  const budget = {
    kind: "execution_budget",
    schema_version: "execution-budget:v1",
    budget_id: "budget-property-names",
    scope: { kind: "story", id: "ST-1" },
    limits: {
      "invalid metric": {
        unit: "count",
        hard_limit: "10",
      },
    },
    warning_thresholds_percent: [70, 90],
    completion_reserve_percent: 15,
    limit_policy: {
      on_warning: "continue",
      on_soft_limit: "checkpoint",
      on_hard_limit: "stop",
      on_metering_violation: "stop",
    },
    extensions: {},
    budget_hash: "0".repeat(64),
    hash_algorithm: "sha256:stable-json:v1",
  };

  const result = validateAgainstSchema(budget, "execution-budget.schema.json");
  assert.equal(result.valid, false);
  assert.equal(result.errors.some((error) => error.keyword === "pattern"), true);
});

test("date-time validation rejects normalized impossible dates and invalid clock fields", () => {
  const event = workflowEvent("2026-02-31T12:00:00Z");
  assert.equal(validateEvent(event).valid, false);
  assert.equal(validateEvent(workflowEvent("2026-01-01T24:00:00Z")).valid, false);
  assert.equal(validateEvent(workflowEvent("2026-01-01T12:60:00Z")).valid, false);
  assert.equal(validateEvent(workflowEvent("2026-01-01T12:00:00+24:00")).valid, false);
});

test("date-time validation accepts real leap days only", () => {
  assert.equal(validateEvent(workflowEvent("2024-02-29T23:59:59.123+01:30")).valid, true);
  assert.equal(validateEvent(workflowEvent("2025-02-29T23:59:59Z")).valid, false);
  assert.equal(validateEvent(workflowEvent("2100-02-29T23:59:59Z")).valid, false);
  assert.equal(validateEvent(workflowEvent("2000-02-29T23:59:59Z")).valid, true);
});

function validateEvent(event) {
  return validateAgainstSchema(event, "workflow-transition-event.schema.json");
}

function workflowEvent(timestamp) {
  return {
    kind: "workflow_transition_event",
    schema_version: "workflow-transition-event:v1",
    instance_id: "workflow-date-validation",
    instance_hash: "0".repeat(64),
    effective_hash: "1".repeat(64),
    sequence: 1,
    previous_hash: null,
    transition_id: "start",
    from: "intake",
    to: "analysis",
    timestamp,
    actor: {
      id: "validator-test",
      type: "agent",
      name: "Validator test",
    },
    idempotency_key: "date-validation",
    context_hash: "2".repeat(64),
    guard_results: [],
    hash_algorithm: "sha256:stable-json:v1",
    event_hash: "3".repeat(64),
  };
}
