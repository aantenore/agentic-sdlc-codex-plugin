import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import { findCommand, listCommandPaths, listOptions } from "../../lib/cli/command-catalog.mjs";
import { completionCandidates } from "../../lib/cli/completion.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CLI = path.join(ROOT, "bin", "agentic-sdlc.mjs");
const TEMPORARY_DIRECTORIES = new Set();

after(() => {
  for (const directory of TEMPORARY_DIRECTORIES) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryProject(label) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `agentic-sdlc-workflow-${label}-`));
  TEMPORARY_DIRECTORIES.add(directory);
  return directory;
}

function run(args, cwd) {
  const env = { ...process.env };
  for (const key of ["CI", "GITHUB_ACTIONS", "GITHUB_ACTOR", "CODEX_AGENT_NAME", "CODEX_USER_ID"]) delete env[key];
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    env,
    timeout: 30_000,
  });
}

function mustRun(args, cwd) {
  const result = run(args, cwd);
  assert.equal(result.status, 0, `${args.join(" ")}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  return result.stdout;
}

function mustRunJson(args, cwd) {
  return JSON.parse(mustRun([...args, "--json"], cwd));
}

function primaryHumanText(output, locale = "en") {
  const divider = locale === "it" ? "Dettagli tecnici (facoltativi):" : "Technical details (optional):";
  assert.match(output, new RegExp(divider.replace(/[()]/gu, "\\$&"), "u"));
  return output.split(divider)[0];
}

test("workflow catalog and completion expose the complete bounded command family", () => {
  const paths = new Set(listCommandPaths());
  for (const command of [
    "workflow definition list",
    "workflow definition show",
    "workflow definition propose",
    "workflow definition approve",
    "workflow overlay propose",
    "workflow overlay approve",
    "workflow overlay explain",
    "workflow instance start",
    "workflow instance transition",
    "workflow instance status",
    "workflow instance explain",
  ]) {
    assert.equal(paths.has(command), true, command);
    assert.ok(findCommand(command), command);
  }

  const workflow = completionCandidates(["workflow"]);
  for (const child of ["definition", "instance", "overlay"]) assert.equal(workflow.includes(child), true, child);
  assert.equal(workflow.includes("approve"), false);
  const definition = completionCandidates(["workflow", "definition"]);
  for (const child of ["approve", "list", "propose", "show"]) assert.equal(definition.includes(child), true, child);
  const transition = completionCandidates(["workflow", "instance", "transition"]);
  for (const flag of ["--id", "--to", "--request-id", "--guard-input-json", "--locale", "--json"]) {
    assert.equal(transition.includes(flag), true, flag);
  }

  const approvalFlags = new Set(listOptions("workflow definition approve").map((entry) => entry.flag));
  for (const flag of ["--id", "--definition-version", "--actor-type", "--approval-source", "--authorization", "--summary"]) {
    assert.equal(approvalFlags.has(flag), true, flag);
  }
});

test("preset definition approval and an event-sourced run are stable and retry-safe", () => {
  const project = temporaryProject("journey");
  mustRun(["init", "--root", project, "--project-name", "Workflow journey"], project);

  const listed = mustRunJson(["workflow", "definition", "list", "--root", project], project);
  assert.equal(listed.schema_version, "workflow-definition-list:v1");
  assert.deepEqual(listed.included.map((entry) => entry.id), [
    "software-project",
    "change-request",
    "technical-assessment",
    "generic-governed-process",
  ]);

  const italianProposal = mustRun([
    "workflow", "definition", "propose",
    "--root", project,
    "--id", "team-delivery",
    "--definition-version", "1",
    "--workflow-preset", "software-project",
    "--summary", "Sei passaggi di consegna con revisioni concordate",
    "--locale", "it",
  ], project);
  const primary = primaryHumanText(italianProposal, "it");
  assert.match(primary, /^Risultato:/u);
  assert.match(primary, /Resta inattiva finché non viene confermata/u);
  assert.doesNotMatch(primary, /\b(?:schema|hash|profile|receipt|bounded-autonomous|checkpointed|audit_only)\b/iu);
  assert.doesNotMatch(primary, /\.sdlc\/|--[a-z]/u);

  const approved = mustRunJson([
    "workflow", "definition", "approve",
    "--root", project,
    "--id", "team-delivery",
    "--definition-version", "1",
    "--actor-type", "human",
    "--approval-source", "explicit-user",
    "--summary", "Approved the displayed steps, checks, and limits",
  ], project);
  assert.equal(approved.status, "approved");
  assert.equal(approved.definition.status, "approved");
  assert.equal(approved.definition.approval.approval_source, "explicit-user");

  const firstShow = mustRun([
    "workflow", "definition", "show", "--root", project,
    "--id", "team-delivery", "--definition-version", "1", "--json",
  ], project);
  const secondShow = mustRun([
    "workflow", "definition", "show", "--root", project,
    "--id", "team-delivery", "--definition-version", "1", "--json",
  ], project);
  assert.equal(firstShow, secondShow);

  const overlayProposal = mustRunJson([
    "workflow", "overlay", "propose",
    "--root", project,
    "--id", "team-labels",
    "--overlay-version", "1",
    "--definition", "team-delivery",
    "--definition-version", "1",
    "--overlay-json", JSON.stringify({
      label: "Team delivery",
      state_overrides: [{ state_id: "analysis", label: "Impact review", metadata: {} }],
      transition_overrides: [],
      metadata: { locale: "en" },
    }),
  ], project);
  assert.equal(overlayProposal.status, "proposed");
  assert.equal(overlayProposal.overlay.status, "proposed");

  const approvedOverlay = mustRunJson([
    "workflow", "overlay", "approve",
    "--root", project,
    "--id", "team-labels",
    "--overlay-version", "1",
    "--actor-type", "human",
    "--approval-source", "explicit-user",
    "--summary", "Approved the displayed labels without changing the process steps",
  ], project);
  assert.equal(approvedOverlay.overlay.status, "approved");

  const explainedOverlay = mustRunJson([
    "workflow", "overlay", "explain",
    "--root", project,
    "--id", "team-labels",
    "--overlay-version", "1",
  ], project);
  assert.equal(explainedOverlay.status, "ready");
  assert.equal(explainedOverlay.effective_definition.states.find((state) => state.id === "analysis").label, "Impact review");

  const started = mustRunJson([
    "workflow", "instance", "start",
    "--root", project,
    "--id", "delivery-42",
    "--definition", "team-delivery",
    "--definition-version", "1",
    "--overlay", "team-labels",
    "--overlay-version", "1",
  ], project);
  assert.equal(started.status, "started");
  assert.equal(started.instance.overlay_ref.id, "team-labels");
  assert.equal(fs.existsSync(path.join(project, ".sdlc", "workflows", "instances", "delivery-42", "instance.json")), true);
  assert.equal(fs.existsSync(path.join(project, ".sdlc", "workflows", "instances", "delivery-42", "events.jsonl")), true);

  const transitioned = mustRunJson([
    "workflow", "instance", "transition",
    "--root", project,
    "--id", "delivery-42",
    "--to", "analysis",
    "--request-id", "delivery-42-analysis",
  ], project);
  assert.equal(transitioned.status, "transitioned");
  assert.equal(transitioned.replay.current_state, "analysis");

  const retried = mustRunJson([
    "workflow", "instance", "transition",
    "--root", project,
    "--id", "delivery-42",
    "--to", "analysis",
    "--request-id", "delivery-42-analysis",
  ], project);
  assert.equal(retried.event.event_hash, transitioned.event.event_hash);

  const status = mustRunJson([
    "workflow", "instance", "status", "--root", project, "--id", "delivery-42",
  ], project);
  assert.equal(status.current_state, "analysis");
  assert.equal(status.event_count, 1);
  assert.deepEqual(status.next_states, ["design"]);

  const humanStatus = mustRun([
    "workflow", "instance", "status", "--root", project, "--id", "delivery-42", "--locale", "en",
  ], project);
  const englishPrimary = primaryHumanText(humanStatus, "en");
  assert.match(englishPrimary, /^Outcome:/u);
  assert.match(englishPrimary, /reconstructed from its recorded history/u);
  assert.doesNotMatch(englishPrimary, /\b(?:schema|hash|profile|receipt|bounded-autonomous|checkpointed|audit_only)\b/iu);
  assert.doesNotMatch(englishPrimary, /\.sdlc\/|--[a-z]/u);
});

test("an included preset can start a run without being copied into project storage", () => {
  const project = temporaryProject("included");
  mustRun(["init", "--root", project, "--project-name", "Included workflow"], project);

  const started = mustRunJson([
    "workflow", "instance", "start",
    "--root", project,
    "--id", "change-184",
    "--definition", "change-request",
    "--definition-version", "1",
  ], project);
  assert.equal(started.instance.definition_ref.id, "change-request");
  assert.equal(started.instance.initial_state, "intake");
  assert.equal(
    fs.existsSync(path.join(project, ".sdlc", "workflows", "definitions", "change-request", "v1.json")),
    false,
  );

  const transitioned = mustRunJson([
    "workflow", "instance", "transition",
    "--root", project,
    "--id", "change-184",
    "--to", "impact-review",
    "--request-id", "impact-review-1",
  ], project);
  assert.equal(transitioned.replay.current_state, "impact-review");

  const status = mustRunJson([
    "workflow", "instance", "status", "--root", project, "--id", "change-184",
  ], project);
  assert.equal(status.current_state, "impact-review");
});
