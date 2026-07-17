#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { discoverBaselineSourcePaths } from "../lib/baseline-source-discovery.mjs";
import { openCanonicalStore } from "../lib/canonical-store.mjs";

export const ENTERPRISE_FOUNDATION_FIXTURE_SCHEMA = "enterprise-foundation-fixture:v1";
export const ENTERPRISE_FOUNDATION_BENCHMARK_SCHEMA = "enterprise-foundation-benchmark:v1";
export const ENTERPRISE_FOUNDATION_FIXED_SEED = 0x5d1c2026;
export const ENTERPRISE_FOUNDATION_FIXED_TIMESTAMP = "2026-01-01T00:00:00.000Z";

export const ENTERPRISE_FOUNDATION_DEFAULT_SCALE = Object.freeze({
  source_files: 1_000,
  stories: 1_000,
  records: 10_000,
  dependency_edges: 5_000,
  trace_events: 100_000,
});

const RECORDS_PER_SHARD = 250;
const SOURCE_EXTENSIONS = Object.freeze([".mjs", ".js", ".ts", ".py"]);
const DEFAULT_WARM_ITERATIONS = 50;

export function createEnterpriseFoundationFixture(options = {}) {
  const parentDirectory = path.resolve(String(options.parentDirectory || os.tmpdir()));
  fs.mkdirSync(parentDirectory, { recursive: true });
  const root = fs.mkdtempSync(path.join(parentDirectory, "agentic-sdlc-enterprise-"));
  let cleanedUp = false;

  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  };

  try {
    const scale = normalizeScale(options.scale);
    const seed = normalizeSeed(options.seed);
    const timestamp = normalizeTimestamp(options.timestamp);
    const widths = {
      source: identifierWidth(scale.source_files),
      story: identifierWidth(scale.stories),
      record: identifierWidth(scale.records),
      edge: identifierWidth(scale.dependency_edges),
      trace: identifierWidth(scale.trace_events),
    };
    const recordShardCount = Math.ceil(scale.records / RECORDS_PER_SHARD);
    const traceFileCount = Math.min(scale.stories, scale.trace_events);

    writeSourceFiles(root, scale.source_files, seed, widths.source);
    writeProjectRecord(root, timestamp);
    writeStoryRecords(root, scale.stories, seed, timestamp, widths.story);
    writeRecordShards(root, scale, seed, timestamp, widths);
    writeDependencyGraph(root, scale, seed, timestamp, widths);
    writeTraceFiles(root, scale, seed, timestamp, widths);

    const targetStoryIndex = 0;
    const targetRecordIndex = Math.floor(scale.records / 2);
    const targetRecordShard = Math.floor(targetRecordIndex / RECORDS_PER_SHARD);
    const manifest = Object.freeze({
      schema_version: ENTERPRISE_FOUNDATION_FIXTURE_SCHEMA,
      seed,
      generated_at: timestamp,
      scale,
      layout: Object.freeze({
        source_root: "src",
        canonical_root: ".sdlc",
        stories_root: ".sdlc/stories",
        records_root: ".sdlc/work-items",
        dependencies_path: ".sdlc/dependencies/graph.json",
        traces_root: ".sdlc/traces",
        records_per_shard: RECORDS_PER_SHARD,
      }),
      file_counts: Object.freeze({
        source_files: scale.source_files,
        story_files: scale.stories,
        record_shards: recordShardCount,
        dependency_files: 1,
        trace_files: traceFileCount,
        canonical_files: 2 + scale.stories + recordShardCount + traceFileCount,
      }),
      query_targets: Object.freeze({
        story_id: storyId(targetStoryIndex, widths.story),
        story_path: `.sdlc/stories/${storyId(targetStoryIndex, widths.story)}/story.json`,
        record_id: recordId(targetRecordIndex, widths.record),
        record_shard_path: `.sdlc/work-items/records-${pad(targetRecordShard, 6)}.jsonl`,
        dependency_path: ".sdlc/dependencies/graph.json",
        trace_path: `.sdlc/traces/${storyId(targetStoryIndex, widths.story)}.jsonl`,
      }),
    });

    writeJson(path.join(root, "fixture-manifest.json"), manifest);

    return Object.freeze({
      root,
      manifest,
      cleanup,
    });
  } catch (error) {
    cleanup();
    throw error;
  }
}

