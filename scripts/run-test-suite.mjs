import path from "node:path";
import { once } from "node:events";
import fs from "node:fs";
import { run } from "node:test";
import { tap } from "node:test/reporters";
import { fileURLToPath } from "node:url";

export const TEST_CONCURRENCY_ENV = "AGENTIC_SDLC_TEST_CONCURRENCY";
export const DEFAULT_TEST_CONCURRENCY = 2;
export const MAX_TEST_CONCURRENCY = 8;
const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const TEST_ROOT = path.join(PROJECT_ROOT, "test");

export function parseTestConcurrency(value) {
  if (value === undefined) return DEFAULT_TEST_CONCURRENCY;
  if (typeof value !== "string" || !/^[1-9][0-9]*$/u.test(value)) {
    throw new TypeError(
      `${TEST_CONCURRENCY_ENV} must be a positive integer; received ${JSON.stringify(value)}.`,
    );
  }

  const requested = BigInt(value);
  return requested > BigInt(MAX_TEST_CONCURRENCY)
    ? MAX_TEST_CONCURRENCY
    : Number(requested);
}

export function discoverTestFiles(testRoot = TEST_ROOT) {
  const discovered = [];

  function visit(directory) {
    for (const entry of fs.readdirSync(directory, {
      encoding: "utf8",
      withFileTypes: true,
    })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (
        entry.isFile()
        && /\.(?:cjs|js|mjs)$/u.test(entry.name)
      ) {
        discovered.push(path.resolve(entryPath));
      }
    }
  }

  visit(testRoot);
  discovered.sort();
  if (discovered.length === 0) {
    throw new Error(`No JavaScript test files were found under ${testRoot}.`);
  }
  return discovered;
}

export async function main({
  env = process.env,
  stdout = process.stdout,
  stderr = process.stderr,
  runTests = run,
  reporter = tap,
  findTestFiles = discoverTestFiles,
} = {}) {
  let testStream;
  let streamError;
  let failed = false;
  let completedTestCount = 0;
  let expectedFileCount = 0;

  try {
    const concurrency = parseTestConcurrency(env[TEST_CONCURRENCY_ENV]);
    // Node 20 can otherwise reinterpret this runner script as the only test file.
    // An explicit, non-empty file list keeps discovery stable across Node 18/20/24.
    const files = findTestFiles();
    expectedFileCount = files.length;
    testStream = runTests({ concurrency, files });
    testStream.on("test:pass", () => {
      completedTestCount += 1;
    });
    testStream.on("test:fail", () => {
      completedTestCount += 1;
      failed = true;
    });
    testStream.on("error", (error) => {
      failed = true;
      streamError ||= error;
    });

    for await (const chunk of reporter(testStream)) {
      if (!stdout.write(chunk)) await once(stdout, "drain");
    }
    if (!streamError && completedTestCount < expectedFileCount) {
      failed = true;
      streamError = new Error(
        `Test runner completed only ${completedTestCount} test events for `
        + `${expectedFileCount} explicit test files.`,
      );
    }
  } catch (error) {
    failed = true;
    streamError ||= error;
  }

  if (streamError) {
    stderr.write(`Test runner error: ${formatError(streamError)}\n`);
  }
  return failed ? 1 : 0;
}

function formatError(error) {
  if (error instanceof Error) return error.stack || error.message;
  return String(error);
}

if (path.resolve(process.argv[1] || "") === path.resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = await main();
}
