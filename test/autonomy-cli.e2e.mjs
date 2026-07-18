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
const providerCommandShim = path.join(repoRoot, "test", "helpers", "provider-command-shim.cjs");
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
    timeout: options.timeout || 60_000,
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

const INTERNAL_HUMAN_GUIDANCE_PATTERN = /\b(?:bounded[-_ ]autonomous|checkpoint(?:ed|s)?|audit[-_ ]only|host[-_ ]verified|profiles?|profil[oi]|receipts?|ricevut[ae]|ceiling|schema|hash(?:es)?|reason[_ -]?codes?|codic[ei] (?:motivo|ragione)|(?:REQ|AUT|AUTH|CAP|ST|ACT|PR)-[A-Z0-9][A-Z0-9._-]*)\b/iu;

function splitHumanGuidance(output, locale = "en") {
  const divider = locale === "it"
    ? "Dettagli tecnici (facoltativi):"
    : "Technical details (optional):";
  const labels = locale === "it"
    ? ["Risultato", "Cosa cambia in pratica", "Cosa devi decidere", "Cosa resta protetto", "Prossimo passo"]
    : ["Outcome", "What this changes in practice", "What you need to decide", "What remains protected", "Next step"];
  const dividerIndex = output.indexOf(divider);
  assert.notEqual(dividerIndex, -1, `missing ${divider}\n${output}`);
  const primary = output.slice(0, dividerIndex).trim();
  const technical = output.slice(dividerIndex + divider.length).trim();
  const lines = primary.split(/\r?\n/u);
  for (const label of labels) {
    assert.ok(lines.some((line) => line.startsWith(`${label}:`)), `missing ${label}\n${output}`);
  }
  assert.doesNotMatch(primary, INTERNAL_HUMAN_GUIDANCE_PATTERN);
  return { primary, technical, firstLine: lines.find(Boolean) || "" };
}

