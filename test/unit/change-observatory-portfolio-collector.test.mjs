import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_PORTFOLIO_COLLECTION_CONCURRENCY,
  MAX_PORTFOLIO_PROJECT_PREVIEWS,
  PORTFOLIO_VIEW_SCHEMA_VERSION,
  collectPortfolioSummary,
} from "../../lib/change-observatory/portfolio-collector.mjs";

test("collects in manifest order with a hard four-worker ceiling", async () => {
  const projects = Array.from({ length: 12 }, (_, index) => ({ id: `project-${index}` }));
  let active = 0;
  let maximumActive = 0;
  const summary = await collectPortfolioSummary(projects, {
    clock: () => new Date("2026-07-19T09:30:00Z"),
    async loadProject(project) {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      // Later manifest entries complete first, proving result order is not
      // coupled to worker completion order.
      const index = Number(project.id.split("-").at(-1));
      await new Promise((resolve) => setTimeout(resolve, (12 - index) * 2));
      active -= 1;
      return model(project.id);
    },
  });

  assert.equal(maximumActive, MAX_PORTFOLIO_COLLECTION_CONCURRENCY);
  assert.deepEqual(summary.projects.map((project) => project.id), projects.map((project) => project.id));
  assert.equal(summary.schemaVersion, PORTFOLIO_VIEW_SCHEMA_VERSION);
  assert.equal(summary.generatedAt, "2026-07-19T09:30:00.000Z");
  assert.equal(summary.status, "ready");
  assert.equal(summary.availableProjectCount, 12);
});

test("isolates project failures with safe human-readable messages", async () => {
  const canary = "CANARY-ERROR-/private/customer/repository";
  const summary = await collectPortfolioSummary([
    { id: "alpha" },
    { id: "broken" },
    { id: "omega" },
  ], {
    loadProject(project) {
      if (project.id === "broken") {
        const error = new Error(canary);
        error.code = "observability_configuration_invalid";
        throw error;
      }
      return model(project.id);
    },
  });

  assert.equal(summary.status, "degraded");
  assert.equal(summary.availableProjectCount, 2);
  assert.equal(summary.unavailableProjectCount, 1);
  assert.deepEqual(summary.projects.map((project) => project.status), [
    "available",
    "unavailable",
    "available",
  ]);
  assert.match(summary.projects[1].message, /privacy settings/u);
  assert.doesNotMatch(JSON.stringify(summary), /CANARY-ERROR|private\/customer/u);
});

test("keeps summaries compact and strips every source-bearing field", async () => {
  const oversized = model("alpha", { previewCount: 20 });
  oversized.records = [{
    id: "DETAIL-ONLY-MARKER",
    path: ".sdlc/private.json",
    rawHref: "/api/v1/source?path=.sdlc%2Fprivate.json",
    sourceRefs: [{ path: ".sdlc/private.json" }],
  }];
  oversized.previews[0].sourceRefs = [{ path: ".sdlc/requirements/private.json" }];
  oversized.previews[0].rawHref = "/api/v1/source?path=.sdlc%2Frequirements%2Fprivate.json";

  const summary = await collectPortfolioSummary([{ id: "alpha" }], {
    loadProject: () => oversized,
  });
  const serialized = JSON.stringify(summary);

  assert.equal(summary.projects[0].previews.length, MAX_PORTFOLIO_PROJECT_PREVIEWS);
  assert.equal(serialized.includes("DETAIL-ONLY-MARKER"), false);
  assert.deepEqual(findForbiddenKeys(summary), []);
  assert.doesNotMatch(serialized, /\.sdlc|private\.json/u);
});

test("publishes versioned bounded delivery aggregates and derives degraded health", async () => {
  const healthy = model("healthy");
  const blocked = model("blocked", { health: "needs_attention" });
  blocked.aggregates.blockers = {
    count: 12,
    items: Array.from({ length: 12 }, (_, index) => ({
      id: `BLOCK-${index}`,
      status: "blocked",
      path: `/private/${index}`,
    })),
    truncated: false,
  };

  const summary = await collectPortfolioSummary([
    { id: "healthy" },
    { id: "blocked" },
  ], {
    loadProject(project) {
      return project.id === "healthy" ? healthy : blocked;
    },
  });

  assert.equal(summary.status, "degraded");
  assert.equal(summary.health, "needs_attention");
  assert.equal(summary.needsAttentionProjectCount, 1);
  assert.equal(summary.aggregates.schemaVersion, "change-observatory:portfolio-aggregates:v1");
  assert.equal(summary.aggregates.blockers.count, 12);
  assert.equal(summary.aggregates.blockers.affectedProjects, 1);
  assert.equal(summary.projects[1].aggregates.blockers.items.length, 8);
  assert.equal(summary.projects[1].aggregates.blockers.truncated, true);
  assert.doesNotMatch(JSON.stringify(summary), /\/private\//u);
});

test("rejects attempts to raise collection concurrency above four", async () => {
  await assert.rejects(
    () => collectPortfolioSummary([{ id: "alpha" }], {
      concurrency: MAX_PORTFOLIO_COLLECTION_CONCURRENCY + 1,
      loadProject: () => model("alpha"),
    }),
    /between 1 and 4/u,
  );
});

function model(id, { previewCount = 1, health = "ready" } = {}) {
  const items = Array.from({ length: previewCount }, (_, index) => ({
    kind: "asked",
    id: `${id}-${index}`,
    type: "requirement",
    title: `Title ${index}`,
    summary: `Summary ${index}`,
    status: "approved",
    phase: "implementation",
    timestamp: "2026-07-19T09:00:00.000Z",
    provenance: "recorded",
  }));
  const emptyBucket = () => ({ count: 0, items: [], truncated: false });
  return {
    schemaVersion: "change-observatory:portfolio-project-summary:v1",
    project: { id, name: `Project ${id}`, branch: "main" },
    health,
    counts: {
      asked: items.length,
      changed: 0,
      decided: 0,
      iterations: 0,
      contracts: 0,
      decisions: 0,
      changes: 0,
      verification: 0,
      diagnostics: 0,
    },
    previews: items,
    aggregates: {
      schemaVersion: "change-observatory:portfolio-aggregates:v1",
      activeWorkflows: emptyBucket(),
      blockers: emptyBucket(),
      risks: emptyBucket(),
      budgets: emptyBucket(),
      dependencies: emptyBucket(),
      releases: emptyBucket(),
    },
  };
}

function findForbiddenKeys(value) {
  const forbidden = new Set(["path", "rawHref", "sourceRefs"]);
  const found = [];
  const pending = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || typeof current !== "object") continue;
    for (const [key, child] of Object.entries(current)) {
      if (forbidden.has(key)) found.push(key);
      pending.push(child);
    }
  }
  return found;
}
