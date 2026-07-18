import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  openCanonicalQuerySession,
} from "../../lib/canonical-query-session.mjs";
import { immutableJson } from "../../lib/canonical.mjs";
import {
  CanonicalStoreError,
  openCanonicalStore,
} from "../../lib/canonical-store.mjs";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "canonical-query-session-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
  const write = (relativePath, content) => {
    const filePath = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
    return filePath;
  };

  write(".sdlc/project.json", '{"project_id":"fixture"}\n');
  write(".sdlc/contracts/CONTRACT-1.json", '{"id":"CONTRACT-1","status":"approved"}\n');
  write(".sdlc/stories/ST-2/story.json", '{"id":"ST-2","title":"Second","status":"draft"}\n');
  write(".sdlc/stories/ST-1/story.json", '{"id":"ST-1","title":"First","status":"ready"}\n');
  write(".sdlc/stories/ST-1/claim.json", '{"story_id":"ST-1","status":"active"}\n');
  write(".sdlc/traces/ST-1.jsonl", [
    '{"id":"TR-1","story_id":"ST-1","type":"decision","summary":"one"}',
    "{broken",
    '"not-an-object"',
    '{"id":"TR-2","story_id":"ST-1","type":"test","outcome":"passed"}',
    "",
  ].join("\n"));
  write(".sdlc/traces/project.jsonl", '{"id":"TR-P","type":"decision"}\n');
  write(".sdlc/cache/kb-cache.json", '{"derived":true}\n');
  write(".sdlc/indexes/kb-index.json", '{"derived":true}\n');
  return { root, write };
}

test("builds one deterministic catalog and serves orchestration, report, trace, and source queries from it", (t) => {
  const { root } = fixture(t);
  const events = [];
  const session = openCanonicalQuerySession({ root, onMetric: (event) => events.push(event) });

  const firstCatalog = session.catalog();
  const secondCatalog = session.catalog();
  assert.strictEqual(firstCatalog, secondCatalog);
  assert.equal(firstCatalog.generation, 1);
  assert.deepEqual(
    firstCatalog.derived_files.map((file) => file.path),
    [".sdlc/cache/kb-cache.json", ".sdlc/indexes/kb-index.json"],
  );
  assert.equal(firstCatalog.files.some((file) => file.derived), false);
  assert.deepEqual(
    session.listFiles({ under: "stories", extensions: ["json"], names: ["story.json"] })
      .map((file) => file.path),
    [".sdlc/stories/ST-1/story.json", ".sdlc/stories/ST-2/story.json"],
  );
  assert.deepEqual(
    session.listFiles({ under: ".sdlc/cache", includeDerived: true }).map((file) => file.path),
    [".sdlc/cache/kb-cache.json"],
  );

  const stories = session.stories();
  assert.deepEqual(stories.map((story) => story.id), ["ST-1", "ST-2"]);
  assert.ok(Object.isFrozen(stories));
  assert.ok(Object.isFrozen(stories[0]));

  const traceEvents = session.traceEvents({ storyId: "ST-1" });
  assert.deepEqual(traceEvents.map((event) => event.type), ["decision", "invalid", "invalid", "test"]);
  assert.deepEqual(traceEvents[0].source, { path: ".sdlc/traces/ST-1.jsonl", line: 1 });
  assert.equal(traceEvents[1].error.code, "invalid_json");
  assert.equal(traceEvents[2].error.code, "invalid_record");
  assert.deepEqual(
    session.traceEvents({ storyId: "ST-1", includeInvalid: false }).map((event) => event.id),
    ["TR-1", "TR-2"],
  );

  const snapshot = session.sourceSnapshot({
    under: ["contracts", "stories", "traces"],
    extensions: [".json", ".jsonl"],
    exclude: ["stories/ST-1/claim.json"],
  });
  assert.deepEqual(snapshot.source_paths, [
    ".sdlc/contracts/CONTRACT-1.json",
    ".sdlc/stories/ST-1/story.json",
    ".sdlc/stories/ST-2/story.json",
    ".sdlc/traces/ST-1.jsonl",
    ".sdlc/traces/project.jsonl",
  ]);
  assert.equal(
    snapshot.source_hashes[".sdlc/contracts/CONTRACT-1.json"],
    crypto.createHash("sha256").update('{"id":"CONTRACT-1","status":"approved"}\n').digest("hex"),
  );
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.source_hashes));

  const metrics = session.metrics();
  assert.equal(metrics.catalog_builds, 1);
  assert.ok(metrics.catalog_reuses >= 5);
  assert.equal(metrics.store.walk_calls, 1);
  assert.equal(events.filter((event) => event.type === "catalog_build").length, 1);
  assert.throws(() => { firstCatalog.files.push("mutate"); }, TypeError);
  assert.throws(() => { metrics.catalog_builds = 99; }, TypeError);
});

