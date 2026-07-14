import {
  DomainValidationError,
  STABLE_JSON_HASH_ALGORITHM,
  cloneJson,
  computeStableHash,
  immutableJson,
  isPlainRecord,
  normalizeIsoInstant,
  normalizeOptionalString,
  normalizeStringList,
  omitKeys,
  requireNonEmptyString,
  requirePlainRecord,
} from "./canonical.mjs";

export const VERIFICATION_LEVELS = Object.freeze([
  "none",
  "existence",
  "structural",
  "semantic",
  "rendered",
  "independent",
]);

export const VERIFICATION_DIMENSION_STATUSES = Object.freeze([
  "verified",
  "failed",
  "not-required",
  "not-run",
]);

const LEVEL_CHECKS = Object.freeze({
  none: Object.freeze([]),
  existence: Object.freeze(["artifact_present"]),
  structural: Object.freeze(["artifact_present", "container_verified"]),
  semantic: Object.freeze(["artifact_present", "container_verified", "content_verified"]),
  rendered: Object.freeze([
    "artifact_present",
    "container_verified",
    "content_verified",
    "render_verified",
  ]),
  independent: Object.freeze([
    "artifact_present",
    "container_verified",
    "content_verified",
    "render_verified",
    "independent_verified",
  ]),
});

const CHECK_DIMENSIONS = Object.freeze({
  artifact_present: "existence",
  container_verified: "container",
  content_verified: "content",
  render_verified: "render",
  independent_verified: "independent",
});

export function normalizeVerificationLevel(value, label = "verification_level") {
  const normalized = requireNonEmptyString(value, label).toLowerCase();
  if (!VERIFICATION_LEVELS.includes(normalized)) {
    throw new DomainValidationError(`${label} must be one of ${VERIFICATION_LEVELS.join(", ")}`);
  }
  return normalized;
}

export function compareVerificationLevels(left, right) {
  return VERIFICATION_LEVELS.indexOf(normalizeVerificationLevel(left, "left_level"))
    - VERIFICATION_LEVELS.indexOf(normalizeVerificationLevel(right, "right_level"));
}

export function requiredChecksForVerificationLevel(level) {
  return Object.freeze([...LEVEL_CHECKS[normalizeVerificationLevel(level)]]);
}

export function evaluateVerificationLevel(input, requiredLevel = input?.required_level ?? "none") {
  requirePlainRecord(input, "verification");
  const required = normalizeVerificationLevel(requiredLevel, "verification.required_level");
  const dimensionsInput = input.dimensions === undefined || input.dimensions === null
    ? {}
    : requirePlainRecord(input.dimensions, "verification.dimensions");
  const dimensions = {
    existence: normalizeDimension(
      dimensionsInput.existence ?? dimensionsInput.artifact_present ?? input.artifact_present,
      "verification.artifact_present",
    ),
    container: normalizeDimension(
      dimensionsInput.container ?? dimensionsInput.container_verified ?? input.container_verified,
      "verification.container_verified",
    ),
    content: normalizeDimension(
      dimensionsInput.content ?? dimensionsInput.content_verified ?? input.content_verified,
      "verification.content_verified",
    ),
    render: normalizeDimension(
      dimensionsInput.render ?? dimensionsInput.render_verified ?? input.render_verified,
      "verification.render_verified",
    ),
    independent: normalizeDimension(
      dimensionsInput.independent ?? dimensionsInput.independent_verified ?? input.independent_verified,
      "verification.independent_verified",
    ),
  };
  const checks = {
    artifact_present: dimensions.existence.status === "verified",
    container_verified: dimensions.container.status === "verified",
    content_verified: dimensions.content.status === "verified",
    render_verified: dimensions.render.status === "verified",
    independent_verified: dimensions.independent.status === "verified",
  };
  let achieved = "none";
  for (const level of VERIFICATION_LEVELS.slice(1)) {
    if (LEVEL_CHECKS[level].every((check) => checks[check])) {
      achieved = level;
    } else {
      break;
    }
  }
  const requiredChecks = [...LEVEL_CHECKS[required]];
  const missingChecks = requiredChecks.filter((check) => !checks[check]);
  const failedChecks = missingChecks.filter(
    (check) => dimensions[CHECK_DIMENSIONS[check]].status === "failed",
  );
  const passed = compareVerificationLevels(achieved, required) >= 0;
  return immutableJson({
    required_level: required,
    achieved_level: achieved,
    passed,
    status: passed ? "passed" : failedChecks.length > 0 ? "failed" : "partial",
    artifact_present: checks.artifact_present,
    container_verified: checks.container_verified,
    content_verified: checks.content_verified,
    render_verified: checks.render_verified,
    independent_verified: checks.independent_verified,
    required_checks: requiredChecks,
    missing_checks: missingChecks,
    failed_checks: failedChecks,
    required_dimensions: {
      existence: requiredChecks.includes("artifact_present"),
      container: requiredChecks.includes("container_verified"),
      content: requiredChecks.includes("content_verified"),
      render: requiredChecks.includes("render_verified"),
      independent: requiredChecks.includes("independent_verified"),
    },
    dimensions,
  });
}

