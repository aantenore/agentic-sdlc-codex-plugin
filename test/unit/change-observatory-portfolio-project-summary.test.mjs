import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  MAX_PROJECT_SUMMARY_FILES,
  buildProjectPortfolioSummary,
} from "../../lib/change-observatory/portfolio-project-summary.mjs";

test("reads only bounded summary records and derives versioned delivery aggregates", async (t) => {
  const root = await fixture(t, "aggregates");
  await writeJson(root, ".sdlc/project.json", {
    project_id: "project-alpha",
    project_name: "Alpha",
    default_branch: "main",
  });
  await writeJson(root, ".sdlc/requirements/REQ-1.json", {
    id: "REQ-1",
    title: "Ship portfolio summary",
    summary: "Bounded status",
    status: "approved",
  });
  await writeJson(root, ".sdlc/stories/ST-1/story.json", {
    id: "ST-1",
    status: "active",
    phase: "implementation",
  });
  await writeJson(root, ".sdlc/risks/RISK-1.json", {
    id: "RISK-1",
    type: "risk",
    status: "open",
    severity: "medium",
  });
  await writeJson(root, ".sdlc/budgets/BUDGET-1.json", {
    id: "BUDGET-1",
    status: "exceeded",
    used: 11,
    limit: 10,
  });
  await writeJson(root, ".sdlc/dependencies/graph.json", {
    id: "GRAPH-1",
    edges: [{ id: "DEP-1", from: "ST-1", to: "ST-2", status: "blocked" }],
  });
  await writeJson(root, ".sdlc/releases/REL-1.json", {
    id: "REL-1",
    type: "release",
    status: "failed",
  });
  await writeJson(root, ".sdlc/reports/gate.json", {
    id: "GATE-1",
    status: "needs_user_input",
  });
  // A detail-only root record is deliberately outside every allowlisted
  // summary target and must never affect the compact projection.
  await writeJson(root, ".sdlc/detail-only.json", {
    id: "DETAIL-ONLY-CANARY",
    status: "failed",
    path: "/private/customer/repository",
  });

  const summary = await buildProjectPortfolioSummary(root, {
    clock: () => new Date("2026-07-19T13:00:00Z"),
  });
  const serialized = JSON.stringify(summary);

  assert.equal(summary.schemaVersion, "change-observatory:portfolio-project-summary:v1");
  assert.equal(summary.aggregates.schemaVersion, "change-observatory:portfolio-aggregates:v1");
  assert.equal(summary.generatedAt, "2026-07-19T13:00:00.000Z");
  assert.equal(summary.health, "needs_attention");
  assert.equal(summary.aggregates.activeWorkflows.count, 1);
  assert.equal(summary.aggregates.risks.count, 1);
  assert.equal(summary.aggregates.budgets.count, 1);
  assert.equal(summary.aggregates.budgets.items[0].health, "exceeded");
  assert.equal(summary.aggregates.dependencies.count, 1);
  assert.equal(summary.aggregates.releases.count, 1);
  assert.ok(summary.aggregates.blockers.count >= 3);
  assert.ok(summary.previews.length <= 8);
  assert.doesNotMatch(serialized, /DETAIL-ONLY-CANARY|private\/customer|\.sdlc/u);
});

test("summary scan has deterministic file and byte bounds", async (t) => {
  const root = await fixture(t, "bounds");
  await writeJson(root, ".sdlc/project.json", { project_id: "bounded" });
  for (let index = 0; index < MAX_PROJECT_SUMMARY_FILES + 32; index += 1) {
    await writeJson(root, `.sdlc/requirements/REQ-${String(index).padStart(3, "0")}.json`, {
      id: `REQ-${index}`,
      status: "approved",
    });
  }

  const summary = await buildProjectPortfolioSummary(root);

  assert.equal(summary.scan.truncated, true);
  assert.ok(summary.scan.filesRead <= MAX_PROJECT_SUMMARY_FILES);
  assert.ok(summary.scan.bytesRead <= 2 * 1024 * 1024);
  assert.equal(summary.health, "review");
  assert.ok(summary.previews.length <= 8);
});

test("terminal story evidence wins over earlier active records", async (t) => {
  const root = await fixture(t, "terminal");
  await writeJson(root, ".sdlc/project.json", { project_id: "terminal" });
  await writeJson(root, ".sdlc/stories/ST-1/claim.json", {
    story_id: "ST-1",
    status: "released",
  });
  await writeJson(root, ".sdlc/stories/ST-1/story.json", {
    id: "ST-1",
    status: "active",
  });

  const summary = await buildProjectPortfolioSummary(root);

  assert.equal(summary.aggregates.activeWorkflows.count, 0);
});

async function fixture(t, name) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), `portfolio-summary-${name}-`)));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, ".sdlc"), { recursive: true });
  return root;
}

async function writeJson(root, relativePath, value) {
  const target = path.join(root, ...relativePath.split("/"));
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${JSON.stringify(value)}\n`, "utf8");
}
