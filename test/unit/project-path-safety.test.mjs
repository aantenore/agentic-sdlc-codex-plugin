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
  assert.equal(inspected.every((candidate) => isInside(boundary, candidate)), true);
});

test("path safety rejects escapes and symlinks below the boundary", () => {
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
    (error) => error instanceof ProjectPathSafetyError && error.code === "PROJECT_PATH_SYMLINK",
  );
  assert.throws(
    () => assertNoSymlinkSegmentsWithinBoundary(boundary, path.dirname(boundary), { fsModule }),
    (error) => error instanceof ProjectPathSafetyError
      && error.code === "PROJECT_PATH_OUTSIDE_BOUNDARY",
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
