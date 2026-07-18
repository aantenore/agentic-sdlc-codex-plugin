import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "bin", "agentic-sdlc.mjs");

function temporaryDirectory(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `agentic-sdlc-${label}-`));
}

function run(args, { cwd = ROOT, input } = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    input,
  });
}

function mustRun(args, options) {
  const result = run(args, options);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}

function primaryText(stdout, locale = "en") {
  const marker = locale === "it"
    ? "Dettagli tecnici (facoltativi):"
    : "Technical details (optional):";
  assert.match(stdout, new RegExp(marker.replace(/[()]/gu, "\\$&"), "u"));
  return stdout.split(marker)[0];
}

function assertPrimaryHasNoTechnicalJargon(stdout, locale = "en") {
  const primary = primaryText(stdout, locale);
  assert.doesNotMatch(primary, /\b(?:bounded-autonomous|checkpointed|audit_only|host_verified)\b/iu);
  assert.doesNotMatch(primary, /\b(?:REQ|AUT|AUTH|CAP|ST)-[A-Z0-9._-]+\b/u);
  assert.doesNotMatch(primary, /\.sdlc\/|--[a-z][a-z-]*|\bagentic-sdlc\s+[a-z]/iu);
}

test("hierarchical help works outside a project and keeps technical literals secondary", () => {
  const cwd = temporaryDirectory("help");
  const result = mustRun(["help", "autonomy", "delivery", "approve", "--locale", "it"], { cwd });
  assert.match(result.stdout, /^Risultato:/u);
  assert.match(result.stdout, /Risultato:/u);
  assert.match(result.stdout, /Cosa cambia in pratica:/u);
  assert.match(result.stdout, /Cosa devi decidere:/u);
  assert.match(result.stdout, /Cosa resta protetto:/u);
  assert.match(result.stdout, /Prossimo passo:/u);
  assertPrimaryHasNoTechnicalJargon(result.stdout, "it");
  assert.match(result.stdout.split("Dettagli tecnici (facoltativi):")[1], /autonomy delivery approve/u);
  assert.equal(fs.existsSync(path.join(cwd, ".sdlc")), false);
});

test("requirement and contract help describe commands that run with the documented inputs", () => {
  const cwd = temporaryDirectory("agreement-help");
  mustRun(["init", "--project-name", "Agreement help", "--root", cwd]);

  const requirementHelp = JSON.parse(mustRun(["help", "requirement", "propose", "--json"], { cwd }).stdout);
  const requirementFlags = new Map(requirementHelp.options.map((entry) => [entry.flag, entry]));
  for (const flag of ["--id", "--title", "--acceptance", "--autonomy-ceiling"]) {
    assert.equal(requirementFlags.get(flag)?.required, true, flag);
  }
  assert.match(requirementHelp.examples[0], /--title .*--summary .*--acceptance .*--autonomy-ceiling/u);

  const proposed = JSON.parse(mustRun([
    "requirement", "propose",
    "--root", cwd,
    "--id", "REQ-BOOKING-001",
    "--title", "Reliable booking confirmation",
    "--summary", "Confirm a booking once and expose a recoverable failure",
    "--acceptance", "A successful request returns one confirmation reference",
    "--autonomy-ceiling", "checkpointed",
    "--json",
  ], { cwd }).stdout);
  assert.equal(proposed.status, "proposed");

  const approved = JSON.parse(mustRun([
    "requirement", "approve",
    "--root", cwd,
    "--id", "REQ-BOOKING-001",
    "--actor-type", "human",
    "--approval-source", "explicit-user",
    "--summary", "Approved the displayed outcome, checks, limits, and maximum delivery independence",
    "--json",
  ], { cwd }).stdout);
  assert.equal(approved.status, "approved");

  const contractHelp = JSON.parse(mustRun(["help", "contract", "create", "--json"], { cwd }).stdout);
  const contractFlags = new Set(contractHelp.options.map((entry) => entry.flag));
  assert.equal(contractFlags.has("--delivery-profile"), true);
  assert.equal(contractFlags.has("--profile"), false);
  const contract = JSON.parse(mustRun([
    "contract", "create",
    "--root", cwd,
    "--id", "CONTRACT-BOOKING-DESIGN-001",
    "--phase", "design",
    "--context-summary", "Use the agreed booking outcome and current API boundaries",
    "--validation", "Review the result against the agreed acceptance criteria",
    "--json",
  ], { cwd }).stdout);
  assert.equal(contract.contract.id, "CONTRACT-BOOKING-DESIGN-001");
  assert.equal(contract.contract.status, "draft");
});