export function runFoundationBenchmark(options = {}) {
  assertSupportedNodeRuntime();
  const warmIterations = positiveInteger(
    options.warmIterations,
    DEFAULT_WARM_ITERATIONS,
    "warmIterations",
  );
  const generation = measure(() => createEnterpriseFoundationFixture(options));
  const fixture = generation.value;
  const thresholds = platformThresholds(process.platform);
  let result;

  try {
    const sourceDiscovery = measure(() => discoverBaselineSourcePaths({
      projectRoot: fixture.root,
      requestedPaths: [fixture.manifest.layout.source_root],
      policy: {
        max_discovered_files: fixture.manifest.scale.source_files,
      },
    }));

    const store = openCanonicalStore({ root: fixture.root });
    const canonicalQuery = measure(() => runCanonicalQuery(store, fixture.manifest));
    const warmRead = measure(() => runWarmRead(store, fixture.manifest, warmIterations));
    const memory = memorySnapshot();
    const countsComplete = sourceDiscovery.value.discovered_count === fixture.manifest.scale.source_files
      && canonicalQuery.value.stories === fixture.manifest.scale.stories
      && canonicalQuery.value.records === fixture.manifest.scale.records
      && canonicalQuery.value.dependency_edges === fixture.manifest.scale.dependency_edges
      && canonicalQuery.value.trace_events === fixture.manifest.scale.trace_events;
    const queryWithinBudget = canonicalQuery.duration_ms <= thresholds.query_ms;
    const warmReadWithinBudget = warmRead.duration_ms <= thresholds.warm_read_ms;
    const rssWithinBudget = memory.max_rss_bytes <= thresholds.rss_bytes;

    result = {
      schema_version: ENTERPRISE_FOUNDATION_BENCHMARK_SCHEMA,
      ok: true,
      deterministic_workload: true,
      platform: {
        os: process.platform,
        arch: process.arch,
        node: process.versions.node,
      },
      fixture: {
        schema_version: fixture.manifest.schema_version,
        seed: fixture.manifest.seed,
        timestamp: fixture.manifest.generated_at,
        scale: fixture.manifest.scale,
        file_counts: fixture.manifest.file_counts,
        generation_ms: generation.duration_ms,
        cleanup: "pending",
      },
      workloads: {
        source_discovery: {
          duration_ms: sourceDiscovery.duration_ms,
          discovered_files: sourceDiscovery.value.discovered_count,
          excluded_entries: sourceDiscovery.value.excluded.length,
          truncated: sourceDiscovery.value.truncated,
        },
        canonical_query: {
          duration_ms: canonicalQuery.duration_ms,
          ...canonicalQuery.value,
        },
        warm_canonical_read: {
          duration_ms: warmRead.duration_ms,
          ...warmRead.value,
        },
      },
      store_metrics: store.metrics(),
      memory,
      thresholds,
      evaluation: {
        counts_complete: countsComplete,
        query_within_budget: queryWithinBudget,
        warm_read_within_budget: warmReadWithinBudget,
        rss_within_budget: rssWithinBudget,
        passed: countsComplete && queryWithinBudget && warmReadWithinBudget && rssWithinBudget,
      },
    };
  } finally {
    fixture.cleanup();
  }

  result.fixture.cleanup = fs.existsSync(fixture.root) ? "failed" : "completed";
  if (result.fixture.cleanup !== "completed") {
    result.ok = false;
    result.evaluation.passed = false;
  }
  return result;
}

