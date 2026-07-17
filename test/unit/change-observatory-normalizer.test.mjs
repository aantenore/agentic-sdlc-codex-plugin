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

test("builds proof-bound dossiers without cross-story, shared, or ambiguous lineage", async (t) => {
  const root = await createProject(t);
  await writeJson(root, ".sdlc/project.json", {
    schema_version: "0.1.0",
    project_id: "dossier-boundary",
    project_name: "Dossier Boundary",
  });
  await writeJson(root, ".sdlc/requirements/REQ-SHARED.json", {
    schema_version: "requirement:v1",
    id: "REQ-SHARED",
    title: "Shared product outcome",
    summary: "A requirement explicitly shared by two stories.",
  });
  for (const storyId of ["ST-A", "ST-B"]) {
    await writeJson(root, `.sdlc/stories/${storyId}/story.json`, {
      schema_version: "0.1.0",
      id: storyId,
      title: `Story ${storyId}`,
      summary: `Summary ${storyId}`,
      phase: "implementation",
      status: "in_progress",
      contract_id: `CONTRACT-${storyId}`,
      links: { requirements: ["REQ-SHARED"], decisions: [], tests: [] },
    });
    await writeJson(root, `.sdlc/contracts/CONTRACT-${storyId}.json`, {
      schema_version: "0.1.0",
      id: `CONTRACT-${storyId}`,
      story_id: storyId,
      phase: "implementation",
      purpose: `Contract ${storyId}`,
      status: "approved",
    });
  }
  await writeJson(root, ".sdlc/decisions/DEC-UNIQUE.json", {
    schema_version: "0.1.0",
    id: "DEC-UNIQUE",
    summary: "A uniquely addressed decision.",
  });
  await writeJson(root, ".sdlc/decisions/DUPLICATE-ONE.json", {
    schema_version: "0.1.0",
    id: "DUPLICATE-ID",
    summary: "First duplicate.",
  });
  await writeJson(root, ".sdlc/decisions/DUPLICATE-TWO.json", {
    schema_version: "0.1.0",
    id: "DUPLICATE-ID",
    summary: "Second duplicate.",
  });
  await writeJson(root, ".sdlc/decisions/REQ-ONLY.json", {
    schema_version: "0.1.0",
    id: "DEC-REQ-ONLY",
    requirement_id: "REQ-SHARED",
    summary: "A requirement-only record must not fan out across stories.",
  });
  await writeJson(root, ".sdlc/tests/A.json", {
    schema_version: "test-evidence:v1",
    id: "TEST-A",
    story_id: "ST-A",
    outcome: "passed",
    summary: "A verification passed.",
  });
  await writeJson(root, ".sdlc/tests/shared.json", {
    schema_version: "test-evidence:v1",
    id: "TEST-SHARED",
    outcome: "passed",
    summary: "A path cited by both stories is not dossier evidence.",
  });
  await writeJson(root, ".sdlc/tests/mismatch.json", {
    schema_version: "test-evidence:v1",
    id: "TEST-B-OWNED",
    story_id: "ST-B",
    outcome: "passed",
    summary: "Evidence owned by B.",
  });
  await writeJsonLines(root, ".sdlc/tests/multi.jsonl", [
    { id: "TEST-MULTI-1", outcome: "passed" },
    { id: "TEST-MULTI-2", outcome: "passed" },
  ]);
  await writeJsonLines(root, ".sdlc/tests/single.jsonl", [
    { id: "TEST-SINGLE-JSONL", outcome: "passed" },
  ]);
  await writeText(root, ".sdlc/tests/broken.json", "{not-json");
  await writeJson(root, ".sdlc/stories/ST-A/steps/implementation.json", {
    id: "STEP-A",
    story_id: "ST-A",
    phase: "implementation",
    status: "completed",
    summary: "Completed the implementation step.",
  });
  await writeJsonLines(root, ".sdlc/traces/ST-A.jsonl", [
    {
      id: "IMP-A",
      story_id: "ST-A",
      type: "implementation",
      summary: "Implemented A.",
      request: { summary: "Deliver A." },
      related: ["DEC-UNIQUE", "DUPLICATE-ID"],
      evidence: [
        ".sdlc/tests/A.json",
        ".sdlc/tests/shared.json",
        ".sdlc/tests/mismatch.json",
        ".sdlc/tests/multi.jsonl",
        ".sdlc/tests/single.jsonl",
        ".sdlc/tests/broken.json",
        ".sdlc/../outside.json",
      ],
      narrative: {
        schema_version: "trace-narrative:v1",
        rationale_summary: "A recorded rationale, not an explanation.",
      },
      created_at: "2026-07-16T08:50:00Z",
    },
    {
      id: "CROSS-A",
      story_id: "ST-A",
      type: "implementation",
      summary: "A-owned evidence that also names B in related.",
      related: ["ST-B"],
    },
    {
      id: "RELEASE-A",
      story_id: "ST-A",
      type: "release",
      summary: "Released product A.",
      outcome: "passed",
    },
    {
      id: "SYNC-A",
      story_id: "ST-A",
      type: "sync",
      action: "story.release",
      summary: "Released an operational claim only.",
    },
  ]);
  await writeJsonLines(root, ".sdlc/traces/ST-B.jsonl", [{
    id: "IMP-B",
    story_id: "ST-B",
    contract_id: "CONTRACT-ST-A",
    type: "implementation",
    summary: "Implemented B without leaking through A's contract.",
    evidence: [".sdlc/tests/shared.json"],
  }]);

  const model = await buildObservatoryViewModel(root, { clock: () => FIXED_TIME });
  assert.equal(model.schemaVersion, OBSERVATORY_VIEW_SCHEMA_VERSION);
  assert.equal(model.dossiers.length, 2);
  const dossierA = model.dossiers.find((dossier) => dossier.storyId === "ST-A");
  const dossierB = model.dossiers.find((dossier) => dossier.storyId === "ST-B");
  assert.ok(dossierA);
  assert.ok(dossierB);
  assert.equal(dossierA.schemaVersion, "change-observatory:iteration-dossier:v1");
  assert.equal(dossierA.iterationId, "ST-A");
  assert.equal(dossierA.title, "Story ST-A");
  assert.equal(dossierA.summary, "Summary ST-A");
  assert.deepEqual(
    model.iterations.find((iteration) => iteration.id === "ST-A").dossier,
    dossierA,
  );
  assert.equal(dossierA.lanes.asked.items.some((item) => item.id === "REQ-SHARED"), true);
  assert.equal(dossierA.lanes.asked.items.some((item) => item.id === "ST-A"), true);
  assert.equal(dossierB.lanes.asked.items.some((item) => item.id === "REQ-SHARED"), true);
  assert.equal(dossierA.lanes.decided.items.some((item) => item.id === "DEC-REQ-ONLY"), false);
  assert.equal(dossierB.lanes.decided.items.some((item) => item.id === "DEC-REQ-ONLY"), false);
  assert.equal(dossierA.lanes.decided.items.some((item) => item.id === "DEC-UNIQUE"), true);
  assert.equal(dossierA.lanes.decided.items.some((item) => item.id === "DUPLICATE-ID"), false);
  assert.equal(dossierB.lanes.done.items.some((item) => item.id === "CROSS-A"), false);
  assert.equal(dossierA.lanes.done.items.some((item) => item.id === "IMP-B"), false);

  const implementation = dossierA.lanes.done.items.find((item) => item.id === "IMP-A");
  assert.equal(implementation.rationale.text, "A recorded rationale, not an explanation.");
  assert.equal(implementation.narrative.rationaleSummary, "A recorded rationale, not an explanation.");
  assert.equal(implementation.narrative.generatedExplanation, null);
  assert.equal(implementation.explanation.text, "Implemented A.");
  assert.notEqual(implementation.explanation.text, implementation.rationale.text);
  assert.equal(implementation.storyId, "ST-A");
  assert.deepEqual(implementation.related, ["DEC-UNIQUE", "DUPLICATE-ID"]);
  assert.equal(implementation.linkage.status, "linked");
  assert.equal(implementation.linkage.via.includes("story_id"), true);

  const verifiedIdsA = dossierA.lanes.verified.items.map((item) => item.id);
  assert.equal(verifiedIdsA.includes("TEST-A"), true);
  assert.equal(verifiedIdsA.includes("TEST-SHARED"), false);
  assert.equal(verifiedIdsA.includes("TEST-B-OWNED"), false);
  assert.equal(verifiedIdsA.includes("TEST-MULTI-1"), false);
  assert.equal(verifiedIdsA.includes("TEST-SINGLE-JSONL"), false);
  assert.equal(verifiedIdsA.some((id) => String(id).includes("broken.json")), false);
  assert.equal(verifiedIdsA.includes("RELEASE-A"), true);
  assert.equal(dossierA.lanes.done.items.some((item) => item.id === "SYNC-A"), true);
  assert.equal(dossierA.lanes.verified.items.some((item) => item.id === "SYNC-A"), false);
  assert.equal(dossierA.lanes.done.items.some((item) => item.id === "STEP-A"), true);
  assert.equal(dossierA.lanes.verified.items.some((item) => item.id === "STEP-A"), true);
  assert.equal(model.unlinked.some((item) => item.id === "DEC-REQ-ONLY"), true);
  assert.equal(model.unlinked.some((item) => item.id === "TEST-SHARED"), true);
  for (const code of [
    "dossier_cross_story_link_blocked",
    "dossier_link_target_ambiguous",
    "dossier_evidence_link_shared",
    "dossier_evidence_target_jsonl_unsupported",
    "dossier_evidence_target_malformed",
    "dossier_evidence_path_noncanonical",
  ]) {
    assert.equal(model.diagnostics.some((diagnostic) => diagnostic.code === code), true, code);
  }
});

