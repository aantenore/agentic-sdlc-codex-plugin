import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createGovernancePolicy } from "../../lib/governance/policy-engine.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CLI = path.join(ROOT, "bin", "agentic-sdlc.mjs");

function verifiedCliActor() {
  const credential = typeof process.getuid === "function"
    ? `uid:${process.getuid()}`
    : `user:${os.userInfo().username}`;
  const identityHash = crypto.createHash("sha256")
    .update(`${process.platform}\0${credential}`)
    .digest("hex")
    .slice(0, 32);
  return { type: "system", id: `host-user-${identityHash}`, issuer: `os-${process.platform}` };
}

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

function transitionAppendPolicy(instanceId, extraSources = []) {
  const action = "workflow.instance.transition";
  const instanceRoot = `.sdlc/workflows/instances/${instanceId}`;
  const allowed = [
    ["lock.acquire", `.sdlc/workflows/instances/.locks/${instanceId}.lock`],
    ["lock.release", `.sdlc/workflows/instances/.locks/${instanceId}.lock`],
    ["lock.acquire", `${instanceRoot}/events.jsonl.lock`],
    ["lock.release", `${instanceRoot}/events.jsonl.lock`],
    ["lock.acquire", ".sdlc/traces/project.jsonl.lock"],
    ["lock.release", ".sdlc/traces/project.jsonl.lock"],
    ["file.write", `${instanceRoot}/pending-transition.json`],
    ...extraSources.flatMap((sourcePath) => [
      ["file.write", sourcePath],
      ["lock.acquire", `${sourcePath}.lock`],
      ["lock.release", `${sourcePath}.lock`],
    ]),
  ];
  const rule = (id, effect, operation, projectPath) => ({
    id,
    effect,
    action,
    scope_refs: [
      { kind: "mutation_operation", id: operation },
      { kind: "project_path", id: projectPath },
    ],
    evidence_refs: [],
    actor_roles: effect === "allow" ? ["runner"] : [],
  });
  return createGovernancePolicy({
    id: "POLICY-TRANSITION-APPEND",
    valid_from: "2026-01-01T00:00:00.000Z",
    expires_at: "2030-01-01T00:00:00.000Z",
    decision_ttl_seconds: 60,
    role_bindings: [{ id: "BIND-HOST-CLI", role: "runner", actor: verifiedCliActor() }],
    rules: [
      ...allowed.map(([operation, projectPath], index) =>
        rule(`ALLOW-${index + 1}`, "allow", operation, projectPath)),
      rule("DENY-EVENT-APPEND", "deny", "file.append", `${instanceRoot}/events.jsonl`),
    ],
  });
}

