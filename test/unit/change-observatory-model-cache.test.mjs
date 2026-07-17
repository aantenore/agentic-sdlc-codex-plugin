import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  computeCanonicalRevision,
  createObservatoryModelCache,
} from "../../lib/change-observatory/model-cache.mjs";

test("canonical revisions track source bytes but ignore derived cache and index data", async (t) => {
  const fixture = await createCacheFixture(t);
  const initial = await computeCanonicalRevision(fixture.projectRoot);

  await fs.mkdir(path.join(fixture.projectRoot, ".sdlc", "cache"), { recursive: true });
  await fs.mkdir(path.join(fixture.projectRoot, ".sdlc", "InDeXeS"), { recursive: true });
  await fs.writeFile(path.join(fixture.projectRoot, ".sdlc", "cache", "derived.json"), "{\"v\":1}\n");
  await fs.writeFile(path.join(fixture.projectRoot, ".sdlc", "InDeXeS", "derived.json"), "{\"v\":2}\n");
  assert.equal(await computeCanonicalRevision(fixture.projectRoot), initial);

  await writeProjectRecord(fixture.projectRoot, { version: 2 });
  assert.notEqual(await computeCanonicalRevision(fixture.projectRoot), initial);

  const limitedInitial = await computeCanonicalRevision(fixture.projectRoot, {
    limits: { maxFileBytes: 1 },
  });
  await writeProjectRecord(fixture.projectRoot, { version: 3 });
  assert.equal(
    await computeCanonicalRevision(fixture.projectRoot, { limits: { maxFileBytes: 1 } }),
    limitedInitial,
  );
  await writeProjectRecord(fixture.projectRoot, { version: 30 });
  assert.notEqual(
    await computeCanonicalRevision(fixture.projectRoot, { limits: { maxFileBytes: 1 } }),
    limitedInitial,
  );
});

test("ordered directory snapshots reject add, remove, or rename races", async (t) => {
  const scenarios = [
    {
      name: "add",
      async mutate(knowledgeBase) {
        await fs.writeFile(path.join(knowledgeBase, "added-during-scan.json"), "{}\n", "utf8");
      },
    },
    {
      name: "remove",
      prepare: true,
      async mutate(knowledgeBase) {
        await fs.rm(path.join(knowledgeBase, "race-target.json"));
      },
    },
    {
      name: "rename",
      prepare: true,
      async mutate(knowledgeBase) {
        await fs.rename(
          path.join(knowledgeBase, "race-target.json"),
          path.join(knowledgeBase, "renamed-during-scan.json"),
        );
      },
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async (scenarioTest) => {
      const fixture = await createCacheFixture(scenarioTest);
      const knowledgeBase = path.join(fixture.projectRoot, ".sdlc");
      if (scenario.prepare) {
        await fs.writeFile(path.join(knowledgeBase, "race-target.json"), "{}\n", "utf8");
      }
      let mutated = false;
      await assert.rejects(
        () => computeCanonicalRevision(fixture.projectRoot, {
          async onDirectorySnapshot(snapshot) {
            if (snapshot.path !== ".sdlc" || mutated) return;
            mutated = true;
            await scenario.mutate(knowledgeBase);
          },
        }),
        (error) => error?.code === "canonical_revision_changed" && error?.statusCode === 409,
      );
      assert.equal(typeof await computeCanonicalRevision(fixture.projectRoot), "string");
    });
  }
});

test("revision markers stop at maxFiles and maxTotalBytes", async (t) => {
  const fixture = await createCacheFixture(t);
  const projectPath = path.join(fixture.projectRoot, ".sdlc", "project.json");
  const ignoredPath = path.join(fixture.projectRoot, ".sdlc", "z-ignored.json");
  await fs.writeFile(ignoredPath, "{\"value\":1}\n", "utf8");

  const fileLimited = await computeCanonicalRevision(fixture.projectRoot, {
    limits: { maxFiles: 1 },
  });
  await fs.writeFile(ignoredPath, "{\"value\":2}\n", "utf8");
  assert.equal(
    await computeCanonicalRevision(fixture.projectRoot, { limits: { maxFiles: 1 } }),
    fileLimited,
  );
  await writeProjectRecord(fixture.projectRoot, { version: 2 });
  assert.notEqual(
    await computeCanonicalRevision(fixture.projectRoot, { limits: { maxFiles: 1 } }),
    fileLimited,
  );

  const projectBytes = (await fs.stat(projectPath)).size;
  const totalLimited = await computeCanonicalRevision(fixture.projectRoot, {
    limits: { maxTotalBytes: projectBytes },
  });
  await fs.writeFile(ignoredPath, "{\"value\":3}\n", "utf8");
  assert.equal(
    await computeCanonicalRevision(fixture.projectRoot, {
      limits: { maxTotalBytes: projectBytes },
    }),
    totalLimited,
  );
});

