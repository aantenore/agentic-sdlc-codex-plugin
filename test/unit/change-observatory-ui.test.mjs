import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  ObservatoryApi,
  ObservatoryApiError,
  accessTokenFromHash,
} from "../../ui/change-observatory/api.js";
import {
  PHASES,
  VIEW_MODEL_SCHEMA,
  filterIterations,
  groupChangesByIntent,
  isCanonicalEvidencePath,
  narrativeFor,
  normalizeViewModel,
  rawHrefForPath,
  safeRawHref,
} from "../../ui/change-observatory/model.js";
import { parsePreviewPort } from "../helpers/change-observatory-preview-server.mjs";

const UI_ROOT = new URL("../../ui/change-observatory/", import.meta.url);

function viewModel(overrides = {}) {
  return {
    schemaVersion: VIEW_MODEL_SCHEMA,
    generatedAt: "2026-07-16T09:00:00.000Z",
    project: { id: "fixture-project", name: "Fixture Project", branch: "codex/fixture" },
    snapshots: { counts: { stories: 1 }, phaseCounts: { implementation: 1 } },
    summary: {
      asked: [
        {
          id: "REQ-FIXTURE",
          type: "requirement",
          title: "Fixture request",
          summary: "A recorded test-only request.",
          status: "proposed",
          phase: "discovery",
          provenance: "recorded",
          sourceRefs: [{ path: ".sdlc/requirements/REQ-FIXTURE.json" }],
        },
      ],
      changed: [],
      decided: [],
    },
    iterations: [
      {
        id: "ITERATION-FIXTURE",
        type: "iteration",
        title: "Iteration fixture",
        summary: "Test-only iteration.",
        status: "active",
        provenance: "recorded",
        currentPhase: "implementation",
        sourceRefs: [{ path: ".sdlc/stories/ST-FIXTURE/story.json" }],
        phases: [
          { phase: "discovery", status: "complete", provenance: "recorded", sourceRefs: [] },
          {
            phase: "implementation",
            status: "inProgress",
            provenance: "recorded",
            sourceRefs: [{ path: ".sdlc/stories/ST-FIXTURE/story.json" }],
          },
        ],
      },
    ],
    contracts: [],
    decisions: [],
    changes: [],
    verification: [],
    records: [
      {
        path: ".sdlc/requirements/REQ-FIXTURE.json",
        kind: "requirement",
        provenance: "recorded",
        rawHref: "/api/v1/source?path=.sdlc%2Frequirements%2FREQ-FIXTURE.json",
      },
    ],
    diagnostics: [],
    ...overrides,
  };
}

test("normalizes the versioned view model and makes absent phases explicit", () => {
  const model = normalizeViewModel(viewModel());

  assert.equal(model.schemaVersion, VIEW_MODEL_SCHEMA);
  assert.equal(model.project.name, "Fixture Project");
  assert.deepEqual(model.iterations[0].phases.map((phase) => phase.phase), PHASES);
  assert.equal(model.iterations[0].phases[0].status, "complete");
  assert.equal(model.iterations[0].phases[3].status, "inProgress");
  assert.equal(model.iterations[0].phases[5].status, "missing");
  assert.deepEqual(model.changes, []);
});

test("rejects unversioned or unsupported API responses", () => {
  assert.throws(() => normalizeViewModel({}), /Unsupported observatory schema/);
  assert.throws(
    () => normalizeViewModel({ schemaVersion: "change-observatory:view:v2" }),
    /expected change-observatory:view:v1/,
  );
});

test("visual QA preview helper is import-safe and validates its port", () => {
  assert.equal(parsePreviewPort([]), 4173);
  assert.equal(parsePreviewPort(["--port", "0"]), 0);
  assert.throws(() => parsePreviewPort(["--port"]), /between 0 and 65535/);
  assert.throws(() => parsePreviewPort(["--port", "NaN"]), /between 0 and 65535/);
  assert.throws(() => parsePreviewPort(["--port", "65536"]), /between 0 and 65535/);
});

