const POLICY_STATE = new WeakMap();

export const REDACTION_PLACEHOLDER = "[REDACTED]";
export const REDACTION_LIMIT_PLACEHOLDER = "[REDACTED:LIMIT_EXCEEDED]";

const DEFAULT_LIMITS = Object.freeze({
  maxDepth: 24,
  maxNodes: 10_000,
  maxStringLength: 262_144,
  maxOutputChars: 1_048_576,
  maxMatches: 2_000,
  maxPatterns: 64,
  maxPatternLength: 512,
});

const DEFAULT_SENSITIVE_KEYS = Object.freeze([
  "access_token",
  "api_key",
  "authorization",
  "client_secret",
  "cookie",
  "password",
  "private_key",
  "refresh_token",
  "secret",
  "set_cookie",
  "token",
]);

const BUILTIN_IDENTIFIER_PATTERNS = Object.freeze([
  Object.freeze({
    name: "sha_digest",
    pattern: /^(?:(?:sha(?:1|224|256|384|512))[:=-])?(?:[a-f0-9]{40}|[a-f0-9]{56}|[a-f0-9]{64}|[a-f0-9]{96}|[a-f0-9]{128})$/iu,
  }),
  Object.freeze({
    name: "uuid",
    pattern: /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu,
  }),
  Object.freeze({
    name: "correlation_id",
    pattern: /^corr-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu,
  }),
  Object.freeze({
    name: "authorization_action_id",
    pattern: /^AUT-ACT-\d{17}-[a-f0-9]{6}$/u,
  }),
]);

export class RedactionConfigurationError extends TypeError {
  constructor(message) {
    super(message);
    this.name = "RedactionConfigurationError";
    this.code = "redaction_configuration_invalid";
  }
}

export class RedactionLimitError extends Error {
  constructor(limit) {
    super(`Redaction stopped at configured limit '${limit}'`);
    this.name = "RedactionLimitError";
    this.code = "redaction_limit_exceeded";
    this.limit = limit;
  }
}

export function createRedactionPolicy(options = {}) {
  requirePlainRecord(options, "redaction options");
  const limits = normalizeLimits(options.limits);
  const replacement = normalizeReplacement(options.replacement);
  const secrets = normalizeSecrets(options.secrets, replacement);
  const secretPatterns = normalizePatterns(options.secretPatterns, "secretPatterns", limits);
  const piiPatterns = normalizePatterns(options.piiPatterns, "piiPatterns", limits);
  const customIdentifiers = normalizePatterns(
    options.identifierAllowPatterns,
    "identifierAllowPatterns",
    limits,
  );
  const patternCount = secretPatterns.length + piiPatterns.length + customIdentifiers.length;
  if (patternCount > limits.maxPatterns) {
    throw new RedactionConfigurationError(
      `Configured patterns exceed maxPatterns (${limits.maxPatterns})`,
    );
  }

  const sensitiveKeys = normalizeSensitiveKeys(options.sensitiveKeys);
  const publicPolicy = Object.freeze({
    schema_version: "agentic-sdlc-redaction-policy:v1",
    replacement,
    limits,
    sensitive_keys: Object.freeze([...sensitiveKeys].sort()),
    detector_count: secretPatterns.length + piiPatterns.length,
    identifier_allowlist: Object.freeze([
      ...BUILTIN_IDENTIFIER_PATTERNS.map(({ name }) => name),
      ...customIdentifiers.map(({ name }) => name),
    ]),
  });
  POLICY_STATE.set(publicPolicy, Object.freeze({
    limits,
    replacement,
    secrets,
    patterns: Object.freeze([...secretPatterns, ...piiPatterns]),
    identifierPatterns: Object.freeze([...BUILTIN_IDENTIFIER_PATTERNS, ...customIdentifiers]),
    sensitiveKeys: new Set(sensitiveKeys),
  }));
  return publicPolicy;
}

export const DEFAULT_REDACTION_POLICY = createRedactionPolicy();

export function isAllowedIdentifier(value, policy = DEFAULT_REDACTION_POLICY) {
  const state = requirePolicy(policy);
  if (typeof value !== "string" || value.length === 0 || value.length > state.limits.maxStringLength) {
    return false;
  }
  return isAllowedByState(value, state);
}

export function redactText(value, policy = DEFAULT_REDACTION_POLICY) {
  if (typeof value !== "string") {
    throw new TypeError("redactText value must be a string");
  }
  return redactValueWithMetadata(value, policy).value;
}

