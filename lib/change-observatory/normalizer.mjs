import fs from "node:fs/promises";
import path from "node:path";

import {
  CANONICAL_SOURCE_EXTENSIONS,
  OBSERVATORY_VIEW_SCHEMA_VERSION,
  SDLC_PHASES,
  normalizeObservatoryLimits,
} from "./constants.mjs";
import {
  ObservatoryPathError,
  isContainedPath,
  resolveKnowledgeBaseBoundary,
  resolveProjectBoundary,
} from "./path-safety.mjs";
import {
  INTENTABI_REDACTED_OBSERVATION_PATH,
  isCanonicalIntentAbiObservationPath,
  isIntentAbiCodexEnvelopeCandidate,
  isIntentAbiObservationPath,
  projectIntentAbiCodexEnvelope,
} from "./intentabi-adapter.mjs";
import { rankSummaryItems } from "./summary-ranking.mjs";

const SUPPORTED_EXTENSIONS = new Set(CANONICAL_SOURCE_EXTENSIONS);
const DERIVED_DIRECTORIES = new Set(["cache", "indexes"]);
const PRIVATE_REASONING_KEYS = new Set([
  "chainofthought",
  "internalreasoning",
  "privatereasoning",
  "reasoningtrace",
]);
const PRIVATE_REASONING_FLAG_KEYS = new Set(["chainofthoughtincluded"]);
const PRIVATE_REASONING_SCAN_MAX_DEPTH = 512;
const PRIVATE_REASONING_SCAN_MAX_NODES = 25_000;
const DOSSIER_SCHEMA_VERSION = "change-observatory:iteration-dossier:v1";
const DOSSIER_LANES = Object.freeze(["asked", "decided", "contract", "done", "verified"]);

class DiagnosticCollector {
  constructor(limit) {
    this.limit = limit;
    this.items = [];
    this.overflow = 0;
    this.byFingerprint = new Map();
  }

  add({ code, severity = "warning", message, provenance = "inferred", sourceRefs = [] }) {
    const normalizedRefs = sourceRefs.map(normalizeSourceRef).slice(0, 12);
    const fingerprint = JSON.stringify([code, severity, message, provenance]);
    const existing = this.byFingerprint.get(fingerprint);
    if (existing) {
      existing.occurrences += 1;
      const seen = new Set(existing.sourceRefs.map(sourceRefFingerprint));
      for (const ref of normalizedRefs) {
        const key = sourceRefFingerprint(ref);
        if (!seen.has(key) && existing.sourceRefs.length < 12) {
          existing.sourceRefs.push(ref);
          seen.add(key);
        }
      }
      return;
    }
    const diagnostic = {
      code,
      severity,
      message,
      provenance,
      occurrences: 1,
      sourceRefs: normalizedRefs,
    };
    if (this.items.length < this.limit) {
      this.items.push(diagnostic);
      this.byFingerprint.set(fingerprint, diagnostic);
    } else {
      this.overflow += 1;
    }
  }

  finish() {
    if (this.overflow > 0 && this.limit > 0) {
      const sentinel = {
        code: "diagnostics_truncated",
        severity: "warning",
        message: `${this.overflow} additional diagnostics were omitted by the configured limit.`,
        provenance: "inferred",
        occurrences: this.overflow,
        sourceRefs: [],
      };
      if (this.items.length < this.limit) {
        this.items.push(sentinel);
      } else {
        this.items[this.items.length - 1] = sentinel;
      }
    }
    return this.items;
  }
}

function sourceRefFingerprint(ref) {
  return `${ref.path}\u0000${ref.line ?? ""}\u0000${ref.pointer ?? ""}`;
}

export async function buildObservatoryViewModel(projectRoot, options = {}) {
  const limits = normalizeObservatoryLimits(options.limits);
  const clock = typeof options.clock === "function" ? options.clock : () => new Date();
  const generatedAt = normalizeGeneratedAt(clock());
  const diagnostics = new DiagnosticCollector(limits.maxDiagnostics);
  const scan = await scanKnowledgeBase(projectRoot, { limits, diagnostics });
  const records = scan.records;
  reportPrivateReasoningDiagnostics(records, diagnostics);

  const projectRecord = records.find((record) => record.path === ".sdlc/project.json");
  const project = normalizeProject(projectRecord, scan.projectRoot, diagnostics, limits);

  const requirementItems = records
    .filter((record) => record.kind === "requirement" && isRecordObject(record))
    .map((record) => itemFromRecord(record, { limits, diagnostics }));

  const requestItems = records
    .filter((record) => record.kind === "trace" && isRecordObject(record))
    .flatMap((record) => requestItemsFromTrace(record, limits));

  const contracts = records
    .filter((record) => record.kind === "contract" && isRecordObject(record))
    .map((record) => itemFromRecord(record, { limits, diagnostics }));

  const approvals = records.flatMap((record) => approvalItemsFromRecord(record, limits, diagnostics));
  const decisions = [
    ...records
      .filter((record) => ["decision", "assumption", "risk"].includes(record.kind) && isRecordObject(record))
      .map((record) => itemFromRecord(record, { limits, diagnostics })),
    ...records
      .filter((record) => record.kind === "trace" && isDecisionTrace(record.data))
      .map((record) => itemFromRecord(record, { limits, diagnostics })),
    ...approvals,
  ];

  const changes = records
    .filter((record) => record.kind === "trace" && ["implementation", "sync"].includes(record.data?.type))
    .map((record) => itemFromRecord(record, { limits, diagnostics }));

  const verification = records
    .filter((record) => isVerificationRecord(record))
    .map((record) => itemFromRecord(record, { limits, diagnostics }));

  const semanticObservations = normalizeSemanticObservations(records, limits, diagnostics);
  const baseIterations = normalizeIterations(records, limits, diagnostics);
  const dossierView = normalizeIterationDossiers(records, baseIterations, limits, diagnostics);
  const iterations = baseIterations.map((iteration) => ({
    ...iteration,
    dossier: dossierView.byStoryId.get(iteration.id) ?? null,
  }));
  const publicRecords = records
    .map((record) => publicRecordMetadata(record, limits))
    .filter(Boolean);

  const normalized = {
    schemaVersion: OBSERVATORY_VIEW_SCHEMA_VERSION,
    generatedAt,
    project,
    snapshots: buildSnapshots({
      iterations,
      contracts,
      decisions,
      changes,
      verification,
      semanticObservations,
      dossiers: dossierView.dossiers,
      unlinked: dossierView.unlinked,
      records: publicRecords,
    }),
    summary: {
      asked: capCollection(
        dedupeItems([...requirementItems, ...requestItems]),
        limits,
        diagnostics,
        "summary.asked",
      ),
      changed: capCollection(
        rankSummaryItems(changes, "changed", options.summaryRanking?.changed),
        limits,
        diagnostics,
        "summary.changed",
      ),
      decided: capCollection(
        rankSummaryItems(decisions, "decided", options.summaryRanking?.decided),
        limits,
        diagnostics,
        "summary.decided",
      ),
    },
    iterations: capCollection(iterations, limits, diagnostics, "iterations"),
    contracts: capCollection(sortItems(contracts), limits, diagnostics, "contracts"),
    decisions: capCollection(sortItems(decisions), limits, diagnostics, "decisions"),
    changes: capCollection(sortItems(changes), limits, diagnostics, "changes"),
    verification: capCollection(sortItems(verification), limits, diagnostics, "verification"),
    semanticObservations: capCollection(
      sortItems(semanticObservations),
      limits,
      diagnostics,
      "semanticObservations",
    ),
    dossiers: capCollection(dossierView.dossiers, limits, diagnostics, "dossiers"),
    unlinked: capCollection(dossierView.unlinked, limits, diagnostics, "unlinked"),
    records: capCollection(publicRecords, limits, diagnostics, "records"),
    diagnostics: [],
  };

  normalized.diagnostics = diagnostics.finish();
  return normalized;
}

async function scanKnowledgeBase(projectRoot, { limits, diagnostics }) {
  const resolvedProjectRoot = await resolveProjectBoundary(projectRoot);
  let boundary;
  try {
    boundary = await resolveKnowledgeBaseBoundary(resolvedProjectRoot, { allowMissing: true });
  } catch (error) {
    if (!(error instanceof ObservatoryPathError)) {
      throw error;
    }
    diagnostics.add({
      code: error.code,
      severity: "error",
      message: "The .sdlc knowledge base could not be read within the selected project boundary.",
      provenance: "malformed",
      sourceRefs: [{ path: ".sdlc" }],
    });
    return { projectRoot: resolvedProjectRoot, records: [] };
  }

  if (!boundary.knowledgeBaseRoot) {
    diagnostics.add({
      code: "knowledge_base_missing",
      severity: "warning",
      message: "No .sdlc knowledge base is recorded for this project.",
      provenance: "missing",
      sourceRefs: [{ path: ".sdlc" }],
    });
    return { projectRoot: boundary.projectRoot, records: [] };
  }

  const state = {
    fileCount: 0,
    totalBytes: 0,
    stopped: false,
    records: [],
  };
  await walkKnowledgeBase(boundary.knowledgeBaseRoot, "", 0, state, limits, diagnostics);

  if (!state.records.some((record) => record.path === ".sdlc/project.json")) {
    diagnostics.add({
      code: "project_record_missing",
      severity: "warning",
      message: "The canonical .sdlc/project.json record is missing.",
      provenance: "missing",
      sourceRefs: [{ path: ".sdlc/project.json" }],
    });
  }

  state.records.sort(compareRecords);
  return { projectRoot: boundary.projectRoot, records: state.records };
}

