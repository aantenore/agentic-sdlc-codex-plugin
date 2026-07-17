import path from "node:path";

import { immutableJson, isPlainRecord } from "./canonical.mjs";
import { CanonicalStoreError, openCanonicalStore } from "./canonical-store.mjs";

export const DEFAULT_DERIVED_CANONICAL_DIRECTORIES = Object.freeze(["cache", "indexes"]);

/**
 * Open one linear, command-scoped view of the canonical project tree.
 *
 * The file catalog is built lazily and at most once until invalidate() is
 * called. File bytes and hashes remain guarded by canonical-store, while JSON
 * and JSONL parsing is memoized by content hash for the lifetime of the
 * command. Writers must call invalidate(path) after adding or removing files.
 */
export function openCanonicalQuerySession({
  root = process.cwd(),
  canonicalRoot = ".sdlc",
  derivedDirectories = DEFAULT_DERIVED_CANONICAL_DIRECTORIES,
  store = null,
  onMetric = null,
} = {}) {
  if (onMetric !== null && typeof onMetric !== "function") {
    throw new TypeError("Canonical query session onMetric must be a function");
  }

  const rootPath = path.resolve(String(root));
  const emit = (type, details = {}) => {
    onMetric?.(Object.freeze({ scope: "canonical-query-session", type, ...details }));
  };
  const canonicalStore = store || openCanonicalStore({
    root: rootPath,
    onMetric: onMetric
      ? (event) => onMetric(Object.freeze({ scope: "canonical-store", ...event }))
      : null,
  });
  assertCanonicalStore(canonicalStore, rootPath);

  const canonicalBoundary = normalizeProjectPath(rootPath, null, canonicalRoot, {
    label: "canonicalRoot",
    allowCanonicalRelative: false,
  });
  const normalizePath = (input, label = "path") => normalizeProjectPath(
    rootPath,
    canonicalBoundary,
    input,
    { label, allowCanonicalRelative: true },
  );
  const derivedPrefixes = normalizeStringList(derivedDirectories, "derivedDirectories")
    .map((directory) => normalizePath(directory, "derived directory").projectPath.toLowerCase())
    .sort(comparePortableStrings);

  let catalogCache = null;
  let catalogGeneration = 0;
  const textCache = new Map();
  const jsonCache = new Map();
  const jsonLinesCache = new Map();
  const counters = {
    catalog_builds: 0,
    catalog_reuses: 0,
    files_indexed: 0,
    list_calls: 0,
    read_text_calls: 0,
    read_json_calls: 0,
    read_json_lines_calls: 0,
    parsed_cache_hits: 0,
    parsed_cache_misses: 0,
    json_parses: 0,
    json_line_parses: 0,
    source_snapshots: 0,
    invalidations: 0,
    parsed_entries_evicted: 0,
  };

  const isDerivedPath = (projectPath) => {
    const normalized = projectPath.toLowerCase();
    return derivedPrefixes.some(
      (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
    );
  };

  const assertDigestUnchanged = (resolved, expectedSha256) => {
    const currentSha256 = canonicalStore.hash(resolved.projectPath);
    if (currentSha256 !== expectedSha256) {
      throw new CanonicalStoreError(
        "source_changed",
        `Canonical source changed during the query session: ${resolved.projectPath}`,
      );
    }
    return currentSha256;
  };

  const buildCatalog = () => {
    if (catalogCache) {
      counters.catalog_reuses += 1;
      emit("catalog_reuse", { generation: catalogGeneration });
      return catalogCache;
    }

    const descriptors = canonicalStore.walk(canonicalBoundary.projectPath)
      .map((absolutePath) => fileDescriptor(
        normalizePath(absolutePath, "indexed file"),
        isDerivedPath,
      ))
      .sort((left, right) => comparePortableStrings(left.path, right.path));
    const canonicalFiles = Object.freeze(descriptors.filter((file) => !file.derived));
    const derivedFiles = Object.freeze(descriptors.filter((file) => file.derived));
    catalogGeneration += 1;
    counters.catalog_builds += 1;
    counters.files_indexed += descriptors.length;
    catalogCache = Object.freeze({
      canonical_root: canonicalBoundary.projectPath,
      generation: catalogGeneration,
      files: canonicalFiles,
      derived_files: derivedFiles,
    });
    emit("catalog_build", {
      generation: catalogGeneration,
      files: canonicalFiles.length,
      derived_files: derivedFiles.length,
    });
    return catalogCache;
  };

  const listFiles = (input = {}) => {
    counters.list_calls += 1;
    const options = typeof input === "string" ? { under: input } : input || {};
    if (!isPlainRecord(options)) {
      throw new TypeError("Canonical file query must be an object or path string");
    }
    const under = normalizePath(options.under ?? ".", "under");
    const extensions = normalizeExtensions(options.extensions);
    const names = normalizeOptionalStringSet(options.names, "names");
    const recursive = options.recursive !== false;
    const includeDerived = options.includeDerived === true;
    const catalog = buildCatalog();
    const candidates = includeDerived
      ? [...catalog.files, ...catalog.derived_files].sort((left, right) => comparePortableStrings(left.path, right.path))
      : catalog.files;
    const prefix = `${under.projectPath}/`;
    const selected = candidates.filter((file) => {
      const inside = file.path === under.projectPath || file.path.startsWith(prefix);
      if (!inside) return false;
      if (!recursive && path.posix.dirname(file.path) !== under.projectPath) return false;
      if (extensions && !extensions.has(file.extension)) return false;
      if (names && !names.has(file.basename)) return false;
      return true;
    });
    return Object.freeze(selected);
  };

  const readText = (input, { encoding = "utf8" } = {}) => {
    counters.read_text_calls += 1;
    const resolved = normalizePath(input);
    const digest = canonicalStore.hash(resolved.projectPath);
    const cacheKey = `${resolved.projectPath}\u0000${encoding}`;
    const cached = textCache.get(cacheKey);
    if (cached?.sha256 === digest) {
      counters.parsed_cache_hits += 1;
      return cached.value;
    }
    counters.parsed_cache_misses += 1;
    const value = canonicalStore.readText(resolved.projectPath, { encoding });
    assertDigestUnchanged(resolved, digest);
    textCache.set(cacheKey, { path: resolved.projectPath, sha256: digest, value });
    return value;
  };

  const readTextAtHash = (input, expectedSha256, options = {}) => {
    if (typeof expectedSha256 !== "string" || !/^[a-f0-9]{64}$/iu.test(expectedSha256)) {
      throw new TypeError("Canonical query expectedSha256 must be a SHA-256 hex digest");
    }
    const resolved = normalizePath(input);
    const expected = expectedSha256.toLowerCase();
    assertDigestUnchanged(resolved, expected);
    const value = readText(resolved.projectPath, options);
    assertDigestUnchanged(resolved, expected);
    return value;
  };

  const readJson = (input) => {
    counters.read_json_calls += 1;
    const resolved = normalizePath(input);
    const digest = canonicalStore.hash(resolved.projectPath);
    const cached = jsonCache.get(resolved.projectPath);
    if (cached?.sha256 === digest) {
      counters.parsed_cache_hits += 1;
      return cached.value;
    }
    counters.parsed_cache_misses += 1;
    counters.json_parses += 1;
    const value = immutableJson(canonicalStore.readJson(resolved.projectPath));
    assertDigestUnchanged(resolved, digest);
    jsonCache.set(resolved.projectPath, { path: resolved.projectPath, sha256: digest, value });
    return value;
  };

  const readJsonLines = (input) => {
    counters.read_json_lines_calls += 1;
    const resolved = normalizePath(input);
    const digest = canonicalStore.hash(resolved.projectPath);
    const cached = jsonLinesCache.get(resolved.projectPath);
    if (cached?.sha256 === digest) {
      counters.parsed_cache_hits += 1;
      return cached.value;
    }
    counters.parsed_cache_misses += 1;
    const raw = canonicalStore.readText(resolved.projectPath);
    const records = [];
    for (const [index, line] of raw.split(/\r?\n/u).entries()) {
      if (!line.trim()) continue;
      counters.json_line_parses += 1;
      try {
        records.push(Object.freeze({
          path: resolved.projectPath,
          line: index + 1,
          valid: true,
          value: immutableJson(JSON.parse(line)),
          error: null,
        }));
      } catch {
        records.push(Object.freeze({
          path: resolved.projectPath,
          line: index + 1,
          valid: false,
          value: null,
          error: Object.freeze({
            code: "invalid_json",
            message: `Invalid JSON at ${resolved.projectPath}:${index + 1}`,
          }),
        }));
      }
    }
    assertDigestUnchanged(resolved, digest);
    const value = Object.freeze(records);
    jsonLinesCache.set(resolved.projectPath, {
      path: resolved.projectPath,
      sha256: digest,
      value,
    });
    return value;
  };

  const jsonRecords = ({ under = ".", onInvalid = "throw", includeDerived = false } = {}) => {
    if (!["throw", "skip", "include"].includes(onInvalid)) {
      throw new TypeError("jsonRecords onInvalid must be throw, skip, or include");
    }
    const records = [];
    for (const file of listFiles({ under, extensions: [".json"], includeDerived })) {
      try {
        records.push(Object.freeze({ path: file.path, valid: true, value: readJson(file.path), error: null }));
      } catch (error) {
        if (!(error instanceof CanonicalStoreError) || error.code !== "invalid_json" || onInvalid === "throw") {
          throw error;
        }
        if (onInvalid === "include") {
          records.push(Object.freeze({
            path: file.path,
            valid: false,
            value: null,
            error: Object.freeze({ code: error.code, message: error.message }),
          }));
        }
      }
    }
    return Object.freeze(records);
  };

  const stories = () => {
    const storiesRoot = normalizePath("stories", "stories root").projectPath;
    const prefix = `${storiesRoot}/`;
    const records = listFiles({ under: "stories", extensions: [".json"], names: ["story.json"] })
      .filter((file) => {
        const relative = file.path.slice(prefix.length);
        return relative.split("/").length === 2;
      })
      .map((file) => readJson(file.path))
      .sort((left, right) => comparePortableStrings(String(left.id || ""), String(right.id || "")));
    return Object.freeze(records);
  };

  const traceEvents = ({ storyId = null, includeInvalid = true } = {}) => {
    if (storyId !== null) assertSafeRecordId(storyId, "storyId");
    const files = listFiles({ under: "traces", extensions: [".jsonl"] })
      .filter((file) => storyId === null || file.basename === `${storyId}.jsonl`);
    const events = [];
    for (const file of files) {
      for (const record of readJsonLines(file.path)) {
        const source = Object.freeze({ path: record.path, line: record.line });
        if (!record.valid || !isPlainRecord(record.value)) {
          if (includeInvalid) {
            events.push(immutableJson({
              type: "invalid",
              source,
              error: record.error || {
                code: "invalid_record",
                message: `JSONL value at ${record.path}:${record.line} is not an object`,
              },
            }));
          }
          continue;
        }
        events.push(immutableJson({ ...record.value, source }));
      }
    }
    return Object.freeze(events);
  };

  const sourceSnapshot = ({
    under = ["."],
    extensions = null,
    exclude = [],
    includeDerived = false,
  } = {}) => {
    counters.source_snapshots += 1;
    const roots = normalizeStringList(under, "under");
    const excluded = normalizeStringList(exclude, "exclude").map(
      (item) => normalizePath(item, "excluded path").projectPath,
    );
    const filesByPath = new Map();
    for (const sourceRoot of roots) {
      for (const file of listFiles({ under: sourceRoot, extensions, includeDerived })) {
        if (excluded.some((prefix) => file.path === prefix || file.path.startsWith(`${prefix}/`))) continue;
        filesByPath.set(file.path, file);
      }
    }
    const files = [...filesByPath.values()].sort((left, right) => comparePortableStrings(left.path, right.path));
    const sourceHashes = {};
    for (const file of files) sourceHashes[file.path] = canonicalStore.hash(file.path);
    const snapshot = immutableJson({
      canonical_root: canonicalBoundary.projectPath,
      source_paths: files.map((file) => file.path),
      source_hashes: sourceHashes,
    });
    emit("source_snapshot", { files: files.length });
    return snapshot;
  };

  const hash = (input) => canonicalStore.hash(normalizePath(input).projectPath);

  const invalidate = (input = null) => {
    counters.invalidations += 1;
    const resolved = input === null || input === undefined ? null : normalizePath(input);
    const target = resolved?.projectPath || null;
    const storeEntriesEvicted = canonicalStore.invalidate(target);
    let parsedEntriesEvicted = 0;
    for (const cache of [textCache, jsonCache, jsonLinesCache]) {
      for (const [key, entry] of [...cache.entries()]) {
        if (target === null || pathMatchesPrefix(entry.path, target)) {
          cache.delete(key);
          parsedEntriesEvicted += 1;
        }
      }
    }
    counters.parsed_entries_evicted += parsedEntriesEvicted;
    const indexInvalidated = catalogCache !== null;
    catalogCache = null;
    emit("invalidate", {
      path: target,
      store_entries_evicted: storeEntriesEvicted,
      parsed_entries_evicted: parsedEntriesEvicted,
      index_invalidated: indexInvalidated,
    });
    return Object.freeze({
      path: target,
      store_entries_evicted: storeEntriesEvicted,
      parsed_entries_evicted: parsedEntriesEvicted,
      index_invalidated: indexInvalidated,
    });
  };

  const metrics = () => Object.freeze({
    ...counters,
    catalog_generation: catalogGeneration,
    catalog_cached: catalogCache !== null,
    parsed_cache_entries: textCache.size + jsonCache.size + jsonLinesCache.size,
    store: canonicalStore.metrics(),
  });

  return Object.freeze({
    root: rootPath,
    canonicalRoot: canonicalBoundary.projectPath,
    catalog: buildCatalog,
    listFiles,
    readText,
    readTextAtHash,
    readJson,
    readJsonLines,
    jsonRecords,
    stories,
    traceEvents,
    sourceSnapshot,
    hash,
    invalidate,
    metrics,
  });
}

function assertCanonicalStore(store, rootPath) {
  const methods = ["readText", "readJson", "hash", "walk", "invalidate", "metrics"];
  if (!store || methods.some((method) => typeof store[method] !== "function")) {
    throw new TypeError("Canonical query session store must implement the canonical-store API");
  }
  if (path.resolve(String(store.root)) !== rootPath) {
    throw new TypeError("Canonical query session store root must match the session root");
  }
}

function normalizeProjectPath(rootPath, canonicalBoundary, input, options) {
  if (typeof input !== "string" || input.trim() === "") {
    throw new TypeError(`Canonical query ${options.label} must be a non-empty string`);
  }
  const raw = input.trim();
  if (raw.includes("\u0000")) {
    throw new TypeError(`Canonical query ${options.label} cannot contain NUL bytes`);
  }
  if (path.win32.isAbsolute(raw) && !path.isAbsolute(raw)) {
    throw new CanonicalStoreError("path_outside_root", `Canonical query path is outside the project root: ${raw}`);
  }
  const portable = raw.replaceAll("\\", "/");
  let absolute;
  if (path.isAbsolute(raw)) {
    absolute = path.resolve(raw);
  } else if (
    canonicalBoundary
    && options.allowCanonicalRelative
    && !isProjectRelativeToBoundary(portable, canonicalBoundary.projectPath)
  ) {
    absolute = path.resolve(canonicalBoundary.absolute, portable);
  } else {
    absolute = path.resolve(rootPath, portable);
  }
  if (!isInsidePath(rootPath, absolute)) {
    throw new CanonicalStoreError("path_outside_root", `Canonical query path is outside the project root: ${raw}`);
  }
  if (canonicalBoundary && !isInsidePath(canonicalBoundary.absolute, absolute)) {
    throw new CanonicalStoreError(
      "path_outside_canonical_root",
      `Canonical query path is outside ${canonicalBoundary.projectPath}: ${raw}`,
    );
  }
  return Object.freeze({
    absolute,
    projectPath: portableRelative(rootPath, absolute),
    canonicalPath: canonicalBoundary ? portableRelative(canonicalBoundary.absolute, absolute) : ".",
  });
}

function isProjectRelativeToBoundary(input, boundary) {
  const normalized = input.replace(/^\.\//u, "").replace(/\/$/u, "");
  return normalized === boundary || normalized.startsWith(`${boundary}/`);
}

function fileDescriptor(resolved, isDerivedPath) {
  const extension = path.posix.extname(resolved.projectPath).toLowerCase();
  return Object.freeze({
    path: resolved.projectPath,
    canonical_path: resolved.canonicalPath,
    directory: path.posix.dirname(resolved.projectPath),
    basename: path.posix.basename(resolved.projectPath),
    extension,
    kind: extension === ".json" ? "json" : extension === ".jsonl" ? "jsonl" : "file",
    derived: isDerivedPath(resolved.projectPath),
  });
}

function normalizeStringList(value, label) {
  const values = Array.isArray(value) ? value : [value];
  if (values.length === 0) return [];
  return [...new Set(values.map((item, index) => {
    if (typeof item !== "string" || item.trim() === "") {
      throw new TypeError(`${label}[${index}] must be a non-empty string`);
    }
    return item.trim();
  }))];
}

function normalizeExtensions(value) {
  if (value === null || value === undefined) return null;
  const extensions = normalizeStringList(value, "extensions").map((extension) => {
    const normalized = extension.toLowerCase();
    return normalized.startsWith(".") ? normalized : `.${normalized}`;
  });
  return new Set(extensions);
}

function normalizeOptionalStringSet(value, label) {
  if (value === null || value === undefined) return null;
  return new Set(normalizeStringList(value, label));
}

function assertSafeRecordId(value, label) {
  if (
    typeof value !== "string"
    || value.trim() === ""
    || value.includes("/")
    || value.includes("\\")
    || value === "."
    || value === ".."
  ) {
    throw new TypeError(`${label} must be one safe record identifier`);
  }
}

function pathMatchesPrefix(candidate, prefix) {
  return candidate === prefix || candidate.startsWith(`${prefix}/`);
}

function portableRelative(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" ? "." : relative.split(path.sep).join("/");
}

function isInsidePath(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function comparePortableStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}