export function redactValue(value, policy = DEFAULT_REDACTION_POLICY) {
  return redactValueWithMetadata(value, policy).value;
}

export function redactValueWithMetadata(value, policy = DEFAULT_REDACTION_POLICY) {
  const state = requirePolicy(policy);
  const budget = {
    nodes: 0,
    outputChars: 0,
    matches: 0,
    redactions: 0,
  };
  try {
    const redacted = walkValue(value, state, budget, 0, new Set());
    return deepFreeze({
      value: redacted,
      redactions: budget.redactions,
      limited: false,
      limit: null,
    });
  } catch (error) {
    const limit = error instanceof RedactionLimitError ? error.limit : "redactionFailure";
    return Object.freeze({
      value: REDACTION_LIMIT_PLACEHOLDER,
      redactions: budget.redactions,
      limited: true,
      limit,
    });
  }
}

function walkValue(value, state, budget, depth, ancestors) {
  consume(budget, "nodes", 1, state.limits.maxNodes);
  if (depth > state.limits.maxDepth) {
    throw new RedactionLimitError("maxDepth");
  }
  if (value === null || typeof value === "boolean") {
    consumeOutput(budget, String(value).length, state);
    return value;
  }
  if (typeof value === "string") {
    return redactString(value, state, budget);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new RedactionLimitError("unsupportedValue");
    }
    consumeOutput(budget, String(value).length, state);
    return Object.is(value, -0) ? 0 : value;
  }
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "object") {
    throw new RedactionLimitError("unsupportedValue");
  }
  if (ancestors.has(value)) {
    throw new RedactionLimitError("cyclicValue");
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => walkValue(item, state, budget, depth + 1, ancestors));
    }
    if (!isPlainRecord(value)) {
      throw new RedactionLimitError("unsupportedValue");
    }
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      consumeOutput(budget, key.length, state);
      if (state.sensitiveKeys.has(normalizeKey(key))) {
        result[key] = state.replacement;
        budget.redactions += item === state.replacement ? 0 : 1;
        consumeOutput(budget, state.replacement.length, state);
      } else {
        result[key] = walkValue(item, state, budget, depth + 1, ancestors);
      }
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}

function redactString(value, state, budget) {
  if (value.length > state.limits.maxStringLength) {
    throw new RedactionLimitError("maxStringLength");
  }
  if (value === state.replacement || value === REDACTION_LIMIT_PLACEHOLDER) {
    consumeOutput(budget, value.length, state);
    return value;
  }

  let result = value;
  for (const secret of state.secrets) {
    result = replaceLiteral(result, secret, state, budget);
  }

  if (!isAllowedByState(result, state)) {
    for (const detector of state.patterns) {
      const pattern = new RegExp(detector.source, detector.flags);
      result = result.replace(pattern, (...args) => {
        const match = args[0];
        consume(budget, "matches", 1, state.limits.maxMatches);
        if (
          match === state.replacement
          || match === REDACTION_LIMIT_PLACEHOLDER
          || isAllowedByState(match, state)
        ) {
          return match;
        }
        budget.redactions += 1;
        return state.replacement;
      });
    }
  }

  consumeOutput(budget, result.length, state);
  return result;
}

function replaceLiteral(value, secret, state, budget) {
  let cursor = 0;
  let index = value.indexOf(secret, cursor);
  if (index === -1) return value;
  const parts = [];
  while (index !== -1) {
    consume(budget, "matches", 1, state.limits.maxMatches);
    parts.push(value.slice(cursor, index), state.replacement);
    budget.redactions += 1;
    cursor = index + secret.length;
    index = value.indexOf(secret, cursor);
  }
  parts.push(value.slice(cursor));
  return parts.join("");
}

function isAllowedByState(value, state) {
  return state.identifierPatterns.some((detector) => {
    const pattern = detector.pattern
      ?? new RegExp(detector.source, detector.flags.replace("g", ""));
    pattern.lastIndex = 0;
    return pattern.test(value);
  });
}

function normalizeLimits(input) {
  if (input !== undefined) requirePlainRecord(input, "redaction limits");
  const result = {};
  for (const [name, fallback] of Object.entries(DEFAULT_LIMITS)) {
    const value = input?.[name] ?? fallback;
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new RedactionConfigurationError(`${name} must be a positive safe integer`);
    }
    result[name] = value;
  }
  for (const name of Object.keys(input || {})) {
    if (!Object.hasOwn(DEFAULT_LIMITS, name)) {
      throw new RedactionConfigurationError(`Unknown redaction limit '${name}'`);
    }
  }
  return Object.freeze(result);
}

