const POLICY_STATE = new WeakMap();
const OPERATIONAL_CREDENTIAL_ASSIGNMENTS = Symbol("operationalCredentialAssignments");

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
const CUSTOM_PATTERN_MAX_REPETITION = 256;

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

export const BUILTIN_OPERATIONAL_SECRET_PATTERNS = Object.freeze([
  Object.freeze({ name: "common_access_token", pattern: /\b(?:AKIA[A-Z0-9]{16}|gh[opsur]_[A-Za-z0-9_]{20,262144}|github_pat_[A-Za-z0-9_]{20,262144}|glpat-[A-Za-z0-9_-]{20,262144}|sk-(?:proj-)?[A-Za-z0-9_-]{20,262144}|sk_(?:live|test)_[A-Za-z0-9_-]{16,262144}|xox[baprs]-[A-Za-z0-9-]{16,262144})\b/gu }),
  Object.freeze({ name: "bearer_credential", pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,262144}/giu }),
  Object.freeze({ name: "basic_credential", pattern: /\bBasic\s+[A-Za-z0-9+/]{8,262144}={0,2}/giu }),
  Object.freeze({ name: "json_web_token", pattern: /\beyJ[A-Za-z0-9_-]{5,4096}\.[A-Za-z0-9_-]{5,131072}\.[A-Za-z0-9_-]{10,8192}\b/gu }),
  Object.freeze({ name: "cookie_header", pattern: /\b(?:Set-Cookie|Cookie)\s*:\s*[^\r\n]{1,262144}/giu }),
  Object.freeze({ name: "url_userinfo", pattern: /\b[a-z][a-z0-9+.-]{0,20}:\/\/[^/\s:?#]{0,262144}:[^/\s?#]{0,262144}@/giu }),
  Object.freeze({ name: "private_key_block", pattern: /-----BEGIN [A-Z ]{0,32}PRIVATE KEY-----[\s\S]{0,262144}?(?:-----END [A-Z ]{0,32}PRIVATE KEY-----|$)/gu }),
]);

export const BUILTIN_OPERATIONAL_PII_PATTERNS = Object.freeze([
  // Email fields are deliberately bounded. The common unbounded form using
  // three `+` quantifiers can become quadratic on a long non-email string.
  Object.freeze({ name: "email", pattern: /\b[^\s@]{1,64}@[^\s@]{1,189}\.[^\s@]{1,63}\b/giu }),
]);

const CREDENTIAL_ASSIGNMENT_PREFIX_PATTERN = /(?:["'](?=[A-Za-z0-9_])|\b)[A-Za-z0-9_]{0,128}(?:access[_-]?token|api[_-]?key|authorization|client[_-]?secret|password|private[_-]?key|refresh[_-]?token|secret[_-]?access[_-]?key|secret[_-]?key|secret|storage[_-]?account[_-]?key|token)["']?\s*[:=]\s*/giu;

// Built-in detectors are immutable, reviewed source code. User-provided
// patterns are deliberately held to a narrower, provably bounded grammar so a
// project configuration cannot introduce catastrophic regexp backtracking on
// the CLI or Observatory event loop.
const TRUSTED_BUILTIN_PATTERNS = new WeakSet([
  ...BUILTIN_IDENTIFIER_PATTERNS,
  ...BUILTIN_OPERATIONAL_SECRET_PATTERNS,
  ...BUILTIN_OPERATIONAL_PII_PATTERNS,
]);
const AUDITED_MULTI_QUANTIFIER_PATTERN_SOURCES = new Set([
  ...BUILTIN_IDENTIFIER_PATTERNS,
  ...BUILTIN_OPERATIONAL_SECRET_PATTERNS,
  ...BUILTIN_OPERATIONAL_PII_PATTERNS,
].map((entry) => entry.pattern.source));

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
    credentialAssignments: options[OPERATIONAL_CREDENTIAL_ASSIGNMENTS] === true,
  }));
  return publicPolicy;
}

export const DEFAULT_REDACTION_POLICY = createRedactionPolicy();

export function createOperationalRedactionPolicy(options = {}) {
  requirePlainRecord(options, "operational redaction options");
  const secretPatterns = options.secretPatterns ?? [];
  const piiPatterns = options.piiPatterns ?? [];
  if (!Array.isArray(secretPatterns) || !Array.isArray(piiPatterns)) {
    throw new RedactionConfigurationError("operational detector patterns must be arrays");
  }
  return createRedactionPolicy({
    ...options,
    [OPERATIONAL_CREDENTIAL_ASSIGNMENTS]: true,
    secretPatterns: [...BUILTIN_OPERATIONAL_SECRET_PATTERNS, ...secretPatterns],
    piiPatterns: [...BUILTIN_OPERATIONAL_PII_PATTERNS, ...piiPatterns],
  });
}

