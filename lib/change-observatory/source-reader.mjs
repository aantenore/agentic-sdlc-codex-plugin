import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  CANONICAL_SOURCE_EXTENSIONS,
  OBSERVATORY_SOURCE_SCHEMA_VERSION,
  normalizeObservatoryLimits,
} from "./constants.mjs";
import {
  ObservatoryPathError,
  normalizePortableRelativePath,
  resolveExistingFileWithin,
  resolveKnowledgeBaseBoundary,
} from "./path-safety.mjs";
import {
  INTENTABI_REDACTED_OBSERVATION_PATH,
  isCanonicalIntentAbiObservationPath,
  isIntentAbiCodexEnvelopeCandidate,
  isIntentAbiObservationPath,
  projectIntentAbiCodexEnvelope,
} from "./intentabi-adapter.mjs";

const DERIVED_PREFIXES = [".sdlc/cache", ".sdlc/indexes"];
const PRIVATE_REASONING_KEYS = new Set([
  "chainofthought",
  "internalreasoning",
  "privatereasoning",
  "reasoningtrace",
]);
const PRIVATE_REASONING_FLAG_KEYS = new Set(["chainofthoughtincluded"]);
const PRIVATE_REASONING_SCAN_MAX_DEPTH = 512;
const PRIVATE_REASONING_SCAN_MAX_NODES = 25_000;
const ALLOWED_SOURCE_EXTENSIONS = new Set(CANONICAL_SOURCE_EXTENSIONS);