function normalizeReplacement(value) {
  if (value === undefined) return REDACTION_PLACEHOLDER;
  if (typeof value !== "string" || value.length === 0 || value.length > 128) {
    throw new RedactionConfigurationError("replacement must be a string between 1 and 128 characters");
  }
  return value;
}

function normalizeSecrets(input, replacement) {
  if (input === undefined) return Object.freeze([]);
  if (!Array.isArray(input)) {
    throw new RedactionConfigurationError("secrets must be an array");
  }
  const values = [];
  for (const [index, value] of input.entries()) {
    if (typeof value !== "string" || value.length === 0) {
      throw new RedactionConfigurationError(`secrets[${index}] must be a non-empty string`);
    }
    if (value === replacement || value === REDACTION_LIMIT_PLACEHOLDER) {
      throw new RedactionConfigurationError(`secrets[${index}] conflicts with a redaction placeholder`);
    }
    values.push(value);
  }
  return Object.freeze([...new Set(values)].sort((left, right) => right.length - left.length));
}

function normalizeSensitiveKeys(input) {
  if (input !== undefined && !Array.isArray(input)) {
    throw new RedactionConfigurationError("sensitiveKeys must be an array");
  }
  const values = [...DEFAULT_SENSITIVE_KEYS, ...(input ?? [])];
  return [...new Set(values.map((value, index) => {
    if (typeof value !== "string" || value.trim() === "") {
      throw new RedactionConfigurationError(`sensitiveKeys[${index}] must be a non-empty string`);
    }
    return normalizeKey(value);
  }))];
}

function normalizePatterns(input, label, limits) {
  if (input === undefined) return Object.freeze([]);
  if (!Array.isArray(input)) {
    throw new RedactionConfigurationError(`${label} must be an array`);
  }
  return Object.freeze(input.map((entry, index) => {
    let name = `${label}[${index}]`;
    let pattern = entry;
    if (isPlainRecord(entry)) {
      name = typeof entry.name === "string" && entry.name.trim() !== "" ? entry.name.trim() : name;
      pattern = entry.pattern;
    }
    const source = pattern instanceof RegExp ? pattern.source : pattern;
    const inputFlags = pattern instanceof RegExp ? pattern.flags : "u";
    if (typeof source !== "string" || source.length === 0 || source.length > limits.maxPatternLength) {
      throw new RedactionConfigurationError(
        `${label}[${index}] pattern must contain 1-${limits.maxPatternLength} characters`,
      );
    }
    const flags = normalizeFlags(inputFlags, `${label}[${index}]`);
    let compiled;
    try {
      compiled = new RegExp(source, flags.replace("g", ""));
    } catch (error) {
      throw new RedactionConfigurationError(`${label}[${index}] is not a valid regular expression`);
    }
    if (compiled.test("")) {
      throw new RedactionConfigurationError(`${label}[${index}] must not match an empty string`);
    }
    return Object.freeze({ name, source, flags });
  }));
}

function normalizeFlags(flags, label) {
  const values = new Set();
  for (const flag of flags) {
    if (!["g", "i", "m", "s", "u"].includes(flag)) {
      throw new RedactionConfigurationError(`${label} uses unsupported regular-expression flag '${flag}'`);
    }
    values.add(flag);
  }
  values.delete("g");
  values.add("g");
  return [...values].sort().join("");
}

function consume(budget, field, amount, limit) {
  budget[field] += amount;
  if (budget[field] > limit) {
    throw new RedactionLimitError(
      field === "nodes" ? "maxNodes" : field === "matches" ? "maxMatches" : field,
    );
  }
}

function consumeOutput(budget, amount, state) {
  consume(budget, "outputChars", amount, state.limits.maxOutputChars);
}

function requirePolicy(policy) {
  const state = POLICY_STATE.get(policy);
  if (!state) {
    throw new RedactionConfigurationError("policy must be created with createRedactionPolicy");
  }
  return state;
}

function normalizeKey(value) {
  return value.replace(/[^a-z0-9]/giu, "").toLowerCase();
}

function requirePlainRecord(value, label) {
  if (!isPlainRecord(value)) {
    throw new RedactionConfigurationError(`${label} must be a plain object`);
  }
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
