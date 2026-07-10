import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(repoRoot, "bin", "agentic-sdlc.mjs");

function tmpProject(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `sdlc-${name}-`));
}

function run(args, options = {}) {
  const env = { ...process.env };
  for (const key of ["CI", "GITHUB_ACTIONS", "GITHUB_ACTOR", "CODEX_AGENT_NAME", "CODEX_USER_ID"]) {
    delete env[key];
  }
  Object.assign(env, options.env || {});
  return spawnSync(process.execPath, [bin, ...args], {
    cwd: options.cwd || repoRoot,
    encoding: "utf8",
    env,
    timeout: options.timeout || 30_000,
    maxBuffer: 10 * 1024 * 1024,
  });
}

function runAsync(args, options = {}) {
  const env = { ...process.env };
  for (const key of ["CI", "GITHUB_ACTIONS", "GITHUB_ACTOR", "CODEX_AGENT_NAME", "CODEX_USER_ID"]) {
    delete env[key];
  }
  Object.assign(env, options.env || {});
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, ...args], {
      cwd: options.cwd || repoRoot,
      env,
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => child.kill("SIGKILL"), options.timeout || 30_000);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (status, signal) => {
      clearTimeout(timeout);
      resolve({ status, signal, stdout, stderr });
    });
  });
}

