import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  discoverBaselineSourcePaths,
  normalizeBaselineSourcePolicy,
} from "../../lib/baseline-source-discovery.mjs";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentic-sdlc-baseline-"));
  const write = (relativePath, content = relativePath) => {
    const filePath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
    return filePath;
  };
  return { root, write };
}

test("directory discovery uses source extensions rather than KB index extensions", (t) => {
  const project = fixture();
  t.after(() => fs.rmSync(project.root, { recursive: true, force: true }));
  project.write("lib/a.mjs");
  project.write("lib/b.js");
  project.write("lib/c.ts");
  project.write("lib/d.py");
  project.write("lib/ignored.bin");

  const result = discoverBaselineSourcePaths({
    projectRoot: project.root,
    requestedPaths: ["lib"],
    policy: { source_extensions: [".mjs", ".js", ".ts", ".py"] },
  });

  assert.deepEqual(result.paths, ["lib/a.mjs", "lib/b.js", "lib/c.ts", "lib/d.py"]);
  assert.deepEqual(result.excluded, [{ path: "lib/ignored.bin", reason: "extension_not_allowed" }]);
});

test("repository discovery excludes canonical evidence, dependencies, and build output", (t) => {
  const project = fixture();
  t.after(() => fs.rmSync(project.root, { recursive: true, force: true }));
  project.write("src/index.mjs");
  project.write(".sdlc/traces/project.jsonl");
  project.write("node_modules/pkg/index.js");
  project.write("dist/bundle.js");
  project.write("coverage/result.json");

  const result = discoverBaselineSourcePaths({ projectRoot: project.root, requestedPaths: ["."] });

  assert.deepEqual(result.paths, ["src/index.mjs"]);
  assert.deepEqual(
    result.excluded.map((item) => [item.path, item.reason]),
    [
      [".sdlc/", "excluded_directory"],
      ["coverage/", "excluded_directory"],
      ["dist/", "excluded_directory"],
      ["node_modules/", "excluded_directory"],
    ],
  );
});

test("explicit files remain compatible even when their extension is not discoverable", (t) => {
  const project = fixture();
  t.after(() => fs.rmSync(project.root, { recursive: true, force: true }));
  project.write("evidence/custom.data", "evidence");

  const result = discoverBaselineSourcePaths({
    projectRoot: project.root,
    requestedPaths: ["evidence/custom.data"],
    policy: { source_extensions: [".mjs"] },
  });

  assert.deepEqual(result.paths, ["evidence/custom.data"]);
});

test("discovery is deterministic and reports bounded truncation", (t) => {
  const project = fixture();
  t.after(() => fs.rmSync(project.root, { recursive: true, force: true }));
  project.write("src/z.mjs");
  project.write("src/a.mjs");
  project.write("src/m.mjs");

  const options = {
    projectRoot: project.root,
    requestedPaths: ["src"],
    policy: { max_discovered_files: 2 },
  };
  const first = discoverBaselineSourcePaths(options);
  const second = discoverBaselineSourcePaths(options);

  assert.deepEqual(first, second);
  assert.deepEqual(first.paths, ["src/a.mjs", "src/m.mjs"]);
  assert.equal(first.truncated, true);
  assert.equal(first.discovered_count, 2);
});

test("source policy validates extensions, directory names, and limits", () => {
  assert.throws(
    () => normalizeBaselineSourcePolicy({ source_extensions: ["mjs"] }),
    /Invalid baseline source extension/u,
  );
  assert.throws(
    () => normalizeBaselineSourcePolicy({ excluded_directories: ["../outside"] }),
    /Invalid excluded baseline directory/u,
  );
  assert.throws(
    () => normalizeBaselineSourcePolicy({ max_discovered_files: 0 }),
    /must be a positive integer/u,
  );
});

test("symlinks are excluded from recursive discovery", { skip: process.platform === "win32" }, (t) => {
  const project = fixture();
  t.after(() => fs.rmSync(project.root, { recursive: true, force: true }));
  project.write("src/real.mjs");
  fs.symlinkSync(path.join(project.root, "src", "real.mjs"), path.join(project.root, "src", "alias.mjs"));

  const result = discoverBaselineSourcePaths({ projectRoot: project.root, requestedPaths: ["src"] });

  assert.deepEqual(result.paths, ["src/real.mjs"]);
  assert.deepEqual(result.excluded, [{ path: "src/alias.mjs", reason: "symlink" }]);
});
