export const INTENTABI_CODEX_SHADOW_EVIDENCE_SCHEMA =
  "io.github.aantenore.intentabi/codex-shadow-evidence/v1alpha1";

export const INTENTABI_CODEX_SHADOW_ENVELOPE_SCHEMA =
  "io.github.aantenore.intentabi/authenticated-codex-shadow-evidence/v1alpha1";

export const INTENTABI_OBSERVATION_PATH_PREFIX = ".sdlc/observations/intentabi/";
export const INTENTABI_REDACTED_OBSERVATION_PATH =
  `${INTENTABI_OBSERVATION_PATH_PREFIX}[noncanonical-path-omitted]`;

const HMAC_PATTERN = /^hmac-sha256:evidence:[a-f0-9]{64}$/u;
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const OUTCOMES = new Set([
  "candidate-observed",
  "identity",
  "bypass",
  "preparer-fault",
  "preparer-timeout",
  "invalid-preparer-result",
]);

const REASONS = new Set([
  "CANDIDATE_ATTESTED",
  "IDENTITY_ATTESTED",
  "NON_TEXT_INPUT",
  "REQUEST_ID_INVALID",
  "INPUT_LIMIT_EXCEEDED",
  "PREPARATION_TIMEOUT_UNCANCELLED",
  "PREPARER_FAULT",
  "PREPARER_RESULT_INVALID",
]);

const TOP_LEVEL_KEYS = ["schema", "eventId", "keyId", "evidence", "mac"];
const EVIDENCE_KEYS = [
  "schema",
  "mode",
  "submitted",
  "inputKind",
  "bindingDigest",
  "originalDigest",
  "optionsDigest",
  "execution",
  "preparation",
];
const EXECUTION_KEYS = ["status", "outputDigest"];
const PREPARATION_REQUIRED_KEYS = ["outcome", "reason", "proof"];
const PREPARATION_OPTIONAL_KEYS = [
  "candidateDigest",
  "selectedCodecDigest",
  "reasonSetDigest",
  "promotionBindingDigest",
];

export function isIntentAbiObservationPath(publicPath) {
  return typeof publicPath === "string"
    && publicPath.toLowerCase().startsWith(INTENTABI_OBSERVATION_PATH_PREFIX);
}

export function intentAbiEventIdFromObservationPath(publicPath) {
  if (typeof publicPath !== "string") return null;
  const match = publicPath.match(
    /^\.sdlc\/observations\/intentabi\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.json$/u,
  );
  return match?.[1] ?? null;
}

export function isCanonicalIntentAbiObservationPath(publicPath, eventId = null) {
  const pathEventId = intentAbiEventIdFromObservationPath(publicPath);
  return pathEventId !== null && (eventId === null || pathEventId === eventId);
}

export function isIntentAbiCodexEnvelopeCandidate(value, publicPath = "") {
  return isIntentAbiObservationPath(publicPath)
    || (isRecord(value) && value.schema === INTENTABI_CODEX_SHADOW_ENVELOPE_SCHEMA);
}

/**
 * Strictly validates the upstream v1alpha1 envelope, then returns only the
 * content-free fields approved for the Observatory surface. The HMAC is never
 * verified here because this read-only process has neither a trusted binding
 * nor key material.
 */
