import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  OBSERVATORY_SOURCE_SCHEMA_VERSION,
  normalizeObservatoryLimits,
} from "./constants.mjs";
import {
  ObservatoryPathError,
  normalizePortableRelativePath,
  resolveExistingFileWithin,
  resolveKnowledgeBaseBoundary,
} from "./path-safety.mjs";

const DERIVED_PREFIXES = [".sdlc/cache", ".sdlc/indexes"];
const PRIVATE_REASONING_KEYS = new Set([
  "chain_of_thought",
  "internal_reasoning",
  "private_reasoning",
  "reasoning_trace",
]);

export async function readSourceRecord(projectRoot, relativePath, options = {}) {
  const limits = normalizeObservatoryLimits(options.limits);
  const boundary = await resolveKnowledgeBaseBoundary(projectRoot);
  const normalized = normalizePortableRelativePath(relativePath, { requiredPrefix: ".sdlc" });

  if (DERIVED_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`))) {
    throw new ObservatoryPathError(
      "derived_source_forbidden",
      "Derived cache and index files are not canonical source records",
      403,
    );
  }

  const knowledgeBaseRelative = normalized.slice(".sdlc/".length);
  if (!knowledgeBaseRelative || normalized === ".sdlc") {
    throw new ObservatoryPathError("source_not_file", "The requested source record is not a file", 404);
  }
  const resolved = await resolveExistingFileWithin(boundary.knowledgeBaseRoot, knowledgeBaseRelative);
  if (resolved.stats.size > limits.maxSourceBytes) {
    throw new ObservatoryPathError(
      "source_too_large",
      "The requested source record exceeds the configured response limit",
      413,
    );
  }

  const buffer = await fs.readFile(resolved.resolved);
  if (buffer.byteLength > limits.maxSourceBytes) {
    throw new ObservatoryPathError(
      "source_too_large",
      "The requested source record exceeds the configured response limit",
      413,
    );
  }

  const content = buffer.toString("utf8");
  const format = sourceFormat(normalized);
  const response = {
    schemaVersion: OBSERVATORY_SOURCE_SCHEMA_VERSION,
    path: normalized,
    format,
    sizeBytes: buffer.byteLength,
    sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
    provenance: "recorded",
    redactions: [],
    truncated: false,
  };

  if (format === "json") {
    try {
      const data = JSON.parse(content);
      response.data = redactPrivateReasoning(data, response.redactions, "");
    } catch {
      response.provenance = "malformed";
      response.raw = content;
      response.parseError = "invalid_json";
    }
    return response;
  }

  if (format === "jsonl") {
    const lines = content.split(/\r?\n/);
    const lineLimit = Math.min(lines.length, limits.maxJsonLines);
    response.entries = [];
    response.truncated = lines.length > limits.maxJsonLines;
    for (let index = 0; index < lineLimit; index += 1) {
      const raw = lines[index].trim();
      if (raw === "") continue;
      try {
        const data = JSON.parse(raw);
        response.entries.push({
          line: index + 1,
          data: redactPrivateReasoning(data, response.redactions, `/${index}`),
          provenance: "recorded",
        });
      } catch {
        response.entries.push({
          line: index + 1,
          raw,
          parseError: "invalid_json",
          provenance: "malformed",
        });
        response.provenance = "malformed";
      }
    }
    return response;
  }

  response.content = content;
  return response;
}

function redactPrivateReasoning(value, redactions, pointer) {
  if (Array.isArray(value)) {
    return value.map((item, index) => redactPrivateReasoning(item, redactions, `${pointer}/${index}`));
  }
  if (value === null || typeof value !== "object") {
    return value;
  }

  const result = {};
  const flaggedNarrative = value.chain_of_thought_included === true;
  for (const [key, item] of Object.entries(value)) {
    const itemPointer = `${pointer}/${escapeJsonPointer(key)}`;
    if (
      PRIVATE_REASONING_KEYS.has(key.toLowerCase())
      || (flaggedNarrative && ["generated_explanation", "rationale"].includes(key))
    ) {
      result[key] = "[redacted]";
      redactions.push(itemPointer);
      continue;
    }
    result[key] = redactPrivateReasoning(item, redactions, itemPointer);
  }
  return result;
}

function sourceFormat(publicPath) {
  const extension = path.posix.extname(publicPath).toLowerCase();
  if (extension === ".json") return "json";
  if (extension === ".jsonl") return "jsonl";
  if ([".md", ".markdown"].includes(extension)) return "markdown";
  return "text";
}

function escapeJsonPointer(value) {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}
