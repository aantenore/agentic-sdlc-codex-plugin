import test from "node:test";
import assert from "node:assert/strict";

import {
  ObservatoryApi,
  ObservatoryApiError,
} from "../../ui/change-observatory/api.js";
import { VIEW_MODEL_SCHEMA } from "../../ui/change-observatory/model.js";

const ETAG_ONE = '"sha256-revision-one"';
const ETAG_TWO = '"sha256-revision-two"';

function viewModel(name = "Cached project") {
  return {
    schemaVersion: VIEW_MODEL_SCHEMA,
    generatedAt: "2026-07-18T00:00:00.000Z",
    project: { id: "cached-project", name, branch: "codex/cache" },
    snapshots: { counts: {}, phaseCounts: {} },
    summary: { asked: [], changed: [], decided: [] },
    iterations: [],
    contracts: [],
    decisions: [],
    changes: [],
    verification: [],
    records: [],
    diagnostics: [],
  };
}

function jsonResponse(payload, { etag = ETAG_ONE } = {}) {
  const headers = { "content-type": "application/json" };
  if (etag) headers.etag = etag;
  return new Response(JSON.stringify(payload), { status: 200, headers });
}

test("revalidates an in-memory model with ETag and reuses its object on 304", async () => {
  const calls = [];
  const responses = [
    jsonResponse(viewModel()),
    new Response(null, { status: 304, headers: { etag: ETAG_ONE } }),
  ];
  const api = new ObservatoryApi({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return responses.shift();
    },
  });

  const first = await api.load();
  const second = await api.load();

  assert.strictEqual(second, first);
  assert.equal(calls[0].options.headers["If-None-Match"], undefined);
  assert.equal(calls[1].options.headers["If-None-Match"], ETAG_ONE);
  assert.deepEqual(calls.map(({ options }) => options.cache), ["no-store", "no-store"]);
});

test("keeps conditional caches isolated to each API client instance", async () => {
  const firstCalls = [];
  const firstApi = new ObservatoryApi({
    fetchImpl: async (_url, options) => {
      firstCalls.push(options);
      return jsonResponse(viewModel("First client"));
    },
  });
  const secondCalls = [];
  const secondApi = new ObservatoryApi({
    fetchImpl: async (_url, options) => {
      secondCalls.push(options);
      return jsonResponse(viewModel("Second client"), { etag: ETAG_TWO });
    },
  });

  await firstApi.load();
  await secondApi.load();

  assert.equal(firstCalls[0].headers["If-None-Match"], undefined);
  assert.equal(secondCalls[0].headers["If-None-Match"], undefined);
});

test("a late concurrent 200 resolves to the newer cached model", async () => {
  const calls = [];
  const olderResponse = deferred();
  const newerResponse = deferred();
  const api = new ObservatoryApi({
    fetchImpl: async (_url, options) => {
      calls.push(options);
      if (calls.length === 1) return olderResponse.promise;
      if (calls.length === 2) return newerResponse.promise;
      return new Response(null, { status: 304 });
    },
  });

  const olderLoad = api.load();
  const newerLoad = api.load();
  newerResponse.resolve(jsonResponse(viewModel("Revision two"), { etag: ETAG_TWO }));
  const newer = await newerLoad;
  olderResponse.resolve(jsonResponse(viewModel("Revision one"), { etag: ETAG_ONE }));
  const older = await olderLoad;
  const revalidated = await api.load();

  assert.strictEqual(older, newer);
  assert.equal(older.project.name, "Revision two");
  assert.equal(newer.project.name, "Revision two");
  assert.strictEqual(revalidated, newer);
  assert.equal(calls[2].headers["If-None-Match"], ETAG_TWO);
});

test("a late 304 resolves to a model committed by a concurrent 200", async () => {
  const calls = [];
  const lateNotModified = deferred();
  const newerResponse = deferred();
  const api = new ObservatoryApi({
    fetchImpl: async (_url, options) => {
      calls.push(options);
      if (calls.length === 1) return jsonResponse(viewModel("Revision one"));
      if (calls.length === 2) return lateNotModified.promise;
      if (calls.length === 3) return newerResponse.promise;
      return new Response(null, { status: 304 });
    },
  });

  const initial = await api.load();
  const staleRevalidation = api.load();
  const newerLoad = api.load();
  newerResponse.resolve(jsonResponse(viewModel("Revision two"), { etag: ETAG_TWO }));
  const newer = await newerLoad;
  lateNotModified.resolve(new Response(null, { status: 304 }));
  const revalidated = await staleRevalidation;
  const final = await api.load();

  assert.equal(initial.project.name, "Revision one");
  assert.strictEqual(revalidated, newer);
  assert.strictEqual(final, newer);
  assert.equal(calls[1].headers["If-None-Match"], ETAG_ONE);
  assert.equal(calls[2].headers["If-None-Match"], ETAG_ONE);
  assert.equal(calls[3].headers["If-None-Match"], ETAG_TWO);
});

