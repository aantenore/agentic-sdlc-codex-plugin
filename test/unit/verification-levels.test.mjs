import test from "node:test";
import assert from "node:assert/strict";

import {
  VERIFICATION_LEVELS,
  buildVerificationReceipt,
  buildVerificationSummary,
  compareVerificationLevels,
  evaluateVerificationLevel,
  meetsVerificationLevel,
  requiredChecksForVerificationLevel,
  validateVerificationReceiptIntegrity,
  validateVerificationSummaryIntegrity,
} from "../../lib/verification-levels.mjs";

test("verification levels are ordered and require cumulative independent checks", () => {
  assert.deepEqual(VERIFICATION_LEVELS, [
    "none",
    "existence",
    "structural",
    "semantic",
    "rendered",
    "independent",
  ]);
  assert.ok(compareVerificationLevels("semantic", "structural") > 0);
  assert.deepEqual(requiredChecksForVerificationLevel("rendered"), [
    "artifact_present",
    "container_verified",
    "content_verified",
    "render_verified",
  ]);
  assert.equal(meetsVerificationLevel("semantic", "structural"), true);
  assert.equal(meetsVerificationLevel("structural", "semantic"), false);
});

test("semantic verification cannot imply rendered or independent verification", () => {
  const evaluation = evaluateVerificationLevel({
    required_level: "semantic",
    artifact_present: true,
    container_verified: true,
    content_verified: true,
    render_verified: false,
    independent_verified: false,
  });

  assert.equal(evaluation.achieved_level, "semantic");
  assert.equal(evaluation.passed, true);
  assert.equal(evaluation.container_verified, true);
  assert.equal(evaluation.content_verified, true);
  assert.equal(evaluation.render_verified, false);
  assert.equal(evaluation.independent_verified, false);
});

test("missing render remains explicit and blocks a rendered requirement", () => {
  const evaluation = evaluateVerificationLevel({
    required_level: "rendered",
    artifact_present: true,
    container_verified: true,
    content_verified: true,
    render_verified: false,
  });

  assert.equal(evaluation.achieved_level, "semantic");
  assert.equal(evaluation.passed, false);
  assert.equal(evaluation.status, "partial");
  assert.deepEqual(evaluation.missing_checks, ["render_verified"]);
  assert.equal(evaluation.required_dimensions.render, true);
});

test("failed dimensions are distinct from checks that were not run", () => {
  const evaluation = evaluateVerificationLevel({
    required_level: "semantic",
    artifact_present: true,
    container_verified: {
      status: "verified",
      verifier: "zip-checker",
      checks: ["archive opens"],
    },
    content_verified: {
      status: "failed",
      verifier: "semantic-checker",
      checks: ["required sections"],
      reason: "Missing risk section",
    },
  });

  assert.equal(evaluation.achieved_level, "structural");
  assert.equal(evaluation.status, "failed");
  assert.deepEqual(evaluation.failed_checks, ["content_verified"]);
  assert.equal(evaluation.dimensions.content.reason, "Missing risk section");
});

test("verification summary is immutable, self-consistent, and tamper-evident", () => {
  const summary = buildVerificationSummary({
    id: "verification-summary-001",
    required_level: "independent",
    artifact_present: true,
    container_verified: true,
    content_verified: true,
    render_verified: true,
    independent_verified: {
      status: "verified",
      verifier: "reviewer-2",
      checks: ["independent recalculation"],
      verified_at: "2026-07-14T10:00:00.000Z",
    },
    subject_ref: { id: "artifact-001", hash: "a".repeat(64) },
    verified_at: "2026-07-14T10:00:00.000Z",
    evidence: [{ kind: "independent-review", id: "review-001" }],
  });

  assert.equal(summary.achieved_level, "independent");
  assert.equal(summary.passed, true);
  assert.equal(validateVerificationSummaryIntegrity(summary).valid, true);
  assert.equal(Object.isFrozen(summary.dimensions.independent), true);

  const tampered = structuredClone(summary);
  tampered.render_verified = false;
  const integrity = validateVerificationSummaryIntegrity(tampered);
  assert.equal(integrity.valid, false);
  assert.match(integrity.errors.join("\n"), /summary_hash|inconsistent/);
});

test("verification receipt exposes layered dimensions as a persistable receipt", () => {
  const receipt = buildVerificationReceipt({
    id: "verification-receipt-001",
    required_level: "rendered",
    artifact: {
      path: "artifacts/report.pdf",
      sha256: "b".repeat(64),
      format: "pdf",
      media_type: "application/pdf",
    },
    generator_receipt: {
      id: "generator-001",
      path: "receipts/generator-001.json",
      hash: "c".repeat(64),
    },
    artifact_present: true,
    container_verified: {
      status: "verified",
      verifier: "pdfinfo",
      checks: ["container opens"],
    },
    content_verified: {
      status: "verified",
      verifier: "content-checker",
      checks: ["required sections present"],
    },
    render_verified: {
      status: "verified",
      verifier: "renderer",
      checks: ["all pages rendered"],
    },
    independent_verified: false,
    verified_at: "2026-07-14T10:15:00.000Z",
  });

  assert.equal(receipt.kind, "verification_receipt");
  assert.equal(receipt.schema_version, "verification-receipt:v1");
  assert.equal(receipt.status, "passed");
  assert.equal(receipt.container_verified.status, "verified");
  assert.equal(receipt.content_verified.status, "verified");
  assert.equal(receipt.render_verified.status, "verified");
  assert.equal(receipt.independent_verified.status, "not-run");
  assert.equal(validateVerificationReceiptIntegrity(receipt).valid, true);
});
