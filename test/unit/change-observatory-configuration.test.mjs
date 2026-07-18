import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  resolveObservatoryConfiguration,
  resolveObservatoryConfigurationSnapshot,
} from "../../lib/change-observatory/configuration.mjs";
import { redactText } from "../../lib/observability/redaction.mjs";

test("uses safe operational defaults when a project has no observability configuration", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "observatory-config-default-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const resolved = await resolveObservatoryConfiguration(root);
  assert.equal(redactText(`github_pat_${"A".repeat(32)}`, resolved.redactionPolicy), "[REDACTED]");
  assert.equal(
    redactText("AUT-ACT-20260718123456789-abcdef", resolved.redactionPolicy),
    "AUT-ACT-20260718123456789-abcdef",
  );
  assert.deepEqual(resolved.operationalPolicy, {});
});

test("configuration snapshots distinguish absence and exact bounded file content", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "observatory-config-revision-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const absent = await resolveObservatoryConfigurationSnapshot(root);
  assert.equal(absent.revision, "absent");
  await fs.mkdir(path.join(root, ".sdlc"));
  await fs.writeFile(path.join(root, ".sdlc", "config.json"), '{"observability":{}}\n');
  const present = await resolveObservatoryConfigurationSnapshot(root);
  assert.match(present.revision, /^sha256:[a-f0-9]{64}$/u);
  assert.notEqual(present.revision, absent.revision);
});

test("loads bounded project redaction and SLO options without accepting secret values", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "observatory-config-project-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, ".sdlc"));
  await fs.writeFile(path.join(root, ".sdlc", "config.json"), `${JSON.stringify({
    observability: {
      external_sinks: "disabled",
      redaction: {
        pii_patterns: [{ name: "employee", pattern: "EMP-[0-9]{6}" }],
        identifier_allow_patterns: [],
        secret_patterns: [],
      },
      slo: {
        availability_target: 0.995,
        readiness_target: 0.99,
        minimum_samples: 25,
      },
      support_bundle: { max_recent_requests: 12 },
    },
  }, null, 2)}\n`);

  const resolved = await resolveObservatoryConfiguration(root);
  assert.equal(redactText("employee EMP-123456", resolved.redactionPolicy), "employee [REDACTED]");
  assert.deepEqual(resolved.operationalPolicy, {
    availabilityTarget: 0.995,
    maxRecentRequests: 12,
    minimumSamples: 25,
    readinessTarget: 0.99,
  });
});

test("rejects a symlinked project config instead of silently ignoring its configured PII policy", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "observatory-config-symlink-"));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "observatory-config-outside-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));

  await fs.mkdir(path.join(root, ".sdlc"));
  const outsideConfig = path.join(outside, "config.json");
  await fs.writeFile(outsideConfig, JSON.stringify({
    observability: {
      redaction: {
        pii_patterns: [{ name: "employee", pattern: "EMP-[0-9]{6}" }],
      },
    },
  }));
  await fs.symlink(outsideConfig, path.join(root, ".sdlc", "config.json"), "file");

  await assert.rejects(
    () => resolveObservatoryConfiguration(root),
    (error) => {
      assert.equal(error?.code, "symlink_forbidden");
      assert.doesNotMatch(error.message, /EMP-|employee/u);
      return true;
    },
  );
});

test("rejects invalid configured export and detector settings without exposing their content", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "observatory-config-invalid-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, ".sdlc"));
  await fs.writeFile(path.join(root, ".sdlc", "config.json"), JSON.stringify({
    observability: {
      external_sinks: "remote",
      redaction: { pii_patterns: ["PRIVATE_CANARY"] },
    },
  }));

  await assert.rejects(
    () => resolveObservatoryConfiguration(root),
    (error) => {
      assert.equal(error instanceof TypeError, true);
      assert.doesNotMatch(error.message, /PRIVATE_CANARY|remote/u);
      return true;
    },
  );
});

test("rejects unbounded configured detectors before they reach the request loop", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "observatory-config-regexp-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, ".sdlc"));
  await fs.writeFile(path.join(root, ".sdlc", "config.json"), JSON.stringify({
    observability: {
      redaction: { pii_patterns: [{ name: "unsafe", pattern: "a+$" }] },
    },
  }));

  await assert.rejects(
    () => resolveObservatoryConfiguration(root),
    (error) => {
      assert.equal(error instanceof TypeError, true);
      assert.match(error.message, /unbounded quantifier/u);
      assert.doesNotMatch(error.message, /a\+\$/u);
      return true;
    },
  );
});

test("rejects support-bundle retention above the runtime hard bound", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "observatory-config-retention-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, ".sdlc"));
  await fs.writeFile(path.join(root, ".sdlc", "config.json"), JSON.stringify({
    observability: { support_bundle: { max_recent_requests: 1_001 } },
  }));

  await assert.rejects(
    () => resolveObservatoryConfiguration(root),
    (error) => error instanceof TypeError && /no greater than 1000/u.test(error.message),
  );
});

test("rejects unknown observability settings instead of ignoring privacy typos", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "observatory-config-typo-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, ".sdlc"));
  await fs.writeFile(path.join(root, ".sdlc", "config.json"), JSON.stringify({
    observability: {
      redaction: {
        secret_pattern: [`github_pat_${"A".repeat(32)}`],
      },
    },
  }));

  await assert.rejects(
    () => resolveObservatoryConfiguration(root),
    (error) => {
      assert.equal(error instanceof TypeError, true);
      assert.doesNotMatch(error.message, /github_pat_/u);
      return true;
    },
  );
});