test("memoizes parsed content by canonical hash and still detects external file changes", (t) => {
  const { root, write } = fixture(t);
  const session = openCanonicalQuerySession({ root });
  const storyPath = ".sdlc/stories/ST-1/story.json";

  const first = session.readJson(storyPath);
  const second = session.readJson("stories/ST-1/story.json");
  assert.strictEqual(first, second);
  assert.equal(session.metrics().json_parses, 1);
  assert.throws(() => { first.title = "mutated"; }, TypeError);

  write(storyPath, '{"id":"ST-1","title":"First, externally changed","status":"ready"}\n');
  const changed = session.readJson(storyPath);
  assert.equal(changed.title, "First, externally changed");
  assert.notStrictEqual(changed, first);
  assert.equal(session.metrics().json_parses, 2);
  assert.equal(session.metrics().store.cache_stale, 1);

  const traceFirst = session.readJsonLines("traces/ST-1.jsonl");
  const traceSecond = session.readJsonLines(".sdlc/traces/ST-1.jsonl");
  assert.strictEqual(traceFirst, traceSecond);
  assert.ok(session.metrics().parsed_cache_hits >= 2);
});

test("parses each canonical snapshot with one read and one post-parse integrity check", (t) => {
  const { root } = fixture(t);
  const session = openCanonicalQuerySession({ root });

  session.readJson("stories/ST-1/story.json");
  session.readJson("stories/ST-1/story.json");
  session.readJsonLines("traces/ST-1.jsonl");
  session.readJsonLines("traces/ST-1.jsonl");

  const metrics = session.metrics().store;
  assert.equal(metrics.physical_reads, 2);
  assert.equal(metrics.hash_calls, 6);
  assert.equal(metrics.cache_hits, 4);
  assert.equal(metrics.read_json_calls, 1);
  assert.equal(metrics.read_text_calls, 1);
  assert.equal(metrics.json_parses, 1);
});

test("canonicalizes parsed JSON without changing immutable JSON semantics", (t) => {
  const { root, write } = fixture(t);
  const objectJson = '{"z":1,"é":2,"10":"ten","2":"two","__proto__":{"polluted":true},"negativeZero":-0,"array":[{"b":2,"a":1}]}';
  const linesJson = `${objectJson}\n[3,{"d":4,"c":3}]\n`;
  write(".sdlc/contracts/CANONICAL.json", `${objectJson}\n`);
  write(".sdlc/contracts/NONFINITE.json", "1e400\n");
  write(".sdlc/traces/canonical.jsonl", linesJson);
  const session = openCanonicalQuerySession({ root });

  const expectedObject = immutableJson(JSON.parse(objectJson));
  const actualObject = session.readJson("contracts/CANONICAL.json");
  assert.deepEqual(actualObject, expectedObject);
  assert.notStrictEqual(actualObject, expectedObject);
  assert.notStrictEqual(actualObject.array, expectedObject.array);
  assert.deepEqual(Object.keys(actualObject), Object.keys(expectedObject));
  assert.equal(Object.getPrototypeOf(actualObject), Object.prototype);
  assert.equal(Object.hasOwn(actualObject, "__proto__"), true);
  assert.equal(Object.is(actualObject.negativeZero, -0), false);
  assert.ok(Object.isFrozen(actualObject));
  assert.ok(Object.isFrozen(actualObject.__proto__));
  assert.ok(Object.isFrozen(actualObject.array));
  assert.ok(Object.isFrozen(actualObject.array[0]));

  const actualLines = session.readJsonLines("traces/canonical.jsonl");
  assert.deepEqual(actualLines.map((record) => record.value), [
    immutableJson(JSON.parse(objectJson)),
    immutableJson(JSON.parse('[3,{"d":4,"c":3}]')),
  ]);
  assert.throws(
    () => session.readJson("contracts/NONFINITE.json"),
    /does not support non-finite numbers/u,
  );
});

test("canonical parsed JSON creates own properties without invoking inherited setters", (t) => {
  const { root, write } = fixture(t);
  const key = "canonicalQueryInheritedSetter";
  const previousDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, key);
  let setterCalls = 0;
  Object.defineProperty(Object.prototype, key, {
    configurable: true,
    set() {
      setterCalls += 1;
    },
  });
  t.after(() => {
    if (previousDescriptor) {
      Object.defineProperty(Object.prototype, key, previousDescriptor);
    } else {
      delete Object.prototype[key];
    }
  });
  write(".sdlc/contracts/INHERITED-SETTER.json", `{"${key}":"kept"}\n`);

  const session = openCanonicalQuerySession({ root });
  const actual = session.readJson("contracts/INHERITED-SETTER.json");

  assert.equal(setterCalls, 0);
  assert.equal(Object.hasOwn(actual, key), true);
  assert.equal(actual[key], "kept");
  assert.equal(Object.getPrototypeOf(actual), Object.prototype);
  assert.ok(Object.isFrozen(actual));
});

