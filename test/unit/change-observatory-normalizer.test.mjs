import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  OBSERVATORY_VIEW_SCHEMA_VERSION,
  buildObservatoryViewModel,
  readSourceRecord,
} from "../../lib/change-observatory/index.mjs";

const FIXED_TIME = "2026-07-16T09:00:00.000Z";
const INTENTABI_EVENT_ID = "123e4567-e89b-42d3-a456-426614174000";
const INTENTABI_PATH = `.sdlc/observations/intentabi/${INTENTABI_EVENT_ID}.json`;

function intentAbiEnvelope(overrides = {}) {
  const digest = (character) => `hmac-sha256:evidence:${character.repeat(64)}`;
  return {
    schema: "io.github.aantenore.intentabi/authenticated-codex-shadow-evidence/v1alpha1",
    eventId: INTENTABI_EVENT_ID,
    keyId: "intentabi-test",
    evidence: {
      schema: "io.github.aantenore.intentabi/codex-shadow-evidence/v1alpha1",
      mode: "shadow",
      submitted: "original",
      inputKind: "text",
      bindingDigest: digest("a"),
      originalDigest: digest("b"),
      optionsDigest: "unavailable:not-provided",
      execution: {
        status: "succeeded",
        outputDigest: "unavailable:opaque-output",
      },
      preparation: {
        outcome: "candidate-observed",
        reason: "CANDIDATE_ATTESTED",
        candidateDigest: digest("c"),
        selectedCodecDigest: digest("d"),
        reasonSetDigest: digest("e"),
        promotionBindingDigest: digest("f"),
        proof: "present-unverified",
      },
    },
    mac: digest("9"),
    ...overrides,
  };
}

