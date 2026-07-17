import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  buildConfigMigrationApplyData,
  buildEffectiveConfigLock,
  prepareConfigMigration,
  resolveEffectiveConfig,
  verifyConfigMigrationPlan,
  verifyEffectiveConfigLock,
} from "../../lib/effective-config.mjs";
import { computeStableHash } from "../../lib/canonical.mjs";
import { validateAgainstSchema } from "../../lib/json-schema-validator.mjs";

const FIXED_TIME = "2026-07-17T12:00:00.000Z";
const DEFAULTS = Object.freeze({
  config_schema_version: "sdlc-config:v1",
  schema_version: "0.1.0",
  execution_policy: { runtime: "codex", reasoning: "inherit" },
  autonomy_policy: { mode: "enforce_new_only", enabled: true },
  nested: { alpha: 1, beta: { enabled: true } },
});
const PROFILE = Object.freeze({
  id: "sdlc-config-v1-0.11.0",
  sha256: computeStableHash(DEFAULTS),
});

test("legacy resolution materializes only missing defaults and is insertion-order independent", () => {
  const first = resolveEffectiveConfig({
    project_config: {
      schema_version: "0.1.0",
      config_schema_version: "sdlc-config:v1",
      execution_policy: { runtime: "custom" },
      nested: { beta: { enabled: false } },
    },
    legacy_defaults: DEFAULTS,
    defaults_profile: PROFILE,
  });
  const second = resolveEffectiveConfig({
    project_config: {
      nested: { beta: { enabled: false } },
      execution_policy: { runtime: "custom" },
      config_schema_version: "sdlc-config:v1",
      schema_version: "0.1.0",
    },
    legacy_defaults: {
      nested: { beta: { enabled: true }, alpha: 1 },
      autonomy_policy: { enabled: true, mode: "enforce_new_only" },
      execution_policy: { reasoning: "inherit", runtime: "codex" },
      schema_version: "0.1.0",
      config_schema_version: "sdlc-config:v1",
    },
    defaults_profile: PROFILE,
  });

  assert.equal(first.status, "legacy_compat");
  assert.equal(first.migration_required, true);
  assert.equal(first.effective_config.execution_policy.runtime, "custom");
  assert.equal(first.effective_config.execution_policy.reasoning, "inherit");
  assert.equal(first.effective_config.nested.beta.enabled, false);
  assert.deepEqual(first.inherited_paths, [
    "/autonomy_policy",
    "/execution_policy/reasoning",
    "/nested/alpha",
  ]);
  assert.equal(first.effective_config_hash, second.effective_config_hash);
  assert.deepEqual(first.effective_config, second.effective_config);
});

test("a frozen compatibility payload does not inherit fields from a later current template", () => {
  const projectConfig = { config_schema_version: "sdlc-config:v1", schema_version: "0.1.0" };
  const frozen = resolveEffectiveConfig({
    project_config: projectConfig,
    legacy_defaults: DEFAULTS,
    defaults_profile: PROFILE,
  });
  const laterTemplate = { ...DEFAULTS, future_policy: { enabled: true } };
  const stillFrozen = resolveEffectiveConfig({
    project_config: projectConfig,
    legacy_defaults: DEFAULTS,
    defaults_profile: PROFILE,
    current_template: laterTemplate,
  });

  assert.equal(frozen.effective_config_hash, stillFrozen.effective_config_hash);
  assert.equal(Object.hasOwn(stillFrozen.effective_config, "future_policy"), false);
});

test("lock construction and verification bind the complete materialized config", () => {
  const config = { ...DEFAULTS, local_override: true };
  const lock = buildEffectiveConfigLock({
    effective_config: config,
    defaults_profile: PROFILE,
    inherited_paths: ["/nested/alpha", "/autonomy_policy", "/nested/alpha"],
    created_at: FIXED_TIME,
  });
  const verification = verifyEffectiveConfigLock({ lock, project_config: config });

  assert.equal(verification.valid, true);
  assert.equal(verification.status, "locked");
  assert.deepEqual(lock.inherited_paths, ["/autonomy_policy", "/nested/alpha"]);
  assert.equal(validate("effective-config-lock.schema.json", lock).valid, true);

  const resolved = resolveEffectiveConfig({ project_config: config, lock });
  assert.equal(resolved.status, "locked");
  assert.equal(resolved.mutation_allowed, true);
  assert.deepEqual(resolved.effective_config, config);
});

test("lock verification distinguishes config drift from an invalid lock envelope", () => {
  const lock = buildEffectiveConfigLock({
    effective_config: DEFAULTS,
    defaults_profile: PROFILE,
    created_at: FIXED_TIME,
  });
  const drift = verifyEffectiveConfigLock({
    lock,
    project_config: { ...DEFAULTS, local_override: true },
  });
  assert.equal(drift.valid, false);
  assert.equal(drift.status, "drifted");
  assert.ok(drift.errors.some((issue) => issue.code === "config_hash_mismatch"));

  const corrupted = { ...lock, lock_hash: "0".repeat(64) };
  const invalid = verifyEffectiveConfigLock({ lock: corrupted, project_config: DEFAULTS });
  assert.equal(invalid.valid, false);
  assert.equal(invalid.status, "invalid");
  assert.ok(invalid.errors.some((issue) => issue.code === "lock_hash_mismatch"));
});

