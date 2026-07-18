import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildObservatoryViewModel,
  readSourceRecord,
} from "../../lib/change-observatory/index.mjs";
import {
  REDACTION_LIMIT_PLACEHOLDER,
  createRedactionPolicy,
} from "../../lib/observability/redaction.mjs";

const ACTION_ID = "AUT-ACT-20260718112254904-6a4356";
const SHA256 = "a".repeat(64);
const UUID = "123e4567-e89b-42d3-a456-426614174000";
const CORRELATION_ID = `corr-${UUID}`;
const SECRET = "secret-entropy-value";
const EMAIL = "owner@example.test";
const REDACTION_CONFIG = Object.freeze({
  secrets: [SECRET],
  piiPatterns: [{
    name: "email",
    pattern: "[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}",
  }],
});

test("redacts structured and text source presentations while preserving governance identifiers", async (t) => {
  const root = await createProject(t);
  const policy = createRedactionPolicy(REDACTION_CONFIG);
  const structured = {
    title: `Deploy ${SECRET}`,
    summary: `Owner ${EMAIL}`,
    action: ACTION_ID,
    sha256: SHA256,
    uuid: UUID,
    correlation_id: CORRELATION_ID,
    password: "credential-material",
    private_reasoning: "never expose this reasoning",
  };
  await writeJson(root, ".sdlc/private.json", structured);
  await writeText(root, ".sdlc/private.jsonl", `${JSON.stringify(structured)}\n`);
  const narrative = [
    `Deploy ${SECRET} for ${EMAIL}.`,
    ACTION_ID,
    SHA256,
    UUID,
    CORRELATION_ID,
    "",
  ].join("\n");
  await writeText(root, ".sdlc/private.md", narrative);
  await writeText(root, ".sdlc/private.txt", narrative);

  const json = await readSourceRecord(root, ".sdlc/private.json", { redactionPolicy: policy });
  assert.equal(json.data.title, "Deploy [REDACTED]");
  assert.equal(json.data.summary, "Owner [REDACTED]");
  assert.equal(json.data.password, "[REDACTED]");
  assert.equal(json.data.private_reasoning, "[redacted]");
  assertIdentifiersRemain(json.data);
  assertRepresentationMetadata(json, JSON.stringify(json.data));

  const jsonl = await readSourceRecord(root, ".sdlc/private.jsonl", { redactionPolicy: policy });
  assert.equal(jsonl.entries[0].data.title, "Deploy [REDACTED]");
  assert.equal(jsonl.entries[0].data.summary, "Owner [REDACTED]");
  assert.equal(jsonl.entries[0].data.private_reasoning, "[redacted]");
  assertIdentifiersRemain(jsonl.entries[0].data);
  assertRepresentationMetadata(jsonl, `${JSON.stringify(jsonl.entries[0].data)}\n`);

  for (const relativePath of [".sdlc/private.md", ".sdlc/private.txt"]) {
    const source = await readSourceRecord(root, relativePath, { redactionPolicy: policy });
    assert.equal(source.content.includes(SECRET), false);
    assert.equal(source.content.includes(EMAIL), false);
    assert.equal(source.content.includes("[REDACTED]"), true);
    assert.equal(source.content.includes(ACTION_ID), true);
    assert.equal(source.content.includes(SHA256), true);
    assert.equal(source.content.includes(UUID), true);
    assert.equal(source.content.includes(CORRELATION_ID), true);
    assertRepresentationMetadata(source, source.content);
  }

  for (const source of [json, jsonl]) {
    const serialized = JSON.stringify(source);
    assert.equal(serialized.includes(SECRET), false);
    assert.equal(serialized.includes(EMAIL), false);
    assert.equal(serialized.includes("never expose this reasoning"), false);
  }
});