test("projects autonomy records and links them only through explicit dossier references", async (t) => {
  const root = await createProject(t);
  const hash = (character) => character.repeat(64);
  await writeJson(root, ".sdlc/project.json", {
    schema_version: "0.1.0",
    project_id: "autonomy-lineage",
    project_name: "Autonomy Lineage",
  });
  await writeJson(root, ".sdlc/requirements/REQ-A.json", {
    schema_version: "requirement:v2",
    id: "REQ-A",
    title: "Deliver A",
    autonomy_profile_id: "AUT-REQ-A",
  });
  await writeJson(root, ".sdlc/stories/ST-A/story.json", {
    schema_version: "0.1.0",
    id: "ST-A",
    title: "Story A",
    phase: "implementation",
    status: "in_progress",
    contract_id: "CONTRACT-A",
    links: { requirements: ["REQ-A"], decisions: [], tests: [] },
  });
  await writeJson(root, ".sdlc/stories/ST-B/story.json", {
    schema_version: "0.1.0",
    id: "ST-B",
    title: "Story B",
    phase: "implementation",
    status: "in_progress",
    links: { requirements: [], decisions: [], tests: [] },
  });
  await writeJson(root, ".sdlc/contracts/CONTRACT-A.json", {
    schema_version: "0.1.0",
    id: "CONTRACT-A",
    story_id: "ST-A",
    phase: "implementation",
    status: "approved",
    requirement_execution_profile_refs: [{ id: "AUT-REQ-A", hash: hash("a") }],
    delivery_execution_profile_id: "AUT-PR-A",
  });
  await writeJson(root, ".sdlc/contracts/CONTRACT-CROSS-A.json", {
    schema_version: "0.1.0",
    id: "CONTRACT-CROSS-A",
    story_id: "ST-A",
    phase: "implementation",
    status: "approved",
    delivery_execution_profile_id: "AUT-PR-B",
  });
  await writeJson(root, ".sdlc/autonomy/requirements/AUT-REQ-A.json", {
    kind: "requirement_execution_profile",
    schema_version: "requirement-execution-profile:v1",
    id: "AUT-REQ-A",
    status: "active",
    requirement_ref: { id: "REQ-A", version: 1, hash: hash("b") },
    autonomy_ceiling: "checkpointed",
    created_at: "2026-07-16T08:00:00Z",
  });
  await writeJson(root, ".sdlc/custom-policy/requirements/AUT-REQ-ORPHAN.json", {
    kind: "requirement_execution_profile",
    schema_version: "requirement-execution-profile:v1",
    id: "AUT-REQ-ORPHAN",
    status: "active",
    requirement_ref: { id: "REQ-ORPHAN", version: 1, hash: hash("c") },
    autonomy_ceiling: "bounded-autonomous",
  });
  for (const [storyId, deliveryId, profileId, level] of [
    ["ST-A", "PR-A", "AUT-PR-A", "checkpointed"],
    ["ST-B", "PR-B", "AUT-PR-B", "bounded-autonomous"],
  ]) {
    await writeJson(root, `.sdlc/autonomy/deliveries/${profileId}.json`, {
      kind: "delivery_execution_profile",
      schema_version: "delivery-execution-profile:v1",
      id: profileId,
      status: "active",
      delivery_id: deliveryId,
      delivery_kind: "pull_request",
      requested_level: level,
      story_refs: [{ id: storyId, hash: hash("d") }],
      contract_refs: [{ id: storyId === "ST-A" ? "CONTRACT-A" : "CONTRACT-B", hash: hash("e") }],
      profile_hash: hash(storyId === "ST-A" ? "f" : "1"),
      created_at: "2026-07-16T08:10:00Z",
    });
  }
  for (const [deliveryId, profileId, decisionId, level, status] of [
    ["PR-A", "AUT-PR-A", "AUT-DEC-A", "checkpointed", "checkpoint_required"],
    ["PR-B", "AUT-PR-B", "AUT-DEC-B", "bounded-autonomous", "ready"],
  ]) {
    await writeJson(root, `.sdlc/autonomy/decisions/${decisionId}.json`, {
      kind: "autonomy_decision",
      schema_version: "autonomy-decision:v1",
      id: decisionId,
      delivery: {
        id: deliveryId,
        kind: "pull_request",
        profile_id: profileId,
        profile_hash: profileId === "AUT-PR-A" ? hash("f") : hash("1"),
      },
      phase: "implementation",
      requested_level: level,
      effective_level: level,
      execution_status: status,
      reason_codes: profileId === "AUT-PR-A" ? ["authority.audit_only_cap"] : [],
      evaluated_at: "2026-07-16T08:20:00Z",
    });
  }
  await writeJson(root, ".sdlc/stories/ST-A/task-start.json", {
    id: "START-A",
    story_id: "ST-A",
    phase: "implementation",
    status: "confirmed",
    delivery_profile_ref: { id: "AUT-PR-A", hash: hash("f") },
    autonomy_decision_ref: { id: "AUT-DEC-A", hash: hash("2") },
  });

  const model = await buildObservatoryViewModel(root, { clock: () => FIXED_TIME });
  const dossierA = model.dossiers.find((dossier) => dossier.storyId === "ST-A");
  const dossierB = model.dossiers.find((dossier) => dossier.storyId === "ST-B");
  const decidedA = dossierA.lanes.decided.items.map((item) => item.id);
  const decidedB = dossierB.lanes.decided.items.map((item) => item.id);

  assert.equal(decidedA.includes("AUT-REQ-A"), true);
  assert.equal(decidedA.includes("AUT-PR-A"), true);
  assert.equal(decidedA.includes("AUT-DEC-A"), true);
  assert.equal(decidedA.includes("AUT-PR-B"), false);
  assert.equal(decidedA.includes("AUT-DEC-B"), false);
  assert.equal(decidedB.includes("AUT-PR-B"), true);
  assert.equal(decidedB.includes("AUT-DEC-B"), true);
  assert.equal(decidedB.includes("AUT-REQ-A"), false);

  const requirementProfile = model.decisions.find((item) => item.id === "AUT-REQ-A");
  assert.equal(requirementProfile.type, "requirement-execution-profile");
  assert.equal(requirementProfile.title, "Autonomy ceiling for REQ-A");
  assert.equal(requirementProfile.summary, "Maximum checkpointed autonomy for requirement REQ-A.");
  const deliveryProfile = model.decisions.find((item) => item.id === "AUT-PR-A");
  assert.equal(deliveryProfile.title, "Autonomy for pull request PR-A");
  assert.equal(deliveryProfile.summary, "Selected checkpointed autonomy for pull request PR-A.");
  const autonomyDecision = model.decisions.find((item) => item.id === "AUT-DEC-A");
  assert.equal(autonomyDecision.status, "checkpoint_required");
  assert.equal(
    autonomyDecision.summary,
    "requested checkpointed; effective checkpointed; status checkpoint_required; reasons: authority.audit_only_cap.",
  );
  assert.equal(
    model.records.find((record) => record.id === "AUT-REQ-ORPHAN").kind,
    "requirement-execution-profile",
  );
  assert.equal(model.unlinked.some((item) => item.id === "AUT-REQ-ORPHAN"), true);
  assert.equal(
    model.diagnostics.some((diagnostic) => diagnostic.code === "dossier_cross_story_link_blocked"),
    true,
  );
});