test("migration plan is deterministic, hash-bound, schema-valid, and does not mutate input", () => {
  const raw = {
    config_schema_version: "sdlc-config:v1",
    schema_version: "0.1.0",
    execution_policy: { runtime: "custom" },
  };
  const snapshot = structuredClone(raw);
  const first = prepareConfigMigration({
    project_config: raw,
    legacy_defaults: DEFAULTS,
    defaults_profile: PROFILE,
  });
  const second = prepareConfigMigration({
    project_config: { execution_policy: { runtime: "custom" }, schema_version: "0.1.0", config_schema_version: "sdlc-config:v1" },
    legacy_defaults: DEFAULTS,
    defaults_profile: PROFILE,
  });

  assert.deepEqual(raw, snapshot);
  assert.equal(first.status, "ready");
  assert.equal(first.mode, "materialize_legacy_defaults");
  assert.equal(first.plan_hash, second.plan_hash);
  assert.deepEqual(first.changes.map((change) => change.path), [
    "/autonomy_policy",
    "/execution_policy/reasoning",
    "/nested",
  ]);
  assert.deepEqual(verifyConfigMigrationPlan(first), {
    valid: true,
    errors: [],
    expected_plan_hash: first.plan_hash,
  });
  assert.equal(validate("config-migration-plan.schema.json", first).valid, true);
});

test("apply data generation requires the reviewed plan hash and produces valid immutable records", () => {
  const plan = prepareConfigMigration({
    project_config: { config_schema_version: "sdlc-config:v1", schema_version: "0.1.0" },
    legacy_defaults: DEFAULTS,
    defaults_profile: PROFILE,
  });
  assert.throws(
    () => buildConfigMigrationApplyData({
      plan,
      current_project_config: { config_schema_version: "sdlc-config:v1", schema_version: "0.1.0" },
      expected_plan_hash: "0".repeat(64),
      applied_at: FIXED_TIME,
    }),
    /does not match the reviewed plan/u,
  );
  assert.throws(
    () => buildConfigMigrationApplyData({
      plan,
      current_project_config: {
        config_schema_version: "sdlc-config:v1",
        schema_version: "0.1.0",
        changed_after_review: true,
      },
      expected_plan_hash: plan.plan_hash,
      applied_at: FIXED_TIME,
    }),
    /changed after the migration plan was reviewed/u,
  );

  const apply = buildConfigMigrationApplyData({
    plan,
    current_project_config: { config_schema_version: "sdlc-config:v1", schema_version: "0.1.0" },
    expected_plan_hash: plan.plan_hash,
    applied_at: FIXED_TIME,
    audit: { created_by: { id: "antonio", type: "human" } },
  });
  assert.equal(apply.status, "ready_to_apply");
  assert.equal(apply.lock.config_hash, computeStableHash(apply.config));
  assert.equal(apply.receipt.plan_hash, plan.plan_hash);
  assert.equal(apply.receipt.lock_hash, apply.lock.lock_hash);
  assert.equal(validate("effective-config-lock.schema.json", apply.lock).valid, true);
  assert.equal(validate("config-migration-receipt.schema.json", apply.receipt).valid, true);
  assert.equal(Object.isFrozen(apply), true);
  assert.equal(Object.isFrozen(apply.config), true);

  const tampered = { ...plan, target_config: { compromised: true } };
  assert.throws(
    () => buildConfigMigrationApplyData({
      plan: tampered,
      current_project_config: { config_schema_version: "sdlc-config:v1", schema_version: "0.1.0" },
      expected_plan_hash: plan.plan_hash,
      applied_at: FIXED_TIME,
    }),
    /integrity validation/u,
  );
});

test("an already valid lock yields an idempotent migration plan", () => {
  const lock = buildEffectiveConfigLock({
    effective_config: DEFAULTS,
    defaults_profile: PROFILE,
    created_at: FIXED_TIME,
  });
  const plan = prepareConfigMigration({ project_config: DEFAULTS, lock });
  assert.equal(plan.status, "already_applied");
  assert.equal(plan.mode, "already_locked");
  assert.deepEqual(plan.changes, []);

  const result = buildConfigMigrationApplyData({
    plan,
    current_project_config: DEFAULTS,
    current_lock: lock,
    expected_plan_hash: plan.plan_hash,
  });
  assert.equal(result.status, "already_applied");
  assert.deepEqual(result.lock, lock);
  assert.equal(result.receipt, null);
});

test("the packaged 0.11 compatibility snapshot is exact and independently hashable", () => {
  const compat = JSON.parse(fs.readFileSync(
    path.join(process.cwd(), "templates", "config-compat", "sdlc-config-v1-0.11.0.json"),
    "utf8",
  ));
  assert.equal(compat.config_schema_version, "sdlc-config:v1");
  assert.equal(compat.context_optimization_policy.mode, "automatic");
  assert.equal(compat.autonomy_policy.mode, "enforce_new_only");
  assert.equal(
    computeStableHash(compat),
    "f460c67be74ec2e2385befa438b47740e2cb3400baf6327a03be9210634a419f",
  );
});

function validate(schemaName, value) {
  return validateAgainstSchema(value, schemaName, {
    schemaDir: path.join(process.cwd(), "schemas"),
  });
}