test("capability commands use --profile while delivery selection remains separate", () => {
  const cwd = temporaryDirectory("capability-profile-option");
  mustRun(["init", "--project-name", "Capability option", "--root", cwd]);
  mustRun([
    "capability", "profile", "propose",
    "--root", cwd,
    "--id", "CAP-PROFILE-PROJECT",
    "--json",
  ], { cwd });

  const help = JSON.parse(mustRun(["help", "capability", "recommend", "--json"], { cwd }).stdout);
  const flags = new Set(help.options.map((entry) => entry.flag));
  assert.equal(flags.has("--profile"), true);
  assert.equal(flags.has("--delivery-profile"), false);

  const recommendation = JSON.parse(mustRun([
    "capability", "recommend",
    "--root", cwd,
    "--id", "CAP-REC-PROJECT",
    "--profile", "CAP-PROFILE-PROJECT",
    "--json",
  ], { cwd }).stdout);
  assert.equal(recommendation.recommendation.profile_id, "CAP-PROFILE-PROJECT");

  const wrongSelector = run([
    "capability", "recommend",
    "--root", cwd,
    "--id", "CAP-REC-WRONG",
    "--delivery-profile", "CAP-PROFILE-PROJECT",
  ], { cwd });
  assert.equal(wrongSelector.status, 1);
  assert.match(wrongSelector.stderr, /Missing required option --profile/u);
});