test("does not cache parsed JSON when its verified source changes during parsing", (t) => {
  const { root, write } = fixture(t);
  const sourcePath = ".sdlc/stories/ST-1/story.json";
  const baseStore = openCanonicalStore({ root });
  const store = {
    ...baseStore,
    snapshot(input) {
      const snapshot = baseStore.snapshot(input);
      return Object.freeze({
        ...snapshot,
        readJson() {
          const value = snapshot.readJson();
          write(sourcePath, '{"id":"ST-1","title":"Changed during parse","status":"ready"}\n');
          return value;
        },
      });
    },
  };
  const session = openCanonicalQuerySession({ root, store });

  assert.throws(
    () => session.readJson(sourcePath),
    (error) => error instanceof CanonicalStoreError && error.code === "source_changed",
  );
  assert.equal(session.metrics().parsed_cache_entries, 0);
});

test("fails closed when the source is replaced with byte-identical JSON during parsing", (t) => {
  const { root } = fixture(t);
  const sourcePath = ".sdlc/stories/ST-1/story.json";
  const absolute = path.join(root, sourcePath);
  const baseStore = openCanonicalStore({ root });
  const store = {
    ...baseStore,
    snapshot(input) {
      const snapshot = baseStore.snapshot(input);
      return Object.freeze({
        ...snapshot,
        readJson() {
          const value = snapshot.readJson();
          const replacement = `${absolute}.replacement`;
          fs.writeFileSync(replacement, fs.readFileSync(absolute));
          fs.unlinkSync(absolute);
          fs.renameSync(replacement, absolute);
          return value;
        },
      });
    },
  };
  const session = openCanonicalQuerySession({ root, store });

  assert.throws(
    () => session.readJson(sourcePath),
    (error) => error instanceof CanonicalStoreError && error.code === "source_changed",
  );
  assert.equal(session.metrics().parsed_cache_entries, 0);
});

test("keeps custom-store hash fallback and rejects a mismatched snapshot digest", (t) => {
  const { root } = fixture(t);
  const sourcePath = ".sdlc/stories/ST-1/story.json";
  const baseStore = openCanonicalStore({ root });
  let fallbackHashCalls = 0;
  const fallbackStore = {
    ...baseStore,
    hash(input) {
      fallbackHashCalls += 1;
      return baseStore.hash(input);
    },
    snapshot(input) {
      const { assertUnchanged: _ignored, ...snapshot } = baseStore.snapshot(input);
      return Object.freeze(snapshot);
    },
  };
  const fallbackSession = openCanonicalQuerySession({ root, store: fallbackStore });
  assert.equal(fallbackSession.readJson(sourcePath).id, "ST-1");
  assert.equal(fallbackHashCalls, 1);

  const mismatchStore = {
    ...baseStore,
    snapshot(input) {
      const snapshot = baseStore.snapshot(input);
      return Object.freeze({ ...snapshot, assertUnchanged: () => "0".repeat(64) });
    },
  };
  const mismatchSession = openCanonicalQuerySession({ root, store: mismatchStore });
  assert.throws(
    () => mismatchSession.readJson(sourcePath),
    (error) => error instanceof CanonicalStoreError && error.code === "source_changed",
  );
  assert.equal(mismatchSession.metrics().parsed_cache_entries, 0);
});

test("reads snapshot content only while its canonical hash remains stable", (t) => {
  const { root, write } = fixture(t);
  const session = openCanonicalQuerySession({ root });
  const storyPath = ".sdlc/stories/ST-1/story.json";
  const snapshot = session.sourceSnapshot({ under: [storyPath] });
  const expectedSha256 = snapshot.source_hashes[storyPath];

  assert.match(expectedSha256, /^[a-f0-9]{64}$/u);
  assert.match(session.readTextAtHash(storyPath, expectedSha256), /"id":"ST-1"/u);

  write(storyPath, '{"id":"ST-1","title":"Changed after snapshot","status":"ready"}\n');
  assert.throws(
    () => session.readTextAtHash(storyPath, expectedSha256),
    (error) => error instanceof CanonicalStoreError && error.code === "source_changed",
  );
});

test("classifies configured and mixed-case derived directories case-insensitively", (t) => {
  const { root, write } = fixture(t);
  write(".sdlc/CACHE/upper.json", '{"derived":true}\n');
  write(".sdlc/generated/trap.json", '{"derived":true}\n');
  const session = openCanonicalQuerySession({
    root,
    derivedDirectories: ["cache", "indexes", "generated"],
  });

  const catalog = session.catalog();
  const derivedPaths = catalog.derived_files.map((file) => file.path.toLowerCase());
  assert.ok(derivedPaths.some((filePath) => filePath.endsWith("/cache/upper.json")));
  assert.ok(derivedPaths.includes(".sdlc/generated/trap.json"));
  assert.equal(
    catalog.files.some((file) => [".sdlc/cache/", ".sdlc/indexes/", ".sdlc/generated/"]
      .some((prefix) => file.path.toLowerCase().startsWith(prefix))),
    false,
  );
});