test("groups equivalent diagnostics defensively in the browser model", () => {
  const model = normalizeViewModel(viewModel({
    diagnostics: [
      {
        code: "schema_version_missing",
        severity: "warning",
        message: "Legacy record.",
        provenance: "inferred",
        sourceRefs: [{ path: ".sdlc/one.json" }],
      },
      {
        code: "schema_version_missing",
        severity: "warning",
        message: "Legacy record.",
        provenance: "inferred",
        occurrences: 3,
        sourceRefs: [{ path: ".sdlc/two.json" }],
      },
    ],
  }));

  assert.equal(model.diagnostics.length, 1);
  assert.equal(model.diagnostics[0].occurrences, 4);
  assert.equal(model.diagnostics[0].sourceRefs.length, 2);
});

test("maps recorded narrative without generating missing facts", () => {
  const model = normalizeViewModel(
    viewModel({
      decisions: [
        {
          id: "DEC-FIXTURE",
          type: "decision",
          title: "Fixture decision",
          summary: "Recorded decision summary.",
          status: "approved",
          provenance: "recorded",
          sourceRefs: [{ path: ".sdlc/decisions/DEC-FIXTURE.json" }],
          narrative: {
            input_summary: "Recorded input.",
            output_summary: "Recorded output.",
            rationale: "Recorded rationale.",
            generated_explanation: "Codex-authored explanation from recorded evidence.",
            explanation_source: "codex-generated",
            alternatives: ["Recorded alternative."],
            chain_of_thought_included: false,
          },
        },
      ],
    }),
  );

  const narrative = narrativeFor(model.decisions[0]);
  assert.equal(narrative.inputs[0].title, "Recorded input.");
  assert.equal(narrative.outputs[0].title, "Recorded output.");
  assert.equal(narrative.rationale, "Recorded rationale.");
  assert.equal(narrative.generatedExplanation, "Codex-authored explanation from recorded evidence.");
  assert.equal(narrative.explanationLabel, "codex-generated");
  assert.equal(narrative.alternatives[0].title, "Recorded alternative.");
  assert.equal(narrative.chainOfThoughtIncluded, false);

  const absent = narrativeFor(model.summary.asked[0]);
  assert.equal(absent.generatedExplanation, null);
  assert.equal(absent.rationale, null);
  assert.deepEqual(absent.alternatives, []);
});

test("groups changes by recorded intent and labels absent intent explicitly", () => {
  const groups = groupChangesByIntent([
    { id: "1", intent: "launcher", phase: "implementation" },
    { id: "2", intent: "launcher", phase: "implementation" },
    { id: "3", intent: null, phase: "validation" },
    { id: "4", intent: null, phase: null },
  ]);

  assert.deepEqual(
    groups.map((group) => [group.intent, group.items.length]),
    [
      ["launcher", 2],
      ["validation", 1],
      ["Intent not recorded", 1],
    ],
  );
});

test("filters lineage by iteration and evidence-bearing phase", () => {
  const iterations = normalizeViewModel(viewModel()).iterations;
  assert.equal(filterIterations(iterations, { phase: "implementation" }).length, 1);
  assert.equal(filterIterations(iterations, { phase: "release" }).length, 0);
  assert.equal(filterIterations(iterations, { iteration: "missing" }).length, 0);
});

test("raw evidence links stay within canonical .sdlc sources", () => {
  assert.equal(isCanonicalEvidencePath(".sdlc/stories/ST-1/story.json"), true);
  assert.equal(isCanonicalEvidencePath(".sdlc/../package.json"), false);
  assert.equal(isCanonicalEvidencePath("README.md"), false);
  assert.equal(isCanonicalEvidencePath(".sdlc\\story.json"), false);
  assert.equal(
    rawHrefForPath(".sdlc/stories/ST-1/story.json"),
    "/api/v1/source?path=.sdlc%2Fstories%2FST-1%2Fstory.json",
  );
  assert.equal(
    safeRawHref("/api/v1/source?path=.sdlc%2Fstories%2FST-1%2Fstory.json"),
    "/api/v1/source?path=.sdlc%2Fstories%2FST-1%2Fstory.json",
  );
  assert.equal(safeRawHref("https://example.com/api/v1/source?path=.sdlc%2Fstory.json"), null);
  assert.equal(safeRawHref("/api/v1/source?path=..%2Fpackage.json"), null);
});