test("fails closed when canonical story IDs are duplicated", async (t) => {
  const root = await createProject(t);
  await writeJson(root, ".sdlc/project.json", {
    schema_version: "0.1.0",
    project_id: "duplicate-stories",
    project_name: "Duplicate Stories",
  });
  await writeJson(root, ".sdlc/stories/first/story.json", {
    schema_version: "0.1.0",
    id: "ST-DUPLICATE",
    title: "First duplicate",
    phase: "implementation",
    status: "in_progress",
  });
  await writeJson(root, ".sdlc/stories/second/story.json", {
    schema_version: "0.1.0",
    id: "ST-DUPLICATE",
    title: "Second duplicate",
    phase: "validation",
    status: "in_progress",
  });

  const model = await buildObservatoryViewModel(root, { clock: () => FIXED_TIME });
  assert.equal(model.dossiers.length, 0);
  assert.equal(
    model.iterations.filter((iteration) => iteration.id === "ST-DUPLICATE")
      .every((iteration) => iteration.dossier === null),
    true,
  );
  assert.equal(
    model.diagnostics.some((diagnostic) => diagnostic.code === "dossier_story_id_ambiguous"),
    true,
  );
});

test("orders dossiers deterministically and enforces one global nested-item limit", async (t) => {
  const populate = async (root, reverse) => {
    const records = [
      ["json", ".sdlc/project.json", {
        schema_version: "0.1.0",
        project_id: "bounded-dossiers",
        project_name: "Bounded Dossiers",
      }],
      ...["ST-A", "ST-B"].flatMap((storyId) => [
        ["json", `.sdlc/requirements/REQ-${storyId}.json`, {
          schema_version: "requirement:v1",
          id: `REQ-${storyId}`,
          title: `Requirement ${storyId}`,
        }],
        ["json", `.sdlc/stories/${storyId}/story.json`, {
          schema_version: "0.1.0",
          id: storyId,
          title: `Story ${storyId}`,
          phase: "implementation",
          status: "in_progress",
          contract_id: `CONTRACT-${storyId}`,
          links: { requirements: [`REQ-${storyId}`], decisions: [], tests: [] },
        }],
        ["json", `.sdlc/contracts/CONTRACT-${storyId}.json`, {
          schema_version: "0.1.0",
          id: `CONTRACT-${storyId}`,
          story_id: storyId,
          status: "approved",
        }],
        ["jsonl", `.sdlc/traces/${storyId}.jsonl`, [{
          id: `IMP-${storyId}`,
          story_id: storyId,
          type: "implementation",
          summary: `Implemented ${storyId}`,
          request: { summary: `Deliver ${storyId}` },
        }]],
      ]),
    ];
    for (const [format, relativePath, value] of reverse ? [...records].reverse() : records) {
      if (format === "jsonl") await writeJsonLines(root, relativePath, value);
      else await writeJson(root, relativePath, value);
    }
  };
  const firstRoot = await createProject(t);
  const secondRoot = await createProject(t);
  await populate(firstRoot, false);
  await populate(secondRoot, true);
  const options = { clock: () => FIXED_TIME, limits: { maxCollectionItems: 3 } };
  const first = await buildObservatoryViewModel(firstRoot, options);
  const second = await buildObservatoryViewModel(secondRoot, options);

  assert.deepEqual(first.dossiers, second.dossiers);
  const nestedItems = first.dossiers.reduce(
    (total, dossier) => total + Object.values(dossier.lanes)
      .reduce((laneTotal, lane) => laneTotal + lane.items.length, 0),
    0,
  );
  assert.equal(nestedItems, 3);
  assert.equal(
    first.diagnostics.some((diagnostic) => diagnostic.code === "dossier_nested_items_truncated"),
    true,
  );
  assert.equal(
    first.dossiers.some((dossier) => Object.values(dossier.lanes)
      .some((lane) => lane.status === "malformed")),
    true,
  );
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

test("bounds private-reasoning traversal iteratively and fails closed on extreme nesting", async (t) => {
  const root = await createProject(t);
  await writeJson(root, ".sdlc/project.json", {
    schema_version: "0.1.0",
    project_id: "deep-reasoning-scan",
    project_name: "Deep Reasoning Scan",
  });
  const depth = 12_000;
  const nested = `${'{"next":'.repeat(depth)}{"safe":true}${"}".repeat(depth)}`;
  await writeText(
    root,
    ".sdlc/decisions/DEEP.json",
    `{"id":"DEC-DEEP","summary":"A safe bounded summary.","payload":${nested}}\n`,
  );

  const model = await buildObservatoryViewModel(root, { clock: () => FIXED_TIME });
  const decision = model.decisions.find((item) => item.id === "DEC-DEEP");
  assert.ok(decision);
  assert.equal(decision.explanation.text, "A safe bounded summary.");
  assert.equal(decision.narrative, null);
  assert.equal(
    model.diagnostics.some((diagnostic) => diagnostic.code === "private_reasoning_scan_limited"),
    true,
  );
  assert.equal(
    model.diagnostics.some((diagnostic) => diagnostic.code === "private_reasoning_redacted"),
    true,
  );
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
