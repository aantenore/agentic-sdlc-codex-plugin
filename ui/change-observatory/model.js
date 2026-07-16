export const VIEW_MODEL_SCHEMA = "change-observatory:view:v1";

export const PHASES = Object.freeze([
  "discovery",
  "analysis",
  "design",
  "implementation",
  "validation",
  "release",
]);

const PROVENANCE = new Set(["recorded", "inferred", "missing", "malformed"]);
const PHASE_STATES = new Set(["complete", "inProgress", "blocked", "missing"]);

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

export function readable(value, fallback = "Not recorded") {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return fallback;
}

export function sentenceCase(value) {
  const text = readable(value, "");
  if (!text) return "Not recorded";
  return text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/^./, (character) => character.toUpperCase());
}

export function normalizeProvenance(value) {
  return PROVENANCE.has(value) ? value : "missing";
}

function normalizeSourceRef(value) {
  const source = objectOrEmpty(value);
  const path = readable(source.path, "");
  if (!path) return null;
  return {
    path,
    pointer: readable(source.pointer, "") || null,
  };
}

function normalizeNarrative(value) {
  const narrative = objectOrEmpty(value);
  return {
    inputSummary: readable(narrative.input_summary ?? narrative.inputSummary, "") || null,
    outputSummary: readable(narrative.output_summary ?? narrative.outputSummary, "") || null,
    rationale: readable(narrative.rationale, "") || null,
    generatedExplanation:
      readable(narrative.generated_explanation ?? narrative.generatedExplanation, "") || null,
    explanationSource:
      readable(narrative.explanation_source ?? narrative.explanationSource, "") || null,
    alternatives: arrayOrEmpty(narrative.alternatives).map(normalizeNarrativeEntry).filter(Boolean),
    evidence: arrayOrEmpty(narrative.evidence).map(normalizeNarrativeEntry).filter(Boolean),
    chainOfThoughtIncluded: narrative.chain_of_thought_included === true,
  };
}

function normalizeNarrativeEntry(value) {
  if (typeof value === "string") {
    const text = readable(value, "");
    return text ? { title: text, summary: null, sourceRefs: [] } : null;
  }

  const entry = objectOrEmpty(value);
  const title = readable(entry.title ?? entry.id ?? entry.summary, "");
  if (!title) return null;
  return {
    title,
    summary: readable(entry.summary, "") || null,
    sourceRefs: arrayOrEmpty(entry.sourceRefs).map(normalizeSourceRef).filter(Boolean),
  };
}

function normalizeMappedEntry(value) {
  return normalizeNarrativeEntry(value);
}

export function normalizeItem(value) {
  const item = objectOrEmpty(value);
  const sourceRefs = arrayOrEmpty(item.sourceRefs).map(normalizeSourceRef).filter(Boolean);
  const narrative = normalizeNarrative(item.narrative);
  const explanation = objectOrEmpty(item.explanation);

  return {
    id: readable(item.id, "Unidentified record"),
    type: readable(item.type, "record"),
    title: readable(item.title ?? item.summary, "Untitled record"),
    summary: readable(item.summary, "No recorded summary."),
    status: readable(item.status, "missing"),
    phase: readable(item.phase, "") || null,
    action: readable(item.action, "") || null,
    timestamp: readable(item.timestamp, "") || null,
    provenance: normalizeProvenance(item.provenance),
    sourceRefs,
    rawHref: safeRawHref(item.rawHref),
    intent: readable(item.intent, "") || null,
    narrative,
    explanation: {
      text: readable(explanation.text, "") || null,
      authoring: readable(explanation.authoring, "") || null,
      provenance: normalizeProvenance(explanation.provenance),
      sourceRefs: arrayOrEmpty(explanation.sourceRefs).map(normalizeSourceRef).filter(Boolean),
    },
    inputs: arrayOrEmpty(item.inputs).map(normalizeMappedEntry).filter(Boolean),
    outputs: arrayOrEmpty(item.outputs).map(normalizeMappedEntry).filter(Boolean),
    alternatives: arrayOrEmpty(item.alternatives).map(normalizeMappedEntry).filter(Boolean),
    evidence: arrayOrEmpty(item.evidence).map(normalizeMappedEntry).filter(Boolean),
  };
}

