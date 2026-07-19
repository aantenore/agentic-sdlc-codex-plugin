import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CLI = path.join(ROOT, "bin", "agentic-sdlc.mjs");
const TEMPORARY_DIRECTORIES = new Set();

after(() => {
  for (const directory of TEMPORARY_DIRECTORIES) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function temporaryProject(label) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `agentic-sdlc-dispatch-${label}-`));
  TEMPORARY_DIRECTORIES.add(directory);
  return directory;
}

function run(args, { cwd = ROOT, env = {} } = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 30_000,
  });
}

function mustRun(args, settings = {}) {
  const result = run(args, settings);
  assert.equal(result.status, 0, `${args.join(" ")}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  return result;
}

test("runtime registry dispatches help, presets, completion, and Observatory bootstrap paths", () => {
  const help = JSON.parse(mustRun(["help", "trace", "evidence", "bind", "--json"]).stdout);
  assert.equal(help.command.path, "trace evidence bind");
  const flags = new Set(help.options.map((descriptor) => descriptor.flag));
  assert.equal(flags.has("--target-event"), true);
  assert.equal(flags.has("--redaction-policy"), true);

  const presets = JSON.parse(mustRun(["preset", "list", "--json"]).stdout);
  assert.equal(presets.schema_version, "agentic-sdlc-cli-preset-list-v1");
  const completion = JSON.parse(mustRun(["completion", "zsh", "--json"]).stdout);
  assert.equal(completion.schema_version, "agentic-sdlc-completion-v1");

  const project = temporaryProject("observe");
  const observed = mustRun([
    "observe", "--root", project, "--no-open", "--json",
  ], {
    env: { AGENTIC_SDLC_OBSERVATORY_WORKER: "1" },
  });
  assert.equal(observed.stdout, "");
  assert.equal(observed.stderr, "");
});

test("catalog options and explicit compatibility options remain accepted by the parser", () => {
  const catalog = mustRun(["help", "trace", "evidence", "bind", "--target-event", "TR-1", "--target-event", "TR-2", "--json"]);
  assert.equal(JSON.parse(catalog.stdout).command.path, "trace evidence bind");

  const compatibility = mustRun(["help", "--strict", "--allow-unapproved-contract-output", "--json"]);
  assert.equal(JSON.parse(compatibility.stdout).schema_version, "agentic-sdlc-help-v1");
  const unknown = run(["help", "--definitely-unknown"]);
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /Unknown option --definitely-unknown/u);
});

test("config recovery uses catalog mutation intent for conditional report writers", () => {
  const project = temporaryProject("config-recovery");
  mustRun(["init", "--root", project, "--project-name", "Dispatch recovery"]);
  const configPath = path.join(project, ".sdlc", "config.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  config.claim_policy.default_ttl_seconds += 1;
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const readOnly = mustRun(["report", "activity", "--root", project, "--json"]);
  assert.equal(JSON.parse(readOnly.stdout).kind, "activity_report");

  const outputPath = path.join(project, ".sdlc", "reports", "blocked.json");
  const blocked = run(["report", "activity", "--root", project, "--out", outputPath, "--json"]);
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /configuration is drifted/u);
  assert.equal(fs.existsSync(outputPath), false);

  const preview = mustRun(["config", "migrate", "--root", project, "--json"]);
  assert.equal(JSON.parse(preview.stdout).status, "planned");
});
