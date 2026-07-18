import assert from "node:assert/strict";
import test from "node:test";

import {
  createCorrelationId,
  createOperationContext,
  isValidCorrelationId,
  normalizeOperationalError,
} from "../../lib/observability/context.mjs";
import {
  REDACTION_LIMIT_PLACEHOLDER,
  REDACTION_PLACEHOLDER,
  createOperationalRedactionPolicy,
  createRedactionPolicy,
} from "../../lib/observability/redaction.mjs";

const UUID = "123e4567-e89b-12d3-a456-426614174000";
const CORRELATION_ID = `corr-${UUID}`;

test("operation contexts create and validate stable correlation identifiers", () => {
  const context = createOperationContext(
    { operation: "observatory.model.read" },
    {
      randomUUID: () => UUID,
      now: () => new Date("2026-07-18T10:00:00.000Z"),
    },
  );
  assert.deepEqual(context, {
    schema_version: "agentic-sdlc-operation-context:v1",
    operation: "observatory.model.read",
    correlation_id: CORRELATION_ID,
    started_at: "2026-07-18T10:00:00.000Z",
  });
  assert.equal(Object.isFrozen(context), true);
  assert.equal(createCorrelationId(() => UUID), CORRELATION_ID);
  assert.equal(isValidCorrelationId(CORRELATION_ID), true);
  assert.equal(isValidCorrelationId("request-123"), false);
});

test("operation contexts reject ambiguous operation and correlation identifiers", () => {
  assert.throws(
    () => createOperationContext({ operation: "Uppercase" }),
    (error) => error?.code === "operation_name_invalid",
  );
  assert.throws(
    () => createOperationContext({ operation: "cli.run", correlationId: "opaque-secret" }),
    (error) => error?.code === "correlation_id_invalid",
  );
  assert.throws(
    () => createCorrelationId(() => "not-a-uuid"),
    (error) => error?.code === "correlation_id_invalid",
  );
  assert.throws(
    () => createOperationContext({ operation: `github_pat_${"a".repeat(32)}` }),
    (error) => error?.code === "operation_name_invalid",
  );
});

test("operational error envelopes are stable, redacted, and omit stacks and causes", () => {
  const context = createOperationContext({
    operation: "cli.contract.validate",
    correlationId: CORRELATION_ID,
    startedAt: "2026-07-18T10:00:00.000Z",
  });
  const policy = createRedactionPolicy({
    secrets: ["supersecret"],
    piiPatterns: [/owner@example\.com/iu],
  });
  const error = new Error("Request for owner@example.com failed with supersecret", {
    cause: new Error("cause must not escape"),
  });
  error.code = "validation_failed";
  error.statusCode = 422;
  error.issues = [{ path: "credentials", password: "raw-password" }];

  const envelope = normalizeOperationalError(error, { context, redactionPolicy: policy });
  assert.deepEqual(envelope, {
    schema_version: "agentic-sdlc-operation-error:v1",
    ok: false,
    operation: "cli.contract.validate",
    correlation_id: CORRELATION_ID,
    error: {
      code: "validation_failed",
      message: `Request for ${REDACTION_PLACEHOLDER} failed with ${REDACTION_PLACEHOLDER}`,
      status: 422,
      retryable: false,
      details: [{ path: "credentials", password: REDACTION_PLACEHOLDER }],
      redaction_limited: false,
    },
  });
  assert.equal("stack" in envelope.error, false);
  assert.equal("cause" in envelope.error, false);
  assert.equal(error.issues[0].password, "raw-password");
  assert.equal(Object.isFrozen(envelope.error.details[0]), true);
});

test("error normalization masks unsafe codes and fails closed when a limit is reached", () => {
  const context = createOperationContext({
    operation: "cli.run",
    correlationId: CORRELATION_ID,
    startedAt: "2026-07-18T10:00:00.000Z",
  });
  const policy = createRedactionPolicy({
    secrets: ["secret_code"],
    limits: { maxStringLength: 8 },
  });
  const envelope = normalizeOperationalError(
    { code: "secret_code", message: "a message longer than eight", status: 503 },
    { context, redactionPolicy: policy },
  );

  assert.equal(envelope.error.code, "internal_error");
  assert.equal(envelope.error.status, 503);
  assert.equal(envelope.error.retryable, true);
  assert.equal(envelope.error.redaction_limited, true);
  assert.equal(envelope.error.details, REDACTION_LIMIT_PLACEHOLDER);
  assert.match(envelope.error.message, /sensitive details were withheld/u);
});

test("operational error normalization uses credential-safe defaults", () => {
  const context = createOperationContext({
    operation: "cli.run",
    correlationId: CORRELATION_ID,
    startedAt: "2026-07-18T10:00:00.000Z",
  });
  const token = `github_pat_${"A".repeat(32)}`;
  const envelope = normalizeOperationalError({
    message: `opener failed with ${token} for owner@example.com`,
    details: { authorization: token },
  }, { context });

  assert.equal(JSON.stringify(envelope).includes(token), false);
  assert.equal(JSON.stringify(envelope).includes("owner@example.com"), false);
  assert.match(envelope.error.message, /\[REDACTED\]/u);
  assert.throws(
    () => normalizeOperationalError({ message: "safe" }, {
      context: {
        ...context,
        operation: `github_pat_${"a".repeat(32)}`,
      },
    }),
    (error) => error?.code === "operation_name_invalid",
  );
});

test("project privacy patterns cannot invalidate fixed operation metadata", () => {
  const context = createOperationContext({
    operation: "cli.run",
    correlationId: "corr-123e4567-e89b-12d3-a456-426614174000",
    startedAt: "2026-07-18T10:00:00.000Z",
  });
  const policy = createOperationalRedactionPolicy({
    piiPatterns: [{ name: "operation_canary", pattern: "cli[.]run" }],
  });

  const normalized = normalizeOperationalError(
    { code: "user_error", message: "safe failure", statusCode: 400 },
    { context, redactionPolicy: policy },
  );
  assert.equal(normalized.operation, "cli.run");
  assert.equal(normalized.error.message, "safe failure");
});
