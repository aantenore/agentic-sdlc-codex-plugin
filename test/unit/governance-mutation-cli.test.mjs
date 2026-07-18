import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createGovernancePolicy } from "../../lib/governance/policy-engine.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CLI = path.join(ROOT, "bin", "agentic-sdlc.mjs");

function projectFixture(t, label) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), `agentic-sdlc-governance-cli-${label}-`));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  return project;
}

function run(project, args) {
  const env = { ...process.env };
  for (const key of ["CI", "GITHUB_ACTIONS", "GITHUB_ACTOR", "CODEX_AGENT_NAME", "CODEX_USER_ID"]) delete env[key];
  return spawnSync(process.execPath, [CLI, ...args, "--root", project, "--json"], {
    cwd: project,
    env,
    encoding: "utf8",
    timeout: 30_000,
  });
}

function initialize(project) {
  const result = run(project, ["init", "--project-name", "Governed fixture", "--force"]);
  assert.equal(result.status, 0, result.stderr);
}

function denyAllPolicy() {
  return createGovernancePolicy({
    id: "POLICY-DENY-ALL",
    valid_from: "2026-01-01T00:00:00.000Z",
    expires_at: "2030-01-01T00:00:00.000Z",
    decision_ttl_seconds: 60,
    role_bindings: [],
    rules: [],
  });
}

function unpinWithGovernance(project, governancePolicy) {
  const configPath = path.join(project, ".sdlc", "config.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  config.governance_policy = governancePolicy;
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  fs.rmSync(path.join(project, ".sdlc", "config.lock.json"), { force: true });
}

function createStory(project, id) {
  return run(project, [
    "story", "create",
    "--id", id,
    "--title", "Governed story",
    "--acceptance", "The exact mutation behavior is observable",
  ]);
}

test("CLI dispatch enforces an inline policy before creating the first story entry", (t) => {
  const project = projectFixture(t, "enforce");
  initialize(project);
  unpinWithGovernance(project, denyAllPolicy());
  const storyRoot = path.join(project, ".sdlc", "stories", "ST-GOV-DENIED");
  assert.equal(fs.existsSync(storyRoot), false);

  const result = createStory(project, "ST-GOV-DENIED");
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /no approval for this exact action and file/u);
  assert.equal(fs.existsSync(storyRoot), false, "the denied callback wrote a directory before its decision");
});

test("CLI audit pointer records policy misses without blocking legacy-compatible mutation", (t) => {
  const project = projectFixture(t, "audit");
  initialize(project);
  const governanceRoot = path.join(project, ".sdlc", "governance");
  fs.mkdirSync(governanceRoot, { recursive: true });
  fs.writeFileSync(path.join(governanceRoot, "policy.json"), `${JSON.stringify(denyAllPolicy(), null, 2)}\n`);
  unpinWithGovernance(project, {
    mode: "audit",
    policy_file: ".sdlc/governance/policy.json",
    decision_receipts_root: ".sdlc/governance/decisions",
    use_receipts_root: ".sdlc/governance/uses",
    revocations_root: ".sdlc/governance/revocations",
    fail_closed: false,
  });

  const result = createStory(project, "ST-GOV-AUDIT");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(project, ".sdlc", "stories", "ST-GOV-AUDIT", "story.json")), true);
});
