import test from "node:test";
import assert from "node:assert/strict";

import {
  buildContextOptimizationObservation,
  buildContextOptimizationLineageDelta,
  optimizationBudgetAdvisory,
  validateContextOptimizationLineage,
  validateContextOptimizationObservation,
} from "../../lib/context-optimization.mjs";
import { computeStableHash } from "../../lib/canonical.mjs";
import { assertAgainstSchema } from "../../lib/json-schema-validator.mjs";

const PROPOSAL_HASH = "a".repeat(64);
const PROJECT_SCOPE_HASH = "b".repeat(64);
const OTHER_SCOPE_HASH = "c".repeat(64);

function telemetry(overrides = {}) {
  const savings = overrides.savings || {};
  return {
    provider: "rtk",
    status: "operational",
    detection: {
      available: true,
      supported: true,
      version: overrides.version || "0.43.0",
      gain_contract: "rtk-gain:v0.43+",
    },
    classification: "estimated",
    enforcement: "advisory",
    trusted_exact: false,
    scope: "project_cumulative",
    usage_credit_tokens: 0,
    source: {
      command: ["rtk", "gain", "--project", "--format", "json"],
      shell: false,
      report_hash: "e".repeat(64),
    },
    savings: {
      total_commands: 10,
      estimated_input_tokens: 1_000,
      estimated_output_tokens: 200,
      estimated_tokens_avoided: 800,
      estimated_savings_percent: 80,
      ...savings,
    },
  };
}

function observation(id, input = {}) {
  return buildContextOptimizationObservation({
    id,
    execution_id: input.execution_id || "ASSESS-RTK",
    proposal_hash: input.proposal_hash || PROPOSAL_HASH,
    phase: input.phase || "checkpoint",
    observed_at: input.observed_at || "2026-07-16T10:00:00.000Z",
    project_scope_hash: input.project_scope_hash || PROJECT_SCOPE_HASH,
    telemetry: input.telemetry || telemetry(),
    previous: input.previous || null,
  });
}

test("an optimization observation is immutable, schema-valid, hash-bound, and budget-neutral", () => {
  const baseline = observation("OPT-BASELINE", { phase: "apply" });
  const validation = validateContextOptimizationObservation(baseline);

  assert.equal(validation.valid, true);
  assert.equal(validation.expected_hash, baseline.observation_hash);
  assert.match(baseline.observation_hash, /^[a-f0-9]{64}$/u);
  assert.equal(baseline.delta.status, "baseline");
  assert.deepEqual(baseline.delta, {
    status: "baseline",
    commands: 0,
    estimated_command_output_tokens_before: 0,
    estimated_command_output_tokens_after: 0,
    estimated_tokens_avoided: 0,
  });
  assert.deepEqual(baseline.budget_effect, {
    usage_adjustment_applied: 0,
    gate_override: false,
  });
  assert.equal(baseline.assurance.classification, "advisory_estimated");
  assert.equal(baseline.assurance.trusted_exact, false);
  assert.equal(baseline.source.shell, false);
  assert.equal(Object.isFrozen(baseline), true);
  assert.doesNotThrow(() => assertAgainstSchema(baseline, "context-optimization-observation"));

  const tampered = structuredClone(baseline);
  tampered.counters.estimated_tokens_avoided += 1;
  const invalid = validateContextOptimizationObservation(tampered);
  assert.equal(invalid.valid, false);
  assert.notEqual(invalid.expected_hash, baseline.observation_hash);
  assert.match(invalid.errors.join("; "), /observation_hash/u);
});

test("monotonic counters create a deterministic measured delta and bind the previous hash", () => {
  const baseline = observation("OPT-BASELINE", { phase: "apply" });
  const current = observation("OPT-CURRENT", {
    previous: baseline,
    observed_at: "2026-07-16T10:10:00.000Z",
    telemetry: telemetry({
      savings: {
        total_commands: 15,
        estimated_input_tokens: 1_500,
        estimated_output_tokens: 350,
        estimated_tokens_avoided: 1_150,
        estimated_savings_percent: 76.6666666667,
      },
    }),
  });

  assert.deepEqual(current.delta, {
    status: "measured",
    commands: 5,
    estimated_command_output_tokens_before: 500,
    estimated_command_output_tokens_after: 150,
    estimated_tokens_avoided: 350,
  });
  assert.deepEqual(current.previous_observation_ref, {
    id: baseline.id,
    hash: baseline.observation_hash,
  });
  assert.equal(validateContextOptimizationObservation(current).valid, true);

  const lineage = validateContextOptimizationLineage([current, baseline]);
  assert.equal(lineage.valid, true);
  assert.deepEqual(lineage.ordered.map(({ id }) => id), [baseline.id, current.id]);
});

