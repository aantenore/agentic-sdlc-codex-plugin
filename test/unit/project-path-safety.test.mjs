import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  ProjectPathSafetyError,
  assertNoSymlinkSegmentsWithinBoundary,
} from "../../lib/project-path-safety.mjs";

test("path safety inspects only the trusted boundary and its descendants", () => {
  const boundary = path.resolve("workspace", "project");
  const target = path.join(boundary, ".sdlc", "config.json");
  const inspected = [];
  const fsModule = {
    lstatSync(candidate) {
      inspected.push(candidate);
      if (!isInside(boundary, candidate)) {
        const error = new Error("parent access denied by sandbox");
        error.code = "EPERM";
        throw error;
      }
      if (candidate === target) {
        const error = new Error("not created yet");
        error.code = "ENOENT";
        throw error;
      }
      return { isSymbolicLink: () => false };
    },
  };

  assert.equal(
    assertNoSymlinkSegmentsWithinBoundary(boundary, target, { fsModule }),
    target,
  );
  assert.equal(inspected[0], boundary);
  assert.equal(inspected.every((candidate) => isInside(boundary, candidate)), true);
});

test("path safety rejects escapes, a linked boundary, and linked descendants", () => {
  const boundary = path.resolve("workspace", "project");
  const linkedDirectory = path.join(boundary, ".sdlc");
  const fsModule = {
    lstatSync(candidate) {
      return { isSymbolicLink: () => candidate === linkedDirectory };
    },
  };

  assert.throws(
    () => assertNoSymlinkSegmentsWithinBoundary(
      boundary,
      path.join(linkedDirectory, "config.json"),
      { fsModule },
    ),
    (error) => error instanceof ProjectPathSafetyError
      && error.code === "PROJECT_PATH_SYMLINK",
  );
  assert.throws(
    () => assertNoSymlinkSegmentsWithinBoundary(
      boundary,
      path.dirname(boundary),
      { fsModule },
    ),
    (error) => error instanceof ProjectPathSafetyError
      && error.code === "PROJECT_PATH_OUTSIDE_BOUNDARY",
  );

  const linkedBoundaryFs = {
    lstatSync(candidate) {
      return { isSymbolicLink: () => candidate === boundary };
    },
  };
  assert.throws(
    () => assertNoSymlinkSegmentsWithinBoundary(boundary, boundary, {
      fsModule: linkedBoundaryFs,
    }),
    (error) => error instanceof ProjectPathSafetyError
      && error.code === "PROJECT_PATH_SYMLINK",
  );
});

test("path safety accepts the canonical form of a trusted boundary without inspecting volume parents", () => {
  const boundary = "/var/tmp/project";
  const canonicalBoundary = "/private/var/tmp/project";
  const target = `${canonicalBoundary}/.sdlc/config.json`;
  const inspected = [];
  const realpathSync = () => canonicalBoundary;
  realpathSync.native = realpathSync;
  const fsModule = {
    realpathSync,
    lstatSync(candidate) {
      inspected.push(candidate);
      if (candidate === target) {
        const error = new Error("not created yet");
        error.code = "ENOENT";
        throw error;
      }
      return { isSymbolicLink: () => false };
    },
  };

  assert.equal(
    assertNoSymlinkSegmentsWithinBoundary(boundary, target, {
      fsModule,
      pathModule: path.posix,
    }),
    target,
  );
  assert.equal(inspected.includes("/private"), false);
  assert.equal(inspected.includes("/private/var"), false);
  assert.equal(inspected.includes(boundary), true);
  assert.equal(inspected.includes(canonicalBoundary), true);
});

test("path safety propagates filesystem errors other than a missing entry", () => {
  const boundary = path.resolve("workspace", "project");
  const failure = new Error("access denied");
  failure.code = "EACCES";
  assert.throws(
    () => assertNoSymlinkSegmentsWithinBoundary(boundary, boundary, {
      fsModule: {
        lstatSync() {
          throw failure;
        },
      },
    }),
    (error) => error === failure,
  );
});

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (
    relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}