test("normalizes representative SDLC lineage with explicit provenance and narrative", async (t) => {
  const root = await createProject(t);
  await writeJson(root, ".sdlc/project.json", {
    schema_version: "0.1.0",
    sdlc_version: "0.6.0",
    project_id: "demo-project",
    project_name: "Demo Project",
  });
  await writeJson(root, ".sdlc/requirements/REQ-1.json", {
    schema_version: "requirement:v1",
    id: "REQ-1",
    title: "Show delivery lineage",
    summary: "Make recorded delivery evidence readable.",
    status: "approved",
  });
  await writeJson(root, ".sdlc/contracts/contract-ST-1-implementation.json", {
    schema_version: "0.1.0",
    id: "contract-ST-1-implementation",
    story_id: "ST-1",
    phase: "implementation",
    purpose: "Implement the recorded story.",
    status: "approved",
    inputs: ["REQ-1"],
    outputs: ["implementation evidence"],
    approvals: [{
      id: "APR-1",
      status: "approved",
      summary: "Approved implementation contract.",
      created_at: "2026-07-16T08:30:00Z",
    }],
  });
  await writeJson(root, ".sdlc/stories/ST-1/story.json", {
    schema_version: "0.1.0",
    id: "ST-1",
    title: "Build the Observatory core",
    phase: "implementation",
    status: "draft",
  });
  await writeJson(root, ".sdlc/stories/ST-1/task-start.json", {
    id: "START-1",
    story_id: "ST-1",
    phase: "implementation",
    status: "confirmed",
    confirmed_at: "2026-07-16T08:40:00Z",
  });
  await writeJsonLines(root, ".sdlc/traces/ST-1.jsonl", [
    {
      id: "TR-REQUEST",
      story_id: "ST-1",
      type: "decision",
      action: "task.start.confirm",
      summary: "Confirmed implementation start.",
      request: { summary: "Implement the Observatory core." },
      created_at: "2026-07-16T08:40:00Z",
    },
    {
      id: "TR-IMPLEMENT",
      story_id: "ST-1",
      type: "implementation",
      summary: "Added a safe read-only API.",
      evidence: ["test/unit/change-observatory-server.test.mjs"],
      narrative: {
        schema_version: "trace-narrative:v1",
        input_summaries: ["Approved core contract."],
        output_summaries: ["Versioned model and loopback API."],
        rationale_summary: "Keep the plugin dependency-free.",
        explanation: {
          text: "The plugin can now explain recorded project changes locally.",
          kind: "codex-generated",
          scope: "recorded-evidence-only",
        },
        alternatives: ["Hosted dashboard"],
      },
      created_at: "2026-07-16T08:50:00Z",
    },
    {
      id: "TR-TEST",
      story_id: "ST-1",
      type: "test",
      outcome: "passed",
      summary: "Core tests passed.",
      created_at: "2026-07-16T08:55:00Z",
    },
    {
      id: "TR-APPROVE",
      story_id: "ST-1",
      type: "gate",
      action: "contract.approve",
      summary: "Approved the dependency-free implementation boundary.",
      created_at: "2026-07-16T08:39:00Z",
    },
    {
      id: "TR-SYNC",
      story_id: "ST-1",
      type: "sync",
      action: "story.release",
      summary: "Story claim released.",
      created_at: "2026-07-16T08:59:00Z",
    },
  ]);

  const model = await buildObservatoryViewModel(root, { clock: () => new Date(FIXED_TIME) });

  assert.equal(model.schemaVersion, OBSERVATORY_VIEW_SCHEMA_VERSION);
  assert.equal(model.generatedAt, FIXED_TIME);
  assert.deepEqual(model.project, {
    id: "demo-project",
    name: "Demo Project",
    sdlcVersion: "0.6.0",
    provenance: "recorded",
    sourceRefs: [{ path: ".sdlc/project.json" }],
    textTruncated: false,
  });
  assert.equal(model.summary.asked.some((item) => item.id === "REQ-1"), true);
  assert.equal(model.summary.asked.some((item) => item.summary === "Implement the Observatory core."), true);
  assert.equal(model.contracts.length, 1);
  assert.equal(model.decisions.some((item) => item.id === "APR-1" && item.type === "approval"), true);
  assert.equal(model.changes.length, 2);
  assert.equal(model.verification.some((item) => item.id === "TR-TEST"), true);
  assert.equal(model.summary.changed[0].id, "TR-IMPLEMENT");
  assert.equal(model.summary.decided[0].id, "TR-APPROVE");

  const implementation = model.changes.find((item) => item.id === "TR-IMPLEMENT");
  assert.deepEqual(implementation.explanation, {
    text: "The plugin can now explain recorded project changes locally.",
    authoring: "codex-generated",
    provenance: "recorded",
    sourceRefs: [{ path: ".sdlc/traces/ST-1.jsonl", line: 2, pointer: "/narrative" }],
    truncated: false,
  });
  assert.equal(implementation.inputs[0].title, "Approved core contract.");
  assert.equal(implementation.outputs[0].title, "Versioned model and loopback API.");
  assert.equal(implementation.alternatives[0].title, "Hosted dashboard");
  assert.equal(implementation.evidence[0].title, "test/unit/change-observatory-server.test.mjs");

  const iteration = model.iterations[0];
  assert.equal(iteration.id, "ST-1");
  assert.deepEqual(
    iteration.phases.find((phase) => phase.phase === "implementation"),
    {
      phase: "implementation",
      status: "inProgress",
      provenance: "inferred",
      sourceRefs: [{ path: ".sdlc/stories/ST-1/task-start.json" }],
    },
  );
  assert.equal(iteration.phases.find((phase) => phase.phase === "analysis").provenance, "missing");

  for (const collection of [
    model.summary.asked,
    model.summary.changed,
    model.summary.decided,
    model.iterations,
    model.contracts,
    model.decisions,
    model.changes,
    model.verification,
    model.records,
  ]) {
    for (const item of collection) {
      assert.match(item.provenance, /^(recorded|inferred|missing|malformed)$/);
      assert.ok(Array.isArray(item.sourceRefs));
    }
  }
});