export const DEFAULT_OPERATIONAL_REDACTION_POLICY = createOperationalRedactionPolicy();

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
  const state = requirePolicy(policy);
  const budget = {
    nodes: 1,
    outputChars: 0,
    matches: 0,
    redactions: 0,
  };
  try {
    return redactString(value, state, budget);
  } catch {
    return REDACTION_LIMIT_PLACEHOLDER;
  }
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
      const redactedKey = redactString(key, state, budget);
      const presentedKey = uniquePresentedKey(result, redactedKey, state, budget);
      let presented;
      if (state.sensitiveKeys.has(normalizeKey(key))) {
        presented = state.replacement;
        budget.redactions += item === state.replacement ? 0 : 1;
        consumeOutput(budget, state.replacement.length, state);
      } else {
        presented = walkValue(item, state, budget, depth + 1, ancestors);
      }
      // Assignment to the special __proto__ key mutates an ordinary object's
      // prototype instead of creating data. Define every key explicitly so
      // attacker-controlled JSON remains an inert, own enumerable property.
      Object.defineProperty(result, presentedKey, {
        value: presented,
        enumerable: true,
        configurable: true,
        writable: true,
      });
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
  if (state.credentialAssignments) {
    result = replaceCredentialAssignments(result, state, budget);
  }

  // Explicit secret/PII detectors and credential detectors are authoritative.
  // Identifier allowlists are for classification/introspection and can never
  // neutralize an explicit privacy rule or a known credential shape.
  for (const detector of state.patterns) {
    const pattern = detector.pattern;
    pattern.lastIndex = 0;
    result = result.replace(pattern, (...args) => {
      const match = args[0];
      consume(budget, "matches", 1, state.limits.maxMatches);
      if (match === state.replacement || match === REDACTION_LIMIT_PLACEHOLDER) {
        return match;
      }
      budget.redactions += 1;
      return state.replacement;
    });
  }

  consumeOutput(budget, result.length, state);
  return result;
}

function replaceCredentialAssignments(value, state, budget) {
  const pattern = CREDENTIAL_ASSIGNMENT_PREFIX_PATTERN;
  pattern.lastIndex = 0;
  const parts = [];
  let cursor = 0;
  let match;
  while ((match = pattern.exec(value)) !== null) {
    if (match.index < cursor) continue;
    const valueStart = pattern.lastIndex;
    const end = credentialAssignmentEnd(value, valueStart);
    consume(budget, "matches", 1, state.limits.maxMatches);
    parts.push(value.slice(cursor, match.index), state.replacement);
    budget.redactions += 1;
    cursor = end;
    pattern.lastIndex = Math.max(pattern.lastIndex, end);
  }
  if (parts.length === 0) return value;
  parts.push(value.slice(cursor));
  return parts.join("");
}

function credentialAssignmentEnd(value, start) {
  const quote = value[start];
  if (quote === "\"" || quote === "'") {
    let escaped = false;
    for (let index = start + 1; index < value.length; index += 1) {
      const character = value[index];
      if (character === "\r" || character === "\n") return index;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === "\\") {
        escaped = true;
        continue;
      }
      if (character === quote) return index + 1;
    }
    return value.length;
  }
  let end = start;
  while (end < value.length && value[end] !== "\r" && value[end] !== "\n") end += 1;
  return end;
}

function uniquePresentedKey(target, candidate, state, budget) {
  if (!Object.hasOwn(target, candidate)) return candidate;
  let index = 2;
  let unique = `${candidate}#${index}`;
  while (Object.hasOwn(target, unique)) {
    index += 1;
    unique = `${candidate}#${index}`;
  }
  consumeOutput(budget, unique.length - candidate.length, state);
  return unique;
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
    if (name.length > 128) {
      throw new RedactionConfigurationError(`${label}[${index}] name must not exceed 128 characters`);
    }
    const source = pattern instanceof RegExp ? pattern.source : pattern;
    const inputFlags = pattern instanceof RegExp ? pattern.flags : "u";
    if (typeof source !== "string" || source.length === 0 || source.length > limits.maxPatternLength) {
      throw new RedactionConfigurationError(
        `${label}[${index}] pattern must contain 1-${limits.maxPatternLength} characters`,
      );
    }
    assertSafePatternSource(source, `${label}[${index}]`, {
      trustedBuiltin: (
        (isPlainRecord(entry) && TRUSTED_BUILTIN_PATTERNS.has(entry))
        || AUDITED_MULTI_QUANTIFIER_PATTERN_SOURCES.has(source)
      ),
    });
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
    return Object.freeze({ name, source, flags, pattern: new RegExp(source, flags) });
  }));
}