export function meetsVerificationLevel(inputOrAchievedLevel, requiredLevel) {
  const required = normalizeVerificationLevel(requiredLevel, "required_level");
  const achieved = typeof inputOrAchievedLevel === "string"
    ? normalizeVerificationLevel(inputOrAchievedLevel, "achieved_level")
    : evaluateVerificationLevel(inputOrAchievedLevel, required).achieved_level;
  return compareVerificationLevels(achieved, required) >= 0;
}

export function buildVerificationSummary(input) {
  requirePlainRecord(input, "verification");
  const evaluation = evaluateVerificationLevel(input, input.required_level);
  const summary = {
    kind: "verification_summary",
    schema_version: "verification-summary:v1",
    version: Number.isSafeInteger(input.version) && input.version > 0 ? input.version : 1,
    id: input.id === undefined || input.id === null
      ? null
      : requireNonEmptyString(input.id, "verification.id"),
    subject_ref: normalizeNullableJson(input.subject_ref, "verification.subject_ref"),
    ...evaluation,
    evidence: normalizeArray(input.evidence, "verification.evidence"),
    limitations: normalizeStringList(input.limitations, "verification.limitations", { sort: false }),
    verified_at: input.verified_at
      ? normalizeIsoInstant(input.verified_at, "verification.verified_at")
      : null,
    verifier: normalizeOptionalString(input.verifier, "verification.verifier"),
    extensions: normalizeRecord(input.extensions, "verification.extensions"),
  };
  return immutableJson({
    ...summary,
    summary_hash: computeVerificationSummaryHash(summary),
    hash_algorithm: STABLE_JSON_HASH_ALGORITHM,
  });
}

export function computeVerificationSummaryHash(summary) {
  requirePlainRecord(summary, "verification_summary");
  return computeStableHash(omitKeys(summary, ["summary_hash", "hash_algorithm"]));
}

