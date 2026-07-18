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
  oversized.summary.asked[0].sourceRefs = [{ path: ".sdlc/requirements/private.json" }];
  oversized.summary.asked[0].rawHref = "/api/v1/source?path=.sdlc%2Frequirements%2Fprivate.json";

  const summary = await collectPortfolioSummary([{ id: "alpha" }], {
    loadProject: () => oversized,
  });
  const serialized = JSON.stringify(summary);

  assert.equal(summary.projects[0].previews.length, MAX_PORTFOLIO_PROJECT_PREVIEWS);
  assert.equal(serialized.includes("DETAIL-ONLY-MARKER"), false);
  assert.deepEqual(findForbiddenKeys(summary), []);
  assert.doesNotMatch(serialized, /\.sdlc|private\.json/u);
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

function model(id, { previewCount = 1 } = {}) {
  const items = Array.from({ length: previewCount }, (_, index) => ({
    id: `${id}-${index}`,
    type: "requirement",
    title: `Title ${index}`,
    summary: `Summary ${index}`,
    status: "approved",
    phase: "implementation",
    timestamp: "2026-07-19T09:00:00.000Z",
    provenance: "recorded",
  }));
  return {
    schemaVersion: "change-observatory:view:v1",
    project: { id, name: `Project ${id}`, branch: "main" },
    summary: { asked: items, changed: items, decided: items },
    iterations: [],
    contracts: [],
    decisions: [],
    changes: [],
    verification: [],
    diagnostics: [],
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