function runCanonicalQuery(store, manifest) {
  const storyPaths = store.walk(manifest.layout.stories_root)
    .map((filePath) => portableRelative(store.root, filePath))
    .filter((filePath) => filePath.endsWith("/story.json"));
  const storyStatuses = {};
  for (const storyPath of storyPaths) {
    const story = store.readJson(storyPath);
    storyStatuses[story.status] = (storyStatuses[story.status] || 0) + 1;
  }

  let recordCount = 0;
  let targetRecordFound = false;
  for (const filePath of store.walk(manifest.layout.records_root)) {
    forEachJsonLine(store.readText(portableRelative(store.root, filePath)), (record) => {
      recordCount += 1;
      if (record.id === manifest.query_targets.record_id) targetRecordFound = true;
    });
  }

  const dependencyGraph = store.readJson(manifest.query_targets.dependency_path);
  let traceCount = 0;
  let targetStoryTraceCount = 0;
  for (const filePath of store.walk(manifest.layout.traces_root)) {
    forEachJsonLine(store.readText(portableRelative(store.root, filePath)), (event) => {
      traceCount += 1;
      if (event.story_id === manifest.query_targets.story_id) targetStoryTraceCount += 1;
    });
  }

  const targetStory = store.readJson(manifest.query_targets.story_path);
  return {
    canonical_files: store.walk(manifest.layout.canonical_root).length,
    stories: storyPaths.length,
    story_statuses: storyStatuses,
    records: recordCount,
    dependency_edges: Array.isArray(dependencyGraph.edges) ? dependencyGraph.edges.length : 0,
    trace_events: traceCount,
    target_story_id: targetStory.id,
    target_story_trace_events: targetStoryTraceCount,
    target_record_found: targetRecordFound,
  };
}

function runWarmRead(store, manifest, iterations) {
  let digest = null;
  let traceBytes = 0;
  for (let index = 0; index < iterations; index += 1) {
    const story = store.readJson(manifest.query_targets.story_path);
    if (story.id !== manifest.query_targets.story_id) {
      throw new Error("Warm canonical read returned a different story");
    }
    digest = store.hash(manifest.query_targets.story_path);
    traceBytes += Buffer.byteLength(store.readText(manifest.query_targets.trace_path));
  }
  return {
    iterations,
    digest,
    trace_bytes_observed: traceBytes,
  };
}

function measure(callback) {
  const startedAt = performance.now();
  const value = callback();
  return {
    duration_ms: roundMilliseconds(performance.now() - startedAt),
    value,
  };
}

function memorySnapshot() {
  const memory = process.memoryUsage();
  const resourceUsage = typeof process.resourceUsage === "function" ? process.resourceUsage() : null;
  const resourceMax = Number(resourceUsage?.maxRSS || 0) * 1024;
  return {
    rss_bytes: memory.rss,
    heap_used_bytes: memory.heapUsed,
    max_rss_bytes: Math.max(memory.rss, resourceMax),
  };
}

function platformThresholds(platform) {
  const windows = platform === "win32";
  return {
    query_ms: windows ? 4_000 : 2_000,
    warm_read_ms: windows ? 250 : 100,
    rss_bytes: (windows ? 320 : 256) * 1024 * 1024,
  };
}

function normalizeScale(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const normalized = {};
  for (const [key, fallback] of Object.entries(ENTERPRISE_FOUNDATION_DEFAULT_SCALE)) {
    normalized[key] = positiveInteger(source[key], fallback, `scale.${key}`);
  }
  return Object.freeze(normalized);
}

function normalizeSeed(value) {
  const seed = value === undefined || value === null
    ? ENTERPRISE_FOUNDATION_FIXED_SEED
    : Number(value);
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
    throw new TypeError("seed must be an integer between 0 and 4294967295");
  }
  return seed >>> 0;
}

function normalizeTimestamp(value) {
  const input = value === undefined || value === null
    ? ENTERPRISE_FOUNDATION_FIXED_TIMESTAMP
    : String(value);
  const parsed = Date.parse(input);
  if (!Number.isFinite(parsed)) throw new TypeError("timestamp must be an ISO-8601 instant");
  return new Date(parsed).toISOString();
}

function positiveInteger(value, fallback, label) {
  const normalized = value === undefined || value === null ? fallback : Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 1) {
    throw new TypeError(`${label} must be a positive integer`);
  }
  return normalized;
}

function writeSourceFiles(root, count, seed, width) {
  for (let index = 0; index < count; index += 1) {
    const extension = SOURCE_EXTENSIONS[index % SOURCE_EXTENSIONS.length];
    const shard = pad(Math.floor(index / 100), 4);
    const name = `module-${pad(index, width)}${extension}`;
    const relativePath = path.join("src", `shard-${shard}`, name);
    const value = deterministicNumber(seed, index);
    const content = extension === ".py"
      ? `FIXTURE_VALUE_${pad(index, width)} = ${value}\n`
      : `export const fixtureValue${pad(index, width)} = ${value};\n`;
    writeText(path.join(root, relativePath), content);
  }
}

