import test, { after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { computeDeliveryExecutionProfileHash } from "../lib/autonomy-policy.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(repoRoot, "bin", "agentic-sdlc.mjs");
const tempProjects = new Set();

function tmpProject(name) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), `sdlc-autonomy-${name}-`));
  tempProjects.add(project);
  return project;
}

after(() => {
  if (process.env.AGENTIC_SDLC_KEEP_TEST_TMP === "1") return;
  for (const project of tempProjects) {
    fs.rmSync(project, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
  tempProjects.clear();
});

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

function mustRunJson(args, options = {}) {
  return JSON.parse(mustRun([...args, "--json"], options).stdout);
}

function mustGit(project, args) {
  const result = spawnSync("git", ["-C", project, ...args], {
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(result.error, undefined, `git ${args.join(" ")} failed: ${result.error?.message}`);
  assert.equal(result.status, 0, `git ${args.join(" ")}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  return result.stdout.trim();
}

function fakeGitRemoteEnv(project, remoteSha) {
  const fakeBin = path.join(project, "fake-git-bin");
  const wrapper = path.join(fakeBin, "git");
  fs.mkdirSync(fakeBin, { recursive: true });
  if (!fs.existsSync(wrapper)) {
    fs.writeFileSync(wrapper, `#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const args = process.argv.slice(2);
const commandIndex = args.indexOf("ls-remote");
if (commandIndex >= 0) {
  const destinationRef = args.at(-1);
  const sha = process.env.AUTONOMY_FAKE_REMOTE_SHA || "";
  if (sha) process.stdout.write(sha + "\\t" + destinationRef + "\\n");
  process.exit(0);
}
const result = spawnSync(process.env.AUTONOMY_REAL_GIT, args, { stdio: "inherit" });
process.exit(result.status ?? 1);
`, "utf8");
    fs.chmodSync(wrapper, 0o755);
  }
  const realGit = spawnSync("which", ["git"], { encoding: "utf8" }).stdout.trim();
  assert.ok(realGit, "the test requires the host git executable");
  return {
    PATH: [fakeBin, process.env.PATH].filter(Boolean).join(path.delimiter),
    AUTONOMY_REAL_GIT: realGit,
    AUTONOMY_FAKE_REMOTE_SHA: remoteSha,
  };
}

function fakeGitHubEnv(project, values) {
  const fakeBin = path.join(project, "fake-gh-bin");
  const wrapper = path.join(fakeBin, "gh");
  fs.mkdirSync(fakeBin, { recursive: true });
  if (!fs.existsSync(wrapper)) {
    fs.writeFileSync(wrapper, `#!/usr/bin/env node
const state = process.env.AUTONOMY_FAKE_GH_STATE;
const response = {
  url: process.env.AUTONOMY_FAKE_GH_URL,
  state,
  isDraft: process.env.AUTONOMY_FAKE_GH_DRAFT === "true",
  headRefOid: process.env.AUTONOMY_FAKE_GH_HEAD_SHA,
  headRefName: process.env.AUTONOMY_FAKE_GH_HEAD,
  baseRefName: process.env.AUTONOMY_FAKE_GH_BASE,
  mergedAt: state === "MERGED" ? process.env.AUTONOMY_FAKE_GH_MERGED_AT : null,
  mergeCommit: state === "MERGED" ? { oid: process.env.AUTONOMY_FAKE_GH_MERGE_SHA } : null,
};
process.stdout.write(JSON.stringify(response));
`, "utf8");
    fs.chmodSync(wrapper, 0o755);
  }
  return {
    PATH: [fakeBin, process.env.PATH].filter(Boolean).join(path.delimiter),
    AUTONOMY_FAKE_GH_STATE: values.state,
    AUTONOMY_FAKE_GH_URL: values.url,
    AUTONOMY_FAKE_GH_DRAFT: String(values.isDraft ?? false),
    AUTONOMY_FAKE_GH_HEAD_SHA: values.headSha,
    AUTONOMY_FAKE_GH_HEAD: values.headBranch,
    AUTONOMY_FAKE_GH_BASE: values.baseBranch,
    AUTONOMY_FAKE_GH_MERGED_AT: values.mergedAt || "",
    AUTONOMY_FAKE_GH_MERGE_SHA: values.mergeSha || "",
  };
}

function humanApproval(summary) {
  return [
    "--actor-type", "human",
    "--approval-source", "explicit-user",
    "--summary", summary,
  ];
}

function hostSupportsLocalSmokeSandbox() {
  if (process.platform === "darwin") return fs.existsSync("/usr/bin/sandbox-exec");
  if (process.platform === "linux") return fs.existsSync("/usr/bin/bwrap");
  return false;
}

function taskIntent(storyId) {
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

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
    .join(",")}}`;
}

function lifecycleReceiptHash(record) {
  const canonical = structuredClone(record);
  delete canonical.receipt_hash;
  delete canonical.hash_algorithm;
  return crypto.createHash("sha256").update(stableJson(canonical)).digest("hex");
}

function initializeAutonomyProject(project) {
  mustRun(["init", "--root", project, "--project-name", "Autonomy E2E", "--force"]);
  mustGit(project, ["init"]);
  mustGit(project, ["config", "user.name", "Autonomy E2E"]);
  mustGit(project, ["config", "user.email", "autonomy-e2e@example.invalid"]);
  mustGit(project, ["commit", "--allow-empty", "-m", "test: establish PR base"]);
  mustGit(project, ["branch", "-M", "main"]);
  mustGit(project, ["remote", "add", "origin", "https://github.com/aantenore/agentic-sdlc-codex-plugin.git"]);
  mustGit(project, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
  mustGit(project, ["checkout", "-b", "codex/pr-1"]);

  const proposed = mustRunJson([
    "requirement", "propose",
    "--root", project,
    "--id", "REQ-AUTONOMY",
    "--title", "Govern one delivery at a time",
    "--summary", "Implement the agreed behavior while selecting autonomy independently for every PR or local release.",
    "--acceptance", "Each delivery has an exact non-reusable autonomy decision.",
    "--constraint", "Never infer autonomy from an earlier delivery.",
    "--autonomy-ceiling", "bounded-autonomous",
  ]);
  assert.equal(proposed.requirement.schema_version, "requirement:v2");
  assert.equal(proposed.requirement.status, "proposed");
  assert.equal(proposed.autonomy_profile.status, "proposed");
  assert.equal(proposed.autonomy_profile.autonomy_ceiling, "bounded-autonomous");

  const approved = mustRunJson([
    "requirement", "approve",
    "--root", project,
    "--id", "REQ-AUTONOMY",
    ...humanApproval("Approve the requirement and its bounded-autonomous ceiling"),
  ]);
  assert.equal(approved.requirement.status, "approved");
  assert.equal(approved.autonomy_profile.status, "active");
  assert.equal(approved.autonomy_profile.autonomy_ceiling, "bounded-autonomous");
  assert.equal(approved.autonomy_profile.authority_assurance.mode, "audit_only");

  const immutableRequirementPath = path.join(project, ".sdlc", "requirements", "REQ-AUTONOMY.json");
  const immutableRequirement = fs.readFileSync(immutableRequirementPath, "utf8");
  mustFail([
    "requirement", "propose",
    "--root", project,
    "--id", "REQ-AUTONOMY",
    "--title", "Attempted overwrite",
    "--summary", "An approved requirement must never be overwritten in place.",
    "--acceptance", "The overwrite is rejected.",
    "--autonomy-ceiling", "supervised",
    "--force",
  ], /File already exists/u);
  assert.equal(fs.readFileSync(immutableRequirementPath, "utf8"), immutableRequirement);

  mustRun([
    "output", "template", "propose",
    "--root", project,
    "--type", "implementation-summary",
    "--summary", "Implementation evidence used by autonomy E2E tests",
  ]);
  mustRun([
    "output", "template", "approve",
    "--root", project,
    "--id", "implementation-summary-v1",
    ...humanApproval("Approve the implementation evidence format"),
  ]);
}

function createApprovedImplementationContract(project, { storyId, contractId, profileId }) {
  const story = mustRunJson([
    "story", "create",
    "--root", project,
    "--id", storyId,
    "--title", `Implement ${storyId}`,
    "--phase", "implementation",
    "--status", "ready",
    "--requirement", "REQ-AUTONOMY",
    "--acceptance", `Observable implementation evidence exists for ${storyId}.`,
  ]).story;
  assert.equal(story.requirement_refs.length, 1);
  assert.equal(story.autonomy_ceiling, "bounded-autonomous");

  const contract = mustRunJson([
    "contract", "create",
    "--root", project,
    "--phase", "implementation",
    "--story", storyId,
    "--id", contractId,
    "--delivery-profile", profileId,
    "--level", "bounded-autonomous",
    "--context-summary", `Implement ${storyId} inside the exact reviewed delivery boundary.`,
    "--qa", "Who confirms the delivery boundary?|The human reviewer",
    "--output-ref", "implementation-summary:implementation-summary-v1:new",
    "--tool", "node",
  ]).contract;
  assert.equal(contract.delivery_execution_profile_id, profileId);
  assert.equal(contract.autonomy_level, "bounded-autonomous");
  assert.equal(contract.requirement_execution_profile_refs.length, 1);

  const approved = mustRunJson([
    "contract", "approve",
    "--root", project,
    "--id", contractId,
    ...humanApproval(`Approve ${contractId}`),
  ]).contract;
  assert.equal(approved.status, "approved");
}

test("requirement ceiling and an exact PR profile govern task start without leaking autonomy to another PR", () => {
  const project = tmpProject("pull-request");
  initializeAutonomyProject(project);
  createApprovedImplementationContract(project, {
    storyId: "ST-PR-1",
    contractId: "CONTRACT-PR-1",
    profileId: "AUT-PR-1",
  });
  mustRun([
    "story", "create",
    "--root", project,
    "--id", "ST-PR-CONFLICT",
    "--title", "Reject a shared delivery profile reservation",
    "--phase", "implementation",
    "--status", "ready",
    "--requirement", "REQ-AUTONOMY",
    "--acceptance", "A second contract cannot reserve AUT-PR-1.",
  ]);
  mustFail([
    "contract", "create",
    "--root", project,
    "--phase", "implementation",
    "--story", "ST-PR-CONFLICT",
    "--id", "CONTRACT-PR-CONFLICT",
    "--delivery-profile", "AUT-PR-1",
    "--context-summary", "Attempt to reserve a profile ID already owned by another contract.",
    "--qa", "May contracts share a delivery profile?|No",
    "--output-ref", "implementation-summary:implementation-summary-v1:new",
  ], /already reserved by contract CONTRACT-PR-1/u);

  const proposalArgs = [
    "autonomy", "delivery", "propose",
    "--root", project,
    "--id", "AUT-PR-1",
    "--delivery", "PR-1",
    "--kind", "pull_request",
    "--story", "ST-PR-1",
    "--contract", "CONTRACT-PR-1",
    "--requirement", "REQ-AUTONOMY",
    "--level", "bounded-autonomous",
    "--repository", "aantenore/agentic-sdlc-codex-plugin",
    "--base", "main",
    "--head", "codex/pr-1",
    "--write-path", "src",
  ];
  const expectedRemoteUrl = "https://github.com/aantenore/agentic-sdlc-codex-plugin.git";
  mustGit(project, ["remote", "set-url", "origin", "https://github.com/example/unapproved-repository.git"]);
  mustGit(project, ["remote", "set-url", "--add", "origin", expectedRemoteUrl]);
  mustGit(project, ["remote", "set-url", "--push", "--add", "origin", expectedRemoteUrl]);
  const proposed = mustRunJson(proposalArgs).delivery_profile;
  assert.equal(proposed.status, "proposed");
  assert.equal(proposed.delivery_kind, "pull_request");
  assert.equal(proposed.delivery_id, "PR-1");
  assert.equal(proposed.requested_level, "bounded-autonomous");
  assert.equal(proposed.use_policy.reusable_across_deliveries, false);
  assert.equal(proposed.pull_request_target.merge_allowed, false);

  const activated = mustRunJson([
    "autonomy", "delivery", "approve",
    "--root", project,
    "--id", "AUT-PR-1",
    "--phase", "implementation",
    ...humanApproval("Approve bounded autonomy for PR-1 only"),
  ]);
  assert.equal(activated.delivery_profile.status, "active");
  assert.equal(activated.autonomy_decision.requested_level, "bounded-autonomous");
  assert.equal(activated.autonomy_decision.effective_level, "checkpointed");
  assert.equal(activated.autonomy_decision.execution_status, "checkpoint_required");
  assert.equal(activated.autonomy_decision.requires_checkpoint, true);
  assert.equal(activated.autonomy_decision.autonomous, false);
  assert.ok(activated.autonomy_decision.reason_codes.includes("delivery.authority.audit_only_caps_autonomy"));

  const intent = taskIntent("ST-PR-1");
  const mixedFetchRemoteStart = mustRunJson([
    "task", "start",
    "--root", project,
    "--intent-json", intent,
    "--delivery-profile", "AUT-PR-1",
  ]);
  assert.equal(mixedFetchRemoteStart.execution_allowed, false);
  assert.equal(mixedFetchRemoteStart.contract_action, "repair_delivery_autonomy");
  assert.ok(mixedFetchRemoteStart.blocking_reasons.includes("autonomy_profile_invalid"));
  assert.ok(mixedFetchRemoteStart.questions.some((question) => /no Git remote matching repository/u.test(question)));
  mustGit(project, ["remote", "remove", "origin"]);
  mustGit(project, ["remote", "add", "origin", expectedRemoteUrl]);
  mustGit(project, ["update-ref", "refs/remotes/origin/main", "main"]);

  const profileMissing = mustRunJson([
    "task", "start",
    "--root", project,
    "--intent-json", intent,
  ]);
  assert.equal(profileMissing.execution_allowed, false);
  assert.equal(profileMissing.contract_action, "select_delivery_autonomy");
  assert.ok(profileMissing.blocking_reasons.includes("autonomy_selection_required"));

  const automatic = mustRunJson([
    "task", "start",
    "--root", project,
    "--intent-json", intent,
    "--delivery-profile", "AUT-PR-1",
  ]);
  assert.equal(automatic.status, "ready_to_execute");
  assert.equal(automatic.execution_allowed, true);
  assert.equal(automatic.delivery_profile_id, "AUT-PR-1");
  assert.equal(automatic.autonomy.effective_level, "checkpointed");
  assert.equal(automatic.autonomy.task_start_automatic, true);
  assert.equal(automatic.autonomy_decision.effective_level, "checkpointed");
  assert.match(automatic.autonomy_decision_path, /autonomy\/decisions\/AUT-DEC-.*\.json$/u);
  assert.match(automatic.task_start_receipt, /task-start\.json$/u);
  const receipt = JSON.parse(fs.readFileSync(path.join(project, automatic.task_start_receipt), "utf8"));
  assert.equal(receipt.delivery_profile_ref.id, "AUT-PR-1");
  assert.equal(receipt.autonomy_decision_ref.id, automatic.autonomy_decision.id);
  assert.equal(receipt.start_basis, "checkpointed-profile");
  const startTrace = fs.readFileSync(path.join(project, ".sdlc", "traces", "ST-PR-1.jsonl"), "utf8")
    .trim()
    .split(/\r?\n/u)
    .map((line) => JSON.parse(line))
    .find((event) => event.id === automatic.confirmation_trace_id);
  assert.ok(startTrace);
  assert.ok(startTrace.evidence.includes(automatic.autonomy_decision_path));

  const concurrentStart = mustRunJson([
    "task", "start",
    "--root", project,
    "--intent-json", intent,
    "--delivery-profile", "AUT-PR-1",
  ]);
  assert.equal(concurrentStart.execution_allowed, false);
  assert.equal(concurrentStart.contract_action, "repair_delivery_autonomy");
  assert.ok(concurrentStart.blocking_reasons.includes("delivery.concurrent_run_limit_exceeded"));

  mustFail([
    "autonomy", "delivery", "propose",
    "--root", project,
    "--id", "AUT-PR-1",
    "--delivery", "PR-2",
    "--kind", "pull_request",
    "--story", "ST-PR-1",
    "--contract", "CONTRACT-PR-1",
    "--requirement", "REQ-AUTONOMY",
    "--level", "bounded-autonomous",
    "--repository", "aantenore/agentic-sdlc-codex-plugin",
    "--base", "main",
    "--head", "codex/pr-2",
    "--write-path", "src",
    "--force",
  ], /File already exists|cannot be reused/u);

  mustFail([
    "autonomy", "delivery", "propose",
    "--root", project,
    "--id", "AUT-PR-2",
    "--delivery", "PR-2",
    "--kind", "pull_request",
    "--story", "ST-PR-1",
    "--contract", "CONTRACT-PR-1",
    "--requirement", "REQ-AUTONOMY",
    "--level", "bounded-autonomous",
    "--repository", "aantenore/agentic-sdlc-codex-plugin",
    "--base", "main",
    "--head", "codex/pr-2",
    "--write-path", "src",
  ], /must name --delivery-profile AUT-PR-2/u);

  const storyPath = path.join(project, ".sdlc", "stories", "ST-PR-1", "story.json");
  const originalStory = fs.readFileSync(storyPath, "utf8");
  const driftedStory = JSON.parse(originalStory);
  driftedStory.acceptance_criteria.push("Unapproved material scope expansion");
  fs.writeFileSync(storyPath, `${JSON.stringify(driftedStory, null, 2)}\n`, "utf8");
  const staleDecision = mustRunJson([
    "task", "start",
    "--root", project,
    "--intent-json", intent,
    "--delivery-profile", "AUT-PR-1",
    "--confirm-start",
    "--actor-type", "human",
  ]);
  assert.equal(staleDecision.execution_allowed, false);
  assert.equal(staleDecision.contract_action, "repair_delivery_autonomy");
  assert.equal(
    staleDecision.deterministic_checks.find((check) => check.check === "per_delivery_autonomy").status,
    "failed",
  );
  assert.ok(staleDecision.blocking_reasons.some((reason) =>
    reason === "delivery.story_refs_stale" || reason.startsWith("material_drift.")));
  fs.writeFileSync(storyPath, originalStory, "utf8");

  const profilePath = path.join(project, ".sdlc", "autonomy", "deliveries", "AUT-PR-1.json");
  const originalProfile = fs.readFileSync(profilePath, "utf8");
  const tamperedProfile = JSON.parse(originalProfile);
  tamperedProfile.pull_request_target.allowed_actions.push("pull_request.merge");
  tamperedProfile.pull_request_target.allowed_actions.sort();
  tamperedProfile.profile_hash = computeDeliveryExecutionProfileHash(tamperedProfile);
  fs.writeFileSync(profilePath, `${JSON.stringify(tamperedProfile, null, 2)}\n`, "utf8");
  const tamperedDecision = mustRunJson([
    "task", "start",
    "--root", project,
    "--intent-json", intent,
    "--delivery-profile", "AUT-PR-1",
    "--confirm-start",
    "--actor-type", "human",
  ]);
  assert.equal(tamperedDecision.execution_allowed, false);
  assert.equal(tamperedDecision.contract_action, "repair_delivery_autonomy");
  assert.ok(tamperedDecision.blocking_reasons.includes("autonomy_profile_invalid"));
  fs.writeFileSync(profilePath, originalProfile, "utf8");

  const sourcePath = path.join(project, "src", "change.txt");
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  fs.writeFileSync(sourcePath, "exact authorized change\n", "utf8");
  mustFail([
    "autonomy", "delivery", "action",
    "--root", project,
    "--id", "AUT-PR-1",
    "--action", "git.commit",
  ], /requires at least one exact --scope-path/u);

  const commitAuthorization = mustRunJson([
    "autonomy", "delivery", "action",
    "--root", project,
    "--id", "AUT-PR-1",
    "--action", "git.commit",
    "--scope-path", "src/change.txt",
  ]);
  assert.equal(commitAuthorization.status, "authorized");
  assert.equal(commitAuthorization.execution_allowed, true);
  assert.equal(commitAuthorization.action, "git.commit");
  assert.equal(commitAuthorization.checkpoint_required, false);
  assert.deepEqual(commitAuthorization.action_receipt.action_details.changed_paths, ["src/change.txt"]);
  const beforeCommit = mustGit(project, ["rev-parse", "HEAD"]);
  assert.equal(commitAuthorization.action_receipt.runtime_target.head_sha, beforeCommit);

  mustGit(project, ["add", "--", "src/change.txt"]);
  mustGit(project, ["commit", "-m", "test: exact authorized delivery change"]);
  const afterCommit = mustGit(project, ["rev-parse", "HEAD"]);
  assert.notEqual(afterCommit, beforeCommit);

  const commitCompletion = mustRunJson([
    "autonomy", "delivery", "action",
    "--root", project,
    "--id", "AUT-PR-1",
    "--action", "git.commit",
    "--outcome", "passed",
    "--evidence", "src/change.txt",
  ]);
  assert.equal(commitCompletion.status, "completed");
  assert.equal(commitCompletion.lifecycle_status, "started");
  assert.equal(commitCompletion.action_receipt.authorization_receipt_ref.id, commitAuthorization.action_receipt.id);
  assert.deepEqual(commitCompletion.action_receipt.action_details.commit, {
    before_sha: beforeCommit,
    after_sha: afterCommit,
    committed_paths: ["src/change.txt"],
  });
  assert.deepEqual(commitCompletion.action_receipt.evidence.map((item) => item.path), ["src/change.txt"]);

  mustFail([
    "autonomy", "delivery", "action",
    "--root", project,
    "--id", "AUT-PR-1",
    "--action", "git.commit",
    "--outcome", "passed",
    "--evidence", "src/change.txt",
  ], /must be authorized before recording its outcome/u);

  const pushBeforeEnv = fakeGitRemoteEnv(project, beforeCommit);
  const pushAuthorization = mustRunJson([
    "autonomy", "delivery", "action",
    "--root", project,
    "--id", "AUT-PR-1",
    "--action", "git.push",
    "--remote", "origin",
  ], { env: pushBeforeEnv });
  assert.equal(pushAuthorization.status, "authorized");
  assert.equal(pushAuthorization.action_receipt.action_details.push.source_sha, afterCommit);
  assert.equal(pushAuthorization.action_receipt.action_details.base_precondition.observed_sha, beforeCommit);
  assert.equal(pushAuthorization.action_receipt.action_details.base_precondition.base_ref, "refs/heads/main");
  assert.equal(pushAuthorization.action_receipt.action_details.push_precondition.observed_sha, beforeCommit);

  mustFail([
    "autonomy", "delivery", "action",
    "--root", project,
    "--id", "AUT-PR-1",
    "--action", "git.push",
    "--outcome", "passed",
    "--evidence", "src/change.txt",
  ], /does not resolve to/u, { env: pushBeforeEnv });

  const pushCompletion = mustRunJson([
    "autonomy", "delivery", "action",
    "--root", project,
    "--id", "AUT-PR-1",
    "--action", "git.push",
    "--outcome", "passed",
    "--evidence", "src/change.txt",
  ], { env: fakeGitRemoteEnv(project, afterCommit) });
  assert.equal(pushCompletion.status, "completed");
  assert.equal(pushCompletion.action_receipt.action_details.remote_verification.observed_sha, afterCommit);
  assert.equal(pushCompletion.action_receipt.action_details.remote_verification.destination_ref, "refs/heads/codex/pr-1");

  const closed = mustRunJson([
    "autonomy", "delivery", "close",
    "--root", project,
    "--id", "AUT-PR-1",
    "--terminal-status", "cancelled",
    "--reason", "The test delivery is complete without publishing the temporary PR.",
    ...humanApproval("Approve cancellation of this exact test delivery"),
  ]);
  assert.equal(closed.status, "terminal");
  assert.equal(closed.terminal_status, "cancelled");
  assert.equal(closed.close_receipt.terminal_action_receipt_ref, null);
  assert.equal(closed.close_receipt.approval.status, "approved");

  const terminalStatus = mustRunJson([
    "autonomy", "delivery", "status",
    "--root", project,
    "--id", "AUT-PR-1",
  ]);
  assert.equal(terminalStatus.delivery_profiles.length, 1);
  assert.equal(terminalStatus.delivery_profiles[0].lifecycle_status, "terminal");
  assert.equal(terminalStatus.delivery_profiles[0].delivery_status, "cancelled");

  const terminalReuse = mustRunJson([
    "task", "start",
    "--root", project,
    "--intent-json", intent,
    "--delivery-profile", "AUT-PR-1",
  ]);
  assert.equal(terminalReuse.execution_allowed, false);
  assert.equal(terminalReuse.contract_action, "repair_delivery_autonomy");
  assert.ok(terminalReuse.blocking_reasons.includes("delivery.profile_terminal"));

  const closePath = path.join(project, closed.close_receipt_path);
  const forgedClose = JSON.parse(fs.readFileSync(closePath, "utf8"));
  forgedClose.approval.status = "rejected";
  forgedClose.receipt_hash = lifecycleReceiptHash(forgedClose);
  fs.writeFileSync(closePath, `${JSON.stringify(forgedClose, null, 2)}\n`, "utf8");
  const forgedGate = run([
    "gate", "check",
    "--root", project,
    "--scope", "story",
    "--story", "ST-PR-1",
    "--strict",
    "--json",
  ]);
  assert.equal(forgedGate.status, 1, forgedGate.stderr || forgedGate.stdout);
  assert.match(
    `${forgedGate.stdout}\n${forgedGate.stderr}`,
    /Delivery lifecycle receipt .*close\.json validation failed: .*approval\.status: must equal "approved"/u,
  );
});

test("git.push rejects commits created outside the exact delivery action chain", () => {
  const project = tmpProject("unmediated-push");
  initializeAutonomyProject(project);
  createApprovedImplementationContract(project, {
    storyId: "ST-UNMEDIATED-PUSH",
    contractId: "CONTRACT-UNMEDIATED-PUSH",
    profileId: "AUT-UNMEDIATED-PUSH",
  });
  mustRunJson([
    "autonomy", "delivery", "propose",
    "--root", project,
    "--id", "AUT-UNMEDIATED-PUSH",
    "--delivery", "PR-UNMEDIATED-PUSH",
    "--kind", "pull_request",
    "--story", "ST-UNMEDIATED-PUSH",
    "--contract", "CONTRACT-UNMEDIATED-PUSH",
    "--requirement", "REQ-AUTONOMY",
    "--level", "supervised",
    "--repository", "aantenore/agentic-sdlc-codex-plugin",
    "--base", "main",
    "--head", "codex/pr-1",
    "--write-path", "src",
  ]);
  mustRunJson([
    "autonomy", "delivery", "approve",
    "--root", project,
    "--id", "AUT-UNMEDIATED-PUSH",
    ...humanApproval("Approve supervised autonomy for the unmediated push regression"),
  ]);
  const started = mustRunJson([
    "task", "start",
    "--root", project,
    "--intent-json", taskIntent("ST-UNMEDIATED-PUSH"),
    "--delivery-profile", "AUT-UNMEDIATED-PUSH",
    "--confirm-start",
    "--actor-type", "human",
  ]);
  assert.equal(started.execution_allowed, true);

  const beforeCommit = mustGit(project, ["rev-parse", "HEAD"]);
  const changePath = path.join(project, "src", "unmediated.txt");
  fs.mkdirSync(path.dirname(changePath), { recursive: true });
  fs.writeFileSync(changePath, "commit created outside autonomy delivery action\n", "utf8");
  mustGit(project, ["add", "--", "src/unmediated.txt"]);
  mustGit(project, ["commit", "-m", "test: create unmediated delivery commit"]);
  mustGit(project, ["update-ref", "refs/remotes/origin/main", "HEAD"]);

  mustFail([
    "autonomy", "delivery", "action",
    "--root", project,
    "--id", "AUT-UNMEDIATED-PUSH",
    "--action", "git.push",
    "--remote", "origin",
    "--confirm-action",
    ...humanApproval("Attempt to approve a push whose commit skipped the action chain"),
  ], /git\.push cannot authorize unmediated commits: .*exactly one passing completed git\.commit receipt/u, {
    env: fakeGitRemoteEnv(project, beforeCommit),
  });
});

test("pull-request merge requires an exact open pre-state and later GitHub merged post-state", () => {
  const project = tmpProject("pull-request-merge");
  initializeAutonomyProject(project);
  createApprovedImplementationContract(project, {
    storyId: "ST-PR-MERGE",
    contractId: "CONTRACT-PR-MERGE",
    profileId: "AUT-PR-MERGE",
  });
  mustRunJson([
    "autonomy", "delivery", "propose",
    "--root", project,
    "--id", "AUT-PR-MERGE",
    "--delivery", "PR-MERGE",
    "--kind", "pull_request",
    "--story", "ST-PR-MERGE",
    "--contract", "CONTRACT-PR-MERGE",
    "--requirement", "REQ-AUTONOMY",
    "--level", "checkpointed",
    "--repository", "aantenore/agentic-sdlc-codex-plugin",
    "--base", "main",
    "--head", "codex/pr-1",
    "--write-path", "src",
    "--allow-action", "pull_request.merge",
    "--merge-allowed",
  ]);
  mustRunJson([
    "autonomy", "delivery", "approve",
    "--root", project,
    "--id", "AUT-PR-MERGE",
    ...humanApproval("Approve checkpointed autonomy for this exact merge delivery"),
  ]);

  const proofPath = path.join(project, "src", "merge-proof.txt");
  const approvalProofPath = path.join(project, "src", "merge-approval.txt");
  fs.mkdirSync(path.dirname(proofPath), { recursive: true });
  fs.writeFileSync(proofPath, "exact merge head\n", "utf8");
  fs.writeFileSync(approvalProofPath, "exact human merge approval evidence\n", "utf8");
  mustGit(project, ["add", "--", "src/merge-proof.txt", "src/merge-approval.txt"]);
  mustGit(project, ["commit", "-m", "test: establish exact merge head"]);
  const headSha = mustGit(project, ["rev-parse", "HEAD"]);

  const intent = taskIntent("ST-PR-MERGE");
  const started = mustRunJson([
    "task", "start",
    "--root", project,
    "--intent-json", intent,
    "--delivery-profile", "AUT-PR-MERGE",
  ]);
  assert.equal(started.execution_allowed, true);

  const prUrl = "https://github.com/aantenore/agentic-sdlc-codex-plugin/pull/999999";
  const openState = {
    state: "OPEN",
    url: prUrl,
    headSha,
    headBranch: "codex/pr-1",
    baseBranch: "main",
  };
  mustFail([
    "autonomy", "delivery", "action",
    "--root", project,
    "--id", "AUT-PR-MERGE",
    "--action", "pull_request.merge",
    "--pr-url", prUrl,
  ], /exact open GitHub PR/u, { env: fakeGitHubEnv(project, { ...openState, isDraft: true }) });

  const checkpoint = mustRunJson([
    "autonomy", "delivery", "action",
    "--root", project,
    "--id", "AUT-PR-MERGE",
    "--action", "pull_request.merge",
    "--pr-url", prUrl,
  ], { env: fakeGitHubEnv(project, openState) });
  assert.equal(checkpoint.status, "checkpoint_required");
  assert.equal(checkpoint.action_details.merge_precondition.state, "OPEN");

  const authorization = mustRunJson([
    "autonomy", "delivery", "action",
    "--root", project,
    "--id", "AUT-PR-MERGE",
    "--action", "pull_request.merge",
    "--pr-url", prUrl,
    "--confirm-action",
    "--approval-evidence", "src/merge-approval.txt",
    ...humanApproval("Approve this exact open PR merge checkpoint"),
  ], { env: fakeGitHubEnv(project, openState) });
  assert.equal(authorization.status, "authorized");
  const mergedAt = new Date(Date.parse(authorization.action_receipt.authorized_at) + 1_000).toISOString();
  const mergeSha = "f".repeat(40);

  const completion = mustRunJson([
    "autonomy", "delivery", "action",
    "--root", project,
    "--id", "AUT-PR-MERGE",
    "--action", "pull_request.merge",
    "--outcome", "passed",
    "--evidence", "src/merge-proof.txt",
  ], {
    env: fakeGitHubEnv(project, { ...openState, state: "MERGED", mergedAt, mergeSha }),
  });
  assert.equal(completion.status, "completed");
  assert.equal(completion.lifecycle_status, "terminal");
  assert.equal(completion.action_receipt.action_details.provider_verification.state, "MERGED");
  assert.equal(completion.action_receipt.action_details.provider_verification.merge_commit_sha, mergeSha);
  const close = JSON.parse(fs.readFileSync(path.join(project, completion.close_receipt_path), "utf8"));
  assert.equal(close.terminal_status, "merged");
  assert.equal(close.terminal_action_receipt_ref.id, completion.action_receipt.id);

  fs.writeFileSync(approvalProofPath, "tampered approval evidence\n", "utf8");
  const tamperedApprovalGate = run([
    "gate", "check",
    "--root", project,
    "--scope", "story",
    "--story", "ST-PR-MERGE",
    "--strict",
    "--json",
  ]);
  assert.equal(tamperedApprovalGate.status, 1, tamperedApprovalGate.stderr || tamperedApprovalGate.stdout);
  assert.match(
    `${tamperedApprovalGate.stdout}\n${tamperedApprovalGate.stderr}`,
    /approval evidence is invalid: .*evidence changed after approval/u,
  );
});

test("local release autonomy requires a strict child target, smoke test, rollback, and supported sandbox", () => {
  const project = tmpProject("local-release");
  initializeAutonomyProject(project);
  createApprovedImplementationContract(project, {
    storyId: "ST-LOCAL-1",
    contractId: "CONTRACT-LOCAL-1",
    profileId: "AUT-LOCAL-1",
  });

  const releaseRoot = path.join(project, "local-release");
  const releaseOutput = path.join(releaseRoot, "app");
  const outsideRoot = path.join(project, "outside-release");
  fs.mkdirSync(releaseOutput, { recursive: true });
  fs.mkdirSync(outsideRoot, { recursive: true });

  const baseArgs = [
    "autonomy", "delivery", "propose",
    "--root", project,
    "--id", "AUT-LOCAL-1",
    "--delivery", "LOCAL-RELEASE-1",
    "--kind", "local_release",
    "--story", "ST-LOCAL-1",
    "--contract", "CONTRACT-LOCAL-1",
    "--requirement", "REQ-AUTONOMY",
    "--level", "bounded-autonomous",
    "--target-root", releaseRoot,
    "--smoke-test", '["node","--version"]',
    "--rollback", "Restore the previous local build directory snapshot.",
  ];
  mustFail([
    ...baseArgs,
    "--write-path", outsideRoot,
  ], /must be a strict child of root_path/u);

  const proposed = mustRunJson([
    ...baseArgs,
    "--write-path", releaseOutput,
  ]).delivery_profile;
  assert.equal(proposed.delivery_kind, "local_release");
  assert.equal(proposed.local_release_target.environment, "local");
  assert.equal(proposed.local_release_target.root_path, releaseRoot);
  assert.deepEqual(proposed.local_release_target.allowed_write_paths, [releaseOutput]);
  assert.deepEqual(proposed.local_release_target.smoke_tests, ['["node","--version"]']);
  assert.equal(proposed.local_release_target.rollback.required, true);
  assert.match(proposed.local_release_target.rollback.procedure, /previous local build/u);
  assert.equal(proposed.local_release_target.external_access_allowed, false);
  assert.equal(proposed.local_release_target.production_access_allowed, false);
  assert.equal(proposed.local_release_target.destructive_actions_allowed, false);

  const activated = mustRunJson([
    "autonomy", "delivery", "approve",
    "--root", project,
    "--id", "AUT-LOCAL-1",
    "--phase", "implementation",
    ...humanApproval("Approve this exact local release boundary"),
  ]);
  assert.equal(activated.delivery_profile.status, "active");
  assert.equal(activated.autonomy_decision.effective_level, "checkpointed");
  assert.equal(activated.autonomy_decision.requires_checkpoint, true);

  const originalReleaseOutput = `${releaseOutput}-original`;
  fs.renameSync(releaseOutput, originalReleaseOutput);
  fs.symlinkSync(outsideRoot, releaseOutput, process.platform === "win32" ? "junction" : "dir");
  const escapedBoundary = mustRunJson([
    "task", "start",
    "--root", project,
    "--intent-json", taskIntent("ST-LOCAL-1"),
    "--delivery-profile", "AUT-LOCAL-1",
    "--confirm-start",
    "--actor-type", "human",
  ]);
  assert.equal(escapedBoundary.execution_allowed, false);
  assert.equal(escapedBoundary.contract_action, "repair_delivery_autonomy");
  assert.ok(escapedBoundary.blocking_reasons.includes("autonomy_profile_invalid"));

  fs.unlinkSync(releaseOutput);
  fs.renameSync(originalReleaseOutput, releaseOutput);

  const started = mustRunJson([
    "task", "start",
    "--root", project,
    "--intent-json", taskIntent("ST-LOCAL-1"),
    "--delivery-profile", "AUT-LOCAL-1",
  ]);
  assert.equal(started.status, "ready_to_execute");
  assert.equal(started.execution_allowed, true);
  assert.equal(started.autonomy.effective_level, "checkpointed");
  assert.equal(started.autonomy.task_start_automatic, true);

  const checkpoint = mustRunJson([
    "autonomy", "delivery", "action",
    "--root", project,
    "--id", "AUT-LOCAL-1",
    "--action", "release.local",
  ]);
  assert.equal(checkpoint.status, "checkpoint_required");
  assert.equal(checkpoint.execution_allowed, false);
  assert.equal(checkpoint.checkpoints.includes("release.local"), true);

  const releaseAuthorization = mustRunJson([
    "autonomy", "delivery", "action",
    "--root", project,
    "--id", "AUT-LOCAL-1",
    "--action", "release.local",
    "--confirm-action",
    ...humanApproval("Approve this exact local release checkpoint"),
  ]);
  assert.equal(releaseAuthorization.status, "authorized");
  assert.equal(releaseAuthorization.execution_allowed, true);
  assert.equal(releaseAuthorization.checkpoint_required, true);
  assert.equal(releaseAuthorization.action_receipt.approval.status, "approved");
  assert.equal(releaseAuthorization.action_receipt.action_details.target_root, releaseRoot);
  assert.deepEqual(releaseAuthorization.action_receipt.action_details.allowed_write_paths, [releaseOutput]);

  const releaseEvidence = path.join(releaseOutput, "release-proof.txt");
  fs.writeFileSync(releaseEvidence, "local release evidence\n", "utf8");
  const completionArgs = [
    "autonomy", "delivery", "action",
    "--root", project,
    "--id", "AUT-LOCAL-1",
    "--action", "release.local",
    "--outcome", "passed",
    "--evidence", "local-release/app/release-proof.txt",
    "--smoke-test", '["node","--version"]',
    "--rollback", "Restore the previous local build directory snapshot.",
  ];
  if (!hostSupportsLocalSmokeSandbox()) {
    mustFail(
      completionArgs,
      /Local smoke-test execution requires a configured read-only, no-network sandbox on this host/u,
      { timeout: 90_000 },
    );
    const unavailableStatus = mustRunJson([
      "autonomy", "delivery", "status",
      "--root", project,
      "--id", "AUT-LOCAL-1",
    ]);
    assert.equal(unavailableStatus.delivery_profiles[0].lifecycle_status, "started");
    assert.equal(unavailableStatus.delivery_profiles[0].delivery_status, "started");
    return;
  }

  const completed = mustRunJson(completionArgs, { timeout: 90_000 });
  assert.equal(completed.status, "completed");
  assert.equal(completed.lifecycle_status, "terminal");
  assert.match(completed.close_receipt_path, /autonomy\/executions\/AUT-LOCAL-1\/close\.json$/u);
  assert.equal(completed.action_receipt.authorization_receipt_ref.id, releaseAuthorization.action_receipt.id);
  assert.equal(completed.action_receipt.local_release_verification.outcome, "passed");
  assert.deepEqual(completed.action_receipt.local_release_verification.smoke_tests, ['["node","--version"]']);
  assert.equal(completed.action_receipt.local_release_verification.smoke_test_receipts.length, 1);
  assert.deepEqual(
    completed.action_receipt.local_release_verification.smoke_test_receipts[0].command,
    ["node", "--version"],
  );
  assert.equal(completed.action_receipt.local_release_verification.smoke_test_receipts[0].outcome, "passed");
  assert.equal(completed.action_receipt.local_release_verification.smoke_test_receipts[0].exit_code, 0);

  const closeReceipt = JSON.parse(fs.readFileSync(path.join(project, completed.close_receipt_path), "utf8"));
  assert.equal(closeReceipt.terminal_status, "released");
  assert.equal(closeReceipt.terminal_action_receipt_ref.id, completed.action_receipt.id);

  const idempotentCompletion = mustRunJson([
    "autonomy", "delivery", "action",
    "--root", project,
    "--id", "AUT-LOCAL-1",
    "--action", "release.local",
    "--outcome", "passed",
    "--evidence", "local-release/app/release-proof.txt",
    "--smoke-test", '["node","--version"]',
    "--rollback", "Restore the previous local build directory snapshot.",
  ], { timeout: 90_000 });
  assert.equal(idempotentCompletion.idempotent, true);
  assert.equal(idempotentCompletion.action_receipt.id, completed.action_receipt.id);
  assert.equal(idempotentCompletion.close_receipt.receipt_hash, closeReceipt.receipt_hash);

  const status = mustRunJson([
    "autonomy", "delivery", "status",
    "--root", project,
    "--id", "AUT-LOCAL-1",
  ]);
  assert.equal(status.delivery_profiles.length, 1);
  assert.equal(status.delivery_profiles[0].lifecycle_status, "terminal");
  assert.equal(status.delivery_profiles[0].delivery_status, "released");
});

test("delivery revocation is hash-bound, single-record, and repairs a missing terminal receipt", () => {
  const project = tmpProject("revocation");
  initializeAutonomyProject(project);
  createApprovedImplementationContract(project, {
    storyId: "ST-REVOKE-1",
    contractId: "CONTRACT-REVOKE-1",
    profileId: "AUT-REVOKE-1",
  });
  mustRun([
    "autonomy", "delivery", "propose",
    "--root", project,
    "--id", "AUT-REVOKE-1",
    "--delivery", "PR-REVOKE-1",
    "--kind", "pull_request",
    "--story", "ST-REVOKE-1",
    "--contract", "CONTRACT-REVOKE-1",
    "--requirement", "REQ-AUTONOMY",
    "--level", "checkpointed",
    "--repository", "aantenore/agentic-sdlc-codex-plugin",
    "--base", "main",
    "--head", "codex/pr-1",
    "--write-path", "src",
  ]);
  mustRun([
    "autonomy", "delivery", "approve",
    "--root", project,
    "--id", "AUT-REVOKE-1",
    "--phase", "implementation",
    ...humanApproval("Approve the revocation lifecycle test profile"),
  ]);
  const started = mustRunJson([
    "task", "start",
    "--root", project,
    "--intent-json", taskIntent("ST-REVOKE-1"),
    "--delivery-profile", "AUT-REVOKE-1",
  ]);
  assert.equal(started.execution_allowed, true);

  const reason = "The exact delivery is no longer authorized to continue.";
  const revocationApprovalPath = path.join(project, "src", "revocation-approval.txt");
  fs.mkdirSync(path.dirname(revocationApprovalPath), { recursive: true });
  fs.writeFileSync(revocationApprovalPath, "exact revocation approval evidence\n", "utf8");
  const revoked = mustRunJson([
    "autonomy", "delivery", "revoke",
    "--root", project,
    "--id", "AUT-REVOKE-1",
    "--reason", reason,
    "--approval-evidence", "src/revocation-approval.txt",
    ...humanApproval("Approve revocation of this exact delivery profile"),
  ]);
  assert.equal(revoked.status, "revoked");
  assert.equal(revoked.revocation.kind, "autonomy_profile_revocation");
  assert.equal(revoked.revocation.reason, reason);
  assert.match(revoked.revocation.receipt_hash, /^[a-f0-9]{64}$/u);
  assert.equal(revoked.revocation.receipt_hash, lifecycleReceiptHash(revoked.revocation));
  assert.match(revoked.close_receipt_path, /autonomy\/executions\/AUT-REVOKE-1\/close\.json$/u);

  const closePath = path.join(project, revoked.close_receipt_path);
  fs.unlinkSync(closePath);
  const repaired = mustRunJson([
    "autonomy", "delivery", "revoke",
    "--root", project,
    "--id", "AUT-REVOKE-1",
    "--reason", reason,
  ]);
  assert.equal(repaired.status, "revoked");
  assert.equal(repaired.idempotent, true);
  assert.equal(repaired.revocation.id, revoked.revocation.id);
  assert.equal(repaired.revocation.receipt_hash, revoked.revocation.receipt_hash);
  assert.equal(fs.existsSync(path.join(project, repaired.close_receipt_path)), true);

  fs.writeFileSync(revocationApprovalPath, "tampered revocation approval evidence\n", "utf8");
  mustFail([
    "autonomy", "delivery", "status",
    "--root", project,
    "--id", "AUT-REVOKE-1",
  ], /revocation .* approval evidence changed after approval/u);
  fs.writeFileSync(revocationApprovalPath, "exact revocation approval evidence\n", "utf8");

  const revocationPath = path.join(
    project,
    ".sdlc",
    "autonomy",
    "revocations",
    `${revoked.revocation.id}.json`,
  );
  const forgedRevocation = JSON.parse(fs.readFileSync(revocationPath, "utf8"));
  forgedRevocation.reason = "forged reason";
  fs.writeFileSync(revocationPath, `${JSON.stringify(forgedRevocation, null, 2)}\n`, "utf8");
  mustFail([
    "autonomy", "delivery", "status",
    "--root", project,
    "--id", "AUT-REVOKE-1",
  ], /revocation hash is stale/u);
});
