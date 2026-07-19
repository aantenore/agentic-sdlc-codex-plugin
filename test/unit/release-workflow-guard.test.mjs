import assert from "node:assert/strict";
import test from "node:test";

import {
  parseReleaseTag,
  ReleaseWorkflowGuardError,
} from "../../lib/release/workflow-guard.mjs";


test("parses complete SemVer tags and derives prerelease only from the parsed field", () => {
  assert.deepEqual(parseReleaseTag("v1.2.3-RC.1+Build-Meta-with-hyphen"), {
    tag: "v1.2.3-RC.1+Build-Meta-with-hyphen",
    version: "1.2.3-RC.1+Build-Meta-with-hyphen",
    prerelease: "RC.1",
    build: "Build-Meta-with-hyphen",
    isPrerelease: true,
  });
  assert.deepEqual(parseReleaseTag("v1.2.3+Build-Meta-with-hyphen"), {
    tag: "v1.2.3+Build-Meta-with-hyphen",
    version: "1.2.3+Build-Meta-with-hyphen",
    prerelease: null,
    build: "Build-Meta-with-hyphen",
    isPrerelease: false,
  });
});


test("rejects tags outside strict SemVer", () => {
  for (const tag of [
    "1.2.3",
    "v01.2.3",
    "v1.2.3-01",
    "v1.2.3+",
    "v1.2.3+build..one",
    "v1.2",
    "v1.2.3\nnext",
  ]) {
    assert.throws(
      () => parseReleaseTag(tag),
      (error) => error instanceof ReleaseWorkflowGuardError && error.code === "INVALID_RELEASE_TAG",
      tag,
    );
  }
});