export function projectIntentAbiCodexEnvelope(value) {
  if (!hasExactKeys(value, TOP_LEVEL_KEYS)) return null;
  if (
    value.schema !== INTENTABI_CODEX_SHADOW_ENVELOPE_SCHEMA
    || typeof value.eventId !== "string"
    || !UUID_V4_PATTERN.test(value.eventId)
    || typeof value.keyId !== "string"
    || !KEY_ID_PATTERN.test(value.keyId)
    || !isHmac(value.mac)
  ) {
    return null;
  }

  const evidence = value.evidence;
  if (!hasExactKeys(evidence, EVIDENCE_KEYS)) return null;
  if (
    evidence.schema !== INTENTABI_CODEX_SHADOW_EVIDENCE_SCHEMA
    || evidence.mode !== "shadow"
    || evidence.submitted !== "original"
    || !["text", "non-text"].includes(evidence.inputKind)
    || !isHmac(evidence.bindingDigest)
    || !isHmacOr(
      evidence.originalDigest,
      "unavailable:original-digest",
      "unavailable:non-text-input",
    )
    || !["unavailable:not-provided", "unavailable:unbound-options"].includes(evidence.optionsDigest)
  ) {
    return null;
  }

  const execution = evidence.execution;
  if (
    !hasExactKeys(execution, EXECUTION_KEYS)
    || execution.status !== "succeeded"
    || execution.outputDigest !== "unavailable:opaque-output"
  ) {
    return null;
  }

  const preparation = evidence.preparation;
  if (!hasOnlyKeys(preparation, [...PREPARATION_REQUIRED_KEYS, ...PREPARATION_OPTIONAL_KEYS])) return null;
  if (!PREPARATION_REQUIRED_KEYS.every((key) => Object.hasOwn(preparation, key))) return null;
  if (
    !OUTCOMES.has(preparation.outcome)
    || !REASONS.has(preparation.reason)
    || !["present-unverified", "not-observed"].includes(preparation.proof)
    || !optionalDigestIsValid(preparation, "candidateDigest", "unavailable:candidate-digest")
    || !optionalDigestIsValid(preparation, "selectedCodecDigest", "unavailable:codec-digest")
    || !optionalDigestIsValid(preparation, "reasonSetDigest", "unavailable:reason-set-digest")
    || !optionalDigestIsValid(preparation, "promotionBindingDigest", "unavailable:promotion-binding-digest")
    || !preparationIsCoherent(preparation)
  ) {
    return null;
  }

  if (
    (evidence.inputKind === "non-text"
      && (evidence.originalDigest !== "unavailable:non-text-input"
        || preparation.outcome !== "bypass"
        || preparation.reason !== "NON_TEXT_INPUT"))
    || (evidence.inputKind === "text"
      && (evidence.originalDigest === "unavailable:non-text-input"
        || preparation.reason === "NON_TEXT_INPUT"))
  ) {
    return null;
  }

  return Object.freeze({
    eventId: value.eventId,
    mode: "shadow",
    submitted: "original",
    outcome: preparation.outcome,
    reason: preparation.reason,
    proof: preparation.proof,
    macStatus: "present-not-verified",
  });
}

function preparationIsCoherent(preparation) {
  const present = (field) => Object.hasOwn(preparation, field);
  const allOptionalPresent = PREPARATION_OPTIONAL_KEYS.every(present);
  const noOptionalPresent = PREPARATION_OPTIONAL_KEYS.every((field) => !present(field));

  if (preparation.outcome === "candidate-observed") {
    return preparation.reason === "CANDIDATE_ATTESTED"
      && preparation.proof === "present-unverified"
      && allOptionalPresent;
  }
  if (preparation.outcome === "identity") {
    return preparation.reason === "IDENTITY_ATTESTED"
      && !present("candidateDigest")
      && present("selectedCodecDigest")
      && present("reasonSetDigest");
  }
  if (preparation.outcome === "bypass") {
    return ["NON_TEXT_INPUT", "REQUEST_ID_INVALID", "INPUT_LIMIT_EXCEEDED"].includes(preparation.reason)
      && preparation.proof === "not-observed"
      && noOptionalPresent;
  }
  if (preparation.outcome === "preparer-timeout") {
    return preparation.reason === "PREPARATION_TIMEOUT_UNCANCELLED"
      && preparation.proof === "not-observed"
      && noOptionalPresent;
  }
  if (preparation.outcome === "preparer-fault") {
    return preparation.reason === "PREPARER_FAULT"
      && preparation.proof === "not-observed"
      && noOptionalPresent;
  }
  return preparation.outcome === "invalid-preparer-result"
    && preparation.reason === "PREPARER_RESULT_INVALID"
    && preparation.proof === "not-observed"
    && noOptionalPresent;
}

function optionalDigestIsValid(value, field, unavailable) {
  return !Object.hasOwn(value, field) || isHmacOr(value[field], unavailable);
}

function isHmacOr(value, ...unavailable) {
  return isHmac(value) || (typeof value === "string" && unavailable.includes(value));
}

function isHmac(value) {
  return typeof value === "string" && HMAC_PATTERN.test(value);
}

function hasExactKeys(value, expected) {
  return hasOnlyKeys(value, expected)
    && expected.every((key) => Object.hasOwn(value, key))
    && Reflect.ownKeys(value).length === expected.length;
}

function hasOnlyKeys(value, allowed) {
  if (!isRecord(value)) return false;
  const keys = Reflect.ownKeys(value);
  return keys.every((key) => typeof key === "string" && allowed.includes(key));
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