function writeProjectRecord(root, timestamp) {
  writeJson(path.join(root, ".sdlc", "project.json"), {
    schema_version: "0.1.0",
    project_id: "enterprise-foundation-fixture",
    project_name: "Enterprise Foundation Fixture",
    created_at: timestamp,
  });
}

function writeStoryRecords(root, count, seed, timestamp, width) {
  const statuses = ["draft", "ready", "in_progress", "blocked"];
  const phases = ["analysis", "design", "implementation", "validation"];
  for (let index = 0; index < count; index += 1) {
    const id = storyId(index, width);
    const createdAt = timestampAt(timestamp, index);
    writeJson(path.join(root, ".sdlc", "stories", id, "story.json"), {
      id,
      schema_version: "0.1.0",
      title: `Enterprise fixture story ${pad(index, width)}`,
      status: statuses[deterministicNumber(seed, index) % statuses.length],
      phase: phases[deterministicNumber(seed, index + count) % phases.length],
      contract_id: `contract-${id}-implementation`,
      acceptance_criteria: [`Fixture acceptance ${pad(index, width)}`],
      links: {
        requirements: [`REQ-${pad(index % 100, 4)}`],
        decisions: [],
        tests: [],
      },
      created_at: createdAt,
      updated_at: createdAt,
    });
  }
}

function writeRecordShards(root, scale, seed, timestamp, widths) {
  const shardCount = Math.ceil(scale.records / RECORDS_PER_SHARD);
  for (let shard = 0; shard < shardCount; shard += 1) {
    const start = shard * RECORDS_PER_SHARD;
    const end = Math.min(start + RECORDS_PER_SHARD, scale.records);
    const target = path.join(root, ".sdlc", "work-items", `records-${pad(shard, 6)}.jsonl`);
    writeJsonLines(target, start, end, (index) => ({
      id: recordId(index, widths.record),
      schema_version: "enterprise-record:v1",
      kind: "work_item",
      command_scope: `command-${pad(index % 32, 3)}`,
      story_id: storyId(index % scale.stories, widths.story),
      sequence: index,
      value: deterministicNumber(seed, index + 0x10_000),
      created_at: timestampAt(timestamp, 200_000 + index),
    }));
  }
}

function writeDependencyGraph(root, scale, seed, timestamp, widths) {
  const edges = [];
  for (let index = 0; index < scale.dependency_edges; index += 1) {
    const fromIndex = index % scale.stories;
    const offset = scale.stories === 1
      ? 0
      : 1 + (deterministicNumber(seed, index + 0x20_000) % (scale.stories - 1));
    const toIndex = (fromIndex + offset) % scale.stories;
    edges.push({
      id: `EDGE-${pad(index, widths.edge)}`,
      from: storyId(fromIndex, widths.story),
      to: storyId(toIndex, widths.story),
      type: index % 2 === 0 ? "requires_artifact" : "depends_on",
      blocks: "implementation",
      required_state: "artifact_linked",
    });
  }
  writeJson(path.join(root, ".sdlc", "dependencies", "graph.json"), {
    id: "DEP-ENTERPRISE-FIXTURE",
    schema_version: "dependency-graph:v1",
    status: "approved",
    edges,
    created_at: timestampAt(timestamp, 400_000),
  });
}

function writeTraceFiles(root, scale, seed, timestamp, widths) {
  const fileCount = Math.min(scale.stories, scale.trace_events);
  const eventsPerFile = Math.floor(scale.trace_events / fileCount);
  const filesWithExtraEvent = scale.trace_events % fileCount;
  let eventIndex = 0;
  for (let storyIndex = 0; storyIndex < fileCount; storyIndex += 1) {
    const count = eventsPerFile + (storyIndex < filesWithExtraEvent ? 1 : 0);
    const start = eventIndex;
    const end = start + count;
    const id = storyId(storyIndex, widths.story);
    const target = path.join(root, ".sdlc", "traces", `${id}.jsonl`);
    writeJsonLines(target, start, end, (index) => ({
      id: `TR-${pad(index, widths.trace)}`,
      story_id: id,
      type: index % 5 === 0 ? "test" : "implementation",
      outcome: index % 5 === 0 ? "passed" : null,
      summary: `Deterministic trace event ${pad(index, widths.trace)}`,
      correlation_id: `corr-${pad(deterministicNumber(seed, index + 0x30_000), 10)}`,
      created_at: timestampAt(timestamp, 500_000 + index),
    }));
    eventIndex = end;
  }
}