test("supports direct-only canonical file queries", (t) => {
  const { root, write } = fixture(t);
  write(".sdlc/stories/ST-1/steps/design.json", '{"id":"STEP-DIRECT"}\n');
  write(".sdlc/stories/ST-1/steps/archive/ghost.json", '{"id":"STEP-NESTED"}\n');
  const session = openCanonicalQuerySession({ root });

  assert.deepEqual(
    session.listFiles({
      under: "stories/ST-1/steps",
      extensions: [".json"],
      recursive: false,
    }).map((file) => file.path),
    [".sdlc/stories/ST-1/steps/design.json"],
  );
});

test("explicit invalidation evicts matching parsed values and rebuilds topology exactly once", (t) => {
  const { root, write } = fixture(t);
  const session = openCanonicalQuerySession({ root });

  assert.deepEqual(session.stories().map((story) => story.id), ["ST-1", "ST-2"]);
  session.readJson("stories/ST-1/story.json");
  write(".sdlc/stories/ST-3/story.json", '{"id":"ST-3","title":"Third","status":"draft"}\n');

  assert.deepEqual(session.stories().map((story) => story.id), ["ST-1", "ST-2"]);
  const invalidation = session.invalidate("stories");
  assert.equal(invalidation.path, ".sdlc/stories");
  assert.equal(invalidation.index_invalidated, true);
  assert.ok(invalidation.parsed_entries_evicted >= 2);
  assert.deepEqual(session.stories().map((story) => story.id), ["ST-1", "ST-2", "ST-3"]);

  const metrics = session.metrics();
  assert.equal(metrics.catalog_builds, 2);
  assert.equal(metrics.catalog_generation, 2);
  assert.equal(metrics.store.walk_calls, 2);
  assert.equal(metrics.invalidations, 1);

  const full = session.invalidate();
  assert.equal(full.path, null);
  assert.equal(session.metrics().catalog_cached, false);
});

test("keeps malformed JSON policy explicit for bulk record consumers", (t) => {
  const { root, write } = fixture(t);
  write(".sdlc/contracts/BROKEN.json", "{broken\n");
  const session = openCanonicalQuerySession({ root });

  assert.throws(
    () => session.jsonRecords({ under: "contracts" }),
    (error) => error instanceof CanonicalStoreError && error.code === "invalid_json",
  );
  assert.deepEqual(
    session.jsonRecords({ under: "contracts", onInvalid: "skip" }).map((record) => record.path),
    [".sdlc/contracts/CONTRACT-1.json"],
  );
  const included = session.jsonRecords({ under: "contracts", onInvalid: "include" });
  assert.deepEqual(included.map((record) => [record.path, record.valid]), [
    [".sdlc/contracts/BROKEN.json", false],
    [".sdlc/contracts/CONTRACT-1.json", true],
  ]);
  assert.equal(included[0].error.code, "invalid_json");
  assert.throws(
    () => session.jsonRecords({ under: "contracts", onInvalid: "guess" }),
    /onInvalid must be throw, skip, or include/,
  );
});

test("enforces the project and canonical boundaries and refuses symbolic-link traversal", (t) => {
  const { root } = fixture(t);
  const session = openCanonicalQuerySession({ root });
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "canonical-query-outside-"));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true, maxRetries: 3 }));
  const secret = path.join(outside, "secret.json");
  fs.writeFileSync(secret, '{"secret":true}\n');

  assert.throws(
    () => session.readJson(secret),
    (error) => error instanceof CanonicalStoreError && error.code === "path_outside_root",
  );
  assert.throws(
    () => session.readJson("../project.json"),
    (error) => error instanceof CanonicalStoreError && error.code === "path_outside_canonical_root",
  );
  assert.throws(() => session.traceEvents({ storyId: "../ST-1" }), /safe record identifier/);

  const link = path.join(root, ".sdlc", "stories", "escape");
  try {
    fs.symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (process.platform === "win32" && ["EPERM", "EACCES"].includes(error?.code)) return;
    throw error;
  }
  assert.throws(
    () => session.readJson("stories/escape/secret.json"),
    (error) => error instanceof CanonicalStoreError && error.code === "symlink_forbidden",
  );

  const mismatchedStore = openCanonicalStore({ root: outside });
  assert.throws(
    () => openCanonicalQuerySession({ root, store: mismatchedStore }),
    /store root must match the session root/,
  );
});
