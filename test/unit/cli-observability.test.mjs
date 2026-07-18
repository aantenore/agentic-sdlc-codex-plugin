import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cliPath = path.join(repoRoot, "bin", "agentic-sdlc.mjs");
const tempProjects = new Set();
const CORRELATION_ID_PATTERN = /^corr-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;

after(() => {
  if (process.env.AGENTIC_SDLC_KEEP_TEST_TMP === "1") return;
  for (const project of tempProjects) {
    fs.rmSync(project, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
  tempProjects.clear();
});

function runCli(args, options = {}) {
  const env = { ...process.env };
  for (const key of [
    "CI",
    "GITHUB_ACTIONS",
    "GITHUB_ACTOR",
    "CODEX_AGENT_NAME",
    "CODEX_USER_ID",
    "NODE_OPTIONS",
  ]) {
    delete env[key];
  }
  Object.assign(env, options.env || {});
  return spawnSync(process.execPath, [...(options.nodeArgs || []), cliPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env,
    timeout: options.timeout || 30_000,
    maxBuffer: 10 * 1024 * 1024,
  });
}

function mustRun(args, options = {}) {
  const result = runCli(args, options);
  assert.equal(result.error, undefined, `${args.join(" ")} failed to execute: ${result.error?.message}`);
  assert.equal(result.signal, null, `${args.join(" ")} terminated by ${result.signal}`);
  assert.equal(result.status, 0, `${args.join(" ")}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  return result;
}

function mustFail(args, options = {}) {
  const result = runCli(args, options);
  assert.equal(result.error, undefined, `${args.join(" ")} failed to execute: ${result.error?.message}`);
  assert.equal(result.signal, null, `${args.join(" ")} terminated by ${result.signal}`);
  assert.notEqual(result.status, 0, `${args.join(" ")} unexpectedly passed\n${result.stdout}`);
  return result;
}

function initializedProject(name) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), `agentic-sdlc-observability-${name}-`));
  tempProjects.add(project);
  mustRun(["init", "--root", project, "--project-name", "Observability fixture", "--force", "--json"]);
  return project;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readOnlyJsonLine(filePath) {
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/u).filter(Boolean);
  assert.equal(lines.length, 1, `expected one JSONL event in ${filePath}`);
  return JSON.parse(lines[0]);
}

test("unexpected CLI failures return safe correlated JSON and human errors", () => {
  const project = initializedProject("safe-errors");
  const configPath = path.join(project, ".sdlc", "config.json");
  const hookPath = path.join(project, "inject-unexpected-error.mjs");
  const privateCanaryPath = "/private/internal/canary/should-never-leak";
  fs.writeFileSync(hookPath, [
    'import fs from "node:fs";',
    "const originalExistsSync = fs.existsSync;",
    "fs.existsSync = function injectedExistsSync(filePath) {",
    "  if (String(filePath) === process.env.OBS_THROW_PATH) {",
    "    throw new Error(`INTERNAL_CANARY ${process.env.OBS_CANARY_PATH}`);",
    "  }",
    "  return originalExistsSync.call(this, filePath);",
    "};",
    "",
  ].join("\n"));
  const injectedOptions = {
    nodeArgs: ["--import", pathToFileURL(hookPath).href],
    env: {
      OBS_THROW_PATH: configPath,
      OBS_CANARY_PATH: privateCanaryPath,
    },
  };

  const jsonFailure = mustFail(["status", "--root", project, "--json"], injectedOptions);
  assert.equal(jsonFailure.stdout, "");
  const payload = JSON.parse(jsonFailure.stderr);
  assert.equal(payload.schema_version, "agentic-sdlc-cli-error:v1");
  assert.equal(payload.status, "error");
  assert.match(payload.correlation_id, CORRELATION_ID_PATTERN);
  assert.deepEqual(payload.error, {
    code: "INTERNAL_ERROR",
    message: "The command could not be completed.",
    retryable: false,
  });
  assert.doesNotMatch(jsonFailure.stderr, /INTERNAL_CANARY/u);
  assert.doesNotMatch(jsonFailure.stderr, new RegExp(escapeRegExp(privateCanaryPath), "u"));
  assert.doesNotMatch(jsonFailure.stderr, new RegExp(escapeRegExp(project), "u"));
  assert.doesNotMatch(jsonFailure.stderr, new RegExp(escapeRegExp(repoRoot), "u"));
  assert.doesNotMatch(jsonFailure.stderr, /\n\s*at\s/u);

  const humanFailure = mustFail(["status", "--root", project], injectedOptions);
  assert.equal(humanFailure.stdout, "");
  assert.match(humanFailure.stderr, /Correlation ID: corr-[a-f0-9-]{36}/u);
  assert.match(humanFailure.stderr, /Error: The command could not be completed\./u);
  assert.doesNotMatch(humanFailure.stderr, /INTERNAL_CANARY/u);
  assert.doesNotMatch(humanFailure.stderr, new RegExp(escapeRegExp(privateCanaryPath), "u"));
  assert.doesNotMatch(humanFailure.stderr, new RegExp(escapeRegExp(project), "u"));
  assert.doesNotMatch(humanFailure.stderr, new RegExp(escapeRegExp(repoRoot), "u"));
  assert.doesNotMatch(humanFailure.stderr, /\n\s*at\s/u);
});

test("trace append seals a redacted event without treating governed identifiers as secrets", () => {
  const project = initializedProject("trace-redaction");
  const fakeSecret = `github_pat_${"A".repeat(32)}`;
  const opaqueHighEntropyCandidate = "aB3dE5gH7jK9mN2pQ4sT6vW8xY0zC1fG";
  const authorizationActionId = "AUT-ACT-20260718123456789-abcdef";
  const sha256 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const uuid = "550e8400-e29b-41d4-a716-446655440000";
  const suppliedCorrelationId = `corr-${uuid}`;
  const summary = [
    `credential=${fakeSecret}`,
    `opaque=${opaqueHighEntropyCandidate}`,
    `receipt=${authorizationActionId}`,
    `digest=${sha256}`,
    `uuid=${uuid}`,
    `correlation=${suppliedCorrelationId}`,
  ].join(" ");

  const result = mustRun([
    "trace", "append",
    "--root", project,
    "--type", "decision",
    "--summary", summary,
    "--json",
  ]);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, "appended");
  assert.match(payload.correlation_id, CORRELATION_ID_PATTERN);
  assert.equal(payload.event.correlation_id, payload.correlation_id);
  assert.equal(payload.event.summary.includes(fakeSecret), false);
  assert.equal(payload.event.summary.includes(opaqueHighEntropyCandidate), false);
  assert.match(payload.event.summary, /credential=\[REDACTED\]/u);
  assert.match(payload.event.summary, /opaque=\[REDACTED\]/u);
  for (const identifier of [authorizationActionId, sha256, uuid, suppliedCorrelationId]) {
    assert.match(payload.event.summary, new RegExp(escapeRegExp(identifier), "u"));
  }
  assert.equal(payload.event._trace_integrity.schema_version, "trace-integrity-event:v1");
  assert.equal(payload.event._trace_integrity.authenticity_claimed, false);
  assert.equal(payload.event._trace_integrity.sequence, 1);

  const tracePath = path.join(project, ".sdlc", "traces", "project.jsonl");
  const checkpointPath = path.join(project, ".sdlc", "traces", ".integrity", "project.jsonl.checkpoint.json");
  assert.equal(fs.existsSync(tracePath), true);
  assert.equal(fs.existsSync(checkpointPath), true);
  const rawTrace = fs.readFileSync(tracePath, "utf8");
  assert.equal(rawTrace.includes(fakeSecret), false);
  assert.equal(rawTrace.includes(opaqueHighEntropyCandidate), false);
  for (const identifier of [authorizationActionId, sha256, uuid, suppliedCorrelationId]) {
    assert.equal(rawTrace.includes(identifier), true, `${identifier} was incorrectly redacted`);
  }
  assert.deepEqual(readOnlyJsonLine(tracePath), payload.event);
  const checkpoint = readJson(checkpointPath);
  assert.equal(checkpoint.schema_version, "trace-integrity-checkpoint:v1");
  assert.equal(checkpoint.authenticity_claimed, false);
  assert.equal(checkpoint.new_writes.count, 1);
  assert.equal(checkpoint.new_writes.last_event_hash, payload.event._trace_integrity.event_hash);
});

test("strict gate reports a sealed trace that was edited after append", () => {
  const project = initializedProject("trace-tamper");
  mustRun([
    "trace", "append",
    "--root", project,
    "--type", "decision",
    "--summary", "sealed-value",
    "--json",
  ]);
  const tracePath = path.join(project, ".sdlc", "traces", "project.jsonl");
  const event = readOnlyJsonLine(tracePath);
  event.summary = "tamper-value";
  fs.writeFileSync(tracePath, `${JSON.stringify(event)}\n`);

  const result = mustFail(["gate", "check", "--root", project, "--strict", "--json"]);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "failed");
  assert.equal(
    report.errors.some((error) => /trace traces\/project\.jsonl integrity (?:event_hash|rolling_hash)_mismatch at /u.test(error)),
    true,
    report.errors.join("\n"),
  );
});

test("strict gate reports current-content evidence drift without storing original evidence", () => {
  const project = initializedProject("evidence-drift");
  const evidenceRelativePath = "evidence/current.txt";
  const evidencePath = path.join(project, evidenceRelativePath);
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, "verified evidence before change\n");

  const appendResult = mustRun([
    "trace", "append",
    "--root", project,
    "--type", "test",
    "--summary", "Hermetic validation passed",
    "--outcome", "passed",
    "--evidence", evidenceRelativePath,
    "--json",
  ]);
  const appendPayload = JSON.parse(appendResult.stdout);
  assert.deepEqual(appendPayload.event.evidence, [evidenceRelativePath]);
  assert.equal(appendPayload.event.evidence_refs.length, 1);
  assert.equal(appendPayload.event.evidence_refs[0].path, evidenceRelativePath);
  assert.equal(appendPayload.event.evidence_refs[0].verification, "current_content");
  assert.equal(appendPayload.event.evidence_refs[0].representation, "redacted_utf8_v1");
  assert.match(appendPayload.event.evidence_refs[0].sha256, /^[a-f0-9]{64}$/u);
  assert.equal(JSON.stringify(appendPayload.event).includes("verified evidence before change"), false);

  fs.writeFileSync(evidencePath, "different evidence after change\n");
  const result = mustFail(["gate", "check", "--root", project, "--strict", "--json"]);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "failed");
  assert.equal(
    report.errors.some((error) => error.includes(`evidence content drift detected for ${evidenceRelativePath}`)),
    true,
    report.errors.join("\n"),
  );
});

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