test("unreadable canonical entries use a stable marker and recover when readable", async (t) => {
  if (process.platform === "win32" || process.getuid?.() === 0) {
    t.skip("Portable permission denial is unavailable on this runtime");
  }

  const fixture = await createCacheFixture(t);
  const unreadablePath = path.join(fixture.projectRoot, ".sdlc", "unreadable.json");
  await fs.writeFile(unreadablePath, "{\"secret\":true}\n", "utf8");
  await fs.chmod(unreadablePath, 0o000);
  t.after(() => fs.chmod(unreadablePath, 0o600).catch(() => {}));

  const unreadable = await computeCanonicalRevision(fixture.projectRoot);
  assert.equal(await computeCanonicalRevision(fixture.projectRoot), unreadable);

  let builds = 0;
  const cache = createObservatoryModelCache({
    projectRoot: fixture.projectRoot,
    buildModel() {
      builds += 1;
      return { builds };
    },
  });
  await cache.get();
  await cache.get();
  assert.equal(builds, 1);

  await fs.chmod(unreadablePath, 0o600);
  assert.notEqual(await computeCanonicalRevision(fixture.projectRoot), unreadable);
  await cache.get();
  assert.equal(builds, 2);
});

test("warm reads validate the retained snapshot without rebuilding", async (t) => {
  const fixture = await createCacheFixture(t);
  let builds = 0;
  const events = [];
  const cache = createObservatoryModelCache({
    projectRoot: fixture.projectRoot,
    buildModel() {
      builds += 1;
      return { builds };
    },
    onFastPathCheck(event) {
      events.push(event);
    },
  });

  const cold = await cache.get();
  assert.equal(events.length, 0);
  const warm = await cache.get();
  assert.equal(warm, cold);
  assert.equal(builds, 1);
  assert.ok(events.some((event) => event.event === "start" && event.kind === "file"));
  assert.ok(events.some((event) => event.event === "start" && event.kind === "directory"));
});

test("fast validation invalidates add, remove, rename, content, and symlink changes", async (t) => {
  const scenarios = [
    {
      name: "add",
      async mutate(fixture) {
        await fs.writeFile(path.join(fixture.projectRoot, ".sdlc", "added.json"), "{}\n", "utf8");
      },
    },
    {
      name: "remove",
      async prepare(fixture) {
        await fs.writeFile(path.join(fixture.projectRoot, ".sdlc", "victim.json"), "{}\n", "utf8");
      },
      async mutate(fixture) {
        await fs.rm(path.join(fixture.projectRoot, ".sdlc", "victim.json"));
      },
    },
    {
      name: "rename",
      async prepare(fixture) {
        await fs.writeFile(path.join(fixture.projectRoot, ".sdlc", "before.json"), "{}\n", "utf8");
      },
      async mutate(fixture) {
        await fs.rename(
          path.join(fixture.projectRoot, ".sdlc", "before.json"),
          path.join(fixture.projectRoot, ".sdlc", "after.json"),
        );
      },
    },
    {
      name: "content",
      async mutate(fixture) {
        await writeProjectRecord(fixture.projectRoot, { version: 200 });
      },
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async (scenarioTest) => {
      const fixture = await createCacheFixture(scenarioTest);
      await scenario.prepare?.(fixture);
      let builds = 0;
      let fastChecks = 0;
      const cache = createObservatoryModelCache({
        projectRoot: fixture.projectRoot,
        buildModel() {
          builds += 1;
          return { builds };
        },
        onFastPathCheck(event) {
          if (event.event === "start") fastChecks += 1;
        },
      });
      const initial = await cache.get();
      await scenario.mutate(fixture);
      const refreshed = await cache.get();
      assert.ok(fastChecks > 0);
      assert.equal(builds, 2);
      assert.notEqual(refreshed.etag, initial.etag);
    });
  }

  await t.test("symlink", async (scenarioTest) => {
    if (process.platform === "win32") {
      scenarioTest.skip("Symlink retargeting requires Unix semantics");
      return;
    }
    const fixture = await createCacheFixture(scenarioTest);
    await fs.writeFile(path.join(fixture.projectRoot, "target-a.json"), "{}\n", "utf8");
    await fs.writeFile(path.join(fixture.projectRoot, "target-b.json"), "{}\n", "utf8");
    const link = path.join(fixture.projectRoot, ".sdlc", "linked.json");
    await fs.symlink("../target-a.json", link, "file");
    let builds = 0;
    const cache = createObservatoryModelCache({
      projectRoot: fixture.projectRoot,
      buildModel() {
        builds += 1;
        return { builds };
      },
    });
    const initial = await cache.get();
    await fs.rm(link);
    await fs.symlink("../target-b.json", link, "file");
    const refreshed = await cache.get();
    assert.equal(builds, 2);
    assert.notEqual(refreshed.etag, initial.etag);
  });
});

test("fast validation enforces bounded concurrency", async (t) => {
  const fixture = await createCacheFixture(t);
  for (let index = 0; index < 12; index += 1) {
    await fs.writeFile(
      path.join(fixture.projectRoot, ".sdlc", `record-${String(index).padStart(2, "0")}.json`),
      `${JSON.stringify({ index })}\n`,
      "utf8",
    );
  }

  let active = 0;
  let maximum = 0;
  let starts = 0;
  let builds = 0;
  const cache = createObservatoryModelCache({
    projectRoot: fixture.projectRoot,
    validationConcurrency: 3,
    buildModel() {
      builds += 1;
      return { builds };
    },
    async onFastPathCheck(event) {
      if (event.event === "start") {
        active += 1;
        starts += 1;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setTimeout(resolve, 2));
      } else {
        active -= 1;
      }
    },
  });

  const cold = await cache.get();
  const warm = await cache.get();
  assert.equal(warm, cold);
  assert.equal(builds, 1);
  assert.ok(starts > 3);
  assert.equal(maximum, 3);
  assert.equal(active, 0);
});

