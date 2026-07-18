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
  assert.equal(text.assertUnchanged(), text.sha256);
  const json = store.snapshot("nested/data.json");
  assert.deepEqual(json.readJson(), { value: 1, items: ["a"] });
  assert.equal(
    json.sha256,
    crypto.createHash("sha256").update('{"value":1,"items":["a"]}\n').digest("hex"),
  );
  assert.equal(json.assertUnchanged(), json.sha256);
  assert.equal(store.metrics().physical_reads, 2);
  assert.equal(store.metrics().hash_computations, 2);
  assert.equal(store.metrics().hash_calls, 4);
  assert.equal(store.metrics().cache_hits, 2);
});

test("bounded snapshots reject oversized files before reading or caching their bytes", (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, "oversized.txt"), "0123456789");
  const store = openCanonicalStore({ root });

  assert.throws(
    () => store.snapshot("oversized.txt", { maxBytes: 5 }),
    (error) => error instanceof CanonicalStoreError && error.code === "file_too_large",
  );
  assert.equal(store.metrics().physical_reads, 0);
  assert.equal(store.metrics().bytes_read, 0);

  const accepted = store.snapshot("oversized.txt", { maxBytes: 10 });
  assert.equal(accepted.byteLength, 10);
  assert.equal(accepted.readText(), "0123456789");
  assert.equal(store.metrics().physical_reads, 1);
  assert.throws(
    () => store.snapshot("oversized.txt", { maxBytes: 9 }),
    (error) => error instanceof CanonicalStoreError && error.code === "file_too_large",
  );
  assert.equal(store.metrics().physical_reads, 1);
});

test("bounded walks stop at the first file or directory-entry overflow", (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, "second.txt"), "second\n");
  const store = openCanonicalStore({ root });

  assert.throws(
    () => store.walk(".", { maxFiles: 2, maxEntries: 100 }),
    (error) => error instanceof CanonicalStoreError && error.code === "walk_limit_exceeded",
  );
  assert.throws(
    () => store.walk(".", { maxFiles: 100, maxEntries: 1 }),
    (error) => error instanceof CanonicalStoreError && error.code === "walk_limit_exceeded",
  );
  assert.deepEqual(
    store.walk(".", { maxFiles: 3, maxEntries: 10 })
      .map((filePath) => path.relative(root, filePath).split(path.sep).join("/")),
    ["alpha.txt", "nested/data.json", "second.txt"],
  );
});

test("fails a verified snapshot closed after file or parent replacement", (t) => {
  const root = fixture(t);
  const store = openCanonicalStore({ root });
  const fileSnapshot = store.snapshot("alpha.txt");

  fs.writeFileSync(path.join(root, "alpha.txt"), "changed after snapshot\n");
  assert.throws(
    () => fileSnapshot.assertUnchanged(),
    (error) => error instanceof CanonicalStoreError && error.code === "file_changed",
  );
  assert.equal(store.metrics().cache_stale, 1);
  assert.throws(
    () => fileSnapshot.assertUnchanged(),
    (error) => error instanceof CanonicalStoreError && error.code === "file_changed",
  );
  assert.equal(store.metrics().cache_stale, 1);
  assert.equal(store.metrics().cache_entries, 0);
  assert.equal(store.readText("alpha.txt"), "changed after snapshot\n");

  const parentSnapshot = store.snapshot("nested/data.json");
  const moved = path.join(root, "nested-original");
  fs.renameSync(path.join(root, "nested"), moved);
  try {
    fs.symlinkSync(moved, path.join(root, "nested"), process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (process.platform === "win32" && ["EPERM", "EACCES"].includes(error?.code)) return;
    throw error;
  }
  assert.throws(
    () => parentSnapshot.assertUnchanged(),
    (error) => error instanceof CanonicalStoreError && error.code === "parent_changed",
  );
  assert.equal(store.metrics().cache_stale, 2);
});

test("keeps stale snapshots isolated from newer cache entries", (t) => {
  const root = fixture(t);
  const store = openCanonicalStore({ root });
  const oldSnapshot = store.snapshot("alpha.txt");
  fs.writeFileSync(path.join(root, "alpha.txt"), "new value\n");
  assert.equal(store.readText("alpha.txt"), "new value\n");
  assert.throws(
    () => oldSnapshot.assertUnchanged(),
    (error) => error instanceof CanonicalStoreError && error.code === "file_changed",
  );
  assert.equal(store.metrics().cache_entries, 1);
  assert.equal(store.readText("alpha.txt"), "new value\n");
  assert.equal(store.metrics().cache_stale, 1);
});

test("detects an intermediate symlink even when it still reaches the original file", (t) => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, "ancestor", "parent"), { recursive: true });
  fs.writeFileSync(path.join(root, "ancestor", "parent", "data.json"), '{"stable":true}\n');
  const store = openCanonicalStore({ root });
  const snapshot = store.snapshot("ancestor/parent/data.json");
  const moved = path.join(root, "ancestor-original");
  fs.renameSync(path.join(root, "ancestor"), moved);
  try {
    fs.symlinkSync(moved, path.join(root, "ancestor"), process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (process.platform === "win32" && ["EPERM", "EACCES"].includes(error?.code)) return;
    throw error;
  }

  assert.throws(
    () => snapshot.assertUnchanged(),
    (error) => error instanceof CanonicalStoreError && error.code === "parent_changed",
  );
});