test("projects content-free IntentABI evidence and links it only through an explicit story trace", async (t) => {
  const root = await createProject(t);
  await writeJson(root, ".sdlc/project.json", {
    schema_version: "0.1.0",
    project_id: "intentabi-project",
    project_name: "IntentABI Project",
  });
  await writeJson(root, ".sdlc/stories/ST-INTENT/story.json", {
    schema_version: "0.1.0",
    id: "ST-INTENT",
    title: "Observe intent evidence",
    status: "draft",
  });
  await writeJson(root, INTENTABI_PATH, intentAbiEnvelope());
  await writeJsonLines(root, ".sdlc/traces/ST-INTENT.jsonl", [{
    id: "TR-INTENTABI-LINK",
    story_id: "ST-INTENT",
    type: "handoff",
    summary: "Linked content-free intent evidence.",
    evidence: [INTENTABI_PATH],
  }]);

  const model = await buildObservatoryViewModel(root, { clock: () => FIXED_TIME });

  assert.equal(model.schemaVersion, OBSERVATORY_VIEW_SCHEMA_VERSION);
  assert.equal(model.semanticObservations.length, 1);
  assert.deepEqual(model.semanticObservations[0], {
    id: INTENTABI_EVENT_ID,
    type: "intentabi-codex-shadow",
    title: "IntentABI shadow observation",
    summary: "Content-free IntentABI shadow evidence.",
    status: "candidate-observed",
    phase: null,
    action: null,
    intent: null,
    timestamp: null,
    provenance: "recorded",
    sourceRefs: [
      { path: INTENTABI_PATH },
      { path: ".sdlc/traces/ST-INTENT.jsonl", line: 1, pointer: "/evidence/0" },
    ],
    rawHref: `/api/v1/source?path=${encodeURIComponent(INTENTABI_PATH)}`,
    mode: "shadow",
    submitted: "original",
    outcome: "candidate-observed",
    reason: "CANDIDATE_ATTESTED",
    proof: "present-unverified",
    macStatus: "present-not-verified",
    link: {
      status: "linked",
      storyId: "ST-INTENT",
      traceIds: ["TR-INTENTABI-LINK"],
      sourceRefs: [
        { path: ".sdlc/traces/ST-INTENT.jsonl", line: 1, pointer: "/evidence/0" },
      ],
    },
  });
  assert.equal(model.snapshots.counts.semanticObservations, 1);
  assert.deepEqual(model.summary, { asked: [], changed: [], decided: [] });
  assert.equal(model.contracts.length, 0);
  assert.equal(model.changes.length, 0);
  assert.equal(model.decisions.length, 0);
  assert.equal(model.verification.length, 0);
  assert.ok(model.iterations[0].phases.every((phase) => phase.status === "missing"));
  assert.equal(
    model.diagnostics.some((diagnostic) =>
      diagnostic.code === "schema_version_missing" && diagnostic.sourceRefs[0]?.path === INTENTABI_PATH),
    false,
  );

  const source = await readSourceRecord(root, INTENTABI_PATH);
  assert.equal(source.contentProjection, "intentabi-observatory:v1");
  assert.deepEqual(source.data, {
    eventId: INTENTABI_EVENT_ID,
    mode: "shadow",
    submitted: "original",
    outcome: "candidate-observed",
    reason: "CANDIDATE_ATTESTED",
    proof: "present-unverified",
    macStatus: "present-not-verified",
  });
  assert.equal(JSON.stringify(source).includes("hmac-sha256"), false);
  assert.equal(JSON.stringify(source).includes("keyId"), false);
  assert.equal(Object.hasOwn(source, "sha256"), false);
  assert.equal(Object.hasOwn(source, "sizeBytes"), false);
});