test("counter reset, provider version change, and project scope change never fabricate a delta", () => {
  const baseline = observation("OPT-BASELINE", { phase: "apply" });

  const reset = observation("OPT-RESET", {
    previous: baseline,
    telemetry: telemetry({
      savings: {
        total_commands: 9,
        estimated_input_tokens: 900,
        estimated_output_tokens: 180,
        estimated_tokens_avoided: 720,
        estimated_savings_percent: 80,
      },
    }),
  });
  assert.deepEqual(reset.delta, {
    status: "counter_reset",
    commands: null,
    estimated_command_output_tokens_before: null,
    estimated_command_output_tokens_after: null,
    estimated_tokens_avoided: null,
  });

  const versionChanged = observation("OPT-VERSION", {
    previous: baseline,
    telemetry: telemetry({ version: "0.44.0" }),
  });
  assert.equal(versionChanged.delta.status, "provider_version_changed");
  assert.equal(versionChanged.delta.estimated_tokens_avoided, null);

  const scopeChanged = observation("OPT-SCOPE", {
    previous: baseline,
    project_scope_hash: OTHER_SCOPE_HASH,
  });
  assert.equal(scopeChanged.delta.status, "scope_changed");
  assert.equal(scopeChanged.delta.commands, null);
});

test("observation lineage rejects tampering and cross-execution predecessors", () => {
  const baseline = observation("OPT-BASELINE", { phase: "apply" });
  const tampered = structuredClone(baseline);
  tampered.provider.version = "9.9.9";

  assert.throws(
    () => observation("OPT-TAMPERED-PREVIOUS", { previous: tampered }),
    /Previous context optimization observation is invalid/u,
  );
  assert.throws(
    () => observation("OPT-CROSS-EXECUTION", {
      execution_id: "ASSESS-OTHER",
      previous: baseline,
    }),
    /execution|lineage|previous/iu,
  );
  assert.throws(
    () => observation("OPT-CROSS-PROPOSAL", {
      proposal_hash: "d".repeat(64),
      previous: baseline,
    }),
    /proposal|lineage|previous/iu,
  );

  const current = observation("OPT-CURRENT", {
    previous: baseline,
    observed_at: "2026-07-16T10:10:00.000Z",
  });
  const missingPredecessor = validateContextOptimizationLineage([current]);
  assert.equal(missingPredecessor.valid, false);
  assert.match(missingPredecessor.errors.join("; "), /first observation|baseline/iu);

  const fork = observation("OPT-FORK", {
    previous: baseline,
    observed_at: "2026-07-16T10:11:00.000Z",
  });
  const forkedLineage = validateContextOptimizationLineage([baseline, current, fork]);
  assert.equal(forkedLineage.valid, false);
  assert.match(forkedLineage.errors.join("; "), /successors|fork/iu);

  const manualRoot = observation("OPT-MANUAL-ROOT", { phase: "manual" });
  const lateApply = observation("OPT-LATE-APPLY", {
    phase: "apply",
    previous: manualRoot,
    observed_at: "2026-07-16T10:12:00.000Z",
  });
  assert.match(validateContextOptimizationLineage([manualRoot, lateApply]).errors.join("; "), /apply.*root/iu);

  const complete = observation("OPT-COMPLETE", {
    phase: "complete",
    previous: baseline,
    observed_at: "2026-07-16T10:13:00.000Z",
  });
  const afterComplete = observation("OPT-AFTER-COMPLETE", {
    phase: "checkpoint",
    previous: complete,
    observed_at: "2026-07-16T10:14:00.000Z",
  });
  assert.match(validateContextOptimizationLineage([baseline, complete, afterComplete]).errors.join("; "), /complete.*tail/iu);

  const forgedBaseline = structuredClone(baseline);
  forgedBaseline.delta.commands = 999;
  forgedBaseline.delta.estimated_tokens_avoided = 999;
  const { observation_hash: _storedHash, hash_algorithm: _algorithm, ...forgedSubject } = forgedBaseline;
  forgedBaseline.observation_hash = computeStableHash(forgedSubject);
  assert.equal(validateContextOptimizationObservation(forgedBaseline).valid, true);
  assert.match(
    validateContextOptimizationLineage([forgedBaseline]).errors.join("; "),
    /baseline delta.*zero/iu,
  );
});