test("rejects deleted files, final symlinks, and a replaced project root", (t) => {
  const root = fixture(t);
  const deletedStore = openCanonicalStore({ root });
  const deletedSnapshot = deletedStore.snapshot("alpha.txt");
  fs.unlinkSync(path.join(root, "alpha.txt"));
  assert.throws(
    () => deletedSnapshot.assertUnchanged(),
    (error) => error instanceof CanonicalStoreError && error.code === "path_missing",
  );

  const parentStore = openCanonicalStore({ root });
  const parentSnapshot = parentStore.snapshot("nested/data.json");
  fs.rmSync(path.join(root, "nested"), { recursive: true, force: true });
  assert.throws(
    () => parentSnapshot.assertUnchanged(),
    (error) => error instanceof CanonicalStoreError && error.code === "path_missing",
  );

  fs.mkdirSync(path.join(root, "nested"), { recursive: true });
  fs.writeFileSync(path.join(root, "nested", "data.json"), '{"restored":true}\n');

  fs.writeFileSync(path.join(root, "alpha.txt"), "alpha replacement\n");
  const linkStore = openCanonicalStore({ root });
  const linkSnapshot = linkStore.snapshot("alpha.txt");
  fs.renameSync(path.join(root, "alpha.txt"), path.join(root, "alpha-original.txt"));
  let linkCreated = false;
  try {
    fs.symlinkSync(
      path.join(root, "alpha-original.txt"),
      path.join(root, "alpha.txt"),
      process.platform === "win32" ? "file" : undefined,
    );
    linkCreated = true;
  } catch (error) {
    if (!(process.platform === "win32" && ["EPERM", "EACCES"].includes(error?.code))) throw error;
  }
  if (linkCreated) {
    assert.throws(
      () => linkSnapshot.assertUnchanged(),
      (error) => error instanceof CanonicalStoreError && error.code === "symlink_forbidden",
    );
  }

  if (process.platform === "win32") return;
  const rootStore = openCanonicalStore({ root });
  const rootSnapshot = rootStore.snapshot("nested/data.json");
  const movedRoot = `${root}-moved-for-snapshot`;
  fs.renameSync(root, movedRoot);
  fs.mkdirSync(root);
  fs.mkdirSync(path.join(root, "nested"));
  fs.writeFileSync(path.join(root, "nested", "data.json"), '{"replacement":true}\n');
  t.after(() => fs.rmSync(movedRoot, { recursive: true, force: true, maxRetries: 3 }));
  assert.throws(
    () => rootSnapshot.assertUnchanged(),
    (error) => error instanceof CanonicalStoreError && error.code === "root_changed",
  );
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

test("full missing-path inspection detects an ancestor symlink swap", (t) => {
  if (process.platform === "win32") return;
  const outer = fs.mkdtempSync(path.join(os.tmpdir(), "canonical-store-ancestor-"));
  t.after(() => fs.rmSync(outer, { recursive: true, force: true, maxRetries: 3 }));
  const parent = path.join(outer, "parent");
  const root = path.join(parent, "project");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "record.json"), '{"stable":true}\n');
  const store = openCanonicalStore({ root });
  const movedParent = path.join(outer, "parent-original");
  fs.renameSync(parent, movedParent);
  fs.symlinkSync(movedParent, parent, "dir");

  assert.throws(
    () => store.inspect("missing.json"),
    (error) => error instanceof CanonicalStoreError && error.code === "root_changed",
  );
  assert.throws(
    () => store.readJson("record.json"),
    (error) => error instanceof CanonicalStoreError && error.code === "path_outside_root",
  );
});
