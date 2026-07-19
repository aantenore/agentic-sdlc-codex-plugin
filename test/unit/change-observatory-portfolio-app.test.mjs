import assert from "node:assert/strict";
import test from "node:test";

import {
  createChangeObservatoryBrowser,
  waitForBrowser,
} from "../helpers/change-observatory-browser-dom.mjs";

test("portfolio app owns project state across delayed navigation and browser history", async (t) => {
  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  const browser = createChangeObservatoryBrowser(
    "http://127.0.0.1:43127/?mode=portfolio&project=alpha#overview",
  );
  const delayedBeta = deferred();
  let betaRequests = 0;
  const calls = [];

  globalThis.document = browser.document;
  globalThis.window = browser.window;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (url === "/api/v1/portfolio") return jsonResponse(portfolioSummary());
    const projectId = new URL(String(url), "http://observatory.invalid").searchParams.get("project");
    if (projectId === "beta" && betaRequests++ === 0) return delayedBeta.promise;
    return jsonResponse(projectView(projectId));
  };
  t.after(() => {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    globalThis.fetch = previousFetch;
  });

  await import(`../../ui/change-observatory/app.js?portfolio-app-test=${Date.now()}`);
  await waitForBrowser(
    () => rawHrefs(browser.document).some((href) => href.includes("project=alpha")),
    "the initial portfolio deep link did not load alpha",
  );
  assert.match(browser.document.querySelector("#primary-view").textContent, /Alpha change/u);
  assert.match(browser.document.querySelector("#diagnostics-region").textContent, /alpha_diagnostic/u);
  assert.equal(browser.document.querySelectorAll("h1").length, 1);
  assert.equal(browser.document.querySelector("#workspace-heading").textContent, "Alpha Project · Overview");
  assert.equal(browser.document.querySelector("#skip-link").textContent, "Skip to project evidence: Alpha Project");
  assert.equal(
    browser.document.querySelector("#primary-view").getAttribute("aria-labelledby"),
    "workspace-heading",
  );
  assert.equal(browser.window.location.search, "?mode=portfolio&project=alpha");

  const projectSelect = browser.document.querySelector("#project-select");
  projectSelect.value = "beta";
  browser.document.dispatch("change", projectSelect);
  await waitForBrowser(
    () => /Loading project evidence/u.test(
      browser.document.querySelector("#primary-view").textContent,
    ),
    "beta did not enter its loading presentation",
  );

  assert.equal(browser.window.location.search, "?mode=portfolio&project=beta");
  assert.doesNotMatch(browser.document.querySelector("#primary-view").textContent, /Alpha/u);
  assert.equal(browser.document.querySelector("#diagnostics-region").textContent, "");
  assert.deepEqual(rawHrefs(browser.document), []);

  browser.window.replaceAndDispatch(
    "/?mode=portfolio&project=beta#changes",
    "hashchange",
  );
  assert.match(browser.document.querySelector("#primary-view").textContent, /Beta Project/u);
  assert.doesNotMatch(browser.document.querySelector("#primary-view").textContent, /Alpha/u);
  assert.deepEqual(rawHrefs(browser.document), []);

  delayedBeta.resolve(jsonResponse(projectView("beta")));
  await waitForBrowser(
    () => rawHrefs(browser.document).some((href) => href.includes("project=beta")),
    "beta did not replace its loading presentation",
  );
  assert.ok(rawHrefs(browser.document).every((href) => href.includes("project=beta")));
  assert.doesNotMatch(browser.document.querySelector("#primary-view").textContent, /Alpha/u);
  assert.match(browser.document.querySelector("#primary-view").textContent, /Beta change/u);

  browser.window.history.back();
  await waitForBrowser(
    () => rawHrefs(browser.document).some((href) => href.includes("project=alpha")),
    "Back did not restore alpha",
  );
  assert.equal(browser.window.location.search, "?mode=portfolio&project=alpha");
  assert.ok(rawHrefs(browser.document).every((href) => href.includes("project=alpha")));

  browser.window.history.forward();
  await waitForBrowser(
    () => rawHrefs(browser.document).some((href) => href.includes("project=beta")),
    "Forward did not restore beta",
  );
  assert.equal(browser.window.location.hash, "#changes");
  assert.ok(rawHrefs(browser.document).every((href) => href.includes("project=beta")));

  browser.window.history.pushState(
    null,
    "",
    "/?mode=portfolio&project=missing#overview",
  );
  browser.window.dispatchEvent({ type: "popstate" });
  await waitForBrowser(
    () => browser.document.querySelector("#workspace-heading").textContent
      === "Portfolio overview",
    "an unknown project did not fall back to the portfolio overview",
  );
  assert.equal(browser.window.location.search, "?mode=portfolio");
  assert.deepEqual(rawHrefs(browser.document), []);
  assert.ok(calls.includes("/api/v1/portfolio/project?project=alpha"));
  assert.ok(calls.includes("/api/v1/portfolio/project?project=beta"));
});

function rawHrefs(document) {
  return document.querySelectorAll("[data-raw-href]").map((node) => node.dataset.rawHref);
}

function deferred() {
  let resolve;
  const promise = new Promise((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function portfolioSummary() {
  const counts = {
    asked: 1,
    changed: 1,
    decided: 0,
    iterations: 0,
    contracts: 0,
    decisions: 0,
    changes: 1,
    verification: 0,
    diagnostics: 1,
  };
  return {
    schemaVersion: "change-observatory:portfolio:v1",
    generatedAt: "2026-07-19T12:00:00.000Z",
    status: "ready",
    health: "ready",
    projectCount: 2,
    availableProjectCount: 2,
    unavailableProjectCount: 0,
    needsAttentionProjectCount: 0,
    reviewProjectCount: 0,
    projects: ["alpha", "beta"].map((id) => ({
      id,
      status: "available",
      health: "ready",
      name: `${capitalized(id)} Project`,
      counts,
      previews: [{
        kind: "changed",
        title: `${capitalized(id)} preview`,
        summary: `${capitalized(id)} bounded preview.`,
        status: "recorded",
      }],
    })),
  };
}

function projectView(id) {
  const name = capitalized(id);
  const path = `.sdlc/changes/${id}.json`;
  const change = {
    id: `CHANGE-${name.toUpperCase()}`,
    type: "implementation",
    title: `${name} change`,
    summary: `${name} project evidence.`,
    status: "recorded",
    provenance: "recorded",
    sourceRefs: [{ path }],
  };
  return {
    schemaVersion: "change-observatory:view:v1",
    generatedAt: "2026-07-19T12:00:00.000Z",
    project: { id: `${id}-project`, name: `${name} Project`, branch: "main" },
    snapshots: { counts: {}, phaseCounts: {} },
    summary: { asked: [], changed: [change], decided: [] },
    iterations: [],
    contracts: [],
    decisions: [],
    changes: [change],
    verification: [],
    records: [{
      path,
      kind: "implementation",
      provenance: "recorded",
      rawHref: `/api/v1/source?path=${encodeURIComponent(path)}`,
    }],
    diagnostics: id === "alpha" ? [{
      code: "alpha_diagnostic",
      severity: "warning",
      message: "Alpha diagnostic.",
      provenance: "recorded",
    }] : [],
  };
}

function capitalized(value) {
  return `${value[0].toUpperCase()}${value.slice(1)}`;
}
