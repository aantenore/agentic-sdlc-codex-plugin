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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
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
  for (const flag of [
    "--id",
    "--to",
    "--request-id",
    "--guard-input-json",
    "--actor-type",
    "--actor-name",
    "--actor-email",
    "--locale",
    "--json",
  ]) {
    assert.equal(transition.includes(flag), true, flag);
  }

  const approvalFlags = new Set(listOptions("workflow definition approve").map((entry) => entry.flag));
  for (const flag of ["--id", "--definition-version", "--actor-type", "--approval-source", "--authorization", "--summary"]) {
    assert.equal(approvalFlags.has(flag), true, flag);
  }
  const startStory = listOptions("workflow instance start").find((entry) => entry.flag === "--story");
  assert.ok(startStory);
  assert.match(startStory.required_when?.en || "", /canonical lifecycle checks/u);
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
  const softwareProject = listed.included.find((entry) => entry.id === "software-project");
  assert.equal(softwareProject.version, "3");
  assert.deepEqual(softwareProject.available_versions, ["1", "2", "3"]);
  assert.match(softwareProject.description, /governed workflow preset/u);
  assert.deepEqual(softwareProject.journey, [
    "discovery", "analysis", "design", "implementation", "validation", "release",
  ]);
  assert.deepEqual(softwareProject.governance_controls, [
    "requirement-approved",
    "contract-approved",
    "required-output-linked",
    "strict-gate-passed",
  ]);

  const italianProposal = mustRun([
    "workflow", "definition", "propose",
    "--root", project,
    "--id", "team-delivery",
    "--definition-version", "2",
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
    "--definition-version", "2",
    "--actor-type", "human",
    "--approval-source", "explicit-user",
    "--summary", "Approved the displayed steps, checks, and limits",
  ], project);
  assert.equal(approved.status, "approved");
  assert.equal(approved.definition.status, "approved");
  assert.equal(approved.definition.approval.approval_source, "explicit-user");

  const firstShow = mustRun([
    "workflow", "definition", "show", "--root", project,
    "--id", "team-delivery", "--definition-version", "2", "--json",
  ], project);
  const secondShow = mustRun([
    "workflow", "definition", "show", "--root", project,
    "--id", "team-delivery", "--definition-version", "2", "--json",
  ], project);
  const { correlation_id: firstCorrelationId, ...firstStableShow } = JSON.parse(firstShow);
  const { correlation_id: secondCorrelationId, ...secondStableShow } = JSON.parse(secondShow);
  assert.match(firstCorrelationId, /^corr-/u);
  assert.match(secondCorrelationId, /^corr-/u);
  assert.notEqual(firstCorrelationId, secondCorrelationId);
  assert.deepEqual(firstStableShow, secondStableShow);

  const overlayProposal = mustRunJson([
    "workflow", "overlay", "propose",
    "--root", project,
    "--id", "team-labels",
    "--overlay-version", "1",
    "--definition", "team-delivery",
    "--definition-version", "2",
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

  mustRunJson([
    "requirement", "propose",
    "--root", project,
    "--id", "REQ-WORKFLOW-42",
    "--title", "Govern the workflow test delivery",
    "--summary", "Keep the test delivery bound to one approved requirement.",
    "--acceptance", "The first workflow phase can advance from canonical requirement evidence.",
    "--non-goal", "Do not perform a remote delivery.",
    "--autonomy-ceiling", "supervised",
  ], project);
  mustRunJson([
    "requirement", "approve",
    "--root", project,
    "--id", "REQ-WORKFLOW-42",
    "--actor-type", "ci",
    "--actor-name", "Workflow test",
    "--approval-source", "ci",
    "--summary", "Approved the exact workflow test requirement.",
  ], project);
  mustRunJson([
    "story", "create",
    "--root", project,
    "--id", "ST-WORKFLOW-42",
    "--title", "Exercise canonical workflow transitions",
    "--requirement", "REQ-WORKFLOW-42",
    "--acceptance", "Canonical requirement evidence unlocks analysis.",
  ], project);

  const unboundStart = run([
    "workflow", "instance", "start",
    "--root", project,
    "--id", "unbound-delivery-42",
    "--definition", "team-delivery",
    "--definition-version", "2",
    "--overlay", "team-labels",
    "--overlay-version", "1",
    "--json",
  ], project);
  assert.notEqual(unboundStart.status, 0);
  assert.match(unboundStart.stderr, /--story/u);

  const started = mustRunJson([
    "workflow", "instance", "start",
    "--root", project,
    "--id", "delivery-42",
    "--definition", "team-delivery",
    "--definition-version", "2",
    "--overlay", "team-labels",
    "--overlay-version", "1",
    "--story", "ST-WORKFLOW-42",
    "--actor", "workflow-test-ci",
    "--actor-type", "ci",
    "--actor-name", "Workflow test CI",
  ], project);
  assert.equal(started.status, "started");
  assert.equal(started.instance.overlay_ref.id, "team-labels");
  assert.deepEqual(started.instance.actor, {
    id: "workflow-test-ci",
    type: "ci",
    name: "Workflow test CI",
  });
  assert.equal(started.instance.metadata.governance_binding.story_id, "ST-WORKFLOW-42");
  assert.equal(
    started.instance.metadata.governance_binding.strict_gate_receipt_path,
    ".sdlc/gates/ST-WORKFLOW-42-strict.json",
  );
  assert.equal(
    started.instance.metadata.governance_binding.final_gate_receipt_path,
    ".sdlc/gates/ST-WORKFLOW-42-final.json",
  );
  assert.equal(fs.existsSync(path.join(project, ".sdlc", "workflows", "instances", "delivery-42", "instance.json")), true);
  assert.equal(fs.existsSync(path.join(project, ".sdlc", "workflows", "instances", "delivery-42", "events.jsonl")), true);

  const transitioned = mustRunJson([
    "workflow", "instance", "transition",
    "--root", project,
    "--id", "delivery-42",
    "--to", "analysis",
    "--request-id", "delivery-42-analysis",
    "--actor", "workflow-test-ci",
    "--actor-type", "ci",
    "--actor-name", "Workflow test CI",
    "--guard-input-json", JSON.stringify({
      requirement_approved: false,
      canonical_evidence: { requirement_approved: false },
    }),
  ], project);
  assert.equal(transitioned.status, "transitioned");
  assert.equal(transitioned.replay.current_state, "analysis");
  assert.equal(transitioned.event.guard_results[0].guard_id, "requirement-approved");
  assert.equal(transitioned.event.guard_results[0].allowed, true);
  assert.deepEqual(transitioned.event.actor, {
    id: "workflow-test-ci",
    type: "ci",
    name: "Workflow test CI",
  });
  assert.equal(
    transitioned.event.canonical_evidence.checks.requirement_approved.satisfied,
    true,
  );
  assert.equal(
    transitioned.event.canonical_evidence.schema_version,
    "workflow-canonical-evidence:v1",
  );
  assert.equal(
    Object.hasOwn(transitioned.event.canonical_evidence, "workflow_scope"),
    false,
  );

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
  assert.deepEqual(status.ready_next_states, ["design"]);
  assert.deepEqual(status.next_transition_checks, [{
    transition_id: "analysis-to-design",
    to: "design",
    canonical: false,
    allowed: true,
    guard_results: [],
  }]);

  const humanStatus = mustRun([
    "workflow", "instance", "status", "--root", project, "--id", "delivery-42", "--locale", "en",
  ], project);
  const englishPrimary = primaryHumanText(humanStatus, "en");
  assert.match(englishPrimary, /^Outcome:/u);
  assert.match(englishPrimary, /reconstructed from its recorded history/u);
  assert.doesNotMatch(englishPrimary, /\b(?:schema|hash|profile|receipt|bounded-autonomous|checkpointed|audit_only)\b/iu);
  assert.doesNotMatch(englishPrimary, /\.sdlc\/|--[a-z]/u);

  mustRunJson([
    "workflow", "instance", "transition",
    "--root", project,
    "--id", "delivery-42",
    "--to", "design",
    "--request-id", "delivery-42-design",
  ], project);
  const callerBypass = run([
    "workflow", "instance", "transition",
    "--root", project,
    "--id", "delivery-42",
    "--to", "implementation",
    "--request-id", "delivery-42-implementation-bypass",
    "--guard-input-json", JSON.stringify({
      contract_approved: true,
      canonical_evidence: { contract_approved: true },
    }),
    "--json",
  ], project);
  assert.notEqual(callerBypass.status, 0);
  assert.match(callerBypass.stderr, /canonical project records|guards denied/u);
  assert.match(callerBypass.stderr, /contract-approved:/u);
  const afterBypass = mustRunJson([
    "workflow", "instance", "status", "--root", project, "--id", "delivery-42",
  ], project);
  assert.equal(afterBypass.current_state, "design");
  assert.equal(afterBypass.event_count, 2);
  assert.deepEqual(afterBypass.ready_next_states, []);
  assert.equal(afterBypass.next_transition_checks.length, 1);
  assert.equal(afterBypass.next_transition_checks[0].to, "implementation");
  assert.equal(afterBypass.next_transition_checks[0].canonical, true);
  assert.equal(afterBypass.next_transition_checks[0].allowed, false);
  assert.equal(afterBypass.next_transition_checks[0].guard_results[0].guard_id, "contract-approved");
  assert.equal(afterBypass.next_transition_checks[0].guard_results[0].allowed, false);

  const failedFinalGate = run([
    "gate", "check",
    "--root", project,
    "--strict",
    "--story", "ST-WORKFLOW-42",
    "--lifecycle-complete",
    "--json",
  ], project);
  assert.notEqual(failedFinalGate.status, 0);
  assert.equal(
    fs.existsSync(path.join(project, ".sdlc", "gates", "ST-WORKFLOW-42-final.json")),
    false,
  );
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

test("a story-bound workflow must pin the exact configured custom phase order", () => {
  const project = temporaryProject("custom-phases");
  mustRun(["init", "--root", project, "--project-name", "Custom phases"], project);
  const configPath = path.join(project, ".sdlc", "config.json");
  const config = readJson(configPath);
  const customPhase = "dependency-audit";
  config.phases[customPhase] = {
    ...config.phases.design,
    purpose: "Review cross-package dependencies before implementation.",
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
  writeJson(configPath, config);
  pinProjectConfig(project);

  mustRunJson([
    "story", "create",
    "--root", project,
    "--id", "ST-CUSTOM-PHASE",
    "--title", "Exercise a custom workflow phase",
    "--acceptance", "The configured workflow order is enforced.",
  ], project);

  const base = mustRunJson([
    "workflow", "definition", "show",
    "--root", project,
    "--id", "software-project",
    "--definition-version", "3",
  ], project).definition;
  const transitions = base.transitions.flatMap((transition) => {
    if (transition.from !== "design" || transition.to !== "implementation") return [transition];
    return [
      {
        ...transition,
        id: "design-to-custom-phase",
        to: customPhase,
        label: "Design to custom phase",
        guards: [],
      },
      {
        ...transition,
        id: "custom-phase-to-implementation",
        from: customPhase,
        label: "Custom phase to implementation",
      },
    ];
  });
  const customDefinition = {
    label: "Software project with dependency audit",
    description: "The configured project lifecycle with one custom phase.",
    initial_state: base.initial_state,
    states: [
      ...base.states.filter((state) => state.id !== "implementation"),
      {
        id: customPhase,
        label: "Dependency audit",
        terminal: false,
        metadata: { order: 4 },
      },
      ...base.states
        .filter((state) => state.id === "implementation")
        .map((state) => ({ ...state, metadata: { ...state.metadata, order: 5 } })),
    ].sort((left, right) => config.phase_order.indexOf(left.id) - config.phase_order.indexOf(right.id)),
    transitions,
    phase_order: config.phase_order,
    normal_checkpoints: base.normal_checkpoints,
    metadata: {
      governance_binding: "story",
      canonical_evidence_schema: "workflow-canonical-evidence:v2",
    },
  };
  mustRunJson([
    "workflow", "definition", "propose",
    "--root", project,
    "--id", "custom-software-project",
    "--definition-version", "1",
    "--definition-json", JSON.stringify(customDefinition),
  ], project);
  mustRunJson([
    "workflow", "definition", "approve",
    "--root", project,
    "--id", "custom-software-project",
    "--definition-version", "1",
    "--actor-type", "ci",
    "--approval-source", "ci",
    "--summary", "Approve the exact configured custom lifecycle.",
  ], project);

  const started = mustRunJson([
    "workflow", "instance", "start",
    "--root", project,
    "--id", "WF-CUSTOM-PHASE",
    "--definition", "custom-software-project",
    "--definition-version", "1",
    "--story", "ST-CUSTOM-PHASE",
  ], project);
  assert.deepEqual(started.instance.phase_order, undefined);
  const definition = readJson(path.join(
    project,
    ".sdlc",
    "workflows",
    "definitions",
    "custom-software-project",
    "v1.json",
  ));
  assert.deepEqual(definition.phase_order, config.phase_order);

  const mismatched = run([
    "workflow", "instance", "start",
    "--root", project,
    "--id", "WF-MISSING-CUSTOM-PHASE",
    "--definition", "software-project",
    "--definition-version", "3",
    "--story", "ST-CUSTOM-PHASE",
    "--json",
  ], project);
  assert.notEqual(mismatched.status, 0);
  assert.match(mismatched.stderr, /configured phase order|dependency-audit/u);
  assert.equal(
    fs.existsSync(path.join(project, ".sdlc", "workflows", "instances", "WF-MISSING-CUSTOM-PHASE")),
    false,
  );
});
