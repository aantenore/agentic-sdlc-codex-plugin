import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateAgainstSchema } from "../../lib/json-schema-validator.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SCHEMA_DIR = path.join(ROOT, "schemas");

function manifest(location = {
  kind: "project_path",
  path: ".sdlc/stories/ST-001/evidence/cyclonedx.json",
}) {
  return {
    kind: "trace_evidence_manifest",
    schema_version: "trace-evidence-manifest:v1",
    version: 1,
    id: "EVIDENCE-MANIFEST-001",
    artifact: {
      location,
      media_type: "application/vnd.cyclonedx+json",
      size_bytes: 32 * 1024 * 1024,
      digest: {
        algorithm: "sha256",
        value: "a".repeat(64),
        source: "producer_supplied",
        verified_by_agentic_sdlc: false,
      },
    },
    content_handling: {
      mode: "manifest_only",
      manifest_redaction_required: true,
      raw_content_read_by_agentic_sdlc: false,
      raw_content_hashed_by_agentic_sdlc: false,
    },
    created_at: "2026-07-18T12:00:00.000Z",
  };
}

function validate(value) {
  return validateAgainstSchema(value, "trace-evidence-manifest", {
    schemaDir: SCHEMA_DIR,
  });
}

test("accepts bounded local and external references without claiming raw-content verification", () => {
  const local = manifest();
  const external = manifest({
    kind: "external_uri",
    uri: "https://artifacts.example.test/releases/ST-001/cyclonedx.json",
  });
  external.artifact.digest.source = "independent_verifier_supplied";

  for (const candidate of [local, external]) {
    const result = validate(candidate);
    assert.equal(result.valid, true, JSON.stringify(result.errors));
    assert.equal(candidate.content_handling.raw_content_read_by_agentic_sdlc, false);
    assert.equal(candidate.content_handling.raw_content_hashed_by_agentic_sdlc, false);
    assert.equal(candidate.artifact.digest.verified_by_agentic_sdlc, false);
    assert.ok(Buffer.byteLength(JSON.stringify(candidate), "utf8") < 16 * 1024);
  }
});

test("rejects unsafe locations, raw-content claims, excerpts, and malformed producer digests", () => {
  const unsafePath = manifest({ kind: "project_path", path: "../../private/sbom.json" });
  const credentialedUri = manifest({
    kind: "external_uri",
    uri: "https://token@example.test/sbom.json?signature=secret",
  });
  const rawHashClaim = manifest();
  rawHashClaim.content_handling.raw_content_hashed_by_agentic_sdlc = true;
  const embeddedExcerpt = manifest();
  embeddedExcerpt.artifact.excerpt = "raw report content must never be copied here";
  const malformedDigest = manifest();
  malformedDigest.artifact.digest.value = "not-a-sha256";

  for (const candidate of [
    unsafePath,
    credentialedUri,
    rawHashClaim,
    embeddedExcerpt,
    malformedDigest,
  ]) {
    assert.equal(validate(candidate).valid, false);
  }
});

test("ships an intentionally incomplete template that cannot be mistaken for evidence", () => {
  const templatePath = path.join(ROOT, "templates", "trace-evidence-manifest-template.json");
  const template = JSON.parse(fs.readFileSync(templatePath, "utf8"));

  assert.equal(template.schema_version, "trace-evidence-manifest:v1");
  assert.equal(template.content_handling.mode, "manifest_only");
  assert.equal(template.content_handling.raw_content_read_by_agentic_sdlc, false);
  assert.equal(template.content_handling.raw_content_hashed_by_agentic_sdlc, false);
  assert.equal(validate(template).valid, false);
  assert.match(template.artifact.digest.value, /^replace-/u);
  assert.match(template.created_at, /^</u);
});