test("completion is deterministic, static, redirectable, and project-free", () => {
  const cwd = temporaryDirectory("completion");
  const first = mustRun(["completion", "bash"], { cwd }).stdout;
  const second = mustRun(["completion", "bash"], { cwd }).stdout;
  assert.equal(first, second);
  assert.match(first, /complete -F/u);
  assert.doesNotMatch(first, /\beval\b|\$\([^)]*\)|`[^`]*`/u);
  const syntax = spawnSync("bash", ["-n"], { encoding: "utf8", input: first });
  if (syntax.error?.code !== "ENOENT") assert.equal(syntax.status, 0, syntax.stderr);
  const probe = spawnSync("bash", ["-s"], { encoding: "utf8", input: [
    first,
    "COMP_WORDS=(agentic-sdlc autonomy delivery action '')",
    "COMP_CWORD=4",
    "_agentic_sdlc_completion",
    "printf '%s\\n' \"${COMPREPLY[@]}\"",
  ].join("\n") });
  if (probe.error?.code !== "ENOENT") {
    assert.equal(probe.status, 0, probe.stderr);
    assert.match(probe.stdout, /^--action$/mu);
    assert.match(probe.stdout, /^--outcome$/mu);
    assert.match(probe.stdout, /^--evidence$/mu);
    assert.doesNotMatch(probe.stdout, /^approve$/mu);
  }
  const rootProbe = spawnSync("bash", ["-s"], { encoding: "utf8", input: [
    first,
    "COMP_WORDS=(agentic-sdlc '')",
    "COMP_CWORD=1",
    "_agentic_sdlc_completion",
    "printf '%s\\n' \"${COMPREPLY[@]}\"",
  ].join("\n") });
  if (rootProbe.error?.code !== "ENOENT") {
    assert.equal(rootProbe.status, 0, rootProbe.stderr);
    assert.match(rootProbe.stdout, /^autonomy$/mu);
    assert.match(rootProbe.stdout, /^status$/mu);
    assert.doesNotMatch(rootProbe.stdout, /^(?:action|approve|propose)$/mu);
  }
  const envelope = JSON.parse(mustRun(["completion", "powershell", "--json"], { cwd }).stdout);
  assert.equal(envelope.shell, "powershell");
  assert.match(envelope.sha256, /^[a-f0-9]{64}$/u);
  assert.equal(fs.existsSync(path.join(cwd, ".sdlc")), false);
});

test("presentation presets compose deterministically and cannot authorize or widen work", () => {
  const cwd = temporaryDirectory("presets");
  for (const [name, options] of [
    ["authority", { authorization: "AUTH-NOT-ALLOWED" }],
    ["view", { view: "dev" }],
    ["limit", { limit: 1 }],
  ]) {
    const unsafe = path.join(cwd, `unsafe-${name}.json`);
    fs.writeFileSync(unsafe, `${JSON.stringify(options)}\n`, "utf8");
    const rejected = run(["status", "--cli-preset", `@${unsafe}`], { cwd });
    assert.equal(rejected.status, 1, name);
    assert.match(rejected.stderr, /Technical details \(optional\):/u);
    assert.match(rejected.stderr, new RegExp(`cannot set '${Object.keys(options)[0]}'`, "u"));
  }
  assert.equal(fs.existsSync(path.join(cwd, ".sdlc")), false);

  const firstExport = mustRun(["preset", "export", "human-it", "diagnostic"], { cwd }).stdout;
  const secondExport = mustRun(["preset", "export", "human-it", "diagnostic"], { cwd }).stdout;
  assert.equal(firstExport, secondExport);
  const exported = JSON.parse(firstExport);
  assert.equal(exported.schema_version, "agentic-sdlc-cli-preset-v1");
  assert.deepEqual(exported.options, { full: true, json: true, locale: "it" });

  const exportedPath = path.join(cwd, "exported.json");
  fs.writeFileSync(exportedPath, firstExport, "utf8");
  const roundTrip = mustRun(["preset", "export", `@${exportedPath}`], { cwd }).stdout;
  assert.equal(roundTrip, firstExport);
});

test("machine preset preserves status compatibility and explicit CLI options win", () => {
  const cwd = temporaryDirectory("status");
  mustRun(["init", "--project-name", "Preset status", "--root", cwd]);
  const machine = JSON.parse(mustRun(["status", "--root", cwd, "--cli-preset", "machine"]).stdout);
  assert.equal(machine.schema_version, "cli-status:v1");
  assert.ok(machine.project);
  assert.ok(machine.counts);
  assert.ok(machine.summary);
  assert.ok(machine.next_action);

  const explicitEnglish = mustRun([
    "status",
    "--root", cwd,
    "--cli-preset", "human-it",
    "--locale", "en",
  ]).stdout;
  assert.match(explicitEnglish, /^Outcome:/u);
  assert.doesNotMatch(explicitEnglish, /^Risultato:/u);
  assertPrimaryHasNoTechnicalJargon(explicitEnglish, "en");

  const activity = JSON.parse(mustRun([
    "report", "activity",
    "--root", cwd,
    "--view", "dev",
    "--json",
  ]).stdout);
  assert.equal(activity.view, "dev", "explicit --view remains a runtime option");

  const decisions = path.join(cwd, ".sdlc", "decisions");
  fs.writeFileSync(path.join(decisions, "DEC-FIRST.json"), `${JSON.stringify({ id: "DEC-FIRST", summary: "explicit-limit-probe" })}\n`, "utf8");
  fs.writeFileSync(path.join(decisions, "DEC-SECOND.json"), `${JSON.stringify({ id: "DEC-SECOND", summary: "explicit-limit-probe" })}\n`, "utf8");
  mustRun(["index", "rebuild", "--root", cwd]);
  const search = JSON.parse(mustRun([
    "kb", "search", "explicit-limit-probe",
    "--root", cwd,
    "--limit", "1",
    "--json",
  ]).stdout);
  assert.equal(search.results.length, 1, "explicit --limit still controls result count");
});

test("trace append help example uses a runtime-valid mandatory and operational flag set", () => {
  const cwd = temporaryDirectory("trace-help");
  mustRun(["init", "--project-name", "Trace help", "--root", cwd]);
  const result = JSON.parse(mustRun([
    "trace", "append",
    "--root", cwd,
    "--type", "decision",
    "--summary", "Approved the exact implementation boundary",
    "--outcome", "ready",
    "--action", "requirement.approve",
    "--related", "REQ-001",
    "--actor-type", "human",
    "--json",
  ]).stdout);
  assert.equal(result.status, "appended");
  assert.equal(result.event.type, "decision");
  assert.equal(result.event.outcome, "ready");
  assert.equal(result.event.action, "requirement.approve");
  assert.deepEqual(result.event.related, ["REQ-001"]);
  assert.equal(result.event.actor.type, "human");
});

test("machine mode returns one stable JSON error envelope", () => {
  const cwd = temporaryDirectory("json-errors");
  const cases = [
    { args: ["help", "not-a-command", "--json=true"], code: "UNKNOWN_COMMAND" },
    { args: ["preset", "show", "not-a-preset", "--json", "true"], code: "CLI_PRESET_ERROR" },
    { args: ["--version", "--locale", "fr", "--json=true"], code: "USER_ERROR" },
    { args: ["--not-a-real-option", "--json=true"], code: "USER_ERROR" },
    { args: ["--not-a-real-option", "--json", "true"], code: "USER_ERROR" },
  ];
  for (const entry of cases) {
    const result = run(entry.args, { cwd });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    const payload = JSON.parse(result.stderr);
    assert.equal(payload.schema_version, "agentic-sdlc-cli-error:v1");
    assert.equal(payload.status, "error");
    assert.equal(payload.error.code, entry.code);
    assert.equal(typeof payload.error.message, "string");
    assert.deepEqual(Object.keys(payload.human_guidance), [
      "result",
      "impact",
      "required_decision",
      "protection_boundary",
      "next_action",
      "details",
    ]);
  }
  assert.equal(fs.existsSync(path.join(cwd, ".sdlc")), false);
});