test("keeps incomplete IntentABI trace links explicit and bounds diagnostic references", async (t) => {
  const root = await createProject(t);
  await writeJson(root, ".sdlc/project.json", {
    schema_version: "0.1.0",
    project_id: "intentabi-incomplete-links",
    project_name: "IntentABI Incomplete Links",
  });
  await writeJson(root, INTENTABI_PATH, intentAbiEnvelope());
  await writeJsonLines(root, ".sdlc/traces/incomplete.jsonl", Array.from({ length: 15 }, (_, index) => ({
    ...(index % 2 === 0 ? { id: `TR-INCOMPLETE-${index}` } : { story_id: "ST-INCOMPLETE" }),
    type: "handoff",
    summary: "Incomplete explicit link.",
    evidence: [INTENTABI_PATH],
  })));

  const model = await buildObservatoryViewModel(root, { clock: () => FIXED_TIME });

  assert.equal(model.semanticObservations.length, 1);
  assert.equal(model.semanticObservations[0].link.status, "unlinked");
  const diagnostic = model.diagnostics.find((item) => item.code === "intentabi_link_incomplete");
  assert.ok(diagnostic);
  assert.equal(diagnostic.sourceRefs.length, 12);
  assert.equal(diagnostic.sourceRefs.some((reference) => reference.pointer === "/evidence/0"), true);
});

test("bounds IntentABI trace-link indexing without inferring omitted links", async (t) => {
  const root = await createProject(t);
  await writeJson(root, ".sdlc/project.json", {
    schema_version: "0.1.0",
    project_id: "intentabi-bounded-links",
    project_name: "IntentABI Bounded Links",
  });
  await writeJson(root, INTENTABI_PATH, intentAbiEnvelope());
  await writeJsonLines(root, ".sdlc/traces/bounded.jsonl", [{
    id: "TR-BOUNDED",
    story_id: "ST-BOUNDED",
    type: "handoff",
    summary: "The relevant reference is beyond the configured per-record limit.",
    evidence: ["unrelated-one", "unrelated-two", INTENTABI_PATH],
  }]);

  const model = await buildObservatoryViewModel(root, {
    clock: () => FIXED_TIME,
    limits: { maxCollectionItems: 2 },
  });

  assert.equal(model.semanticObservations.length, 1);
  assert.equal(model.semanticObservations[0].link.status, "unlinked");
  assert.equal(
    model.diagnostics.some((item) => item.code === "intentabi_link_index_truncated"),
    true,
  );
});

