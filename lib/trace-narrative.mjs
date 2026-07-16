export const TRACE_EXPLANATION_KINDS = Object.freeze([
  "codex-generated",
  "deterministic",
  "human-authored",
]);

const EXPLANATION_KINDS = new Set(TRACE_EXPLANATION_KINDS);

export function buildTraceNarrative(options = {}) {
  const inputSummaries = normalizeList(options["input-summary"]);
  const outputSummaries = normalizeList(options["output-summary"]);
  const alternatives = normalizeList(options.alternative);
  const rationaleSummary = normalizeOptionalText(options["rationale-summary"]);
  const explanationText = normalizeOptionalText(options.explanation);
  const rawKind = normalizeOptionalText(options["explanation-kind"]);

  if (rawKind && !explanationText) {
    throw new TypeError("--explanation-kind requires --explanation");
  }
  if (rawKind && !EXPLANATION_KINDS.has(rawKind)) {
    throw new TypeError(
      `--explanation-kind must be one of: ${TRACE_EXPLANATION_KINDS.join(", ")}`,
    );
  }

  if (
    inputSummaries.length === 0
    && outputSummaries.length === 0
    && alternatives.length === 0
    && !rationaleSummary
    && !explanationText
  ) {
    return null;
  }

  return {
    schema_version: "trace-narrative:v1",
    input_summaries: inputSummaries,
    output_summaries: outputSummaries,
    rationale_summary: rationaleSummary,
    alternatives,
    ...(explanationText
      ? {
        explanation: {
          text: explanationText,
          kind: rawKind || "deterministic",
          scope: "recorded-evidence-only",
        },
      }
      : {}),
  };
}

function normalizeList(value) {
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return values.map(normalizeOptionalText).filter(Boolean);
}

function normalizeOptionalText(value) {
  if (value === undefined || value === null || value === true) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.length > 16_384) {
    throw new TypeError("Trace narrative fields must not exceed 16384 characters");
  }
  return text;
}
