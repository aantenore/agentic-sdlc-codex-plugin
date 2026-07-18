#!/usr/bin/env node

import path from "node:path";

import {
  ReleaseArtifactError,
  canonicalJson,
  verifyReleaseArtifact,
} from "../lib/release/artifact-verifier.mjs";


function usage() {
  return [
    "Usage:",
    "  node scripts/verify-release-package.mjs --artifact package.tgz --tag v1.2.3 [options]",
    "",
    "Options:",
    "  --policy PATH    Release policy (default: config/release-artifact-policy.json)",
    "  --npm-cli PATH   Exact npm-cli.js used for the offline install smoke test",
    "  --python PATH    Python executable used for the read-only installer plan",
    "  --json           Emit the deterministic JSON report (default output format)",
    "  --help           Show this help",
  ].join("\n");
}


function parseArguments(argv) {
  const values = new Map();
  const flags = new Set();
  const valueOptions = new Set(["artifact", "tag", "policy", "npm-cli", "python"]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) throw new ReleaseArtifactError("INVALID_ARGUMENT", `unexpected positional argument: ${argument}`);
    const [rawName, inline] = argument.slice(2).split(/=(.*)/su, 2);
    if (rawName === "help" || rawName === "json") {
      if (inline !== undefined) throw new ReleaseArtifactError("INVALID_ARGUMENT", `--${rawName} does not accept a value`);
      flags.add(rawName);
      continue;
    }
    if (!valueOptions.has(rawName)) throw new ReleaseArtifactError("INVALID_ARGUMENT", `unknown option: --${rawName}`);
    if (values.has(rawName)) throw new ReleaseArtifactError("INVALID_ARGUMENT", `option may only be provided once: --${rawName}`);
    const value = inline === undefined ? argv[++index] : inline;
    if (!value || value.startsWith("--")) throw new ReleaseArtifactError("INVALID_ARGUMENT", `--${rawName} requires a value`);
    values.set(rawName, value);
  }
  return { values, flags };
}


function main() {
  let parsed;
  try {
    parsed = parseArguments(process.argv.slice(2));
    if (parsed.flags.has("help")) {
      process.stdout.write(`${usage()}\n`);
      return 0;
    }
    if (!parsed.values.has("artifact")) throw new ReleaseArtifactError("ARTIFACT_REQUIRED", "--artifact is required");
    if (!parsed.values.has("tag")) throw new ReleaseArtifactError("EXPECTED_TAG_REQUIRED", "--tag is required");
    const policyPath = path.resolve(parsed.values.get("policy") ?? "config/release-artifact-policy.json");
    const report = verifyReleaseArtifact({
      artifactPath: path.resolve(parsed.values.get("artifact")),
      expectedTag: parsed.values.get("tag"),
      policyPath,
      npmCliPath: parsed.values.get("npm-cli") ? path.resolve(parsed.values.get("npm-cli")) : undefined,
      pythonExecutable: parsed.values.get("python"),
    });
    process.stdout.write(`${canonicalJson(report)}\n`);
    return 0;
  } catch (error) {
    const known = error instanceof ReleaseArtifactError;
    const payload = {
      schema_version: "agentic-sdlc.release-artifact-verification.v1",
      status: "error",
      error: {
        code: known ? error.code : "VERIFICATION_FAILED",
        message: known ? error.message : "release artifact verification failed unexpectedly",
      },
    };
    process.stderr.write(`${canonicalJson(payload)}\n`);
    return 1;
  }
}


process.exitCode = main();