test("sanitizes normalized presentation fields and their derived text surfaces", async (t) => {
  const root = await createProject(t);
  await writeJson(root, ".sdlc/project.json", {
    schema_version: "0.1.0",
    project_id: "privacy-project",
    project_name: "Privacy Project",
  });
  await writeJson(root, ".sdlc/stories/ST-PRIVACY/story.json", {
    schema_version: "0.1.0",
    id: "ST-PRIVACY",
    title: `Implement ${SECRET}`,
    summary: `Requested by ${EMAIL}`,
    action: ACTION_ID,
    phase: "implementation",
    status: "active",
  });
  await writeText(root, ".sdlc/traces/ST-PRIVACY.jsonl", `${JSON.stringify({
    id: "TR-PRIVATE",
    story_id: "ST-PRIVACY",
    type: "decision",
    summary: `Decision for ${EMAIL}`,
    action: CORRELATION_ID,
    private_reasoning: "PRIVATE_REASONING_MUST_NOT_LEAK",
  })}\n`);

  const model = await buildObservatoryViewModel(root, {
    clock: () => new Date("2026-07-18T12:00:00.000Z"),
    redaction: REDACTION_CONFIG,
  });
  const iteration = model.iterations.find((item) => item.id === "ST-PRIVACY");
  const decision = model.decisions.find((item) => item.id === "TR-PRIVATE");

  assert.equal(iteration.title, "Implement [REDACTED]");
  assert.equal(iteration.summary, "Requested by [REDACTED]");
  assert.equal(iteration.action, ACTION_ID);
  assert.equal(decision.summary, "Decision for [REDACTED]");
  assert.equal(decision.action, CORRELATION_ID);
  assert.equal(decision.explanation.text, "Decision for [REDACTED]");
  assert.equal(decision.narrative, null);
  const serialized = JSON.stringify(model);
  assert.equal(serialized.includes(SECRET), false);
  assert.equal(serialized.includes(EMAIL), false);
  assert.equal(serialized.includes("PRIVATE_REASONING_MUST_NOT_LEAK"), false);
  assert.equal(serialized.includes(ACTION_ID), true);
  assert.equal(serialized.includes(CORRELATION_ID), true);
  assert.equal(
    model.diagnostics.some((diagnostic) => diagnostic.code === "presentation_fields_redacted"),
    true,
  );
  assert.equal(
    model.diagnostics.some((diagnostic) => diagnostic.code === "private_reasoning_redacted"),
    true,
  );
});

test("fails closed when configured redaction limits are exceeded", async (t) => {
  const root = await createProject(t);
  const repeatedSecret = "repeat-secret";
  const redaction = {
    secrets: [repeatedSecret],
    limits: { maxMatches: 1 },
  };
  const policy = createRedactionPolicy(redaction);
  await writeJson(root, ".sdlc/project.json", {
    schema_version: "0.1.0",
    project_id: "bounded-redaction",
    project_name: "Bounded Redaction",
  });
  await writeJson(root, ".sdlc/stories/ST-LIMIT/story.json", {
    schema_version: "0.1.0",
    id: "ST-LIMIT",
    title: `${repeatedSecret} ${repeatedSecret}`,
  });
  await writeText(root, ".sdlc/limited.md", `${repeatedSecret} ${repeatedSecret}\n`);

  const structured = await readSourceRecord(root, ".sdlc/stories/ST-LIMIT/story.json", {
    redactionPolicy: policy,
  });
  assert.equal(structured.contentOmitted, true);
  assert.equal(structured.parseError, "presentation_redaction_limited");
  assert.equal(Object.hasOwn(structured, "data"), false);
  assertRepresentationMetadata(structured, REDACTION_LIMIT_PLACEHOLDER);

  const markdown = await readSourceRecord(root, ".sdlc/limited.md", {
    redactionPolicy: policy,
  });
  assert.equal(markdown.contentOmitted, true);
  assert.equal(markdown.parseError, "presentation_redaction_limited");
  assert.equal(Object.hasOwn(markdown, "content"), false);
  assertRepresentationMetadata(markdown, REDACTION_LIMIT_PLACEHOLDER);

  const model = await buildObservatoryViewModel(root, {
    clock: () => new Date("2026-07-18T12:00:00.000Z"),
    redactionPolicy: policy,
  });
  assert.equal(JSON.stringify(model).includes(repeatedSecret), false);
  assert.equal(
    model.iterations.find((item) => item.id === "ST-LIMIT")?.title,
    REDACTION_LIMIT_PLACEHOLDER,
  );
  assert.equal(
    model.diagnostics.some((diagnostic) => diagnostic.code === "presentation_redaction_limited"),
    true,
  );
});

function assertIdentifiersRemain(value) {
  assert.equal(value.action, ACTION_ID);
  assert.equal(value.sha256, SHA256);
  assert.equal(value.uuid, UUID);
  assert.equal(value.correlation_id, CORRELATION_ID);
}

function assertRepresentationMetadata(source, representation) {
  const bytes = Buffer.from(representation, "utf8");
  assert.equal(source.sizeBytes, bytes.byteLength);
  assert.equal(
    source.sha256,
    crypto.createHash("sha256").update(bytes).digest("hex"),
  );
}

async function createProject(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "change-observatory-privacy-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, ".sdlc"), { recursive: true });
  return root;
}

async function writeJson(root, relativePath, value) {
  await writeText(root, relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeText(root, relativePath, value) {
  const absolute = path.join(root, ...relativePath.split("/"));
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, value, "utf8");
}