function assertSafePatternSource(source, label, { trustedBuiltin = false } = {}) {
  if (/\\(?:[1-9]|k<)/u.test(source)) {
    throw new RedactionConfigurationError(`${label} uses unsupported regular-expression backreferences`);
  }
  if (/\(\?(?!:)/u.test(source)) {
    throw new RedactionConfigurationError(`${label} uses unsupported regular-expression assertions or groups`);
  }

  const groups = [];
  let variableQuantifiers = 0;
  let escaped = false;
  let inClass = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (inClass) {
      if (character === "]") inClass = false;
      continue;
    }
    if (character === "[") {
      inClass = true;
      continue;
    }
    if (character === "(") {
      groups.push({ hasAlternation: false, hasQuantifier: false });
      if (source.startsWith("(?:", index)) index += 2;
      continue;
    }
    if (character === "|") {
      if (groups.length > 0) groups.at(-1).hasAlternation = true;
      continue;
    }
    if (character === ")") {
      const group = groups.pop();
      if (!group) continue;
      const quantifierLength = regexQuantifierLength(source, index + 1);
      if (quantifierLength > 0) {
        const quantifier = source
          .slice(index + 1, index + 1 + quantifierLength)
          .replace(/\?$/u, "");
        if (!trustedBuiltin) assertCustomQuantifier(quantifier, label);
        if (isVariableQuantifier(quantifier)) variableQuantifiers += 1;
      }
      if (quantifierLength > 0 && (group.hasAlternation || group.hasQuantifier)) {
        throw new RedactionConfigurationError(
          `${label} contains a nested or ambiguous quantified group`,
        );
      }
      if (groups.length > 0 && (group.hasQuantifier || quantifierLength > 0)) {
        groups.at(-1).hasQuantifier = true;
      }
      if (quantifierLength > 0) index += quantifierLength;
      continue;
    }
    const quantifierLength = regexQuantifierLength(source, index);
    if (quantifierLength > 0) {
      const quantifier = source.slice(index, index + quantifierLength).replace(/\?$/u, "");
      if (!trustedBuiltin) assertCustomQuantifier(quantifier, label);
      if (isVariableQuantifier(quantifier)) variableQuantifiers += 1;
      if (groups.length > 0) groups.at(-1).hasQuantifier = true;
      index += quantifierLength - 1;
    }
  }

  if (!trustedBuiltin && variableQuantifiers > 1) {
    throw new RedactionConfigurationError(
      `${label} contains multiple variable quantifiers; use fixed-width fields or separate detectors`,
    );
  }
}

function assertCustomQuantifier(value, label) {
  if (value === "*" || value === "+" || /^\{\d+,\}$/u.test(value)) {
    throw new RedactionConfigurationError(
      `${label} contains an unbounded quantifier; configure an explicit maximum`,
    );
  }
  const match = value.match(/^\{(\d+)(?:,(\d+))?\}$/u);
  const maximum = match ? Number(match[2] ?? match[1]) : value === "?" ? 1 : null;
  if (maximum !== null && maximum > CUSTOM_PATTERN_MAX_REPETITION) {
    throw new RedactionConfigurationError(
      `${label} repetition exceeds the safe maximum (${CUSTOM_PATTERN_MAX_REPETITION})`,
    );
  }
}

function isVariableQuantifier(value) {
  if (value === "*" || value === "+" || value === "?") return true;
  const match = value.match(/^\{(\d+)(?:,(\d*))?\}$/u);
  if (!match || match[2] === undefined) return false;
  if (match[2] === "") return true;
  const minimum = Number(match[1]);
  const maximum = Number(match[2]);
  return minimum !== maximum;
}

function regexQuantifierLength(source, index) {
  const character = source[index];
  if (character === "*" || character === "+" || character === "?") {
    return source[index + 1] === "?" ? 2 : 1;
  }
  if (character !== "{") return 0;
  const match = source.slice(index).match(/^\{\d+(?:,\d*)?\}\??/u);
  return match?.[0].length ?? 0;
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
