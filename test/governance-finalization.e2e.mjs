import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import { computeStableHash } from "../lib/canonical.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(REPOSITORY_ROOT, "bin", "agentic-sdlc.mjs");
const TEMPORARY_PROJECTS = new Set();

after(() => {
  if (process.env.AGENTIC_SDLC_KEEP_TEST_TMP === "1") return;
  for (const project of TEMPORARY_PROJECTS) {
    fs.rmSync(project, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
  TEMPORARY_PROJECTS.clear();
});

function temporaryProject(label) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), `agentic-sdlc-finalization-${label}-`));
  TEMPORARY_PROJECTS.add(project);
  return project;
}

function run(args, project, options = {}) {
  const env = { ...process.env };
  for (const key of ["CI", "GITHUB_ACTIONS", "GITHUB_ACTOR", "CODEX_AGENT_NAME", "CODEX_USER_ID"]) {
    delete env[key];
  }
  Object.assign(env, options.env || {});
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: project,
    encoding: "utf8",
    env,
    timeout: options.timeout || 60_000,
    maxBuffer: 10 * 1024 * 1024,
  });
}

function mustRun(args, project, options = {}) {
  const result = run(args, project, options);
  assert.equal(result.error, undefined, `${args.join(" ")} failed to execute: ${result.error?.message}`);
  assert.equal(result.signal, null, `${args.join(" ")} terminated by ${result.signal}`);
  assert.equal(
    result.status,
    0,
    `${args.join(" ")}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
  );
  return result;
}

function mustRunJson(args, project, options = {}) {
  return JSON.parse(mustRun([...args, "--json"], project, options).stdout);
}

function mustFail(args, project, pattern, options = {}) {
  const result = run(args, project, options);
  assert.equal(result.error, undefined, `${args.join(" ")} failed to execute: ${result.error?.message}`);
  assert.equal(result.signal, null, `${args.join(" ")} terminated by ${result.signal}`);
  assert.notEqual(result.status, 0, `${args.join(" ")} unexpectedly passed\n${result.stdout}`);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    pattern,
    `${args.join(" ")}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
  );
  return result;
}

