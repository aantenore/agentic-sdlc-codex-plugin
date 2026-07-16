import fs from "node:fs/promises";
import path from "node:path";

import {
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

const SUPPORTED_EXTENSIONS = new Set([".json", ".jsonl", ".md", ".markdown", ".txt"]);
const DERIVED_DIRECTORIES = new Set(["cache", "indexes"]);

class DiagnosticCollector {
  constructor(limit) {
    this.limit = limit;
    this.items = [];
    this.overflow = 0;
  }

  add({ code, severity = "warning", message, provenance = "inferred", sourceRefs = [] }) {
    const diagnostic = {
      code,
      severity,
      message,
      provenance,
      sourceRefs: sourceRefs.map(normalizeSourceRef),
    };
    if (this.items.length < this.limit) {
      this.items.push(diagnostic);
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

export async function buildObservatoryViewModel(projectRoot, options = {}) {
  const limits = normalizeObservatoryLimits(options.limits);
  const clock = typeof options.clock === "function" ? options.clock : () => new Date();
  const generatedAt = normalizeGeneratedAt(clock());
  const diagnostics = new DiagnosticCollector(limits.maxDiagnostics);
  const scan = await scanKnowledgeBase(projectRoot, { limits, diagnostics });
  const records = scan.records;

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

  const iterations = normalizeIterations(records, limits, diagnostics);
  const publicRecords = records.map((record) => publicRecordMetadata(record, limits));

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
      records: publicRecords,
    }),
    summary: {
      asked: capCollection(
        dedupeItems([...requirementItems, ...requestItems]),
        limits,
        diagnostics,
        "summary.asked",
      ),
      changed: capCollection(sortItems(changes), limits, diagnostics, "summary.changed"),
      decided: capCollection(sortItems(decisions), limits, diagnostics, "summary.decided"),
    },
    iterations: capCollection(iterations, limits, diagnostics, "iterations"),
    contracts: capCollection(sortItems(contracts), limits, diagnostics, "contracts"),
    decisions: capCollection(sortItems(decisions), limits, diagnostics, "decisions"),
    changes: capCollection(sortItems(changes), limits, diagnostics, "changes"),
    verification: capCollection(sortItems(verification), limits, diagnostics, "verification"),
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
      if (relativeDirectory === "" && DERIVED_DIRECTORIES.has(entry.name)) {
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
      } else if (typeof data.schema_version !== "string") {
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
    kind: classifyRecord(publicPath),
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

function classifyRecord(publicPath) {
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
      timestamp: null,
      provenance: "malformed",
      sourceRefs: refs,
      rawHref: rawHref(record.path),
      explanation: null,
      inputs: [],
      outputs: [],
      alternatives: [],
      evidence: [],
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
  const timestamp = normalizeOptionalTimestamp(
    overrides.timestamp ?? data.created_at ?? data.updated_at ?? data.confirmed_at ?? data.timestamp,
  );
  const id = recordedId.value ?? fallbackRecordId(record);
  const displayTitle = title.value ?? recordedId.value;
  const inferredLabel = !title.value && !recordedId.value;
  const provenance = overrides.provenance
    ?? (record.provenance === "recorded" && inferredLabel ? "inferred" : record.provenance);
  const explanation = buildExplanation(data, summary.value, refs, limits, diagnostics, record);

  return {
    id,
    type: overrides.type ?? data.type ?? record.kind,
    title: displayTitle,
    summary: summary.value,
    status: status.value,
    phase: phase.value,
    timestamp,
    provenance,
    sourceRefs: refs,
    rawHref: rawHref(record.path),
    explanation,
    inputs: buildTextRefs(
      data.narrative?.input_summary ?? data.inputs,
      `${id}:input`,
      refs,
      limits,
    ),
    outputs: buildTextRefs(
      data.narrative?.output_summary ?? data.outputs,
      `${id}:output`,
      refs,
      limits,
    ),
    alternatives: buildTextRefs(
      data.narrative?.alternatives,
      `${id}:alternative`,
      refs,
      limits,
    ),
    evidence: buildTextRefs(
      [...asArray(data.evidence), ...asArray(data.narrative?.evidence)],
      `${id}:evidence`,
      refs,
      limits,
    ),
    textTruncated: [recordedId, title, summary, status, phase].some((field) => field.truncated),
  };
}

function buildExplanation(data, fallbackSummary, refs, limits, diagnostics, record) {
  const narrative = isPlainObject(data.narrative) ? data.narrative : null;
  if (narrative?.chain_of_thought_included === true) {
    diagnostics.add({
      code: "private_reasoning_redacted",
      severity: "error",
      message: "A narrative marked as containing private reasoning was excluded from the normalized view.",
      provenance: "malformed",
      sourceRefs: refs,
    });
  } else if (narrative) {
    const generated = boundedText(narrative.generated_explanation, limits.maxTextChars);
    const rationale = boundedText(narrative.rationale, limits.maxTextChars);
    const text = generated.value ?? rationale.value;
    if (text) {
      return {
        text,
        authoring: normalizeExplanationAuthoring(narrative.explanation_source, Boolean(generated.value)),
        provenance: "recorded",
        sourceRefs: refs.map((ref) => ({ ...ref, pointer: "/narrative" })),
        truncated: generated.truncated || rationale.truncated,
      };
    }
  }

  const legacyExplanation = boundedText(data.generated_explanation ?? data.explanation, limits.maxTextChars);
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

function normalizeExplanationAuthoring(value, generated) {
  if (value === "human") return "human";
  if (["codex", "codex-generated", "agent"].includes(value)) return "codex-generated";
  return generated ? "codex-generated" : "deterministic";
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
      records: collections.records.length,
    },
    phaseCounts,
    provenance: "inferred",
    sourceRefs: collections.iterations.flatMap((item) => item.sourceRefs).slice(0, 50),
  };
}

function publicRecordMetadata(record, limits) {
  const data = isPlainObject(record.data) ? record.data : null;
  const id = boundedText(data?.id ?? data?.story_id ?? data?.contract_id, limits.maxTextChars);
  const title = boundedText(data?.title ?? data?.name, limits.maxTextChars);
  const summary = boundedText(data?.summary ?? data?.purpose, limits.maxTextChars);
  const rawAvailable = record.sizeBytes <= limits.maxSourceBytes;
  return {
    id: id.value ?? fallbackRecordId(record),
    type: record.kind,
    kind: record.kind,
    title: title.value ?? id.value,
    summary: summary.value,
    status: boundedText(data?.status ?? data?.outcome, limits.maxTextChars).value,
    phase: boundedText(data?.phase, limits.maxTextChars).value,
    timestamp: normalizeOptionalTimestamp(data?.created_at ?? data?.updated_at),
    path: record.path,
    line: record.line,
    format: record.format,
    schemaVersion: boundedText(data?.schema_version, limits.maxTextChars).value,
    sizeBytes: record.sizeBytes,
    provenance: record.provenance,
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
  const normalized = { path: value.path };
  if (Number.isSafeInteger(value.line) && value.line > 0) normalized.line = value.line;
  if (typeof value.pointer === "string" && value.pointer !== "") normalized.pointer = value.pointer;
  return normalized;
}

function rawHref(publicPath) {
  return `/api/v1/source?path=${encodeURIComponent(publicPath)}`;
}

function fallbackRecordId(record) {
  return `${record.kind}:${record.path}${record.line ? `:${record.line}` : ""}`;
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