test("a newer 304 prevents an older concurrent 200 from committing stale data", async () => {
  const calls = [];
  const olderResponse = deferred();
  const newerNotModified = deferred();
  const api = new ObservatoryApi({
    fetchImpl: async (_url, options) => {
      calls.push(options);
      if (calls.length === 1) return jsonResponse(viewModel("Revision one"));
      if (calls.length === 2) return olderResponse.promise;
      if (calls.length === 3) return newerNotModified.promise;
      return new Response(null, { status: 304 });
    },
  });

  const initial = await api.load();
  const olderLoad = api.load();
  const newerLoad = api.load();
  newerNotModified.resolve(new Response(null, { status: 304 }));
  const newer = await newerLoad;
  olderResponse.resolve(jsonResponse(viewModel("Obsolete revision"), { etag: ETAG_TWO }));
  const older = await olderLoad;
  const final = await api.load();

  assert.strictEqual(newer, initial);
  assert.strictEqual(older, initial);
  assert.strictEqual(final, initial);
  assert.equal(calls[1].headers["If-None-Match"], ETAG_ONE);
  assert.equal(calls[2].headers["If-None-Match"], ETAG_ONE);
  assert.equal(calls[3].headers["If-None-Match"], ETAG_ONE);
});

test("fails closed when the server returns 304 before this client has a cache", async () => {
  const api = new ObservatoryApi({
    fetchImpl: async () => new Response(null, { status: 304 }),
  });

  await assert.rejects(
    api.load(),
    (error) =>
      error instanceof ObservatoryApiError
      && error.status === 304
      && error.code === "NOT_MODIFIED_WITHOUT_CACHE",
  );
});

test("does not replace a good cache after malformed, aborted, or failed requests", async () => {
  const calls = [];
  const abort = new Error("cancelled");
  abort.name = "AbortError";
  const outcomes = [
    jsonResponse(viewModel()),
    new Response("not-json", {
      status: 200,
      headers: { "content-type": "application/json", etag: '"bad-json"' },
    }),
    jsonResponse({ schemaVersion: "change-observatory:view:v999" }, { etag: '"bad-schema"' }),
    abort,
    new Error("offline"),
    new Response(null, { status: 304 }),
  ];
  const api = new ObservatoryApi({
    fetchImpl: async (_url, options) => {
      calls.push(options);
      const outcome = outcomes.shift();
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
  });

  const cached = await api.load();
  await assert.rejects(
    api.load(),
    (error) => error instanceof ObservatoryApiError && error.code === "MALFORMED_VIEW_MODEL",
  );
  await assert.rejects(
    api.load(),
    (error) => error instanceof ObservatoryApiError && error.code === "UNSUPPORTED_VIEW_MODEL",
  );
  await assert.rejects(api.load(), (error) => error === abort);
  await assert.rejects(
    api.load(),
    (error) => error instanceof ObservatoryApiError && error.code === "API_UNAVAILABLE",
  );
  const revalidated = await api.load();

  assert.strictEqual(revalidated, cached);
  assert.deepEqual(
    calls.slice(1).map(({ headers }) => headers["If-None-Match"]),
    [ETAG_ONE, ETAG_ONE, ETAG_ONE, ETAG_ONE, ETAG_ONE],
  );
});

test("replaces the cached model only after a newer 200 response normalizes successfully", async () => {
  const calls = [];
  const responses = [
    jsonResponse(viewModel("Revision one")),
    jsonResponse(viewModel("Revision two"), { etag: ETAG_TWO }),
    new Response(null, { status: 304 }),
  ];
  const api = new ObservatoryApi({
    fetchImpl: async (_url, options) => {
      calls.push(options);
      return responses.shift();
    },
  });

  const first = await api.load();
  const second = await api.load();
  const third = await api.load();

  assert.notStrictEqual(second, first);
  assert.strictEqual(third, second);
  assert.equal(second.project.name, "Revision two");
  assert.equal(calls[1].headers["If-None-Match"], ETAG_ONE);
  assert.equal(calls[2].headers["If-None-Match"], ETAG_TWO);
});

test("drops an obsolete validator after a successful 200 without an ETag", async () => {
  const calls = [];
  const responses = [
    jsonResponse(viewModel("Validated")),
    jsonResponse(viewModel("Unvalidated"), { etag: null }),
    jsonResponse(viewModel("Next request"), { etag: ETAG_TWO }),
  ];
  const api = new ObservatoryApi({
    fetchImpl: async (_url, options) => {
      calls.push(options);
      return responses.shift();
    },
  });

  await api.load();
  await api.load();
  await api.load();

  assert.equal(calls[1].headers["If-None-Match"], ETAG_ONE);
  assert.equal(calls[2].headers["If-None-Match"], undefined);
});

function deferred() {
  let resolve;
  const promise = new Promise((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}