function traceAppendPolicy(sourcePaths) {
  const action = "trace.append";
  const exact = [
    ["lock.acquire", ".sdlc/traces/project.jsonl.lock"],
    ["lock.release", ".sdlc/traces/project.jsonl.lock"],
    ["lock.acquire", ".sdlc/traces/.integrity/project.jsonl.checkpoint.json.lock"],
    ["lock.remove", ".sdlc/traces/.integrity/project.jsonl.checkpoint.json.lock"],
    ...sourcePaths.flatMap((sourcePath) => [
      ["file.write", sourcePath],
      ["lock.acquire", `${sourcePath}.lock`],
      ["lock.release", `${sourcePath}.lock`],
    ]),
  ];
  const makeRule = (id, effect, operation, projectPath) => ({
    id,
    effect,
    action,
    scope_refs: [
      { kind: "mutation_operation", id: operation },
      { kind: "project_path", id: projectPath },
    ],
    evidence_refs: [],
    actor_roles: effect === "allow" ? ["runner"] : [],
  });
  return createGovernancePolicy({
    id: "POLICY-TRACE-APPEND",
    valid_from: "2026-01-01T00:00:00.000Z",
    expires_at: "2030-01-01T00:00:00.000Z",
    decision_ttl_seconds: 60,
    role_bindings: [{ id: "BIND-HOST-TRACE", role: "runner", actor: verifiedCliActor() }],
    rules: [
      ...exact.map(([operation, projectPath], index) =>
        makeRule(`ALLOW-TRACE-${index + 1}`, "allow", operation, projectPath)),
      makeRule("DENY-TRACE-APPEND", "deny", "file.append", ".sdlc/traces/project.jsonl"),
    ],
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

test("CLI denies a workflow transition append before the first event byte", (t) => {
  const project = projectFixture(t, "workflow-append");
  initialize(project);
  const warmup = run(project, [
    "workflow", "instance", "start",
    "--id", "change-warmup",
    "--definition", "change-request",
    "--definition-version", "1",
  ]);
  assert.equal(warmup.status, 0, warmup.stderr);
  const warmedTransition = run(project, [
    "workflow", "instance", "transition",
    "--id", "change-warmup",
    "--to", "impact-review",
    "--request-id", "impact-review-warmup",
  ]);
  assert.equal(warmedTransition.status, 0, warmedTransition.stderr);
  const instanceId = "change-guard";
  const started = run(project, [
    "workflow", "instance", "start",
    "--id", instanceId,
    "--definition", "change-request",
    "--definition-version", "1",
  ]);
  assert.equal(started.status, 0, started.stderr);
  const eventsPath = path.join(project, ".sdlc", "workflows", "instances", instanceId, "events.jsonl");
  const before = fs.readFileSync(eventsPath);
  assert.equal(before.length, 0);
  const evidencePolicyRoot = path.join(project, ".sdlc", "evidence-redaction-policies");
  const policySources = fs.readdirSync(evidencePolicyRoot)
    .filter((name) => name.endsWith(".json"))
    .map((name) => `.sdlc/evidence-redaction-policies/${name}`);
  unpinWithGovernance(project, transitionAppendPolicy(instanceId, policySources));

  const result = run(project, [
    "workflow", "instance", "transition",
    "--id", instanceId,
    "--to", "impact-review",
    "--request-id", "impact-review-denied",
  ]);
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /no approval for this exact action and file/u);
  assert.deepEqual(fs.readFileSync(eventsPath), before, "the denied append changed the event history");
  assert.equal(
    fs.existsSync(path.join(path.dirname(eventsPath), "pending-transition.json")),
    true,
    `the exact journal should exist before the separately denied append\nSources: ${JSON.stringify(policySources)}\n${result.stderr}`,
  );
});

test("trace-integrity dependency writes consume exact mutation grants", (t) => {
  const project = projectFixture(t, "trace-dependencies");
  initialize(project);
  const warmup = run(project, [
    "trace", "append",
    "--type", "decision",
    "--summary", "Warm the exact trace integrity files",
  ]);
  assert.equal(warmup.status, 0, warmup.stderr);
  const tracePath = path.join(project, ".sdlc", "traces", "project.jsonl");
  const before = fs.readFileSync(tracePath);
  const evidencePolicyRoot = path.join(project, ".sdlc", "evidence-redaction-policies");
  const sourcePaths = (fs.existsSync(evidencePolicyRoot) ? fs.readdirSync(evidencePolicyRoot) : [])
    .filter((name) => name.endsWith(".json"))
    .map((name) => `.sdlc/evidence-redaction-policies/${name}`);
  unpinWithGovernance(project, traceAppendPolicy(sourcePaths));

  const denied = run(project, [
    "trace", "append",
    "--type", "decision",
    "--summary", "This append must be denied before its first byte",
  ]);
  assert.notEqual(denied.status, 0, denied.stdout);
  const payload = JSON.parse(denied.stderr);
  assert.ok(payload.human_guidance.details.mutation, denied.stderr);
  assert.equal(payload.human_guidance.details.mutation.operation, "file.append", denied.stderr);
  assert.equal(payload.human_guidance.details.mutation.project_path, ".sdlc/traces/project.jsonl");
  assert.deepEqual(fs.readFileSync(tracePath), before);
});
