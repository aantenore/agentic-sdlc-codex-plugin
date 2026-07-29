import path from "node:path";
import { once } from "node:events";
import { run } from "node:test";
import { tap } from "node:test/reporters";
import { fileURLToPath } from "node:url";

export const TEST_CONCURRENCY_ENV = "AGENTIC_SDLC_TEST_CONCURRENCY";
export const DEFAULT_TEST_CONCURRENCY = 2;
export const MAX_TEST_CONCURRENCY = 8;

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

export async function main({
  env = process.env,
  stdout = process.stdout,
  stderr = process.stderr,
  runTests = run,
  reporter = tap,
} = {}) {
  let testStream;
  let streamError;
  let failed = false;

  try {
    const concurrency = parseTestConcurrency(env[TEST_CONCURRENCY_ENV]);
    // Omitting `files` intentionally preserves the same discovery rules as `node --test`.
    testStream = runTests({ concurrency });
    testStream.on("test:fail", () => {
      failed = true;
    });
    testStream.on("error", (error) => {
      failed = true;
      streamError ||= error;
    });

    for await (const chunk of reporter(testStream)) {
      if (!stdout.write(chunk)) await once(stdout, "drain");
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
