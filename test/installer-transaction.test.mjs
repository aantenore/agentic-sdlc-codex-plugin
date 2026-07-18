import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";


const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");


test("transactional personal marketplace installer contract", () => {
  const python = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
  const result = spawnSync(
    python,
    [path.join(repoRoot, "test", "installer-transaction.test.py")],
    {
      cwd: repoRoot,
      encoding: "utf8",
      env: process.env,
      timeout: 30_000,
    },
  );

  assert.equal(
    result.status,
    0,
    `Installer transaction tests failed.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
});