async function walkKnowledgeBase(root, relativeDirectory, depth, state, limits, diagnostics) {
  if (state.stopped) {
    return;
  }
  if (depth > limits.maxDepth) {
    diagnostics.add({
      code: "max_depth_exceeded",
      message: "A knowledge-base directory was skipped because it exceeds the configured depth limit.",
      sourceRefs: [{ path: toKnowledgeBasePath(relativeDirectory) }],
    });
    return;
  }

  const absoluteDirectory = path.join(root, ...portableSegments(relativeDirectory));
  let entries;
  try {
    entries = await fs.readdir(absoluteDirectory, { withFileTypes: true });
  } catch {
    diagnostics.add({
      code: "directory_unreadable",
      severity: "error",
      message: "A knowledge-base directory could not be read.",
      provenance: "malformed",
      sourceRefs: [{ path: toKnowledgeBasePath(relativeDirectory) }],
    });
    return;
  }

  entries.sort((left, right) => compareStrings(left.name, right.name));
  for (const entry of entries) {
    if (state.stopped) {
      return;
    }
    const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
    const publicPath = toKnowledgeBasePath(relative);
    const absolute = path.join(root, ...portableSegments(relative));

    if (entry.isSymbolicLink()) {
      let code = "symlink_ignored";
      let severity = "info";
      let message = "A symbolic link was ignored while scanning canonical evidence.";
      try {
        const target = await fs.realpath(absolute);
        if (!isContainedPath(root, target)) {
          code = "symlink_escape";
          severity = "error";
          message = "A symbolic link resolving outside .sdlc was blocked.";
        }
      } catch {
        code = "symlink_unresolved";
        severity = "warning";
        message = "An unresolved symbolic link was ignored.";
      }
      diagnostics.add({ code, severity, message, sourceRefs: [{ path: publicPath }] });
      continue;
    }

    if (entry.isDirectory()) {
      if (relativeDirectory === "" && DERIVED_DIRECTORIES.has(entry.name.toLowerCase())) {
        continue;
      }
      await walkKnowledgeBase(root, relative, depth + 1, state, limits, diagnostics);
      continue;
    }

    if (!entry.isFile() || !SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      continue;
    }
    await readCanonicalFile(absolute, publicPath, state, limits, diagnostics);
  }
}

async function readCanonicalFile(absolute, publicPath, state, limits, diagnostics) {
  if (state.fileCount >= limits.maxFiles) {
    state.stopped = true;
    diagnostics.add({
      code: "max_files_exceeded",
      message: "Additional knowledge-base files were skipped by the configured file limit.",
      sourceRefs: [{ path: ".sdlc" }],
    });
    return;
  }

  let stats;
  try {
    stats = await fs.stat(absolute);
  } catch {
    diagnostics.add({
      code: "file_unreadable",
      severity: "error",
      message: "A canonical evidence file could not be inspected.",
      provenance: "malformed",
      sourceRefs: [{ path: publicPath }],
    });
    return;
  }
  state.fileCount += 1;

  if (stats.size > limits.maxFileBytes) {
    addRecord(state, limits, makeRecord({
      publicPath,
      format: formatForPath(publicPath),
      data: null,
      provenance: "malformed",
      sizeBytes: stats.size,
    }), diagnostics);
    diagnostics.add({
      code: "file_too_large",
      message: "A canonical evidence file was not parsed because it exceeds the configured size limit.",
      provenance: "malformed",
      sourceRefs: [{ path: publicPath }],
    });
    return;
  }
  if (state.totalBytes + stats.size > limits.maxTotalBytes) {
    state.stopped = true;
    diagnostics.add({
      code: "max_total_bytes_exceeded",
      message: "Additional evidence was skipped by the configured aggregate size limit.",
      sourceRefs: [{ path: publicPath }],
    });
    return;
  }

  let content;
  try {
    content = await fs.readFile(absolute, "utf8");
  } catch {
    diagnostics.add({
      code: "file_unreadable",
      severity: "error",
      message: "A canonical evidence file could not be read.",
      provenance: "malformed",
      sourceRefs: [{ path: publicPath }],
    });
    return;
  }
  state.totalBytes += Buffer.byteLength(content, "utf8");
  const format = formatForPath(publicPath);

  if (format === "json") {
    try {
      const data = JSON.parse(content);
      const validShape = isPlainObject(data);
      addRecord(state, limits, makeRecord({
        publicPath,
        format,
        data: validShape ? data : null,
        provenance: validShape ? "recorded" : "malformed",
        sizeBytes: stats.size,
      }), diagnostics);
      if (!validShape) {
        diagnostics.add({
          code: "invalid_record_shape",
          message: "A JSON evidence file does not contain an object record.",
          provenance: "malformed",
          sourceRefs: [{ path: publicPath }],
        });
      } else if (
        typeof data.schema_version !== "string"
        && !isIntentAbiCodexEnvelopeCandidate(data, publicPath)
      ) {
        diagnostics.add({
          code: "schema_version_missing",
          severity: "info",
          message: "A legacy JSON record has no schema_version and was read tolerantly.",
          provenance: "inferred",
          sourceRefs: [{ path: publicPath }],
        });
      }
    } catch {
      addRecord(state, limits, makeRecord({
        publicPath,
        format,
        data: null,
        provenance: "malformed",
        sizeBytes: stats.size,
      }), diagnostics);
      diagnostics.add({
        code: "invalid_json",
        severity: "error",
        message: "A JSON evidence file is malformed and was not normalized.",
        provenance: "malformed",
        sourceRefs: [{ path: publicPath }],
      });
    }
    return;
  }

  if (format === "jsonl") {
    parseJsonLines(content, publicPath, stats.size, state, limits, diagnostics);
    return;
  }

  addRecord(state, limits, makeRecord({
    publicPath,
    format,
    data: null,
    provenance: "recorded",
    sizeBytes: stats.size,
  }), diagnostics);
}

function parseJsonLines(content, publicPath, sizeBytes, state, limits, diagnostics) {
  const lines = content.split(/\r?\n/);
  if (lines.length > limits.maxJsonLines) {
    diagnostics.add({
      code: "max_json_lines_exceeded",
      message: "A JSONL evidence file was normalized only up to the configured line limit.",
      sourceRefs: [{ path: publicPath }],
    });
  }

  const lineLimit = Math.min(lines.length, limits.maxJsonLines);
  for (let index = 0; index < lineLimit; index += 1) {
    const raw = lines[index].trim();
    if (raw === "") {
      continue;
    }
    try {
      const data = JSON.parse(raw);
      const validShape = isPlainObject(data);
      addRecord(state, limits, makeRecord({
        publicPath,
        format: "jsonl",
        data: validShape ? data : null,
        provenance: validShape ? "recorded" : "malformed",
        sizeBytes,
        line: index + 1,
      }), diagnostics);
      if (!validShape) {
        diagnostics.add({
          code: "invalid_jsonl_record_shape",
          message: "A JSONL evidence line does not contain an object record.",
          provenance: "malformed",
          sourceRefs: [{ path: publicPath, line: index + 1 }],
        });
      }
    } catch {
      addRecord(state, limits, makeRecord({
        publicPath,
        format: "jsonl",
        data: null,
        provenance: "malformed",
        sizeBytes,
        line: index + 1,
      }), diagnostics);
      diagnostics.add({
        code: "invalid_jsonl",
        severity: "error",
        message: "A malformed JSONL evidence line was skipped.",
        provenance: "malformed",
        sourceRefs: [{ path: publicPath, line: index + 1 }],
      });
    }
  }
}

function makeRecord({ publicPath, format, data, provenance, sizeBytes, line = null }) {
  return {
    path: publicPath,
    format,
    kind: classifyRecord(publicPath, data),
    data,
    provenance,
    sizeBytes,
    line,
  };
}

function addRecord(state, limits, record, diagnostics) {
  if (state.records.length >= limits.maxRecords) {
    state.stopped = true;
    diagnostics.add({
      code: "max_records_exceeded",
      message: "Additional evidence records were skipped by the configured record limit.",
      sourceRefs: [{ path: record.path }],
    });
    return;
  }
  state.records.push(record);
}