function mustGit(project, args) {
  const result = spawnSync("git", ["-C", project, ...args], {
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(result.error, undefined, `git ${args.join(" ")} failed: ${result.error?.message}`);
  assert.equal(result.status, 0, `git ${args.join(" ")}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  return result.stdout.trim();
}

function resolveHostCommand(command) {
  const locator = process.platform === "win32" ? "where.exe" : "which";
  const result = spawnSync(locator, [command], { encoding: "utf8", timeout: 30_000 });
  assert.equal(result.error, undefined, `${locator} ${command} failed: ${result.error?.message}`);
  assert.equal(result.status, 0, `${locator} ${command}\n${result.stdout}\n${result.stderr}`);
  const resolved = result.stdout.split(/\r?\n/u).map((item) => item.trim()).find(Boolean);
  assert.ok(resolved && fs.existsSync(resolved), `${command} must resolve to a host executable`);
  return fs.realpathSync.native(resolved);
}

function createNativeProviderShim(fakeBin, command) {
  const executable = path.join(fakeBin, process.platform === "win32" ? `${command}.exe` : command);
  if (!fs.existsSync(executable)) {
    const nodeExecutable = fs.realpathSync.native(process.execPath);
    if (process.platform === "win32") {
      // A hard link still points at the node.exe image mapped by this test
      // runner, so Windows may refuse to unlink it during the after hook.
      fs.copyFileSync(nodeExecutable, executable);
    } else {
      try {
        fs.linkSync(nodeExecutable, executable);
      } catch {
        fs.copyFileSync(nodeExecutable, executable);
      }
      fs.chmodSync(executable, 0o755);
    }
  }
  return executable;
}

function providerShimEnv(provider) {
  const requireOption = /\s/u.test(providerCommandShim)
    ? `--require=${JSON.stringify(providerCommandShim)}`
    : `--require=${providerCommandShim}`;
  return {
    AUTONOMY_FAKE_PROVIDER: provider,
    NODE_OPTIONS: [process.env.NODE_OPTIONS, requireOption].filter(Boolean).join(" "),
  };
}

function fakeGitRemoteEnv(project, remoteSha) {
  const fakeBin = path.join(project, "fake-git-bin");
  fs.mkdirSync(fakeBin, { recursive: true });
  const realGit = resolveHostCommand("git");
  createNativeProviderShim(fakeBin, "git");
  return {
    ...providerShimEnv("git"),
    PATH: [fakeBin, process.env.PATH].filter(Boolean).join(path.delimiter),
    AUTONOMY_REAL_GIT: realGit,
    AUTONOMY_FAKE_REMOTE_SHA: remoteSha,
  };
}

function fakeGitHubEnv(project, values) {
  const fakeBin = path.join(project, "fake-gh-bin");
  fs.mkdirSync(fakeBin, { recursive: true });
  createNativeProviderShim(fakeBin, "gh");
  return {
    ...providerShimEnv("gh"),
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

function checkpointPolicySourceHash(record) {
  const canonical = structuredClone(record);
  delete canonical.source_hash;
  delete canonical.hash_algorithm;
  return crypto.createHash("sha256").update(stableJson(canonical)).digest("hex");
}

function commitCoverageHash(record) {
  const canonical = structuredClone(record);
  delete canonical.coverage_hash;
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
  fs.rmSync(path.join(project, ".sdlc", "config.lock.json"));
  const requirementStatus = mustRun([
    "autonomy", "requirement", "status",
    "--root", project,
    "--id", "REQ-AUTONOMY",
  ]);
  const requirementGuidance = splitHumanGuidance(requirementStatus.stdout);
  assert.match(requirementGuidance.firstLine, /^Outcome: For this requirement, the most independent option available/u);
  assert.match(requirementGuidance.primary, /Every pull request or local release needs its own choice/u);
  assert.match(requirementGuidance.technical, /Requirement: REQ-AUTONOMY/u);
  assert.match(requirementGuidance.technical, /bounded-autonomous/u);
  const requirementList = mustRun([
    "requirement", "status",
    "--root", project,
    "--id", "REQ-AUTONOMY",
  ]);
  const requirementListGuidance = splitHumanGuidance(requirementList.stdout);
  assert.match(requirementListGuidance.primary, /For every pull request or local release, you will choose separately/u);
  assert.doesNotMatch(requirementListGuidance.primary, /bounded-autonomous|checkpointed|audit_only|ceiling|profile|receipt/u);
  assert.match(requirementListGuidance.technical, /Maximum technical level: bounded-autonomous/u);
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
  const proposalResponse = mustRunJson(proposalArgs);
  const proposed = proposalResponse.delivery_profile;
  assert.equal(proposed.status, "proposed");
  assert.equal(proposed.delivery_kind, "pull_request");
  assert.equal(proposed.delivery_id, "PR-1");
  assert.equal(proposed.requested_level, "bounded-autonomous");
  assert.equal(proposed.use_policy.reusable_across_deliveries, false);
  assert.equal(proposed.pull_request_target.merge_allowed, false);
  assert.match(proposalResponse.human_guidance.impact, /project “Autonomy E2E”/u);
  assert.match(proposalResponse.human_guidance.impact, /destination is “codex\/pr-1” in repository “github\.com\/aantenore\/agentic-sdlc-codex-plugin”, starting from “main”/u);
  assert.match(proposalResponse.human_guidance.impact, /change only “src”/u);
  assert.match(proposalResponse.human_guidance.required_decision, /before anything is deployed outside the local machine and before the pull request is merged/u);
  assert.match(proposalResponse.human_guidance.required_decision, /no separate calendar deadline.*ends when the pull request is merged, closed, or cancelled/u);
  assert.equal(proposalResponse.human_guidance.details.project_name, "Autonomy E2E");
  assert.deepEqual(proposalResponse.human_guidance.details.allowed_write_paths, ["src"]);
  assert.deepEqual(proposalResponse.human_guidance.details.review_moments, ["deploy.remote", "pull_request.merge"]);
  assert.equal(proposalResponse.human_guidance.details.expires_at, null);

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

  const humanStatus = mustRun([
    "autonomy", "delivery", "status",
    "--root", project,
    "--id", "AUT-PR-1",
  ]);
  const deliveryGuidance = splitHumanGuidance(humanStatus.stdout);
  assert.match(deliveryGuidance.firstLine, /^Outcome: The working choice is active for one pull request/u);
  assert.match(deliveryGuidance.primary, /What this changes in practice: .*continue between the review moments we agreed/u);
  assert.match(deliveryGuidance.primary, /Next step: .*approved limits.*review moment/u);
  assert.match(deliveryGuidance.technical, /Profile: AUT-PR-1/u);
  assert.match(deliveryGuidance.technical, /Requested technical level: bounded-autonomous/u);
  assert.match(deliveryGuidance.technical, /Effective technical level: checkpointed/u);
  assert.match(deliveryGuidance.technical, /Technical reason codes: .*delivery\.authority\.audit_only_caps_autonomy/u);

  const humanExplainItalian = mustRun([
    "autonomy", "delivery", "explain",
    "--root", project,
    "--id", "AUT-PR-1",
    "--locale", "it",
  ]);
  const deliveryGuidanceItalian = splitHumanGuidance(humanExplainItalian.stdout, "it");
  assert.match(deliveryGuidanceItalian.firstLine, /^Risultato: La scelta del modo di lavorare è attiva per una sola pull request/u);
  assert.match(deliveryGuidanceItalian.primary, /Cosa cambia in pratica: .*proseguire tra i momenti di revisione che abbiamo concordato/u);
  assert.match(deliveryGuidanceItalian.primary, /Prossimo passo: .*limiti approvati.*momento di revisione/u);
  assert.match(deliveryGuidanceItalian.technical, /Profile: AUT-PR-1/u);
  assert.match(deliveryGuidanceItalian.technical, /bounded-autonomous/u);
  assert.match(deliveryGuidanceItalian.technical, /audit_only/u);

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
  const profileMissingHuman = mustRun([
    "task", "start",
    "--root", project,
    "--intent-json", intent,
  ]);
  const profileMissingGuidance = splitHumanGuidance(profileMissingHuman.stdout);
  assert.match(profileMissingGuidance.primary, /How independently should I work on this pull request or local release/u);
  assert.match(profileMissingGuidance.primary, /Ask before every important step/u);
  assert.match(profileMissingGuidance.primary, /Work independently between review moments, but pause before the sensitive steps we agree/u);
  assert.match(profileMissingGuidance.primary, /Complete this delivery independently within the displayed limits/u);
  assert.match(profileMissingGuidance.primary, /choice applies only to this delivery and will not be reused/u);
  assert.doesNotMatch(profileMissingGuidance.primary, /bounded-autonomous|checkpointed|audit_only|ceiling|profile|receipt/u);
  assert.match(profileMissingGuidance.technical, /this pull request or local release still needs its own choice/u);
  assert.match(profileMissingGuidance.technical, /choice is never inherited from an earlier delivery/u);
  const profileMissingItalian = mustRun([
    "task", "start",
    "--root", project,
    "--intent-json", intent,
    "--locale", "it",
  ]);
  const missingGuidanceItalian = splitHumanGuidance(profileMissingItalian.stdout, "it");
  assert.match(missingGuidanceItalian.firstLine, /^Risultato: Il lavoro non è ancora iniziato/u);
  assert.match(missingGuidanceItalian.primary, /Nessuna modifica verrà avviata finché non viene chiarito il punto in attesa/u);
  assert.match(missingGuidanceItalian.primary, /Rispondi alla scelta descritta sotto oppure indica cosa deve cambiare/u);
  assert.match(missingGuidanceItalian.primary, /Quanto vuoi che proceda in autonomia per questa pull request o questo rilascio locale/u);
  assert.match(missingGuidanceItalian.primary, /Chiedimi conferma prima di ogni passaggio importante/u);
  assert.match(missingGuidanceItalian.primary, /Procedi da solo tra un momento di revisione e l’altro/u);
  assert.match(missingGuidanceItalian.primary, /Completa questa consegna da solo entro i limiti mostrati/u);
  assert.doesNotMatch(missingGuidanceItalian.primary, /bounded-autonomous|checkpointed|audit_only|ceiling|profile|receipt/u);
  assert.match(missingGuidanceItalian.technical, /questa pull request .* propria scelta del livello di autonomia/u);
  assert.match(missingGuidanceItalian.technical, /Quanto vuoi che proceda in autonomia/u);
  assert.match(missingGuidanceItalian.technical, /autonomy_selection_required/u);

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
  const invalidHumanStatus = run([
    "autonomy", "delivery", "status",
    "--root", project,
    "--id", "AUT-PR-1",
  ]);
  assert.notEqual(invalidHumanStatus.status, 0);
  const invalidGuidance = splitHumanGuidance(invalidHumanStatus.stdout);
  assert.match(invalidGuidance.firstLine, /^Outcome: This working choice needs repair and cannot be used now/u);
  assert.match(invalidGuidance.primary, /What remains protected:/u);
  assert.match(invalidGuidance.technical, /Profile: AUT-PR-1/u);
  assert.match(invalidGuidance.technical, /Effective technical level: supervised/u);
  assert.match(invalidGuidance.technical, /Technical reason codes: autonomy_profile_evaluation_failed/u);
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

  mustGit(project, ["add", "--", "src/change.txt"]);
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
  const checkpointPolicy = commitAuthorization.action_receipt.action_details.checkpoint_policy;
  assert.equal(checkpointPolicy.schema_version, "delivery-action-checkpoint-policy:v1");
  assert.equal(checkpointPolicy.action, "git.commit");
  assert.equal(checkpointPolicy.effective_level, "checkpointed");
  assert.deepEqual(checkpointPolicy.profile_ref, {
    id: "AUT-PR-1",
    hash: commitAuthorization.action_receipt.profile_ref.hash,
  });
  assert.deepEqual(checkpointPolicy.profile_checkpoints, activated.delivery_profile.checkpoints);
  assert.match(checkpointPolicy.policy_source_ref.hash, /^[a-f0-9]{64}$/u);
  assert.match(checkpointPolicy.policy_source_ref.effective_config_hash, /^[a-f0-9]{64}$/u);
  const checkpointPolicySourcePath = path.join(project, checkpointPolicy.policy_source_ref.path);
  const checkpointPolicySource = JSON.parse(fs.readFileSync(checkpointPolicySourcePath, "utf8"));
  assert.equal(checkpointPolicySource.source_hash, checkpointPolicy.policy_source_ref.hash);
  assert.equal(
    crypto.createHash("sha256").update(stableJson(checkpointPolicySource.effective_config)).digest("hex"),
    checkpointPolicy.policy_source_ref.effective_config_hash,
  );
  assert.deepEqual(
    [...checkpointPolicySource.effective_config.autonomy_policy.presets.checkpointed.checkpoints].sort(),
    checkpointPolicy.preset_checkpoints,
  );
  assert.equal(checkpointPolicy.required, false);
  assert.equal(
    commitAuthorization.action_receipt.action_details.commit_snapshot.index_tree_oid,
    mustGit(project, ["write-tree"]),
  );
  assert.equal(
    commitAuthorization.action_receipt.action_details.commit_snapshot.object_format,
    mustGit(project, ["rev-parse", "--show-object-format"]),
  );
  assert.deepEqual(
    commitAuthorization.action_receipt.action_details.commit_snapshot.staged_paths,
    ["src/change.txt"],
  );
  const { policy_hash: checkpointPolicyHash, ...checkpointPolicySubject } = checkpointPolicy;
  assert.equal(
    checkpointPolicyHash,
    crypto.createHash("sha256").update(stableJson(checkpointPolicySubject)).digest("hex"),
  );
  const beforeCommit = mustGit(project, ["rev-parse", "HEAD"]);
  assert.equal(commitAuthorization.action_receipt.runtime_target.head_sha, beforeCommit);

  mustGit(project, ["commit", "-m", "test: exact authorized delivery change"]);
  const afterCommit = mustGit(project, ["rev-parse", "HEAD"]);
  assert.notEqual(afterCommit, beforeCommit);

  const configPreview = mustRunJson([
    "config", "migrate",
    "--root", project,
  ]);
  assert.equal(configPreview.status, "planned");
  assert.equal(configPreview.plan.effective_config_hash, checkpointPolicy.policy_source_ref.effective_config_hash);
  const configApplied = mustRunJson([
    "config", "migrate",
    "--root", project,
    "--apply",
    "--plan-hash", configPreview.plan.plan_hash,
    "--actor-type", "human",
  ]);
  assert.equal(configApplied.status, "applied");
  assert.equal(fs.existsSync(checkpointPolicySourcePath), true);

  const migratedConfigPath = path.join(project, ".sdlc", "config.json");
  const changedConfig = JSON.parse(fs.readFileSync(migratedConfigPath, "utf8"));
  changedConfig.autonomy_policy.presets.checkpointed.checkpoints = [
    ...new Set([
      ...changedConfig.autonomy_policy.presets.checkpointed.checkpoints,
      "git.commit",
      "git.push",
    ]),
  ].sort();
  fs.writeFileSync(migratedConfigPath, `${JSON.stringify(changedConfig, null, 2)}\n`, "utf8");
  const changedConfigPreview = mustRunJson([
    "config", "migrate",
    "--root", project,
  ]);
  assert.equal(changedConfigPreview.status, "planned");
  assert.notEqual(changedConfigPreview.plan.effective_config_hash, checkpointPolicy.policy_source_ref.effective_config_hash);
  const changedConfigApplied = mustRunJson([
    "config", "migrate",
    "--root", project,
    "--apply",
    "--plan-hash", changedConfigPreview.plan.plan_hash,
    "--actor-type", "human",
  ]);
  assert.equal(changedConfigApplied.status, "applied");
  assert.equal(changedConfigApplied.config_hash, changedConfigPreview.plan.effective_config_hash);

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
  assert.equal(commitCompletion.checkpoint_required, false);
  assert.equal(commitCompletion.action_receipt.checkpoint_required, checkpointPolicy.required);
  assert.equal(commitCompletion.action_receipt.authorization_receipt_ref.id, commitAuthorization.action_receipt.id);
  assert.deepEqual(commitCompletion.action_receipt.action_details.commit, {
    before_sha: beforeCommit,
    after_sha: afterCommit,
    committed_paths: ["src/change.txt"],
  });
  assert.deepEqual(commitCompletion.action_receipt.evidence.map((item) => item.path), ["src/change.txt"]);
  assert.ok(
    commitCompletion.audit_warnings.some((warning) =>
      /remains valid for this exact action; updated approval rules apply to later actions/iu.test(warning)),
  );

  const statusAfterPolicyChange = mustRunJson([
    "autonomy", "delivery", "status",
    "--root", project,
    "--id", "AUT-PR-1",
  ]);
  assert.equal(statusAfterPolicyChange.delivery_profiles[0].effective_status, "active");
  assert.equal(statusAfterPolicyChange.delivery_profiles[0].lifecycle_status, "started");

  const validationAfterPolicyChange = run([
    "gate", "check",
    "--root", project,
    "--scope", "story",
    "--story", "ST-PR-1",
    "--strict",
    "--json",
  ]);
  assert.equal(validationAfterPolicyChange.error, undefined, validationAfterPolicyChange.error?.message);
  assert.equal(validationAfterPolicyChange.signal, null, `gate check terminated by ${validationAfterPolicyChange.signal}`);
  assert.ok([0, 1].includes(validationAfterPolicyChange.status), validationAfterPolicyChange.stderr || validationAfterPolicyChange.stdout);
  const validationAfterPolicyChangeReport = JSON.parse(validationAfterPolicyChange.stdout);
  assert.deepEqual(
    validationAfterPolicyChangeReport.errors.filter((error) =>
      /checkpoint policy snapshot .*stale|checkpoint flag does not match its exact action policy/iu.test(error)),
    [],
    validationAfterPolicyChange.stdout,
  );
  assert.ok(
    validationAfterPolicyChangeReport.warnings.some((warning) =>
      /remains valid for this exact action; updated approval rules apply to later actions/iu.test(warning)),
    validationAfterPolicyChange.stdout,
  );

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
    "--confirm-action",
    ...humanApproval("Approve this exact push under the current checkpoint policy"),
  ], { env: pushBeforeEnv });
  assert.equal(pushAuthorization.status, "authorized");
  assert.equal(pushAuthorization.checkpoint_required, true);
  assert.equal(pushAuthorization.action_receipt.action_details.checkpoint_policy.required, true);
  assert.equal(pushAuthorization.action_receipt.action_details.push.source_sha, afterCommit);
  assert.equal(pushAuthorization.action_receipt.action_details.base_precondition.observed_sha, beforeCommit);
  assert.equal(pushAuthorization.action_receipt.action_details.base_precondition.base_ref, "refs/heads/main");
  assert.equal(pushAuthorization.action_receipt.action_details.push_precondition.observed_sha, beforeCommit);
  assert.equal(pushAuthorization.action_receipt.action_details.commit_coverage.schema_version, "git-commit-coverage:v1");
  assert.equal(pushAuthorization.action_receipt.action_details.commit_coverage.base_sha, beforeCommit);
  assert.equal(pushAuthorization.action_receipt.action_details.commit_coverage.head_sha, afterCommit);
  assert.deepEqual(
    pushAuthorization.action_receipt.action_details.commit_coverage.entries.map((entry) => ({
      commit_sha: entry.commit_sha,
      profile_id: entry.profile_ref.id,
      authorization_id: entry.authorization_receipt_ref.id,
      completion_id: entry.completion_receipt_ref.id,
    })),
    [{
      commit_sha: afterCommit,
      profile_id: "AUT-PR-1",
      authorization_id: commitAuthorization.action_receipt.id,
      completion_id: commitCompletion.action_receipt.id,
    }],
  );
  const lockedPolicySourceRef = pushAuthorization.action_receipt.action_details.checkpoint_policy.policy_source_ref;
  assert.equal(
    lockedPolicySourceRef.effective_config_hash,
    changedConfigApplied.config_hash,
  );
  assert.notEqual(lockedPolicySourceRef.effective_config_hash, checkpointPolicy.policy_source_ref.effective_config_hash);
  assert.notEqual(lockedPolicySourceRef.hash, checkpointPolicy.policy_source_ref.hash);
  assert.notEqual(lockedPolicySourceRef.path, checkpointPolicy.policy_source_ref.path);
  assert.equal(fs.existsSync(path.join(project, lockedPolicySourceRef.path)), true);

  mustFail([
    "autonomy", "delivery", "action",
    "--root", project,
    "--id", "AUT-PR-1",
    "--action", "git.push",
    "--outcome", "passed",
    "--evidence", "src/change.txt",
  ], /does not resolve to/u, { env: pushBeforeEnv });

  const pushCompletionResult = mustRun([
    "autonomy", "delivery", "action",
    "--root", project,
    "--id", "AUT-PR-1",
    "--action", "git.push",
    "--outcome", "passed",
    "--evidence", "src/change.txt",
  ], { env: fakeGitRemoteEnv(project, afterCommit) });
  const pushCompletionGuidance = splitHumanGuidance(pushCompletionResult.stdout);
  assert.match(pushCompletionGuidance.firstLine, /^Outcome: The protected operation was completed and recorded successfully/u);
  assert.match(pushCompletionGuidance.primary, /What remains protected: Only this exact operation was recorded/u);
  assert.match(pushCompletionGuidance.technical, /Profile: AUT-PR-1/u);
  assert.match(pushCompletionGuidance.technical, /Canonical action: git\.push/u);
  const pushCompletionReceipt = fs.readdirSync(path.join(project, ".sdlc", "autonomy", "actions"))
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(fs.readFileSync(path.join(project, ".sdlc", "autonomy", "actions", name), "utf8")))
    .find((receipt) =>
      receipt.status === "completed"
      && receipt.action === "git.push"
      && receipt.authorization_receipt_ref?.id === pushAuthorization.action_receipt.id);
  assert.ok(pushCompletionReceipt);
  const pushCompletion = { status: "completed", action_receipt: pushCompletionReceipt };
  assert.equal(pushCompletion.status, "completed");
  assert.equal(pushCompletion.action_receipt.action_details.remote_verification.observed_sha, afterCommit);
  assert.equal(pushCompletion.action_receipt.action_details.remote_verification.destination_ref, "refs/heads/codex/pr-1");

  const closeResult = mustRun([
    "autonomy", "delivery", "close",
    "--root", project,
    "--id", "AUT-PR-1",
    "--terminal-status", "cancelled",
    "--reason", "The test delivery is complete without publishing the temporary PR.",
    ...humanApproval("Approve cancellation of this exact test delivery"),
  ]);
  const closeGuidance = splitHumanGuidance(closeResult.stdout);
  assert.match(closeGuidance.firstLine, /^Outcome: This delivery was closed as requested/u);
  assert.match(closeGuidance.primary, /What remains protected: The closure did not merge, release, deploy, access production/u);
  assert.match(closeGuidance.technical, /Profile: AUT-PR-1/u);
  assert.match(closeGuidance.technical, /Terminal status: cancelled/u);
  const closeReceiptRelativePath = ".sdlc/autonomy/executions/AUT-PR-1/close.json";
  const closeReceipt = JSON.parse(fs.readFileSync(
    path.join(project, closeReceiptRelativePath),
    "utf8",
  ));
  const closed = {
    status: "terminal",
    terminal_status: closeReceipt.terminal_status,
    close_receipt: closeReceipt,
    close_receipt_path: closeReceiptRelativePath,
  };
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
  const terminalDecisionIds = fs.readdirSync(path.join(project, ".sdlc", "autonomy", "decisions"))
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(fs.readFileSync(path.join(project, ".sdlc", "autonomy", "decisions", name), "utf8")))
    .filter((decision) => decision.delivery?.profile_id === "AUT-PR-1")
    .map((decision) => decision.id);
  assert.ok(terminalDecisionIds.length > 0);

  const terminalReuse = mustRunJson([
    "task", "start",
    "--root", project,
    "--intent-json", intent,
    "--delivery-profile", "AUT-PR-1",
  ]);
  assert.equal(terminalReuse.execution_allowed, false);
  assert.equal(terminalReuse.contract_action, "repair_delivery_autonomy");
  assert.ok(terminalReuse.blocking_reasons.includes("delivery.profile_terminal"));

  const successorContract = mustRunJson([
    "contract", "create",
    "--root", project,
    "--phase", "implementation",
    "--story", "ST-PR-1",
    "--id", "CONTRACT-PR-2",
    "--delivery-profile", "AUT-PR-2",
    "--level", "bounded-autonomous",
    "--context-summary", "Continue ST-PR-1 under a new exact delivery boundary without rewriting the completed PR-1 history.",
    "--qa", "May the successor reuse AUT-PR-1?|No, it must use AUT-PR-2",
    "--output-ref", "implementation-summary:implementation-summary-v1:new",
    "--tool", "node",
    "--replace-story-contract",
  ]).contract;
  assert.equal(successorContract.id, "CONTRACT-PR-2");
  assert.equal(successorContract.delivery_execution_profile_id, "AUT-PR-2");
  assert.equal(successorContract.status, "draft");

  const approvedSuccessorContract = mustRunJson([
    "contract", "approve",
    "--root", project,
    "--id", "CONTRACT-PR-2",
    ...humanApproval("Approve the successor contract without invalidating terminal PR-1 evidence"),
  ]).contract;
  assert.equal(approvedSuccessorContract.status, "approved");

  const proposedSuccessorProfile = mustRunJson([
    "autonomy", "delivery", "propose",
    "--root", project,
    "--id", "AUT-PR-2",
    "--delivery", "PR-2",
    "--kind", "pull_request",
    "--story", "ST-PR-1",
    "--contract", "CONTRACT-PR-2",
    "--requirement", "REQ-AUTONOMY",
    "--level", "bounded-autonomous",
    "--repository", "aantenore/agentic-sdlc-codex-plugin",
    "--base", "main",
    "--head", "codex/pr-1",
    "--write-path", "src",
    "--allow-action", "git.push",
  ]).delivery_profile;
  assert.equal(proposedSuccessorProfile.status, "proposed");
  assert.equal(proposedSuccessorProfile.delivery_id, "PR-2");

  const approvedSuccessorProfile = mustRunJson([
    "autonomy", "delivery", "approve",
    "--root", project,
    "--id", "AUT-PR-2",
    ...humanApproval("Approve bounded autonomy for the successor PR-2 only"),
  ]).delivery_profile;
  assert.equal(approvedSuccessorProfile.status, "active");

  const successorStart = mustRunJson([
    "task", "start",
    "--root", project,
    "--intent-json", intent,
    "--delivery-profile", "AUT-PR-2",
  ]);
  assert.equal(successorStart.execution_allowed, true);
  assert.equal(successorStart.delivery_profile_id, "AUT-PR-2");
  const multiDeliveryGuidance = splitHumanGuidance(mustRun([
    "autonomy", "delivery", "status",
    "--root", project,
  ]).stdout);
  assert.match(multiDeliveryGuidance.firstLine, /^Outcome: I found 2 separate working choices for concrete deliveries/u);
  assert.match(multiDeliveryGuidance.primary, /No choice applies to another pull request or local release/u);
  assert.match(multiDeliveryGuidance.technical, /Profile: AUT-PR-1/u);
  assert.match(multiDeliveryGuidance.technical, /Profile: AUT-PR-2/u);

  const successorPushAuthorization = mustRunJson([
    "autonomy", "delivery", "action",
    "--root", project,
    "--id", "AUT-PR-2",
    "--action", "git.push",
    "--remote", "origin",
    "--confirm-action",
    ...humanApproval("Approve the successor push under the current checkpoint policy"),
  ], { env: pushBeforeEnv });
  assert.equal(successorPushAuthorization.status, "authorized");
  assert.deepEqual(
    successorPushAuthorization.action_receipt.action_details.commit_coverage.entries.map((entry) => ({
      commit_sha: entry.commit_sha,
      profile_id: entry.profile_ref.id,
    })),
    [{ commit_sha: afterCommit, profile_id: "AUT-PR-1" }],
  );

  const successorGate = run([
    "gate", "check",
    "--root", project,
    "--scope", "story",
    "--story", "ST-PR-1",
    "--strict",
    "--json",
  ]);
  assert.equal(successorGate.error, undefined, successorGate.error?.message);
  assert.equal(successorGate.signal, null, `gate check terminated by ${successorGate.signal}`);
  assert.ok([0, 1].includes(successorGate.status), successorGate.stderr || successorGate.stdout);
  const successorGateReport = JSON.parse(successorGate.stdout);
  const historicalFalsePositives = successorGateReport.errors.filter((error) =>
    /AUT-PR-1 immutable start|AUT-PR-1 action receipt|protected action git\.commit requires/u.test(error)
      || (terminalDecisionIds.some((id) => error.includes(`autonomy decision ${id}`))
        && /does not match a fresh deterministic evaluation|cannot be reproduced/u.test(error)));
  assert.deepEqual(
    historicalFalsePositives,
    [],
    `A successor contract/profile must not invalidate terminal AUT-PR-1 evidence:\n${historicalFalsePositives.join("\n")}`,
  );
  assert.deepEqual(
    successorGateReport.errors.filter((error) =>
      /AUT-PR-2 git\.push authorization .*incomplete commit mediation|git-commit coverage proof/iu.test(error)),
    [],
    successorGate.stdout,
  );

  const successorPushReceiptPath = path.join(project, successorPushAuthorization.action_receipt_path);
  const originalSuccessorPushReceipt = fs.readFileSync(successorPushReceiptPath, "utf8");
  const pushWithoutCoverage = JSON.parse(originalSuccessorPushReceipt);
  delete pushWithoutCoverage.action_details.commit_coverage;
  pushWithoutCoverage.receipt_hash = lifecycleReceiptHash(pushWithoutCoverage);
  fs.writeFileSync(successorPushReceiptPath, `${JSON.stringify(pushWithoutCoverage, null, 2)}\n`, "utf8");
  mustFail([
    "autonomy", "delivery", "action",
    "--root", project,
    "--id", "AUT-PR-2",
    "--action", "git.push",
    "--outcome", "passed",
    "--evidence", "src/change.txt",
  ], /missing its required git-commit coverage proof/u, { env: fakeGitRemoteEnv(project, afterCommit) });
  const missingCoverageGate = run([
    "gate", "check",
    "--root", project,
    "--scope", "story",
    "--story", "ST-PR-1",
    "--strict",
    "--json",
  ]);
  assert.equal(missingCoverageGate.error, undefined, missingCoverageGate.error?.message);
  assert.equal(missingCoverageGate.signal, null, `gate check terminated by ${missingCoverageGate.signal}`);
  assert.equal(missingCoverageGate.status, 1, missingCoverageGate.stdout);
  assert.ok(
    JSON.parse(missingCoverageGate.stdout).errors.some((error) =>
      /missing its required immutable git-commit coverage proof/u.test(error)),
    missingCoverageGate.stdout,
  );
  fs.writeFileSync(successorPushReceiptPath, originalSuccessorPushReceipt, "utf8");

  const pushWithForgedStart = JSON.parse(originalSuccessorPushReceipt);
  pushWithForgedStart.action_details.commit_coverage.entries[0].start_receipt_ref.hash = "0".repeat(64);
  pushWithForgedStart.action_details.commit_coverage.coverage_hash = commitCoverageHash(
    pushWithForgedStart.action_details.commit_coverage,
  );
  pushWithForgedStart.receipt_hash = lifecycleReceiptHash(pushWithForgedStart);
  fs.writeFileSync(successorPushReceiptPath, `${JSON.stringify(pushWithForgedStart, null, 2)}\n`, "utf8");
  const forgedStartGate = run([
    "gate", "check",
    "--root", project,
    "--scope", "story",
    "--story", "ST-PR-1",
    "--strict",
    "--json",
  ]);
  assert.equal(forgedStartGate.error, undefined, forgedStartGate.error?.message);
  assert.equal(forgedStartGate.signal, null, `gate check terminated by ${forgedStartGate.signal}`);
  assert.equal(forgedStartGate.status, 1, forgedStartGate.stdout);
  assert.ok(
    JSON.parse(forgedStartGate.stdout).errors.some((error) =>
      /coverage start receipt is missing or stale/u.test(error)),
    forgedStartGate.stdout,
  );
  fs.writeFileSync(successorPushReceiptPath, originalSuccessorPushReceipt, "utf8");

  const originalCheckpointPolicySource = fs.readFileSync(checkpointPolicySourcePath, "utf8");
  const forgedCheckpointPolicySource = JSON.parse(originalCheckpointPolicySource);
  forgedCheckpointPolicySource.effective_config.autonomy_policy.presets.checkpointed.checkpoints = [
    ...forgedCheckpointPolicySource.effective_config.autonomy_policy.presets.checkpointed.checkpoints,
    "repository.write",
  ].sort();
  forgedCheckpointPolicySource.config.effective_hash = crypto.createHash("sha256")
    .update(stableJson(forgedCheckpointPolicySource.effective_config))
    .digest("hex");
  forgedCheckpointPolicySource.source_hash = checkpointPolicySourceHash(forgedCheckpointPolicySource);
  fs.writeFileSync(
    checkpointPolicySourcePath,
    `${JSON.stringify(forgedCheckpointPolicySource, null, 2)}\n`,
    "utf8",
  );
  const forgedPolicySourceGate = run([
    "gate", "check",
    "--root", project,
    "--scope", "story",
    "--story", "ST-PR-1",
    "--strict",
    "--json",
  ]);
  assert.equal(forgedPolicySourceGate.status, 1, forgedPolicySourceGate.stderr || forgedPolicySourceGate.stdout);
  assert.match(
    `${forgedPolicySourceGate.stdout}\n${forgedPolicySourceGate.stderr}`,
    /checkpoint policy snapshot source is invalid: checkpoint policy source reference is stale/u,
  );
  fs.writeFileSync(checkpointPolicySourcePath, originalCheckpointPolicySource, "utf8");

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
  const forgedGateError = JSON.parse(forgedGate.stderr || forgedGate.stdout);
  assert.match(
    forgedGateError.error.message,
    /Delivery lifecycle receipt .*close\.json validation failed: .*approval\.status: must equal "approved"/u,
  );
});

test("git.push rejects commits created outside the exact delivery action chain", () => {
  const contentProject = tmpProject("commit-content-substitution");
  initializeAutonomyProject(contentProject);
  createApprovedImplementationContract(contentProject, {
    storyId: "ST-CONTENT-SUBSTITUTION",
    contractId: "CONTRACT-CONTENT-SUBSTITUTION",
    profileId: "AUT-CONTENT-SUBSTITUTION",
  });
  mustRunJson([
    "autonomy", "delivery", "propose",
    "--root", contentProject,
    "--id", "AUT-CONTENT-SUBSTITUTION",
    "--delivery", "PR-CONTENT-SUBSTITUTION",
    "--kind", "pull_request",
    "--story", "ST-CONTENT-SUBSTITUTION",
    "--contract", "CONTRACT-CONTENT-SUBSTITUTION",
    "--requirement", "REQ-AUTONOMY",
    "--level", "bounded-autonomous",
    "--repository", "aantenore/agentic-sdlc-codex-plugin",
    "--base", "main",
    "--head", "codex/pr-1",
    "--write-path", "src",
  ]);
  mustRunJson([
    "autonomy", "delivery", "approve",
    "--root", contentProject,
    "--id", "AUT-CONTENT-SUBSTITUTION",
    "--phase", "implementation",
    ...humanApproval("Approve the exact content-substitution regression delivery"),
  ]);
  const contentStart = mustRunJson([
    "task", "start",
    "--root", contentProject,
    "--intent-json", taskIntent("ST-CONTENT-SUBSTITUTION"),
    "--delivery-profile", "AUT-CONTENT-SUBSTITUTION",
  ]);
  assert.equal(contentStart.execution_allowed, true);
  const contentPath = path.join(contentProject, "src", "content.txt");
  fs.mkdirSync(path.dirname(contentPath), { recursive: true });
  fs.writeFileSync(contentPath, "authorized content\n", "utf8");
  mustGit(contentProject, ["add", "--", "src/content.txt"]);
  const contentAuthorization = mustRunJson([
    "autonomy", "delivery", "action",
    "--root", contentProject,
    "--id", "AUT-CONTENT-SUBSTITUTION",
    "--action", "git.commit",
    "--scope-path", "src/content.txt",
  ]);
  assert.match(
    contentAuthorization.action_receipt.action_details.commit_snapshot.index_tree_oid,
    /^[a-f0-9]{40,64}$/u,
  );
  fs.writeFileSync(contentPath, "substituted after authorization\n", "utf8");
  mustGit(contentProject, ["add", "--", "src/content.txt"]);
  mustGit(contentProject, ["commit", "-m", "test: substitute authorized content"]);
  mustFail([
    "autonomy", "delivery", "action",
    "--root", contentProject,
    "--id", "AUT-CONTENT-SUBSTITUTION",
    "--action", "git.commit",
    "--outcome", "passed",
    "--evidence", "src/content.txt",
  ], /commit tree differs from the exact staged index authorized/u);

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
  const localCheckpointPolicy = releaseAuthorization.action_receipt.action_details.checkpoint_policy;
  assert.equal(localCheckpointPolicy.local_boundary_source.schema_version, "delivery-local-boundary-source:v1");
  assert.equal(localCheckpointPolicy.local_boundary_source.target_outside_workspace, false);
  assert.equal(localCheckpointPolicy.local_boundary_source.target_machine_global, false);
  assert.equal(localCheckpointPolicy.local_boundary_checkpoint, false);
  assert.equal(
    localCheckpointPolicy.local_boundary_source_hash,
    crypto.createHash("sha256")
      .update(stableJson(localCheckpointPolicy.local_boundary_source))
      .digest("hex"),
  );

  fs.writeFileSync(path.join(project, "build-runtime-proof.txt"), "local build evidence\n", "utf8");
  const historicalBuildAuthorization = mustRunJson([
    "autonomy", "delivery", "action",
    "--root", project,
    "--id", "AUT-LOCAL-1",
    "--action", "build.local",
    "--confirm-action",
    ...humanApproval("Approve this exact local build checkpoint"),
  ]);
  const historicalBuildCompletion = mustRunJson([
    "autonomy", "delivery", "action",
    "--root", project,
    "--id", "AUT-LOCAL-1",
    "--action", "build.local",
    "--outcome", "passed",
    "--evidence", "build-runtime-proof.txt",
  ]);
  assert.equal(
    historicalBuildCompletion.action_receipt.authorization_receipt_ref.id,
    historicalBuildAuthorization.action_receipt.id,
  );
  const liveBuildAuthorization = mustRunJson([
    "autonomy", "delivery", "action",
    "--root", project,
    "--id", "AUT-LOCAL-1",
    "--action", "build.local",
    "--confirm-action",
    ...humanApproval("Approve the next exact local build checkpoint"),
  ]);

  const releaseAuthorizationPath = path.join(project, releaseAuthorization.action_receipt_path);
  const originalReleaseAuthorization = fs.readFileSync(releaseAuthorizationPath, "utf8");
  const forgedReleaseAuthorization = JSON.parse(originalReleaseAuthorization);
  const forgedLocalPolicy = forgedReleaseAuthorization.action_details.checkpoint_policy;
  forgedLocalPolicy.local_boundary_source.workspace_real_path = path.join(
    path.dirname(project),
    "unrelated-workspace",
  );
  forgedLocalPolicy.local_boundary_source_hash = crypto.createHash("sha256")
    .update(stableJson(forgedLocalPolicy.local_boundary_source))
    .digest("hex");
  const { policy_hash: _forgedPolicyHash, ...forgedPolicySubject } = forgedLocalPolicy;
  forgedLocalPolicy.policy_hash = crypto.createHash("sha256")
    .update(stableJson(forgedPolicySubject))
    .digest("hex");
  forgedReleaseAuthorization.receipt_hash = lifecycleReceiptHash(forgedReleaseAuthorization);
  fs.writeFileSync(
    releaseAuthorizationPath,
    `${JSON.stringify(forgedReleaseAuthorization, null, 2)}\n`,
    "utf8",
  );
  const forgedLocalBoundaryGate = run([
    "gate", "check",
    "--root", project,
    "--scope", "story",
    "--story", "ST-LOCAL-1",
    "--strict",
    "--json",
  ]);
  assert.equal(forgedLocalBoundaryGate.status, 1, forgedLocalBoundaryGate.stderr || forgedLocalBoundaryGate.stdout);
  assert.match(
    `${forgedLocalBoundaryGate.stdout}\n${forgedLocalBoundaryGate.stderr}`,
    /checkpoint policy snapshot has an invalid local-boundary source binding/u,
  );
  fs.writeFileSync(releaseAuthorizationPath, originalReleaseAuthorization, "utf8");

  const localConfigPreview = mustRunJson([
    "config", "migrate",
    "--root", project,
  ]);
  assert.equal(localConfigPreview.status, "planned");
  mustRunJson([
    "config", "migrate",
    "--root", project,
    "--apply",
    "--plan-hash", localConfigPreview.plan.plan_hash,
    "--actor-type", "human",
  ]);
  const localConfigPath = path.join(project, ".sdlc", "config.json");
  const changedLocalConfig = JSON.parse(fs.readFileSync(localConfigPath, "utf8"));
  changedLocalConfig.autonomy_policy.presets.checkpointed.checkpoints = [
    ...new Set([
      ...changedLocalConfig.autonomy_policy.presets.checkpointed.checkpoints,
      "git.commit",
    ]),
  ].sort();
  fs.writeFileSync(localConfigPath, `${JSON.stringify(changedLocalConfig, null, 2)}\n`, "utf8");
  const changedLocalConfigPreview = mustRunJson([
    "config", "migrate",
    "--root", project,
  ]);
  assert.equal(changedLocalConfigPreview.status, "planned");
  mustRunJson([
    "config", "migrate",
    "--root", project,
    "--apply",
    "--plan-hash", changedLocalConfigPreview.plan.plan_hash,
    "--actor-type", "human",
  ]);
  const configOnlyDriftGate = run([
    "gate", "check",
    "--root", project,
    "--scope", "story",
    "--story", "ST-LOCAL-1",
    "--strict",
    "--json",
  ]);
  assert.equal(configOnlyDriftGate.error, undefined, configOnlyDriftGate.error?.message);
  assert.equal(configOnlyDriftGate.signal, null, `gate check terminated by ${configOnlyDriftGate.signal}`);
  assert.ok([0, 1].includes(configOnlyDriftGate.status), configOnlyDriftGate.stderr || configOnlyDriftGate.stdout);
  const configOnlyDriftReport = JSON.parse(configOnlyDriftGate.stdout);
  assert.equal(
    configOnlyDriftReport.errors.some((error) =>
      /different local target or machine scope/iu.test(error)),
    false,
    configOnlyDriftGate.stdout,
  );
  assert.ok(
    configOnlyDriftReport.warnings.some((warning) =>
      /remains valid for this exact action; updated approval rules apply to later actions/iu.test(warning)),
    configOnlyDriftGate.stdout,
  );

  const relocatedProject = `${project}-relocated`;
  fs.cpSync(project, relocatedProject, { recursive: true });
  tempProjects.add(relocatedProject);
  fs.writeFileSync(
    path.join(relocatedProject, "release-runtime-proof.txt"),
    "local release runtime-boundary evidence\n",
    "utf8",
  );
  const relocatedBoundaryGate = run([
    "gate", "check",
    "--root", relocatedProject,
    "--scope", "story",
    "--story", "ST-LOCAL-1",
    "--strict",
    "--json",
  ]);
  assert.equal(
    relocatedBoundaryGate.status,
    1,
    relocatedBoundaryGate.stderr || relocatedBoundaryGate.stdout,
  );
  assert.match(
    `${relocatedBoundaryGate.stdout}\n${relocatedBoundaryGate.stderr}`,
    /different local target or machine scope/u,
  );
  const relocatedBoundaryReport = JSON.parse(relocatedBoundaryGate.stdout);
  const localTargetErrors = relocatedBoundaryReport.errors.filter((error) =>
    /different local target or machine scope/u.test(error));
  const localTargetReceiptIds = new Set(localTargetErrors.flatMap((error) =>
    error.match(/AUT-ACT-[0-9]+-[a-f0-9]+/gu) || []));
  assert.equal(localTargetReceiptIds.size, 2, relocatedBoundaryGate.stdout);
  assert.equal(
    localTargetErrors.some((error) => error.includes(historicalBuildAuthorization.action_receipt.id)),
    false,
    relocatedBoundaryGate.stdout,
  );
  assert.equal(
    localTargetErrors.some((error) => error.includes(liveBuildAuthorization.action_receipt.id)),
    true,
    relocatedBoundaryGate.stdout,
  );
  mustFail([
    "autonomy", "delivery", "action",
    "--root", relocatedProject,
    "--id", "AUT-LOCAL-1",
    "--action", "build.local",
    "--outcome", "failed",
    "--evidence", "build-runtime-proof.txt",
  ], /different local target or machine scope/u);
  mustFail([
    "autonomy", "delivery", "action",
    "--root", relocatedProject,
    "--id", "AUT-LOCAL-1",
    "--action", "release.local",
    "--outcome", "passed",
    "--evidence", "release-runtime-proof.txt",
    "--smoke-test", '["node","--version"]',
    "--rollback", "Restore the previous local build directory snapshot.",
  ], /different local target or machine scope/u);

  mustRunJson([
    "autonomy", "delivery", "action",
    "--root", relocatedProject,
    "--id", "AUT-LOCAL-1",
    "--action", "build.local",
    "--confirm-action",
    ...humanApproval("Approve the relocated local build target"),
  ]);
  mustRunJson([
    "autonomy", "delivery", "action",
    "--root", relocatedProject,
    "--id", "AUT-LOCAL-1",
    "--action", "release.local",
    "--confirm-action",
    ...humanApproval("Approve the relocated local release target"),
  ]);
  const refreshedBoundaryGate = run([
    "gate", "check",
    "--root", relocatedProject,
    "--scope", "story",
    "--story", "ST-LOCAL-1",
    "--strict",
    "--json",
  ]);
  assert.ok([0, 1].includes(refreshedBoundaryGate.status), refreshedBoundaryGate.stderr);
  const refreshedBoundaryReport = JSON.parse(refreshedBoundaryGate.stdout);
  assert.equal(
    refreshedBoundaryReport.errors.some((error) => /different local target or machine scope/u.test(error)),
    false,
    refreshedBoundaryGate.stdout,
  );
  assert.equal(
    refreshedBoundaryReport.warnings.some((warning) => /superseded by a later unconsumed authorization/u.test(warning)),
    true,
    refreshedBoundaryGate.stdout,
  );

  const assertHistoricalGateDoesNotReopenLocalTarget = () => {
    const unavailableReleaseRoot = `${releaseRoot}-after-completion`;
    fs.renameSync(releaseRoot, unavailableReleaseRoot);
    try {
      const historicalGate = run([
        "gate", "check",
        "--root", project,
        "--scope", "story",
        "--story", "ST-LOCAL-1",
        "--strict",
        "--json",
      ]);
      assert.equal(historicalGate.error, undefined, historicalGate.error?.message);
      assert.doesNotMatch(
        `${historicalGate.stdout}\n${historicalGate.stderr}`,
        /Local release target root must be an existing directory/u,
      );
    } finally {
      fs.renameSync(unavailableReleaseRoot, releaseRoot);
    }
  };

  const releaseEvidence = path.join(releaseOutput, "release-proof.txt");
  fs.writeFileSync(releaseEvidence, "local release evidence\n", "utf8");
  const completionArgsFor = (root) => [
    "autonomy", "delivery", "action",
    "--root", root,
    "--id", "AUT-LOCAL-1",
    "--action", "release.local",
    "--outcome", "passed",
    "--evidence", "local-release/app/release-proof.txt",
    "--smoke-test", '["node","--version"]',
    "--rollback", "Restore the previous local build directory snapshot.",
  ];
  const completionArgs = completionArgsFor(project);
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
    const cancelled = mustRunJson([
      "autonomy", "delivery", "close",
      "--root", project,
      "--id", "AUT-LOCAL-1",
      "--terminal-status", "cancelled",
      "--reason", "The host has no supported smoke-test sandbox for this local fixture.",
      ...humanApproval("Approve cancellation of the sandbox-unavailable local fixture"),
    ]);
    assert.equal(cancelled.status, "terminal");
    assertHistoricalGateDoesNotReopenLocalTarget();
    return;
  }

  const interruptedProject = `${project}-interrupted`;
  fs.cpSync(project, interruptedProject, { recursive: true });
  tempProjects.add(interruptedProject);
  const interruptedAuthorization = mustRunJson([
    "autonomy", "delivery", "action",
    "--root", interruptedProject,
    "--id", "AUT-LOCAL-1",
    "--action", "release.local",
    "--confirm-action",
    ...humanApproval("Approve the exact interrupted-release fixture target"),
  ]);
  mustFail(
    completionArgsFor(interruptedProject),
    /Simulated interruption after the terminal completion receipt was persisted/u,
    {
      timeout: 90_000,
      env: {
        NODE_ENV: "test",
        AGENTIC_SDLC_TEST_DELIVERY_ACTION_FAILURE: "after-terminal-completion-receipt",
      },
    },
  );
  const interruptedRelocatedProject = `${interruptedProject}-relocated`;
  fs.cpSync(interruptedProject, interruptedRelocatedProject, { recursive: true });
  tempProjects.add(interruptedRelocatedProject);
  const repairedAfterRelocation = mustRunJson(
    completionArgsFor(interruptedRelocatedProject),
    { timeout: 90_000 },
  );
  assert.equal(repairedAfterRelocation.status, "terminal");
  assert.equal(repairedAfterRelocation.idempotent_repair, true);
  assert.equal(
    repairedAfterRelocation.action_receipt.authorization_receipt_ref.id,
    interruptedAuthorization.action_receipt.id,
  );
  const recoveredGate = run([
    "gate", "check",
    "--root", interruptedRelocatedProject,
    "--scope", "story",
    "--story", "ST-LOCAL-1",
    "--strict",
    "--json",
  ]);
  assert.ok([0, 1].includes(recoveredGate.status), recoveredGate.stderr);
  assert.doesNotMatch(
    `${recoveredGate.stdout}\n${recoveredGate.stderr}`,
    /different local target or machine scope/u,
  );

  const completed = mustRunJson(completionArgs, { timeout: 90_000 });
  assert.equal(completed.status, "completed");
  assert.equal(completed.lifecycle_status, "terminal");
  assert.ok(completed.audit_warnings.some((warning) =>
    /remains valid for this exact action; updated approval rules apply to later actions/iu.test(warning)));
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
  assertHistoricalGateDoesNotReopenLocalTarget();
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