export async function readSourceRecord(projectRoot, relativePath, options = {}) {
  const limits = normalizeObservatoryLimits(options.limits);
  const boundary = await resolveKnowledgeBaseBoundary(projectRoot);
  const normalized = normalizePortableRelativePath(relativePath, { requiredPrefix: ".sdlc" });
  const policyPath = normalized.toLowerCase();

  if (DERIVED_PREFIXES.some((prefix) => policyPath === prefix || policyPath.startsWith(`${prefix}/`))) {
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
  if (!ALLOWED_SOURCE_EXTENSIONS.has(path.posix.extname(normalized).toLowerCase())) {
    throw new ObservatoryPathError(
      "source_format_forbidden",
      "Only canonical JSON, JSONL, Markdown, and text evidence may be inspected",
      403,
    );
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

  if (isIntentAbiObservationPath(normalized)) omitIntentAbiFileMetadata(response);

  if (
    isIntentAbiObservationPath(normalized)
    && !isCanonicalIntentAbiObservationPath(normalized)
  ) {
    response.path = INTENTABI_REDACTED_OBSERVATION_PATH;
    response.provenance = "malformed";
    response.parseError = "invalid_intentabi_path";
    response.contentOmitted = true;
    response.redactions.push("");
    return response;
  }

  if (format === "json") {
    try {
      const data = JSON.parse(content);
      if (isIntentAbiCodexEnvelopeCandidate(data, normalized)) {
        omitIntentAbiFileMetadata(response);
        const projection = projectIntentAbiCodexEnvelope(data);
        if (!projection || !isCanonicalIntentAbiObservationPath(normalized, projection.eventId)) {
          if (!isCanonicalIntentAbiObservationPath(normalized)) {
            response.path = INTENTABI_REDACTED_OBSERVATION_PATH;
          }
          response.provenance = "malformed";
          response.parseError = projection
            ? "invalid_intentabi_path"
            : "invalid_intentabi_envelope";
          response.contentOmitted = true;
          response.redactions.push("");
          return response;
        }
        response.data = projection;
        response.contentProjection = "intentabi-observatory:v1";
        return response;
      }
      const redacted = redactPrivateReasoning(data, response.redactions, "");
      if (redacted.limited) {
        response.provenance = "malformed";
        response.parseError = "private_reasoning_scan_limited";
        response.contentOmitted = true;
        response.redactions = [""];
        return response;
      }
      response.data = redacted.data;
    } catch {
      response.provenance = "malformed";
      response.parseError = "invalid_json";
      response.contentOmitted = true;
      response.redactions.push("");
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
        if (isIntentAbiCodexEnvelopeCandidate(data, normalized)) {
          omitIntentAbiFileMetadata(response);
          const projection = projectIntentAbiCodexEnvelope(data);
          if (!projection || !isCanonicalIntentAbiObservationPath(normalized, projection.eventId)) {
            if (!isCanonicalIntentAbiObservationPath(normalized)) {
              response.path = INTENTABI_REDACTED_OBSERVATION_PATH;
            }
            response.entries.push({
              line: index + 1,
              parseError: projection
                ? "invalid_intentabi_path"
                : "invalid_intentabi_envelope",
              provenance: "malformed",
              contentOmitted: true,
            });
            response.redactions.push(`/${index}`);
            response.provenance = "malformed";
            continue;
          }
          response.entries.push({
            line: index + 1,
            data: projection,
            provenance: "recorded",
            contentProjection: "intentabi-observatory:v1",
          });
          continue;
        }
        const redacted = redactPrivateReasoning(data, response.redactions, `/${index}`);
        if (redacted.limited) {
          response.entries.push({
            line: index + 1,
            parseError: "private_reasoning_scan_limited",
            provenance: "malformed",
            contentOmitted: true,
          });
          response.redactions.push(`/${index}`);
          response.provenance = "malformed";
          continue;
        }
        response.entries.push({
          line: index + 1,
          data: redacted.data,
          provenance: "recorded",
        });
      } catch {
        response.entries.push({
          line: index + 1,
          parseError: "invalid_json",
          provenance: "malformed",
          contentOmitted: true,
        });
        response.redactions.push(`/${index}`);
        response.provenance = "malformed";
      }
    }
    return response;
  }

  response.content = content;
  return response;
}

function redactPrivateReasoning(value, redactions, pointer) {
  if (!isStructuredValue(value)) return { data: value, limited: false };
  const data = Array.isArray(value) ? [] : Object.create(null);
  const stack = [{
    kind: "container",
    source: value,
    target: data,
    pointer,
    depth: 0,
  }];
  let inspectedNodes = 0;

  while (stack.length > 0) {
    const frame = stack.pop();
    inspectedNodes += 1;
    if (
      inspectedNodes > PRIVATE_REASONING_SCAN_MAX_NODES
      || frame.depth > PRIVATE_REASONING_SCAN_MAX_DEPTH
    ) {
      return { data: null, limited: true };
    }

    if (frame.kind === "redact") {
      frame.target[frame.key] = "[redacted]";
      redactions.push(frame.pointer);
      continue;
    }
    if (frame.kind === "value") {
      if (!isStructuredValue(frame.value)) {
        frame.target[frame.key] = frame.value;
        continue;
      }
      const child = Array.isArray(frame.value) ? [] : Object.create(null);
      frame.target[frame.key] = child;
      stack.push({
        kind: "container",
        source: frame.value,
        target: child,
        pointer: frame.pointer,
        depth: frame.depth,
      });
      continue;
    }

    if (Array.isArray(frame.source)) {
      frame.target.length = frame.source.length;
      for (let index = frame.source.length - 1; index >= 0; index -= 1) {
        stack.push({
          kind: "value",
          value: frame.source[index],
          target: frame.target,
          key: index,
          pointer: `${frame.pointer}/${index}`,
          depth: frame.depth + 1,
        });
      }
      continue;
    }

    const entries = Object.entries(frame.source);
    const flaggedNarrative = entries.some(
      ([key, item]) => PRIVATE_REASONING_FLAG_KEYS.has(normalizeSensitiveKey(key)) && item === true,
    );
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [key, item] = entries[index];
      const itemPointer = `${frame.pointer}/${escapeJsonPointer(key)}`;
      const sensitiveKey = normalizeSensitiveKey(key);
      if (
        PRIVATE_REASONING_KEYS.has(sensitiveKey)
        || (flaggedNarrative && !PRIVATE_REASONING_FLAG_KEYS.has(sensitiveKey))
      ) {
        stack.push({
          kind: "redact",
          target: frame.target,
          key,
          pointer: itemPointer,
          depth: frame.depth + 1,
        });
        continue;
      }
      stack.push({
        kind: "value",
        value: item,
        target: frame.target,
        key,
        pointer: itemPointer,
        depth: frame.depth + 1,
      });
    }
  }
  return { data, limited: false };
}

function isStructuredValue(value) {
  return value !== null && typeof value === "object";
}

function omitIntentAbiFileMetadata(response) {
  delete response.sha256;
  delete response.sizeBytes;
}

function normalizeSensitiveKey(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, "");
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