function classifyRecord(publicPath, data) {
  if (isIntentAbiCodexEnvelopeCandidate(data, publicPath)) return "semantic-observation";
  if (publicPath === ".sdlc/project.json") return "project";
  if (publicPath.startsWith(".sdlc/baseline/")) return "baseline";
  if (publicPath.startsWith(".sdlc/requirements/")) return "requirement";
  if (publicPath.startsWith(".sdlc/contracts/")) return "contract";
  if (publicPath.startsWith(".sdlc/traces/")) return "trace";
  if (/^\.sdlc\/stories\/[^/]+\/story\.json$/.test(publicPath)) return "story";
  if (/^\.sdlc\/stories\/[^/]+\/claim\.json$/.test(publicPath)) return "claim";
  if (/^\.sdlc\/stories\/[^/]+\/task-start\.json$/.test(publicPath)) return "task-start";
  if (/^\.sdlc\/stories\/[^/]+\/steps\//.test(publicPath)) return "story-step";
  if (publicPath.startsWith(".sdlc/stories/")) return "story-artifact";
  if (publicPath.startsWith(".sdlc/decisions/")) return "decision";
  if (publicPath.startsWith(".sdlc/assumptions/")) return "assumption";
  if (publicPath.startsWith(".sdlc/risks/")) return "risk";
  if (publicPath.startsWith(".sdlc/tests/")) return "test";
  if (publicPath.startsWith(".sdlc/handoffs/")) return "handoff";
  if (publicPath.startsWith(".sdlc/releases/")) return "release";
  if (publicPath.startsWith(".sdlc/reports/")) return "report";
  if (publicPath.startsWith(".sdlc/authorizations/")) return "authorization";
  if (publicPath.startsWith(".sdlc/authorization-uses/")) return "authorization-use";
  if (publicPath.startsWith(".sdlc/output-contracts/")) return "output-contract";
  if (publicPath.startsWith(".sdlc/capability-discovery/")) return "capability";
  if (publicPath.startsWith(".sdlc/dependencies/")) return "dependency";
  if (publicPath.startsWith(".sdlc/work-breakdown/")) return "work-breakdown";
  return "record";
}

function normalizeProject(record, projectRoot, diagnostics, limits) {
  if (!record) {
    return {
      id: null,
      name: null,
      sdlcVersion: null,
      provenance: "missing",
      sourceRefs: [{ path: ".sdlc/project.json" }],
    };
  }
  if (!isRecordObject(record)) {
    return {
      id: null,
      name: null,
      sdlcVersion: null,
      provenance: "malformed",
      sourceRefs: [sourceRef(record)],
    };
  }

  const id = boundedText(record.data.project_id ?? record.data.id, limits.maxTextChars);
  const name = boundedText(record.data.project_name ?? record.data.name, limits.maxTextChars);
  const sdlcVersion = boundedText(record.data.sdlc_version, limits.maxTextChars);
  let provenance = "recorded";
  let normalizedName = name.value;
  if (!normalizedName) {
    normalizedName = path.basename(projectRoot);
    provenance = "inferred";
    diagnostics.add({
      code: "project_name_inferred",
      severity: "info",
      message: "The project display name was inferred from the selected directory because no name is recorded.",
      provenance: "inferred",
      sourceRefs: [sourceRef(record)],
    });
  }
  return {
    id: id.value,
    name: normalizedName,
    sdlcVersion: sdlcVersion.value,
    provenance,
    sourceRefs: [sourceRef(record)],
    textTruncated: id.truncated || name.truncated || sdlcVersion.truncated,
  };
}

function itemFromRecord(record, { limits, diagnostics, dataOverride = undefined, sourceRefs = undefined, overrides = {} }) {
  const data = dataOverride === undefined ? record.data : dataOverride;
  const refs = (sourceRefs ?? [sourceRef(record)]).map(normalizeSourceRef);
  if (!isPlainObject(data)) {
    return {
      id: fallbackRecordId(record),
      type: overrides.type ?? record.kind,
      title: null,
      summary: null,
      status: null,
      phase: null,
      action: null,
      intent: null,
      timestamp: null,
      provenance: "malformed",
      sourceRefs: refs,
      rawHref: rawHref(record.path),
      explanation: null,
      rationale: null,
      narrative: null,
      inputs: [],
      outputs: [],
      alternatives: [],
      evidence: [],
      storyId: null,
      requirementId: null,
      requirementIds: [],
      contractId: null,
      related: [],
      linkage: overrides.linkage ?? null,
    };
  }

  const recordedId = boundedText(overrides.id ?? data.id ?? data.story_id ?? data.contract_id, limits.maxTextChars);
  const title = boundedText(overrides.title ?? data.title ?? data.name, limits.maxTextChars);
  const summary = boundedText(
    overrides.summary ?? data.summary ?? data.purpose ?? data.description,
    limits.maxTextChars,
  );
  const status = boundedText(overrides.status ?? data.status ?? data.outcome, limits.maxTextChars);
  const phase = boundedText(overrides.phase ?? data.phase, limits.maxTextChars);
  const action = boundedText(data.action, limits.maxTextChars);
  const intent = boundedText(data.intent ?? data.change_intent, limits.maxTextChars);
  const timestamp = normalizeOptionalTimestamp(
    overrides.timestamp ?? data.created_at ?? data.updated_at ?? data.confirmed_at ?? data.timestamp,
  );
  const id = recordedId.value ?? fallbackRecordId(record);
  const displayTitle = title.value ?? recordedId.value;
  const inferredLabel = !title.value && !recordedId.value;
  const provenance = overrides.provenance
    ?? (record.provenance === "recorded" && inferredLabel ? "inferred" : record.provenance);
  const privateReasoningPresent = containsPrivateReasoningSignal(data);
  const narrative = !privateReasoningPresent && isPlainObject(data.narrative) ? data.narrative : null;
  const explanation = buildExplanation(
    data,
    narrative,
    privateReasoningPresent,
    summary.value,
    refs,
    limits,
  );
  const rationale = buildRationale(narrative, privateReasoningPresent, refs, limits);
  const normalizedNarrative = buildNarrative(narrative, privateReasoningPresent, refs, limits);
  const storyId = boundedText(data.story_id, limits.maxTextChars);
  const contractId = boundedText(
    data.contract_id ?? (record.kind === "contract" ? data.id : null),
    limits.maxTextChars,
  );
  const requirementIds = normalizedStringList([
    ...(record.kind === "requirement" ? [data.id] : []),
    data.requirement_id,
    ...asArray(data.requirement_ids),
    ...asArray(data.requirements),
  ], limits);
  const related = normalizedStringList(data.related, limits);

  return {
    id,
    type: overrides.type ?? data.type ?? record.kind,
    title: displayTitle,
    summary: summary.value,
    status: status.value,
    phase: phase.value,
    action: action.value,
    intent: intent.value,
    timestamp,
    provenance,
    sourceRefs: refs,
    rawHref: rawHref(record.path),
    explanation,
    rationale,
    narrative: normalizedNarrative,
    inputs: buildTextRefs(
      privateReasoningPresent
        ? []
        : narrative?.input_summaries ?? narrative?.input_summary ?? data.inputs,
      `${id}:input`,
      refs,
      limits,
    ),
    outputs: buildTextRefs(
      privateReasoningPresent
        ? []
        : narrative?.output_summaries ?? narrative?.output_summary ?? data.outputs,
      `${id}:output`,
      refs,
      limits,
    ),
    alternatives: buildTextRefs(
      privateReasoningPresent ? [] : narrative?.alternatives,
      `${id}:alternative`,
      refs,
      limits,
    ),
    evidence: buildTextRefs(
      privateReasoningPresent
        ? []
        : [...asArray(data.evidence), ...asArray(narrative?.evidence)],
      `${id}:evidence`,
      refs,
      limits,
    ),
    storyId: storyId.value,
    requirementId: requirementIds[0] ?? null,
    requirementIds,
    contractId: contractId.value,
    related,
    linkage: overrides.linkage ?? null,
    textTruncated: [recordedId, title, summary, status, phase, action, intent]
      .some((field) => field.truncated) || storyId.truncated || contractId.truncated,
  };
}

function buildExplanation(data, narrative, privateReasoningPresent, fallbackSummary, refs, limits) {
  if (narrative) {
    const generated = boundedText(
      narrative.explanation?.text ?? narrative.generated_explanation,
      limits.maxTextChars,
    );
    if (generated.value) {
      return {
        text: generated.value,
        authoring: normalizeExplanationAuthoring(
          narrative.explanation?.kind ?? narrative.explanation_source,
          Boolean(generated.value),
        ),
        provenance: "recorded",
        sourceRefs: refs.map((ref) => ({ ...ref, pointer: "/narrative" })),
        truncated: generated.truncated,
      };
    }
  }

  const legacyExplanation = privateReasoningPresent
    ? { value: null, truncated: false }
    : boundedText(data.generated_explanation ?? data.explanation, limits.maxTextChars);
  if (legacyExplanation.value) {
    return {
      text: legacyExplanation.value,
      authoring: "deterministic",
      provenance: "recorded",
      sourceRefs: refs,
      truncated: legacyExplanation.truncated,
    };
  }
  if (!fallbackSummary) {
    return null;
  }
  return {
    text: fallbackSummary,
    authoring: "deterministic",
    provenance: "recorded",
    sourceRefs: refs,
    truncated: false,
  };
}

function buildRationale(narrative, privateReasoningPresent, refs, limits) {
  if (!narrative || privateReasoningPresent) return null;
  const hasSummary = Object.hasOwn(narrative, "rationale_summary");
  const hasCamelSummary = Object.hasOwn(narrative, "rationaleSummary");
  const field = hasSummary ? "rationale_summary" : hasCamelSummary ? "rationaleSummary" : "rationale";
  const rationale = boundedText(narrative[field], limits.maxTextChars);
  if (!rationale.value) return null;
  return {
    text: rationale.value,
    provenance: "recorded",
    sourceRefs: refs.map((ref) => ({ ...ref, pointer: `/narrative/${field}` })),
    truncated: rationale.truncated,
  };
}

function buildNarrative(narrative, privateReasoningPresent, refs, limits) {
  if (!narrative || privateReasoningPresent) return null;
  const rationale = buildRationale(narrative, false, refs, limits);
  const generated = boundedText(
    narrative.explanation?.text ?? narrative.generated_explanation,
    limits.maxTextChars,
  );
  const inputSummaries = normalizedStringList(
    narrative.input_summaries ?? narrative.input_summary,
    limits,
  );
  const outputSummaries = normalizedStringList(
    narrative.output_summaries ?? narrative.output_summary,
    limits,
  );
  const alternatives = normalizedStringList(narrative.alternatives, limits);
  const evidence = normalizedStringList(narrative.evidence, limits);
  if (
    !rationale
    && !generated.value
    && inputSummaries.length === 0
    && outputSummaries.length === 0
    && alternatives.length === 0
    && evidence.length === 0
  ) {
    return null;
  }
  return {
    rationaleSummary: rationale?.text ?? null,
    generatedExplanation: generated.value,
    explanationSource: generated.value
      ? normalizeExplanationAuthoring(
        narrative.explanation?.kind ?? narrative.explanation_source,
        true,
      )
      : null,
    inputSummaries,
    outputSummaries,
    alternatives,
    evidence,
    provenance: "recorded",
    sourceRefs: refs.map((ref) => ({ ...ref, pointer: "/narrative" })),
    truncated: Boolean(rationale?.truncated || generated.truncated),
  };
}

function normalizeExplanationAuthoring(value, generated) {
  if (["human", "human-authored"].includes(value)) return "human";
  if (["codex", "codex-generated", "agent"].includes(value)) return "codex-generated";
  return generated ? "codex-generated" : "deterministic";
}

function containsPrivateReasoningSignal(value) {
  return inspectPrivateReasoningSignal(value).present;
}

function inspectPrivateReasoningSignal(value) {
  const stack = [{ value, depth: 0 }];
  const seen = new WeakSet();
  let inspectedNodes = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    const candidate = current.value;
    if (!Array.isArray(candidate) && !isPlainObject(candidate)) continue;
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    inspectedNodes += 1;
    if (
      inspectedNodes > PRIVATE_REASONING_SCAN_MAX_NODES
      || current.depth > PRIVATE_REASONING_SCAN_MAX_DEPTH
    ) {
      return { present: true, traversalLimited: true };
    }
    if (Array.isArray(candidate)) {
      for (let index = candidate.length - 1; index >= 0; index -= 1) {
        stack.push({ value: candidate[index], depth: current.depth + 1 });
      }
      continue;
    }
    const entries = Object.entries(candidate);
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [key, item] = entries[index];
      const normalized = normalizeSensitiveKey(key);
      if (PRIVATE_REASONING_KEYS.has(normalized)) {
        return { present: true, traversalLimited: false };
      }
      if (PRIVATE_REASONING_FLAG_KEYS.has(normalized) && item === true) {
        return { present: true, traversalLimited: false };
      }
      stack.push({ value: item, depth: current.depth + 1 });
    }
  }
  return { present: false, traversalLimited: false };
}

