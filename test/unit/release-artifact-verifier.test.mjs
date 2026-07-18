import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  canonicalJson,
  npmCliCandidates,
  parseStrictJson,
  verifyReleaseArtifact,
} from "../../lib/release/artifact-verifier.mjs";
import {
  buildTarGzip,
  validReleaseFixtureEntries,
} from "../helpers/release-package-fixture.mjs";


const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const policyPath = path.join(repoRoot, "config", "release-artifact-policy.json");
const packageVersion = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")).version;


function withFixture(entries, callback) {
  const root = mkdtempSync(path.join(os.tmpdir(), "release-artifact-unit-"));
  try {
    const artifactPath = path.join(root, "package.tgz");
    writeFileSync(artifactPath, buildTarGzip(entries));
    return callback(artifactPath);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}


function verify(artifactPath, overrides = {}) {
  return verifyReleaseArtifact({
    artifactPath,
    expectedTag: `v${packageVersion}`,
    policyPath,
    smoke: false,
    ...overrides,
  });
}


function expectCode(code, operation) {
  assert.throws(operation, (error) => {
    assert.equal(error.code, code);
    return true;
  });
}


function replaceEntry(entries, archivePath, replacement) {
  return entries.map((entry) => entry.path === archivePath ? { ...entry, ...replacement } : entry);
}


test("produces a deterministic content snapshot without freezing package file count", () => {
  const baseEntries = validReleaseFixtureEntries({ version: packageVersion });
  let first;
  withFixture(baseEntries, (artifactPath) => {
    first = verify(artifactPath);
    const repeated = verify(artifactPath);
    assert.equal(canonicalJson(first), canonicalJson(repeated));
    assert.equal(first.status, "passed");
    assert.match(first.artifact.sha256, /^[0-9a-f]{64}$/u);
    assert.match(first.artifact.snapshot_sha256, /^[0-9a-f]{64}$/u);
    assert.equal(first.package.version, packageVersion);
    assert.equal(first.smoke.npm_install, "not_run");
  });

  withFixture(validReleaseFixtureEntries({
    version: packageVersion,
    extra: [{ path: "package/docs/new-release-note.md", data: "new allowed file\n" }],
  }), (artifactPath) => {
    const expanded = verify(artifactPath);
    assert.equal(expanded.archive.file_count, first.archive.file_count + 1);
    assert.notEqual(expanded.artifact.snapshot_sha256, first.artifact.snapshot_sha256);
  });
});


test("enforces the top-level allowlist and required files", () => {
  withFixture(validReleaseFixtureEntries({
    version: packageVersion,
    extra: [{ path: "package/unexpected/file.txt", data: "no" }],
  }), (artifactPath) => expectCode("TOP_LEVEL_NOT_ALLOWED", () => verify(artifactPath)));

  const missingReadme = validReleaseFixtureEntries({ version: packageVersion }).filter((entry) => entry.path !== "package/README.md");
  withFixture(missingReadme, (artifactPath) => expectCode("REQUIRED_FILE_MISSING", () => verify(artifactPath)));
});


test("requires package, plugin, tag, and bin metadata to agree", () => {
  const pluginMismatch = replaceEntry(
    validReleaseFixtureEntries({ version: packageVersion }),
    "package/.codex-plugin/plugin.json",
    { data: '{"name":"agentic-sdlc-codex-plugin","version":"999.0.0"}\n' },
  );
  withFixture(pluginMismatch, (artifactPath) => expectCode("VERSION_MISMATCH", () => verify(artifactPath)));

  withFixture(validReleaseFixtureEntries({ version: packageVersion }), (artifactPath) => {
    expectCode("TAG_VERSION_MISMATCH", () => verify(artifactPath, { expectedTag: "v999.0.0" }));
  });

  const binMismatch = replaceEntry(
    validReleaseFixtureEntries({ version: packageVersion }),
    "package/package.json",
    { data: `${JSON.stringify({ name: "agentic-sdlc-codex-plugin", version: packageVersion, bin: { "agentic-sdlc": "./bin/other.mjs" } })}\n` },
  );
  withFixture(binMismatch, (artifactPath) => expectCode("BIN_CONTRACT_MISMATCH", () => verify(artifactPath)));

  const nonExecutableBin = replaceEntry(
    validReleaseFixtureEntries({ version: packageVersion }),
    "package/bin/agentic-sdlc.mjs",
    { mode: 0o644 },
  );
  withFixture(nonExecutableBin, (artifactPath) => expectCode("BIN_TARGET_NOT_EXECUTABLE", () => verify(artifactPath)));
});


test("rejects unsafe permission bits and duplicate JSON keys", () => {
  const writable = replaceEntry(validReleaseFixtureEntries({ version: packageVersion }), "package/README.md", { mode: 0o666 });
  withFixture(writable, (artifactPath) => expectCode("UNSAFE_FILE_MODE", () => verify(artifactPath)));

  const duplicate = replaceEntry(
    validReleaseFixtureEntries({ version: packageVersion }),
    "package/package.json",
    { data: `{"name":"agentic-sdlc-codex-plugin","version":${JSON.stringify(packageVersion)},"version":"999.0.0","bin":{"agentic-sdlc":"./bin/agentic-sdlc.mjs"}}\n` },
  );
  withFixture(duplicate, (artifactPath) => expectCode("DUPLICATE_JSON_KEY", () => verify(artifactPath)));
  expectCode("DUPLICATE_JSON_KEY", () => parseStrictJson(Buffer.from('{"outer":{"key":1,"key":2}}'), "fixture"));
});


test("resolves the standard setup-node npm CLI layout on Windows and POSIX", () => {
  assert.deepEqual(npmCliCandidates({
    nodeExecutable: "C:\\hostedtoolcache\\node\\24.0.0\\x64\\node.exe",
    npmExecPath: undefined,
    platform: "win32",
  }), ["C:\\hostedtoolcache\\node\\24.0.0\\x64\\node_modules\\npm\\bin\\npm-cli.js"]);
  assert.deepEqual(npmCliCandidates({
    nodeExecutable: "/opt/hostedtoolcache/node/24.0.0/x64/bin/node",
    npmExecPath: undefined,
    platform: "linux",
  }), ["/opt/hostedtoolcache/node/24.0.0/x64/lib/node_modules/npm/bin/npm-cli.js"]);
});


test("bounds attacker-controlled JSON nesting before native parsing", () => {
  const deeplyNested = `${"[".repeat(66)}0${"]".repeat(66)}`;
  expectCode("JSON_NESTING_LIMIT_EXCEEDED", () => parseStrictJson(Buffer.from(deeplyNested), "nested fixture"));
  expectCode("INVALID_JSON", () => parseStrictJson(Buffer.from('{"value":"\\q"}'), "malformed fixture"));
});
