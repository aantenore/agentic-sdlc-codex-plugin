import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { resolveObservatoryConfiguration } from "../../lib/change-observatory/configuration.mjs";
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