test("keeps unlinked IntentABI evidence unlinked and omits non-contract content fail-closed", async (t) => {
  const root = await createProject(t);
  await writeJson(root, ".sdlc/project.json", {
    schema_version: "0.1.0",
    project_id: "intentabi-boundary",
    project_name: "IntentABI Boundary",
  });
  await writeJson(root, INTENTABI_PATH, intentAbiEnvelope());
  await writeJsonLines(root, ".sdlc/traces/project.jsonl", [{
    id: "TR-NO-STORY",
    type: "handoff",
    summary: "A path without story lineage is insufficient.",
    evidence: [INTENTABI_PATH],
  }]);
  const unsafePath = ".sdlc/observations/intentabi/PROMPT_SECRET.json";
  await writeJson(root, unsafePath, intentAbiEnvelope({
    eventId: "123e4567-e89b-42d3-a456-426614174001",
    prompt: "PROMPT_MUST_NOT_APPEAR",
    candidate: "CANDIDATE_MUST_NOT_APPEAR",
    output: "OUTPUT_MUST_NOT_APPEAR",
  }));
  const outsidePath = ".sdlc/PROMPT_OUTSIDE_NAMESPACE.json";
  await writeJson(root, outsidePath, intentAbiEnvelope({
    eventId: "123e4567-e89b-42d3-a456-426614174004",
  }));

  const model = await buildObservatoryViewModel(root, { clock: () => FIXED_TIME });

  assert.equal(model.semanticObservations.length, 1);
  assert.deepEqual(model.semanticObservations[0].link, {
    status: "unlinked",
    storyId: null,
    traceIds: [],
    sourceRefs: [],
  });
  assert.equal(model.semanticObservations[0].phase, null);
  assert.equal(model.semanticObservations[0].timestamp, null);
  assert.equal(JSON.stringify(model).includes("MUST_NOT_APPEAR"), false);
  assert.equal(JSON.stringify(model).includes("PROMPT_SECRET"), false);
  assert.equal(JSON.stringify(model).includes("PROMPT_OUTSIDE_NAMESPACE"), false);
  assert.equal(model.diagnostics.some((diagnostic) => diagnostic.code === "intentabi_envelope_malformed"), true);
  assert.equal(
    model.diagnostics.some((diagnostic) => diagnostic.code === "intentabi_observation_path_noncanonical"),
    true,
  );
  const unsafeRecord = model.records.find((record) => record.path === unsafePath);
  assert.equal(unsafeRecord, undefined);
  assert.equal(model.records.every(Boolean), true);
  assert.equal(model.snapshots.counts.records, model.records.length);

  const unsafeSource = await readSourceRecord(root, unsafePath);
  assert.equal(unsafeSource.provenance, "malformed");
  assert.equal(unsafeSource.parseError, "invalid_intentabi_path");
  assert.equal(unsafeSource.contentOmitted, true);
  assert.equal(Object.hasOwn(unsafeSource, "data"), false);
  assert.equal(Object.hasOwn(unsafeSource, "sha256"), false);
  assert.equal(Object.hasOwn(unsafeSource, "sizeBytes"), false);
  assert.equal(JSON.stringify(unsafeSource).includes("MUST_NOT_APPEAR"), false);
  assert.equal(JSON.stringify(unsafeSource).includes("PROMPT_SECRET"), false);

  const outsideSource = await readSourceRecord(root, outsidePath);
  assert.equal(outsideSource.provenance, "malformed");
  assert.equal(outsideSource.parseError, "invalid_intentabi_path");
  assert.equal(outsideSource.contentOmitted, true);
  assert.equal(JSON.stringify(outsideSource).includes("PROMPT_OUTSIDE_NAMESPACE"), false);

  const unsafeJsonlPath = ".sdlc/observations/intentabi/events.jsonl";
  const safeEntry = intentAbiEnvelope({
    eventId: "123e4567-e89b-42d3-a456-426614174002",
  });
  const unsafeEntry = {
    ...intentAbiEnvelope({ eventId: "123e4567-e89b-42d3-a456-426614174003" }),
    prompt: "JSONL_PROMPT_MUST_NOT_APPEAR",
  };
  await writeJsonLines(root, unsafeJsonlPath, [safeEntry, unsafeEntry]);
  const jsonlSource = await readSourceRecord(root, unsafeJsonlPath);
  assert.equal(jsonlSource.provenance, "malformed");
  assert.equal(jsonlSource.parseError, "invalid_intentabi_path");
  assert.equal(jsonlSource.contentOmitted, true);
  assert.equal(Object.hasOwn(jsonlSource, "entries"), false);
  assert.equal(JSON.stringify(jsonlSource).includes("JSONL_PROMPT_MUST_NOT_APPEAR"), false);

  const unsupportedPath = ".sdlc/observations/intentabi/raw.txt";
  await writeText(root, unsupportedPath, "RAW_PROMPT_MUST_NOT_APPEAR");
  const unsupportedSource = await readSourceRecord(root, unsupportedPath);
  assert.equal(unsupportedSource.parseError, "invalid_intentabi_path");
  assert.equal(unsupportedSource.contentOmitted, true);
  assert.equal(JSON.stringify(unsupportedSource).includes("RAW_PROMPT_MUST_NOT_APPEAR"), false);
});