function writeJson(filePath, value) {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeJsonLines(filePath, start, end, createRecord) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const descriptor = fs.openSync(filePath, "w");
  let buffer = "";
  try {
    for (let index = start; index < end; index += 1) {
      buffer += `${JSON.stringify(createRecord(index))}\n`;
      if (buffer.length >= 256 * 1024) {
        fs.writeSync(descriptor, buffer, undefined, "utf8");
        buffer = "";
      }
    }
    if (buffer) fs.writeSync(descriptor, buffer, undefined, "utf8");
  } finally {
    fs.closeSync(descriptor);
  }
}

function writeText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, "utf8");
}

function forEachJsonLine(value, callback) {
  for (const line of value.split("\n")) {
    if (line) callback(JSON.parse(line));
  }
}

function portableRelative(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join("/");
}

function storyId(index, width) {
  return `ST-ENT-${pad(index, width)}`;
}

function recordId(index, width) {
  return `REC-${pad(index, width)}`;
}

function identifierWidth(count) {
  return Math.max(6, String(Math.max(0, count - 1)).length);
}

function pad(value, width) {
  return String(value).padStart(width, "0");
}

function timestampAt(origin, offsetMilliseconds) {
  return new Date(Date.parse(origin) + offsetMilliseconds).toISOString();
}

function deterministicNumber(seed, index) {
  let value = (seed ^ Math.imul(index + 1, 0x9e37_79b1)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb_352d) >>> 0;
  value ^= value >>> 15;
  value = Math.imul(value, 0x846c_a68b) >>> 0;
  value ^= value >>> 16;
  return value >>> 0;
}

function roundMilliseconds(value) {
  return Number(value.toFixed(3));
}

function assertSupportedNodeRuntime() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 18 || (major === 18 && minor < 18)) {
    throw new Error(`Node.js 18.18 or newer is required; found ${process.versions.node}`);
  }
}

function parseArguments(argv) {
  const options = { scale: {} };
  const scaleFlags = new Map([
    ["--source-files", "source_files"],
    ["--stories", "stories"],
    ["--records", "records"],
    ["--dependency-edges", "dependency_edges"],
    ["--trace-events", "trace_events"],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (scaleFlags.has(flag)) {
      options.scale[scaleFlags.get(flag)] = requiredArgument(argv, ++index, flag);
    } else if (flag === "--seed") {
      options.seed = requiredArgument(argv, ++index, flag);
    } else if (flag === "--timestamp") {
      options.timestamp = requiredArgument(argv, ++index, flag);
    } else if (flag === "--warm-iterations") {
      options.warmIterations = requiredArgument(argv, ++index, flag);
    } else if (flag === "--enforce") {
      options.enforce = true;
    } else {
      throw new TypeError(`Unknown benchmark option: ${flag}`);
    }
  }
  return options;
}

function requiredArgument(argv, index, flag) {
  const value = argv[index];
  if (value === undefined || value.startsWith("--")) {
    throw new TypeError(`${flag} requires a value`);
  }
  return value;
}

function writeResult(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function errorEnvelope(error) {
  return {
    schema_version: ENTERPRISE_FOUNDATION_BENCHMARK_SCHEMA,
    ok: false,
    error: {
      code: "benchmark_failed",
      message: error instanceof Error ? error.message : String(error),
    },
  };
}

function isMainModule() {
  return process.argv[1]
    ? path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
    : false;
}

if (isMainModule()) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const result = runFoundationBenchmark(options);
    writeResult(result);
    if (options.enforce && !result.evaluation.passed) process.exitCode = 1;
  } catch (error) {
    writeResult(errorEnvelope(error));
    process.exitCode = 1;
  }
}
