import assert from "node:assert/strict";
import { lstatSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { readTarGzipArchive } from "../../lib/release/tar-reader.mjs";
import { buildTarGzip } from "../helpers/release-package-fixture.mjs";


const DEFAULT_LIMITS = {
  maxCompressedBytes: 1024 * 1024,
  maxEntries: 64,
  maxFileBytes: 64 * 1024,
  maxPaxBytes: 4096,
  maxTotalFileBytes: 256 * 1024,
  maxUncompressedBytes: 1024 * 1024,
};


function withArchive(entries, callback, options) {
  const root = mkdtempSync(path.join(os.tmpdir(), "release-tar-unit-"));
  try {
    const archive = path.join(root, "fixture.tgz");
    writeFileSync(archive, buildTarGzip(entries, options));
    return callback(archive);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}


function expectCode(code, operation) {
  assert.throws(operation, (error) => {
    assert.equal(error.code, code);
    return true;
  });
}


test("reads canonical USTAR files and safe per-file PAX metadata", () => {
  withArchive([
    { path: "package/a.txt", data: "alpha" },
    { path: "placeholder", data: "beta", pax: { path: "package/long/b.txt", size: "4" } },
  ], (archive) => {
    const parsed = readTarGzipArchive(archive, DEFAULT_LIMITS);
    assert.deepEqual(parsed.entries.map(({ path: entryPath, type, size }) => ({ path: entryPath, type, size })), [
      { path: "package/a.txt", type: "file", size: 5 },
      { path: "package/long/b.txt", type: "file", size: 4 },
    ]);
    assert.equal(parsed.headerCount, 3);
    assert.equal(parsed.totalFileBytes, 9);
  });
});


test("rejects unsafe and ambiguous archive paths", () => {
  const cases = [
    ["absolute POSIX path", "/package/a", "ABSOLUTE_ARCHIVE_PATH"],
    ["absolute Windows path", "C:/package/a", "ABSOLUTE_ARCHIVE_PATH"],
    ["parent traversal", "package/../a", "PATH_TRAVERSAL"],
    ["dot component", "package/./a", "PATH_TRAVERSAL"],
    ["backslash", "package\\a", "BACKSLASH_PATH"],
    ["empty component", "package//a", "PATH_TRAVERSAL"],
  ];
  for (const [name, archivePath, code] of cases) {
    withArchive([{ path: archivePath, data: name }], (archive) => {
      expectCode(code, () => readTarGzipArchive(archive, DEFAULT_LIMITS));
    });
  }
});


test("rejects duplicate, case-insensitive, and file/directory collisions", () => {
  const cases = [
    [
      [{ path: "package/a", data: "1" }, { path: "package/a", data: "2" }],
      "DUPLICATE_ARCHIVE_PATH",
    ],
    [
      [{ path: "package/A", data: "1" }, { path: "package/a", data: "2" }],
      "CASE_INSENSITIVE_PATH_COLLISION",
    ],
    [
      [{ path: "package/a", data: "1" }, { path: "package/a/b", data: "2" }],
      "FILE_DIRECTORY_COLLISION",
    ],
    [
      [{ path: "package/a/b", data: "1" }, { path: "package/A", data: "2" }],
      "FILE_DIRECTORY_COLLISION",
    ],
  ];
  for (const [entries, code] of cases) {
    withArchive(entries, (archive) => expectCode(code, () => readTarGzipArchive(archive, DEFAULT_LIMITS)));
  }
});


test("rejects links, devices, FIFOs, global PAX, and unknown entry types", () => {
  for (const type of ["1", "2", "3", "4", "6", "7", "g", "L", "9"]) {
    const code = type === "g" ? "UNSAFE_PAX_GLOBAL_HEADER" : "UNSAFE_ENTRY_TYPE";
    withArchive([{ path: `package/type-${type}`, type, linkName: type === "1" || type === "2" ? "target" : "" }], (archive) => {
      expectCode(code, () => readTarGzipArchive(archive, DEFAULT_LIMITS));
    });
  }
});


test("rejects unsafe PAX and USTAR metadata", () => {
  withArchive([{ path: "placeholder", data: "x", pax: { path: "../escape", size: "1" } }], (archive) => {
    expectCode("PATH_TRAVERSAL", () => readTarGzipArchive(archive, DEFAULT_LIMITS));
  });
  withArchive([{ path: "../unsafe", data: "x", pax: { path: "package/safe", size: "1" } }], (archive) => {
    expectCode("PATH_TRAVERSAL", () => readTarGzipArchive(archive, DEFAULT_LIMITS));
  });
  withArchive([{ path: "placeholder", data: "x", pax: { mtime: "0" } }], (archive) => {
    expectCode("UNSAFE_PAX_KEY", () => readTarGzipArchive(archive, DEFAULT_LIMITS));
  });
  withArchive([{ path: "package/file", prefix: "../unsafe", data: "x" }], (archive) => {
    expectCode("PATH_TRAVERSAL", () => readTarGzipArchive(archive, DEFAULT_LIMITS));
  });
  withArchive([{ path: "package/file", magic: "ustar ", data: "x" }], (archive) => {
    expectCode("UNSUPPORTED_TAR_FORMAT", () => readTarGzipArchive(archive, DEFAULT_LIMITS));
  });
});


test("enforces compressed, header, single-file, total, PAX, and decompressed limits", () => {
  withArchive([{ path: "package/a", data: "alpha" }], (archive) => {
    const compressedBytes = lstatSize(archive);
    expectCode("COMPRESSED_LIMIT_EXCEEDED", () => readTarGzipArchive(archive, {
      ...DEFAULT_LIMITS,
      maxCompressedBytes: compressedBytes - 1,
    }));
    expectCode("FILE_LIMIT_EXCEEDED", () => readTarGzipArchive(archive, {
      ...DEFAULT_LIMITS,
      maxFileBytes: 4,
    }));
    expectCode("INVALID_GZIP_ARCHIVE", () => readTarGzipArchive(archive, {
      ...DEFAULT_LIMITS,
      maxTotalFileBytes: 1024,
      maxUncompressedBytes: 1024,
    }));
  });
  withArchive([{ path: "package/a", data: "aa" }, { path: "package/b", data: "bb" }], (archive) => {
    expectCode("ENTRY_LIMIT_EXCEEDED", () => readTarGzipArchive(archive, { ...DEFAULT_LIMITS, maxEntries: 1 }));
    expectCode("TOTAL_FILE_LIMIT_EXCEEDED", () => readTarGzipArchive(archive, { ...DEFAULT_LIMITS, maxTotalFileBytes: 3 }));
  });
  withArchive([{ path: "placeholder", data: "x", pax: { path: "package/a", size: "1" } }], (archive) => {
    expectCode("PAX_LIMIT_EXCEEDED", () => readTarGzipArchive(archive, { ...DEFAULT_LIMITS, maxPaxBytes: 4 }));
  });
});


test("rejects corrupt headers, incomplete terminators, and archive symlinks", () => {
  withArchive([{ path: "package/a", data: "x", corruptChecksum: true }], (archive) => {
    expectCode("HEADER_CHECKSUM_MISMATCH", () => readTarGzipArchive(archive, DEFAULT_LIMITS));
  });
  withArchive([{ path: "package/a", data: "x", paddingByte: 1 }], (archive) => {
    expectCode("NON_ZERO_TAR_PADDING", () => readTarGzipArchive(archive, DEFAULT_LIMITS));
  });
  withArchive([{ path: "package/a", data: "x" }], (archive) => {
    expectCode("MISSING_TAR_TERMINATOR", () => readTarGzipArchive(archive, DEFAULT_LIMITS));
  }, { zeroBlocks: 1 });

  const root = mkdtempSync(path.join(os.tmpdir(), "release-tar-link-"));
  try {
    const target = path.join(root, "target.tgz");
    const linked = path.join(root, "linked.tgz");
    writeFileSync(target, buildTarGzip([{ path: "package/a", data: "x" }]));
    symlinkSync(target, linked);
    expectCode("UNSAFE_ARCHIVE_FILE", () => readTarGzipArchive(linked, DEFAULT_LIMITS));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});


function lstatSize(file) {
  return lstatSync(file).size;
}
