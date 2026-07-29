import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { discoverSourceFiles } from "../../scripts/check-source-syntax.mjs";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

test("syntax discovery includes every source area and previously omitted modules", () => {
  const files = new Set(
    discoverSourceFiles(PROJECT_ROOT)
      .map((filePath) => path.relative(PROJECT_ROOT, filePath).split(path.sep).join("/")),
  );

  for (const expected of [
    "bin/agentic-sdlc.mjs",
    "lib/assessment-workflow.mjs",
    "lib/authorization-receipts.mjs",
    "lib/canonical-store.mjs",
    "lib/execution-budget.mjs",
    "lib/json-schema-validator.mjs",
    "lib/verification-levels.mjs",
    "scripts/benchmark-foundation.mjs",
    "scripts/check-source-syntax.mjs",
    "test/unit/first-user-language-ux.test.mjs",
    "ui/change-observatory/app.js",
  ]) {
    assert.equal(files.has(expected), true, `missing syntax coverage for ${expected}`);
  }
});
