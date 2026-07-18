import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { computeStableHash } from "../../lib/canonical.mjs";
import {
  prepareConfigMigration,
  resolveEffectiveConfig,
} from "../../lib/effective-config.mjs";
import { validateAgainstSchema } from "../../lib/json-schema-validator.mjs";

const ROOT = process.cwd();
const CURRENT_TEMPLATE_PATH = path.join(ROOT, "templates", "sdlc-config.json");
const LEGACY_TEMPLATE_PATH = path.join(
  ROOT,
  "templates",
  "config-compat",
  "sdlc-config-v1-0.11.0.json",
);

const currentTemplate = readJson(CURRENT_TEMPLATE_PATH);
const legacyTemplate = readJson(LEGACY_TEMPLATE_PATH);

test("the current template ships a bounded, local-only observability policy", () => {
  assert.equal(validateConfig(currentTemplate).valid, true);
  assert.deepEqual(currentTemplate.observability, {
    enabled: true,
    external_sinks: "disabled",
    redaction: {
      mode: "before_persistence_and_presentation",
      secret_patterns: [],
      pii_patterns: [],
      identifier_allow_patterns: [],
    },
    correlation: {
      enabled: true,
      format: "corr-uuid",
    },
    metrics: {
      enabled: true,
      cardinality: "closed",
      external_sinks: "disabled",
    },
    readiness: {
      liveness_is_shallow: true,
      warm_before_ready: true,
    },
    slo: {
      mode: "advisory",
      availability_target: 0.99,
      readiness_target: 0.99,
      minimum_samples: 20,
    },
    support_bundle: {
      enabled: true,
      max_recent_requests: 50,
      integrity: "sha256_of_redacted_canonical_content",
      authenticity_claimed: false,
    },
  });
});

test("the observability schema fails closed for external sinks, unbounded metrics, and authenticity claims", () => {
  const disabled = structuredClone(currentTemplate);
  disabled.observability.enabled = false;
  assert.equal(validateConfig(disabled).valid, false);

  const externalSink = structuredClone(currentTemplate);
  externalSink.observability.external_sinks = "enabled";
  assert.equal(validateConfig(externalSink).valid, false);

  const unboundedMetrics = structuredClone(currentTemplate);
  unboundedMetrics.observability.metrics.cardinality = "unbounded";
  assert.equal(validateConfig(unboundedMetrics).valid, false);

  const authenticityClaim = structuredClone(currentTemplate);
  authenticityClaim.observability.support_bundle.authenticity_claimed = true;
  assert.equal(validateConfig(authenticityClaim).valid, false);

  const invalidPattern = structuredClone(currentTemplate);
  invalidPattern.observability.redaction.secret_patterns = [""];
  assert.equal(validateConfig(invalidPattern).valid, false);
});

test("the frozen 0.11 compatibility profile stays valid without inheriting observability defaults", () => {
  assert.equal(validateConfig(legacyTemplate).valid, true);
  assert.equal(Object.hasOwn(legacyTemplate, "observability"), false);

  const projectConfig = {
    config_schema_version: legacyTemplate.config_schema_version,
    schema_version: legacyTemplate.schema_version,
  };
  const defaultsProfile = {
    id: "sdlc-config-v1@0.11.0",
    sha256: computeStableHash(legacyTemplate),
  };
  const resolution = resolveEffectiveConfig({
    project_config: projectConfig,
    legacy_defaults: legacyTemplate,
    defaults_profile: defaultsProfile,
    current_template: currentTemplate,
  });

  assert.equal(resolution.status, "legacy_compat");
  assert.equal(Object.hasOwn(resolution.effective_config, "observability"), false);
  assert.equal(resolution.inherited_paths.includes("/observability"), false);
  assert.equal(validateConfig(resolution.effective_config).valid, true);

  const migration = prepareConfigMigration({
    project_config: projectConfig,
    legacy_defaults: legacyTemplate,
    defaults_profile: defaultsProfile,
  });
  assert.equal(Object.hasOwn(migration.target_config, "observability"), false);
  assert.equal(migration.changes.some(({ path: changedPath }) => changedPath === "/observability"), false);
});

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function validateConfig(value) {
  return validateAgainstSchema(value, "sdlc-config.schema.json", {
    schemaDir: path.join(ROOT, "schemas"),
  });
}
