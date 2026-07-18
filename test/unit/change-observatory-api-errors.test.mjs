import assert from "node:assert/strict";
import test from "node:test";

import {
  ObservatoryApi,
  ObservatoryApiError,
} from "../../ui/change-observatory/api.js";

const CORRELATION_ID = "corr-123e4567-e89b-12d3-a456-426614174000";
const OTHER_CORRELATION_ID = "corr-223e4567-e89b-12d3-a456-426614174000";

function errorEnvelope(overrides = {}) {
  return {
    schemaVersion: "change-observatory:error:v1",
    status: "error",
    correlationId: CORRELATION_ID,
    error: {
      code: "model_unavailable",
      message: "The project history is temporarily unavailable.",
      retryable: true,
    },
    ...overrides,
  };
}

async function captureRejection(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail("Expected the API request to reject");
}

test("accepts only the stable error envelope and correlates matching header/body IDs", async () => {
  const api = new ObservatoryApi({
    fetchImpl: async () => new Response(JSON.stringify(errorEnvelope()), {
      status: 503,
      headers: {
        "content-type": "application/json",
        "x-correlation-id": CORRELATION_ID.toUpperCase(),
      },
    }),
  });

  const error = await captureRejection(api.load());
  assert.equal(error instanceof ObservatoryApiError, true);
  assert.equal(error.status, 503);
  assert.equal(error.code, "model_unavailable");
  assert.equal(error.correlationId, CORRELATION_ID);
  assert.equal(error.message, "The project history is temporarily unavailable.");

  const bodyOnlyApi = new ObservatoryApi({
    fetchImpl: async () => new Response(JSON.stringify(errorEnvelope()), { status: 429 }),
  });
  const bodyOnlyError = await captureRejection(bodyOnlyApi.load());
  assert.equal(bodyOnlyError.code, "model_unavailable");
  assert.equal(bodyOnlyError.correlationId, CORRELATION_ID);
});

test("fails closed for malformed, unsafe, or correlation-inconsistent envelopes", async () => {
  const cases = [
    {
      name: "unsupported schema",
      envelope: errorEnvelope({ schemaVersion: "change-observatory:error:v2" }),
      header: CORRELATION_ID,
      expectedCorrelationId: CORRELATION_ID,
    },
    {
      name: "unsafe PII and assignment message",
      envelope: errorEnvelope({
        error: { code: "model_unavailable", message: 'owner@example.com {"password":"p@ssw0rd!"}', retryable: false },
      }),
      header: CORRELATION_ID,
      expectedCorrelationId: CORRELATION_ID,
    },
    {
      name: "unsafe JWT and cookie message",
      envelope: errorEnvelope({
        error: {
          code: "model_unavailable",
          message: `Cookie: session=secret ${[`eyJ${"H".repeat(20)}`, "P".repeat(32), "S".repeat(43)].join(".")}`,
          retryable: false,
        },
      }),
      header: CORRELATION_ID,
      expectedCorrelationId: CORRELATION_ID,
    },
    {
      name: "unexpected field",
      envelope: { ...errorEnvelope(), debug: "must not be trusted" },
      header: CORRELATION_ID,
      expectedCorrelationId: CORRELATION_ID,
    },
    {
      name: "mismatched correlation IDs",
      envelope: errorEnvelope(),
      header: OTHER_CORRELATION_ID,
      expectedCorrelationId: null,
    },
  ];

  for (const fixture of cases) {
    const api = new ObservatoryApi({
      fetchImpl: async () => new Response(JSON.stringify(fixture.envelope), {
        status: 500,
        headers: { "x-correlation-id": fixture.header },
      }),
    });
    const error = await captureRejection(api.load());
    assert.equal(error.code, "API_RESPONSE_ERROR", fixture.name);
    assert.equal(error.correlationId, fixture.expectedCorrelationId, fixture.name);
    assert.equal(error.message, "The observatory API returned HTTP 500.", fixture.name);
    assert.doesNotMatch(error.message, /owner@example\.com|p@ssw0rd|Cookie|eyJ|must not be trusted/u);
  }
});

test("bounds non-2xx response bodies at 64 KiB and cancels the stream without response.text", async () => {
  const chunks = [
    new Uint8Array(64 * 1024).fill(0x61),
    new Uint8Array([0x62]),
  ];
  let readCalls = 0;
  let cancelled = false;
  let released = false;
  let textCalled = false;
  const reader = {
    async read() {
      const value = chunks[readCalls];
      readCalls += 1;
      return value ? { done: false, value } : { done: true, value: undefined };
    },
    async cancel() {
      cancelled = true;
    },
    releaseLock() {
      released = true;
    },
  };
  const api = new ObservatoryApi({
    fetchImpl: async () => ({
      ok: false,
      status: 500,
      headers: new Headers({ "x-correlation-id": CORRELATION_ID }),
      body: { getReader: () => reader },
      async text() {
        textCalled = true;
        throw new Error("response.text() must not be used for error bodies");
      },
    }),
  });

  const error = await captureRejection(api.load());
  assert.equal(error.code, "API_RESPONSE_ERROR");
  assert.equal(error.correlationId, CORRELATION_ID);
  assert.equal(readCalls, 2);
  assert.equal(cancelled, true);
  assert.equal(released, true);
  assert.equal(textCalled, false);
});

test("streams and truncates raw previews without buffering an unbounded response", async () => {
  const chunks = [
    new Uint8Array(2_000_000).fill(0x61),
    new Uint8Array([0x62]),
  ];
  let readCalls = 0;
  let cancelled = false;
  let textCalled = false;
  const reader = {
    async read() {
      const value = chunks[readCalls];
      readCalls += 1;
      return value ? { done: false, value } : { done: true, value: undefined };
    },
    async cancel() {
      cancelled = true;
    },
    releaseLock() {},
  };
  const api = new ObservatoryApi({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "text/plain" }),
      body: { getReader: () => reader },
      async text() {
        textCalled = true;
        throw new Error("response.text() must not be used for raw bodies");
      },
    }),
  });

  const raw = await api.loadRaw("/api/v1/source?path=.sdlc%2Fproject.json");
  assert.equal(readCalls, 2);
  assert.equal(cancelled, true);
  assert.equal(textCalled, false);
  assert.match(raw, /Raw preview truncated at the 2,000,000-byte safety limit/u);
  assert.ok(raw.length < 2_000_100);
});