export function validateVerificationSummaryIntegrity(summary) {
  const errors = [];
  if (!isPlainRecord(summary)) {
    return Object.freeze({
      valid: false,
      expected_hash: null,
      errors: Object.freeze(["verification summary must be a plain object"]),
    });
  }
  if (summary.kind !== "verification_summary") {
    errors.push("verification_summary.kind must be 'verification_summary'");
  }
  if (summary.schema_version !== "verification-summary:v1") {
    errors.push("verification_summary.schema_version must be 'verification-summary:v1'");
  }
  let expectedHash = null;
  try {
    expectedHash = computeVerificationSummaryHash(summary);
  } catch (error) {
    errors.push(error.message);
  }
  if (!summary.summary_hash || summary.summary_hash !== expectedHash) {
    errors.push("verification_summary.summary_hash does not match canonical summary content");
  }
  if (summary.hash_algorithm !== STABLE_JSON_HASH_ALGORITHM) {
    errors.push(`verification_summary.hash_algorithm must be '${STABLE_JSON_HASH_ALGORITHM}'`);
  }
  let expectedEvaluation = null;
  try {
    expectedEvaluation = evaluateVerificationLevel(summary, summary.required_level);
    for (const field of [
      "required_level",
      "achieved_level",
      "passed",
      "status",
      "artifact_present",
      "container_verified",
      "content_verified",
      "render_verified",
      "independent_verified",
      "required_checks",
      "missing_checks",
      "failed_checks",
      "required_dimensions",
      "dimensions",
    ]) {
      if (computeStableHash(summary[field]) !== computeStableHash(expectedEvaluation[field])) {
        errors.push(`verification_summary.${field} is inconsistent with its verification dimensions`);
      }
    }
  } catch (error) {
    errors.push(error.message);
  }
  return Object.freeze({
    valid: errors.length === 0,
    expected_hash: expectedHash,
    expected_evaluation: expectedEvaluation,
    errors: Object.freeze(Array.from(new Set(errors))),
  });
}

export function buildVerificationReceipt(input) {
  requirePlainRecord(input, "verification_receipt");
  const summary = buildVerificationSummary(input);
  if (!summary.verified_at) {
    throw new DomainValidationError("verification_receipt.verified_at is required");
  }
  const receipt = {
    kind: "verification_receipt",
    schema_version: "verification-receipt:v1",
    version: summary.version,
    id: requireNonEmptyString(input.id, "verification_receipt.id"),
    subject_ref: summary.subject_ref,
    artifact: normalizeRequiredRecord(input.artifact, "verification_receipt.artifact"),
    generator_receipt: normalizeNullableJson(
      input.generator_receipt,
      "verification_receipt.generator_receipt",
    ),
    required_level: summary.required_level,
    achieved_level: summary.achieved_level,
    passed: summary.passed,
    status: summary.status,
    artifact_present: summary.artifact_present,
    existence_verified: summary.dimensions.existence,
    container_verified: summary.dimensions.container,
    content_verified: summary.dimensions.content,
    render_verified: summary.dimensions.render,
    independent_verified: summary.dimensions.independent,
    required_dimensions: summary.required_dimensions,
    missing_checks: summary.missing_checks,
    failed_checks: summary.failed_checks,
    evidence: summary.evidence,
    limitations: summary.limitations,
    verified_at: summary.verified_at,
    verifier: summary.verifier,
    extensions: summary.extensions,
  };
  return immutableJson({
    ...receipt,
    receipt_hash: computeVerificationReceiptHash(receipt),
    hash_algorithm: STABLE_JSON_HASH_ALGORITHM,
  });
}

export function computeVerificationReceiptHash(receipt) {
  requirePlainRecord(receipt, "verification_receipt");
  return computeStableHash(omitKeys(receipt, ["receipt_hash", "hash_algorithm"]));
}

