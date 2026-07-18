import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildObservatoryViewModel,
  createProjectDataRuntime,
} from "../../lib/change-observatory/index.mjs";

test("reuses the single-project view, source, and cache boundaries without writes", async (t) => {
  const projectRoot = await createProjectFixture(t);
  const before = await snapshotTree(projectRoot);
  const events = [];
  let builds = 0;
  const runtime = await createProjectDataRuntime({
    projectRoot,
    clock: () => new Date("2026-07-19T08:00:00Z"),
    onCacheEvent: (event) => events.push(event.type),
    async buildViewModel(...args) {
      builds += 1;
      return buildObservatoryViewModel(...args);
    },
  });

  const first = await runtime.getRepresentation();
  const second = await runtime.getRepresentation();
  const model = JSON.parse(first.body);
  const source = await runtime.readSource(".sdlc/project.json");
  await runtime.assertReady();

  assert.equal(model.schemaVersion, "change-observatory:view:v1");
  assert.equal(model.project.id, "runtime-fixture");
  assert.equal(model.generatedAt, "2026-07-19T08:00:00.000Z");
  assert.equal(source.data.project_id, "runtime-fixture");
  assert.equal(first, second);
  assert.equal(builds, 1);
  assert.ok(events.includes("build_success"));
  assert.ok(events.includes("fast_hit"));
  assert.deepEqual(await snapshotTree(projectRoot), before);
});

test("keeps a project privacy policy stable for the lifetime of the runtime", async (t) => {
  const projectRoot = await createProjectFixture(t);
  const runtime = await createProjectDataRuntime({ projectRoot });
  assert.equal((await runtime.readSource(".sdlc/project.json")).data.project_id, "runtime-fixture");

  await fs.writeFile(path.join(projectRoot, ".sdlc", "config.json"), `${JSON.stringify({
    observability: {
      redaction: { pii_patterns: [{ name: "employee", pattern: "EMP-[0-9]{6}" }] },
    },
  })}\n`, "utf8");

  await assert.rejects(
    () => runtime.getRepresentation(),
    (error) => error.code === "observability_configuration_changed" && error.statusCode === 503,
  );
  await assert.rejects(
    () => runtime.readSource(".sdlc/project.json"),
    (error) => error.code === "observability_configuration_changed" && error.statusCode === 503,
  );
});

test("pins the project directory across model and source reads", async (t) => {
  if (process.platform === "win32") t.skip("Directory swap coverage requires Unix rename semantics");
  const projectRoot = await createProjectFixture(t);
  const runtime = await createProjectDataRuntime({ projectRoot });
  await runtime.getRepresentation();

  const original = `${projectRoot}-original`;
  t.after(() => fs.rm(original, { recursive: true, force: true }));
  await fs.rename(projectRoot, original);
  await fs.mkdir(path.join(projectRoot, ".sdlc"), { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, ".sdlc", "project.json"),
    '{"project_id":"replacement"}\n',
    "utf8",
  );

  await assert.rejects(
    () => runtime.getRepresentation(),
    (error) => error.code === "project_boundary_changed" && error.statusCode === 409,
  );
  await assert.rejects(
    () => runtime.readSource(".sdlc/project.json"),
    (error) => error.code === "project_boundary_changed" && error.statusCode === 409,
  );
});

async function createProjectFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "change-observatory-runtime-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const projectRoot = path.join(root, "project");
  await fs.mkdir(path.join(projectRoot, ".sdlc"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, ".sdlc", "project.json"), `${JSON.stringify({
    schema_version: "0.1.0",
    project_id: "runtime-fixture",
    project_name: "Runtime Fixture",
  })}\n`, "utf8");
  return projectRoot;
}

async function snapshotTree(root) {
  const files = [];
  async function walk(directory, relative = "") {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const child = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(child, childRelative);
      } else if (entry.isFile()) {
        const content = await fs.readFile(child);
        files.push([childRelative, crypto.createHash("sha256").update(content).digest("hex")]);
      }
    }
  }
  await walk(root);
  return files;
}
