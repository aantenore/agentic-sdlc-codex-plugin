import crypto from "node:crypto";

import { canonicalJson } from "../canonical.mjs";
import { createCorrelationId, isValidCorrelationId } from "./context.mjs";
import {
  DEFAULT_REDACTION_POLICY,
  redactValueWithMetadata,
} from "./redaction.mjs";

const SECTION_NAME_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export const DEFAULT_SUPPORT_BUNDLE_SECTIONS = Object.freeze([
  "environment",
  "health",
  "metrics",
  "slo",
  "versions",
]);

export class SupportBundleError extends TypeError {
  constructor(message, code = "support_bundle_invalid") {
    super(message);
    this.name = "SupportBundleError";
    this.code = code;
  }
}

export function createSupportBundle(input, dependencies = {}) {
  requirePlainRecord(input, "support bundle input");
  requirePlainRecord(dependencies, "support bundle dependencies");
  requirePlainRecord(input.sections, "support bundle sections");

  const allowedSections = normalizeAllowedSections(
    input.allowedSections ?? DEFAULT_SUPPORT_BUNDLE_SECTIONS,
  );
  const sectionNames = Object.keys(input.sections).sort();
  const unexpected = sectionNames.filter((name) => !allowedSections.has(name));
  if (unexpected.length > 0) {
    throw new SupportBundleError(
      `Support bundle contains non-allowlisted sections: ${unexpected.join(", ")}`,
      "support_bundle_section_not_allowed",
    );
  }

  const policy = input.redactionPolicy ?? DEFAULT_REDACTION_POLICY;
  const selected = {};
  for (const name of sectionNames) selected[name] = input.sections[name];
  const redaction = redactValueWithMetadata(selected, policy);
  const correlationId = normalizeCorrelationId(
    input.context?.correlation_id
      ?? input.correlationId
      ?? createCorrelationId(dependencies.randomUUID),
  );
  const now = dependencies.now ?? (() => new Date());
  if (typeof now !== "function") {
    throw new SupportBundleError("now must be a function");
  }
  const generatedAt = normalizeInstant(input.generatedAt ?? now());

  const payload = deepFreeze({
    schema_version: "agentic-sdlc-support-bundle:v1",
    generated_at: generatedAt,
    correlation_id: correlationId,
    included_sections: redaction.limited ? [] : sectionNames,
    withheld_sections: redaction.limited ? sectionNames : [],
    redaction: {
      applied: redaction.redactions > 0,
      redactions: redaction.redactions,
      limited: redaction.limited,
      limit: redaction.limit,
    },
    sections: redaction.limited ? {} : redaction.value,
  });
  const digest = sha256Canonical(payload);
  return deepFreeze({
    ...payload,
    integrity: {
      algorithm: "sha256",
      representation: "utf8_canonical_json_of_redacted_payload",
      digest,
      assurance: "content_integrity_only_not_authenticity",
    },
  });
}

export function verifySupportBundleDigest(bundle) {
  try {
    if (!isPlainRecord(bundle) || !isPlainRecord(bundle.integrity)) return false;
    if (
      bundle.integrity.algorithm !== "sha256"
      || bundle.integrity.representation !== "utf8_canonical_json_of_redacted_payload"
      || bundle.integrity.assurance !== "content_integrity_only_not_authenticity"
      || typeof bundle.integrity.digest !== "string"
      || !SHA256_PATTERN.test(bundle.integrity.digest)
    ) {
      return false;
    }
    const payload = {};
    for (const [key, value] of Object.entries(bundle)) {
      if (key !== "integrity") payload[key] = value;
    }
    const expected = Buffer.from(bundle.integrity.digest, "hex");
    const actual = Buffer.from(sha256Canonical(payload), "hex");
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function sha256Canonical(value) {
  return crypto.createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function normalizeAllowedSections(input) {
  if (!Array.isArray(input) || input.length === 0) {
    throw new SupportBundleError("allowedSections must be a non-empty array");
  }
  const sections = input.map((value, index) => {
    if (typeof value !== "string" || !SECTION_NAME_PATTERN.test(value)) {
      throw new SupportBundleError(`allowedSections[${index}] has an invalid section name`);
    }
    return value;
  });
  if (new Set(sections).size !== sections.length) {
    throw new SupportBundleError("allowedSections contains duplicates");
  }
  return new Set(sections);
}

function normalizeCorrelationId(value) {
  if (!isValidCorrelationId(value)) {
    throw new SupportBundleError("correlationId must use the form corr-<uuid>");
  }
  return value.toLowerCase();
}

function normalizeInstant(value) {
  if (value === null || value === "" || typeof value === "boolean") {
    throw new SupportBundleError("generatedAt must be a valid date-time");
  }
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new SupportBundleError("generatedAt must be a valid date-time");
  }
  return date.toISOString();
}

function requirePlainRecord(value, label) {
  if (!isPlainRecord(value)) throw new SupportBundleError(`${label} must be a plain object`);
}

function isPlainRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepFreeze(value, seen = new Set()) {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const item of Object.values(value)) deepFreeze(item, seen);
  return Object.freeze(value);
}
