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
        input_summary: "Approved core contract.",
        output_summary: "Versioned model and loopback API.",
        rationale: "Keep the plugin dependency-free.",
        generated_explanation: "The plugin can now explain recorded project changes locally.",
        explanation_source: "codex-generated",
        alternatives: ["Hosted dashboard"],
        chain_of_thought_included: false,
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
  assert.equal(model.changes.length, 1);
  assert.equal(model.verification.some((item) => item.id === "TR-TEST"), true);

  const implementation = model.changes[0];
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

test("returns bounded missing-state diagnostics for empty and absent knowledge bases", async (t) => {
  const absent = await createProject(t, { knowledgeBase: false });
  const missingModel = await buildObservatoryViewModel(absent, { clock: () => FIXED_TIME });
  assert.equal(missingModel.iterations.length, 0);
  assert.equal(missingModel.project.provenance, "missing");
  assert.equal(missingModel.diagnostics[0].code, "knowledge_base_missing");

  const empty = await createProject(t);
  const emptyModel = await buildObservatoryViewModel(empty, { clock: () => FIXED_TIME });
  assert.equal(emptyModel.records.length, 0);
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
  }]);

  const model = await buildObservatoryViewModel(root, { clock: () => FIXED_TIME });
  const decision = model.decisions.find((item) => item.id === "TR-PRIVATE");
  assert.equal(decision.explanation.text, "A safe recorded summary.");
  assert.equal(model.diagnostics.some((diagnostic) => diagnostic.code === "private_reasoning_redacted"), true);

  const source = await readSourceRecord(root, ".sdlc/traces/project.jsonl");
  assert.equal(source.entries[0].data.chain_of_thought, "[redacted]");
  assert.equal(source.entries[0].data.narrative.generated_explanation, "[redacted]");
  assert.equal(source.entries[0].data.narrative.rationale, "[redacted]");
  assert.deepEqual(source.redactions, [
    "/0/chain_of_thought",
    "/0/narrative/generated_explanation",
    "/0/narrative/rationale",
  ]);
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
