import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_TEST_CONCURRENCY,
  MAX_TEST_CONCURRENCY,
  TEST_CONCURRENCY_ENV,
  discoverTestFiles,
  main,
  parseTestConcurrency,
} from "../../scripts/run-test-suite.mjs";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

test("test concurrency defaults to two, accepts positive integers, and caps large requests", () => {
  assert.equal(DEFAULT_TEST_CONCURRENCY, 2);
  assert.equal(MAX_TEST_CONCURRENCY, 8);
  assert.equal(TEST_CONCURRENCY_ENV, "AGENTIC_SDLC_TEST_CONCURRENCY");
  assert.equal(parseTestConcurrency(undefined), 2);
  assert.equal(parseTestConcurrency("1"), 1);
  assert.equal(parseTestConcurrency("4"), 4);
  assert.equal(parseTestConcurrency("8"), 8);
  assert.equal(parseTestConcurrency("9"), 8);
  assert.equal(parseTestConcurrency("999999999999999999999999"), 8);
});

test("test concurrency rejects malformed or non-positive values", () => {
  for (const value of ["", "0", "-1", "+2", "1.5", " 2", "2 ", "two"]) {
    assert.throws(
      () => parseTestConcurrency(value),
      new RegExp(`${TEST_CONCURRENCY_ENV} must be a positive integer`, "u"),
    );
  }
  assert.throws(
    () => parseTestConcurrency(2),
    new RegExp(`${TEST_CONCURRENCY_ENV} must be a positive integer`, "u"),
  );
});

test("npm test uses the Node 18.18-compatible programmatic runner", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(PROJECT_ROOT, "package.json"), "utf8"),
  );

  assert.equal(packageJson.engines.node, ">=18.18");
  assert.equal(packageJson.scripts.test, "node scripts/run-test-suite.mjs");
  assert.doesNotMatch(JSON.stringify(packageJson.scripts), /--test-concurrency(?:=|\s)/u);
});

test("runner discovers an explicit, non-empty, stable test-file list", () => {
  const files = discoverTestFiles();

  assert.ok(files.length > 0);
  assert.deepEqual(files, [...files].sort());
  assert.ok(files.every((file) => path.isAbsolute(file)));
  assert.ok(files.every((file) => file.startsWith(path.join(PROJECT_ROOT, "test"))));
  assert.ok(files.includes(fileURLToPath(import.meta.url)));
});

test("runner returns a nonzero status for test failures and stream errors", async () => {
  const failure = await runMainWithEvent("test:fail", { name: "failed test" });
  assert.equal(failure.code, 1);
  assert.equal(failure.stderr, "");

  const error = await runMainWithEvent("error", new Error("runner exploded"));
  assert.equal(error.code, 1);
  assert.match(error.stderr, /Test runner error: Error: runner exploded/u);
});

test("runner fails closed when the stream reports fewer tests than explicit files", async () => {
  const testStream = new EventEmitter();
  let stderr = "";
  const code = await main({
    env: {},
    stdout: {
      write() {
        return true;
      },
    },
    stderr: {
      write(chunk) {
        stderr += chunk;
        return true;
      },
    },
    runTests(options) {
      assert.deepEqual(options, {
        concurrency: DEFAULT_TEST_CONCURRENCY,
        files: ["/deterministic/one.test.mjs", "/deterministic/two.test.mjs"],
      });
      return testStream;
    },
    findTestFiles() {
      return ["/deterministic/one.test.mjs", "/deterministic/two.test.mjs"];
    },
    async *reporter() {
      yield "TAP version 13\n";
    },
  });

  assert.equal(code, 1);
  assert.match(stderr, /completed only 0 test events for 2 explicit test files/u);
});

async function runMainWithEvent(eventName, payload) {
  const testStream = new EventEmitter();
  let stdout = "";
  let stderr = "";
  const code = await main({
    env: {},
    stdout: {
      write(chunk) {
        stdout += chunk;
        return true;
      },
    },
    stderr: {
      write(chunk) {
        stderr += chunk;
        return true;
      },
    },
    runTests(options) {
      assert.deepEqual(options, {
        concurrency: DEFAULT_TEST_CONCURRENCY,
        files: ["/deterministic/test.mjs"],
      });
      return testStream;
    },
    findTestFiles() {
      return ["/deterministic/test.mjs"];
    },
    async *reporter(stream) {
      stream.emit(eventName, payload);
      yield "TAP version 13\n";
    },
  });
  return { code, stdout, stderr };
}