function normalizePhase(value, fallbackPhase) {
  const phase = objectOrEmpty(value);
  const status = PHASE_STATES.has(phase.status) ? phase.status : "missing";
  return {
    phase: readable(phase.phase, fallbackPhase),
    status,
    provenance: normalizeProvenance(phase.provenance),
    sourceRefs: arrayOrEmpty(phase.sourceRefs).map(normalizeSourceRef).filter(Boolean),
  };
}

function normalizeIteration(value, index) {
  const iteration = normalizeItem(value);
  const byPhase = new Map(
    arrayOrEmpty(value?.phases).map((phase) => [readable(phase?.phase, "").toLowerCase(), phase]),
  );
  return {
    ...iteration,
    title: readable(value?.title, `Iteration ${index + 1}`),
    currentPhase: readable(value?.currentPhase, "") || null,
    phases: PHASES.map((phase) => normalizePhase(byPhase.get(phase), phase)),
  };
}

function normalizeRecord(value) {
  const record = objectOrEmpty(value);
  const path = readable(record.path, "");
  return {
    path,
    kind: readable(record.kind, "record"),
    provenance: normalizeProvenance(record.provenance),
    rawHref: safeRawHref(record.rawHref) ?? rawHrefForPath(path),
  };
}

function normalizeDiagnostic(value) {
  const diagnostic = objectOrEmpty(value);
  const severity = ["info", "warning", "error"].includes(diagnostic.severity)
    ? diagnostic.severity
    : "warning";
  const occurrences = Number.isSafeInteger(diagnostic.occurrences) && diagnostic.occurrences > 0
    ? diagnostic.occurrences
    : 1;
  return {
    code: readable(diagnostic.code, "OBSERVATORY_DIAGNOSTIC"),
    severity,
    message: readable(diagnostic.message, "The evidence API reported an unspecified diagnostic."),
    occurrences,
    provenance: normalizeProvenance(diagnostic.provenance),
    sourceRefs: arrayOrEmpty(diagnostic.sourceRefs).map(normalizeSourceRef).filter(Boolean),
  };
}

function normalizeDiagnostics(values) {
  const grouped = new Map();
  for (const value of arrayOrEmpty(values)) {
    const diagnostic = normalizeDiagnostic(value);
    const fingerprint = JSON.stringify([
      diagnostic.code,
      diagnostic.severity,
      diagnostic.message,
      diagnostic.provenance,
    ]);
    const existing = grouped.get(fingerprint);
    if (!existing) {
      grouped.set(fingerprint, diagnostic);
      continue;
    }
    existing.occurrences += diagnostic.occurrences;
    const seen = new Set(existing.sourceRefs.map((ref) => `${ref.path}\u0000${ref.pointer ?? ""}`));
    for (const ref of diagnostic.sourceRefs) {
      const key = `${ref.path}\u0000${ref.pointer ?? ""}`;
      if (!seen.has(key) && existing.sourceRefs.length < 12) {
        existing.sourceRefs.push(ref);
        seen.add(key);
      }
    }
  }
  return [...grouped.values()];
}

export function normalizeViewModel(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("The observatory API returned a non-object payload.");
  }
  if (payload.schemaVersion !== VIEW_MODEL_SCHEMA) {
    throw new TypeError(
      `Unsupported observatory schema ${readable(payload.schemaVersion, "(missing)")}; expected ${VIEW_MODEL_SCHEMA}.`,
    );
  }

  const summary = objectOrEmpty(payload.summary);
  const project = objectOrEmpty(payload.project);
  const snapshots = objectOrEmpty(payload.snapshots);

  return {
    schemaVersion: VIEW_MODEL_SCHEMA,
    generatedAt: readable(payload.generatedAt, "") || null,
    project: {
      id: readable(project.id ?? project.projectId, "Unknown project"),
      name: readable(project.name ?? project.projectName ?? project.id, "Unknown project"),
      root: readable(project.root, "") || null,
      branch: readable(project.branch, "") || null,
      snapshot: readable(project.snapshot, "") || null,
    },
    snapshots: {
      counts: objectOrEmpty(snapshots.counts),
      phaseCounts: objectOrEmpty(snapshots.phaseCounts),
    },
    summary: {
      asked: arrayOrEmpty(summary.asked).map(normalizeItem),
      changed: arrayOrEmpty(summary.changed).map(normalizeItem),
      decided: arrayOrEmpty(summary.decided).map(normalizeItem),
    },
    iterations: arrayOrEmpty(payload.iterations).map(normalizeIteration),
    contracts: arrayOrEmpty(payload.contracts).map(normalizeItem),
    decisions: arrayOrEmpty(payload.decisions).map(normalizeItem),
    changes: arrayOrEmpty(payload.changes).map(normalizeItem),
    verification: arrayOrEmpty(payload.verification).map(normalizeItem),
    records: arrayOrEmpty(payload.records).map(normalizeRecord).filter((record) => record.path),
    diagnostics: normalizeDiagnostics(payload.diagnostics),
  };
}