function reportPrivateReasoningDiagnostics(records, diagnostics) {
  for (const record of records) {
    if (!isRecordObject(record)) continue;
    const inspection = inspectPrivateReasoningSignal(record.data);
    if (!inspection.present) continue;
    if (inspection.traversalLimited) {
      diagnostics.add({
        code: "private_reasoning_scan_limited",
        severity: "error",
        message: "A record exceeded the bounded private-reasoning scan and was excluded from normalized narrative surfaces.",
        provenance: "malformed",
        sourceRefs: [sourceRef(record)],
      });
    }
    diagnostics.add({
      code: "private_reasoning_redacted",
      severity: "error",
      message: "A record marked as containing private reasoning was excluded from the normalized explanation view.",
      provenance: "malformed",
      sourceRefs: [sourceRef(record)],
    });
  }
}

function normalizeSensitiveKey(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function buildTextRefs(value, idPrefix, sourceRefs, limits) {
  return asArray(value)
    .slice(0, limits.maxCollectionItems)
    .map((item, index) => {
      const raw = typeof item === "string"
        ? item
        : isPlainObject(item)
          ? item.title ?? item.summary ?? item.id ?? item.path
          : null;
      const text = boundedText(raw, limits.maxTextChars);
      if (!text.value) {
        return null;
      }
      return {
        id: `${idPrefix}:${index + 1}`,
        title: text.value,
        label: text.value,
        provenance: "recorded",
        sourceRefs,
        truncated: text.truncated,
      };
    })
    .filter(Boolean);
}

function requestItemsFromTrace(record, limits) {
  const request = record.data?.request;
  if (!isPlainObject(request) || typeof request.summary !== "string" || request.summary.trim() === "") {
    return [];
  }
  const summary = boundedText(request.summary, limits.maxTextChars);
  const ref = { ...sourceRef(record), pointer: "/request/summary" };
  return [{
    id: `${record.data.id ?? fallbackRecordId(record)}:request`,
    type: "request",
    title: summary.value,
    summary: summary.value,
    status: null,
    phase: record.data.phase ?? null,
    timestamp: normalizeOptionalTimestamp(record.data.created_at),
    provenance: "recorded",
    sourceRefs: [ref],
    rawHref: rawHref(record.path),
    explanation: {
      text: summary.value,
      authoring: "human",
      provenance: "recorded",
      sourceRefs: [ref],
      truncated: summary.truncated,
    },
    inputs: [],
    outputs: [],
    alternatives: [],
    evidence: [],
    textTruncated: summary.truncated,
  }];
}

function approvalItemsFromRecord(record, limits, diagnostics) {
  if (!isRecordObject(record) || !Array.isArray(record.data.approvals)) {
    return [];
  }
  return record.data.approvals
    .filter(isPlainObject)
    .map((approval, index) => itemFromRecord(record, {
      limits,
      diagnostics,
      dataOverride: approval,
      sourceRefs: [{ ...sourceRef(record), pointer: `/approvals/${index}` }],
      overrides: {
        id: approval.id ?? `${fallbackRecordId(record)}:approval:${index + 1}`,
        type: "approval",
        phase: record.data.phase ?? null,
      },
    }));
}

function normalizeIterations(records, limits, diagnostics) {
  const stories = records.filter((record) => record.kind === "story" && isRecordObject(record));
  const taskStarts = records.filter((record) => record.kind === "task-start" && isRecordObject(record));
  const claims = records.filter((record) => record.kind === "claim" && isRecordObject(record));
  const steps = records.filter((record) => record.kind === "story-step" && isRecordObject(record));
  const traces = records.filter((record) => record.kind === "trace" && isRecordObject(record));

  return stories
    .map((storyRecord) => {
      const story = storyRecord.data;
      const storyId = story.id ?? fallbackRecordId(storyRecord);
      const currentPhase = SDLC_PHASES.includes(story.phase) ? story.phase : null;
      const storyTaskStarts = taskStarts.filter((record) => record.data.story_id === storyId);
      const storyClaims = claims.filter((record) => record.data.story_id === storyId);
      const storySteps = steps.filter((record) => record.data.story_id === storyId || storyIdFromPath(record.path) === storyId);
      const storyTraces = traces.filter((record) => record.data.story_id === storyId);
      const base = itemFromRecord(storyRecord, { limits, diagnostics });

      return {
        ...base,
        currentPhase,
        phases: SDLC_PHASES.map((phase) => normalizePhaseState({
          phase,
          currentPhase,
          story,
          storyRecord,
          taskStarts: storyTaskStarts,
          claims: storyClaims,
          steps: storySteps,
          traces: storyTraces,
        })),
      };
    })
    .sort((left, right) => compareStrings(String(left.id), String(right.id)));
}

function normalizeIterationDossiers(records, iterations, limits, diagnostics) {
  const storyRecordIndex = indexRecords(
    records.filter((record) => record.kind === "story" && isRecordObject(record)),
    (record) => boundedText(record.data.id, limits.maxTextChars).value,
  );
  const storyRecords = new Map();
  for (const [storyId, matches] of storyRecordIndex) {
    if (matches.length === 1) {
      storyRecords.set(storyId, matches[0]);
      continue;
    }
    diagnostics.add({
      code: "dossier_story_id_ambiguous",
      severity: "error",
      message: "Multiple canonical story records use the same ID; no dossier was built or attached for that ID.",
      provenance: "malformed",
      sourceRefs: matches.map(sourceRef),
    });
  }
  const idIndex = indexRecords(records, (record) => {
    if (!isRecordObject(record)) return null;
    return boundedText(record.data.id, limits.maxTextChars).value;
  });
  const pathIndex = indexRecords(records, (record) => record.path);
  const workBreakdowns = records.filter(
    (record) => record.kind === "work-breakdown" && isRecordObject(record),
  );
  const contexts = iterations
    .map((iteration) => {
      const storyRecord = storyRecords.get(iteration.id);
      if (!storyRecord) return null;
      const story = storyRecord.data;
      const requirementLinks = asArray(story.links?.requirements);
      const requirementIds = new Set(normalizedStringList([
        story.requirement_id,
        ...asArray(story.requirement_ids),
        ...requirementLinks,
      ], limits));
      const requirementRefs = new Map();
      for (let index = 0; index < requirementLinks.length; index += 1) {
        const requirementId = boundedText(requirementLinks[index], limits.maxTextChars).value;
        if (requirementId) {
          requirementRefs.set(requirementId, {
            ...sourceRef(storyRecord),
            pointer: `/links/requirements/${index}`,
          });
        }
      }
      for (const breakdown of workBreakdowns) {
        const itemIndex = asArray(breakdown.data.items).findIndex(
          (item) => isPlainObject(item) && item.type === "story" && item.id === iteration.id,
        );
        if (itemIndex < 0) continue;
        const requirementId = boundedText(breakdown.data.requirement_id, limits.maxTextChars).value;
        if (!requirementId) continue;
        requirementIds.add(requirementId);
        if (!requirementRefs.has(requirementId)) {
          requirementRefs.set(requirementId, {
            ...sourceRef(breakdown),
            pointer: "/requirement_id",
          });
        }
      }
      const contractIds = new Set(normalizedStringList(story.contract_id, limits));
      for (const record of records) {
        if (
          record.kind === "contract"
          && isRecordObject(record)
          && record.data.story_id === iteration.id
        ) {
          const contractId = boundedText(record.data.id, limits.maxTextChars).value;
          if (contractId) contractIds.add(contractId);
        }
      }
      return {
        iteration,
        storyRecord,
        requirementIds,
        requirementRefs,
        contractIds,
        placements: new Map(),
        anchors: new Map(),
        diagnostics: [],
      };
    })
    .filter(Boolean)
    .sort((left, right) => compareStrings(String(left.iteration.id), String(right.iteration.id)));

  const contractOwners = new Map();
  for (const context of contexts) {
    for (const contractId of context.contractIds) {
      const owners = contractOwners.get(contractId) ?? new Set();
      owners.add(context.iteration.id);
      contractOwners.set(contractId, owners);
    }
  }

  const addDiagnostic = (context, payload) => {
    const normalized = {
      severity: "warning",
      provenance: "malformed",
      sourceRefs: [],
      ...payload,
    };
    diagnostics.add(normalized);
    if (context.diagnostics.length < limits.maxDiagnostics) {
      context.diagnostics.push({
        ...normalized,
        occurrences: 1,
        sourceRefs: normalized.sourceRefs.map(normalizeSourceRef).slice(0, 12),
      });
    }
  };

  const place = (context, record, via, refs, { anchor = false } = {}) => {
    const storyId = context.iteration.id;
    const recordedStoryId = isRecordObject(record)
      ? boundedText(record.data.story_id, limits.maxTextChars).value
      : null;
    const conflictingStory = recordedStoryId && recordedStoryId !== storyId;
    const conflictingStoryRecord = record.kind === "story"
      && isRecordObject(record)
      && record.data.id !== storyId;
    if (conflictingStory || conflictingStoryRecord) {
      addDiagnostic(context, {
        code: "dossier_cross_story_link_blocked",
        message: "An explicit link targeted evidence owned by another story and was excluded.",
        sourceRefs: [...refs, sourceRef(record)],
      });
      return false;
    }
    const key = dossierRecordKey(record);
    const existing = context.placements.get(key) ?? {
      record,
      via: new Set(),
      sourceRefs: [],
    };
    existing.via.add(via);
    existing.sourceRefs = uniqueSourceRefs([
      ...existing.sourceRefs,
      ...refs,
      sourceRef(record),
    ], 12);
    context.placements.set(key, existing);
    if (anchor) context.anchors.set(key, existing);
    return true;
  };

  const resolveUniqueId = (context, id, ref, via) => {
    const matches = idIndex.get(id) ?? [];
    if (matches.length !== 1) {
      addDiagnostic(context, {
        code: matches.length === 0 ? "dossier_link_target_missing" : "dossier_link_target_ambiguous",
        message: matches.length === 0
          ? "An explicit dossier ID has no canonical target and remains unlinked."
          : "An explicit dossier ID resolves to multiple canonical records and remains unlinked.",
        sourceRefs: [ref, ...matches.map(sourceRef)],
      });
      return null;
    }
    return { record: matches[0], via };
  };

  for (const context of contexts) {
    const storyId = context.iteration.id;
    place(
      context,
      context.storyRecord,
      "story_link",
      [{ ...sourceRef(context.storyRecord), pointer: "/id" }],
      { anchor: true },
    );

    for (const record of records) {
      if (!isRecordObject(record) || record === context.storyRecord) continue;
      if (record.data.story_id === storyId) {
        place(
          context,
          record,
          "story_id",
          [{ ...sourceRef(record), pointer: "/story_id" }],
          { anchor: true },
        );
      }
      const related = asArray(record.data.related);
      for (let relatedIndex = 0; relatedIndex < related.length; relatedIndex += 1) {
        if (related[relatedIndex] !== storyId) continue;
        place(
          context,
          record,
          "related",
          [{ ...sourceRef(record), pointer: `/related/${relatedIndex}` }],
          { anchor: true },
        );
      }
    }

    for (const contractId of [...context.contractIds].sort(compareStrings)) {
      const owners = contractOwners.get(contractId) ?? new Set();
      const contractRef = { ...sourceRef(context.storyRecord), pointer: "/contract_id" };
      if (owners.size !== 1 || !owners.has(storyId)) {
        addDiagnostic(context, {
          code: "dossier_contract_link_ambiguous",
          message: "A contract ID is owned by multiple stories and remains outside this dossier.",
          sourceRefs: [contractRef],
        });
        continue;
      }
      const resolved = resolveUniqueId(context, contractId, contractRef, "contract_id");
      if (resolved && resolved.record.kind === "contract") {
        place(context, resolved.record, resolved.via, [contractRef], { anchor: true });
      } else if (resolved) {
        addDiagnostic(context, {
          code: "dossier_contract_target_malformed",
          message: "A contract ID resolved to a non-contract record and was excluded.",
          sourceRefs: [contractRef, sourceRef(resolved.record)],
        });
      }
      for (const record of records) {
        if (!isRecordObject(record) || record.data.contract_id !== contractId) continue;
        place(
          context,
          record,
          "contract_id",
          [{ ...sourceRef(record), pointer: "/contract_id" }],
          { anchor: true },
        );
      }
    }

    for (const requirementId of [...context.requirementIds].sort(compareStrings)) {
      const ref = context.requirementRefs.get(requirementId)
        ?? { ...sourceRef(context.storyRecord), pointer: "/requirement_id" };
      const resolved = resolveUniqueId(context, requirementId, ref, "requirement_id");
      if (resolved && resolved.record.kind === "requirement") {
        place(context, resolved.record, resolved.via, [ref]);
      } else if (resolved) {
        addDiagnostic(context, {
          code: "dossier_requirement_target_malformed",
          message: "A requirement ID resolved to a non-requirement record and was excluded.",
          sourceRefs: [ref, sourceRef(resolved.record)],
        });
      }
    }

    for (const [linkName, linkValues] of Object.entries({
      decisions: asArray(context.storyRecord.data.links?.decisions),
      tests: asArray(context.storyRecord.data.links?.tests),
    })) {
      for (let linkIndex = 0; linkIndex < linkValues.length; linkIndex += 1) {
        const id = boundedText(linkValues[linkIndex], limits.maxTextChars).value;
        if (!id) continue;
        const ref = {
          ...sourceRef(context.storyRecord),
          pointer: `/links/${linkName}/${linkIndex}`,
        };
        const resolved = resolveUniqueId(context, id, ref, "story_link");
        if (resolved) place(context, resolved.record, resolved.via, [ref]);
      }
    }
  }

  // Resolve exact related IDs from directly linked anchors only. Newly placed
  // related records are deliberately not traversed again.
  for (const context of contexts) {
    const anchorSnapshot = [...context.anchors.values()];
    for (const placement of anchorSnapshot) {
      if (!isRecordObject(placement.record)) continue;
      const related = asArray(placement.record.data.related);
      for (let relatedIndex = 0; relatedIndex < related.length; relatedIndex += 1) {
        const id = boundedText(related[relatedIndex], limits.maxTextChars).value;
        if (!id || id === context.iteration.id) continue;
        const ref = {
          ...sourceRef(placement.record),
          pointer: `/related/${relatedIndex}`,
        };
        const resolved = resolveUniqueId(context, id, ref, "related");
        if (resolved) place(context, resolved.record, resolved.via, [ref]);
      }
    }
  }

  // Evidence-path joins are one hop from the direct anchor set. Shared,
  // multi-record, non-canonical, or cross-story targets remain unlinked.
  const evidenceCitations = new Map();
  for (const context of contexts) {
    for (const placement of context.anchors.values()) {
      for (const citation of dossierEvidenceCitations(placement.record, limits)) {
        if (!citation.valid) {
          addDiagnostic(context, {
            code: "dossier_evidence_path_noncanonical",
            message: "A non-canonical .sdlc evidence path was rejected and remains unlinked.",
            sourceRefs: [citation.sourceRef],
          });
          continue;
        }
        const citations = evidenceCitations.get(citation.path) ?? [];
        citations.push({ context, sourceRef: citation.sourceRef });
        evidenceCitations.set(citation.path, citations);
      }
    }
  }
  for (const [evidencePath, citations] of [...evidenceCitations.entries()].sort(([left], [right]) =>
    compareStrings(left, right))) {
    const citedStoryIds = new Set(citations.map((citation) => citation.context.iteration.id));
    if (citedStoryIds.size !== 1) {
      for (const context of new Set(citations.map((citation) => citation.context))) {
        addDiagnostic(context, {
          code: "dossier_evidence_link_shared",
          message: "An evidence path is cited by multiple stories and remains outside every dossier.",
          sourceRefs: citations.map((citation) => citation.sourceRef),
        });
      }
      continue;
    }
    const context = citations[0].context;
    const targets = pathIndex.get(evidencePath) ?? [];
    if (targets.some((target) => target.format === "jsonl")) {
      addDiagnostic(context, {
        code: "dossier_evidence_target_jsonl_unsupported",
        message: "A JSONL evidence path is record-ambiguous by format and remains outside the dossier.",
        sourceRefs: [
          ...citations.map((citation) => citation.sourceRef),
          ...targets.map(sourceRef),
        ],
      });
      continue;
    }
    if (targets.length !== 1) {
      addDiagnostic(context, {
        code: targets.length === 0
          ? "dossier_evidence_target_missing"
          : "dossier_evidence_target_ambiguous",
        message: targets.length === 0
          ? "A canonical evidence path has no readable target and remains unlinked."
          : "A canonical evidence path resolves to multiple records and remains unlinked.",
        sourceRefs: [
          ...citations.map((citation) => citation.sourceRef),
          ...targets.map(sourceRef),
        ],
      });
      continue;
    }
    if (!isRecordObject(targets[0])) {
      addDiagnostic(context, {
        code: "dossier_evidence_target_malformed",
        message: "An evidence path target is not a well-formed canonical object record and remains unlinked.",
        sourceRefs: [
          ...citations.map((citation) => citation.sourceRef),
          sourceRef(targets[0]),
        ],
      });
      continue;
    }
    place(
      context,
      targets[0],
      "evidence_path",
      citations.map((citation) => citation.sourceRef),
    );
  }

  const placedRecordKeys = new Set();
  for (const context of contexts) {
    for (const key of context.placements.keys()) placedRecordKeys.add(key);
  }

  let nestedItemCount = 0;
  let nestedTruncated = false;
  const dossiers = [];
  const byStoryId = new Map();
  for (const context of contexts) {
    const candidates = Object.fromEntries(DOSSIER_LANES.map((lane) => [lane, []]));
    const placements = [...context.placements.values()].sort((left, right) =>
      compareRecords(left.record, right.record));
    for (const placement of placements) {
      const item = decorateDossierItem(
        itemFromRecord(placement.record, { limits, diagnostics }),
        context.iteration.id,
        placement,
      );
      for (const lane of dossierLanesForRecord(placement.record)) candidates[lane].push(item);
      if (placement.record.kind === "trace") {
        for (const requestItem of requestItemsFromTrace(placement.record, limits)) {
          candidates.asked.push(decorateDossierItem(requestItem, context.iteration.id, placement));
        }
      }
      for (const approval of approvalItemsFromRecord(placement.record, limits, diagnostics)) {
        candidates.decided.push(decorateDossierItem(approval, context.iteration.id, placement));
      }
    }

    const lanes = {};
    for (const lane of DOSSIER_LANES) {
      const sorted = dedupeDossierItems(candidates[lane].sort(compareDossierItems));
      const remaining = Math.max(0, limits.maxCollectionItems - nestedItemCount);
      const items = sorted.slice(0, remaining);
      nestedItemCount += items.length;
      if (items.length < sorted.length) {
        nestedTruncated = true;
        addDiagnostic(context, {
          code: "dossier_nested_items_truncated",
          message: "Dossier items were omitted by the global nested-item limit.",
          provenance: "inferred",
          sourceRefs: [sourceRef(context.storyRecord)],
        });
      }
      const status = items.length > 0 ? "recorded" : sorted.length > 0 ? "malformed" : "missing";
      if (status === "missing") {
        addDiagnostic(context, {
          code: "dossier_lane_missing",
          severity: "info",
          provenance: "missing",
          message: `No explicitly linked ${lane} evidence is recorded for this dossier.`,
          sourceRefs: [sourceRef(context.storyRecord)],
        });
      }
      lanes[lane] = {
        status,
        provenance: status,
        sourceRefs: items.length > 0
          ? uniqueSourceRefs(items.flatMap((item) => item.sourceRefs), 12)
          : [sourceRef(context.storyRecord)],
        items,
      };
    }
    const dossier = {
      schemaVersion: DOSSIER_SCHEMA_VERSION,
      iterationId: context.iteration.id,
      storyId: context.iteration.id,
      title: context.iteration.title,
      summary: context.iteration.summary,
      status: DOSSIER_LANES.every((lane) => lanes[lane].status === "recorded")
        ? "complete"
        : "partial",
      provenance: "recorded",
      sourceRefs: [sourceRef(context.storyRecord)],
      links: {
        requirementIds: [...context.requirementIds].sort(compareStrings)
          .slice(0, limits.maxCollectionItems),
        contractIds: [...context.contractIds].sort(compareStrings)
          .slice(0, limits.maxCollectionItems),
      },
      lanes,
      diagnostics: context.diagnostics.slice(0, limits.maxDiagnostics),
    };
    dossiers.push(dossier);
    byStoryId.set(dossier.storyId, dossier);
  }

  if (nestedTruncated) {
    diagnostics.add({
      code: "dossier_nested_items_truncated",
      message: "The global dossier nested-item limit was reached.",
      provenance: "inferred",
      sourceRefs: [],
    });
  }

  const unlinked = records
    .filter((record) => hasDossierSurface(record)
      && !placedRecordKeys.has(dossierRecordKey(record)))
    .map((record) => {
      diagnostics.add({
        code: "dossier_record_unlinked",
        severity: "info",
        message: "A dossier-relevant canonical record has no explicit story linkage and remains project-level.",
        provenance: "missing",
        sourceRefs: [sourceRef(record)],
      });
      return {
        ...itemFromRecord(record, { limits, diagnostics }),
        linkage: {
          status: "unlinked",
          storyId: null,
          via: [],
          sourceRefs: [],
        },
      };
    })
    .sort(compareDossierItems);

  return { dossiers, byStoryId, unlinked };
}

function indexRecords(records, selector) {
  const index = new Map();
  for (const record of records) {
    const key = selector(record);
    if (!key) continue;
    const matches = index.get(key) ?? [];
    matches.push(record);
    index.set(key, matches);
  }
  return index;
}

function dossierRecordKey(record) {
  return `${record.path}\u0000${record.line ?? 0}\u0000${record.kind}`;
}

function dossierEvidenceCitations(record, limits) {
  if (!isRecordObject(record)) return [];
  const citations = [];
  const append = (values, pointerPrefix) => {
    const bounded = asArray(values).slice(0, limits.maxCollectionItems);
    for (let index = 0; index < bounded.length; index += 1) {
      const value = bounded[index];
      const candidate = typeof value === "string"
        ? value
        : isPlainObject(value) ? value.path : null;
      if (typeof candidate !== "string" || !candidate.startsWith(".sdlc")) continue;
      citations.push({
        path: candidate,
        sourceRef: { ...sourceRef(record), pointer: `${pointerPrefix}/${index}` },
        valid: isCanonicalDossierEvidencePath(candidate),
      });
    }
  };
  append(record.data.evidence, "/evidence");
  if (isPlainObject(record.data.narrative)) append(record.data.narrative.evidence, "/narrative/evidence");
  return citations;
}

function isCanonicalDossierEvidencePath(value) {
  if (typeof value !== "string" || !value.startsWith(".sdlc/") || value.includes("\\")) {
    return false;
  }
  const segments = value.split("/");
  return segments.length > 2 && segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function dossierLanesForRecord(record) {
  if (!record) return [];
  const lanes = [];
  if (["story", "requirement"].includes(record.kind)) lanes.push("asked");
  if (
    ["decision", "assumption", "risk"].includes(record.kind)
    || (record.kind === "trace" && isDecisionTrace(record.data))
  ) {
    lanes.push("decided");
  }
  if (record.kind === "contract") lanes.push("contract");
  if (
    ["story-step", "story-artifact", "handoff", "output-contract"].includes(record.kind)
    || (record.kind === "trace" && ["implementation", "handoff", "sync"].includes(record.data?.type))
  ) {
    lanes.push("done");
  }
  if (isVerificationRecord(record)) lanes.push("verified");
  if (
    record.kind === "story-step"
    && ["completed", "complete", "done", "passed"].includes(record.data?.status)
  ) {
    lanes.push("verified");
  }
  return [...new Set(lanes)];
}

function hasDossierSurface(record) {
  return dossierLanesForRecord(record).length > 0
    || (record.kind === "trace"
      && isPlainObject(record.data?.request)
      && typeof record.data.request.summary === "string"
      && record.data.request.summary.trim() !== "");
}

function decorateDossierItem(item, storyId, placement) {
  return {
    ...item,
    storyId,
    requirementId: item.requirementId ?? null,
    requirementIds: item.requirementIds ?? [],
    contractId: item.contractId ?? null,
    related: item.related ?? [],
    linkage: {
      status: "linked",
      storyId,
      via: [...placement.via].sort(compareStrings),
      sourceRefs: uniqueSourceRefs(placement.sourceRefs, 12),
    },
  };
}

function compareDossierItems(left, right) {
  const fields = [
    [String(left.timestamp ?? ""), String(right.timestamp ?? ""), true],
    [String(left.id ?? ""), String(right.id ?? "")],
    [String(left.type ?? ""), String(right.type ?? "")],
    [String(left.sourceRefs?.[0]?.path ?? ""), String(right.sourceRefs?.[0]?.path ?? "")],
    [String(left.sourceRefs?.[0]?.line ?? ""), String(right.sourceRefs?.[0]?.line ?? "")],
    [String(left.sourceRefs?.[0]?.pointer ?? ""), String(right.sourceRefs?.[0]?.pointer ?? "")],
  ];
  for (const [leftValue, rightValue, descending = false] of fields) {
    const compared = compareStrings(leftValue, rightValue);
    if (compared !== 0) return descending ? -compared : compared;
  }
  return 0;
}

function dedupeDossierItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    const ref = item.sourceRefs?.[0] ?? {};
    const key = JSON.stringify([
      item.type,
      item.id,
      ref.path ?? null,
      ref.line ?? null,
      ref.pointer ?? null,
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueSourceRefs(refs, limit) {
  const seen = new Set();
  const unique = [];
  for (const raw of refs) {
    if (!raw?.path) continue;
    const ref = normalizeSourceRef(raw);
    const fingerprint = sourceRefFingerprint(ref);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    unique.push(ref);
    if (unique.length >= limit) break;
  }
  return unique;
}

function normalizePhaseState({ phase, currentPhase, story, storyRecord, taskStarts, claims, steps, traces }) {
  const step = steps.find((record) => phaseFromStep(record) === phase);
  const blockedTrace = traces.find((record) => record.data.outcome === "blocked" && (!record.data.phase || record.data.phase === phase));
  if (blockedTrace || (currentPhase === phase && story.status === "blocked")) {
    return {
      phase,
      status: "blocked",
      provenance: "recorded",
      sourceRefs: [sourceRef(blockedTrace ?? storyRecord)],
    };
  }
  if (step && !["blocked", "failed"].includes(step.data.status)) {
    return {
      phase,
      status: "complete",
      provenance: "recorded",
      sourceRefs: [sourceRef(step)],
    };
  }
  if (currentPhase === phase && ["completed", "complete", "done"].includes(story.status)) {
    return {
      phase,
      status: "complete",
      provenance: "inferred",
      sourceRefs: [sourceRef(storyRecord)],
    };
  }

  const confirmedStart = taskStarts.find((record) => record.data.phase === phase && record.data.status === "confirmed");
  const activeClaim = claims.find((record) => record.data.status === "active");
  const explicitActive = currentPhase === phase && ["active", "in_progress", "in-progress"].includes(story.status);
  if (currentPhase === phase && (confirmedStart || activeClaim || explicitActive)) {
    return {
      phase,
      status: "inProgress",
      provenance: explicitActive ? "recorded" : "inferred",
      sourceRefs: [sourceRef(confirmedStart ?? activeClaim ?? storyRecord)],
    };
  }
  return {
    phase,
    status: "missing",
    provenance: "missing",
    sourceRefs: currentPhase === phase ? [sourceRef(storyRecord)] : [],
  };
}

function phaseFromStep(record) {
  if (SDLC_PHASES.includes(record.data.phase)) return record.data.phase;
  if (SDLC_PHASES.includes(record.data.step)) return record.data.step;
  const name = path.posix.basename(record.path, path.posix.extname(record.path));
  return SDLC_PHASES.includes(name) ? name : null;
}

function storyIdFromPath(publicPath) {
  return publicPath.match(/^\.sdlc\/stories\/([^/]+)\//)?.[1] ?? null;
}

function normalizeSemanticObservations(records, limits, diagnostics) {
  const traces = records.filter((record) => record.kind === "trace" && isRecordObject(record));
  const linkIndex = buildSemanticObservationLinkIndex(traces, limits, diagnostics);
  const projected = records
    .filter((record) => record.kind === "semantic-observation")
    .flatMap((record) => {
      if (!isIntentAbiObservationPath(record.path)) {
        diagnostics.add({
          code: "intentabi_observation_path_noncanonical",
          message: "An IntentABI envelope outside .sdlc/observations/intentabi was not added to the semantic observation view.",
          provenance: "malformed",
          sourceRefs: [{ path: INTENTABI_REDACTED_OBSERVATION_PATH }],
        });
        return [];
      }
      const projection = projectIntentAbiCodexEnvelope(record.data);
      if (!projection) {
        diagnostics.add({
          code: "intentabi_envelope_malformed",
          severity: "error",
          message: "An IntentABI envelope failed strict validation and its content was omitted.",
          provenance: "malformed",
          sourceRefs: [sourceRef(record)],
        });
        return [];
      }

      if (!isCanonicalIntentAbiObservationPath(record.path, projection.eventId)) {
        diagnostics.add({
          code: "intentabi_observation_path_noncanonical",
          severity: "error",
          message: "An IntentABI envelope did not use the canonical event-ID JSON path and was omitted.",
          provenance: "malformed",
          sourceRefs: [sourceRef(record)],
        });
        return [];
      }

      const link = explicitSemanticObservationLink(record, linkIndex, limits, diagnostics);
      return [{
        id: projection.eventId,
        type: "intentabi-codex-shadow",
        title: "IntentABI shadow observation",
        summary: "Content-free IntentABI shadow evidence.",
        status: projection.outcome,
        phase: null,
        action: null,
        intent: null,
        timestamp: null,
        provenance: "recorded",
        sourceRefs: [sourceRef(record), ...link.sourceRefs],
        rawHref: rawHref(record.path),
        mode: projection.mode,
        submitted: projection.submitted,
        outcome: projection.outcome,
        reason: projection.reason,
        proof: projection.proof,
        macStatus: projection.macStatus,
        link,
      }];
    });

  return projected;
}

function buildSemanticObservationLinkIndex(traces, limits, diagnostics) {
  const index = new Map();
  const truncatedSourceRefs = [];
  let inspected = 0;
  let truncated = false;

  for (const trace of traces) {
    const evidence = Array.isArray(trace.data.evidence) ? trace.data.evidence : [];
    const recordLimit = Math.min(evidence.length, limits.maxCollectionItems);
    if (evidence.length > recordLimit) {
      truncated = true;
      truncatedSourceRefs.push(sourceRef(trace));
    }
    for (let evidenceIndex = 0; evidenceIndex < recordLimit; evidenceIndex += 1) {
      if (inspected >= limits.maxRecords) {
        truncated = true;
        truncatedSourceRefs.push(sourceRef(trace));
        break;
      }
      inspected += 1;
      const reference = evidence[evidenceIndex];
      if (typeof reference !== "string" || !isIntentAbiObservationPath(reference)) continue;
      const matches = index.get(reference) ?? [];
      matches.push({
        storyId: boundedText(trace.data.story_id, limits.maxTextChars).value,
        traceId: boundedText(trace.data.id, limits.maxTextChars).value,
        sourceRef: { ...sourceRef(trace), pointer: `/evidence/${evidenceIndex}` },
      });
      index.set(reference, matches);
    }
    if (inspected >= limits.maxRecords && truncated) break;
  }

  if (truncated) {
    diagnostics.add({
      code: "intentabi_link_index_truncated",
      message: "IntentABI trace-link indexing reached its configured evidence-reference limit; omitted links remain unlinked.",
      provenance: "inferred",
      sourceRefs: truncatedSourceRefs,
    });
  }
  return index;
}

function explicitSemanticObservationLink(record, linkIndex, limits, diagnostics) {
  const indexedMatches = linkIndex.get(record.path) ?? [];
  const incomplete = indexedMatches.filter((match) => !match.storyId || !match.traceId);
  if (incomplete.length > 0) {
    diagnostics.add({
      code: "intentabi_link_incomplete",
      message: "A trace cites an IntentABI envelope without both a story ID and trace ID; that link was ignored.",
      provenance: "malformed",
      sourceRefs: [sourceRef(record), ...incomplete.map((match) => match.sourceRef)],
    });
  }
  const matches = indexedMatches.filter((match) => match.storyId && match.traceId);

  const storyIds = [...new Set(matches.map((match) => match.storyId))];
  if (storyIds.length !== 1) {
    if (storyIds.length > 1) {
      diagnostics.add({
        code: "intentabi_story_link_ambiguous",
        message: "An IntentABI envelope is referenced by traces from multiple stories and remains unlinked.",
        provenance: "malformed",
        sourceRefs: [sourceRef(record), ...matches.map((match) => match.sourceRef)],
      });
    }
    return {
      status: "unlinked",
      storyId: null,
      traceIds: [],
      sourceRefs: [],
    };
  }

  const linked = matches.filter((match) => match.storyId === storyIds[0]);
  return {
    status: "linked",
    storyId: storyIds[0],
    traceIds: [...new Set(linked.map((match) => match.traceId))].slice(0, limits.maxCollectionItems),
    sourceRefs: linked.map((match) => match.sourceRef).slice(0, limits.maxCollectionItems),
  };
}

function isDecisionTrace(data) {
  return isPlainObject(data)
    && (data.type === "decision" || (data.type === "gate" && String(data.action ?? "").includes("approve")));
}

function isVerificationRecord(record) {
  if (!isRecordObject(record)) return false;
  if (["test", "release"].includes(record.kind)) return true;
  if (record.kind === "report") {
    return /gate|test|validation|release/i.test(record.path);
  }
  return record.kind === "trace" && ["test", "gate", "release"].includes(record.data.type);
}

function buildSnapshots(collections) {
  const phaseCounts = Object.fromEntries(SDLC_PHASES.map((phase) => [
    phase,
    { complete: 0, inProgress: 0, blocked: 0, missing: 0 },
  ]));
  for (const iteration of collections.iterations) {
    for (const phase of iteration.phases) {
      phaseCounts[phase.phase][phase.status] += 1;
    }
  }

  return {
    counts: {
      iterations: collections.iterations.length,
      contracts: collections.contracts.length,
      decisions: collections.decisions.length,
      changes: collections.changes.length,
      verification: collections.verification.length,
      semanticObservations: collections.semanticObservations.length,
      dossiers: collections.dossiers.length,
      unlinked: collections.unlinked.length,
      records: collections.records.length,
    },
    phaseCounts,
    provenance: "inferred",
    sourceRefs: collections.iterations.flatMap((item) => item.sourceRefs).slice(0, 50),
  };
}

function publicRecordMetadata(record, limits) {
  const intentAbiCandidate = isIntentAbiCodexEnvelopeCandidate(record.data, record.path);
  const intentAbiProjection = intentAbiCandidate ? projectIntentAbiCodexEnvelope(record.data) : null;
  if (
    intentAbiCandidate
    && !isCanonicalIntentAbiObservationPath(record.path, intentAbiProjection?.eventId ?? null)
  ) {
    return null;
  }
  const data = intentAbiCandidate
    ? intentAbiProjection
      ? { id: intentAbiProjection.eventId, status: intentAbiProjection.outcome }
      : null
    : isPlainObject(record.data) ? record.data : null;
  const id = boundedText(data?.id ?? data?.story_id ?? data?.contract_id, limits.maxTextChars);
  const title = boundedText(data?.title ?? data?.name, limits.maxTextChars);
  const summary = boundedText(data?.summary ?? data?.purpose, limits.maxTextChars);
  const rawAvailable = record.sizeBytes <= limits.maxSourceBytes
    && (!intentAbiCandidate || intentAbiProjection !== null);
  return {
    id: id.value ?? fallbackRecordId(record),
    type: record.kind,
    kind: record.kind,
    title: title.value ?? id.value,
    summary: summary.value,
    status: boundedText(data?.status ?? data?.outcome, limits.maxTextChars).value,
    phase: boundedText(data?.phase, limits.maxTextChars).value,
    timestamp: normalizeOptionalTimestamp(data?.created_at ?? data?.updated_at),
    path: publicSourcePath(record.path),
    line: record.line,
    format: record.format,
    schemaVersion: boundedText(data?.schema_version, limits.maxTextChars).value,
    sizeBytes: record.sizeBytes,
    provenance: intentAbiCandidate && !intentAbiProjection ? "malformed" : record.provenance,
    sourceRefs: [sourceRef(record)],
    rawHref: rawAvailable ? rawHref(record.path) : null,
    rawAvailable,
    textTruncated: id.truncated || title.truncated || summary.truncated,
  };
}

function capCollection(items, limits, diagnostics, label) {
  if (items.length <= limits.maxCollectionItems) {
    return items;
  }
  diagnostics.add({
    code: "collection_truncated",
    message: `The ${label} collection was truncated by the configured item limit.`,
    sourceRefs: [],
  });
  return items.slice(0, limits.maxCollectionItems);
}

function dedupeItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.type}\u0000${item.summary ?? item.title ?? item.id}\u0000${item.sourceRefs[0]?.path ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sortItems(items) {
  return [...items].sort((left, right) => {
    const byTimestamp = compareStrings(String(right.timestamp ?? ""), String(left.timestamp ?? ""));
    if (byTimestamp !== 0) return byTimestamp;
    return compareStrings(String(left.id), String(right.id));
  });
}

function compareRecords(left, right) {
  const byPath = compareStrings(left.path, right.path);
  if (byPath !== 0) return byPath;
  return (left.line ?? 0) - (right.line ?? 0);
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sourceRef(record) {
  return normalizeSourceRef({ path: record.path, line: record.line ?? undefined });
}

function normalizeSourceRef(value) {
  const normalized = { path: publicSourcePath(value.path) };
  if (Number.isSafeInteger(value.line) && value.line > 0) normalized.line = value.line;
  if (typeof value.pointer === "string" && value.pointer !== "") normalized.pointer = value.pointer;
  return normalized;
}

function rawHref(publicPath) {
  return `/api/v1/source?path=${encodeURIComponent(publicPath)}`;
}

function fallbackRecordId(record) {
  return `${record.kind}:${publicSourcePath(record.path)}${record.line ? `:${record.line}` : ""}`;
}

function publicSourcePath(publicPath) {
  if (isIntentAbiObservationPath(publicPath) && !isCanonicalIntentAbiObservationPath(publicPath)) {
    return INTENTABI_REDACTED_OBSERVATION_PATH;
  }
  return publicPath;
}

function boundedText(value, maxChars) {
  if (typeof value !== "string") return { value: null, truncated: false };
  const normalized = value.trim();
  if (normalized === "") return { value: null, truncated: false };
  if (normalized.length <= maxChars) return { value: normalized, truncated: false };
  return { value: normalized.slice(0, maxChars), truncated: true };
}

function normalizeOptionalTimestamp(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function normalizeGeneratedAt(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError("Observatory clock must return a valid Date or date-time value");
  }
  return date.toISOString();
}

function formatForPath(publicPath) {
  const extension = path.posix.extname(publicPath).toLowerCase();
  if (extension === ".json") return "json";
  if (extension === ".jsonl") return "jsonl";
  if ([".md", ".markdown"].includes(extension)) return "markdown";
  return "text";
}

function toKnowledgeBasePath(relativePath) {
  return relativePath ? `.sdlc/${relativePath}` : ".sdlc";
}

function portableSegments(relativePath) {
  return relativePath ? relativePath.split("/") : [];
}

function isRecordObject(record) {
  return record?.provenance === "recorded" && isPlainObject(record.data);
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizedStringList(value, limits) {
  const seen = new Set();
  const normalized = [];
  for (const item of asArray(value).slice(0, limits.maxCollectionItems)) {
    const text = boundedText(item, limits.maxTextChars).value;
    if (!text || seen.has(text)) continue;
    seen.add(text);
    normalized.push(text);
  }
  return normalized;
}
