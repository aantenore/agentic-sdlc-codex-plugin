import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cli = path.join(repoRoot, "bin", "agentic-sdlc.mjs");

test("an uninitialized repository is guided to onboarding, not destructive-looking init", (context) => {
  const root = temporaryRoot(context, "existing");
  fs.writeFileSync(path.join(root, "README.md"), "# Existing project\n");

  const result = runStatus(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /already contains project files/u);
  assert.match(result.stderr, /onboard existing-project/u);
  assert.match(result.stderr, /reviewable baseline/u);
});

test("an empty project is guided to init", (context) => {
  const root = temporaryRoot(context, "empty");

  const result = runStatus(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /new empty project/u);
  assert.match(result.stderr, /agentic-sdlc init/u);
  assert.doesNotMatch(result.stderr, /onboard existing-project/u);
});

function temporaryRoot(context, suffix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `sdlc-initial-guidance-${suffix}-`));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function runStatus(root) {
  return spawnSync(process.execPath, [
    cli,
    "status",
    "--root", root,
    "--json",
  ], {
    cwd: root,
    encoding: "utf8",
    timeout: 30_000,
  });
}
