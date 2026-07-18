import assert from "node:assert/strict";
import test from "node:test";

import {
  REDACTION_LIMIT_PLACEHOLDER,
  REDACTION_PLACEHOLDER,
  createRedactionPolicy,
  createOperationalRedactionPolicy,
  isAllowedIdentifier,
  redactText,
  redactValue,
  redactValueWithMetadata,
} from "../../lib/observability/redaction.mjs";

test("recursive redaction is immutable, idempotent, and preserves approved identifiers", () => {
  const policy = createRedactionPolicy({
    secrets: ["sk_live_very-secret"],
    piiPatterns: [{ name: "email", pattern: /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/iu }],
    secretPatterns: [{ name: "high_entropy", pattern: /[A-Za-z0-9_-]{20,}/u }],
  });
  const sha = "a".repeat(64);
  const uuid = "123e4567-e89b-12d3-a456-426614174000";
  const correlationId = `corr-${uuid}`;
  const actionId = "AUT-ACT-20260718112254904-6a4356";
  const source = {
    contact: "owner@example.com",
    nested: [{ password: "do-not-persist", note: "uses sk_live_very-secret" }],
    sha,
    uuid,
    correlation_id: correlationId,
    authorization_receipt: actionId,
  };

  const result = redactValue(source, policy);
  assert.deepEqual(result, {
    contact: REDACTION_PLACEHOLDER,
    nested: [{ password: REDACTION_PLACEHOLDER, note: `uses ${REDACTION_PLACEHOLDER}` }],
    sha,
    uuid,
    correlation_id: correlationId,
    authorization_receipt: actionId,
  });
  assert.equal(source.contact, "owner@example.com");
  assert.equal(source.nested[0].password, "do-not-persist");
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.nested[0]), true);
  assert.deepEqual(redactValue(result, policy), result);
  assert.equal(isAllowedIdentifier(sha, policy), true);
  assert.equal(isAllowedIdentifier(uuid, policy), true);
  assert.equal(isAllowedIdentifier(correlationId, policy), true);
  assert.equal(isAllowedIdentifier(actionId, policy), true);
});

test("explicit secrets and sensitive keys take precedence over identifier allowlisting", () => {
  const actionId = "AUT-ACT-20260718112254904-6a4356";
  const policy = createRedactionPolicy({ secrets: [actionId] });

  assert.equal(redactText(actionId, policy), REDACTION_PLACEHOLDER);
  assert.deepEqual(redactValue({ token: "a".repeat(64) }, policy), {
    token: REDACTION_PLACEHOLDER,
  });
});

test("operational credential context overrides SHA-shaped identifier allowlisting", () => {
  const shaShapedSecret = "a".repeat(64);
  const policy = createOperationalRedactionPolicy();

  assert.equal(redactText(shaShapedSecret, policy), shaShapedSecret);
  assert.equal(redactText(`token=${shaShapedSecret}`, policy), REDACTION_PLACEHOLDER);
  assert.equal(redactText(`Bearer ${shaShapedSecret}`, policy), REDACTION_PLACEHOLDER);
});

test("redaction limits and cycles fail closed without retaining partial values", () => {
  const depthPolicy = createRedactionPolicy({ limits: { maxDepth: 2 } });
  const result = redactValueWithMetadata({ a: { b: { c: "must-not-leak" } } }, depthPolicy);
  assert.deepEqual(result, {
    value: REDACTION_LIMIT_PLACEHOLDER,
    redactions: 0,
    limited: true,
    limit: "maxDepth",
  });

  const cycle = { safe: "prefix", secret: "must-not-leak" };
  cycle.self = cycle;
  assert.equal(redactValue(cycle), REDACTION_LIMIT_PLACEHOLDER);

  const throwingGetter = {};
  Object.defineProperty(throwingGetter, "value", {
    enumerable: true,
    get() {
      throw new Error("raw getter failure");
    },
  });
  assert.deepEqual(redactValueWithMetadata(throwingGetter), {
    value: REDACTION_LIMIT_PLACEHOLDER,
    redactions: 0,
    limited: true,
    limit: "redactionFailure",
  });

  const stringPolicy = createRedactionPolicy({ limits: { maxStringLength: 4 } });
  assert.equal(redactText("12345", stringPolicy), REDACTION_LIMIT_PLACEHOLDER);
});

test("policy construction rejects unsafe or unbounded configuration", () => {
  assert.throws(
    () => createRedactionPolicy({ piiPatterns: [/(?:)/u] }),
    /must not match an empty string/u,
  );
  assert.throws(
    () => createRedactionPolicy({ limits: { unknown: 10 } }),
    /Unknown redaction limit/u,
  );
  assert.throws(
    () => createRedactionPolicy({ secrets: [REDACTION_PLACEHOLDER] }),
    /conflicts with a redaction placeholder/u,
  );
});
