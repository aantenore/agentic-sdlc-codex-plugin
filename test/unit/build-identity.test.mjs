import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  BuildIdentityError,
  computeBuildFingerprint,
  detectGitIdentity,
  discoverDistributedFiles,
  inspectBuildIdentity,
} from "../../lib/build-identity.mjs";

test("fingerprint is deterministic across roots and ignores metadata, dependencies, and runtime state", (context) => {
  const first = fixture(context, "first");
  const second = fixture(context, "second");
  const initial = computeBuildFingerprint(first);

  fs.utimesSync(path.join(first, "lib", "feature.mjs"), new Date(1_000), new Date(2_000));
  fs.writeFileSync(path.join(first, ".git", "HEAD"), "ref: refs/heads/other\n");
  fs.writeFileSync(path.join(first, "node_modules", "dependency.js"), "changed\n");
  fs.writeFileSync(path.join(first, ".sdlc", "runtime.json"), '{"changed":true}\n');

  assert.equal(computeBuildFingerprint(first), initial);
  assert.equal(computeBuildFingerprint(second), initial);
  assert.match(initial, /^[0-9a-f]{64}$/u);
});

test("fingerprint changes for distributed content or its relative path", (context) => {
  const root = fixture(context, "content-change");
  const initial = computeBuildFingerprint(root);

  fs.writeFileSync(path.join(root, "lib", "feature.mjs"), "export const feature = 2;\n");
  const contentChanged = computeBuildFingerprint(root);
  assert.notEqual(contentChanged, initial);

  fs.renameSync(
    path.join(root, "lib", "feature.mjs"),
    path.join(root, "lib", "renamed.mjs"),
  );
  assert.notEqual(computeBuildFingerprint(root), contentChanged);
});

test("distribution discovery honors files, mandatory package entry points, and npm metadata files", (context) => {
  const root = fixture(context, "discovery", {
    files: ["lib/", "assets/*.json"],
    main: "entry.mjs",
    bin: { demo: "bin/demo.mjs" },
  });
  write(root, "entry.mjs", "export {};\n");
  write(root, "bin/demo.mjs", "#!/usr/bin/env node\n");
  write(root, "assets/included.json", "{}\n");
  write(root, "assets/ignored.txt", "ignored\n");

  assert.deepEqual(
    discoverDistributedFiles(root).map((file) => file.relative_path),
    [
      "LICENSE",
      "README.md",
      "assets/included.json",
      "bin/demo.mjs",
      "entry.mjs",
      "lib/feature.mjs",
      "package.json",
    ],
  );
});

test("build identity works outside Git and omits Git-only fields", (context) => {
  const root = fixture(context, "unpacked");
  const identity = inspectBuildIdentity(root, {
    commandRunner: () => ({ status: 128, stdout: "", stderr: "not a repository" }),
  });

  assert.deepEqual(Object.keys(identity), ["package_version", "build_fingerprint"]);
  assert.equal(identity.package_version, "1.2.3");
  assert.match(identity.build_fingerprint, /^[0-9a-f]{64}$/u);
});

test("Git identity reports commit and dirty state only for the exact checkout root", (context) => {
  const root = fixture(context, "git");
  const commit = crypto.randomBytes(20).toString("hex");
  const cleanRunner = gitRunner(root, commit, "");
  const dirtyRunner = gitRunner(root, commit, " M lib/feature.mjs\n");

  assert.deepEqual(detectGitIdentity(root, { commandRunner: cleanRunner }), {
    commit,
    dirty: false,
  });
  assert.deepEqual(detectGitIdentity(root, { commandRunner: dirtyRunner }), {
    commit,
    dirty: true,
  });
  assert.deepEqual(
    detectGitIdentity(path.join(root, "lib"), { commandRunner: cleanRunner }),
    {},
  );
});

test("invalid package metadata and escaping distribution paths fail explicitly", (context) => {
  const root = fixture(context, "invalid");
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ files: ["lib/"] }));
  assert.throws(
    () => inspectBuildIdentity(root),
    (error) => error instanceof BuildIdentityError
      && error.code === "BUILD_IDENTITY_VERSION_MISSING",
  );

  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ version: "1.2.3", files: ["../outside"] }),
  );
  assert.throws(
    () => computeBuildFingerprint(root),
    (error) => error instanceof BuildIdentityError
      && error.code === "BUILD_IDENTITY_PATH_OUTSIDE_ROOT",
  );
});

function fixture(context, name, packageOverrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `build-identity-${name}-`));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, "package.json", `${JSON.stringify({
    name: "fixture-plugin",
    version: "1.2.3",
    files: ["lib/"],
    ...packageOverrides,
  }, null, 2)}\n`);
  write(root, "lib/feature.mjs", "export const feature = 1;\n");
  write(root, "README.md", "# Fixture\n");
  write(root, "LICENSE", "MIT\n");
  write(root, ".git/HEAD", "ref: refs/heads/main\n");
  write(root, "node_modules/dependency.js", "dependency\n");
  write(root, ".sdlc/runtime.json", '{"state":"local"}\n');
  return root;
}

function write(root, relativePath, content) {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function gitRunner(checkoutRoot, commit, status) {
  return (_command, argumentsList) => {
    const command = argumentsList.slice(2);
    if (command[0] === "rev-parse" && command[1] === "--show-toplevel") {
      return { status: 0, stdout: `${checkoutRoot}\n` };
    }
    if (command[0] === "rev-parse" && command[1] === "--verify") {
      return { status: 0, stdout: `${commit}\n` };
    }
    if (command[0] === "status") return { status: 0, stdout: status };
    return { status: 1, stdout: "" };
  };
}