function mustGit(project, args) {
  const result = spawnSync("git", ["-C", project, ...args], {
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(result.error, undefined, `git ${args.join(" ")} failed: ${result.error?.message}`);
  assert.equal(
    result.status,
    0,
    `git ${args.join(" ")}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
  );
  return result.stdout.trim();
}

function writeProjectFile(project, relativePath, contents) {
  const filePath = path.join(project, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, "utf8");
  return relativePath;
}

function readJson(project, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(project, relativePath), "utf8"));
}

function humanApproval(summary) {
  return [
    "--actor-type", "human",
    "--approval-source", "explicit-user",
    "--summary", summary,
  ];
}

function implementationIntent(storyId) {
  return JSON.stringify({
    requested_action: "implement_story",
    confidence: 0.99,
    referenced_entities: [{ type: "story", id: storyId }],
    provided_artifacts: [],
    missing_context: [],
    proposed_phase: "implementation",
    artifact_type: null,
    skip_phases: [],
  });
}

function pinProjectConfig(project) {
  const preview = mustRunJson(["config", "migrate", "--root", project], project);
  return mustRunJson([
    "config", "migrate",
    "--root", project,
    "--apply",
    "--plan-hash", preview.plan.plan_hash,
    "--actor-type", "system",
  ], project);
}

function configureCustomPhase(project, customPhase) {
  const configPath = path.join(project, ".sdlc", "config.json");
  const config = readJson(project, ".sdlc/config.json");
  config.phases[customPhase] = {
    ...config.phases.design,
    purpose: "Review package boundaries before implementation.",
  };
  config.phase_order = [
    "discovery",
    "analysis",
    "design",
    customPhase,
    "implementation",
    "validation",
    "release",
  ];
  config.autonomy_policy.presets.checkpointed.automatic_phases = [
    ...config.autonomy_policy.presets.checkpointed.automatic_phases,
    customPhase,
  ];
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  pinProjectConfig(project);
}

function initializeGitProject(project, branch, configureProject = null) {
  mustRun(["init", "--root", project, "--project-name", "Finalization regression"], project);
  configureProject?.(project);
  mustGit(project, ["init"]);
  mustGit(project, ["config", "user.name", "Finalization E2E"]);
  mustGit(project, ["config", "user.email", "finalization-e2e@example.invalid"]);
  writeProjectFile(project, "src/index.mjs", "export const ready = true;\n");
  mustGit(project, ["add", "."]);
  mustGit(project, ["commit", "-m", "test: establish governed baseline"]);
  mustGit(project, ["branch", "-M", "main"]);
  mustGit(project, ["remote", "add", "origin", "https://github.com/aantenore/agentic-sdlc-codex-plugin.git"]);
  mustGit(project, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
  mustGit(project, ["checkout", "-b", branch]);
}

function createGovernedPullRequestStory(project, {
  suffix,
  allowedWritePaths,
  outputType = "implementation-summary",
  configureProject = null,
  storyActionUses = 1,
}) {
  const requirementId = `REQ-${suffix}`;
  const storyId = `ST-${suffix}`;
  const contractId = `CONTRACT-${suffix}`;
  const profileId = `AUT-${suffix}`;
  const branch = `codex/${storyId}`;
  initializeGitProject(project, branch, configureProject);

  mustRun([
    "requirement", "propose",
    "--root", project,
    "--id", requirementId,
    "--title", `Govern ${suffix}`,
    "--summary", `Implement ${suffix} only inside its exact approved write scope.`,
    "--acceptance", `The ${suffix} story has verified implementation and delivery evidence.`,
    "--autonomy-ceiling", "supervised",
    ...allowedWritePaths.flatMap((writePath) => ["--write-path", writePath]),
  ], project);
  mustRun([
    "requirement", "approve",
    "--root", project,
    "--id", requirementId,
    ...humanApproval(`Approve ${requirementId}`),
  ], project);

  if (outputType) {
    mustRun([
      "output", "template", "propose",
      "--root", project,
      "--type", outputType,
      "--summary", `Canonical ${outputType} format`,
    ], project);
    mustRun([
      "output", "template", "approve",
      "--root", project,
      "--id", `${outputType}-v1`,
      ...humanApproval(`Approve ${outputType} output format`),
    ], project);
  }

  mustRun([
    "story", "create",
    "--root", project,
    "--id", storyId,
    "--title", `Implement ${suffix}`,
    "--phase", "implementation",
    "--status", "ready",
    "--requirement", requirementId,
    "--acceptance", `Observable evidence exists for ${suffix}.`,
  ], project);

  mustRun([
    "contract", "create",
    "--root", project,
    "--id", contractId,
    "--story", storyId,
    "--phase", "implementation",
    "--delivery-profile", profileId,
    "--level", "supervised",
    "--context-summary", `Implement ${storyId} inside the approved requirement boundary.`,
    "--qa", "Who confirms the exact delivery?|The human reviewer",
    "--tool", "node",
    ...(outputType ? ["--output-ref", `${outputType}:${outputType}-v1:new`] : []),
  ], project);
  mustRun([
    "contract", "approve",
    "--root", project,
    "--id", contractId,
    ...humanApproval(`Approve ${contractId}`),
  ], project);

  mustRun([
    "autonomy", "delivery", "propose",
    "--root", project,
    "--id", profileId,
    "--delivery", `PR-${suffix}`,
    "--kind", "pull_request",
    "--story", storyId,
    "--contract", contractId,
    "--requirement", requirementId,
    "--level", "supervised",
    "--repository", "aantenore/agentic-sdlc-codex-plugin",
    "--base", "main",
    "--head", branch,
    ...allowedWritePaths.flatMap((writePath) => ["--write-path", writePath]),
    "--allow-action", "repository.read",
    "--allow-action", "repository.write",
    "--allow-action", "test.run",
  ], project);
  mustRun([
    "autonomy", "delivery", "approve",
    "--root", project,
    "--id", profileId,
    "--phase", "implementation",
    ...humanApproval(`Approve ${profileId}`),
  ], project);
  const taskStart = mustRunJson([
    "task", "start",
    "--root", project,
    "--intent-json", implementationIntent(storyId),
    "--story", storyId,
    "--phase", "implementation",
    "--contract-id", contractId,
    "--delivery-profile", profileId,
    "--confirm-start",
    "--actor-type", "human",
  ], project);
  assert.equal(
    taskStart.execution_allowed,
    true,
    `task start should be executable: ${JSON.stringify(taskStart, null, 2)}`,
  );
  const storyActionAuthorizationId = `AUTH-${suffix}-STORY-ACTIONS`;
  mustRun([
    "authorization", "grant",
    "--root", project,
    "--id", storyActionAuthorizationId,
    "--scope", `Approve the exact governed story actions for ${storyId}.`,
    "--allow-use", `story.claim=${storyId}`,
    "--allow-use", `output.link=${storyId}`,
    "--allow-use", `story.complete-step=${storyId}`,
    ...(outputType ? ["--allow-artifact-type", outputType] : []),
    "--max-uses", String(storyActionUses),
    ...humanApproval(`Approve the exact governed story actions for ${storyId}`),
  ], project);
  mustRun([
    "story", "claim",
    "--root", project,
    "--id", storyId,
    "--agent", "codex",
    "--branch", branch,
    "--authorization", storyActionAuthorizationId,
  ], project);

  return {
    requirementId,
    storyId,
    contractId,
    profileId,
    branch,
    taskStart,
    storyActionAuthorizationId,
  };
}

function createLegacyStrictStory(project, suffix) {
  const requirementId = `REQ-${suffix}`;
  const storyId = `ST-${suffix}`;
  const contractId = `CONTRACT-${suffix}`;
  mustRun(["init", "--root", project, "--project-name", "Latest trace regression"], project);
  writeProjectFile(
    project,
    `.sdlc/requirements/${requirementId}.json`,
    `${JSON.stringify({
      id: requirementId,
      kind: "requirement",
      schema_version: "requirement:v1",
      title: `Requirement ${suffix}`,
      summary: `Canonical trace precedence requirement for ${suffix}`,
      status: "active",
      acceptance_criteria: ["The latest test and release outcomes govern completion."],
      source_paths: [],
      proposal_ref: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      audit: { fixture: true },
    }, null, 2)}\n`,
  );
  mustRun([
    "story", "create",
    "--root", project,
    "--id", storyId,
    "--title", `Trace precedence ${suffix}`,
    "--requirement", requirementId,
    "--acceptance", "Only the latest test and release attempts govern readiness.",
  ], project);
  mustRun([
    "output", "template", "propose",
    "--root", project,
    "--type", "validation-report",
    "--summary", "Canonical validation evidence format",
  ], project);
  mustRun([
    "output", "template", "approve",
    "--root", project,
    "--id", "validation-report-v1",
    ...humanApproval("Approve validation evidence format"),
  ], project);
  mustRun([
    "contract", "create",
    "--root", project,
    "--id", contractId,
    "--story", storyId,
    "--phase", "design",
    "--context-summary", "Verify latest-attempt precedence without changing the agreed scope.",
    "--qa", "Which attempt governs?|The latest recorded attempt",
    "--output-ref", "validation-report:validation-report-v1:new",
  ], project);
  mustRun([
    "contract", "approve",
    "--root", project,
    "--id", contractId,
    ...humanApproval(`Approve ${contractId}`),
  ], project);
  mustRun([
    "story", "claim",
    "--root", project,
    "--id", storyId,
    "--agent", "codex",
  ], project);
  return { storyId };
}

function appendTrace(project, storyId, type, outcome, evidence) {
  mustRun([
    "trace", "append",
    "--root", project,
    "--story", storyId,
    "--type", type,
    "--outcome", outcome,
    "--summary", `${type} attempt ${outcome}`,
    "--evidence", evidence,
    "--actor", "codex",
    "--actor-type", "agent",
  ], project);
}

test("lifecycle-complete strict gate seals a canonical receipt only after every phase and terminal delivery", () => {
  const project = temporaryProject("lifecycle");
  const customPhase = "package-boundary-check";
  const fixture = createGovernedPullRequestStory(project, {
    suffix: "FINAL",
    allowedWritePaths: ["docs"],
    outputType: "implementation-summary",
    configureProject: (target) => configureCustomPhase(target, customPhase),
    storyActionUses: 9,
  });
  const finalReceiptPath = `.sdlc/gates/${fixture.storyId}-final.json`;

  const artifact = writeProjectFile(
    project,
    "docs/implementation-summary.md",
    "# Implementation summary\n\nThe approved implementation is complete and verified.\n",
  );
  mustRun([
    "output", "link",
    "--root", project,
    "--story", fixture.storyId,
    "--type", "implementation-summary",
    "--artifact", artifact,
    "--template", "implementation-summary-v1",
    "--mode", "new",
    "--requirement", fixture.requirementId,
    "--authorization", fixture.storyActionAuthorizationId,
  ], project);

  for (const step of ["discovery", "analysis", "design", customPhase, "implementation"]) {
    mustRun([
      "story", "complete-step",
      "--root", project,
      "--id", fixture.storyId,
      "--step", step,
      "--summary", `${step} completed against the approved boundary`,
      ...(step === "implementation" ? ["--type", "implementation-summary"] : []),
      "--authorization", fixture.storyActionAuthorizationId,
    ], project);
  }

  const incomplete = mustFail([
    "gate", "check",
    "--root", project,
    "--strict",
    "--story", fixture.storyId,
    "--lifecycle-complete",
    "--json",
  ], project, /lifecycle completion requires completed phases: validation, release|latest test trace to pass|latest release trace to pass/u);
  const incompleteReport = JSON.parse(incomplete.stdout);
  assert.equal(incompleteReport.lifecycle_complete, true);
  assert.equal(fs.existsSync(path.join(project, finalReceiptPath)), false);

  const testEvidence = writeProjectFile(project, ".sdlc/tests/ST-FINAL-test.json", "{\"passed\":true}\n");
  appendTrace(project, fixture.storyId, "test", "passed", testEvidence);
  mustRun([
    "story", "complete-step",
    "--root", project,
    "--id", fixture.storyId,
    "--step", "validation",
    "--summary", "Validation completed with the latest passing test",
    "--evidence", testEvidence,
    "--authorization", fixture.storyActionAuthorizationId,
  ], project);

  const releaseEvidence = writeProjectFile(project, ".sdlc/tests/ST-FINAL-release.json", "{\"ready\":true}\n");
  appendTrace(project, fixture.storyId, "release", "passed", releaseEvidence);
  mustRun([
    "story", "complete-step",
    "--root", project,
    "--id", fixture.storyId,
    "--step", "release",
    "--summary", "Release evidence completed",
    "--evidence", releaseEvidence,
    "--authorization", fixture.storyActionAuthorizationId,
  ], project);

  mustFail([
    "gate", "check",
    "--root", project,
    "--strict",
    "--story", fixture.storyId,
    "--lifecycle-complete",
    "--json",
  ], project, /requires terminal pull_request delivery; found started/u);
  assert.equal(fs.existsSync(path.join(project, finalReceiptPath)), false);

  mustRun([
    "autonomy", "delivery", "close",
    "--root", project,
    "--id", fixture.profileId,
    "--terminal-status", "closed",
    "--reason", "The governed pull request delivery completed without further remote action.",
    ...humanApproval("Approve closing this exact delivery"),
  ], project);

  const finalReport = mustRunJson([
    "gate", "check",
    "--root", project,
    "--strict",
    "--story", fixture.storyId,
    "--lifecycle-complete",
  ], project);
  assert.equal(finalReport.status, "passed");
  assert.equal(finalReport.lifecycle_complete, true);
  assert.equal(finalReport.certification_level, "lifecycle_complete");
  assert.equal(finalReport.kind, "workflow_final_gate_receipt");
  assert.equal(finalReport.schema_version, "workflow-final-gate-receipt:v1");
  assert.equal(finalReport.final_receipt_path, finalReceiptPath);

  const receipt = readJson(project, finalReceiptPath);
  const {
    correlation_id: correlationId,
    ...canonicalFinalReport
  } = finalReport;
  assert.match(correlationId, /^corr-/u);
  assert.equal(Object.hasOwn(receipt, "correlation_id"), false);
  assert.deepEqual(receipt, canonicalFinalReport);
  const {
    receipt_hash: receiptHash,
    hash_algorithm: hashAlgorithm,
    ...receiptSubject
  } = receipt;
  assert.equal(hashAlgorithm, "sha256:stable-json:v1");
  assert.equal(receiptHash, computeStableHash(receiptSubject));
});

test("strict story gate detects an out-of-scope file committed after task start", () => {
  const project = temporaryProject("write-scope");
  const fixture = createGovernedPullRequestStory(project, {
    suffix: "SCOPE",
    allowedWritePaths: ["src"],
  });
  const taskStart = readJson(project, `.sdlc/stories/${fixture.storyId}/task-start.json`);
  const baselineSha = taskStart.audit.git.head_sha;
  assert.match(baselineSha, /^[a-f0-9]{40,64}$/u);

  writeProjectFile(project, "outside-approved-scope.md", "# Outside approved scope\n");
  mustGit(project, ["add", "outside-approved-scope.md"]);
  mustGit(project, ["commit", "-m", "test: commit out-of-scope path after task start"]);
  assert.notEqual(mustGit(project, ["rev-parse", "HEAD"]), baselineSha);

  const failedGate = mustFail([
    "gate", "check",
    "--root", project,
    "--strict",
    "--story", fixture.storyId,
    "--json",
  ], project, /changed files outside the approved requirement write paths: outside-approved-scope\.md/u);
  const report = JSON.parse(failedGate.stdout);
  assert.ok(report.errors.some((error) =>
    error.includes("outside the approved requirement write paths: outside-approved-scope.md")));
});

test("the latest failed test or release trace overrides an older passing attempt for steps and final gate", () => {
  const project = temporaryProject("latest-trace");
  const { storyId } = createLegacyStrictStory(project, "LATEST");
  const testEvidence = writeProjectFile(project, ".sdlc/tests/ST-LATEST-test.json", "{\"passed\":true}\n");
  const releaseEvidence = writeProjectFile(project, ".sdlc/tests/ST-LATEST-release.json", "{\"released\":true}\n");

  appendTrace(project, storyId, "test", "passed", testEvidence);
  appendTrace(project, storyId, "test", "failed", testEvidence);
  mustFail([
    "story", "complete-step",
    "--root", project,
    "--id", storyId,
    "--step", "validation",
    "--summary", "Validation should not accept a stale passing attempt",
    "--evidence", testEvidence,
  ], project, /latest test trace to have outcome passed/u);
  mustFail([
    "gate", "check",
    "--root", project,
    "--strict",
    "--story", storyId,
    "--lifecycle-complete",
    "--json",
  ], project, /latest test trace outcome must be passed|latest test trace to pass/u);

  appendTrace(project, storyId, "test", "passed", testEvidence);
  mustRun([
    "story", "complete-step",
    "--root", project,
    "--id", storyId,
    "--step", "validation",
    "--summary", "Validation uses the newest passing attempt",
    "--evidence", testEvidence,
  ], project);

  appendTrace(project, storyId, "release", "passed", releaseEvidence);
  appendTrace(project, storyId, "release", "failed", releaseEvidence);
  mustFail([
    "story", "complete-step",
    "--root", project,
    "--id", storyId,
    "--step", "release",
    "--summary", "Release should not accept a stale passing attempt",
    "--evidence", releaseEvidence,
  ], project, /latest release trace to have outcome ready or passed/u);
  mustFail([
    "gate", "check",
    "--root", project,
    "--strict",
    "--story", storyId,
    "--lifecycle-complete",
    "--json",
  ], project, /latest release trace outcome must be ready or passed|latest release trace to pass/u);

  appendTrace(project, storyId, "release", "passed", releaseEvidence);
  mustRun([
    "story", "complete-step",
    "--root", project,
    "--id", storyId,
    "--step", "release",
    "--summary", "Release uses the newest passing attempt",
    "--evidence", releaseEvidence,
  ], project);
});
