import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CanonicalStoreError,
  openCanonicalStore,
} from "../../lib/canonical-store.mjs";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "canonical-store-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
  fs.mkdirSync(path.join(root, "nested"), { recursive: true });
  fs.writeFileSync(path.join(root, "alpha.txt"), "alpha\n");
  fs.writeFileSync(path.join(root, "nested", "data.json"), '{"value":1,"items":["a"]}\n');
  return root;
}

test("reuses bytes by deterministic project-relative key and reports command-scoped metrics", (t) => {
  const root = fixture(t);
  const events = [];
  const store = openCanonicalStore({ root, onMetric: (event) => events.push(event) });

  assert.equal(store.readText("alpha.txt"), "alpha\n");
  assert.equal(store.readText(path.join(root, "alpha.txt")), "alpha\n");
  assert.equal(
    store.hash("alpha.txt"),
    crypto.createHash("sha256").update("alpha\n").digest("hex"),
  );
  assert.equal(store.hash("alpha.txt"), store.hash(path.join(root, "alpha.txt")));

  const first = store.readJson("nested/data.json");
  first.items.push("mutated-by-caller");
  const second = store.readJson(path.join(root, "nested", "data.json"));
  assert.deepEqual(second, { value: 1, items: ["a"] });
  assert.notStrictEqual(first, second);

  const metrics = store.metrics();
  assert.equal(metrics.physical_reads, 2);
  assert.equal(metrics.cache_misses, 2);
  assert.equal(metrics.cache_hits, 5);
  assert.equal(metrics.hash_computations, 1);
  assert.equal(metrics.json_parses, 2);
  assert.equal(metrics.cache_entries, 2);
  assert.equal(events.filter((event) => event.type === "physical_read").length, 2);
  assert.ok(events.filter((event) => event.type === "cache_hit").every((event) => !path.isAbsolute(event.path)));

  assert.throws(() => { metrics.physical_reads = 99; }, TypeError);
  assert.equal(store.metrics().physical_reads, 2);
});

test("returns content-bound text and JSON snapshots without an extra physical read", (t) => {
  const root = fixture(t);
  const store = openCanonicalStore({ root });

  const text = store.snapshot("alpha.txt");
  assert.equal(text.readText(), "alpha\n");
  assert.equal(
    text.sha256,
    crypto.createHash("sha256").update("alpha\n").digest("hex"),
  );
  const json = store.snapshot("nested/data.json");
  assert.deepEqual(json.readJson(), { value: 1, items: ["a"] });
  assert.equal(
    json.sha256,
    crypto.createHash("sha256").update('{"value":1,"items":["a"]}\n').digest("hex"),
  );
  assert.equal(store.metrics().physical_reads, 2);
  assert.equal(store.metrics().hash_computations, 2);
});

test("detects external changes and supports exact, directory, and full invalidation", (t) => {
  const root = fixture(t);
  const store = openCanonicalStore({ root });

  assert.equal(store.readText("alpha.txt"), "alpha\n");
  fs.writeFileSync(path.join(root, "alpha.txt"), "alpha changed\n");
  assert.equal(store.readText("alpha.txt"), "alpha changed\n");
  assert.equal(store.metrics().cache_stale, 1);

  store.readJson("nested/data.json");
  assert.equal(store.invalidate("nested"), 1);
  assert.equal(store.metrics().cache_entries, 1);
  assert.equal(store.invalidate("alpha.txt"), 1);
  assert.equal(store.metrics().cache_entries, 0);

  store.readText("alpha.txt");
  store.readJson("nested/data.json");
  assert.equal(store.invalidate(), 2);
  assert.equal(store.metrics().cache_entries, 0);
  assert.equal(store.metrics().invalidations, 3);
});

test("walk is deterministic, returns regular files, and refuses symbolic links", (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, "nested", "a.txt"), "a\n");
  fs.writeFileSync(path.join(root, "z.txt"), "z\n");
  const store = openCanonicalStore({ root });

  assert.deepEqual(
    store.walk(".").map((filePath) => path.relative(root, filePath).split(path.sep).join("/")),
    ["alpha.txt", "nested/a.txt", "nested/data.json", "z.txt"],
  );
  assert.equal(store.metrics().files_walked, 4);

  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "canonical-store-outside-"));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true, maxRetries: 3 }));
  fs.writeFileSync(path.join(outside, "secret.txt"), "secret\n");
  const link = path.join(root, "nested", "escape");
  try {
    fs.symlinkSync(outside, link, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (process.platform === "win32" && ["EPERM", "EACCES"].includes(error?.code)) return;
    throw error;
  }

  assert.throws(
    () => store.readText("nested/escape/secret.txt"),
    (error) => error instanceof CanonicalStoreError && error.code === "symlink_forbidden",
  );
  assert.throws(
    () => store.walk("nested"),
    (error) => error instanceof CanonicalStoreError && error.code === "symlink_forbidden",
  );
});

test("rejects paths outside the project, malformed JSON, and a swapped root", (t) => {
  const root = fixture(t);
  const store = openCanonicalStore({ root });
  const outside = path.join(path.dirname(root), "outside.json");
  fs.writeFileSync(outside, "{}\n");
  t.after(() => fs.rmSync(outside, { force: true }));

  assert.throws(
    () => store.readText(outside),
    (error) => error instanceof CanonicalStoreError && error.code === "path_outside_root",
  );

  fs.writeFileSync(path.join(root, "broken.json"), "{broken\n");
  assert.throws(
    () => store.readJson("broken.json"),
    (error) => error instanceof CanonicalStoreError && error.code === "invalid_json",
  );

  if (process.platform === "win32") return;
  const moved = `${root}-moved`;
  fs.renameSync(root, moved);
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, "alpha.txt"), "replacement\n");
  t.after(() => fs.rmSync(moved, { recursive: true, force: true, maxRetries: 3 }));
  assert.throws(
    () => store.readText("alpha.txt"),
    (error) => error instanceof CanonicalStoreError && error.code === "root_changed",
  );
});

test("rejects a symbolic-link project root", (t) => {
  if (process.platform === "win32") return;
  const root = fixture(t);
  const link = `${root}-link`;
  fs.symlinkSync(root, link, "dir");
  t.after(() => fs.rmSync(link, { force: true }));
  assert.throws(
    () => openCanonicalStore({ root: link }),
    (error) => error instanceof CanonicalStoreError && error.code === "invalid_root",
  );
});