test("proposal delta remains discontinuous after a reset even when later counters recover", () => {
  const baseline = observation("OPT-BASELINE", { phase: "apply" });
  const reset = observation("OPT-RESET", {
    previous: baseline,
    observed_at: "2026-07-16T10:10:00.000Z",
    telemetry: telemetry({
      savings: {
        total_commands: 2,
        estimated_input_tokens: 200,
        estimated_output_tokens: 40,
        estimated_tokens_avoided: 150,
        estimated_savings_percent: 75,
      },
    }),
  });
  const recovered = observation("OPT-RECOVERED", {
    previous: reset,
    observed_at: "2026-07-16T10:20:00.000Z",
    telemetry: telemetry({
      savings: {
        total_commands: 12,
        estimated_input_tokens: 1_200,
        estimated_output_tokens: 240,
        estimated_tokens_avoided: 950,
        estimated_savings_percent: 79.2,
      },
    }),
  });
  assert.equal(reset.delta.status, "counter_reset");
  assert.equal(recovered.delta.status, "measured");
  const summary = buildContextOptimizationLineageDelta([baseline, reset, recovered]);
  assert.equal(summary.status, "discontinuous");
  assert.equal(summary.delta, null);
  assert.deepEqual(summary.discontinuities.map(({ id, status }) => ({ id, status })), [
    { id: reset.id, status: "counter_reset" },
  ]);
  assert.equal(summary.usage_adjustment_applied, 0);
});

test("budget advisory follows the cost gate before optimizing and never credits usage", () => {
  const baseline = observation("OPT-BASELINE", { phase: "apply" });
  const operational = telemetry();

  const warning = optimizationBudgetAdvisory({ status: "warning", allowed_to_start_next: true }, operational, baseline);
  assert.equal(warning.action, "maximize_rtk_for_supported_commands");
  assert.equal(warning.triggered_by_budget_status, "warning");
  assert.deepEqual(warning.latest_observation_ref, {
    id: baseline.id,
    hash: baseline.observation_hash,
    phase: baseline.phase,
  });

  const soft = optimizationBudgetAdvisory({ status: "soft_limit", allowed_to_start_next: false }, operational, baseline);
  assert.equal(soft.action, "checkpoint_required_stop");
  assert.equal(soft.triggered_by_budget_status, "soft_limit");

  const reserve = optimizationBudgetAdvisory({
    status: "completion_reserve",
    allowed_to_start_next: false,
    allowed_for_completion_only: true,
  }, operational, baseline);
  assert.equal(reserve.action, "completion_only");
  assert.equal(reserve.triggered_by_budget_status, "completion_reserve");

  for (const status of ["hard_limit", "metering_violation"]) {
    const advisory = optimizationBudgetAdvisory({ status }, operational, baseline);
    assert.equal(advisory.action, "stop_per_budget_gate");
    assert.equal(advisory.triggered_by_budget_status, null);
    assert.equal(advisory.usage_adjustment_applied, 0);
    assert.equal(advisory.gate_override, false);
  }

  const withinBudget = optimizationBudgetAdvisory({ status: "within_budget" }, operational);
  assert.equal(withinBudget.action, "use_rtk_for_supported_commands");
  assert.equal(withinBudget.usage_adjustment_applied, 0);

  const unavailable = optimizationBudgetAdvisory(
    { status: "soft_limit", allowed_to_start_next: false },
    { provider: "rtk", status: "unavailable" },
  );
  assert.equal(unavailable.action, "checkpoint_required_stop");
  assert.equal(unavailable.usage_adjustment_applied, 0);
  assert.equal(unavailable.gate_override, false);
});

test("configured trigger statuses change advice without weakening a hard stop", () => {
  const operational = telemetry();
  const reserveNotConfigured = optimizationBudgetAdvisory(
    { status: "completion_reserve", allowed_to_start_next: false, allowed_for_completion_only: true },
    operational,
    null,
    { trigger_statuses: ["soft_limit"] },
  );
  assert.equal(reserveNotConfigured.action, "completion_only");
  assert.equal(reserveNotConfigured.triggered_by_budget_status, null);

  const hard = optimizationBudgetAdvisory(
    { status: "hard_limit" },
    operational,
    null,
    { trigger_statuses: ["hard_limit"] },
  );
  assert.equal(hard.action, "stop_per_budget_gate");
  assert.equal(hard.usage_adjustment_applied, 0);
  assert.equal(hard.gate_override, false);
});
