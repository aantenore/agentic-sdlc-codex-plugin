import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import { canonicalJson } from "../../lib/canonical.mjs";
import { createRedactionPolicy } from "../../lib/observability/redaction.mjs";
import {
  createSupportBundle,
  verifySupportBundleDigest,
} from "../../lib/observability/support-bundle.mjs";

const CORRELATION_ID = "corr-123e4567-e89b-12d3-a456-426614174000";

test("support bundles include only allowlisted, recursively redacted sections", () => {
  const policy = createRedactionPolicy({
    secrets: ["support-secret"],
    piiPatterns: [/owner@example\.com/giu],
  });
  const sections = {
    health: { status: "ok", token: "raw-token" },
    metrics: { note: "owner@example.com used support-secret" },
  };
  const bundle = createSupportBundle({
    sections,
    allowedSections: ["health", "metrics"],
    redactionPolicy: policy,
    correlationId: CORRELATION_ID,
    generatedAt: "2026-07-18T10:00:00.000Z",
  });

  assert.deepEqual(bundle.sections, {
    health: { status: "ok", token: "[REDACTED]" },
    metrics: { note: "[REDACTED] used [REDACTED]" },
  });
  assert.deepEqual(bundle.included_sections, ["health", "metrics"]);
  assert.deepEqual(bundle.withheld_sections, []);
  assert.equal(bundle.redaction.applied, true);
  assert.equal(bundle.redaction.limited, false);
  assert.equal(bundle.integrity.algorithm, "sha256");
  assert.equal(bundle.integrity.digest.length, 64);
  assert.equal(bundle.integrity.assurance, "content_integrity_only_not_authenticity");
  assert.equal(verifySupportBundleDigest(bundle), true);
  assert.equal(sections.health.token, "raw-token");
  assert.equal(Object.isFrozen(bundle.sections.health), true);
});

test("support bundle digest detects content changes but does not claim authenticity", () => {
  const bundle = createSupportBundle({
    sections: { health: { status: "ok" } },
    allowedSections: ["health"],
    correlationId: CORRELATION_ID,
    generatedAt: "2026-07-18T10:00:00.000Z",
  });
  const reorderedClone = {
    sections: bundle.sections,
    redaction: bundle.redaction,
    included_sections: bundle.included_sections,
    schema_version: bundle.schema_version,
    correlation_id: bundle.correlation_id,
    generated_at: bundle.generated_at,
    withheld_sections: bundle.withheld_sections,
    integrity: bundle.integrity,
  };
  assert.equal(verifySupportBundleDigest(reorderedClone), true);

  const tampered = JSON.parse(JSON.stringify(bundle));
  tampered.sections.health.status = "degraded";
  assert.equal(verifySupportBundleDigest(tampered), false);
  tampered.sections.health.status = "ok";
  tampered.integrity.assurance = "signed_and_authentic";
  assert.equal(verifySupportBundleDigest(tampered), false);

  const forgedMetadata = JSON.parse(JSON.stringify(bundle));
  forgedMetadata.integrity.authenticity = "provider_signed";
  forgedMetadata.integrity.signature = "FAKE";
  assert.equal(verifySupportBundleDigest(forgedMetadata), false);

  const forgedTopLevel = JSON.parse(JSON.stringify(bundle));
  forgedTopLevel.authenticity_claimed = true;
  forgedTopLevel.signature = "FAKE";
  const forgedPayload = Object.fromEntries(
    Object.entries(forgedTopLevel).filter(([key]) => key !== "integrity"),
  );
  forgedTopLevel.integrity.digest = crypto
    .createHash("sha256")
    .update(canonicalJson(forgedPayload), "utf8")
    .digest("hex");
  assert.equal(verifySupportBundleDigest(forgedTopLevel), false);
});

test("support bundles use credential-safe defaults", () => {
  const token = `github_pat_${"A".repeat(32)}`;
  const bundle = createSupportBundle({
    sections: { environment: { note: `${token} owner@example.com` } },
    correlationId: CORRELATION_ID,
    generatedAt: "2026-07-18T10:00:00.000Z",
  });

  assert.equal(JSON.stringify(bundle).includes(token), false);
  assert.equal(JSON.stringify(bundle).includes("owner@example.com"), false);
  assert.equal(bundle.redaction.applied, true);
  assert.equal(verifySupportBundleDigest(bundle), true);

  const unsafeSection = `github_pat_${"a".repeat(32)}`;
  assert.throws(
    () => createSupportBundle({
      sections: { [unsafeSection]: { status: "ok" } },
      allowedSections: [unsafeSection],
      correlationId: CORRELATION_ID,
      generatedAt: "2026-07-18T10:00:00.000Z",
    }),
    (error) => error?.code === "support_bundle_section_name_unsafe",
  );
  assert.throws(
    () => createSupportBundle({
      sections: { [unsafeSection]: { status: "ok" } },
      allowedSections: ["health"],
      correlationId: CORRELATION_ID,
      generatedAt: "2026-07-18T10:00:00.000Z",
    }),
    (error) => {
      assert.equal(error?.code, "support_bundle_section_name_unsafe");
      assert.doesNotMatch(String(error?.message), /github_pat_/u);
      return true;
    },
  );
});

test("support bundles reject non-allowlisted sections and withhold all data on redaction limits", () => {
  assert.throws(
    () => createSupportBundle({
      sections: { health: {}, repository_dump: { secret: "raw" } },
      allowedSections: ["health"],
      correlationId: CORRELATION_ID,
      generatedAt: "2026-07-18T10:00:00.000Z",
    }),
    (error) => error?.code === "support_bundle_section_not_allowed",
  );

  const bundle = createSupportBundle({
    sections: { health: { nested: { too: { deep: "must-not-leak" } } } },
    allowedSections: ["health"],
    redactionPolicy: createRedactionPolicy({ limits: { maxDepth: 2 } }),
    correlationId: CORRELATION_ID,
    generatedAt: "2026-07-18T10:00:00.000Z",
  });
  assert.deepEqual(bundle.sections, {});
  assert.deepEqual(bundle.included_sections, []);
  assert.deepEqual(bundle.withheld_sections, ["health"]);
  assert.equal(bundle.redaction.limited, true);
  assert.equal(verifySupportBundleDigest(bundle), true);
});