test("API client requests the versioned endpoint and normalizes its response", async () => {
  const calls = [];
  const accessToken = "a".repeat(43);
  const api = new ObservatoryApi({
    accessToken,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify(viewModel()), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const model = await api.load();
  assert.equal(model.project.id, "fixture-project");
  assert.equal(calls[0].url, "/api/v1/observatory");
  assert.equal(calls[0].options.cache, "no-store");
  assert.equal(calls[0].options.credentials, "same-origin");
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${accessToken}`);
});

test("extracts only bounded base64url access tokens from the launch fragment", () => {
  const token = "Abc_123-".repeat(5);
  assert.equal(accessTokenFromHash(`#access_token=${token}`), token);
  assert.equal(accessTokenFromHash("#overview"), null);
  assert.equal(accessTokenFromHash("#access_token=short"), null);
  assert.equal(accessTokenFromHash("#access_token=contains%20space"), null);
});

test("API client refuses unsafe raw targets before fetch", async () => {
  let called = false;
  const api = new ObservatoryApi({
    fetchImpl: async () => {
      called = true;
      return new Response("{}", { status: 200 });
    },
  });

  await assert.rejects(
    api.loadRaw("https://example.com/evidence.json"),
    (error) => error instanceof ObservatoryApiError && error.code === "UNSAFE_RAW_SOURCE",
  );
  assert.equal(called, false);
});

test("API client loads and formats a canonical raw source", async () => {
  const calls = [];
  const api = new ObservatoryApi({
    fetchImpl: async (url) => {
      calls.push(url);
      return new Response('{"status":"recorded"}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const raw = await api.loadRaw(
    "/api/v1/source?path=.sdlc%2Frequirements%2FREQ-FIXTURE.json",
  );
  assert.equal(calls[0], "/api/v1/source?path=.sdlc%2Frequirements%2FREQ-FIXTURE.json");
  assert.equal(raw, '{\n  "status": "recorded"\n}');
});

test("shipped UI is build-free, self-contained, accessible, and gradient-free", async () => {
  const [html, css, app, components] = await Promise.all([
    readFile(new URL("index.html", UI_ROOT), "utf8"),
    readFile(new URL("styles.css", UI_ROOT), "utf8"),
    readFile(new URL("app.js", UI_ROOT), "utf8"),
    readFile(new URL("components.js", UI_ROOT), "utf8"),
  ]);

  assert.match(html, /<script type="module" src="\.\/app\.js"><\/script>/);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /class="skip-link"/);
  assert.match(html, /aria-label="Change Observatory"/);
  assert.match(html, /aria-live="polite"/);
  for (const label of [
    "Overview",
    "Timeline",
    "Contracts",
    "Decisions",
    "Changes",
    "Verification",
    "What was asked?",
    "What changed?",
    "Why was it decided?",
  ]) {
    assert.match(html, new RegExp(label.replace(/[?]/g, "\\?")));
  }
  assert.doesNotMatch(html, /https?:\/\//);
  assert.doesNotMatch(css, /gradient\s*\(/i);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /max-width:\s*430px/);
  assert.match(components, /Plain-language explanation/);
  assert.match(components, /Alternatives rejected/);
  assert.match(components, /No plain-language explanation was recorded/);
  assert.match(app, /\/api\/v1\/observatory|ObservatoryApi/);
  assert.doesNotMatch(app, /fixture|demo|mock/i);
});