test("returns bounded missing-state diagnostics for empty and absent knowledge bases", async (t) => {
  const absent = await createProject(t, { knowledgeBase: false });
  const missingModel = await buildObservatoryViewModel(absent, { clock: () => FIXED_TIME });
  assert.equal(missingModel.iterations.length, 0);
  assert.equal(missingModel.project.provenance, "missing");
  assert.equal(missingModel.diagnostics[0].code, "knowledge_base_missing");

  const empty = await createProject(t);
  await writeJson(empty, ".sdlc/CACHE/derived.json", { secret: "not canonical" });
  await writeJson(empty, ".sdlc/InDeXeS/derived.json", { secret: "not canonical" });
  const emptyModel = await buildObservatoryViewModel(empty, { clock: () => FIXED_TIME });
  assert.equal(emptyModel.records.length, 0);
  assert.equal(emptyModel.records.some((record) => /\/(?:cache|indexes)\//i.test(record.path)), false);
  assert.equal(emptyModel.diagnostics.some((diagnostic) => diagnostic.code === "project_record_missing"), true);
  assert.ok(emptyModel.diagnostics.every((diagnostic) => diagnostic.sourceRefs.every((ref) => !path.isAbsolute(ref.path))));
});

test("tolerates legacy records and isolates malformed JSON and JSONL", async (t) => {
  const root = await createProject(t);
  await writeJson(root, ".sdlc/project.json", {
    project_id: "legacy",
    project_name: "Legacy Project",
  });
  await writeText(root, ".sdlc/stories/ST-OLD/story.json", "{not-json");
  await writeText(root, ".sdlc/traces/ST-OLD.jsonl", [
    JSON.stringify({ id: "TR-OK", type: "decision", summary: "Recorded legacy decision." }),
    "{broken-line",
  ].join("\n"));

  const model = await buildObservatoryViewModel(root, {
    clock: () => FIXED_TIME,
    limits: { maxDiagnostics: 2 },
  });

  assert.equal(model.project.name, "Legacy Project");
  assert.equal(model.decisions.some((item) => item.id === "TR-OK"), true);
  assert.equal(model.records.some((record) => record.path.endsWith("story.json") && record.provenance === "malformed"), true);
  assert.equal(model.records.some((record) => record.line === 2 && record.provenance === "malformed"), true);
  assert.ok(model.diagnostics.length <= 2);
  assert.equal(model.diagnostics.some((diagnostic) => diagnostic.code === "diagnostics_truncated"), true);
});

test("redacts explicitly stored private reasoning from normalized and source views", async (t) => {
  const root = await createProject(t);
  await writeJson(root, ".sdlc/project.json", {
    schema_version: "0.1.0",
    project_id: "redaction",
    project_name: "Redaction",
  });
  await writeJsonLines(root, ".sdlc/traces/project.jsonl", [{
    id: "TR-PRIVATE",
    type: "decision",
    summary: "A safe recorded summary.",
    chain_of_thought: "must never be exposed",
    narrative: {
      generated_explanation: "unsafe narrative",
      rationale: "unsafe rationale",
      chain_of_thought_included: true,
    },
  }, {
    id: "TR-PRIVATE-VARIANTS",
    type: "decision",
    summary: "A second safe summary.",
    inputs: ["TOP_LEVEL_INPUT_SECRET"],
    outputs: ["TOP_LEVEL_OUTPUT_SECRET"],
    evidence: ["TOP_LEVEL_EVIDENCE_SECRET"],
    chainOfThought: "camel secret",
    "private-reasoning": "kebab secret",
    reasoningTrace: "trace secret",
    narrative: {
      explanation: { text: "MODEL_SECRET", kind: "codex-generated" },
      rationaleSummary: "RATIONALE_SECRET",
      input_summaries: ["INPUT_SECRET"],
      output_summaries: ["OUTPUT_SECRET"],
      alternatives: ["ALTERNATIVE_SECRET"],
      evidence: ["EVIDENCE_SECRET"],
      chainOfThoughtIncluded: true,
    },
  }]);

  const model = await buildObservatoryViewModel(root, { clock: () => FIXED_TIME });
  const decision = model.decisions.find((item) => item.id === "TR-PRIVATE");
  assert.equal(decision.explanation.text, "A safe recorded summary.");
  const privateDiagnostic = model.diagnostics.find(
    (diagnostic) => diagnostic.code === "private_reasoning_redacted",
  );
  assert.equal(privateDiagnostic.occurrences, 2);
  const variants = model.decisions.find((item) => item.id === "TR-PRIVATE-VARIANTS");
  assert.equal(variants.explanation.text, "A second safe summary.");
  assert.deepEqual(variants.inputs, []);
  assert.deepEqual(variants.outputs, []);
  assert.deepEqual(variants.alternatives, []);
  assert.deepEqual(variants.evidence, []);
  assert.equal(JSON.stringify(variants).includes("SECRET"), false);

  const source = await readSourceRecord(root, ".sdlc/traces/project.jsonl");
  assert.equal(source.entries[0].data.chain_of_thought, "[redacted]");
  assert.equal(source.entries[0].data.narrative.generated_explanation, "[redacted]");
  assert.equal(source.entries[0].data.narrative.rationale, "[redacted]");
  assert.deepEqual(source.redactions, [
    "/0/chain_of_thought",
    "/0/narrative/generated_explanation",
    "/0/narrative/rationale",
    "/1/chainOfThought",
    "/1/private-reasoning",
    "/1/reasoningTrace",
    "/1/narrative/explanation",
    "/1/narrative/rationaleSummary",
    "/1/narrative/input_summaries",
    "/1/narrative/output_summaries",
    "/1/narrative/alternatives",
    "/1/narrative/evidence",
  ]);
  assert.equal(source.entries[1].data.chainOfThought, "[redacted]");
  assert.equal(source.entries[1].data["private-reasoning"], "[redacted]");
  assert.equal(source.entries[1].data.narrative.explanation, "[redacted]");
  assert.equal(JSON.stringify(source).includes("MODEL_SECRET"), false);
});

test("malformed structured sources fail closed without returning private bytes", async (t) => {
  const root = await createProject(t);
  await writeText(root, ".sdlc/private.json", '{"privateReasoning":"JSON_SECRET"');
  await writeText(root, ".sdlc/private.jsonl", '{"chain-of-thought":"JSONL_SECRET"\n');

  const malformedJson = await readSourceRecord(root, ".sdlc/private.json");
  assert.equal(malformedJson.provenance, "malformed");
  assert.equal(malformedJson.contentOmitted, true);
  assert.equal(Object.hasOwn(malformedJson, "raw"), false);
  assert.equal(JSON.stringify(malformedJson).includes("JSON_SECRET"), false);

  const malformedJsonl = await readSourceRecord(root, ".sdlc/private.jsonl");
  assert.equal(malformedJsonl.provenance, "malformed");
  assert.equal(malformedJsonl.entries[0].contentOmitted, true);
  assert.equal(Object.hasOwn(malformedJsonl.entries[0], "raw"), false);
  assert.equal(JSON.stringify(malformedJsonl).includes("JSONL_SECRET"), false);
});

test("bounds oversized normalization and raw-source responses", async (t) => {
  const root = await createProject(t);
  await writeText(root, ".sdlc/project.json", JSON.stringify({
    schema_version: "v1",
    project_id: "bounded",
    project_name: "Bounded",
  }));
  await writeJson(root, ".sdlc/requirements/REQ-BIG.json", {
    schema_version: "requirement:v1",
    id: "REQ-BIG",
    title: "Oversized requirement",
    summary: "x".repeat(1_000),
  });

  const model = await buildObservatoryViewModel(root, {
    clock: () => FIXED_TIME,
    limits: { maxFileBytes: 256, maxSourceBytes: 64 },
  });
  assert.equal(
    model.records.some((record) => record.path.endsWith("REQ-BIG.json") && record.provenance === "malformed"),
    true,
  );
  assert.equal(model.diagnostics.some((diagnostic) => diagnostic.code === "file_too_large"), true);
  const oversizedRecord = model.records.find((record) => record.path.endsWith("REQ-BIG.json"));
  assert.equal(oversizedRecord.rawAvailable, false);
  assert.equal(oversizedRecord.rawHref, null);

  await assert.rejects(
    () => readSourceRecord(root, ".sdlc/project.json", { limits: { maxSourceBytes: 32 } }),
    (error) => error?.code === "source_too_large" && error?.statusCode === 413,
  );
});

async function createProject(t, { knowledgeBase = true } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "change-observatory-normalizer-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  if (knowledgeBase) await fs.mkdir(path.join(root, ".sdlc"), { recursive: true });
  return root;
}

async function writeJson(root, relativePath, value) {
  await writeText(root, relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeJsonLines(root, relativePath, values) {
  await writeText(root, relativePath, `${values.map((value) => JSON.stringify(value)).join("\n")}\n`);
}

async function writeText(root, relativePath, value) {
  const target = path.join(root, ...relativePath.split("/"));
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, value, "utf8");
}