test("model cache is single-flight, reuses serialized bytes, and invalidates by revision", async (t) => {
  const fixture = await createCacheFixture(t);
  let releaseBuild;
  const buildGate = new Promise((resolve) => {
    releaseBuild = resolve;
  });
  let builds = 0;
  const cache = createObservatoryModelCache({
    projectRoot: fixture.projectRoot,
    async buildModel() {
      builds += 1;
      if (builds === 1) await buildGate;
      return readProjectRecord(fixture.projectRoot);
    },
  });

  const pending = Array.from({ length: 24 }, () => cache.get());
  await waitFor(() => builds === 1);
  releaseBuild();
  const entries = await Promise.all(pending);

  assert.equal(builds, 1);
  assert.ok(entries.every((entry) => entry === entries[0]));
  assert.match(entries[0].etag, /^"sha256-[A-Za-z0-9_-]+"$/);
  assert.equal(JSON.parse(entries[0].body.toString("utf8")).version, 1);

  const warm = await cache.get();
  assert.equal(warm, entries[0]);
  assert.equal(builds, 1);

  const concurrentWarm = await Promise.all(Array.from({ length: 24 }, () => cache.get()));
  assert.ok(concurrentWarm.every((entry) => entry === warm));
  assert.equal(builds, 1);

  await fs.mkdir(path.join(fixture.projectRoot, ".sdlc", "cache"), { recursive: true });
  await fs.writeFile(path.join(fixture.projectRoot, ".sdlc", "cache", "temporary.json"), "{}\n");
  assert.equal(await cache.get(), warm);
  assert.equal(builds, 1);

  await writeProjectRecord(fixture.projectRoot, { version: 2 });
  const refreshed = await cache.get();
  assert.equal(builds, 2);
  assert.equal(JSON.parse(refreshed.body.toString("utf8")).version, 2);
  assert.notEqual(refreshed.etag, warm.etag);
});

test("model cache retries a build when canonical evidence changes during normalization", async (t) => {
  const fixture = await createCacheFixture(t);
  let builds = 0;
  const cache = createObservatoryModelCache({
    projectRoot: fixture.projectRoot,
    async buildModel() {
      builds += 1;
      const model = await readProjectRecord(fixture.projectRoot);
      if (builds === 1) {
        await writeProjectRecord(fixture.projectRoot, { version: 2 });
      }
      return model;
    },
  });

  const entry = await cache.get();
  assert.equal(builds, 2);
  assert.equal(JSON.parse(entry.body.toString("utf8")).version, 2);
});

test("failed builds are not cached", async (t) => {
  const fixture = await createCacheFixture(t);
  let builds = 0;
  const cache = createObservatoryModelCache({
    projectRoot: fixture.projectRoot,
    async buildModel() {
      builds += 1;
      if (builds === 1) throw new Error("normalization failed");
      return { ok: true };
    },
  });

  await assert.rejects(() => cache.get(), /normalization failed/);
  assert.equal(JSON.parse((await cache.get()).body.toString("utf8")).ok, true);
  assert.equal(builds, 2);
});

test("a cached model is not served after the canonical knowledge-base boundary becomes a symlink", async (t) => {
  if (process.platform === "win32") t.skip("Knowledge-base swap coverage requires Unix symlink semantics");

  const fixture = await createCacheFixture(t);
  const cache = createObservatoryModelCache({
    projectRoot: fixture.projectRoot,
    buildModel: () => readProjectRecord(fixture.projectRoot),
  });
  await cache.get();

  const canonical = path.join(fixture.projectRoot, ".sdlc");
  const hidden = path.join(fixture.projectRoot, "hidden-sdlc");
  await fs.rename(canonical, hidden);
  await fs.symlink("hidden-sdlc", canonical, "dir");

  await assert.rejects(
    () => cache.get(),
    (error) => error?.code === "knowledge_base_symlink" && error?.statusCode === 403,
  );
});

async function createCacheFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "change-observatory-model-cache-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const projectRoot = path.join(root, "project");
  await fs.mkdir(path.join(projectRoot, ".sdlc"), { recursive: true });
  await writeProjectRecord(projectRoot, { version: 1 });
  return { projectRoot };
}

function writeProjectRecord(projectRoot, data) {
  return fs.writeFile(
    path.join(projectRoot, ".sdlc", "project.json"),
    `${JSON.stringify(data)}\n`,
    "utf8",
  );
}

async function readProjectRecord(projectRoot) {
  return JSON.parse(await fs.readFile(path.join(projectRoot, ".sdlc", "project.json"), "utf8"));
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("Timed out waiting for the model build");
}