export function filterIterations(iterations, filters = {}) {
  return arrayOrEmpty(iterations).filter((iteration) => {
    const iterationMatch = !filters.iteration || iteration.id === filters.iteration;
    const phaseMatch =
      !filters.phase ||
      iteration.currentPhase === filters.phase ||
      iteration.phases.some(
        (phase) => phase.phase === filters.phase && phase.status !== "missing",
      );
    return iterationMatch && phaseMatch;
  });
}

export function groupChangesByIntent(changes) {
  const groups = new Map();
  for (const change of arrayOrEmpty(changes)) {
    const key = change.intent || change.phase || change.action || change.type || "Intent not recorded";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(change);
  }
  return [...groups.entries()].map(([intent, items]) => ({ intent, items }));
}

export function narrativeFor(item) {
  if (!item) {
    return {
      inputs: [],
      outputs: [],
      rationale: null,
      generatedExplanation: null,
      explanationLabel: null,
      alternatives: [],
      evidence: [],
      chainOfThoughtIncluded: false,
    };
  }

  const narrative = item.narrative ?? normalizeNarrative(null);
  const generatedExplanation = narrative.generatedExplanation || item.explanation?.text || null;
  const explanationSource =
    narrative.explanationSource || item.explanation?.authoring || (generatedExplanation ? "recorded" : null);

  return {
    inputs: narrative.inputSummary
      ? [{ title: narrative.inputSummary, summary: null, sourceRefs: item.sourceRefs }]
      : item.inputs ?? [],
    outputs: narrative.outputSummary
      ? [{ title: narrative.outputSummary, summary: null, sourceRefs: item.sourceRefs }]
      : item.outputs ?? [],
    rationale: narrative.rationale,
    generatedExplanation,
    explanationLabel: explanationSource,
    alternatives: narrative.alternatives.length ? narrative.alternatives : item.alternatives ?? [],
    evidence: narrative.evidence.length ? narrative.evidence : item.evidence ?? [],
    chainOfThoughtIncluded: narrative.chainOfThoughtIncluded,
  };
}

export function firstSummaryItem(items) {
  return arrayOrEmpty(items)[0] ?? null;
}

export function rawHrefForPath(path) {
  const clean = readable(path, "");
  if (!isCanonicalEvidencePath(clean)) return null;
  return `/api/v1/source?path=${encodeURIComponent(clean)}`;
}

export function safeRawHref(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  let url;
  try {
    url = new URL(value, "http://observatory.local");
  } catch {
    return null;
  }
  if (url.origin !== "http://observatory.local" || url.pathname !== "/api/v1/source") return null;
  const path = url.searchParams.get("path");
  return rawHrefForPath(path);
}

export function rawTargetFor(item) {
  if (!item) return null;
  if (safeRawHref(item.rawHref)) {
    return {
      href: safeRawHref(item.rawHref),
      path: new URL(item.rawHref, "http://observatory.local").searchParams.get("path"),
    };
  }
  const source = arrayOrEmpty(item.sourceRefs).find((ref) => isCanonicalEvidencePath(ref.path));
  if (!source) return null;
  return { href: rawHrefForPath(source.path), path: source.path };
}

export function isCanonicalEvidencePath(path) {
  if (typeof path !== "string" || !path.startsWith(".sdlc/")) return false;
  if (path.includes("\0") || path.includes("\\")) return false;
  return !path.split("/").some((segment) => segment === ".." || segment === ".");
}

export function formatTimestamp(value) {
  if (!value) return "Time not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
