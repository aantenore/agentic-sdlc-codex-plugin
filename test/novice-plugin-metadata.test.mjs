import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const starters = {
  assessment: "Contextualize this project and prepare an initial technical assessment.",
  newPullRequest: "Turn this new requirement into an agreed work brief, implement it, verify it, and open a new pull request.",
  existingPullRequest: "Continue this existing pull request, verify the requested changes, and update the PR without creating a new one.",
  localOnly: "Build and verify this result only on my local machine. Do not push, open a pull request, deploy, or use production.",
};

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("plugin metadata preserves the assessment starter first and exposes novice delivery starters", () => {
  const manifest = JSON.parse(read(".codex-plugin/plugin.json"));
  const prompts = manifest.interface.defaultPrompt;

  assert.equal(prompts[0], starters.assessment);
  assert.ok(prompts.includes(starters.newPullRequest));
  assert.ok(prompts.includes(starters.existingPullRequest));
  assert.ok(prompts.includes(starters.localOnly));
  assert.match(manifest.interface.shortDescription, /pull requests/i);
  assert.match(manifest.interface.longDescription, /local-only results/i);

  const coreAgentCard = read("skills/agentic-sdlc/agents/openai.yaml");
  assert.match(coreAgentCard, new RegExp(starters.newPullRequest.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(coreAgentCard, /deliver verified PRs or local results/);
});

test("getting-started and README distinguish novice destinations and execution boundaries", () => {
  const readme = read("README.md");
  const gettingStarted = read("docs/getting-started.md");
  const docsIndex = read("docs/README.md");

  for (const prompt of Object.values(starters)) {
    assert.ok(readme.includes(prompt), `README is missing starter: ${prompt}`);
    assert.ok(gettingStarted.includes(prompt), `getting-started is missing starter: ${prompt}`);
  }

  assert.match(docsIndex, /\[Getting started\]\(getting-started\.md\)/);

  for (const boundary of [
    "Codex conversation",
    "Deterministic CLI",
    "Local execution and data",
    "Repository publication",
    "Deployment or production",
  ]) {
    assert.ok(gettingStarted.includes(boundary), `getting-started is missing boundary: ${boundary}`);
  }

  assert.match(gettingStarted, /new pull request/i);
  assert.match(gettingStarted, /existing pull request/i);
  assert.match(gettingStarted, /does not mean unrestricted/i);
});

test("core skill documents the required order and discloses autonomy reduction before choice", () => {
  const skill = read("skills/agentic-sdlc/SKILL.md");
  const orderSectionStart = skill.indexOf("### Required Delivery Order");
  const workflowStart = skill.indexOf("## Workflow", orderSectionStart);

  assert.ok(orderSectionStart >= 0, "Required Delivery Order section is missing");
  assert.ok(workflowStart > orderSectionStart, "Required Delivery Order must precede the detailed workflow");

  const orderSection = skill.slice(orderSectionStart, workflowStart);
  const stages = [
    "**Preview and normalize the request**",
    "**Agree the requirement**",
    "**Decompose only when needed**",
    "**Agree the output and work brief**",
    "**Choose autonomy for this delivery**",
    "**Start the story workflow, then start once**",
    "**Implement, test, and advance phases**",
    "**Validate, then enter release**",
    "**Finish and certify at the named destination**",
  ];

  let previous = -1;
  for (const stage of stages) {
    const current = orderSection.indexOf(stage);
    assert.ok(current > previous, `stage is missing or out of order: ${stage}`);
    previous = current;
  }

  assert.match(orderSection, /Do not call `task start`/);
  assert.match(orderSection, /Before presenting the choices/);
  assert.match(orderSection, /reduced to “Autonomy with checkpoints”/);
  assert.match(skill, /--allow-action pull_request\.create/);
  assert.match(skill, /For an existing pull request/);
});

test("local novice guidance verifies rollback before release and requires a terminal lifecycle certificate", () => {
  const skill = read("skills/agentic-sdlc/SKILL.md");
  const rollbackAuthorization = skill.indexOf("--action rollback.verify");
  const releaseAuthorization = skill.indexOf("--action release.local --confirm-action");

  assert.ok(rollbackAuthorization >= 0, "skill is missing rollback verification");
  assert.ok(
    releaseAuthorization > rollbackAuthorization,
    "skill must verify rollback before authorizing local release",
  );
  assert.match(skill, /intermediate readiness check, not the final delivery certificate/u);
  assert.match(skill, /--lifecycle-complete/u);
  assert.match(skill, /requires every configured phase to have a completed canonical step/u);
  assert.match(skill, /current story-bound workflow to its configured terminal `release` phase/u);
  assert.doesNotMatch(
    skill.slice(releaseAuthorization, releaseAuthorization + 500),
    /--host-receipt-file/u,
    "default audit-only release example must not require a host receipt",
  );
});

test("installer guides bind candidate registration to the exact returned target", () => {
  for (const relativePath of ["README.md", "docs/portable-install.md", "docs/self-service-cli.md"]) {
    const document = read(relativePath);
    assert.match(document, /candidate_registration\.command\.argv/u, relativePath);
    assert.match(document, /candidate_registration\.verification\.argv/u, relativePath);
    assert.match(document, /Default target example only/u, relativePath);
    assert.match(document, /CODEX_HOME/u, relativePath);
  }
});

test("configuration and autonomy references use executable local guidance and current profile lineage", () => {
  const configurationSafety = read("docs/configuration-safety.md");
  assert.match(configurationSafety, /PLUGIN_CLI=/u);
  assert.match(configurationSafety, /node "\$PLUGIN_CLI" config status/u);
  assert.doesNotMatch(configurationSafety, /^agentic-sdlc config/gmu);

  for (const relativePath of [
    "skills/agentic-sdlc/references/contracts.md",
    "skills/agentic-sdlc/references/knowledge-base.md",
  ]) {
    const reference = read(relativePath);
    assert.match(reference, /delivery-execution-profile:v2/u, relativePath);
    assert.match(reference, /historical `?delivery-execution-profile:v1/iu, relativePath);
    assert.match(reference, /never rewritten/u, relativePath);
  }
});
