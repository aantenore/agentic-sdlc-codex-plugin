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

function humanApproval(summary = "Approved in test") {
  return ["--actor-type", "human", "--approval-source", "explicit-user", "--summary", summary];
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
  mustRun(["output", "template", "approve", "--root", project, "--id", `${type}-v1`, ...humanApproval("Approved template")]);
}

function writeArtifact(project, relativePath, body = "# Artifact\n") {
  const filePath = path.join(project, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, body);
  return relativePath;
}

function createApprovedStoryContract(project, id, phase = "design", artifactType = "functional-analysis") {
  mustRun([
    "contract",
    "create",
    "--root",
    project,
    "--phase",
    phase,
    "--story",
    id,
    "--id",
    `contract-${id}-${phase}`,
    "--context-summary",
    `Ready ${phase} contract`,
    "--qa",
    "Who approves?|Owner",
    "--output-ref",
    `${artifactType}:${artifactType}-v1:new`,
    "--force",
  ]);
  mustRun(["contract", "approve", "--root", project, "--id", `contract-${id}-${phase}`, ...humanApproval("Approved contract")]);
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
  story(project, id, ["--requirement", "REQ-001"]);
  createApprovedTemplate(project, artifactType);
  createApprovedStoryContract(project, id, "design", artifactType);
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

test("story create persists acceptance criteria with human-readable alias", () => {
  const project = tmpProject("story-acceptance-alias");
  initProject(project);
  const created = JSON.parse(mustRun([
    "story",
    "create",
    "--root",
    project,
    "--id",
    "ST-ACCEPTANCE",
    "--title",
    "Story acceptance alias",
    "--acceptance",
    "The current architecture assessment is observable and actionable",
    "--json",
  ]).stdout);
  assert.deepEqual(created.story.acceptance_criteria, ["The current architecture assessment is observable and actionable"]);
  assert.deepEqual(created.story.acceptance, ["The current architecture assessment is observable and actionable"]);

  const stored = readJson(path.join(project, ".sdlc", "stories", "ST-ACCEPTANCE", "story.json"));
  assert.deepEqual(stored.acceptance_criteria, ["The current architecture assessment is observable and actionable"]);
  assert.deepEqual(stored.acceptance, ["The current architecture assessment is observable and actionable"]);
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

test("formal approvals require explicit source and summary or evidence", () => {
  const project = tmpProject("approval-policy");
  initProject(project);
  mustRun([
    "contract",
    "create",
    "--root",
    project,
    "--phase",
    "analysis",
    "--id",
    "contract-approval-policy",
    "--context-summary",
    "Approval policy test",
    "--qa",
    "Who approves?|Owner",
    "--force",
  ]);
  mustFail(
    ["contract", "approve", "--root", project, "--id", "contract-approval-policy", "--actor-type", "human"],
    /requires --approval-source/,
  );
  mustFail(
    [
      "contract",
      "approve",
      "--root",
      project,
      "--id",
      "contract-approval-policy",
      "--actor-type",
      "human",
      "--approval-source",
      "explicit-user",
    ],
    /requires --summary or --approval-evidence/,
  );
  mustRun(["contract", "approve", "--root", project, "--id", "contract-approval-policy", ...humanApproval("Explicitly approved")]);
});

test("onboard existing project initializes KB and proposes approvable baseline", () => {
  const project = tmpProject("onboard-existing");
  fs.writeFileSync(path.join(project, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }, null, 2));
  fs.writeFileSync(path.join(project, "README.md"), "# Legacy App\nCurrent project description.\n");

  const onboard = JSON.parse(mustRun([
    "onboard",
    "existing-project",
    "--root",
    project,
    "--project-name",
    "Legacy App",
    "--document",
    "README.md",
    "--question",
    "Which inferred facts are canonical?",
    "--json",
  ]).stdout);
  assert.equal(onboard.initialized, true);
  assert.equal(onboard.baseline.status, "proposed");
  assert.equal(fs.existsSync(path.join(project, ".sdlc", "project.json")), true);
  assert.equal(fs.existsSync(path.join(project, ".sdlc", "baseline", "BASELINE-INITIAL.json")), true);
  assert.ok(onboard.baseline.imported_documents.some((document) => document.path === "README.md"));
  assert.ok(onboard.baseline.repository_snapshot.detected_stack.some((item) => item.name === "package-json"));

  mustFail(["baseline", "approve", "--root", project, "--id", "BASELINE-INITIAL", "--actor-type", "human"], /requires --approval-source/);
  mustRun(["baseline", "approve", "--root", project, "--id", "BASELINE-INITIAL", ...humanApproval("Confirmed baseline for existing project")]);
  const approved = readJson(path.join(project, ".sdlc", "baseline", "BASELINE-INITIAL.json"));
  assert.equal(approved.status, "approved");
  assert.equal(approved.approvals.at(-1).approval_source, "explicit-user");

  fs.appendFileSync(path.join(project, "README.md"), "\nChanged after baseline.\n");
  const status = JSON.parse(mustRun(["baseline", "status", "--root", project, "--id", "BASELINE-INITIAL", "--json"]).stdout);
  assert.equal(status.baselines[0].stale, true);

  mustRun(["cache", "rebuild", "--root", project]);
  const cache = readJson(path.join(project, ".sdlc", "cache", "kb-cache.json"));
  assert.ok(cache.source_paths.includes(".sdlc/baseline/BASELINE-INITIAL.json"));
});

test("output duplicate new is blocked before registry write without matching decision", () => {
  const project = tmpProject("duplicate-output");
  initProject(project);
  story(project, "ST-001", ["--requirement", "REQ-001"]);
  story(project, "ST-002", ["--requirement", "REQ-001"]);
  createApprovedTemplate(project);
  createApprovedStoryContract(project, "ST-001");
  createApprovedStoryContract(project, "ST-002");
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
  createApprovedStoryContract(project, "ST-001");
  createApprovedStoryContract(project, "ST-002");
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
    ...humanApproval("Approved output override"),
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

test("work items and approved breakdown are persisted and indexed as canonical KB", () => {
  const project = tmpProject("work-breakdown");
  initProject(project);
  story(project, "ST-001", ["--requirement", "REQ-001", "--breakdown", "BD-REQ-001"]);
  mustRun(["work", "item", "create", "--root", project, "--type", "epic", "--id", "EP-001", "--title", "Epic 001", "--requirement", "REQ-001"]);
  mustRun(["work", "item", "create", "--root", project, "--type", "task", "--id", "TASK-001", "--title", "Task 001", "--parent", "EP-001", "--story", "ST-001"]);
  mustRun([
    "breakdown",
    "propose",
    "--root",
    project,
    "--id",
    "BD-REQ-001",
    "--requirement",
    "REQ-001",
    "--item",
    "epic:EP-001",
    "--item",
    "story:ST-001",
    "--item",
    "task:TASK-001",
    "--rationale",
    "Split requirement into epic, story, and task",
  ]);
  mustRun(["breakdown", "approve", "--root", project, "--id", "BD-REQ-001", ...humanApproval("Approved breakdown")]);
  const breakdown = readJson(path.join(project, ".sdlc", "work-breakdown", "BD-REQ-001.json"));
  assert.equal(breakdown.status, "approved");
  assert.equal(readJson(path.join(project, ".sdlc", "work-items", "epics", "EP-001.json")).type, "epic");
  mustRun(["cache", "rebuild", "--root", project]);
  const cache = readJson(path.join(project, ".sdlc", "cache", "kb-cache.json"));
  assert.ok(cache.source_paths.includes(".sdlc/work-breakdown/BD-REQ-001.json"));
  assert.ok(cache.source_paths.includes(".sdlc/dependencies/graph.json"));
});

test("strict gate blocks story delivery when referenced breakdown is not approved", () => {
  const project = tmpProject("breakdown-gate");
  initProject(project);
  createStrictReadyStory(project, "ST-001");
  const storyPath = path.join(project, ".sdlc", "stories", "ST-001", "story.json");
  const storyData = readJson(storyPath);
  writeJson(storyPath, { ...storyData, status: "implementation", phase: "implementation", work_breakdown_id: "BD-REQ-001" });
  mustRun(["story", "claim", "--root", project, "--id", "ST-001", "--agent", "codex", "--branch", "feature/ST-001"]);
  mustRun([
    "breakdown",
    "propose",
    "--root",
    project,
    "--id",
    "BD-REQ-001",
    "--requirement",
    "REQ-001",
    "--item",
    "story:ST-001",
  ]);
  mustFail(["gate", "check", "--root", project, "--story", "ST-001", "--strict"], /not approved/);
});

test("contract capability policy requires bindings and rejects overlaps", () => {
  const project = tmpProject("capability-contract");
  initProject(project);
  createStrictReadyStory(project, "ST-001");
  const storyPath = path.join(project, ".sdlc", "stories", "ST-001", "story.json");
  const storyData = readJson(storyPath);
  writeJson(storyPath, { ...storyData, status: "implementation", phase: "implementation", contract_id: "contract-ST-001-implementation" });
  mustRun(["story", "claim", "--root", project, "--id", "ST-001", "--agent", "codex", "--branch", "feature/ST-001"]);
  const policy = JSON.stringify({
    skills: { required: ["agentic-sdlc"], allowed: [], forbidden: [] },
    mcp: { required: ["repo"], allowed: [], forbidden: [] },
    tools: { required: [], allowed: ["test-runner"], forbidden: [] },
    approval_required_for: ["production_write"],
  });
  const binding = JSON.stringify({
    type: "mcp",
    name: "repo",
    binding_id: "repo-main",
    target: { repo: "local" },
    permissions: ["read"],
  });
  mustRun([
    "contract",
    "create",
    "--root",
    project,
    "--phase",
    "implementation",
    "--story",
    "ST-001",
    "--id",
    "contract-ST-001-implementation",
    "--context-summary",
    "Implementation capability contract",
    "--qa",
    "Who approves?|Owner",
    "--output-ref",
    "functional-analysis:functional-analysis-v1:new",
    "--capability-policy-json",
    policy,
    "--force",
  ]);
  mustRun(["contract", "approve", "--root", project, "--id", "contract-ST-001-implementation", ...humanApproval("Approved implementation contract")]);
  mustFail(["gate", "check", "--root", project, "--story", "ST-001", "--strict"], /requires mcp capability 'repo'/);
  mustRun([
    "contract",
    "create",
    "--root",
    project,
    "--phase",
    "implementation",
    "--story",
    "ST-001",
    "--id",
    "contract-ST-001-implementation",
    "--context-summary",
    "Implementation capability contract",
    "--qa",
    "Who approves?|Owner",
    "--output-ref",
    "functional-analysis:functional-analysis-v1:new",
    "--capability-policy-json",
    policy,
    "--capability-binding-json",
    binding,
    "--force",
  ]);
  mustRun(["contract", "approve", "--root", project, "--id", "contract-ST-001-implementation", ...humanApproval("Approved implementation contract")]);
  mustRun(["gate", "check", "--root", project, "--story", "ST-001", "--strict"]);
  const overlap = JSON.stringify({
    skills: { required: [], allowed: ["agentic-sdlc"], forbidden: ["agentic-sdlc"] },
    mcp: { required: [], allowed: [], forbidden: [] },
    tools: { required: [], allowed: [], forbidden: [] },
    approval_required_for: [],
  });
  mustFail(["contract", "create", "--root", project, "--phase", "analysis", "--capability-policy-json", overlap], /cannot be both allowed and forbidden/);
});

test("capability binding files cannot come from derived cache directories", () => {
  const project = tmpProject("capability-cache");
  initProject(project);
  const bindingPath = path.join(project, ".sdlc", "cache", "binding.json");
  fs.mkdirSync(path.dirname(bindingPath), { recursive: true });
  fs.writeFileSync(bindingPath, JSON.stringify({ type: "mcp", name: "repo", binding_id: "repo-main", target: { repo: "local" } }));
  mustFail(
    ["contract", "create", "--root", project, "--phase", "analysis", "--capability-binding-file", ".sdlc/cache/binding.json"],
    /derived artifacts/,
  );
});

test("capability profiles and recommendations can be approved and applied to contracts", () => {
  const project = tmpProject("capability-discovery");
  initProject(project);
  fs.writeFileSync(path.join(project, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
  story(project, "ST-001");
  createApprovedTemplate(project, "technical-analysis");
  mustRun([
    "capability",
    "profile",
    "propose",
    "--root",
    project,
    "--id",
    "CAP-PROFILE-ST-001",
    "--story",
    "ST-001",
    "--phase",
    "analysis",
    "--context-file",
    "package.json",
  ]);
  mustRun(["capability", "profile", "approve", "--root", project, "--id", "CAP-PROFILE-ST-001", ...humanApproval("Approved capability profile")]);
  const recommendation = JSON.stringify({
    recommendations: [
      { type: "skill", name: "agentic-sdlc", availability: "available", install_required: false },
      { type: "mcp", name: "repo", availability: "available", install_required: false }
    ],
    policy_patch: {
      skills: { required: ["agentic-sdlc"], allowed: [], forbidden: [] },
      mcp: { required: ["repo"], allowed: [], forbidden: [] },
      tools: { required: [], allowed: [], forbidden: [] },
      approval_required_for: []
    },
    bindings: [
      { type: "mcp", name: "repo", binding_id: "repo-main", target: { repo: "local" }, permissions: ["read"] }
    ],
    execution_policy_suggestions: { reasoning: "high", notes: ["Use high reasoning for architecture tradeoffs"] },
    decision_matrix: [{ option: "local repo", recommendation: "use" }]
  });
  mustRun([
    "capability",
    "recommend",
    "--root",
    project,
    "--id",
    "CAP-REC-ST-001",
    "--profile",
    "CAP-PROFILE-ST-001",
    "--recommendation-json",
    recommendation,
  ]);
  mustRun(["capability", "approve", "--root", project, "--id", "CAP-REC-ST-001", ...humanApproval("Approved capability recommendation")]);
  const contract = JSON.parse(mustRun([
    "contract",
    "create",
    "--root",
    project,
    "--phase",
    "analysis",
    "--story",
    "ST-001",
    "--id",
    "contract-ST-001-analysis",
    "--context-summary",
    "Analyze with approved capability discovery.",
    "--output-ref",
    "technical-analysis:technical-analysis-v1:new",
    "--capability-recommendation",
    "CAP-REC-ST-001",
    "--json",
  ]).stdout).contract;
  assert.equal(contract.capability_policy.mcp.required.includes("repo"), true);
  assert.equal(contract.capability_bindings.some((binding) => binding.name === "repo"), true);
  assert.equal(contract.execution_policy.reasoning.level, "high");
  assert.equal(contract.capability_recommendation_refs[0].id, "CAP-REC-ST-001");
});

test("install-required capability recommendation blocks strict gate without install approval", () => {
  const project = tmpProject("capability-install");
  initProject(project);
  story(project, "ST-001", ["--contract", "contract-ST-001-analysis"]);
  createApprovedTemplate(project, "technical-analysis");
  mustRun(["capability", "profile", "propose", "--root", project, "--id", "CAP-PROFILE-ST-001", "--story", "ST-001"]);
  mustRun(["capability", "profile", "approve", "--root", project, "--id", "CAP-PROFILE-ST-001", ...humanApproval("Approved capability profile")]);
  mustRun([
    "capability",
    "recommend",
    "--root",
    project,
    "--id",
    "CAP-REC-INSTALL",
    "--profile",
    "CAP-PROFILE-ST-001",
    "--recommendation-json",
    JSON.stringify({
      recommendations: [{ type: "skill", name: "missing-skill", availability: "install_required", install_required: true }],
      policy_patch: {
        skills: { required: ["missing-skill"], allowed: [], forbidden: [] },
        mcp: { required: [], allowed: [], forbidden: [] },
        tools: { required: [], allowed: [], forbidden: [] },
        approval_required_for: ["skill:missing-skill"]
      }
    }),
  ]);
  mustRun(["capability", "approve", "--root", project, "--id", "CAP-REC-INSTALL", ...humanApproval("Approved install recommendation without install")]);
  mustFail([
    "contract",
    "create",
    "--root",
    project,
    "--phase",
    "analysis",
    "--story",
    "ST-001",
    "--id",
    "contract-ST-001-analysis",
    "--context-summary",
    "Analyze with missing install approval.",
    "--output-ref",
    "technical-analysis:technical-analysis-v1:new",
    "--capability-recommendation",
    "CAP-REC-INSTALL",
  ], /without install approval/);
  mustRun(["capability", "approve", "--root", project, "--id", "CAP-REC-INSTALL", "--approve-install", ...humanApproval("Approved install-required capability")]);
  mustRun([
    "contract",
    "create",
    "--root",
    project,
    "--phase",
    "analysis",
    "--story",
    "ST-001",
    "--id",
    "contract-ST-001-analysis",
    "--context-summary",
    "Analyze with install-approved capability.",
    "--output-ref",
    "technical-analysis:technical-analysis-v1:new",
    "--capability-recommendation",
    "CAP-REC-INSTALL",
    "--force",
  ]);
});

test("stale capability recommendation source fails strict gate", () => {
  const project = tmpProject("capability-stale");
  initProject(project);
  story(project, "ST-001", ["--contract", "contract-ST-001-analysis"]);
  const source = writeArtifact(project, ".sdlc/requirements/REQ-001.md", "# Requirement\n");
  createApprovedTemplate(project, "technical-analysis");
  const analysisArtifact = writeArtifact(project, ".sdlc/requirements/ST-001-technical-analysis.md", "# Technical Analysis\n");
  mustRun([
    "capability",
    "profile",
    "propose",
    "--root",
    project,
    "--id",
    "CAP-PROFILE-ST-001",
    "--story",
    "ST-001",
    "--context-file",
    source,
  ]);
  mustRun(["capability", "profile", "approve", "--root", project, "--id", "CAP-PROFILE-ST-001", ...humanApproval("Approved capability profile")]);
  mustRun(["capability", "recommend", "--root", project, "--id", "CAP-REC-ST-001", "--profile", "CAP-PROFILE-ST-001"]);
  mustRun(["capability", "approve", "--root", project, "--id", "CAP-REC-ST-001", ...humanApproval("Approved capability recommendation")]);
  mustRun([
    "contract",
    "create",
    "--root",
    project,
    "--phase",
    "analysis",
    "--story",
    "ST-001",
    "--id",
    "contract-ST-001-analysis",
    "--context-summary",
    "Analyze with approved recommendation.",
    "--output-ref",
    "technical-analysis:technical-analysis-v1:new",
    "--capability-recommendation",
    "CAP-REC-ST-001",
    "--force",
  ]);
  mustRun(["contract", "approve", "--root", project, "--id", "contract-ST-001-analysis", ...humanApproval("Approved analysis contract")]);
  mustRun([
    "output",
    "link",
    "--root",
    project,
    "--story",
    "ST-001",
    "--type",
    "technical-analysis",
    "--artifact",
    analysisArtifact,
    "--template",
    "technical-analysis-v1",
    "--mode",
    "new",
    "--requirement",
    "REQ-001",
  ]);
  fs.appendFileSync(path.join(project, source), "\nchanged\n");
  mustFail(["gate", "check", "--root", project, "--story", "ST-001", "--strict"], /changed after record creation/);
});

test("technical analysis route suggests capability discovery when no profile exists", () => {
  const project = tmpProject("capability-route");
  initProject(project);
  story(project, "ST-001");
  const decision = routeDecision(project, {
    requested_action: "technical_analysis",
    proposed_phase: "analysis",
    artifact_type: "technical-analysis",
    referenced_entities: [{ type: "story", id: "ST-001" }],
  });
  assert.ok(decision.blocking_reasons.includes("capability_profile_missing"));
  assert.ok(decision.next_commands.some((command) => command.includes("capability profile propose")));
});

test("cache rebuild includes capability discovery sources", () => {
  const project = tmpProject("capability-cache-source");
  initProject(project);
  mustRun(["capability", "profile", "propose", "--root", project, "--id", "CAP-PROJECT"]);
  const cache = JSON.parse(mustRun(["cache", "rebuild", "--root", project, "--json"]).stdout);
  assert.equal(cache.status, "rebuilt");
  const cacheFile = readJson(path.join(project, ".sdlc", "cache", "kb-cache.json"));
  assert.equal(cacheFile.source_paths.some((sourcePath) => sourcePath.includes("capability-discovery/profiles/CAP-PROJECT.json")), true);
});

test("dependency graph blocks orchestration and strict gate until upstream is satisfied", () => {
  const project = tmpProject("dependencies-block");
  initProject(project);
  story(project, "ST-001");
  story(project, "ST-002");
  mustRun([
    "dependency",
    "propose",
    "--root",
    project,
    "--id",
    "DEP-001",
    "--edge",
    "ST-002:ST-001:blocks:implementation:done",
  ]);
  mustRun(["dependency", "approve", "--root", project, "--id", "DEP-001", ...humanApproval("Approved dependency")]);
  const plan = JSON.parse(mustRun(["orchestrate", "plan", "--root", project, "--json"]).stdout);
  assert.equal(plan.candidates.some((candidate) => candidate.story_id === "ST-002"), false);
  const storyPath = path.join(project, ".sdlc", "stories", "ST-002", "story.json");
  const storyData = readJson(storyPath);
  writeJson(storyPath, { ...storyData, status: "implementation", phase: "implementation" });
  mustFail(["gate", "check", "--root", project, "--story", "ST-002", "--strict"], /depends on ST-001/);
});

test("soft dependency is visible but does not block orchestration", () => {
  const project = tmpProject("dependencies-soft");
  initProject(project);
  story(project, "ST-001");
  story(project, "ST-002");
  mustRun([
    "dependency",
    "propose",
    "--root",
    project,
    "--id",
    "DEP-RELATED",
    "--edge",
    "ST-002:ST-001:related:none:exists",
  ]);
  mustRun(["dependency", "approve", "--root", project, "--id", "DEP-RELATED", ...humanApproval("Approved related dependency")]);
  const status = JSON.parse(mustRun(["orchestrate", "status", "--root", project, "--json"]).stdout);
  const storyStatus = status.stories.find((item) => item.id === "ST-002");
  assert.equal(storyStatus.orchestration_state, "available");
  assert.ok(storyStatus.warnings.some((warning) => warning.includes("ST-002 depends on ST-001")));
});

test("blocking dependency cycles fail strict gate", () => {
  const project = tmpProject("dependencies-cycle");
  initProject(project);
  story(project, "ST-001");
  story(project, "ST-002");
  mustRun(["dependency", "propose", "--root", project, "--id", "DEP-A", "--edge", "ST-001:ST-002:blocks:implementation:done"]);
  mustRun(["dependency", "approve", "--root", project, "--id", "DEP-A", ...humanApproval("Approved dependency A")]);
  mustRun(["dependency", "propose", "--root", project, "--id", "DEP-B", "--edge", "ST-002:ST-001:blocks:implementation:done"]);
  mustRun(["dependency", "approve", "--root", project, "--id", "DEP-B", ...humanApproval("Approved dependency B")]);
  const storyPath = path.join(project, ".sdlc", "stories", "ST-001", "story.json");
  const storyData = readJson(storyPath);
  writeJson(storyPath, { ...storyData, status: "implementation", phase: "implementation" });
  mustFail(["gate", "check", "--root", project, "--story", "ST-001", "--strict"], /blocking dependency cycle/);
});

test("downstream dependency becomes stale when upstream artifact changes until revalidated", () => {
  const project = tmpProject("dependencies-stale");
  initProject(project);
  createStrictReadyStory(project, "ST-001");
  story(project, "ST-002");
  mustRun([
    "dependency",
    "propose",
    "--root",
    project,
    "--id",
    "DEP-ARTIFACT",
    "--edge",
    "ST-002:ST-001:requires_artifact:validation:artifact_linked",
  ]);
  mustRun(["dependency", "approve", "--root", project, "--id", "DEP-ARTIFACT", ...humanApproval("Approved artifact dependency")]);
  fs.appendFileSync(path.join(project, ".sdlc", "requirements", "ST-001-functional-analysis.md"), "\nchanged upstream\n");
  const stale = JSON.parse(mustRun(["dependency", "status", "--root", project, "--story", "ST-002", "--json"]).stdout);
  assert.ok(stale.blockers.some((blocker) => blocker.includes("requires revalidation")));
  mustRun([
    "trace",
    "append",
    "--root",
    project,
    "--story",
    "ST-002",
    "--type",
    "test",
    "--summary",
    "Revalidated downstream after upstream artifact change",
    "--action",
    "dependency.revalidate",
    "--related",
    "ST-001",
  ]);
  const revalidated = JSON.parse(mustRun(["dependency", "status", "--root", project, "--story", "ST-002", "--json"]).stdout);
  assert.equal(revalidated.blockers.some((blocker) => blocker.includes("requires revalidation")), false);
});

test("route decide returns init_project when canonical intent arrives before KB initialization", () => {
  const project = tmpProject("route-no-kb");
  const decision = routeDecision(project);
  assert.equal(decision.route, "init_project");
  assert.equal(decision.requires_confirmation, false);
  assert.ok(decision.next_commands.some((command) => command.includes("agentic-sdlc init")));
});

test("route decide returns onboarding when canonical intent targets an existing project", () => {
  const project = tmpProject("route-onboard");
  const decision = routeDecision(project, {
    requested_action: "onboard_existing_project",
    provided_artifacts: [{ type: "document", path: "README.md" }],
  });
  assert.equal(decision.route, "onboard_existing_project");
  assert.ok(decision.next_commands.some((command) => command.includes("onboard existing-project")));

  initProject(project);
  const initializedDecision = routeDecision(project, {
    requested_action: "onboard_existing_project",
    provided_artifacts: [{ type: "document", path: "README.md" }],
  });
  assert.equal(initializedDecision.route, "onboard_existing_project");
  assert.ok(initializedDecision.next_commands.some((command) => command.includes("baseline propose")));
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

test("task start is the SDLC front door before phase work", () => {
  const rawProject = tmpProject("task-start-raw");
  initProject(rawProject);
  const raw = JSON.parse(mustRun(["task", "start", "--root", rawProject, "--json", "--text", "Implement ST-001"]).stdout);
  assert.equal(raw.status, "needs_normalization");
  assert.equal(raw.execution_allowed, false);
  assert.ok(raw.blocking_reasons.includes("needs_normalization"));

  const missingProject = tmpProject("task-start-missing-contract");
  initProject(missingProject);
  story(missingProject, "ST-001");
  const missing = JSON.parse(mustRun([
    "task",
    "start",
    "--root",
    missingProject,
    "--json",
    "--intent-json",
    routeIntent({
      requested_action: "implement_story",
      referenced_entities: [{ type: "story", id: "ST-001" }],
      proposed_phase: "implementation",
    }),
  ]).stdout);
  assert.equal(missing.status, "needs_user_input");
  assert.equal(missing.execution_allowed, false);
  assert.equal(missing.contract_action, "create_or_revise_contract");
  assert.ok(missing.blocking_reasons.includes("contract_negotiation_required"));
  assert.ok(missing.questions.some((question) => question.includes("No approved implementation contract")));
  assert.equal(missing.assistant_message_source_language, "en");
  assert.equal(missing.assistant_message_presentation.translate_to_chat_language, true);
  assert.match(missing.assistant_message_presentation.instruction, /active chat language/);

  const readyProject = tmpProject("task-start-ready");
  initProject(readyProject);
  story(readyProject, "ST-001", ["--contract", "contract-ST-001-implementation"]);
  createApprovedTemplate(readyProject, "implementation-summary");
  mustRun([
    "contract",
    "create",
    "--root",
    readyProject,
    "--phase",
    "implementation",
    "--story",
    "ST-001",
    "--id",
    "contract-ST-001-implementation",
    "--context-summary",
    "Implement the approved story under the agreed contract.",
    "--qa",
    "Who confirms start?|Human user",
    "--output-ref",
    "implementation-summary:implementation-summary-v1:new",
  ]);
  mustRun(["contract", "approve", "--root", readyProject, "--id", "contract-ST-001-implementation", ...humanApproval("Approved implementation contract")]);
  const storyPath = path.join(readyProject, ".sdlc", "stories", "ST-001", "story.json");
  const storyData = readJson(storyPath);
  writeJson(storyPath, { ...storyData, status: "ready", phase: "implementation" });

  const intent = routeIntent({
    requested_action: "implement_story",
    referenced_entities: [{ type: "story", id: "ST-001" }],
    proposed_phase: "implementation",
  });
  const unconfirmed = JSON.parse(mustRun([
    "task",
    "start",
    "--root",
    readyProject,
    "--json",
    "--intent-json",
    intent,
  ]).stdout);
  assert.equal(unconfirmed.status, "needs_user_input");
  assert.equal(unconfirmed.execution_allowed, false);
  assert.equal(unconfirmed.contract_action, "confirm_start");
  assert.ok(unconfirmed.blocking_reasons.includes("route_requires_confirmation"));
  assert.equal(unconfirmed.contract.approved, true);

  const confirmed = JSON.parse(mustRun([
    "task",
    "start",
    "--root",
    readyProject,
    "--json",
    "--intent-json",
    intent,
    "--confirm-start",
  ]).stdout);
  assert.equal(confirmed.status, "ready_to_execute");
  assert.equal(confirmed.execution_allowed, true);
  assert.equal(confirmed.contract_id, "contract-ST-001-implementation");

  const revision = JSON.parse(mustRun([
    "task",
    "start",
    "--root",
    readyProject,
    "--json",
    "--intent-json",
    intent,
    "--confirm-start",
    "--revise-contract",
  ]).stdout);
  assert.equal(revision.status, "contract_revision_required");
  assert.equal(revision.execution_allowed, false);
  assert.equal(revision.contract_action, "revise_contract");
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

test("story step completion requires linked outputs and prepares releasable handoff packages", () => {
  const project = tmpProject("step-handoff");
  initProject(project);
  story(project, "ST-MISSING");
  createApprovedTemplate(project);
  createApprovedStoryContract(project, "ST-MISSING");
  mustFail(
    [
      "story",
      "complete-step",
      "--root",
      project,
      "--id",
      "ST-MISSING",
      "--step",
      "functional-analysis",
      "--type",
      "functional-analysis",
      "--summary",
      "Trying to close without output link",
    ],
    /no linked functional-analysis output/,
  );

  story(project, "ST-001", ["--requirement", "REQ-001"]);
  createApprovedStoryContract(project, "ST-001");
  const artifact = writeArtifact(project, ".sdlc/requirements/ST-001-functional-analysis.md");
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
    artifact,
    "--template",
    "functional-analysis-v1",
    "--mode",
    "new",
    "--requirement",
    "REQ-001",
  ]);
  mustRun(["story", "claim", "--root", project, "--id", "ST-001", "--agent", "analysis-agent", "--branch", "feature/ST-001"]);
  const completed = JSON.parse(mustRun([
    "story",
    "complete-step",
    "--root",
    project,
    "--id",
    "ST-001",
    "--step",
    "functional-analysis",
    "--type",
    "functional-analysis",
    "--summary",
    "Functional analysis accepted for implementation",
    "--json",
  ]).stdout);
  assert.equal(completed.step.status, "completed");
  assert.equal(completed.step.output_links.length, 1);
  assert.equal(fs.existsSync(path.join(project, ".sdlc", "stories", "ST-001", "steps", "functional-analysis.json")), true);

  const handoff = JSON.parse(mustRun([
    "story",
    "prepare-handoff",
    "--root",
    project,
    "--id",
    "ST-001",
    "--to-agent",
    "implementation-agent",
    "--summary",
    "Ready for implementation",
    "--release-claim",
    "--json",
  ]).stdout);
  assert.equal(handoff.status, "prepared");
  assert.equal(handoff.release.claim.status, "released");
  assert.equal(fs.existsSync(handoff.package_path), true);
  assert.ok(handoff.handoff.required_artifacts.some((artifact) => artifact.endsWith("-package.json")));
});

test("activity reports summarize only canonical trace events inside the selected window", () => {
  const project = tmpProject("activity-report");
  initProject(project);
  story(project, "ST-001");
  mustRun([
    "trace",
    "append",
    "--root",
    project,
    "--story",
    "ST-001",
    "--type",
    "decision",
    "--summary",
    "Recent product decision",
    "--actor",
    "codex",
  ]);
  fs.appendFileSync(path.join(project, ".sdlc", "traces", "ST-001.jsonl"), `${JSON.stringify({
    id: "TR-OLD",
    story_id: "ST-001",
    type: "decision",
    summary: "Old decision outside window",
    actor: { id: "codex", type: "agent" },
    action: "decision",
    evidence: [],
    related: [],
    git: {},
    run: {},
    created_at: "2000-01-01T00:00:00.000Z",
  })}\n`);
  const report = JSON.parse(mustRun([
    "report",
    "activity",
    "--root",
    project,
    "--since",
    "3d",
    "--view",
    "dev",
    "--json",
  ]).stdout);
  assert.equal(report.summary.event_count, 1);
  assert.equal(report.items[0].summary, "Recent product decision");
  assert.equal(report.items[0].sources[0].path, ".sdlc/traces/ST-001.jsonl");

  mustRun([
    "report",
    "activity",
    "--root",
    project,
    "--since",
    "3d",
    "--view",
    "business",
    "--out",
    ".sdlc/reports/activity.md",
  ]);
  assert.match(fs.readFileSync(path.join(project, ".sdlc", "reports", "activity.md"), "utf8"), /Recent product decision/);
});

test("report query requires canonical normalization for raw natural language", () => {
  const project = tmpProject("report-query-normalize");
  initProject(project);
  const guidance = JSON.parse(mustRun([
    "report",
    "query",
    "--root",
    project,
    "--text",
    "show all changes made by me",
    "--json",
  ]).stdout);
  assert.equal(guidance.status, "needs_normalization");
  assert.match(guidance.rule, /never keyword-matches/);
  assert.ok(guidance.examples.some((example) => example.query.subjects.includes("activity")));
});

test("report query filters canonical records by actor and source", () => {
  const project = tmpProject("report-query-actor");
  initProject(project);
  story(project, "ST-001");
  mustRun([
    "trace",
    "append",
    "--root",
    project,
    "--story",
    "ST-001",
    "--type",
    "implementation",
    "--summary",
    "Implemented actor scoped change",
    "--actor",
    "antonio",
  ]);
  mustRun([
    "trace",
    "append",
    "--root",
    project,
    "--story",
    "ST-001",
    "--type",
    "decision",
    "--summary",
    "Other actor change",
    "--actor",
    "codex",
  ]);
  const query = JSON.stringify({
    intent: "find_changes_by_actor",
    confidence: 0.96,
    subjects: ["activity"],
    filters: { actor: ["antonio"] },
    sort: "created_at_desc",
  });
  const report = JSON.parse(mustRun(["report", "query", "--root", project, "--query-json", query, "--json"]).stdout);
  assert.equal(report.summary.result_count, 1);
  assert.equal(report.results[0].summary, "Implemented actor scoped change");
  assert.equal(report.results[0].sources[0].path, ".sdlc/traces/ST-001.jsonl");

  const queryPath = path.join(project, ".sdlc", "cache", "report-query.json");
  fs.mkdirSync(path.dirname(queryPath), { recursive: true });
  fs.writeFileSync(queryPath, query);
  mustFail(["report", "query", "--root", project, "--query-file", ".sdlc/cache/report-query.json"], /derived artifacts/);
});

test("contract create asks before missing guidance or story output agreement", () => {
  const project = tmpProject("contract-readiness");
  initProject(project);
  story(project, "ST-001");
  createApprovedTemplate(project, "technical-analysis");

  mustFail([
    "contract",
    "create",
    "--root",
    project,
    "--phase",
    "analysis",
    "--story",
    "ST-001",
    "--id",
    "contract-ST-001-analysis",
  ], /missing project-specific context/i);

  mustFail([
    "contract",
    "create",
    "--root",
    project,
    "--phase",
    "analysis",
    "--story",
    "ST-001",
    "--id",
    "contract-ST-001-analysis",
    "--context-summary",
    "Analysis contract",
  ], /missing agreed story output format/i);

  mustFail([
    "contract",
    "create",
    "--root",
    project,
    "--phase",
    "analysis",
    "--story",
    "ST-001",
    "--id",
    "contract-ST-001-analysis",
    "--context-summary",
    "Analysis contract",
    "--question",
    "Which output detail level should be used?",
    "--output-ref",
    "technical-analysis:technical-analysis-v1:new",
  ], /open question/i);

  const completeContract = JSON.parse(mustRun([
    "contract",
    "create",
    "--root",
    project,
    "--phase",
    "analysis",
    "--story",
    "ST-001",
    "--id",
    "contract-ST-001-analysis",
    "--context-summary",
    "Analysis contract",
    "--qa",
    "Which output detail level should be used?|Architecture-level detail",
    "--output-ref",
    "technical-analysis:technical-analysis-v1:new",
    "--json",
  ]).stdout).contract;
  assert.equal(completeContract.output_contract_refs[0].template_id, "technical-analysis-v1");
  const linkedStory = readJson(path.join(project, ".sdlc", "stories", "ST-001", "story.json"));
  assert.equal(linkedStory.contract_id, "contract-ST-001-analysis");
});

test("contract create auto-links story contract and requires explicit replacement", () => {
  const project = tmpProject("contract-story-link");
  initProject(project);
  story(project, "ST-LINK");
  createApprovedTemplate(project, "technical-analysis");

  const created = JSON.parse(mustRun([
    "contract",
    "create",
    "--root",
    project,
    "--phase",
    "analysis",
    "--story",
    "ST-LINK",
    "--id",
    "contract-ST-LINK-analysis",
    "--context-summary",
    "Analysis contract",
    "--qa",
    "Who approves?|Owner",
    "--output-ref",
    "technical-analysis:technical-analysis-v1:new",
    "--json",
  ]).stdout);
  assert.equal(created.story_link.status, "linked");
  assert.equal(readJson(path.join(project, ".sdlc", "stories", "ST-LINK", "story.json")).contract_id, "contract-ST-LINK-analysis");

  mustFail([
    "contract",
    "create",
    "--root",
    project,
    "--phase",
    "analysis",
    "--story",
    "ST-LINK",
    "--id",
    "contract-ST-LINK-analysis-v2",
    "--context-summary",
    "Replacement analysis contract",
    "--qa",
    "Who approves?|Owner",
    "--output-ref",
    "technical-analysis:technical-analysis-v1:new",
  ], /already references contract contract-ST-LINK-analysis/);

  const replaced = JSON.parse(mustRun([
    "contract",
    "create",
    "--root",
    project,
    "--phase",
    "analysis",
    "--story",
    "ST-LINK",
    "--id",
    "contract-ST-LINK-analysis-v2",
    "--context-summary",
    "Replacement analysis contract",
    "--qa",
    "Who approves?|Owner",
    "--output-ref",
    "technical-analysis:technical-analysis-v1:new",
    "--replace-story-contract",
    "--json",
  ]).stdout);
  assert.equal(replaced.story_link.status, "replaced");
  assert.equal(readJson(path.join(project, ".sdlc", "stories", "ST-LINK", "story.json")).contract_id, "contract-ST-LINK-analysis-v2");
});

test("phase outputs and story step completion require approved story contracts", () => {
  const project = tmpProject("phase-output-contract-gate");
  initProject(project);
  story(project, "ST-001");
  createApprovedTemplate(project, "technical-analysis");
  mustRun([
    "contract",
    "create",
    "--root",
    project,
    "--phase",
    "analysis",
    "--story",
    "ST-001",
    "--id",
    "contract-ST-001-analysis",
    "--context-summary",
    "Analysis contract",
    "--qa",
    "Who approves?|Owner",
    "--output-ref",
    "technical-analysis:technical-analysis-v1:new",
  ]);
  const artifact = writeArtifact(project, ".sdlc/requirements/ST-001-technical-analysis.md", "# Technical Analysis\n");

  mustFail([
    "output",
    "link",
    "--root",
    project,
    "--story",
    "ST-001",
    "--type",
    "technical-analysis",
    "--artifact",
    artifact,
    "--template",
    "technical-analysis-v1",
    "--mode",
    "new",
    "--requirement",
    "REQ-001",
  ], /output\.link is blocked[\s\S]*contract\.status is 'draft'/);

  mustFail([
    "story",
    "complete-step",
    "--root",
    project,
    "--id",
    "ST-001",
    "--step",
    "technical-analysis",
    "--type",
    "technical-analysis",
    "--summary",
    "Attempted before approval",
  ], /story\.complete-step is blocked[\s\S]*contract\.status is 'draft'/);

  mustRun(["contract", "approve", "--root", project, "--id", "contract-ST-001-analysis", ...humanApproval("Approved analysis contract")]);
  mustRun([
    "output",
    "link",
    "--root",
    project,
    "--story",
    "ST-001",
    "--type",
    "technical-analysis",
    "--artifact",
    artifact,
    "--template",
    "technical-analysis-v1",
    "--mode",
    "new",
    "--requirement",
    "REQ-001",
  ]);
  const completed = JSON.parse(mustRun([
    "story",
    "complete-step",
    "--root",
    project,
    "--id",
    "ST-001",
    "--step",
    "technical-analysis",
    "--type",
    "technical-analysis",
    "--summary",
    "Technical analysis accepted",
    "--json",
  ]).stdout);
  assert.equal(completed.step.status, "completed");
});

test("contract create requires agreed output templates and approval requests summarize pending user input", () => {
  const project = tmpProject("human-consent-gates");
  initProject(project);
  story(project, "ST-001");
  mustRun([
    "output",
    "template",
    "propose",
    "--root",
    project,
    "--type",
    "technical-analysis",
    "--id",
    "technical-analysis-v1",
    "--summary",
    "Technical analysis format",
  ]);

  mustFail([
    "contract",
    "create",
    "--root",
    project,
    "--phase",
    "analysis",
    "--story",
    "ST-001",
    "--id",
    "contract-ST-001-analysis",
    "--context-summary",
    "Analysis contract",
    "--output-ref",
    "technical-analysis:technical-analysis-v1:new",
  ], /output refs require approved output templates/i);

  mustRun([
    "contract",
    "create",
    "--root",
    project,
    "--phase",
    "analysis",
    "--story",
    "ST-001",
    "--id",
    "contract-ST-001-analysis",
    "--context-summary",
    "Analysis contract awaiting agreement",
    "--allow-incomplete-contract",
  ]);

  const requests = JSON.parse(mustRun(["approval", "requests", "--root", project, "--story", "ST-001", "--json"]).stdout);
  assert.equal(requests.status, "needs_user_input");
  assert.match(requests.assistant_message, /You do not need to know SDLC internals/);
  assert.match(requests.assistant_message, /You can answer in natural language/);
  assert.ok(requests.requests.some((request) => request.type === "output_template_approval" && request.subject_id === "technical-analysis-v1"));
  assert.ok(requests.requests.some((request) => request.type === "contract_clarification" && request.subject_id === "contract-ST-001-analysis"));
  assert.ok(requests.requests.some((request) => request.type === "contract_approval" && request.subject_id === "contract-ST-001-analysis"));
  assert.ok(requests.requests.every((request) => request.suggested_question));
  assert.ok(requests.requests.every((request) => request.title));
  assert.ok(requests.requests.every((request) => request.why_needed));
  assert.ok(requests.requests.every((request) => request.user_prompt));
  assert.ok(requests.requests.every((request) => Array.isArray(request.review_items) && request.review_items.length > 0));
  assert.ok(requests.requests.some((request) => request.type === "contract_approval" && /Context:/.test(request.review_items.join(" "))));
  const outputTemplateRequest = requests.requests.find((request) => request.type === "output_template_approval");
  assert.ok(outputTemplateRequest.review_items.some((item) => /Approval scope:/.test(item)));
  assert.ok(outputTemplateRequest.review_items.some((item) => /Sections to approve:/.test(item)));
  assert.ok(outputTemplateRequest.review_items.some((item) => /Template content to review:/.test(item)));
  const outputTemplateDeliveryIds = outputTemplateRequest.delivery_format_options.map((option) => option.id);
  assert.ok(outputTemplateDeliveryIds.includes("chat-summary"));
  assert.ok(outputTemplateDeliveryIds.includes("canonical-document"));
  assert.ok(outputTemplateDeliveryIds.includes("document-plus-chat-summary"));
  assert.ok(outputTemplateDeliveryIds.includes("detailed-findings"));
  assert.match(outputTemplateRequest.recommended_delivery_format, /document-plus-chat-summary/);
  assert.match(outputTemplateRequest.delivery_question, /How should Codex present/);
  const contractApprovalRequest = requests.requests.find((request) => request.type === "contract_approval");
  assert.ok(contractApprovalRequest.delivery_format_options.some((option) => option.id === "executive-summary"));

  assert.equal(requests.assistant_message_source_language, "en");
  assert.equal(requests.assistant_message_presentation.translate_to_chat_language, true);
  assert.equal(requests.assistant_message_presentation.presenter, "codex");
  assert.ok(requests.assistant_message_presentation.preserve_literals.includes("CLI commands"));
  assert.match(requests.assistant_message_presentation.instruction, /Do not collapse/);

  const plainRequests = mustRun(["approval", "requests", "--root", project, "--story", "ST-001"]).stdout;
  assert.match(plainRequests, /I am stopping here/);
  assert.match(plainRequests, /What to review/);
  assert.match(plainRequests, /Delivery \/ presentation options/);
  assert.match(plainRequests, /What approval means/);
  assert.match(plainRequests, /Question:/);

  const gate = JSON.parse(mustRun([
    "gate",
    "check",
    "--root",
    project,
    "--story",
    "ST-001",
    "--json",
  ]).stdout);
  assert.match(gate.assistant_message, /You do not need to know SDLC internals/);
  assert.equal(gate.assistant_message_source_language, "en");
  assert.equal(gate.assistant_message_presentation.translate_to_chat_language, true);
  assert.ok(gate.approval_requests.some((request) => request.type === "contract_approval"));
});

test("implementation output template approvals include code review delivery choices", () => {
  const project = tmpProject("implementation-output-delivery-options");
  initProject(project);
  story(project, "ST-001");
  mustRun([
    "output",
    "template",
    "propose",
    "--root",
    project,
    "--type",
    "implementation-summary",
    "--summary",
    "Implementation summary format",
  ]);

  const requests = JSON.parse(mustRun(["approval", "requests", "--root", project, "--json"]).stdout);
  const request = requests.requests.find((item) => item.type === "output_template_approval" && item.subject_id === "implementation-summary-v1");
  assert.ok(request, "implementation output template approval request missing");
  const deliveryIds = request.delivery_format_options.map((option) => option.id);
  assert.ok(deliveryIds.includes("changed-files-summary"));
  assert.ok(deliveryIds.includes("modified-classes-components"));
  assert.ok(deliveryIds.includes("diff-review"));
  assert.ok(deliveryIds.includes("key-code-snippets"));
  assert.ok(deliveryIds.includes("tests-and-verification"));
  assert.ok(deliveryIds.includes("no-code-summary"));
  assert.match(request.recommended_delivery_format, /changed-files-summary/);
  assert.match(request.delivery_question, /changed-files-summary/);
  assert.match(request.delivery_question, /diff-review/);
});

test("trace attribution separates executor requester and authorizer in report queries", () => {
  const project = tmpProject("trace-authority-attribution");
  initProject(project);
  story(project, "ST-001");
  const appended = JSON.parse(mustRun([
    "trace",
    "append",
    "--root",
    project,
    "--story",
    "ST-001",
    "--type",
    "implementation",
    "--summary",
    "Implemented Codex-executed requester attribution",
    "--actor",
    "codex",
    "--actor-type",
    "agent",
    "--requested-by",
    "antonio",
    "--requested-by-type",
    "human",
    "--requested-by-name",
    "Antonio Antenore",
    "--authorized-by",
    "antonio",
    "--authorized-by-type",
    "human",
    "--request-summary",
    "Add requested_by and authorized_by audit fields",
    "--thread-id",
    "THREAD-REQ-001",
    "--json",
  ]).stdout);
  assert.equal(appended.event.actor.id, "codex");
  assert.equal(appended.event.requested_by.id, "antonio");
  assert.equal(appended.event.authorized_by.id, "antonio");
  assert.equal(appended.event.request.summary, "Add requested_by and authorized_by audit fields");
  assert.equal(appended.event.request.thread_id, "THREAD-REQ-001");

  const defaultActorTrace = JSON.parse(mustRun([
    "trace",
    "append",
    "--root",
    project,
    "--story",
    "ST-001",
    "--type",
    "implementation",
    "--summary",
    "Implemented unrequested Codex task",
    "--json",
  ]).stdout);
  assert.equal(defaultActorTrace.event.actor.id, "codex");
  assert.equal(defaultActorTrace.event.actor.type, "agent");

  const requesterQuery = JSON.stringify({
    intent: "find_changes_requested_by_user",
    confidence: 0.96,
    subjects: ["activity"],
    filters: { requester: ["antonio"] },
    sort: "created_at_desc",
  });
  const requesterReport = JSON.parse(mustRun(["report", "query", "--root", project, "--query-json", requesterQuery, "--json"]).stdout);
  assert.equal(requesterReport.summary.result_count, 1);
  assert.equal(requesterReport.results[0].summary, "Implemented Codex-executed requester attribution");
  assert.equal(requesterReport.results[0].actor.id, "codex");
  assert.equal(requesterReport.results[0].requested_by.id, "antonio");
  assert.equal(requesterReport.summary.by_requester.antonio, 1);

  const executorQuery = JSON.stringify({
    intent: "find_changes_executed_by_agent",
    confidence: 0.96,
    subjects: ["activity"],
    filters: { executor: ["codex"] },
    sort: "created_at_desc",
  });
  const executorReport = JSON.parse(mustRun(["report", "query", "--root", project, "--query-json", executorQuery, "--json"]).stdout);
  assert.equal(executorReport.summary.result_count, 2);

  const authorizerQuery = JSON.stringify({
    intent: "find_changes_authorized_by_user",
    confidence: 0.96,
    subjects: ["activity"],
    filters: { authorizer: ["antonio"] },
    sort: "created_at_desc",
  });
  const authorizerReport = JSON.parse(mustRun(["report", "query", "--root", project, "--query-json", authorizerQuery, "--json"]).stdout);
  assert.equal(authorizerReport.summary.result_count, 1);
});

test("report query finds new functional stories from canonical story records", () => {
  const project = tmpProject("report-query-stories");
  initProject(project);
  mustRun([
    "story",
    "create",
    "--root",
    project,
    "--id",
    "ST-FUNC-001",
    "--title",
    "Functional onboarding flow",
    "--acceptance",
    "Functional flow is observable",
    "--requirement",
    "REQ-FUNC",
  ]);
  mustRun([
    "story",
    "create",
    "--root",
    project,
    "--id",
    "ST-TECH-001",
    "--title",
    "Technical runtime setup",
    "--acceptance",
    "Runtime setup is observable",
    "--requirement",
    "REQ-TECH",
  ]);
  const query = JSON.stringify({
    intent: "find_new_functional_stories",
    confidence: 0.94,
    subjects: ["stories"],
    time: { since: "10d", until: "now", field: "created_at" },
    filters: { text: ["functional"] },
    sort: "created_at_desc",
  });
  const report = JSON.parse(mustRun(["report", "query", "--root", project, "--query-json", query, "--json"]).stdout);
  assert.equal(report.summary.result_count, 1);
  assert.equal(report.results[0].id, "ST-FUNC-001");
  assert.equal(report.results[0].kind, "stories");
});

test("manifests, trace compaction, and archive plans scale the KB without using cache as truth", () => {
  const project = tmpProject("kb-scale");
  initProject(project);
  createStrictReadyStory(project, "ST-001");
  mustRun([
    "trace",
    "append",
    "--root",
    project,
    "--story",
    "ST-001",
    "--type",
    "implementation",
    "--summary",
    "Implemented a small change",
  ]);

  const manifestResult = JSON.parse(mustRun(["manifest", "rebuild", "--root", project, "--json"]).stdout);
  assert.equal(manifestResult.status, "rebuilt");
  const manifest = readJson(path.join(project, ".sdlc", "manifests", "kb-manifest.json"));
  assert.equal(manifest.summary.stories, 1);
  assert.equal(manifest.source_paths.some((sourcePath) => sourcePath.startsWith(".sdlc/cache/")), false);

  mustRun(["cache", "rebuild", "--root", project]);
  const cache = readJson(path.join(project, ".sdlc", "cache", "kb-cache.json"));
  assert.equal(cache.source_paths.includes(".sdlc/manifests/kb-manifest.json"), true);

  const compacted = JSON.parse(mustRun([
    "trace",
    "compact",
    "--root",
    project,
    "--story",
    "ST-001",
    "--json",
  ]).stdout);
  assert.equal(compacted.status, "compacted");
  assert.equal(fs.existsSync(compacted.compaction_path), true);
  assert.equal(fs.existsSync(path.join(project, ".sdlc", "traces", "ST-001.jsonl")), true);

  const archivePlan = JSON.parse(mustRun([
    "archive",
    "closed",
    "--root",
    project,
    "--before",
    "now",
    "--json",
  ]).stdout);
  assert.equal(archivePlan.status, "planned");
  assert.ok(archivePlan.plan.candidates.some((candidate) => candidate.reason === "trace-compaction"));
  assert.equal(fs.existsSync(archivePlan.plan_path), true);
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
