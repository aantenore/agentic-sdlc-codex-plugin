import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { readResolvedFileBounded } from "../../lib/change-observatory/bounded-file-reader.mjs";
import { resolveExistingFileWithin } from "../../lib/change-observatory/path-safety.mjs";

async function fixture(name) {
  const created = await fs.mkdtemp(path.join(os.tmpdir(), `observatory-bounded-${name}-`));
  return fs.realpath(created);
}

test("reads one resolved regular file through a stable bounded handle", async () => {
  const root = await fixture("success");
  await fs.writeFile(path.join(root, "record.json"), '{"status":"ok"}\n');
  const resolved = await resolveExistingFileWithin(root, "record.json");

  const content = await readResolvedFileBounded(resolved, { maxBytes: 1024 });

  assert.equal(content.toString("utf8"), '{"status":"ok"}\n');
});

test("refuses a file that exceeds the hard response bound", async () => {
  const root = await fixture("oversize");
  await fs.writeFile(path.join(root, "record.txt"), "0123456789");
  const resolved = await resolveExistingFileWithin(root, "record.txt");

  await assert.rejects(
    readResolvedFileBounded(resolved, {
      maxBytes: 4,
      tooLargeCode: "source_too_large",
    }),
    (error) => error.code === "source_too_large" && error.statusCode === 413,
  );
});

test("fails closed when the pathname is swapped after the safe handle opens", async () => {
  const root = await fixture("swap");
  const record = path.join(root, "record.txt");
  const original = path.join(root, "record.original.txt");
  await fs.writeFile(record, "safe-content");
  const resolved = await resolveExistingFileWithin(root, "record.txt");

  await assert.rejects(
    readResolvedFileBounded(resolved, {
      maxBytes: 1024,
      boundaryCode: "source_boundary_changed",
      async onHandleOpened() {
        await fs.rename(record, original);
        await fs.writeFile(record, "external-canary");
      },
    }),
    (error) => error.code === "source_boundary_changed" && error.statusCode === 409,
  );
});

test("fails closed when content mutates in place during the read", async () => {
  const root = await fixture("mutation");
  const record = path.join(root, "record.txt");
  await fs.writeFile(record, "before");
  const resolved = await resolveExistingFileWithin(root, "record.txt");

  await assert.rejects(
    readResolvedFileBounded(resolved, {
      maxBytes: 1024,
      boundaryCode: "source_boundary_changed",
      async onHandleOpened() {
        await fs.writeFile(record, "after-with-different-size");
      },
    }),
    (error) => error.code === "source_boundary_changed" && error.statusCode === 409,
  );
});
