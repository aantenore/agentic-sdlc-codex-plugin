import {
  createOperationalRedactionPolicy,
} from "../observability/redaction.mjs";
import { readResolvedFileBounded } from "./bounded-file-reader.mjs";
import {
  ObservatoryPathError,
  resolveExistingFileWithin,
  resolveProjectBoundary,
} from "./path-safety.mjs";

const CONFIG_PATH = ".sdlc/config.json";
const MAX_CONFIG_BYTES = 2 * 1024 * 1024;

export async function resolveObservatoryConfiguration(projectRoot, overrides = {}) {
  if (!isPlainRecord(overrides)) {
    throw new TypeError("Observatory configuration overrides must be a plain object");
  }
  const canonicalRoot = await resolveProjectBoundary(projectRoot);
  const projectConfiguration = await readProjectObservabilityConfiguration(canonicalRoot);
  const redactionPolicy = overrides.redactionPolicy
    ?? createOperationalRedactionPolicy(redactionOptions(projectConfiguration.redaction));
  const operationalPolicy = Object.freeze({
    ...operationalOptions(projectConfiguration),
    ...(overrides.operationalPolicy || {}),
  });
  return Object.freeze({ redactionPolicy, operationalPolicy });
}

async function readProjectObservabilityConfiguration(projectRoot) {
  let resolved;
  try {
    resolved = await resolveExistingFileWithin(projectRoot, CONFIG_PATH);
  } catch (error) {
    // Configuration is optional. An unsafe or unavailable path is never
    // followed; defaults keep the shallow liveness endpoint available while
    // readiness independently reports the project boundary failure.
    if (error instanceof ObservatoryPathError) return {};
    throw error;
  }
  const bytes = await readResolvedFileBounded(resolved, {
    maxBytes: MAX_CONFIG_BYTES,
    boundaryCode: "configuration_boundary_changed",
    tooLargeCode: "configuration_too_large",
    tooLargeMessage: "The project configuration exceeds the supported size limit",
  });
  try {
    const parsed = JSON.parse(bytes.toString("utf8"));
    const value = parsed?.observability ?? {};
    if (!isPlainRecord(value)) throw new TypeError();
    if (value.external_sinks !== undefined && value.external_sinks !== "disabled") {
      throw new TypeError();
    }
    return value;
  } catch {
    throw new TypeError("The project observability configuration is invalid");
  }
}

function redactionOptions(value) {
  if (value === undefined) return {};
  if (!isPlainRecord(value)) throw new TypeError("The project observability redaction configuration is invalid");
  return compactObject({
    secretPatterns: detectorPatterns(value.secret_patterns, "secret_patterns"),
    piiPatterns: detectorPatterns(value.pii_patterns, "pii_patterns"),
    identifierAllowPatterns: detectorPatterns(value.identifier_allow_patterns, "identifier_allow_patterns"),
    sensitiveKeys: stringArray(value.sensitive_keys, "sensitive_keys"),
  });
}

function operationalOptions(value) {
  if (!isPlainRecord(value)) return {};
  const slo = value.slo;
  const supportBundle = value.support_bundle;
  if (slo !== undefined && !isPlainRecord(slo)) throw new TypeError("The project observability SLO configuration is invalid");
  if (supportBundle !== undefined && !isPlainRecord(supportBundle)) {
    throw new TypeError("The project observability support-bundle configuration is invalid");
  }
  return compactObject({
    maxRecentRequests: optionalPositiveInteger(supportBundle?.max_recent_requests, "max_recent_requests"),
    availabilityTarget: optionalRatio(slo?.availability_target, "availability_target"),
    readinessTarget: optionalRatio(slo?.readiness_target, "readiness_target"),
    minimumSamples: optionalPositiveInteger(slo?.minimum_samples, "minimum_samples"),
  });
}

function detectorPatterns(value, label) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new TypeError(`Observatory ${label} must be an array`);
  return value.map((entry, index) => {
    if (typeof entry === "string") return { name: `${label}_${index + 1}`, pattern: entry };
    if (!isPlainRecord(entry) || typeof entry.name !== "string" || typeof entry.pattern !== "string") {
      throw new TypeError(`Observatory ${label}[${index}] must contain string name and pattern fields`);
    }
    return { name: entry.name, pattern: entry.pattern };
  });
}

function stringArray(value, label) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.trim() === "")) {
    throw new TypeError(`Observatory ${label} must be an array of non-empty strings`);
  }
  return value;
}

function optionalPositiveInteger(value, label) {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`Observatory ${label} must be a positive safe integer`);
  return value;
}

function optionalRatio(value, label) {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeError(`Observatory ${label} must be between 0 and 1`);
  }
  return value;
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function isPlainRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
