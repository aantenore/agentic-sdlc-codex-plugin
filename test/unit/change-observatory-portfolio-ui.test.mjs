import assert from "node:assert/strict";
import test from "node:test";

import { ObservatoryApi } from "../../ui/change-observatory/api.js";
import {
  applyWorkspaceContext,
  renderPortfolioControls,
  renderPortfolioOverview,
  renderPortfolioUnavailable,
} from "../../ui/change-observatory/portfolio-components.js";
import {
  LatestRequestCoordinator,
  normalizePortfolioSummary,
  portfolioModeFromLocation,
  portfolioProjectRouteFromLocation,
  portfolioRouteHref,
} from "../../ui/change-observatory/portfolio.js";
import { rawTargetFor, safeRawHref } from "../../ui/change-observatory/model.js";
import { setLocale } from "../../ui/change-observatory/i18n.js";
import { createChangeObservatoryBrowser } from "../helpers/change-observatory-browser-dom.mjs";

test("portfolio mode is enabled only by the explicit launch query", () => {
  assert.equal(portfolioModeFromLocation({ search: "?mode=portfolio" }), true);
  assert.equal(portfolioModeFromLocation({ search: "" }), false);
  assert.equal(portfolioModeFromLocation({ search: "?mode=project" }), false);
  assert.equal(portfolioModeFromLocation({ search: "?mode=portfolio&mode=portfolio" }), false);
});

test("portfolio project routes accept one bounded ID and preserve safe launch parameters", () => {
  assert.deepEqual(
    portfolioProjectRouteFromLocation({ search: "?mode=portfolio&project=alpha" }),
    { projectId: "alpha", valid: true },
  );
  assert.deepEqual(
    portfolioProjectRouteFromLocation({ search: "?mode=portfolio" }),
    { projectId: null, valid: true },
  );
  for (const search of [
    "?mode=portfolio&project=alpha&project=beta",
    "?mode=portfolio&project=..%2Fbeta",
    "?mode=portfolio&project=",
  ]) {
    assert.deepEqual(
      portfolioProjectRouteFromLocation({ search }),
      { projectId: null, valid: false },
    );
  }

  assert.equal(
    portfolioRouteHref(
      {
        pathname: "/index.html",
        search: "?mode=portfolio&locale=it&project=alpha&access_token=discarded&extra=discarded",
      },
      { projectId: "beta", view: "intent-evidence" },
    ),
    "/index.html?mode=portfolio&locale=it&project=beta#intent-evidence",
  );
  assert.equal(
    portfolioRouteHref(
      { pathname: "/", search: "?mode=portfolio&project=alpha" },
      { projectId: null, view: "overview" },
    ),
    "/?mode=portfolio#overview",
  );
  assert.throws(
    () => portfolioRouteHref({}, { projectId: "../beta" }),
    /project identifier is invalid/u,
  );
  assert.throws(
    () => portfolioRouteHref({}, { projectId: "alpha", view: "#changes" }),
    /view fragment is invalid/u,
  );
});

test("normalizes a bounded manifest-order summary and rejects inconsistent counts", () => {
  const normalized = normalizePortfolioSummary(portfolioSummary());
  assert.deepEqual(normalized.projects.map((project) => project.id), ["alpha", "beta"]);
  assert.equal(normalized.projects[0].previews.length, 1);
  assert.equal(normalized.projects[1].status, "unavailable");

  assert.throws(
    () => normalizePortfolioSummary(portfolioSummary({ projectCount: 3 })),
    /counts do not match/u,
  );
  const duplicate = portfolioSummary();
  duplicate.projects[1] = { ...duplicate.projects[1], id: "alpha" };
  assert.throws(() => normalizePortfolioSummary(duplicate), /duplicate project/u);
});

test("latest-request coordination aborts old work and rejects stale completions", () => {
  const coordinator = new LatestRequestCoordinator();
  const first = coordinator.begin();
  const second = coordinator.begin();
  assert.equal(first.signal.aborted, true);
  assert.equal(first.isCurrent(), false);
  assert.equal(second.isCurrent(), true);
  coordinator.cancel();
  assert.equal(second.signal.aborted, true);
  assert.equal(second.isCurrent(), false);
});

