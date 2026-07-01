import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const bin = path.join(repoRoot, "bin", "agentic-sdlc.mjs");

function tmpProject(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `sdlc-${name}-`));
}

function run(args, options = {}) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd: options.cwd || repoRoot,
    encoding: "utf8",
    env: { ...process.env, ...(options.env || {}) },
  });
}

function mustRun(args, options = {}) {
  const result = run(args, options);
  assert.equal(result.status, 0, `${args.join(" ")}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  return result;
}

function mustFail(args, pattern, options = {}) {
  const result = run(args, options);
  assert.notEqual(result.status, 0, `${args.join(" ")} unexpectedly passed\n${result.stdout}`);
  const combined = `${result.stdout}\n${result.stderr}`;
  assert.match(combined, pattern, `${args.join(" ")}\n${combined}`);
  return result;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function initProject(project, extra = []) {
  mustRun(["init", "--root", project, "--project-name", "E2E", "--force", ...extra]);
}

function story(project, id, extra = []) {
  mustRun([
    "story",
    "create",
    "--root",
    project,
    "--id",
    id,
    "--title",
    `Story ${id}`,
    "--acceptance",
    "Observable acceptance",
    ...extra,
  ]);
}

function createApprovedTemplate(project, type = "functional-analysis") {
  mustRun(["output", "template", "propose", "--root", project, "--type", type, "--summary", "Standard template"]);
  mustRun(["output", "template", "approve", "--root", project, "--id", `${type}-v1`, "--actor-type", "human"]);
}

function writeArtifact(project, relativePath, body = "# Artifact\n") {
  const filePath = path.join(project, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, body);
  return relativePath;
}

function routeIntent(overrides = {}) {
  return JSON.stringify({
    requested_action: "intake_requirement",
    confidence: 0.95,
    referenced_entities: [],
    provided_artifacts: [],
    missing_context: [],
    proposed_phase: null,
    artifact_type: null,
    skip_phases: [],
    ...overrides,
  });
}

function routeDecision(project, overrides = {}, command = ["route", "decide"]) {
  const result = mustRun([
    ...command,
    "--root",
    project,
    "--json",
    "--intent-json",
    routeIntent(overrides),
  ]);
  return JSON.parse(result.stdout);
}

function createStrictReadyStory(project, id, artifactType = "functional-analysis") {
  story(project, id, ["--requirement", "REQ-001", "--contract", `contract-${id}-design`]);
  createApprovedTemplate(project, artifactType);
  const artifact = writeArtifact(project, `.sdlc/requirements/${id}-${artifactType}.md`);
  mustRun([
    "output",
    "link",
    "--root",
    project,
    "--story",
    id,
    "--type",
    artifactType,
    "--artifact",
    artifact,
    "--template",
    `${artifactType}-v1`,
    "--mode",
    "new",
    "--requirement",
    "REQ-001",
  ]);
  mustRun([
    "contract",
    "create",
    "--root",
    project,
    "--phase",
    "design",
    "--story",
    id,
    "--id",
    `contract-${id}-design`,
    "--context-summary",
    "Ready design contract",
    "--qa",
    "Who approves?|Owner",
    "--output-ref",
    `${artifactType}:${artifactType}-v1:new`,
    "--force",
  ]);
  mustRun(["contract", "approve", "--root", project, "--id", `contract-${id}-design`, "--actor-type", "human"]);
}

test("--version is not shadowed by help and boolean --json does not consume query", () => {
  const version = mustRun(["--version"]);
  assert.match(version.stdout.trim(), /^\d+\.\d+\.\d+$/);

  const project = tmpProject("parser");
  initProject(project);
  fs.writeFileSync(path.join(project, ".sdlc", "requirements", "REQ-001.md"), "# Workflow\nbusiness workflow\n");
  mustRun(["index", "rebuild", "--root", project]);
  const result = mustRun(["kb", "search", "--root", project, "--json", "workflow"]);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.query, "workflow");
  assert.ok(payload.results.length > 0);
});

test("strict gate fails when a story has no contract", () => {
  const project = tmpProject("missing-contract");
  initProject(project);
  story(project, "ST-001");
  mustFail(["gate", "check", "--root", project, "--story", "ST-001", "--strict"], /has no contract_id/);
});

test("story id mismatch and invalid branch pattern fail strict gate", () => {
  const project = tmpProject("story-claim");
  initProject(project);
  createStrictReadyStory(project, "ST-001");

  const storyPath = path.join(project, ".sdlc", "stories", "ST-001", "story.json");
  const originalStory = readJson(storyPath);
  writeJson(storyPath, { ...originalStory, id: "ST-999" });
  mustFail(["gate", "check", "--root", project, "--story", "ST-001", "--strict"], /must match its folder id/);
  writeJson(storyPath, originalStory);

  writeJson(storyPath, { ...originalStory, phase: "implementation", status: "implementation" });
  mustRun(["story", "claim", "--root", project, "--id", "ST-001", "--agent", "codex", "--branch", "nope"]);
  mustFail(["gate", "check", "--root", project, "--story", "ST-001", "--strict"], /does not match expected/);
});

test("invalid statuses and invalid expiry values are rejected or gated", () => {
  const project = tmpProject("status-expiry");
  initProject(project);
  mustFail(["story", "create", "--root", project, "--id", "ST-001", "--title", "Bad", "--status", "banana"], /Unknown story status/);

  createStrictReadyStory(project, "ST-001");
  const storyPath = path.join(project, ".sdlc", "stories", "ST-001", "story.json");
  const validStory = readJson(storyPath);
  writeJson(storyPath, { ...validStory, phase: "implementation", status: "implementation" });
  writeJson(path.join(project, ".sdlc", "stories", "ST-001", "claim.json"), {
    story_id: "ST-001",
    agent: "codex",
    branch: "feature/ST-001",
    status: "active",
    claimed_at: new Date().toISOString(),
    expires_at: "not-a-date",
    audit: {},
  });
  mustFail(["gate", "check", "--root", project, "--story", "ST-001", "--strict"], /invalid expires_at/);
});

test("contract approval becomes stale after contract mutation", () => {
  const project = tmpProject("stale-approval");
  initProject(project);
  createStrictReadyStory(project, "ST-001");
  const contractPath = path.join(project, ".sdlc", "contracts", "contract-ST-001-design.json");
  const contract = readJson(contractPath);
  contract.outputs.push("unapproved extra output");
  writeJson(contractPath, contract);
  mustFail(["gate", "check", "--root", project, "--story", "ST-001", "--strict"], /approved human gate is stale/);
});

test("output duplicate new is blocked before registry write without matching decision", () => {
  const project = tmpProject("duplicate-output");
  initProject(project);
  story(project, "ST-001", ["--requirement", "REQ-001"]);
  story(project, "ST-002", ["--requirement", "REQ-001"]);
  createApprovedTemplate(project);
  const first = writeArtifact(project, ".sdlc/requirements/ST-001-functional.md");
  const second = writeArtifact(project, ".sdlc/requirements/ST-002-functional.md");
  mustRun([
    "output",
    "link",
    "--root",
    project,
    "--story",
    "ST-001",
    "--type",
    "functional-analysis",
    "--artifact",
    first,
    "--template",
    "functional-analysis-v1",
    "--mode",
    "new",
    "--requirement",
    "REQ-001",
  ]);
  mustFail(
    [
      "output",
      "link",
      "--root",
      project,
      "--story",
      "ST-002",
      "--type",
      "functional-analysis",
      "--artifact",
      second,
      "--template",
      "functional-analysis-v1",
      "--mode",
      "new",
      "--requirement",
      "REQ-001",
    ],
    /duplicates requirements already covered/,
  );
  const registry = readJson(path.join(project, ".sdlc", "output-contracts", "registry.json"));
  assert.equal(registry.links.length, 1);
});

test("output override decision cannot be reused for a different link", () => {
  const project = tmpProject("decision-subject");
  initProject(project);
  story(project, "ST-001", ["--requirement", "REQ-001"]);
  story(project, "ST-002", ["--requirement", "REQ-001"]);
  createApprovedTemplate(project);
  const first = writeArtifact(project, ".sdlc/requirements/ST-001.md");
  const second = writeArtifact(project, ".sdlc/requirements/ST-002.md");
  mustRun([
    "output",
    "link",
    "--root",
    project,
    "--story",
    "ST-001",
    "--type",
    "functional-analysis",
    "--artifact",
    first,
    "--template",
    "functional-analysis-v1",
    "--mode",
    "new",
    "--requirement",
    "REQ-001",
  ]);
  mustRun([
    "output",
    "link",
    "--root",
    project,
    "--story",
    "ST-002",
    "--type",
    "functional-analysis",
    "--artifact",
    second,
    "--template",
    "functional-analysis-v1",
    "--mode",
    "new",
    "--requirement",
    "REQ-001",
    "--decision-id",
    "DEC-override-001",
    "--rationale",
    "Separate artifact approved",
    "--actor-type",
    "human",
  ]);
  const third = writeArtifact(project, ".sdlc/requirements/ST-003.md");
  story(project, "ST-003", ["--requirement", "REQ-001"]);
  const registryPath = path.join(project, ".sdlc", "output-contracts", "registry.json");
  const registry = readJson(registryPath);
  registry.links.push({
    ...registry.links.find((link) => link.story_id === "ST-002"),
    id: "OUT-ST-003-functional-analysis-manual",
    story_id: "ST-003",
    artifact_path: third,
  });
  writeJson(registryPath, registry);
  mustFail(["gate", "check", "--root", project, "--strict"], /approved for a different output link subject/);
});

test("cache tampering is not used as source of truth for output resolve", () => {
  const project = tmpProject("cache-tamper");
  initProject(project);
  story(project, "ST-001", ["--requirement", "REQ-001"]);
  createApprovedTemplate(project);
  mustRun(["cache", "rebuild", "--root", project]);
  const cachePath = path.join(project, ".sdlc", "cache", "kb-cache.json");
  const cache = readJson(cachePath);
  cache.output_resolutions["ST-001::functional-analysis"].recommendation = "linked";
  writeJson(cachePath, cache);
  mustFail(["output", "resolve", "--root", project, "--story", "ST-001", "--type", "functional-analysis"], /cache output resolution differs/i);
});

test("unsafe config directories and symlink context escapes are blocked", () => {
  const project = tmpProject("safe-paths");
  const templateDir = tmpProject("bad-template");
  fs.cpSync(path.join(repoRoot, "templates"), templateDir, { recursive: true });
  const configPath = path.join(templateDir, "sdlc-config.json");
  const config = readJson(configPath);
  config.kb_directories = ["../../escape"];
  writeJson(configPath, config);
  mustFail(["init", "--root", project, "--template-dir", templateDir], /unsafe/);
  assert.equal(fs.existsSync(path.resolve(project, "..", "escape")), false);

  initProject(project);
  const outside = path.join(os.tmpdir(), `outside-${Date.now()}.md`);
  fs.writeFileSync(outside, "outside");
  fs.symlinkSync(outside, path.join(project, "outside-link.md"));
  mustFail(
    ["contract", "create", "--root", project, "--phase", "design", "--context-file", "outside-link.md"],
    /outside the target project root/,
  );
});

test("test and release traces require real canonical evidence in strict mode", () => {
  const project = tmpProject("trace-evidence");
  initProject(project);
  createStrictReadyStory(project, "ST-001");
  const storyPath = path.join(project, ".sdlc", "stories", "ST-001", "story.json");
  const storyData = readJson(storyPath);
  writeJson(storyPath, { ...storyData, phase: "validation", status: "validation" });
  mustRun(["trace", "append", "--root", project, "--story", "ST-001", "--type", "test", "--summary", "Tests passed"]);
  mustFail(["gate", "check", "--root", project, "--story", "ST-001", "--strict"], /test trace requires at least one evidence path/);

  const evidence = writeArtifact(project, ".sdlc/tests/ST-001-test-run.json", "{}\n");
  fs.rmSync(path.join(project, ".sdlc", "traces", "ST-001.jsonl"));
  mustRun(["trace", "append", "--root", project, "--story", "ST-001", "--type", "test", "--summary", "Tests passed", "--evidence", evidence]);
  writeJson(storyPath, { ...storyData, phase: "release", status: "release" });
  mustRun(["trace", "append", "--root", project, "--story", "ST-001", "--type", "release", "--summary", "Release ready"]);
  mustFail(["gate", "check", "--root", project, "--story", "ST-001", "--strict"], /release.*requires at least one evidence path/);
});

test("handoff open items block strict gate and handoff close clears them", () => {
  const project = tmpProject("handoff");
  initProject(project);
  createStrictReadyStory(project, "ST-001");
  mustRun([
    "story",
    "handoff",
    "--root",
    project,
    "--id",
    "ST-001",
    "--to-agent",
    "validation-agent",
    "--open-item",
    "Need reviewer",
  ]);
  mustFail(["gate", "check", "--root", project, "--story", "ST-001", "--strict"], /has open items/);
  const handoffId = readJson(path.join(project, ".sdlc", "handoffs", fs.readdirSync(path.join(project, ".sdlc", "handoffs"))[0])).id;
  mustRun(["story", "handoff", "close", "--root", project, "--id", handoffId, "--status", "closed"]);
  mustRun(["gate", "check", "--root", project, "--story", "ST-001", "--strict"]);
});

test("gate reports can be persisted", () => {
  const project = tmpProject("gate-report");
  initProject(project);
  createStrictReadyStory(project, "ST-001");
  mustRun(["gate", "check", "--root", project, "--story", "ST-001", "--strict", "--out", ".sdlc/reports/ST-001-gate-report.json"]);
  const report = readJson(path.join(project, ".sdlc", "reports", "ST-001-gate-report.json"));
  assert.equal(report.status, "passed");
  assert.equal(report.story_id, "ST-001");
  mustRun(["gate", "check", "--root", project, "--story", "ST-001", "--strict", "--out", ".sdlc/reports/ST-001-gate-report.md"]);
  assert.match(fs.readFileSync(path.join(project, ".sdlc", "reports", "ST-001-gate-report.md"), "utf8"), /SDLC Gate Report/);
});

test("output artifact and template changes after approval/link are gated", () => {
  const project = tmpProject("fingerprints");
  initProject(project);
  createStrictReadyStory(project, "ST-001");
  fs.appendFileSync(path.join(project, ".sdlc", "requirements", "ST-001-functional-analysis.md"), "\nchanged\n");
  mustFail(["gate", "check", "--root", project, "--story", "ST-001", "--strict"], /changed after it was linked/);
});

test("phase locks reject concurrent active locks on the same scope", () => {
  const project = tmpProject("locks");
  initProject(project);
  mustRun(["phase", "lock", "--root", project, "--phase", "analysis", "--scope", "shared"]);
  mustFail(["phase", "lock", "--root", project, "--phase", "analysis", "--scope", "shared"], /already has active lock/);
});

test("route decide returns init_project when canonical intent arrives before KB initialization", () => {
  const project = tmpProject("route-no-kb");
  const decision = routeDecision(project);
  assert.equal(decision.route, "init_project");
  assert.equal(decision.requires_confirmation, false);
  assert.ok(decision.next_commands.some((command) => command.includes("agentic-sdlc init")));
});

test("route decide does not inherit risky action confirmation before KB initialization", () => {
  const project = tmpProject("route-no-kb-implement");
  const decision = routeDecision(project, {
    requested_action: "implement_story",
    referenced_entities: [{ type: "story", id: "ST-001" }],
  });
  assert.equal(decision.route, "init_project");
  assert.equal(decision.requires_confirmation, false);
  assert.ok(decision.next_commands.some((command) => command.includes("agentic-sdlc init")));
});

test("route alias with raw text only asks for canonical normalization", () => {
  const project = tmpProject("route-raw-text");
  initProject(project);
  const result = mustRun(["route", "--root", project, "--json", "--text", "Implement ST-001"]);
  const decision = JSON.parse(result.stdout);
  assert.equal(decision.route, "ask_clarification");
  assert.equal(decision.status, "needs_normalization");
  assert.ok(decision.blocking_reasons.includes("needs_normalization"));
  assert.equal(decision.deterministic_checks.some((check) => check.check === "raw_text" && check.status === "ignored"), true);
});

test("route decide rejects canonical intent files from derived cache directories", () => {
  const project = tmpProject("route-cache-intent");
  initProject(project);
  const intentPath = path.join(project, ".sdlc", "cache", "route-intent.json");
  fs.mkdirSync(path.dirname(intentPath), { recursive: true });
  fs.writeFileSync(intentPath, routeIntent());
  const result = mustRun(["route", "decide", "--root", project, "--json", "--intent-file", ".sdlc/cache/route-intent.json"]);
  const decision = JSON.parse(result.stdout);
  assert.equal(decision.route, "ask_clarification");
  assert.ok(decision.blocking_reasons.includes("invalid_intent_json"));
  assert.equal(
    decision.deterministic_checks.some(
      (check) => check.check === "canonical_intent" && String(check.details).includes("derived artifacts"),
    ),
    true,
  );
});

test("route decide sends ready implementation story to claim_and_implement with confirmation", () => {
  const project = tmpProject("route-implement");
  initProject(project);
  createStrictReadyStory(project, "ST-001");
  const storyPath = path.join(project, ".sdlc", "stories", "ST-001", "story.json");
  const storyData = readJson(storyPath);
  writeJson(storyPath, { ...storyData, status: "ready", phase: "implementation" });

  const decision = routeDecision(project, {
    requested_action: "implement_story",
    referenced_entities: [{ type: "story", id: "ST-001" }],
  });
  assert.equal(decision.route, "claim_and_implement");
  assert.equal(decision.requires_confirmation, true);
  assert.ok(decision.next_commands.some((command) => command.includes("story claim --id ST-001")));
});

test("route decide asks to create a missing story before implementation", () => {
  const project = tmpProject("route-missing-story");
  initProject(project);
  const decision = routeDecision(project, {
    requested_action: "implement_story",
    referenced_entities: [{ type: "story", id: "ST-404" }],
  });
  assert.equal(decision.route, "ask_clarification");
  assert.ok(decision.blocking_reasons.includes("story_not_found"));
  assert.ok(decision.next_commands.some((command) => command.includes("story create --id ST-404")));
});

test("route decide confirms phase skip for functional analysis", () => {
  const project = tmpProject("route-skip");
  initProject(project);
  const decision = routeDecision(project, {
    requested_action: "functional_analysis",
    proposed_phase: "analysis",
    artifact_type: "functional-analysis",
    skip_phases: ["discovery"],
  });
  assert.equal(decision.route, "confirm_phase_skip");
  assert.equal(decision.requires_confirmation, true);
  assert.ok(decision.next_commands.some((command) => command.includes("Approved phase skip: discovery")));
});

test("route decide asks when canonical confidence is low", () => {
  const project = tmpProject("route-low-confidence");
  initProject(project);
  const decision = routeDecision(project, {
    requested_action: "intake_requirement",
    confidence: 0.2,
  });
  assert.equal(decision.route, "ask_clarification");
  assert.equal(decision.status, "low_confidence");
  assert.ok(decision.blocking_reasons.includes("low_confidence"));
});

test("schemas and JSON templates parse", () => {
  for (const directory of ["schemas", "templates"]) {
    for (const entry of fs.readdirSync(path.join(repoRoot, directory))) {
      if (entry.endsWith(".json")) {
        assert.doesNotThrow(() => JSON.parse(fs.readFileSync(path.join(repoRoot, directory, entry), "utf8")), entry);
      }
    }
  }
});