export function validateVerificationReceiptIntegrity(receipt) {
  const errors = [];
  if (!isPlainRecord(receipt)) {
    return Object.freeze({
      valid: false,
      expected_hash: null,
      errors: Object.freeze(["verification receipt must be a plain object"]),
    });
  }
  let expectedHash = null;
  try {
    expectedHash = computeVerificationReceiptHash(receipt);
  } catch (error) {
    errors.push(error.message);
  }
  if (receipt.kind !== "verification_receipt") {
    errors.push("verification_receipt.kind must be 'verification_receipt'");
  }
  if (receipt.schema_version !== "verification-receipt:v1") {
    errors.push("verification_receipt.schema_version must be 'verification-receipt:v1'");
  }
  if (receipt.receipt_hash !== expectedHash) {
    errors.push("verification_receipt.receipt_hash does not match canonical receipt content");
  }
  if (receipt.hash_algorithm !== STABLE_JSON_HASH_ALGORITHM) {
    errors.push(`verification_receipt.hash_algorithm must be '${STABLE_JSON_HASH_ALGORITHM}'`);
  }
  if (!isPlainRecord(receipt.artifact) || Object.keys(receipt.artifact).length === 0) {
    errors.push("verification_receipt.artifact must be a non-empty object");
  }
  try {
    const verifiedAt = normalizeIsoInstant(receipt.verified_at, "verification_receipt.verified_at");
    if (verifiedAt !== receipt.verified_at) {
      errors.push("verification_receipt.verified_at must be in canonical ISO-8601 UTC form");
    }
  } catch (error) {
    errors.push(error.message);
  }
  let expectedEvaluation = null;
  try {
    expectedEvaluation = evaluateVerificationLevel({
      required_level: receipt.required_level,
      dimensions: {
        existence: receipt.existence_verified ?? receipt.artifact_present,
        container: receipt.container_verified,
        content: receipt.content_verified,
        render: receipt.render_verified,
        independent: receipt.independent_verified,
      },
    });
    for (const field of [
      "required_level",
      "achieved_level",
      "passed",
      "status",
      "artifact_present",
      "missing_checks",
      "failed_checks",
      "required_dimensions",
    ]) {
      if (computeStableHash(receipt[field]) !== computeStableHash(expectedEvaluation[field])) {
        errors.push(`verification_receipt.${field} is inconsistent with its verification dimensions`);
      }
    }
  } catch (error) {
    errors.push(error.message);
  }
  return Object.freeze({
    valid: errors.length === 0,
    expected_hash: expectedHash,
    expected_evaluation: expectedEvaluation,
    errors: Object.freeze(Array.from(new Set(errors))),
  });
}

function normalizeDimension(value, label) {
  if (value === undefined || value === null || typeof value === "boolean") {
    return {
      status: value === true ? "verified" : "not-run",
      verifier: null,
      checks: [],
      evidence: [],
      verified_at: null,
      reason: null,
    };
  }
  requirePlainRecord(value, label);
  let status = value.status;
  if (status === undefined && typeof value.verified === "boolean") {
    status = value.verified ? "verified" : "failed";
  }
  status = requireNonEmptyString(status, `${label}.status`).toLowerCase();
  if (!VERIFICATION_DIMENSION_STATUSES.includes(status)) {
    throw new DomainValidationError(
      `${label}.status must be one of ${VERIFICATION_DIMENSION_STATUSES.join(", ")}`,
    );
  }
  return {
    status,
    verifier: normalizeOptionalString(value.verifier, `${label}.verifier`),
    checks: normalizeStringList(value.checks, `${label}.checks`, { sort: false }),
    evidence: normalizeArray(value.evidence, `${label}.evidence`),
    verified_at: value.verified_at ? normalizeIsoInstant(value.verified_at, `${label}.verified_at`) : null,
    reason: normalizeOptionalString(value.reason, `${label}.reason`),
  };
}

function normalizeRecord(value, label) {
  if (value === undefined || value === null) {
    return {};
  }
  requirePlainRecord(value, label);
  return cloneJson(value);
}

function normalizeRequiredRecord(value, label) {
  requirePlainRecord(value, label);
  if (Object.keys(value).length === 0) {
    throw new DomainValidationError(`${label} must not be empty`);
  }
  return cloneJson(value);
}

function normalizeArray(value, label) {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new DomainValidationError(`${label} must be an array`);
  }
  return cloneJson(value);
}

function normalizeNullableJson(value, label) {
  if (value === undefined || value === null) {
    return null;
  }
  try {
    return cloneJson(value);
  } catch (error) {
    throw new DomainValidationError(`${label} must be canonical JSON: ${error.message}`);
  }
}
