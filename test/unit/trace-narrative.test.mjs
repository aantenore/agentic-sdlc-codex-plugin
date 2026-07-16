import assert from "node:assert/strict";
import test from "node:test";

import {
  TRACE_EXPLANATION_KINDS,
  buildTraceNarrative,
} from "../../lib/trace-narrative.mjs";

test("builds a labeled shareable narrative with repeatable inputs and outputs", () => {
  const narrative = buildTraceNarrative({
    "input-summary": ["Approved requirement", "Recorded contract"],
    "output-summary": ["Launcher", "Installed-package test"],
    "rationale-summary": "Keep evidence local and reproducible.",
    alternative: ["Hosted dashboard", "Framework build"],
    explanation: "The packaged launcher serves the recorded project lineage locally.",
    "explanation-kind": "codex-generated",
  });

  assert.deepEqual(narrative, {
    schema_version: "trace-narrative:v1",
    input_summaries: ["Approved requirement", "Recorded contract"],
    output_summaries: ["Launcher", "Installed-package test"],
    rationale_summary: "Keep evidence local and reproducible.",
    alternatives: ["Hosted dashboard", "Framework build"],
    explanation: {
      text: "The packaged launcher serves the recorded project lineage locally.",
      kind: "codex-generated",
      scope: "recorded-evidence-only",
    },
  });
  assert.equal(JSON.stringify(narrative).includes("reasoning"), false);
  assert.equal(JSON.stringify(narrative).includes("chain_of_thought"), false);
});

test("omits empty narratives and defaults unlabeled explanations to deterministic", () => {
  assert.equal(buildTraceNarrative({}), null);
  assert.equal(
    buildTraceNarrative({ explanation: "Derived from the recorded event." }).explanation.kind,
    "deterministic",
  );
});

test("rejects invalid or detached explanation kinds", () => {
  assert.deepEqual(TRACE_EXPLANATION_KINDS, [
    "codex-generated",
    "deterministic",
    "human-authored",
  ]);
  assert.throws(
    () => buildTraceNarrative({ "explanation-kind": "codex-generated" }),
    /requires --explanation/,
  );
  assert.throws(
    () => buildTraceNarrative({ explanation: "Text", "explanation-kind": "private" }),
    /must be one of/,
  );
});