function mustRun(args, options = {}) {
  const result = run(args, options);
  assert.equal(result.error, undefined, `${args.join(" ")} failed to execute: ${result.error?.message}`);
  assert.equal(result.signal, null, `${args.join(" ")} terminated by ${result.signal}`);
  assert.equal(result.status, 0, `${args.join(" ")}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  return result;
}

function mustFail(args, pattern, options = {}) {
  const result = run(args, options);
  assert.equal(result.error, undefined, `${args.join(" ")} failed to execute: ${result.error?.message}`);
  assert.equal(result.signal, null, `${args.join(" ")} terminated by ${result.signal}`);
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

const delegatedApprovalScope = "technical assessment workbook, read-only repo analysis";

function delegatedAutomationApproval(
  summary = "Antonio delegated approval for this assessment within read-only repo analysis and local output generation",
  scope = delegatedApprovalScope,
  authorization = null,
) {
  return [
    "--actor-type",
    "agent",
    "--approval-source",
    "automation",
    "--scope",
    scope,
    "--summary",
    summary,
    ...(authorization ? ["--authorization", authorization] : []),
  ];
}

function grantAutomationAuthorization(project, id, actions, options = {}) {
  const scope = options.scope || delegatedApprovalScope;
  const artifactTypes = options.artifactTypes || [];
  const subjects = options.subjects || [];
  const granted = JSON.parse(mustRun([
    "authorization",
    "grant",
    "--root",
    project,
    "--id",
    id,
    "--scope",
    scope,
    "--summary",
    options.summary || `Delegate ${actions.join(", ")} within ${scope}`,
    ...actions.flatMap((action) => ["--allow-action", action]),
    ...artifactTypes.flatMap((type) => ["--allow-artifact-type", type]),
    ...subjects.flatMap((subject) => ["--allow-subject", subject]),
    "--actor-type",
    "human",
    "--approval-source",
    "explicit-user",
    "--json",
  ]).stdout);
  return granted.authorization;
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

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeStoredZip(project, relativePath, entries) {
  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  for (const [name, value] of Object.entries(entries)) {
    const nameBuffer = Buffer.from(name, "utf8");
    const body = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
    const checksum = crc32(body);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(body.length, 18);
    localHeader.writeUInt32LE(body.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localParts.push(localHeader, nameBuffer, body);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(body.length, 20);
    centralHeader.writeUInt32LE(body.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(centralHeader, nameBuffer);

    localOffset += localHeader.length + nameBuffer.length + body.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);

  const filePath = path.join(project, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.concat([...localParts, centralDirectory, end]));
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
  assert.equal(version.stdout.trim(), readJson(path.join(repoRoot, "package.json")).version);
  assert.equal(version.stdout.trim(), readJson(path.join(repoRoot, ".codex-plugin", "plugin.json")).version);

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
  const plan = fs.readFileSync(path.join(project, ".sdlc", "stories", "ST-ACCEPTANCE", "plan.md"), "utf8");
  assert.doesNotMatch(plan, /[ \t]+$/m);
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
  mustRun(["story", "release", "--root", project, "--id", "ST-001", "--agent", "codex"]);
  const defaultClaim = JSON.parse(mustRun([
    "story",
    "claim",
    "--root",
    project,
    "--id",
    "ST-001",
    "--agent",
    "codex",
    "--json",
  ]).stdout);
  assert.equal(defaultClaim.claim.branch, "codex/ST-001");
  const validBranchGate = run(["gate", "check", "--root", project, "--story", "ST-001", "--strict", "--json"]);
  const validBranchReport = JSON.parse(validBranchGate.stdout);
  assert.equal(validBranchReport.errors.some((error) => error.includes("claim branch")), false);
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

test("delegated automation approvals require persistent action and scope authorization", () => {
  const project = tmpProject("delegated-approval");
  initProject(project);
  story(project, "ST-001", ["--contract", "contract-ST-001-implementation"]);
  const authorization = grantAutomationAuthorization(
    project,
    "AUTH-DELEGATED-ASSESSMENT",
    ["output.template.approve", "contract.approve", "task.start.confirm"],
    {
      artifactTypes: ["implementation-summary"],
      subjects: ["implementation-summary-v1", "contract-ST-001-implementation", "ST-001"],
    },
  );
  const wrongActionAuthorization = grantAutomationAuthorization(
    project,
    "AUTH-CONTRACT-ONLY",
    ["contract.approve"],
    { artifactTypes: ["implementation-summary"] },
  );
  const wrongSubjectAuthorization = grantAutomationAuthorization(
    project,
    "AUTH-WRONG-SUBJECT",
    ["output.template.approve"],
    { artifactTypes: ["implementation-summary"], subjects: ["another-template"] },
  );
  const authorizationPath = path.join(project, ".sdlc", "authorizations", "AUTH-DELEGATED-ASSESSMENT.json");
  assert.equal(fs.existsSync(authorizationPath), true);
  assert.deepEqual(readJson(authorizationPath), authorization);
  assert.match(authorization.approved_content_hash, /^[a-f0-9]{64}$/);
  const authorizationStatus = JSON.parse(mustRun([
    "authorization",
    "status",
    "--root",
    project,
    "--id",
    authorization.id,
    "--json",
  ]).stdout);
  assert.deepEqual(authorizationStatus.authorizations, [authorization]);

  mustRun([
    "output",
    "template",
    "propose",
    "--root",
    project,
    "--type",
    "implementation-summary",
    "--id",
    "implementation-summary-v1",
    "--summary",
    "Implementation summary template",
  ]);
  mustFail(
    [
      "output",
      "template",
      "approve",
      "--root",
      project,
      "--id",
      "implementation-summary-v1",
      ...delegatedAutomationApproval(),
    ],
    /requires --authorization <id>/,
  );
  mustFail(
    [
      "output",
      "template",
      "approve",
      "--root",
      project,
      "--id",
      "implementation-summary-v1",
      "--actor-type",
      "agent",
      "--approval-source",
      "automation",
      "--authorization",
      authorization.id,
    ],
    /requires --summary or --approval-evidence/,
  );
  mustFail(
    [
      "output",
      "template",
      "approve",
      "--root",
      project,
      "--id",
      "implementation-summary-v1",
      ...delegatedAutomationApproval(
        "Attempt with an action not covered by the grant",
        delegatedApprovalScope,
        wrongActionAuthorization.id,
      ),
    ],
    /does not allow action output\.template\.approve/,
  );
  mustFail(
    [
      "output",
      "template",
      "approve",
      "--root",
      project,
      "--id",
      "implementation-summary-v1",
      ...delegatedAutomationApproval(
        "Attempt to approve a subject outside the grant",
        delegatedApprovalScope,
        wrongSubjectAuthorization.id,
      ),
    ],
    /does not allow subject implementation-summary-v1/,
  );
  mustFail(
    [
      "output",
      "template",
      "approve",
      "--root",
      project,
      "--id",
      "implementation-summary-v1",
      ...delegatedAutomationApproval(
        "Attempt outside the delegated scope",
        "unrelated deployment scope",
        authorization.id,
      ),
    ],
    /does not match authorization AUTH-DELEGATED-ASSESSMENT scope/,
  );
  mustRun([
    "output",
    "template",
    "approve",
    "--root",
    project,
    "--id",
    "implementation-summary-v1",
    ...delegatedAutomationApproval(undefined, undefined, authorization.id),
  ]);
  const registry = readJson(path.join(project, ".sdlc", "output-contracts", "registry.json"));
  const template = registry.templates.find((item) => item.id === "implementation-summary-v1");
  assert.equal(template.approval_source, "automation");
  assert.equal(template.explicit_user_confirmation, false);
  assert.equal(template.approved_by.type, "agent");
  assert.equal(template.authorization_ref, authorization.id);
  assert.equal(template.authorization_action, "output.template.approve");
  assert.equal(template.approval_scope.delegated_approval, true);
  assert.equal(template.approval_scope.approval_level, "technical assessment workbook, read-only repo analysis");

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
    "Implement under delegated approval scope.",
    "--qa",
    "Who delegated approvals?|Antonio",
    "--output-ref",
    "implementation-summary:implementation-summary-v1:new",
  ]);
  mustFail(
    [
      "contract",
      "approve",
      "--root",
      project,
      "--id",
      "contract-ST-001-implementation",
      "--actor-type",
      "agent",
      "--approval-source",
      "automation",
      "--authorization",
      authorization.id,
    ],
    /requires --summary or --approval-evidence/,
  );
  mustRun([
    "contract",
    "approve",
    "--root",
    project,
    "--id",
    "contract-ST-001-implementation",
    ...delegatedAutomationApproval(undefined, undefined, authorization.id),
  ]);
  const contract = readJson(path.join(project, ".sdlc", "contracts", "contract-ST-001-implementation.json"));
  const approval = contract.approvals.at(-1);
  assert.equal(contract.status, "approved");
  assert.equal(approval.approval_source, "automation");
  assert.equal(approval.explicit_user_confirmation, false);
  assert.equal(approval.approved_by.type, "agent");
  assert.equal(approval.authorization_ref, authorization.id);
  assert.equal(approval.authorization_action, "contract.approve");
  assert.equal(approval.scope.delegated_approval, true);
  assert.equal(approval.scope.approval_level, "technical assessment workbook, read-only repo analysis");

  const storyPath = path.join(project, ".sdlc", "stories", "ST-001", "story.json");
  const storyData = readJson(storyPath);
  writeJson(storyPath, { ...storyData, status: "ready", phase: "implementation" });
  const started = JSON.parse(mustRun([
    "task",
    "start",
    "--root",
    project,
    "--json",
    "--intent-json",
    routeIntent({
      requested_action: "implement_story",
      referenced_entities: [{ type: "story", id: "ST-001" }],
      proposed_phase: "implementation",
    }),
    "--confirm-start",
    "--authorization",
    authorization.id,
  ]).stdout);
  assert.equal(started.status, "ready_to_execute");
  assert.equal(started.execution_allowed, true);
  assert.equal(started.contract_id, "contract-ST-001-implementation");

  const strictGateResult = run(["gate", "check", "--root", project, "--story", "ST-001", "--strict", "--json"]);
  assert.notEqual(strictGateResult.status, 0, "The output is not linked yet, so the strict gate should still fail.");
  const strictGate = JSON.parse(strictGateResult.stdout);
  assert.equal(
    strictGate.errors.some((error) => error.includes("persistent authorization_ref")),
    false,
    `Delegated template approval lost its authorization during gate validation: ${strictGate.errors.join("; ")}`,
  );
});

test("output delivery canonicalizes Excel and verifies OOXML evidence before linking", () => {
  const project = tmpProject("xlsx-delivery");
  initProject(project);
  story(project, "ST-XLSX", ["--requirement", "REQ-XLSX"]);

  const proposed = JSON.parse(mustRun([
    "output",
    "template",
    "propose",
    "--root",
    project,
    "--type",
    "technical-analysis",
    "--id",
    "technical-analysis-v1",
    "--preset",
    "technical-assessment",
    "--format",
    "Excel",
    "--delivery",
    "artifact",
    "--summary",
    "Canonical technical assessment workbook",
    "--json",
  ]).stdout);
  const expectedDelivery = {
    format: "xlsx",
    label: "Excel workbook",
    extension: ".xlsx",
    media_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    generator: "spreadsheets",
    mode: "artifact",
  };
  assert.equal(proposed.template.preset, "technical-assessment");
  assert.deepEqual(proposed.template.delivery, expectedDelivery);
  assert.equal(
    fs.readFileSync(path.join(project, proposed.template.path), "utf8"),
    fs.readFileSync(path.join(repoRoot, "templates", "technical-assessment.md"), "utf8"),
  );

  const approved = JSON.parse(mustRun([
    "output",
    "template",
    "approve",
    "--root",
    project,
    "--id",
    "technical-analysis-v1",
    ...humanApproval("Approved canonical workbook delivery"),
    "--json",
  ]).stdout);
  assert.deepEqual(approved.template.delivery, expectedDelivery);
  assert.match(approved.template.approved_delivery_hash, /^[a-f0-9]{64}$/);
  assert.equal(approved.decision.approved_delivery_hash, approved.template.approved_delivery_hash);
  assert.deepEqual(approved.decision.delivery, expectedDelivery);

  createApprovedStoryContract(project, "ST-XLSX", "analysis", "technical-analysis");
  mustRun([
    "capability",
    "profile",
    "propose",
    "--root",
    project,
    "--id",
    "CAP-PROFILE-ST-XLSX",
    "--story",
    "ST-XLSX",
    "--phase",
    "analysis",
  ]);
  mustRun([
    "capability",
    "profile",
    "approve",
    "--root",
    project,
    "--id",
    "CAP-PROFILE-ST-XLSX",
    ...humanApproval("Approved workbook assessment capability profile"),
  ]);
  const started = JSON.parse(mustRun([
    "task",
    "start",
    "--root",
    project,
    "--intent-json",
    routeIntent({
      requested_action: "technical_analysis",
      referenced_entities: [{ type: "story", id: "ST-XLSX" }],
      proposed_phase: "analysis",
      artifact_type: "technical-analysis",
    }),
    "--confirm-start",
    "--actor-type",
    "human",
    "--json",
  ]).stdout);
  assert.equal(started.status, "ready_to_execute");
  assert.equal(started.task_start_receipt, ".sdlc/stories/ST-XLSX/task-start.json");
  const wrongExtension = writeArtifact(
    project,
    ".sdlc/stories/ST-XLSX/outputs/technical-assessment.md",
    "# Technical assessment\n",
  );
  mustFail([
    "output",
    "link",
    "--root",
    project,
    "--story",
    "ST-XLSX",
    "--type",
    "technical-analysis",
    "--artifact",
    wrongExtension,
    "--template",
    "technical-analysis-v1",
    "--mode",
    "new",
  ], /requires a \.xlsx canonical artifact/);

  const evidence = writeArtifact(project, ".sdlc/evidence/ST-XLSX-workbook-render.txt", "Workbook rendered and inspected.\n");
  const fakeWorkbook = writeArtifact(
    project,
    ".sdlc/stories/ST-XLSX/outputs/not-a-workbook.xlsx",
    "This is not an OOXML ZIP container.\n",
  );
  mustFail([
    "output",
    "link",
    "--root",
    project,
    "--story",
    "ST-XLSX",
    "--type",
    "technical-analysis",
    "--artifact",
    fakeWorkbook,
    "--template",
    "technical-analysis-v1",
    "--mode",
    "new",
    "--evidence",
    evidence,
  ], /not a valid ZIP container/);

  const workbook = writeStoredZip(
    project,
    ".sdlc/stories/ST-XLSX/outputs/technical-assessment.xlsx",
    {
      "[Content_Types].xml": [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
        '<Default Extension="xml" ContentType="application/xml"/>',
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
        "</Types>",
      ].join(""),
      "_rels/.rels": [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>',
        "</Relationships>",
      ].join(""),
      "xl/workbook.xml": [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ',
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets/></workbook>',
      ].join(""),
      "xl/_rels/workbook.xml.rels": [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>',
      ].join(""),
    },
  );
  const linked = JSON.parse(mustRun([
    "output",
    "link",
    "--root",
    project,
    "--story",
    "ST-XLSX",
    "--type",
    "technical-analysis",
    "--artifact",
    workbook,
    "--template",
    "technical-analysis-v1",
    "--mode",
    "new",
    "--requirement",
    "REQ-XLSX",
    "--evidence",
    evidence,
    "--json",
  ]).stdout);
  assert.deepEqual(
    {
      delivery_format: linked.link.delivery_format,
      delivery_extension: linked.link.delivery_extension,
      media_type: linked.link.media_type,
      generator: linked.link.generator,
      delivery_mode: linked.link.delivery_mode,
    },
    {
      delivery_format: "xlsx",
      delivery_extension: ".xlsx",
      media_type: expectedDelivery.media_type,
      generator: "spreadsheets",
      delivery_mode: "artifact",
    },
  );
  assert.equal(linked.link.verification_receipt.status, "passed");
  assert.equal(linked.link.verification_receipt.verifier, "ooxml-container-v1");
  assert.equal(linked.link.verification_receipt.format, "xlsx");
  assert.equal(linked.link.verification_receipt.artifact_sha256, linked.link.fingerprints.artifact_sha256);
  assert.deepEqual(linked.link.verification_receipt.evidence.map((item) => item.path), [evidence]);
  assert.ok(linked.link.verification_receipt.checks.some((check) => check.includes("valid OOXML ZIP container")));

  const registry = readJson(path.join(project, ".sdlc", "output-contracts", "registry.json"));
  const storedLink = registry.links.find((item) => item.id === linked.link.id);
  assert.deepEqual(storedLink.verification_receipt, linked.link.verification_receipt);
  const status = JSON.parse(mustRun([
    "output",
    "status",
    "--root",
    project,
    "--story",
    "ST-XLSX",
    "--type",
    "technical-analysis",
    "--json",
  ]).stdout);
  assert.deepEqual(status.links[0].verification_receipt, linked.link.verification_receipt);
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
  assert.match(onboard.assistant_message, /Project context \(BASELINE-INITIAL\)/);
  assert.match(onboard.assistant_message, /Documents I read: README\.md/);
  assert.match(onboard.assistant_message, /Current-state summary to approve/);
  assert.match(onboard.assistant_message, /not homework for you/);
  assert.match(onboard.assistant_message, /approval applies only to the item or items shown/);
  assert.ok(onboard.approval_request.review_items.some((item) => /Project summary I inferred:/.test(item)));
  assert.ok(onboard.approval_request.review_items.some((item) => /Current-state summary to approve:/.test(item)));
  assert.equal(onboard.approval_request.approval_scope.applies_only_to_presented_item, true);
  assert.equal(onboard.approval_request.approval_scope.cannot_approve_future_artifacts, true);
  assert.equal(fs.existsSync(path.join(project, ".sdlc", "project.json")), true);
  assert.equal(fs.existsSync(path.join(project, ".sdlc", "baseline", "BASELINE-INITIAL.json")), true);
  assert.ok(onboard.baseline.imported_documents.some((document) => document.path === "README.md"));
  assert.ok(onboard.baseline.repository_snapshot.detected_stack.some((item) => item.name === "package-json"));

  const pendingApprovals = JSON.parse(mustRun(["approval", "requests", "--root", project, "--json"]).stdout);
  const baselineRequest = pendingApprovals.requests.find((request) => request.type === "baseline_approval");
  assert.ok(baselineRequest);
  assert.ok(baselineRequest.review_items.some((item) => /Documents I read: README\.md/.test(item)));
  assert.ok(baselineRequest.review_items.some((item) => /Current-state report covers:/.test(item)));
  assert.equal(baselineRequest.approval_scope.requires_fresh_confirmation_for_new_artifacts, true);
  assert.match(pendingApprovals.assistant_message, /I will summarize the relevant file contents here/);
  assert.match(pendingApprovals.assistant_message, /Current-state summary to approve/);
  assert.match(pendingApprovals.assistant_message, /Scope of your answer: it applies only to Project context/);

  mustFail(["baseline", "approve", "--root", project, "--id", "BASELINE-INITIAL", "--actor-type", "human"], /requires --approval-source/);
  mustRun(["baseline", "approve", "--root", project, "--id", "BASELINE-INITIAL", ...humanApproval("Confirmed baseline for existing project")]);
  const approved = readJson(path.join(project, ".sdlc", "baseline", "BASELINE-INITIAL.json"));
  assert.equal(approved.status, "approved");
  assert.equal(approved.approvals.at(-1).approval_source, "explicit-user");
  assert.equal(approved.approvals.at(-1).scope.applies_only_to_presented_subject, true);
  assert.equal(approved.approvals.at(-1).scope.does_not_approve_future_artifacts, true);

  fs.appendFileSync(path.join(project, "README.md"), "\nChanged after baseline.\n");
  const status = JSON.parse(mustRun(["baseline", "status", "--root", project, "--id", "BASELINE-INITIAL", "--json"]).stdout);
  assert.equal(status.baselines[0].stale, true);

  mustRun(["cache", "rebuild", "--root", project]);
  const cache = readJson(path.join(project, ".sdlc", "cache", "kb-cache.json"));
  assert.ok(cache.source_paths.includes(".sdlc/baseline/BASELINE-INITIAL.json"));
});

test("onboard auto-discovers product and architecture evidence for a decision-ready baseline", () => {
  const project = tmpProject("onboard-semantic-context");
  fs.mkdirSync(path.join(project, "docs"), { recursive: true });
  fs.writeFileSync(
    path.join(project, "README.md"),
    "# Route Planner\nA configurable travel operations product for dispatch teams.\n\n## Users\nDispatch operators.\n",
  );
  const lowercaseReadme = path.join(project, "readme.md");
  if (!fs.existsSync(lowercaseReadme)) {
    fs.linkSync(path.join(project, "README.md"), lowercaseReadme);
  }
  fs.writeFileSync(
    path.join(project, "docs", "architecture.md"),
    "# Architecture\n\n## API Gateway\nRoutes requests to modular providers.\n\n## Provider Boundary\nAdapters are replaceable.\n",
  );
  fs.writeFileSync(
    path.join(project, "package.json"),
    JSON.stringify({ name: "route-planner", description: "Travel operations planning", scripts: { test: "node --test" } }, null, 2),
  );

  const payload = JSON.parse(mustRun([
    "onboard",
    "existing-project",
    "--root",
    project,
    "--project-name",
    "Route Planner",
    "--json",
  ]).stdout);

  assert.deepEqual(
    payload.baseline.imported_documents.map((item) => item.path),
    ["README.md", "docs/architecture.md"],
  );
  assert.equal(payload.baseline.inferred_context.product_signal, "Travel operations planning");
  assert.ok(payload.baseline.inferred_context.architecture_signals.some((item) => item.path === "docs/architecture.md"));
  assert.match(payload.assistant_message, /product signal: Travel operations planning/i);
  const report = fs.readFileSync(payload.report_path, "utf8");
  assert.match(report, /## Product Signal/);
  assert.match(report, /## Architecture And Component Signals/);
  assert.match(report, /API Gateway > Provider Boundary/);
});

test("story approvals and strict gates ignore superseded unreferenced baselines", () => {
  const project = tmpProject("active-baseline");
  initProject(project);
  fs.writeFileSync(path.join(project, "README.md"), "# First snapshot\n");
  mustRun([
    "baseline",
    "propose",
    "--root",
    project,
    "--id",
    "BASELINE-OLD",
    "--source",
    "README.md",
    "--summary",
    "Historical context",
  ]);
  fs.writeFileSync(path.join(project, "README.md"), "# Current snapshot\n");
  mustRun([
    "baseline",
    "propose",
    "--root",
    project,
    "--id",
    "BASELINE-CURRENT",
    "--source",
    "README.md",
    "--summary",
    "Current context",
  ]);
  mustRun(["baseline", "approve", "--root", project, "--id", "BASELINE-CURRENT", ...humanApproval("Current context approved")]);

  createStrictReadyStory(project, "ST-001");
  const requests = JSON.parse(mustRun(["approval", "requests", "--root", project, "--story", "ST-001", "--json"]).stdout);
  assert.equal(requests.requests.some((request) => request.subject_id === "BASELINE-OLD"), false);
  assert.doesNotMatch(requests.assistant_message, /BASELINE-OLD/);

  const gate = JSON.parse(mustRun(["gate", "check", "--root", project, "--story", "ST-001", "--strict", "--json"]).stdout);
  assert.equal(gate.status, "passed");
  assert.equal(gate.errors.some((error) => error.includes("BASELINE-OLD")), false);
});

test("stale active baselines request a refresh instead of an impossible approval", () => {
  const project = tmpProject("stale-baseline-refresh");
  initProject(project);
  fs.writeFileSync(path.join(project, "README.md"), "# Proposed context\n");
  mustRun([
    "baseline",
    "propose",
    "--root",
    project,
    "--id",
    "BASELINE-CURRENT",
    "--source",
    "README.md",
    "--summary",
    "Context to refresh",
  ]);
  fs.writeFileSync(path.join(project, "README.md"), "# Changed context\n");

  const requests = JSON.parse(mustRun(["approval", "requests", "--root", project, "--json"]).stdout);
  const refresh = requests.requests.find((request) => request.subject_id === "BASELINE-CURRENT");
  assert.equal(refresh.type, "baseline_refresh_required");
  assert.equal(refresh.status, "needs_refresh");
  assert.match(refresh.why_needed, /changed after it was prepared/);
  assert.match(refresh.suggested_command, /baseline propose[\s\S]*--force/);
  assert.match(requests.assistant_message, /Refresh project context/);
  assert.doesNotMatch(requests.assistant_message, /Can I use the inferred project context/);
});

test("strict gates reject missing historical baselines still referenced by contracts", () => {
  const project = tmpProject("missing-referenced-baseline");
  initProject(project);
  fs.writeFileSync(path.join(project, "README.md"), "# Canonical context\n");
  mustRun([
    "baseline",
    "propose",
    "--root",
    project,
    "--id",
    "BASELINE-USED",
    "--source",
    "README.md",
    "--summary",
    "Context used by the story contract",
  ]);
  mustRun(["baseline", "approve", "--root", project, "--id", "BASELINE-USED", ...humanApproval("Approved used baseline")]);
  story(project, "ST-001", ["--requirement", "REQ-001"]);
  createApprovedTemplate(project);
  mustRun([
    "contract",
    "create",
    "--root",
    project,
    "--phase",
    "design",
    "--story",
    "ST-001",
    "--id",
    "contract-ST-001-design",
    "--context-summary",
    "Design from the approved historical baseline",
    "--context-file",
    ".sdlc/baseline/BASELINE-USED.json",
    "--qa",
    "Which baseline applies?|BASELINE-USED",
    "--output-ref",
    "functional-analysis:functional-analysis-v1:new",
  ]);
  mustRun(["contract", "approve", "--root", project, "--id", "contract-ST-001-design", ...humanApproval("Approved baseline-bound contract")]);
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
  ]);
  mustRun([
    "baseline",
    "propose",
    "--root",
    project,
    "--id",
    "BASELINE-NEWER",
    "--source",
    "README.md",
    "--summary",
    "Newer unrelated context",
  ]);
  mustRun(["baseline", "approve", "--root", project, "--id", "BASELINE-NEWER", ...humanApproval("Approved newer baseline")]);
  mustRun(["gate", "check", "--root", project, "--story", "ST-001", "--strict"]);
  fs.rmSync(path.join(project, ".sdlc", "baseline", "BASELINE-USED.json"));
  mustFail(
    ["gate", "check", "--root", project, "--story", "ST-001", "--strict"],
    /Referenced baseline BASELINE-USED is missing|context source .*BASELINE-USED\.json is missing/,
  );
  const globalGate = run(["gate", "check", "--root", project, "--strict", "--json"]);
  const globalReport = JSON.parse(globalGate.stdout);
  assert.ok(globalReport.errors.some((error) => error.includes("Referenced baseline BASELINE-USED is missing")));
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
      "--decision-id",
      "DEC-without-rationale",
      ...humanApproval("Approved output override"),
    ],
    /requires --rationale or --approval-evidence/,
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

test("strict gates use the latest test outcome while retaining failed attempts", () => {
  const project = tmpProject("trace-latest-outcome");
  initProject(project);
  createStrictReadyStory(project, "ST-001");
  mustRun(["story", "claim", "--root", project, "--id", "ST-001", "--agent", "codex"]);
  const storyPath = path.join(project, ".sdlc", "stories", "ST-001", "story.json");
  const storyData = readJson(storyPath);
  writeJson(storyPath, { ...storyData, phase: "validation", status: "validation" });
  const evidence = writeArtifact(project, ".sdlc/tests/ST-001-test-run.json", "{\"passed\":true}\n");
  const appendOutcome = (outcome) => mustRun([
    "trace",
    "append",
    "--root",
    project,
    "--story",
    "ST-001",
    "--type",
    "test",
    "--outcome",
    outcome,
    "--summary",
    `Tests ${outcome}`,
    "--evidence",
    evidence,
  ]);
  appendOutcome("failed");
  mustFail(["gate", "check", "--root", project, "--story", "ST-001", "--strict"], /latest test trace outcome must be passed/);
  appendOutcome("passed");
  mustRun(["gate", "check", "--root", project, "--story", "ST-001", "--strict"]);
  appendOutcome("failed");
  mustFail(["gate", "check", "--root", project, "--story", "ST-001", "--strict"], /latest test trace outcome must be passed/);
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

test("breakdown policy accepts repeatable hierarchy levels", () => {
  const project = tmpProject("breakdown-levels");
  initProject(project);
  const updated = JSON.parse(mustRun([
    "breakdown",
    "policy",
    "set",
    "--root",
    project,
    "--levels",
    "requirement",
    "--levels",
    "epic",
    "--levels",
    "story",
    "--json",
  ]).stdout);
  assert.deepEqual(updated.policy.levels, ["requirement", "epic", "story"]);
  const shown = JSON.parse(mustRun(["breakdown", "policy", "show", "--root", project, "--json"]).stdout);
  assert.deepEqual(shown.levels, ["requirement", "epic", "story"]);
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
    target: { root_path: path.join(path.dirname(project), "approved-external-repo") },
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
  const proposedProfile = JSON.parse(mustRun([
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
    "--json",
  ]).stdout);
  assert.match(proposedProfile.assistant_message, /Project evidence and boundaries/);
  assert.doesNotMatch(proposedProfile.assistant_message, /Tools and permissions profile/);
  assert.equal(proposedProfile.approval_request.type, "capability_profile_approval");
  assert.ok(proposedProfile.approval_request.review_items.some((item) => /What this is: the list of project evidence/.test(item)));
  const profileRequests = JSON.parse(mustRun(["approval", "requests", "--root", project, "--story", "ST-001", "--json"]).stdout);
  const profileRequest = profileRequests.requests.find((request) => request.type === "capability_profile_approval");
  assert.ok(profileRequest, "capability profile approval request missing");
  assert.equal(profileRequest.subject_id, "CAP-PROFILE-ST-001");
  assert.match(profileRequests.assistant_message, /Project evidence and boundaries/);
  assert.doesNotMatch(profileRequests.assistant_message, /capability profile/i);
  assert.ok(profileRequest.review_items.some((item) => /What this is: the list of project evidence/.test(item)));
  assert.ok(profileRequest.review_items.some((item) => /Project signals found:/.test(item)));
  assert.match(profileRequest.approval_meaning, /choose the concrete tools/);
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
  const proposedRecommendation = JSON.parse(mustRun([
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
    "--json",
  ]).stdout);
  assert.match(proposedRecommendation.assistant_message, /Allowed tools for this work/);
  assert.doesNotMatch(proposedRecommendation.assistant_message, /capability recommendation/i);
  assert.equal(proposedRecommendation.approval_request.type, "capability_recommendation_approval");
  assert.ok(proposedRecommendation.approval_request.review_items.some((item) => /Recommended capabilities:/.test(item)));
  const recommendationRequests = JSON.parse(mustRun(["approval", "requests", "--root", project, "--story", "ST-001", "--json"]).stdout);
  const recommendationRequest = recommendationRequests.requests.find((request) => request.type === "capability_recommendation_approval");
  assert.ok(recommendationRequest, "capability recommendation approval request missing");
  assert.equal(recommendationRequest.subject_id, "CAP-REC-ST-001");
  assert.match(recommendationRequests.assistant_message, /Allowed tools for this work/);
  assert.doesNotMatch(recommendationRequests.assistant_message, /capability recommendation/i);
  assert.ok(recommendationRequest.review_items.some((item) => /What this is: the concrete list of tools/.test(item)));
  assert.ok(recommendationRequest.review_items.some((item) => /Recommended capabilities:/.test(item)));
  assert.match(recommendationRequest.approval_meaning, /use these tools and permissions/);
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

test("story approval requests do not leak capability records from another story", () => {
  const project = tmpProject("capability-approval-scope");
  initProject(project);
  story(project, "ST-001");
  story(project, "ST-002");
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
  ]);
  mustRun([
    "capability",
    "profile",
    "propose",
    "--root",
    project,
    "--id",
    "CAP-PROFILE-PROJECT",
  ]);

  const requests = JSON.parse(
    mustRun(["approval", "requests", "--root", project, "--story", "ST-002", "--json"]).stdout,
  ).requests.filter((request) => request.type === "capability_profile_approval");
  assert.deepEqual(requests.map((request) => request.subject_id), ["CAP-PROFILE-PROJECT"]);
});

test("capability recommendation stays usable when its profile is approved after recommendation", () => {
  const project = tmpProject("capability-profile-approval-order");
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
  mustRun([
    "capability",
    "recommend",
    "--root",
    project,
    "--id",
    "CAP-REC-ST-001",
    "--profile",
    "CAP-PROFILE-ST-001",
  ]);
  mustRun(["capability", "profile", "approve", "--root", project, "--id", "CAP-PROFILE-ST-001", ...humanApproval("Approved evidence and boundaries")]);
  mustRun(["capability", "approve", "--root", project, "--id", "CAP-REC-ST-001", ...humanApproval("Approved allowed tools")]);
  const recommendation = readJson(path.join(project, ".sdlc", "capability-discovery", "recommendations", "CAP-REC-ST-001.json"));
  assert.equal(recommendation.status, "approved");
  assert.equal(recommendation.profile_ref.path, ".sdlc/capability-discovery/profiles/CAP-PROFILE-ST-001.json");
  assert.ok(recommendation.profile_ref.approved_content_hash);
  assert.equal(recommendation.source_paths.includes(".sdlc/capability-discovery/profiles/CAP-PROFILE-ST-001.json"), false);
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
    "Analyze with tools approved after profile approval.",
    "--qa",
    "Who approved tool boundaries?|Owner",
    "--output-ref",
    "technical-analysis:technical-analysis-v1:new",
    "--capability-recommendation",
    "CAP-REC-ST-001",
  ]);
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
  mustFail([
    "capability",
    "approve",
    "--root",
    project,
    "--id",
    "CAP-REC-INSTALL",
    "--approve-install",
    ...delegatedAutomationApproval("Delegated analysis approval does not include installing capabilities"),
  ], /delegated automation cannot expand into installs/);
  const notInstalled = readJson(path.join(project, ".sdlc", "capability-discovery", "recommendations", "CAP-REC-INSTALL.json"));
  assert.equal(notInstalled.recommendations[0].install_approved, false);
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

test("technical analysis routing ignores approved profiles whose sources became stale", () => {
  const project = tmpProject("capability-route-stale-profile");
  initProject(project);
  story(project, "ST-001");
  const source = writeArtifact(project, "package.json", "{\"name\":\"route-test\"}\n");
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
    source,
  ]);
  mustRun([
    "capability",
    "profile",
    "approve",
    "--root",
    project,
    "--id",
    "CAP-PROFILE-ST-001",
    ...humanApproval("Approved routing profile"),
  ]);
  const intent = {
    requested_action: "technical_analysis",
    proposed_phase: "analysis",
    artifact_type: "technical-analysis",
    referenced_entities: [{ type: "story", id: "ST-001" }],
  };
  const fresh = routeDecision(project, intent);
  assert.equal(fresh.blocking_reasons.includes("capability_profile_missing"), false);
  fs.appendFileSync(path.join(project, source), "\n");
  const stale = routeDecision(project, intent);
  assert.ok(stale.blocking_reasons.includes("capability_profile_missing"));
});

test("technical assessment aliases route through the contract front door", () => {
  const project = tmpProject("technical-assessment-alias");
  initProject(project);
  const decision = routeDecision(project, {
    requested_action: "technical_assessment",
    proposed_phase: "analysis",
    artifact_type: "technical-analysis",
  });
  assert.equal(decision.route, "classify_artifact");
  assert.equal(decision.status, "needs_confirmation");
  assert.equal(decision.requires_confirmation, true);
  assert.ok(decision.blocking_reasons.includes("capability_profile_missing"));

  const start = routeDecision(project, {
    requested_action: "initial_technical_assessment",
    proposed_phase: "analysis",
    artifact_type: "technical-analysis",
  }, ["task", "start"]);
  assert.equal(start.status, "needs_user_input");
  assert.equal(start.execution_allowed, false);
  assert.notEqual(start.contract_action, "normalize_request");
  assert.ok(start.blocking_reasons.includes("contract_incomplete"));
  assert.equal(start.contract_id, "contract-analysis-v1");
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
  const forcedMissing = JSON.parse(mustRun([
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
    "--confirm-start",
  ]).stdout);
  assert.equal(forcedMissing.execution_allowed, false);
  assert.equal(forcedMissing.status, "needs_user_input");
  const missingTracePath = path.join(missingProject, ".sdlc", "traces", "project.jsonl");
  const missingTraces = fs.existsSync(missingTracePath) ? fs.readFileSync(missingTracePath, "utf8") : "";
  assert.doesNotMatch(missingTraces, /task\.start\.confirm/);

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
    "--actor-type",
    "human",
  ]).stdout);
  assert.equal(confirmed.status, "ready_to_execute");
  assert.equal(confirmed.execution_allowed, true);
  assert.equal(confirmed.contract_id, "contract-ST-001-implementation");
  assert.match(confirmed.confirmation_trace_id, /^TR-/);

  const resumeAuthorization = grantAutomationAuthorization(
    readyProject,
    "AUTH-RESUME-ST-001",
    ["task.start.confirm"],
    { subjects: ["ST-001"] },
  );
  mustRun([
    "story",
    "claim",
    "--root",
    readyProject,
    "--id",
    "ST-001",
    "--agent",
    "codex",
  ]);
  const resumedByClaimant = JSON.parse(mustRun([
    "task",
    "start",
    "--root",
    readyProject,
    "--json",
    "--intent-json",
    intent,
    "--confirm-start",
    "--authorization",
    resumeAuthorization.id,
  ]).stdout);
  assert.equal(resumedByClaimant.status, "ready_to_execute");
  assert.equal(resumedByClaimant.execution_allowed, true);
  assert.ok(resumedByClaimant.route_decision.deterministic_checks.some(
    (check) => check.check === "active_claim" && /requesting actor codex/.test(check.details),
  ));

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

test("task start blocks when an approved contract source changes", () => {
  const project = tmpProject("task-start-stale-contract-source");
  initProject(project);
  const contextFile = writeArtifact(
    project,
    "requirements/implementation-context.md",
    "# Implementation context\nUse the approved API boundary.\n",
  );
  story(project, "ST-STALE", ["--contract", "contract-ST-STALE-implementation"]);
  createApprovedTemplate(project, "implementation-summary");
  mustRun([
    "contract",
    "create",
    "--root",
    project,
    "--phase",
    "implementation",
    "--story",
    "ST-STALE",
    "--id",
    "contract-ST-STALE-implementation",
    "--context-summary",
    "Implement against the approved source snapshot.",
    "--context-file",
    contextFile,
    "--qa",
    "Which API boundary applies?|The boundary recorded in the context source",
    "--output-ref",
    "implementation-summary:implementation-summary-v1:new",
  ]);
  mustRun([
    "contract",
    "approve",
    "--root",
    project,
    "--id",
    "contract-ST-STALE-implementation",
    ...humanApproval("Approved source-bound implementation contract"),
  ]);
  const storyPath = path.join(project, ".sdlc", "stories", "ST-STALE", "story.json");
  writeJson(storyPath, { ...readJson(storyPath), status: "ready", phase: "implementation" });
  const intent = routeIntent({
    requested_action: "implement_story",
    referenced_entities: [{ type: "story", id: "ST-STALE" }],
    proposed_phase: "implementation",
  });

  const ready = JSON.parse(mustRun([
    "task",
    "start",
    "--root",
    project,
    "--intent-json",
    intent,
    "--confirm-start",
    "--actor-type",
    "human",
    "--json",
  ]).stdout);
  assert.equal(ready.status, "ready_to_execute");
  assert.equal(ready.execution_allowed, true);

  fs.appendFileSync(path.join(project, contextFile), "The source changed after approval.\n");
  const blocked = JSON.parse(mustRun([
    "task",
    "start",
    "--root",
    project,
    "--intent-json",
    intent,
    "--confirm-start",
    "--json",
  ]).stdout);
  assert.equal(blocked.status, "needs_user_input");
  assert.equal(blocked.execution_allowed, false);
  assert.equal(blocked.route, "ask_clarification");
  assert.equal(blocked.contract_action, "normalize_request");
  assert.ok(blocked.blocking_reasons.includes("contract_needs_approval"));
  assert.ok(blocked.route_decision.deterministic_checks.some(
    (check) => check.check === "story_contract_exists" && check.details.includes("stale context"),
  ));
  assert.equal(blocked.confirmation_trace_id, undefined);
  const queue = JSON.parse(mustRun([
    "approval",
    "requests",
    "--root",
    project,
    "--story",
    "ST-STALE",
    "--json",
  ]).stdout);
  const clarification = queue.requests.find(
    (request) => request.type === "contract_clarification" && request.subject_id === "contract-ST-STALE-implementation",
  );
  assert.ok(clarification);
  assert.ok(clarification.gaps.includes("stale_context_source"));
  assert.match(clarification.summary, new RegExp(contextFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(queue.requests.some(
    (request) => request.type === "contract_approval" && request.subject_id === "contract-ST-STALE-implementation",
  ), false);
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
  ], /missing agreed output format for this story/i);

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
  const proposedTemplate = JSON.parse(mustRun([
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
    "--json",
  ]).stdout);
  assert.match(proposedTemplate.assistant_message, /Assessment format \(technical-analysis-v1\)/);
  assert.equal(proposedTemplate.approval_request.type, "output_template_approval");
  assert.ok(proposedTemplate.approval_request.review_items.some((item) => /What this is: the proposed structure/.test(item)));

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
  assert.match(requests.assistant_message, /Plainly:/);
  assert.match(requests.assistant_message, /workflow terms/);
  assert.match(requests.assistant_message, /I will summarize the relevant file contents here/);
  assert.match(requests.assistant_message, /approval applies only to the item or items shown/);
  assert.doesNotMatch(requests.assistant_message, /blocking_reasons/);
  assert.match(requests.assistant_message, /You can answer in natural language/);
  assert.ok(requests.requests.some((request) => request.type === "output_template_approval" && request.subject_id === "technical-analysis-v1"));
  assert.ok(requests.requests.some((request) => request.type === "contract_clarification" && request.subject_id === "contract-ST-001-analysis"));
  assert.equal(requests.requests.some((request) => request.type === "contract_approval" && request.subject_id === "contract-ST-001-analysis"), false);
  assert.equal(requests.requests.some((request) => request.type === "output_link_required"), false);
  assert.ok(requests.requests.every((request) => request.suggested_question));
  assert.ok(requests.requests.every((request) => request.title));
  assert.ok(requests.requests.every((request) => request.why_needed));
  assert.ok(requests.requests.every((request) => request.user_prompt));
  assert.ok(requests.requests.every((request) => request.approval_scope?.cannot_approve_future_artifacts === true));
  assert.ok(requests.requests.every((request) => Array.isArray(request.review_items) && request.review_items.length > 0));
  assert.ok(requests.requests.some((request) => request.type === "contract_clarification" && /Context:/.test(request.review_items.join(" "))));
  const outputTemplateRequest = requests.requests.find((request) => request.type === "output_template_approval");
  assert.ok(outputTemplateRequest.review_items.some((item) => /Decision scope:/.test(item)));
  assert.ok(outputTemplateRequest.review_items.some((item) => /Assessment sections:/.test(item)));
  assert.ok(outputTemplateRequest.review_items.some((item) => /Template content to review:/.test(item)));
  const outputTemplateDeliveryIds = outputTemplateRequest.delivery_format_options.map((option) => option.id);
  assert.deepEqual(outputTemplateDeliveryIds.slice(0, 8), ["markdown", "docx", "xlsx", "pdf", "pptx", "html", "json", "csv"]);
  assert.equal(outputTemplateDeliveryIds.includes("chat-summary"), true);
  assert.match(outputTemplateRequest.recommended_delivery_format, /Markdown document \(\.md\)/);
  assert.match(outputTemplateRequest.delivery_question, /canonical result remain Markdown document \(\.md\)/);

  assert.equal(requests.assistant_message_source_language, "en");
  assert.equal(requests.assistant_message_presentation.translate_to_chat_language, true);
  assert.equal(requests.assistant_message_presentation.presenter, "codex");
  assert.ok(requests.assistant_message_presentation.preserve_literals.includes("CLI commands"));
  assert.match(requests.assistant_message_presentation.instruction, /plain product/);
  assert.match(requests.assistant_message_presentation.instruction, /summarize the relevant contents/);
  assert.match(requests.assistant_message_presentation.instruction, /summary must be substantial enough/);
  assert.match(requests.assistant_message_presentation.instruction, /broader approval level/);

  const plainRequests = mustRun(["approval", "requests", "--root", project, "--story", "ST-001"]).stdout;
  assert.match(plainRequests, /I need your decision/);
  assert.match(plainRequests, /What is inside this item/);
  assert.match(plainRequests, /Scope of your answer:/);
  assert.match(plainRequests, /How I can present the result/);
  assert.match(plainRequests, /If you say yes/);
  assert.match(plainRequests, /Decision needed:/);
  assert.match(plainRequests, /Proposed document structure:/);
  assert.match(plainRequests, /Tools and access being approved:/);
  assert.doesNotMatch(plainRequests, /Agent command/);

  const gate = JSON.parse(mustRun([
    "gate",
    "check",
    "--root",
    project,
    "--story",
    "ST-001",
    "--json",
  ]).stdout);
  assert.match(gate.assistant_message, /Plainly:/);
  assert.equal(gate.assistant_message_source_language, "en");
  assert.equal(gate.assistant_message_presentation.translate_to_chat_language, true);
  assert.ok(gate.approval_requests.some((request) => request.type === "contract_clarification"));
  assert.equal(gate.approval_requests.some((request) => request.type === "contract_approval"), false);

  mustRun([
    "output",
    "template",
    "approve",
    "--root",
    project,
    "--id",
    "technical-analysis-v1",
    ...humanApproval("Approved canonical technical analysis format"),
  ]);
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
    "Analysis contract ready for approval",
    "--qa",
    "Who reviews the analysis?|Product and engineering owners",
    "--output-ref",
    "technical-analysis:technical-analysis-v1:new",
    "--force",
  ]);
  const approvable = JSON.parse(mustRun([
    "approval",
    "requests",
    "--root",
    project,
    "--story",
    "ST-001",
    "--json",
  ]).stdout);
  const contractApprovalRequest = approvable.requests.find(
    (request) => request.type === "contract_approval" && request.subject_id === "contract-ST-001-analysis",
  );
  assert.ok(contractApprovalRequest);
  assert.equal(approvable.requests.some(
    (request) => request.type === "contract_clarification" && request.subject_id === "contract-ST-001-analysis",
  ), false);
  assert.equal(approvable.requests.some((request) => request.type === "output_link_required"), false);
  assert.ok(contractApprovalRequest.delivery_format_options.some((option) => option.id === "chat-summary"));
  assert.ok(contractApprovalRequest.delivery_format_options.some((option) => option.id === "executive-summary"));

  mustRun([
    "contract",
    "approve",
    "--root",
    project,
    "--id",
    "contract-ST-001-analysis",
    ...humanApproval("Approved complete analysis contract"),
  ]);
  const beforeCandidate = JSON.parse(mustRun([
    "approval",
    "requests",
    "--root",
    project,
    "--story",
    "ST-001",
    "--json",
  ]).stdout);
  assert.equal(beforeCandidate.requests.some((request) => request.type === "output_link_required"), false);

  const candidate = writeArtifact(
    project,
    ".sdlc/stories/ST-001/outputs/technical-analysis.md",
    "# Completed technical analysis\n",
  );
  const afterCandidate = JSON.parse(mustRun([
    "approval",
    "requests",
    "--root",
    project,
    "--story",
    "ST-001",
    "--json",
  ]).stdout);
  const outputLinkRequest = afterCandidate.requests.find((request) => request.type === "output_link_required");
  assert.ok(outputLinkRequest);
  assert.match(outputLinkRequest.suggested_command, new RegExp(candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("implementation contract approvals retain code review delivery choices", () => {
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
  const templateRequest = requests.requests.find((item) => item.type === "output_template_approval" && item.subject_id === "implementation-summary-v1");
  assert.ok(templateRequest, "implementation output template approval request missing");
  assert.deepEqual(
    templateRequest.delivery_format_options.slice(0, 8).map((option) => option.id),
    ["markdown", "docx", "xlsx", "pdf", "pptx", "html", "json", "csv"],
  );
  assert.equal(templateRequest.delivery_format_options.some((option) => option.id === "changed-files-summary"), true);

  mustRun([
    "output",
    "template",
    "approve",
    "--root",
    project,
    "--id",
    "implementation-summary-v1",
    ...humanApproval("Approved implementation summary format"),
  ]);
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
    "Implement and report the requested change.",
    "--qa",
    "What should the summary cover?|Changed files, components, and verification",
    "--output-ref",
    "implementation-summary:implementation-summary-v1:new",
  ]);
  const contractRequests = JSON.parse(mustRun([
    "approval",
    "requests",
    "--root",
    project,
    "--story",
    "ST-001",
    "--json",
  ]).stdout);
  const request = contractRequests.requests.find(
    (item) => item.type === "contract_approval" && item.subject_id === "contract-ST-001-implementation",
  );
  assert.ok(request, "implementation contract approval request missing");
  const deliveryIds = request.delivery_format_options.map((option) => option.id);
  assert.ok(deliveryIds.includes("changed-files-summary"));
  assert.ok(deliveryIds.includes("modified-classes-components"));
  assert.ok(deliveryIds.includes("diff-review"));
  assert.ok(deliveryIds.includes("key-code-snippets"));
  assert.ok(deliveryIds.includes("tests-and-verification"));
  assert.ok(deliveryIds.includes("no-code-summary"));
  assert.match(request.recommended_delivery_format, /changed-files-summary/);
  assert.match(request.delivery_question, /Changed files summary/);
  assert.match(request.delivery_question, /Diff or patch review/);
});

test("latest template approval supersedes legacy template decision history", () => {
  const project = tmpProject("template-approval-history");
  initProject(project);
  createStrictReadyStory(project, "ST-001");
  mustRun(["story", "claim", "--root", project, "--id", "ST-001", "--agent", "codex", "--branch", "feature/ST-001"]);

  const registryPath = path.join(project, ".sdlc", "output-contracts", "registry.json");
  const registry = readJson(registryPath);
  const current = registry.decisions.find((decision) => decision.type === "template_approved");
  registry.decisions.unshift({
    ...current,
    id: "DEC-legacy-template-approval",
    created_at: "2000-01-01T00:00:00.000Z",
    approval_source: undefined,
  });
  writeJson(registryPath, registry);

  mustRun(["gate", "check", "--root", project, "--story", "ST-001", "--strict"]);
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

test("CLI rejects unknown, duplicate, and missing option values and honors explicit false", () => {
  const project = tmpProject("strict-options");
  initProject(project);
  mustFail(["status", "--root", project, "--definitely-unknown", "value"], /Unknown option --definitely-unknown/);
  mustFail([
    "story",
    "create",
    "--root",
    project,
    "--id",
    "ST-001",
    "--id",
    "ST-002",
    "--title",
    "Duplicate id",
  ], /Option --id may only be provided once/);
  mustFail(["story", "create", "--root", project, "--id", "ST-001", "--title", "--json"], /Missing value for option --title/);
  const archive = JSON.parse(mustRun([
    "archive",
    "closed",
    "--root",
    project,
    "--before",
    "now",
    "--apply=false",
    "--json",
  ]).stdout);
  assert.equal(archive.status, "planned");
  assert.equal(archive.plan.apply_requested, false);
  assert.equal(archive.plan.applied, false);
});

test("filesystem boundaries reject symlinked cache and canonical directories", { skip: process.platform === "win32" }, () => {
  const project = tmpProject("symlink-boundaries");
  initProject(project);
  const externalCache = tmpProject("external-cache");
  const sentinel = path.join(externalCache, "keep.txt");
  fs.writeFileSync(sentinel, "keep\n");
  const cacheRoot = path.join(project, ".sdlc", "cache");
  fs.rmSync(cacheRoot, { recursive: true, force: true });
  fs.symlinkSync(externalCache, cacheRoot, "dir");
  mustFail(["cache", "clear", "--root", project], /symlink|outside the target project root/i);
  assert.equal(fs.readFileSync(sentinel, "utf8"), "keep\n");

  const externalContracts = tmpProject("external-contracts");
  const contractsRoot = path.join(project, ".sdlc", "contracts");
  fs.rmSync(contractsRoot, { recursive: true, force: true });
  fs.symlinkSync(externalContracts, contractsRoot, "dir");
  mustFail(["gate", "check", "--root", project, "--strict"], /symlink/i);
  assert.deepEqual(fs.readdirSync(externalContracts), []);

  const storyProject = tmpProject("symlinked-story-record");
  initProject(storyProject);
  story(storyProject, "ST-001");
  const storyPath = path.join(storyProject, ".sdlc", "stories", "ST-001", "story.json");
  const externalStory = path.join(tmpProject("external-story"), "story.json");
  fs.copyFileSync(storyPath, externalStory);
  fs.rmSync(storyPath);
  fs.symlinkSync(externalStory, storyPath);
  mustFail(["gate", "check", "--root", storyProject, "--story", "ST-001", "--strict"], /symlink|outside the target project root/i);
});

test("contract ids cannot escape the canonical contract directory", () => {
  const project = tmpProject("contract-id-boundary");
  initProject(project);
  story(project, "ST-001");
  const storyPath = path.join(project, ".sdlc", "stories", "ST-001", "story.json");
  const storyRecord = readJson(storyPath);
  writeJson(storyPath, { ...storyRecord, contract_id: "../../outside" });
  mustFail(["gate", "check", "--root", project, "--story", "ST-001", "--strict"], /Invalid id/);
  assert.equal(fs.existsSync(path.join(project, "outside.json")), false);
});

test("nested decision changes invalidate an existing approval", () => {
  const project = tmpProject("nested-approval-hash");
  initProject(project);
  mustRun([
    "contract",
    "create",
    "--root",
    project,
    "--phase",
    "analysis",
    "--id",
    "contract-analysis",
    "--context-summary",
    "Analyze the project",
    "--qa",
    "Which boundary applies?|Repository only",
  ]);
  mustRun(["contract", "approve", "--root", project, "--id", "contract-analysis", ...humanApproval("Approved nested decision")]);
  const contractPath = path.join(project, ".sdlc", "contracts", "contract-analysis.json");
  const contract = readJson(contractPath);
  contract.contextualization.questions[0].status = "open";
  writeJson(contractPath, contract);
  mustFail(["gate", "check", "--root", project, "--strict"], /stale or missing approved_content_hash/i);
});

test("parallel contract approvals are serialized without losing records", async () => {
  const project = tmpProject("parallel-contract-approval");
  initProject(project);
  mustRun([
    "contract",
    "create",
    "--root",
    project,
    "--phase",
    "analysis",
    "--id",
    "contract-analysis",
    "--context-summary",
    "Concurrent approval test",
  ]);
  const commands = ["Approval A", "Approval B"].map((summary) => [
    "contract",
    "approve",
    "--root",
    project,
    "--id",
    "contract-analysis",
    ...humanApproval(summary),
  ]);
  const results = await Promise.all(commands.map((command) => runAsync(command)));
  for (const result of results) {
    assert.equal(result.signal, null, result.stderr);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  }
  const contract = readJson(path.join(project, ".sdlc", "contracts", "contract-analysis.json"));
  assert.deepEqual(new Set(contract.approvals.map((approval) => approval.summary)), new Set(["Approval A", "Approval B"]));
  assert.equal(contract.approvals.length, 2);
});

test("parallel contract revision and approval preserve the revised content", async () => {
  const project = tmpProject("parallel-contract-revision");
  initProject(project);
  mustRun([
    "contract",
    "create",
    "--root",
    project,
    "--phase",
    "analysis",
    "--id",
    "contract-analysis",
    "--context-summary",
    "Original contract content",
  ]);
  const revision = [
    "contract",
    "create",
    "--root",
    project,
    "--phase",
    "analysis",
    "--id",
    "contract-analysis",
    "--context-summary",
    "Revised contract content",
    "--force",
  ];
  const approval = [
    "contract",
    "approve",
    "--root",
    project,
    "--id",
    "contract-analysis",
    ...humanApproval("Concurrent approval"),
  ];
  const results = await Promise.all([runAsync(revision), runAsync(approval)]);
  assert.equal(results.find((result) => result.status !== 0), undefined, results.map((result) => result.stderr).join("\n"));
  const contract = readJson(path.join(project, ".sdlc", "contracts", "contract-analysis.json"));
  assert.equal(contract.contextualization.summary, "Revised contract content");
  if (contract.status === "approved") {
    assert.equal(contract.approvals.length, 1);
  } else {
    assert.equal(contract.status, "draft");
    assert.equal(contract.approvals.length, 0);
  }
});

test("parallel claim replacement and release cannot release the replacement claim", async () => {
  const project = tmpProject("parallel-claim-release");
  initProject(project);
  story(project, "ST-001");
  mustRun(["story", "claim", "--root", project, "--id", "ST-001", "--agent", "agent-old"]);
  const replacement = runAsync([
    "story",
    "claim",
    "--root",
    project,
    "--id",
    "ST-001",
    "--agent",
    "agent-new",
    "--actor-type",
    "human",
    "--force",
  ]);
  const release = runAsync([
    "story",
    "release",
    "--root",
    project,
    "--id",
    "ST-001",
    "--agent",
    "agent-old",
  ]);
  const [replacementResult, releaseResult] = await Promise.all([replacement, release]);
  assert.equal(replacementResult.status, 0, replacementResult.stderr);
  assert.ok([0, 1].includes(releaseResult.status), releaseResult.stderr);
  const claim = readJson(path.join(project, ".sdlc", "stories", "ST-001", "claim.json"));
  assert.equal(claim.agent, "agent-new");
  assert.equal(claim.status, "active");
});

test("parallel dependency approvals preserve every graph edge", async () => {
  const project = tmpProject("parallel-dependency-approval");
  initProject(project);
  story(project, "ST-001");
  story(project, "ST-002");
  story(project, "ST-003");
  mustRun(["dependency", "propose", "--root", project, "--id", "DEP-A", "--edge", "ST-002:ST-001:blocks:implementation:done"]);
  mustRun(["dependency", "propose", "--root", project, "--id", "DEP-B", "--edge", "ST-003:ST-001:blocks:implementation:done"]);
  const results = await Promise.all([
    runAsync(["dependency", "approve", "--root", project, "--id", "DEP-A", ...humanApproval("Approve A")]),
    runAsync(["dependency", "approve", "--root", project, "--id", "DEP-B", ...humanApproval("Approve B")]),
  ]);
  for (const result of results) {
    assert.equal(result.signal, null, result.stderr);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  }
  const graph = readJson(path.join(project, ".sdlc", "dependencies", "graph.json"));
  assert.deepEqual(new Set(graph.edges.map((edge) => edge.proposal_id)), new Set(["DEP-A", "DEP-B"]));
});

test("stale internal locks are recovered only after owner death and timeout", () => {
  const project = tmpProject("stale-internal-lock");
  initProject(project);
  mustRun([
    "contract",
    "create",
    "--root",
    project,
    "--phase",
    "analysis",
    "--id",
    "contract-analysis",
    "--context-summary",
    "Stale lock recovery",
  ]);
  const contractPath = path.join(project, ".sdlc", "contracts", "contract-analysis.json");
  const lockPath = `${contractPath}.lock`;
  writeJson(lockPath, {
    pid: 2_147_483_647,
    host: os.hostname(),
    nonce: "stale",
    created_at: new Date(Date.now() - 60_000).toISOString(),
  });
  mustRun(["contract", "approve", "--root", project, "--id", "contract-analysis", ...humanApproval("Recovered stale lock")]);
  assert.equal(fs.existsSync(lockPath), false);
  writeJson(lockPath, {
    pid: 1,
    host: "retired-build-host",
    nonce: "remote-stale",
    created_at: new Date(Date.now() - 10 * 60_000).toISOString(),
  });
  mustRun(["contract", "approve", "--root", project, "--id", "contract-analysis", ...humanApproval("Recovered expired remote lease")]);
  assert.equal(fs.existsSync(lockPath), false);
});

test("archive apply preflights all targets before moving any source", () => {
  const project = tmpProject("archive-atomic");
  initProject(project);
  const reportsRoot = path.join(project, ".sdlc", "reports");
  fs.mkdirSync(reportsRoot, { recursive: true });
  const first = path.join(reportsRoot, "a.json");
  const second = path.join(reportsRoot, "b.json");
  writeJson(first, { status: "closed" });
  writeJson(second, { status: "closed" });
  const old = new Date("2020-01-15T00:00:00.000Z");
  fs.utimesSync(first, old, old);
  fs.utimesSync(second, old, old);
  const conflictingTarget = path.join(project, ".sdlc", "archive", "2020", "01", "reports", "b.json");
  fs.mkdirSync(path.dirname(conflictingTarget), { recursive: true });
  writeJson(conflictingTarget, { existing: true });
  mustFail(["archive", "closed", "--root", project, "--before", "now", "--apply"], /Archive target already exists/);
  assert.equal(fs.existsSync(first), true);
  assert.equal(fs.existsSync(second), true);
  assert.deepEqual(readJson(conflictingTarget), { existing: true });

  const planProject = tmpProject("archive-plan-preflight");
  initProject(planProject);
  const source = writeArtifact(planProject, ".sdlc/reports/closed.json", "{}\n");
  fs.utimesSync(path.join(planProject, source), old, old);
  const existingPlan = writeArtifact(planProject, ".sdlc/archive/existing-plan.json", "{}\n");
  mustFail([
    "archive",
    "closed",
    "--root",
    planProject,
    "--before",
    "now",
    "--apply",
    "--out",
    existingPlan,
  ], /Archive plan already exists/);
  assert.equal(fs.existsSync(path.join(planProject, source)), true);
});

test("trace and sync commands reject nonexistent story ids", () => {
  const project = tmpProject("orphan-traces");
  initProject(project);
  mustFail([
    "trace",
    "append",
    "--root",
    project,
    "--story",
    "ST-MISSING",
    "--type",
    "test",
    "--summary",
    "Should not be recorded",
  ], /does not exist/);
  mustFail(["sync", "record", "--root", project, "--story", "ST-MISSING", "--event", "push"], /does not exist/);
  assert.equal(fs.existsSync(path.join(project, ".sdlc", "traces", "ST-MISSING.jsonl")), false);
});

test("personal marketplace installer stages only allowlisted plugin files", async () => {
  const home = tmpProject("personal-installer-home");
  const python = process.env.PYTHON || "python3";
  const installer = path.join(repoRoot, "scripts", "install-personal-marketplace.py");
  const install = () => spawnSync(python, [installer], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, HOME: home },
    timeout: 30_000,
  });
  const installAsync = () => new Promise((resolve, reject) => {
    const child = spawn(python, [installer], {
      cwd: repoRoot,
      env: { ...process.env, HOME: home },
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => child.kill("SIGKILL"), 35_000);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (status, signal) => {
      clearTimeout(timeout);
      resolve({ status, signal, stdout, stderr });
    });
  });
  const first = install();
  assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);
  const destination = path.join(home, "plugins", "agentic-sdlc-codex-plugin");
  assert.equal(fs.existsSync(path.join(destination, ".codex-plugin", "plugin.json")), true);
  for (const excluded of [".git", ".sdlc", "test", ".DS_Store"]) {
    assert.equal(fs.existsSync(path.join(destination, excluded)), false, `${excluded} leaked into staged plugin`);
  }
  const stale = path.join(destination, "docs", "stale.md");
  fs.writeFileSync(stale, "stale\n");
  const second = install();
  assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`);
  assert.equal(fs.existsSync(stale), false);
  const marketplace = readJson(path.join(home, ".agents", "plugins", "marketplace.json"));
  const entry = marketplace.plugins.find((plugin) => plugin.name === "agentic-sdlc-codex-plugin");
  assert.equal(entry.source.path, "./plugins/agentic-sdlc-codex-plugin");
  const concurrent = await Promise.all([installAsync(), installAsync()]);
  for (const result of concurrent) {
    assert.equal(result.signal, null, result.stderr);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  }
  const concurrentMarketplace = readJson(path.join(home, ".agents", "plugins", "marketplace.json"));
  assert.equal(
    concurrentMarketplace.plugins.filter((plugin) => plugin.name === "agentic-sdlc-codex-plugin").length,
    1,
  );
  assert.equal(
    fs.existsSync(path.join(home, ".agents", "plugins", ".agentic-sdlc-codex-plugin.install.lock")),
    false,
  );

  if (typeof process.getuid !== "function" || process.getuid() !== 0) {
    const rollbackSentinel = path.join(destination, "docs", "rollback-sentinel.md");
    fs.writeFileSync(rollbackSentinel, "restore me\n");
    const marketplaceDirectory = path.join(home, ".agents", "plugins");
    fs.chmodSync(marketplaceDirectory, 0o500);
    let failedMarketplaceUpdate;
    try {
      failedMarketplaceUpdate = install();
    } finally {
      fs.chmodSync(marketplaceDirectory, 0o700);
    }
    assert.notEqual(failedMarketplaceUpdate.status, 0);
    assert.equal(fs.readFileSync(rollbackSentinel, "utf8"), "restore me\n");
  }

  fs.writeFileSync(path.join(destination, "unmanaged.txt"), "do not delete\n");
  const refused = install();
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /unexpected unmanaged top-level entries/);
  assert.equal(fs.readFileSync(path.join(destination, "unmanaged.txt"), "utf8"), "do not delete\n");
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