test("API loads only the portfolio summary until one project is selected", async () => {
  const calls = [];
  const api = new ObservatoryApi({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const payload = url === "/api/v1/portfolio"
        ? portfolioSummary()
        : projectView();
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const summary = await api.loadPortfolio();
  assert.equal(summary.projectCount, 2);
  assert.deepEqual(calls.map((call) => call.url), ["/api/v1/portfolio"]);

  const project = await api.loadProject("alpha");
  assert.equal(project.project.id, "alpha-project");
  assert.deepEqual(calls.map((call) => call.url), [
    "/api/v1/portfolio",
    "/api/v1/portfolio/project?project=alpha",
  ]);
  assert.ok(calls.every((call) => call.options.cache === "no-store"));
});

test("raw evidence remains scoped to the selected manifest project", () => {
  const href = "/api/v1/portfolio/source?project=alpha&path=.sdlc%2Fproject.json";
  assert.equal(safeRawHref(href), href);
  assert.equal(
    safeRawHref("/api/v1/portfolio/source?project=alpha&path=.sdlc%2Fproject.json&extra=1"),
    null,
  );
  assert.equal(
    safeRawHref("/api/v1/portfolio/source?project=..%2Fbeta&path=.sdlc%2Fproject.json"),
    null,
  );
  assert.deepEqual(rawTargetFor({
    rawHref: "/api/v1/source?path=.sdlc%2Fproject.json",
    sourceRefs: [{ path: ".sdlc/project.json" }],
  }, { portfolioProjectId: "alpha" }), {
    href,
    path: ".sdlc/project.json",
  });
});

test("portfolio controls and cards are keyboard-native, labelled, and localized", (t) => {
  const previousDocument = globalThis.document;
  const projectSelect = new FakeNode("select");
  const snapshotSelect = new FakeNode("select");
  globalThis.document = fakeDocument({ projectSelect, snapshotSelect });
  t.after(() => {
    globalThis.document = previousDocument;
    setLocale("en");
  });

  const summary = normalizePortfolioSummary(portfolioSummary());
  for (const locale of ["en", "it"]) {
    setLocale(locale);
    renderPortfolioControls(summary, "alpha");
    assert.equal(projectSelect.disabled, false);
    assert.equal(projectSelect.children[0].attributes.get("value"), "");
    assert.equal(
      projectSelect.attributes.get("aria-label"),
      locale === "it" ? "Scegli un progetto del portfolio" : "Choose a portfolio project",
    );

    const overview = new FakeNode("main");
    renderPortfolioOverview(overview, summary);
    const actions = descendants(overview, (node) => node.dataset.action === "select-project");
    assert.equal(actions.length, 2);
    assert.ok(actions.every((button) => button.tagName === "button"));
    assert.ok(actions.every((button) => button.attributes.get("type") === "button"));
    assert.ok(actions.every((button) => button.attributes.get("aria-label")));
    assert.match(
      overview.textContent,
      locale === "it" ? /Scegli un progetto/u : /Choose a project/u,
    );
    assert.equal(descendants(overview, (node) => node.tagName === "h1").length, 0);

    const unavailable = new FakeNode("main");
    renderPortfolioUnavailable(unavailable, summary.projects[1]);
    assert.equal(unavailable.children[0].attributes.get("role"), "status");
    assert.equal(descendants(unavailable, (node) => node.tagName === "h1").length, 0);
    assert.match(
      unavailable.textContent,
      locale === "it" ? /non sono disponibili/u : /evidence is unavailable/u,
    );
  }
});

test("workspace heading, region, and skip link stay contextual in English and Italian", (t) => {
  const previousDocument = globalThis.document;
  const browser = createChangeObservatoryBrowser("http://127.0.0.1/?mode=portfolio");
  globalThis.document = browser.document;
  t.after(() => {
    globalThis.document = previousDocument;
    setLocale("en");
  });

  for (const locale of ["en", "it"]) {
    setLocale(locale);
    const portfolioCopy = applyWorkspaceContext({ portfolioOverview: true });
    assert.equal(
      portfolioCopy.heading,
      locale === "it" ? "Panoramica del portfolio" : "Portfolio overview",
    );
    assert.equal(
      portfolioCopy.skipLabel,
      locale === "it"
        ? "Vai alla panoramica del portfolio"
        : "Skip to portfolio overview",
    );

    const projectCopy = applyWorkspaceContext({
      projectName: "Alpha Project",
      label: "Overview",
    });
    assert.equal(
      projectCopy.heading,
      locale === "it" ? "Alpha Project · Panoramica" : "Alpha Project · Overview",
    );
    assert.equal(
      projectCopy.skipLabel,
      locale === "it"
        ? "Vai alle prove del progetto: Alpha Project"
        : "Skip to project evidence: Alpha Project",
    );
    assert.equal(browser.document.querySelectorAll("h1").length, 1);
    for (const selector of ["#workspace", "#primary-view"]) {
      assert.equal(
        browser.document.querySelector(selector).getAttribute("aria-labelledby"),
        "workspace-heading",
      );
    }
  }
});

function portfolioSummary(overrides = {}) {
  const emptyCounts = {
    asked: 0,
    changed: 0,
    decided: 0,
    iterations: 0,
    contracts: 0,
    decisions: 0,
    changes: 0,
    verification: 0,
    diagnostics: 0,
  };
  return {
    schemaVersion: "change-observatory:portfolio:v1",
    generatedAt: "2026-07-19T12:00:00.000Z",
    status: "degraded",
    health: "needs_attention",
    projectCount: 2,
    availableProjectCount: 1,
    unavailableProjectCount: 1,
    needsAttentionProjectCount: 0,
    reviewProjectCount: 0,
    projects: [
      {
        id: "alpha",
        status: "available",
        health: "ready",
        name: "Alpha Project",
        counts: { ...emptyCounts, asked: 1 },
        previews: [{
          kind: "asked",
          title: "Recorded request",
          summary: "A bounded project request.",
          status: "approved",
        }],
      },
      {
        id: "beta",
        status: "unavailable",
        health: "unavailable",
        name: "Beta Project",
        errorCode: "observability_configuration_invalid",
        counts: emptyCounts,
        previews: [],
      },
    ],
    ...overrides,
  };
}

function projectView() {
  return {
    schemaVersion: "change-observatory:view:v1",
    generatedAt: "2026-07-19T12:00:00.000Z",
    project: { id: "alpha-project", name: "Alpha Project", branch: "main" },
    snapshots: { counts: {}, phaseCounts: {} },
    summary: { asked: [], changed: [], decided: [] },
    iterations: [],
    contracts: [],
    decisions: [],
    changes: [],
    verification: [],
    records: [],
    diagnostics: [],
  };
}

class FakeNode {
  constructor(tagName = null, text = "") {
    this.tagName = tagName;
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.className = "";
    this.disabled = false;
    this.selected = false;
    this._text = String(text ?? "");
  }

  append(...children) {
    this.children.push(...children.filter((child) => child !== null && child !== undefined));
  }

  replaceChildren(...children) {
    this.children = children.filter((child) => child !== null && child !== undefined);
    this._text = "";
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  get textContent() {
    return `${this._text}${this.children.map((child) => child.textContent ?? "").join("")}`;
  }

  set textContent(value) {
    this._text = String(value ?? "");
    this.children = [];
  }
}

function fakeDocument({ projectSelect, snapshotSelect }) {
  return {
    createElement: (tagName) => new FakeNode(tagName),
    querySelector(selector) {
      if (selector === "#project-select") return projectSelect;
      if (selector === "#snapshot-select") return snapshotSelect;
      return null;
    },
  };
}

function descendants(root, predicate) {
  const found = [];
  const visit = (current) => {
    if (predicate(current)) found.push(current);
    for (const child of current?.children ?? []) visit(child);
  };
  visit(root);
  return found;
}
