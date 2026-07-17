import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import childProcess from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repoRoot, "bin", "agentic-sdlc.mjs");
const sourceEmail = "former@example.invalid";
const targetEmail = "current@example.test";

test("migration identity CLI is dry-run-first, rebuilds derived state, and is idempotent", (t) => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "identity-migration-cli-"));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  git(project, "init");
  git(project, "config", "user.name", "Former User");
  git(project, "config", "user.email", sourceEmail);
  run(project, "init", "--project-id", "identity-fixture", "--project-name", "Identity Fixture");

  const projectFile = path.join(project, ".sdlc", "project.json");
  const collisionFile = path.join(project, ".sdlc", "identity-collision.json");
  fs.writeFileSync(collisionFile, `${JSON.stringify({
    exact: sourceEmail,
    near_collision: `not${sourceEmail}`,
  }, null, 2)}\n`);
  const before = fs.readFileSync(projectFile, "utf8");
  const dryRun = runJson(project,
    "migration", "identity",
    "--from-email", sourceEmail,
    "--to-email", targetEmail,
    "--to-name", "Current User",
  );
  assert.equal(dryRun.status, "ready");
  assert.match(dryRun.plan_hash, /^[a-f0-9]{64}$/u);
  assert.ok(dryRun.source_occurrences_before > 0);
  assert.equal(fs.readFileSync(projectFile, "utf8"), before);

  const applied = runJson(project,
    "migration", "identity",
    "--from-email", sourceEmail,
    "--to-email", targetEmail,
    "--to-name", "Current User",
    "--apply",
    "--plan-hash", dryRun.plan_hash,
  );
  assert.equal(applied.status, "applied");
  assert.equal(containsIdentityToken(readTree(path.join(project, ".sdlc")), sourceEmail), false);
  assert.equal(JSON.parse(fs.readFileSync(projectFile, "utf8")).audit.git.user.email, targetEmail);
  assert.deepEqual(JSON.parse(fs.readFileSync(collisionFile, "utf8")), {
    exact: targetEmail,
    near_collision: `not${sourceEmail}`,
  });
  assert.equal(runJson(project, "cache", "status").valid, true);
  assert.equal(fs.existsSync(path.join(project, ".sdlc", "indexes", "kb-index.json")), true);

  const repeated = runJson(project,
    "migration", "identity",
    "--from-email", sourceEmail,
    "--to-email", targetEmail,
    "--apply",
  );
  assert.equal(repeated.status, "already_applied");
  assert.equal(repeated.changed_files.length, 0);
  assert.equal(Object.hasOwn(repeated, "_internal"), false);
  const repeatedKeys = collectKeys(repeated);
  for (const internalKey of ["_internal", "sourceEmail", "root", "sdlcRoot", "writes"]) {
    assert.equal(repeatedKeys.has(internalKey), false, `idempotent JSON leaked key ${internalKey}`);
  }
  const repeatedJson = JSON.stringify(repeated);
  for (const secret of [sourceEmail, project, "_internal", "sourceEmail", "sdlcRoot"]) {
    assert.equal(repeatedJson.includes(secret), false, `idempotent JSON leaked ${secret}`);
  }

  const recovery = runJson(
    project,
    "migration", "identity", "--recover",
    "--recovery-nonce", "0".repeat(24),
    "--plan-hash", "0".repeat(64),
  );
  assert.equal(recovery.status, "no_recovery_needed");
  assert.equal(recovery.recovered, false);
});

test("migration identity CLI requires the reviewed plan hash and rejects snapshot drift", (t) => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "identity-migration-plan-binding-"));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  git(project, "init");
  git(project, "config", "user.name", "Former User");
  git(project, "config", "user.email", sourceEmail);
  run(project, "init", "--project-id", "identity-plan-binding", "--project-name", "Identity Plan Binding");

  const preview = runJson(project,
    "migration", "identity",
    "--from-email", sourceEmail,
    "--to-email", targetEmail,
  );
  assert.equal(preview.status, "ready");
  assert.match(preview.plan_hash, /^[a-f0-9]{64}$/u);

  const missingHash = runFailure(project,
    "migration", "identity",
    "--from-email", sourceEmail,
    "--to-email", targetEmail,
    "--apply",
  );
  assert.match(missingHash, /requires --plan-hash/u);

  const latePath = path.join(project, ".sdlc", "late.json");
  fs.writeFileSync(latePath, `${JSON.stringify({ actor: { email: sourceEmail } }, null, 2)}\n`);
  const drift = runFailure(project,
    "migration", "identity",
    "--from-email", sourceEmail,
    "--to-email", targetEmail,
    "--apply",
    "--plan-hash", preview.plan_hash,
  );
  assert.match(drift, /plan changed after preview/u);
  assert.equal(JSON.parse(fs.readFileSync(latePath, "utf8")).actor.email, sourceEmail);
  assert.equal(fs.existsSync(path.join(project, ".sdlc", "migrations")), false);
});

test("identity migration lock blocks every non-recovery CLI command before project context reads", (t) => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "identity-migration-cli-lock-"));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  fs.writeFileSync(path.join(project, ".sdlc-identity-migration.lock"), "incomplete-but-present\n");

  const blocked = runFailure(project, "doctor");
  assert.match(blocked, /identity migration transaction is active or interrupted/u);
  const missingRecoveryBinding = runFailure(project, "migration", "identity", "--recover");
  assert.match(missingRecoveryBinding, /requires both --recovery-nonce and --plan-hash/u);
});

function run(project, ...args) {
  return childProcess.execFileSync(process.execPath, [cli, ...args, "--root", project], {
    cwd: project,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runJson(project, ...args) {
  return JSON.parse(run(project, ...args, "--json"));
}

function runFailure(project, ...args) {
  try {
    run(project, ...args);
  } catch (error) {
    return `${error.message}\n${error.stderr || ""}`;
  }
  assert.fail("Expected the CLI command to fail.");
}

function git(project, ...args) {
  childProcess.execFileSync("git", args, { cwd: project, stdio: "ignore" });
}

function readTree(root) {
  const values = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(filePath);
      else values.push(fs.readFileSync(filePath, "utf8"));
    }
  };
  visit(root);
  return values.join("\n");
}

function containsIdentityToken(value, identity) {
  const emailTokenCharacter = "A-Z0-9.!#$%&'*+/=?^_`{|}~@-";
  const escaped = identity.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(?<![${emailTokenCharacter}])${escaped}(?![${emailTokenCharacter}])`, "iu").test(value);
}

function collectKeys(value, keys = new Set()) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectKeys(item, keys));
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      keys.add(key);
      collectKeys(item, keys);
    }
  }
  return keys;
}