test("schemas and JSON templates parse with portable local references", () => {
  for (const directory of ["schemas", "templates"]) {
    for (const entry of fs.readdirSync(path.join(repoRoot, directory))) {
      if (entry.endsWith(".json")) {
        const payload = JSON.parse(fs.readFileSync(path.join(repoRoot, directory, entry), "utf8"));
        if (directory === "schemas") {
          assert.equal(payload.$id, entry, `${entry} must resolve relative references from the local schema bundle`);
          for (const reference of collectJsonSchemaReferences(payload)) {
            if (reference.startsWith("#")) {
              continue;
            }
            const referencedFile = reference.split("#", 1)[0];
            assert.equal(path.isAbsolute(referencedFile), false, `${entry} contains absolute reference ${reference}`);
            assert.equal(fs.existsSync(path.join(repoRoot, directory, referencedFile)), true, `${entry} references missing ${reference}`);
          }
        }
      }
    }
  }

  const traceSchema = readJson(path.join(repoRoot, "schemas", "trace.schema.json"));
  assert.ok(traceSchema.properties.story_id.type.includes("null"));
  assert.ok(traceSchema.properties.request.type.includes("null"));
  assert.ok(traceSchema.$defs.actor.oneOf.some((branch) => branch.type === "null"));
  const contractSchema = readJson(path.join(repoRoot, "schemas", "contract.schema.json"));
  assert.ok(contractSchema.properties.approvals.items.properties.scope.oneOf.some((branch) => branch.type === "object"));
  const outputTemplateSchema = readJson(path.join(repoRoot, "schemas", "output-template.schema.json"));
  assert.equal(outputTemplateSchema.properties.delivery.$ref, "#/$defs/delivery");
  assert.ok(outputTemplateSchema.$defs.delivery.required.includes("mode"));
  assert.equal(outputTemplateSchema.properties.approved_delivery_hash.pattern, "^[a-f0-9]{64}$");
  const outputLinkSchema = readJson(path.join(repoRoot, "schemas", "output-link.schema.json"));
  assert.equal(outputLinkSchema.properties.delivery_format.description.includes("snapshot"), true);
  assert.equal(outputLinkSchema.properties.verification_receipt.$ref, "#/$defs/verification_receipt");
  assert.ok(outputLinkSchema.$defs.verification_receipt.required.includes("artifact_sha256"));
  const authorizationSchema = readJson(path.join(repoRoot, "schemas", "authorization.schema.json"));
  assert.ok(authorizationSchema.required.includes("allowed_actions"));
  assert.equal(authorizationSchema.properties.hash_algorithm.const, "sha256:stable-json:v1");
});

function collectJsonSchemaReferences(value, references = []) {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectJsonSchemaReferences(item, references);
    }
    return references;
  }
  if (!value || typeof value !== "object") {
    return references;
  }
  if (typeof value.$ref === "string") {
    references.push(value.$ref);
  }
  for (const item of Object.values(value)) {
    collectJsonSchemaReferences(item, references);
  }
  return references;
}

test("npm package contains only reusable plugin files", () => {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const packed = spawnSync(npm, ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(packed.status, 0, `npm pack failed\nSTDOUT:\n${packed.stdout}\nSTDERR:\n${packed.stderr}`);
  const payload = JSON.parse(packed.stdout);
  const files = payload[0].files.map((entry) => entry.path);
  assert.ok(files.includes(".codex-plugin/plugin.json"));
  assert.ok(files.includes("bin/agentic-sdlc.mjs"));
  assert.ok(files.includes("skills/agentic-sdlc/SKILL.md"));
  assert.equal(files.some((file) => file === ".sdlc" || file.startsWith(".sdlc/")), false);
  assert.equal(files.some((file) => file === "test" || file.startsWith("test/")), false);
  assert.equal(files.some((file) => file.endsWith(".DS_Store")), false);
});
