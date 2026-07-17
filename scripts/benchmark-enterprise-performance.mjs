#!/usr/bin/env node

import fs from "node:fs";
import crypto from "node:crypto";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import {
  ENTERPRISE_FOUNDATION_DEFAULT_SCALE,
  createEnterpriseFoundationFixture,
} from "./benchmark-foundation.mjs";
import { discoverBaselineSourcePaths } from "../lib/baseline-source-discovery.mjs";

export const ENTERPRISE_PERFORMANCE_BENCHMARK_SCHEMA = "enterprise-performance-benchmark:v1";
export const ENTERPRISE_CANONICAL_QUERY_WORKER_SCHEMA = "enterprise-performance-canonical-query-worker:v1";
export const ENTERPRISE_OBSERVATORY_WORKER_SCHEMA = "enterprise-performance-observatory-worker:v1";
export const ENTERPRISE_OBSERVATORY_MODEL_VERIFIER_SCHEMA = "enterprise-performance-observatory-model-verifier:v1";

const DEFAULT_WARM_ITERATIONS = 50;
const DEFAULT_WORKER_TIMEOUT_MS = 120_000;
const CHILD_TERMINATION_TIMEOUT_MS = 2_000;
const MAX_WORKER_OUTPUT_BYTES = 1024 * 1024;
const MAX_COLD_MODEL_BYTES = 64 * 1024 * 1024;
const CANONICAL_QUERY_WORKER_FLAG = "--internal-canonical-query-worker";
const OBSERVATORY_WORKER_FLAG = "--internal-observatory-worker";
const OBSERVATORY_MODEL_VERIFIER_FLAG = "--internal-observatory-model-verifier";
const LOOPBACK_HOST = "127.0.0.1";
const OBSERVATORY_ACCESS_TOKEN = "enterprise_performance_benchmark_token_2026";
const OBSERVATORY_ETAG_PATTERN = /^"sha256-[A-Za-z0-9_-]{43}"$/u;
const OBSERVATORY_SERVER_ROLE = "observatory_server";
const OBSERVATORY_MEMORY_SCOPE = "observatory_server_process_only";
const OBSERVATORY_LOAD_DRIVER_ROLE = "benchmark_parent_load_driver";
const OBSERVATORY_READY_MESSAGE = "ready";
const OBSERVATORY_CAPTURE_MESSAGE = "capture-memory";
const OBSERVATORY_CAPTURED_MESSAGE = "memory-captured";
const OBSERVATORY_SNAPSHOT_MESSAGE = "snapshot-and-close";
const OBSERVATORY_COMPLETE_MESSAGE = "complete";
const OBSERVATORY_ERROR_MESSAGE = "error";
const BENCHMARK_TERMINATION_SIGNALS = Object.freeze(["SIGINT", "SIGTERM"]);
const SIGNAL_EXIT_CODES = Object.freeze({ SIGINT: 130, SIGTERM: 143 });
const benchmarkSignalCoordinator = createBenchmarkSignalCoordinator();

function createBenchmarkProcessGuard() {
  const activeChildren = new Set();
  let fixtureCleanup = null;
  let disposed = false;
  let terminatingSignal = null;
  let termination = null;

  const guard = {
    setFixtureCleanup(callback) {
      if (typeof callback !== "function") {
        throw new TypeError("Benchmark fixture cleanup must be a function");
      }
      fixtureCleanup = callback;
    },
    trackChild(child) {
      activeChildren.add(child);
      if (terminatingSignal) void terminateChildAndWait(child);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        activeChildren.delete(child);
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      benchmarkSignalCoordinator.unregister(guard);
    },
    terminateForSignal(signal) {
      terminatingSignal = signal;
      if (termination) return termination;
      termination = (async () => {
        await Promise.allSettled([...activeChildren].map((child) => terminateChildAndWait(child)));
        try {
          fixtureCleanup?.();
        } catch {
          // Preserve the operator signal even if temporary fixture cleanup fails.
        }
      })();
      return termination;
    },
    get signalTermination() {
      return benchmarkSignalCoordinator.signalTermination;
    },
  };

  benchmarkSignalCoordinator.register(guard);
  return guard;
}

function createBenchmarkSignalCoordinator() {
  const guards = new Set();
  let handlersInstalled = false;
  let terminatingSignal = null;
  let signalTermination = null;
  const handlers = new Map(BENCHMARK_TERMINATION_SIGNALS.map((signal) => [
    signal,
    () => beginSignalTermination(signal),
  ]));

  function installHandlers() {
    if (handlersInstalled) return;
    handlersInstalled = true;
    for (const [signal, handler] of handlers) process.on(signal, handler);
  }

  function uninstallHandlers() {
    if (!handlersInstalled) return;
    handlersInstalled = false;
    for (const [signal, handler] of handlers) process.off(signal, handler);
  }

  function beginSignalTermination(signal) {
    if (signalTermination) return;
    terminatingSignal = signal;
    signalTermination = (async () => {
      try {
        while (guards.size > 0) {
          const batch = [...guards];
          await Promise.allSettled(batch.map((guard) => guard.terminateForSignal(signal)));
          for (const guard of batch) guards.delete(guard);
        }
      } finally {
        uninstallHandlers();
        reemitProcessSignal(signal);
      }
      await new Promise(() => {});
    })();
  }

  return {
    register(guard) {
      guards.add(guard);
      installHandlers();
      if (terminatingSignal) void guard.terminateForSignal(terminatingSignal);
    },
    unregister(guard) {
      guards.delete(guard);
      if (guards.size === 0 && !signalTermination) uninstallHandlers();
    },
    get signalTermination() {
      return signalTermination;
    },
  };
}

async function terminateChildAndWait(child, timeoutMs = CHILD_TERMINATION_TIMEOUT_MS) {
  if (!child) return;
  const pid = child.pid;
  if (!Number.isSafeInteger(pid) || pid < 1) {
    destroyChildChannels(child);
    return;
  }

  let closeListener = null;
  const streamsClosed = [child.stdout, child.stderr]
    .every((stream) => !stream || stream.closed === true || stream.destroyed === true);
  const closePromise = (child.exitCode !== null || child.signalCode !== null) && streamsClosed
    ? Promise.resolve()
    : new Promise((resolve) => {
      closeListener = resolve;
      child.once("close", resolve);
    });
  let terminationError = null;
  try {
    await terminateChildProcessTree(child);
  } catch (error) {
    terminationError = error;
  }
  let timer = null;
  await Promise.race([
    closePromise,
    new Promise((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    }),
  ]);
  clearTimeout(timer);
  if (closeListener) child.off("close", closeListener);
  destroyChildChannels(child);
  if (terminationError) throw terminationError;
}

async function terminateChildProcessTree(child) {
  const pid = child?.pid;
  if (!Number.isSafeInteger(pid) || pid < 1) return;
  if (process.platform === "win32") {
    const taskkill = await runBoundedProcess(
      "taskkill.exe",
      ["/PID", String(pid), "/T", "/F"],
      CHILD_TERMINATION_TIMEOUT_MS,
    );
    if (taskkill.ok) return;
    const powershellScript = "$ErrorActionPreference = 'Stop'; "
      + `$targetPid = ${pid}; `
      + "$all = Get-CimInstance Win32_Process; "
      + "function Stop-Tree([int]$id) { "
      + "$all | Where-Object { $_.ParentProcessId -eq $id } "
      + "| ForEach-Object { Stop-Tree $_.ProcessId }; "
      + "Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }; "
      + "Stop-Tree $targetPid";
    const fallback = await runBoundedProcess(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", powershellScript],
      CHILD_TERMINATION_TIMEOUT_MS,
    );
    if (fallback.ok) return;
    try {
      child.kill("SIGKILL");
    } catch {
      // Preserve the tree-kill failure below.
    }
    throw new Error(
      `Unable to terminate Windows process tree ${pid}: taskkill ${taskkill.detail}; PowerShell ${fallback.detail}`,
    );
  }
  try {
    process.kill(-pid, "SIGKILL");
    return;
  } catch {
    // Fall back to the direct process when it was not made a process-group leader.
  }
  try {
    child.kill("SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // The process tree has already exited.
    }
  }
}

function runBoundedProcess(executable, argumentsList, timeoutMs) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(executable, argumentsList, {
        stdio: "ignore",
        windowsHide: true,
      });
    } catch (error) {
      resolve({ ok: false, detail: error.message });
      return;
    }
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };
    const timeout = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // The helper has already exited.
      }
      finish({ ok: false, detail: `timed out after ${timeoutMs}ms` });
    }, timeoutMs);
    child.once("error", (error) => finish({ ok: false, detail: error.message }));
    child.once("close", (code, signal) => finish({
      ok: code === 0 && signal === null,
      detail: signal === null ? `exit ${code}` : `signal ${signal}`,
    }));
  });
}

function destroyChildChannels(child) {
  for (const stream of [child.stdin, child.stdout, child.stderr]) {
    try {
      stream?.destroy();
    } catch {
      // The stream was already closed.
    }
  }
  if (child.connected) {
    try {
      child.disconnect();
    } catch {
      // The IPC channel was already closed.
    }
  }
}

function reemitProcessSignal(signal) {
  if (process.platform === "win32" || process.listenerCount(signal) > 0) {
    process.exit(SIGNAL_EXIT_CODES[signal] ?? 1);
  }
  try {
    process.kill(process.pid, signal);
  } catch {
    process.exit(SIGNAL_EXIT_CODES[signal] ?? 1);
  }
}

export async function runEnterprisePerformanceBenchmark(options = {}) {
  assertSupportedNodeRuntime();
  const warmIterations = positiveInteger(
    options.warmIterations,
    DEFAULT_WARM_ITERATIONS,
    "warmIterations",
  );
  const processGuard = createBenchmarkProcessGuard();
  let generation = null;
  let fixture = null;
  let result;

  try {
    generation = measure(() => createEnterpriseFoundationFixture(options));
    fixture = generation.value;
    processGuard.setFixtureCleanup(fixture.cleanup);
    const fixtureManifestPath = path.join(fixture.root, "fixture-manifest.json");
    const fixtureManifestSha256 = sha256FileHex(fixtureManifestPath);
    const thresholds = platformThresholds(process.platform);
    const canonicalWorker = await runCanonicalQueryWorkerProcess(
      fixture,
      { ...options, fixtureManifestSha256 },
      processGuard,
    );
    const canonicalQuery = canonicalWorker.result;
    const queryMetrics = canonicalQuery.session_metrics;

    const observatoryLimits = {
      maxFiles: Math.max(
        2_048,
        fixture.manifest.file_counts.canonical_files + 16,
      ),
      ...(options.observatoryLimits || {}),
    };
    const observatoryWorker = await runObservatoryWorkerProcess(fixture, {
      ...options,
      warmIterations,
      observatoryLimits,
      fixtureManifestSha256,
    }, processGuard);
    const observatory = observatoryWorker.result;
    const memory = aggregateIsolatedMemory(canonicalQuery.memory, observatory.memory);
    const targetRecordIndex = Math.floor(fixture.manifest.scale.records / 2);
    const targetStoryWidth = Math.max(
      6,
      String(Math.max(0, fixture.manifest.scale.stories - 1)).length,
    );
    const expectedTargetRecordStoryId = `ST-ENT-${String(
      targetRecordIndex % fixture.manifest.scale.stories,
    ).padStart(targetStoryWidth, "0")}`;
    const countsComplete = canonicalQuery.canonical_files
        === fixture.manifest.file_counts.canonical_files
      && canonicalQuery.source_files === fixture.manifest.scale.source_files
      && canonicalQuery.stories === fixture.manifest.scale.stories
      && canonicalQuery.records === fixture.manifest.scale.records
      && canonicalQuery.dependency_edges === fixture.manifest.scale.dependency_edges
      && canonicalQuery.trace_events === fixture.manifest.scale.trace_events
      && canonicalQuery.target_record_found
      && canonicalQuery.target_record?.id === fixture.manifest.query_targets.record_id
      && canonicalQuery.target_record?.path === fixture.manifest.query_targets.record_shard_path
      && canonicalQuery.target_record?.line
        === (targetRecordIndex % fixture.manifest.layout.records_per_shard) + 1
      && canonicalQuery.target_record?.story_id === expectedTargetRecordStoryId
      && canonicalQuery.target_record?.sequence === targetRecordIndex
      && canonicalQuery.target_story_trace_events
        === Math.ceil(fixture.manifest.scale.trace_events / fixture.manifest.file_counts.trace_files)
      && canonicalQuery.manifest_sha256 === fixtureManifestSha256;
    const oneCatalogBuild = queryMetrics.catalog_builds === 1;
    const workloadsIsolated = sequentialWorkersAreIsolated(
      canonicalWorker.process,
      observatoryWorker.process,
      process.pid,
    );
    const conditionalCacheValid = observatory.cold_status === 200
      && observatory.model_bytes > 0
      && typeof observatory.etag === "string"
      && OBSERVATORY_ETAG_PATTERN.test(observatory.etag)
      && observatory.warm_iterations === warmIterations
      && observatory.conditional_hits === warmIterations
      && observatory.conditional_body_bytes === 0
      && observatory.model_validation?.passed === true
      && observatory.model_validation?.manifest_sha256 === fixtureManifestSha256;
    const queryWithinBudget = canonicalQuery.duration_ms <= thresholds.query_ms;
    const warmWithinBudget = observatory.warm_p95_ms <= thresholds.observatory_warm_p95_ms;
    const rssWithinBudget = memory.max_rss_bytes <= thresholds.rss_bytes;

    result = {
      schema_version: ENTERPRISE_PERFORMANCE_BENCHMARK_SCHEMA,
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
        manifest_sha256: fixtureManifestSha256,
        generation_ms: generation.duration_ms,
        cleanup: "pending",
      },
      workloads: {
        canonical_query: {
          ...canonicalQuery,
          process: {
            ...canonicalWorker.process,
            isolated_from_parent: canonicalWorker.process.pid !== process.pid,
          },
        },
        observatory: {
          ...observatory,
          process: {
            ...observatoryWorker.process,
            isolated_from_parent: observatoryWorker.process.pid !== process.pid,
            isolated_from_canonical_query: canonicalWorker.process.terminated,
          },
        },
      },
      memory,
      thresholds,
      evaluation: {
        counts_complete: countsComplete,
        one_catalog_build: oneCatalogBuild,
        workloads_isolated: workloadsIsolated,
        conditional_cache_valid: conditionalCacheValid,
        query_within_budget: queryWithinBudget,
        observatory_warm_within_budget: warmWithinBudget,
        rss_within_budget: rssWithinBudget,
        rss_observed_bytes: memory.max_rss_bytes,
        passed: countsComplete
          && oneCatalogBuild
          && workloadsIsolated
          && conditionalCacheValid
          && queryWithinBudget
          && warmWithinBudget
          && rssWithinBudget,
      },
    };
  } finally {
    try {
      fixture?.cleanup();
    } finally {
      const signalTermination = processGuard.signalTermination;
      if (signalTermination) {
        await signalTermination;
      } else {
        processGuard.dispose();
      }
    }
  }

  result.fixture.cleanup = fs.existsSync(fixture.root) ? "failed" : "completed";
  if (result.fixture.cleanup !== "completed") {
    result.ok = false;
    result.evaluation.passed = false;
  }
  return result;
}

async function runCanonicalQueryWorkerProcess(fixture, options = {}, processGuard = null) {
  return runIsolatedWorkerProcess({
    label: "Canonical query",
    executable: options.canonicalWorkerExecutable || options.workerExecutable,
    scriptPath: options.canonicalWorkerScriptPath || options.workerScriptPath,
    timeoutMs: options.canonicalWorkerTimeoutMs ?? options.workerTimeoutMs,
    timeoutLabel: "canonicalWorkerTimeoutMs",
    argumentsList: [
      CANONICAL_QUERY_WORKER_FLAG,
      "--fixture-root",
      fixture.root,
      "--fixture-manifest",
      path.join(fixture.root, "fixture-manifest.json"),
      "--expected-manifest-sha256",
      options.fixtureManifestSha256,
    ],
    parseEnvelope: parseCanonicalQueryWorkerEnvelope,
    processGuard,
  });
}

function runObservatoryModelVerifierProcess({
  artifactPath,
  fixtureRoot,
  fixtureManifestPath,
  expectedManifestSha256,
  expectedModelBytes,
  expectedModelSha256,
  observatoryLimits,
  executable,
  scriptPath,
  timeoutMs,
  processGuard,
}) {
  return runIsolatedWorkerProcess({
    label: "Observatory model verifier",
    executable,
    scriptPath,
    timeoutMs,
    timeoutLabel: "observatoryModelVerifierTimeoutMs",
    argumentsList: [
      OBSERVATORY_MODEL_VERIFIER_FLAG,
      "--fixture-root",
      fixtureRoot,
      "--fixture-manifest",
      fixtureManifestPath,
      "--expected-manifest-sha256",
      expectedManifestSha256,
      "--model-artifact",
      artifactPath,
      "--expected-model-bytes",
      String(expectedModelBytes),
      "--expected-model-sha256",
      expectedModelSha256,
      "--limits-json",
      JSON.stringify(observatoryLimits),
    ],
    parseEnvelope: parseObservatoryModelVerifierEnvelope,
    processGuard,
  });
}

export function parseObservatoryModelVerifierEnvelope(input) {
  const envelope = typeof input === "string" ? JSON.parse(input) : input;
  if (!isOracleObject(envelope)) {
    throw new TypeError("Observatory model verifier envelope must be an object");
  }
  if (envelope.schema_version !== ENTERPRISE_OBSERVATORY_MODEL_VERIFIER_SCHEMA) {
    throw new TypeError("Observatory model verifier returned an unsupported schema version");
  }
  if (envelope.ok !== true || envelope.workload !== "observatory_model_verification") {
    throw new TypeError("Observatory model verifier did not return a successful result");
  }
  validateWorkerProcess(envelope.process, "Observatory model verifier");
  const result = envelope.result;
  if (!isOracleObject(result) || result.passed !== true) {
    throw new TypeError("Observatory model verifier omitted its successful result");
  }
  if (!/^[a-f0-9]{64}$/u.test(result.manifest_sha256)) {
    throw new TypeError("Observatory model verifier returned an invalid manifest SHA-256");
  }
  if (
    !isOracleObject(result.artifact)
    || !Number.isSafeInteger(result.artifact.size_bytes)
    || result.artifact.size_bytes < 1
    || !/^[A-Za-z0-9_-]{43}$/u.test(result.artifact.sha256_base64url)
    || result.artifact.max_bytes !== MAX_COLD_MODEL_BYTES
  ) {
    throw new TypeError("Observatory model verifier returned invalid artifact integrity metadata");
  }
  return envelope;
}

function runObservatoryWorkerProcess(fixture, options = {}, processGuard = null) {
  const diagnosticMemoryTimeline = options.diagnosticMemoryTimeline === true
    || options.diagnosticForceGc === true;
  const diagnosticForceGc = options.diagnosticForceGc === true;
  const memoryDiagnostics = diagnosticMemoryTimeline
    ? { enabled: true, forceGc: diagnosticForceGc }
    : null;
  const argumentsList = [
    OBSERVATORY_WORKER_FLAG,
    "--fixture-root",
    fixture.root,
    "--fixture-manifest",
    path.join(fixture.root, "fixture-manifest.json"),
    "--expected-manifest-sha256",
    options.fixtureManifestSha256,
    "--limits-json",
    JSON.stringify(options.observatoryLimits),
  ];
  if (memoryDiagnostics) {
    argumentsList.push(
      "--memory-diagnostics-json",
      JSON.stringify(memoryDiagnostics),
    );
  }

  const resolvedExecutable = path.resolve(String(
    options.observatoryWorkerExecutable || process.execPath,
  ));
  const resolvedScriptPath = path.resolve(String(
    options.observatoryWorkerScriptPath || fileURLToPath(import.meta.url),
  ));
  const resolvedTimeoutMs = positiveInteger(
    options.observatoryWorkerTimeoutMs,
    DEFAULT_WORKER_TIMEOUT_MS,
    "observatoryWorkerTimeoutMs",
  );
  const sentinelBytes = nonNegativeInteger(
    options.loadDriverMemorySentinelBytes,
    0,
    "loadDriverMemorySentinelBytes",
  );
  const spawnArguments = [
    ...(diagnosticForceGc ? ["--expose-gc"] : []),
    resolvedScriptPath,
    ...argumentsList,
  ];

  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    let child;
    try {
      child = spawn(resolvedExecutable, spawnArguments, {
        cwd: process.cwd(),
        detached: process.platform !== "win32",
        env: process.env,
        stdio: ["ignore", "pipe", "pipe", "ipc"],
        windowsHide: true,
      });
    } catch (error) {
      reject(error);
      return;
    }

    const workerPid = child.pid ?? null;
    const releaseWorker = processGuard?.trackChild(child) ?? (() => {});
    const pendingCaptures = new Map();
    let nextCommandId = 1;
    let readyEnvelope = null;
    let completionEnvelope = null;
    let snapshotCommandId = null;
    let loadResult = null;
    let loadDriverRssBeforeLoadBytes = null;
    let loadDriverRssAfterLoadBytes = null;
    let loadDriverSentinel = null;
    let terminalError = null;
    let ipcError = null;
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let outputOverflow = false;
    let timedOut = false;
    let settled = false;
    let stopping = null;
    let timeout = null;
    let completionExitTimeout = null;
    let protocolState = "awaiting_ready";

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(completionExitTimeout);
      destroyChildChannels(child);
      loadDriverSentinel = null;
      for (const pending of pendingCaptures.values()) pending.reject(value);
      pendingCaptures.clear();
      callback(value);
    };
    const failAndStop = (error) => {
      if (!terminalError) terminalError = error instanceof Error ? error : new Error(String(error));
      protocolState = "terminal";
      stopping ??= terminateChildAndWait(child).catch((terminationError) => {
        terminalError = new Error(
          `${terminalError.message}; process-tree termination failed: ${terminationError.message}`,
          { cause: terminationError },
        );
      });
      void stopping.then(() => {
        if (!settled) {
          releaseWorker();
          finish(reject, terminalError);
        }
      });
    };
    timeout = setTimeout(() => {
      timedOut = true;
      failAndStop(new Error(
        `Observatory server worker timed out after ${resolvedTimeoutMs}ms`,
      ));
    }, resolvedTimeoutMs);
    const appendOutput = (stream, chunk) => {
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > MAX_WORKER_OUTPUT_BYTES) {
        outputOverflow = true;
        failAndStop(new Error("Observatory server worker exceeded the diagnostic output limit"));
        return stream;
      }
      return stream + chunk;
    };
    const captureMemory = (stage, details = {}, forceGc = false) => {
      const commandId = `capture-${nextCommandId}`;
      nextCommandId += 1;
      return sendObservatoryCaptureCommand(child, pendingCaptures, {
        commandId,
        stage,
        details,
        forceGc,
      });
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout = appendOutput(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = appendOutput(stderr, chunk);
    });
    child.once("error", (error) => {
      failAndStop(new Error(`Unable to start Observatory server worker: ${error.message}`, {
        cause: error,
      }));
    });
    child.on("message", (message) => {
      try {
        if (message?.type === OBSERVATORY_READY_MESSAGE) {
          if (protocolState !== "awaiting_ready") {
            throw new Error(`Observatory server worker sent ready while ${protocolState}`);
          }
          readyEnvelope = parseObservatoryServerReadyMessage(message);
          if (workerPid === null || readyEnvelope.process.pid !== workerPid) {
            throw new Error("Observatory server worker ready message reported a different process ID");
          }
          if (readyEnvelope.process.parent_pid !== process.pid) {
            throw new Error(
              "Observatory server worker ready message reported a different parent process ID",
            );
          }

          if (sentinelBytes > 0) loadDriverSentinel = Buffer.alloc(sentinelBytes, 0xa5);
          loadDriverRssBeforeLoadBytes = process.memoryUsage().rss;
          protocolState = "loading";
          void driveObservatoryLoad({
            ready: readyEnvelope,
            warmIterations: options.warmIterations,
            memoryDiagnostics,
            captureMemory,
            fixtureRoot: fixture.root,
            fixtureManifestPath: path.join(fixture.root, "fixture-manifest.json"),
            expectedManifestSha256: options.fixtureManifestSha256,
            observatoryLimits: options.observatoryLimits,
            modelVerifier: {
              executable: options.observatoryModelVerifierExecutable || options.workerExecutable,
              scriptPath: options.observatoryModelVerifierScriptPath,
              timeoutMs: options.observatoryModelVerifierTimeoutMs ?? options.workerTimeoutMs,
              processGuard,
            },
          }).then(async (value) => {
            if (protocolState !== "loading") {
              throw new Error(`Observatory load completed while worker state was ${protocolState}`);
            }
            loadResult = value;
            loadDriverRssAfterLoadBytes = process.memoryUsage().rss;
            protocolState = "load_done";
            snapshotCommandId = `snapshot-${nextCommandId}`;
            protocolState = "snapshot_sent";
            await sendChildIpcMessage(child, {
              schema_version: ENTERPRISE_OBSERVATORY_WORKER_SCHEMA,
              type: OBSERVATORY_SNAPSHOT_MESSAGE,
              command_id: snapshotCommandId,
              expected_requests: options.warmIterations + 1,
              expected_cold_responses: 1,
              expected_conditional_responses: options.warmIterations,
            });
          }).catch(failAndStop);
          return;
        }

        if (message?.type === OBSERVATORY_CAPTURED_MESSAGE) {
          if (protocolState !== "loading") {
            throw new Error(`Observatory memory capture arrived while ${protocolState}`);
          }
          settleObservatoryCapture(pendingCaptures, message);
          return;
        }
        if (message?.type === OBSERVATORY_COMPLETE_MESSAGE) {
          if (protocolState !== "snapshot_sent") {
            throw new Error(`Observatory server worker completed while ${protocolState}`);
          }
          completionEnvelope = parseObservatoryServerCompletionEnvelope(message);
          if (completionEnvelope.command_id !== snapshotCommandId) {
            throw new Error("Observatory server worker completion reported a different command ID");
          }
          if (completionEnvelope.process.pid !== workerPid) {
            throw new Error("Observatory server worker completion reported a different process ID");
          }
          if (completionEnvelope.process.parent_pid !== process.pid) {
            throw new Error(
              "Observatory server worker completion reported a different parent process ID",
            );
          }
          protocolState = "complete_received";
          completionExitTimeout = setTimeout(() => {
            failAndStop(new Error(
              "Observatory server worker did not exit after snapshot completion",
            ));
          }, CHILD_TERMINATION_TIMEOUT_MS);
          return;
        }
        if (message?.type === OBSERVATORY_ERROR_MESSAGE) {
          ipcError = parseObservatoryServerErrorMessage(message);
          failAndStop(new Error(
            `Observatory server worker failed: ${ipcError.error.message}`,
          ));
          return;
        }
        throw new Error("Observatory server worker sent an unsupported IPC message");
      } catch (error) {
        failAndStop(error);
      }
    });
    child.on("disconnect", () => {
      if (settled || protocolState === "complete_received") return;
      setTimeout(() => {
        if (
          !settled
          && protocolState !== "complete_received"
          && child.exitCode === null
          && child.signalCode === null
        ) {
          failAndStop(new Error(
            "Observatory server worker disconnected before snapshot completion",
          ));
        }
      }, 25);
    });
    child.once("close", (exitCode, signal) => {
      releaseWorker();
      destroyChildChannels(child);
      if (settled) return;
      const elapsedMs = roundMilliseconds(performance.now() - startedAt);
      if (timedOut) {
        finish(reject, new Error(
          `Observatory server worker timed out after ${resolvedTimeoutMs}ms`,
        ));
        return;
      }
      if (outputOverflow) {
        finish(reject, terminalError);
        return;
      }
      if (terminalError) {
        finish(reject, terminalError);
        return;
      }
      if (exitCode !== 0 || signal !== null) {
        const termination = signal === null ? `exit ${exitCode}` : `signal ${signal}`;
        const detail = stderr.trim() || ipcError?.error?.message || termination;
        finish(reject, new Error(`Observatory server worker failed: ${detail}`));
        return;
      }
      if (stdout.trim() || stderr.trim()) {
        const stream = stderr.trim() ? "stderr" : "stdout";
        const detail = stderr.trim() || stdout.trim();
        finish(reject, new Error(
          `Observatory server worker wrote to ${stream}; IPC is required: ${detail}`,
        ));
        return;
      }
      if (!readyEnvelope) {
        finish(reject, new Error("Observatory server worker exited before the ready message"));
        return;
      }
      if (!completionEnvelope) {
        finish(reject, new Error("Observatory server worker exited before snapshot completion"));
        return;
      }
      if (!loadResult) {
        finish(reject, new Error("Observatory load driver did not complete before server shutdown"));
        return;
      }
      if (protocolState !== "complete_received") {
        finish(reject, new Error(
          `Observatory server worker exited in invalid protocol state ${protocolState}`,
        ));
        return;
      }

      let envelope;
      try {
        envelope = parseObservatoryWorkerEnvelope({
          ...completionEnvelope,
          result: {
            ...completionEnvelope.result,
            ...loadResult,
          },
          load_driver: {
            ...completionEnvelope.load_driver,
            sentinel_bytes: sentinelBytes,
            rss_bytes_sample_before_load: loadDriverRssBeforeLoadBytes,
            rss_bytes_sample_after_load: loadDriverRssAfterLoadBytes,
          },
        }, { expectedWarmIterations: options.warmIterations });
      } catch (error) {
        finish(reject, error);
        return;
      }
      finish(resolve, {
        result: {
          ...envelope.result,
          role: envelope.role,
          memory_scope: envelope.memory_scope,
          load_driver: envelope.load_driver,
        },
        process: {
          pid: envelope.process.pid,
          parent_pid: envelope.process.parent_pid,
          exit_code: exitCode,
          signal,
          terminated: true,
          elapsed_ms: elapsedMs,
        },
      });
    });
  });
}

async function driveObservatoryLoad({
  ready,
  warmIterations,
  memoryDiagnostics,
  captureMemory,
  fixtureRoot,
  fixtureManifestPath,
  expectedManifestSha256,
  observatoryLimits,
  modelVerifier,
}) {
  const endpoint = {
    address: { host: ready.server.host, port: ready.server.port },
    accessToken: OBSERVATORY_ACCESS_TOKEN,
  };
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  const coldArtifactPath = path.join(
    fixtureRoot,
    `.observatory-cold-${process.pid}-${crypto.randomBytes(8).toString("hex")}.json`,
  );
  try {
    const coldModel = await measureAsync(() => requestModel(endpoint, agent, {
      computeSha256: true,
      outputPath: coldArtifactPath,
    }));
    const etag = validateObservatoryColdResponse(coldModel.value);
    const verifier = await runObservatoryModelVerifierProcess({
      artifactPath: coldArtifactPath,
      fixtureRoot,
      fixtureManifestPath,
      expectedManifestSha256,
      expectedModelBytes: coldModel.value.body_bytes,
      expectedModelSha256: coldModel.value.sha256_base64url,
      observatoryLimits,
      ...modelVerifier,
    });
    const modelValidation = {
      ...verifier.result,
      verifier_process: {
        ...verifier.process,
        role: "observatory_model_semantic_verifier",
        memory_included: false,
      },
    };
    if (memoryDiagnostics?.enabled === true) {
      await captureMemory("cold_complete");
      if (memoryDiagnostics.forceGc === true) {
        await captureMemory("cold_after_forced_gc", {}, true);
      }
    }

    const warmDurations = [];
    let conditionalHits = 0;
    let conditionalBodyBytes = 0;
    const warmMilestones = diagnosticWarmMilestones(warmIterations);
    for (let index = 0; index < warmIterations; index += 1) {
      const warmRequest = await measureAsync(() => requestModel(endpoint, agent, {
        ifNoneMatch: etag,
      }));
      validateObservatoryWarmResponse(warmRequest.value, etag, index + 1);
      warmDurations.push(warmRequest.duration_ms);
      if (warmRequest.value.statusCode === 304) conditionalHits += 1;
      conditionalBodyBytes += warmRequest.value.body_bytes;
      const completed = index + 1;
      if (memoryDiagnostics?.enabled === true && warmMilestones.has(completed)) {
        await captureMemory(`warm_${completed}`, { warm_requests_completed: completed });
      }
    }
    if (memoryDiagnostics?.enabled === true) {
      await captureMemory("warm_complete", { warm_requests_completed: warmIterations });
      if (memoryDiagnostics.forceGc === true) {
        await captureMemory(
          "warm_after_forced_gc",
          { warm_requests_completed: warmIterations },
          true,
        );
      }
    }

    return {
      cold_model_ms: coldModel.duration_ms,
      cold_status: coldModel.value.statusCode,
      model_bytes: coldModel.value.body_bytes,
      etag,
      model_validation: modelValidation,
      warm_iterations: warmIterations,
      conditional_hits: conditionalHits,
      conditional_body_bytes: conditionalBodyBytes,
      warm_min_ms: roundMilliseconds(Math.min(...warmDurations)),
      warm_median_ms: percentile(warmDurations, 0.5),
      warm_p95_ms: percentile(warmDurations, 0.95),
      warm_max_ms: roundMilliseconds(Math.max(...warmDurations)),
    };
  } finally {
    // Node 18 waits for keep-alive sockets during server.close(); release them first.
    agent.destroy();
    fs.rmSync(coldArtifactPath, { force: true });
  }
}

function sendObservatoryCaptureCommand(child, pendingCaptures, {
  commandId,
  stage,
  details,
  forceGc,
}) {
  return new Promise((resolve, reject) => {
    pendingCaptures.set(commandId, { reject, resolve, stage });
    sendChildIpcMessage(child, {
      schema_version: ENTERPRISE_OBSERVATORY_WORKER_SCHEMA,
      type: OBSERVATORY_CAPTURE_MESSAGE,
      command_id: commandId,
      stage,
      details,
      force_gc: forceGc,
    }).catch((error) => {
      pendingCaptures.delete(commandId);
      reject(error);
    });
  });
}

function settleObservatoryCapture(pendingCaptures, message) {
  if (message.schema_version !== ENTERPRISE_OBSERVATORY_WORKER_SCHEMA) {
    throw new TypeError("Observatory memory capture returned an unsupported schema version");
  }
  if (typeof message.command_id !== "string" || message.command_id === "") {
    throw new TypeError("Observatory memory capture omitted its command ID");
  }
  const pending = pendingCaptures.get(message.command_id);
  if (!pending) throw new Error("Observatory memory capture returned an unknown command ID");
  if (message.stage !== pending.stage) {
    throw new Error("Observatory memory capture returned a different stage");
  }
  pendingCaptures.delete(message.command_id);
  pending.resolve();
}

function sendChildIpcMessage(child, message) {
  return new Promise((resolve, reject) => {
    if (!child.connected) {
      reject(new Error("Observatory server worker IPC channel is not connected"));
      return;
    }
    child.send(message, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function runIsolatedWorkerProcess({
  label,
  executable,
  scriptPath,
  timeoutMs,
  timeoutLabel,
  executableArguments = [],
  argumentsList,
  parseEnvelope,
  processGuard,
}) {
  const resolvedExecutable = path.resolve(String(executable || process.execPath));
  const resolvedScriptPath = path.resolve(String(scriptPath || fileURLToPath(import.meta.url)));
  const resolvedTimeoutMs = positiveInteger(
    timeoutMs,
    DEFAULT_WORKER_TIMEOUT_MS,
    timeoutLabel,
  );
  const spawnArguments = [...executableArguments, resolvedScriptPath, ...argumentsList];

  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    let child;
    try {
      child = spawn(resolvedExecutable, spawnArguments, {
        cwd: process.cwd(),
        detached: process.platform !== "win32",
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      reject(error);
      return;
    }

    const workerPid = child.pid ?? null;
    const releaseWorker = processGuard?.trackChild(child) ?? (() => {});
    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let outputOverflow = false;
    let timedOut = false;
    let settled = false;
    let timeout = null;
    let stopping = null;

    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback(value);
    };
    const stopWorker = () => {
      stopping ??= terminateChildAndWait(child);
      return stopping;
    };
    const rejectAfterStop = (primaryError) => {
      void stopWorker().then(
        () => primaryError,
        (terminationError) => new Error(
          `${primaryError.message}; process-tree termination failed: ${terminationError.message}`,
          { cause: terminationError },
        ),
      ).then((error) => {
        if (!settled) {
          releaseWorker();
          finish(reject, error);
        }
      });
    };
    const appendOutput = (stream, chunk) => {
      if (outputOverflow) return stream;
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > MAX_WORKER_OUTPUT_BYTES) {
        outputOverflow = true;
        rejectAfterStop(new Error(`${label} worker exceeded the machine-readable output limit`));
        return stream;
      }
      return stream + chunk;
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout = appendOutput(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = appendOutput(stderr, chunk);
    });
    child.once("error", (error) => {
      rejectAfterStop(new Error(`Unable to start ${label} worker: ${error.message}`, {
        cause: error,
      }));
    });
    child.once("close", (exitCode, signal) => {
      releaseWorker();
      destroyChildChannels(child);
      if (settled) return;
      const elapsedMs = roundMilliseconds(performance.now() - startedAt);
      if (timedOut) {
        finish(reject, new Error(`${label} worker timed out after ${resolvedTimeoutMs}ms`));
        return;
      }
      if (outputOverflow) {
        finish(reject, new Error(`${label} worker exceeded the machine-readable output limit`));
        return;
      }

      if (exitCode !== 0 || signal !== null) {
        let protocolDetail = "";
        if (!stderr.trim() && stdout.trim()) {
          try {
            protocolDetail = JSON.parse(stdout)?.error?.message || "";
          } catch {
            // A failed process is allowed to have no machine-readable envelope.
          }
        }
        const termination = signal === null ? `exit ${exitCode}` : `signal ${signal}`;
        const detail = stderr.trim() || protocolDetail || termination;
        finish(reject, new Error(`${label} worker failed: ${detail}`));
        return;
      }
      if (stderr.trim()) {
        finish(reject, new Error(`${label} worker wrote to stderr: ${stderr.trim()}`));
        return;
      }

      let rawEnvelope = null;
      try {
        rawEnvelope = JSON.parse(stdout);
      } catch (error) {
        finish(reject, new Error(`${label} worker returned invalid JSON`, { cause: error }));
        return;
      }

      let envelope;
      try {
        envelope = parseEnvelope(rawEnvelope);
      } catch (error) {
        finish(reject, error);
        return;
      }
      if (workerPid === null || envelope.process.pid !== workerPid) {
        finish(reject, new Error(`${label} worker protocol reported a different process ID`));
        return;
      }
      if (envelope.process.parent_pid !== process.pid) {
        finish(reject, new Error(`${label} worker protocol reported a different parent process ID`));
        return;
      }
      finish(resolve, {
        result: envelope.result,
        process: {
          pid: envelope.process.pid,
          parent_pid: envelope.process.parent_pid,
          exit_code: exitCode,
          signal,
          terminated: true,
          elapsed_ms: elapsedMs,
        },
      });
    });

    timeout = setTimeout(() => {
      timedOut = true;
      rejectAfterStop(new Error(`${label} worker timed out after ${resolvedTimeoutMs}ms`));
    }, resolvedTimeoutMs);
  });
}

export function parseCanonicalQueryWorkerEnvelope(input) {
  const envelope = typeof input === "string" ? JSON.parse(input) : input;
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    throw new TypeError("Canonical query worker envelope must be an object");
  }
  if (envelope.schema_version !== ENTERPRISE_CANONICAL_QUERY_WORKER_SCHEMA) {
    throw new TypeError("Canonical query worker returned an unsupported schema version");
  }
  if (envelope.ok !== true || envelope.workload !== "canonical_query") {
    throw new TypeError("Canonical query worker did not return a successful canonical query result");
  }
  validateWorkerProcess(envelope.process, "Canonical query worker");
  if (!envelope.result || typeof envelope.result !== "object" || Array.isArray(envelope.result)) {
    throw new TypeError("Canonical query worker result must be an object");
  }
  if (!/^[a-f0-9]{64}$/u.test(envelope.result.manifest_sha256)) {
    throw new TypeError("Canonical query worker returned an invalid manifest SHA-256");
  }
  for (const field of [
    "canonical_files",
    "source_files",
    "stories",
    "records",
    "dependency_edges",
    "trace_events",
    "target_story_trace_events",
  ]) {
    if (!Number.isSafeInteger(envelope.result[field]) || envelope.result[field] < 0) {
      throw new TypeError(`Canonical query worker returned an invalid ${field}`);
    }
  }
  if (typeof envelope.result.target_record_found !== "boolean") {
    throw new TypeError("Canonical query worker returned an invalid target_record_found flag");
  }
  if (envelope.result.target_record_found) {
    const targetRecord = envelope.result.target_record;
    if (!targetRecord || typeof targetRecord !== "object" || Array.isArray(targetRecord)) {
      throw new TypeError("Canonical query worker omitted its target record projection");
    }
    for (const field of ["id", "path", "story_id"]) {
      if (typeof targetRecord[field] !== "string" || targetRecord[field] === "") {
        throw new TypeError(`Canonical query worker returned an invalid target_record.${field}`);
      }
    }
    if (!Number.isSafeInteger(targetRecord.line) || targetRecord.line < 1) {
      throw new TypeError("Canonical query worker returned an invalid target_record.line");
    }
    if (!Number.isSafeInteger(targetRecord.sequence) || targetRecord.sequence < 0) {
      throw new TypeError("Canonical query worker returned an invalid target_record.sequence");
    }
  } else if (envelope.result.target_record !== null) {
    throw new TypeError("Canonical query worker returned a target record while reporting it missing");
  }
  assertFiniteNonNegative(envelope.result.duration_ms, "canonical query duration_ms");
  if (!envelope.result.session_metrics || typeof envelope.result.session_metrics !== "object") {
    throw new TypeError("Canonical query worker omitted session metrics");
  }
  if (!Number.isSafeInteger(envelope.result.session_metrics.catalog_builds)) {
    throw new TypeError("Canonical query worker returned invalid catalog metrics");
  }
  validateMemorySnapshot(envelope.result.memory, "canonical query worker memory");
  return envelope;
}

async function buildCanonicalQueryWorkerEnvelope({
  fixtureRoot,
  fixtureManifest,
  expectedManifestSha256,
}) {
  const root = path.resolve(String(fixtureRoot));
  const manifestPath = path.resolve(String(fixtureManifest));
  if (manifestPath !== path.join(root, "fixture-manifest.json")) {
    throw new TypeError("Canonical query worker manifest must be the fixture manifest");
  }
  const manifestBytes = fs.readFileSync(manifestPath);
  const manifestSha256 = crypto.createHash("sha256").update(manifestBytes).digest("hex");
  if (!/^[a-f0-9]{64}$/u.test(expectedManifestSha256) || manifestSha256 !== expectedManifestSha256) {
    throw new Error("Canonical query worker manifest SHA-256 does not match the parent fixture");
  }
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const { openCanonicalQuerySession } = await import("../lib/canonical-query-session.mjs");
  const session = openCanonicalQuerySession({ root });
  const canonicalQuery = measure(() => runCanonicalQuery(session, manifest));
  return {
    schema_version: ENTERPRISE_CANONICAL_QUERY_WORKER_SCHEMA,
    ok: true,
    workload: "canonical_query",
    process: {
      pid: process.pid,
      parent_pid: process.ppid,
    },
    result: {
      manifest_sha256: manifestSha256,
      duration_ms: canonicalQuery.duration_ms,
      ...canonicalQuery.value,
      session_metrics: session.metrics(),
      memory: memorySnapshot(),
    },
  };
}

function buildObservatoryModelVerifierEnvelope({
  fixtureRoot,
  fixtureManifest,
  expectedManifestSha256,
  modelArtifact,
  expectedModelBytes,
  expectedModelSha256,
  observatoryLimits,
}) {
  const root = path.resolve(String(fixtureRoot));
  const manifestPath = path.resolve(String(fixtureManifest));
  if (manifestPath !== path.join(root, "fixture-manifest.json")) {
    throw new TypeError("Observatory model verifier manifest must be the fixture manifest");
  }
  const artifactPath = path.resolve(String(modelArtifact));
  const relativeArtifact = path.relative(root, artifactPath);
  if (
    relativeArtifact === ""
    || relativeArtifact === ".."
    || relativeArtifact.startsWith(`..${path.sep}`)
    || path.isAbsolute(relativeArtifact)
  ) {
    throw new TypeError("Observatory model verifier artifact must remain inside the fixture");
  }
  const manifestBytes = fs.readFileSync(manifestPath);
  const manifestSha256 = crypto.createHash("sha256").update(manifestBytes).digest("hex");
  if (!/^[a-f0-9]{64}$/u.test(expectedManifestSha256) || manifestSha256 !== expectedManifestSha256) {
    throw new Error("Observatory model verifier manifest SHA-256 does not match the parent fixture");
  }
  if (!Number.isSafeInteger(expectedModelBytes) || expectedModelBytes < 1) {
    throw new TypeError("Observatory model verifier expected size must be positive");
  }
  if (!/^[A-Za-z0-9_-]{43}$/u.test(expectedModelSha256)) {
    throw new TypeError("Observatory model verifier expected SHA-256 must be base64url");
  }
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const result = validateObservatoryModelArtifact(artifactPath, manifest, {
    limits: observatoryLimits,
    expectedSizeBytes: expectedModelBytes,
    expectedSha256Base64url: expectedModelSha256,
    maxBytes: MAX_COLD_MODEL_BYTES,
  });
  return {
    schema_version: ENTERPRISE_OBSERVATORY_MODEL_VERIFIER_SCHEMA,
    ok: true,
    workload: "observatory_model_verification",
    process: {
      pid: process.pid,
      parent_pid: process.ppid,
    },
    result: {
      ...result,
      manifest_sha256: manifestSha256,
    },
  };
}

export function parseObservatoryServerReadyMessage(input) {
  const message = typeof input === "string" ? JSON.parse(input) : input;
  validateObservatoryIpcMetadata(message, "Observatory server ready message");
  if (message.type !== OBSERVATORY_READY_MESSAGE) {
    throw new TypeError("Observatory server ready message has an invalid type");
  }
  validateWorkerProcess(message.process, "Observatory server ready message");
  if (message.pid !== message.process.pid || message.parent_pid !== message.process.parent_pid) {
    throw new TypeError("Observatory server ready message returned inconsistent process metadata");
  }
  if (!message.server || typeof message.server !== "object" || Array.isArray(message.server)) {
    throw new TypeError("Observatory server ready message omitted server metadata");
  }
  if (message.server.host !== LOOPBACK_HOST) {
    throw new TypeError("Observatory server worker must listen on the IPv4 loopback address");
  }
  if (!Number.isSafeInteger(message.server.port) || message.server.port < 1 || message.server.port > 65_535) {
    throw new TypeError("Observatory server ready message returned an invalid port");
  }
  assertFiniteNonNegative(
    message.server.start_ms,
    "Observatory server ready message start_ms",
  );
  if (
    message.host !== message.server.host
    || message.port !== message.server.port
    || message.start_ms !== message.server.start_ms
  ) {
    throw new TypeError("Observatory server ready message returned inconsistent server metadata");
  }
  return message;
}

export function parseObservatoryServerCompletionEnvelope(input) {
  const envelope = typeof input === "string" ? JSON.parse(input) : input;
  validateObservatoryIpcMetadata(envelope, "Observatory server completion");
  if (envelope.type !== OBSERVATORY_COMPLETE_MESSAGE) {
    throw new TypeError("Observatory server completion has an invalid type");
  }
  if (typeof envelope.command_id !== "string" || envelope.command_id === "") {
    throw new TypeError("Observatory server completion omitted its command ID");
  }
  validateWorkerProcess(envelope.process, "Observatory server completion");
  if (!envelope.result || typeof envelope.result !== "object" || Array.isArray(envelope.result)) {
    throw new TypeError("Observatory server completion result must be an object");
  }
  if (envelope.result.listen_host !== LOOPBACK_HOST) {
    throw new TypeError("Observatory server completion must report the IPv4 loopback address");
  }
  assertFiniteNonNegative(envelope.result.server_start_ms, "Observatory server start_ms");
  for (const field of ["served_requests", "cold_responses", "conditional_responses"]) {
    if (!Number.isSafeInteger(envelope.result[field]) || envelope.result[field] < 0) {
      throw new TypeError(`Observatory server completion returned an invalid ${field}`);
    }
  }
  if (envelope.result.resources_closed !== true) {
    throw new TypeError("Observatory server worker did not confirm resource cleanup");
  }
  validateMemorySnapshot(envelope.result.memory, "Observatory server worker memory");
  if (envelope.result.memory.source_pid !== envelope.process.pid) {
    throw new TypeError("Observatory server worker memory must identify the server process");
  }
  if (envelope.result.memory.attribution !== OBSERVATORY_MEMORY_SCOPE) {
    throw new TypeError("Observatory server worker memory has an invalid attribution");
  }
  if (envelope.result.memory_diagnostics !== undefined) {
    validateMemoryDiagnostics(envelope.result.memory_diagnostics);
  }
  return envelope;
}

function parseObservatoryServerErrorMessage(input) {
  const message = typeof input === "string" ? JSON.parse(input) : input;
  if (
    !message
    || typeof message !== "object"
    || Array.isArray(message)
    || message.schema_version !== ENTERPRISE_OBSERVATORY_WORKER_SCHEMA
    || message.type !== OBSERVATORY_ERROR_MESSAGE
    || message.ok !== false
    || typeof message.error?.message !== "string"
  ) {
    throw new TypeError("Observatory server worker returned an invalid error message");
  }
  return message;
}

function validateObservatoryIpcMetadata(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  if (value.schema_version !== ENTERPRISE_OBSERVATORY_WORKER_SCHEMA) {
    throw new TypeError(`${label} returned an unsupported schema version`);
  }
  if (value.ok !== true || value.workload !== "observatory") {
    throw new TypeError(`${label} did not report a successful Observatory server`);
  }
  if (value.role !== OBSERVATORY_SERVER_ROLE) {
    throw new TypeError(`${label} must declare the Observatory server role`);
  }
  if (value.memory_scope !== OBSERVATORY_MEMORY_SCOPE) {
    throw new TypeError(`${label} must declare server-process-only memory`);
  }
  if (
    !value.load_driver
    || typeof value.load_driver !== "object"
    || Array.isArray(value.load_driver)
    || value.load_driver.role !== OBSERVATORY_LOAD_DRIVER_ROLE
    || value.load_driver.memory_included !== false
  ) {
    throw new TypeError(`${label} must declare that load-driver memory is excluded`);
  }
}

export function parseObservatoryWorkerEnvelope(input, { expectedWarmIterations = null } = {}) {
  if (
    expectedWarmIterations !== null
    && (!Number.isSafeInteger(expectedWarmIterations) || expectedWarmIterations < 1)
  ) {
    throw new TypeError("Expected Observatory warm iterations must be a positive safe integer");
  }
  const envelope = typeof input === "string" ? JSON.parse(input) : input;
  validateObservatoryIpcMetadata(envelope, "Observatory worker envelope");
  validateWorkerProcess(envelope.process, "Observatory worker");
  if (!Number.isSafeInteger(envelope.load_driver.pid) || envelope.load_driver.pid < 1) {
    throw new TypeError("Observatory load driver returned an invalid process ID");
  }
  if (envelope.load_driver.pid !== envelope.process.parent_pid) {
    throw new TypeError("Observatory load driver must be the server worker parent");
  }
  for (const field of [
    "sentinel_bytes",
    "rss_bytes_sample_before_load",
    "rss_bytes_sample_after_load",
  ]) {
    if (!Number.isSafeInteger(envelope.load_driver[field]) || envelope.load_driver[field] < 0) {
      throw new TypeError(`Observatory load driver returned an invalid ${field}`);
    }
  }
  if (!envelope.result || typeof envelope.result !== "object" || Array.isArray(envelope.result)) {
    throw new TypeError("Observatory worker result must be an object");
  }
  if (envelope.result.listen_host !== LOOPBACK_HOST) {
    throw new TypeError("Observatory worker must listen on the IPv4 loopback address");
  }
  for (const field of [
    "cold_status",
    "model_bytes",
    "warm_iterations",
    "conditional_hits",
    "conditional_body_bytes",
  ]) {
    if (!Number.isSafeInteger(envelope.result[field]) || envelope.result[field] < 0) {
      throw new TypeError(`Observatory worker returned an invalid ${field}`);
    }
  }
  if (envelope.result.warm_iterations < 1) {
    throw new TypeError("Observatory worker returned no warm iterations");
  }
  if (
    expectedWarmIterations !== null
    && envelope.result.warm_iterations !== expectedWarmIterations
  ) {
    throw new TypeError(
      `Observatory worker returned ${envelope.result.warm_iterations} warm iterations; `
        + `expected exactly ${expectedWarmIterations}`,
    );
  }
  for (const field of ["served_requests", "cold_responses", "conditional_responses"]) {
    if (!Number.isSafeInteger(envelope.result[field]) || envelope.result[field] < 0) {
      throw new TypeError(`Observatory worker returned an invalid ${field}`);
    }
  }
  if (
    envelope.result.served_requests !== envelope.result.warm_iterations + 1
    || envelope.result.cold_responses !== 1
    || envelope.result.conditional_responses !== envelope.result.warm_iterations
  ) {
    throw new TypeError("Observatory worker request counts do not match the load-driver result");
  }
  if (envelope.result.model_bytes < 1) {
    throw new TypeError("Observatory worker returned an empty cold model");
  }
  if (envelope.result.conditional_hits > envelope.result.warm_iterations) {
    throw new TypeError("Observatory worker returned too many conditional hits");
  }
  if (
    typeof envelope.result.etag !== "string"
    || !OBSERVATORY_ETAG_PATTERN.test(envelope.result.etag)
  ) {
    throw new TypeError("Observatory worker returned an invalid ETag");
  }
  for (const field of [
    "server_start_ms",
    "cold_model_ms",
    "warm_min_ms",
    "warm_median_ms",
    "warm_p95_ms",
    "warm_max_ms",
  ]) {
    assertFiniteNonNegative(envelope.result[field], `Observatory worker ${field}`);
  }
  if (
    envelope.result.warm_min_ms > envelope.result.warm_median_ms
    || envelope.result.warm_median_ms > envelope.result.warm_p95_ms
    || envelope.result.warm_p95_ms > envelope.result.warm_max_ms
  ) {
    throw new TypeError(
      "Observatory worker warm timings must satisfy min <= median <= p95 <= max",
    );
  }
  if (envelope.result.resources_closed !== true) {
    throw new TypeError("Observatory worker did not confirm resource cleanup");
  }
  validateMemorySnapshot(envelope.result.memory, "Observatory worker memory");
  if (envelope.result.memory.source_pid !== envelope.process.pid) {
    throw new TypeError("Observatory worker memory must identify the server process");
  }
  if (envelope.result.memory.attribution !== OBSERVATORY_MEMORY_SCOPE) {
    throw new TypeError("Observatory worker memory has an invalid attribution");
  }
  if (envelope.result.memory_diagnostics !== undefined) {
    validateMemoryDiagnostics(envelope.result.memory_diagnostics);
  }
  const modelValidation = envelope.result.model_validation;
  if (!modelValidation || typeof modelValidation !== "object" || Array.isArray(modelValidation)) {
    throw new TypeError("Observatory worker omitted cold-model semantic validation");
  }
  if (
    modelValidation.passed !== true
    || modelValidation.schema_version !== "change-observatory:view:v1"
    || typeof modelValidation.project_id !== "string"
    || modelValidation.project_id === ""
    || !/^[a-f0-9]{64}$/u.test(modelValidation.manifest_sha256)
  ) {
    throw new TypeError("Observatory worker returned invalid cold-model semantic validation");
  }
  for (const field of ["iterations", "dossiers", "records", "changes", "verification"]) {
    if (!Number.isSafeInteger(modelValidation.snapshots?.[field]) || modelValidation.snapshots[field] < 0) {
      throw new TypeError(`Observatory worker returned invalid model_validation.snapshots.${field}`);
    }
  }
  if (
    typeof modelValidation.target?.story_id !== "string"
    || modelValidation.target.story_id === ""
    || typeof modelValidation.target?.story_path !== "string"
    || modelValidation.target.story_path === ""
  ) {
    throw new TypeError("Observatory worker returned an invalid model-validation target");
  }
  if (
    !isOracleObject(modelValidation.artifact)
    || modelValidation.artifact.size_bytes !== envelope.result.model_bytes
    || !/^[A-Za-z0-9_-]{43}$/u.test(modelValidation.artifact.sha256_base64url)
    || envelope.result.etag !== `"sha256-${modelValidation.artifact.sha256_base64url}"`
    || modelValidation.artifact.max_bytes !== MAX_COLD_MODEL_BYTES
  ) {
    throw new TypeError("Observatory worker returned invalid model artifact integrity metadata");
  }
  const verifierProcess = modelValidation.verifier_process;
  validateWorkerProcess(verifierProcess, "Observatory model verifier");
  if (
    verifierProcess.parent_pid !== envelope.process.parent_pid
    || verifierProcess.exit_code !== 0
    || verifierProcess.signal !== null
    || verifierProcess.terminated !== true
    || verifierProcess.role !== "observatory_model_semantic_verifier"
    || verifierProcess.memory_included !== false
  ) {
    throw new TypeError("Observatory model verifier did not terminate successfully in isolation");
  }
  return envelope;
}

async function runObservatoryServerWorker({
  fixtureRoot,
  fixtureManifest,
  expectedManifestSha256,
  observatoryLimits,
  memoryDiagnostics = null,
}) {
  const root = path.resolve(String(fixtureRoot));
  const manifestPath = path.resolve(String(fixtureManifest));
  if (manifestPath !== path.join(root, "fixture-manifest.json")) {
    throw new TypeError("Observatory worker manifest must be the fixture manifest");
  }
  const manifestBytes = fs.readFileSync(manifestPath);
  const manifestSha256 = crypto.createHash("sha256").update(manifestBytes).digest("hex");
  if (!/^[a-f0-9]{64}$/u.test(expectedManifestSha256) || manifestSha256 !== expectedManifestSha256) {
    throw new Error("Observatory server manifest SHA-256 does not match the parent fixture");
  }
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const diagnosticsEnabled = memoryDiagnostics?.enabled === true;
  const forceGc = memoryDiagnostics?.forceGc === true;
  if (forceGc && typeof globalThis.gc !== "function") {
    throw new Error("Forced-GC memory diagnostics require the Observatory worker to expose gc");
  }
  const memoryTimeline = [];
  const captureMemory = (stage, details = {}) => {
    if (!diagnosticsEnabled) return;
    memoryTimeline.push({
      stage,
      ...details,
      ...detailedMemorySnapshot(),
    });
  };
  captureMemory("worker_start");
  const { startObservatoryServer } = await import("../lib/change-observatory/server.mjs");
  captureMemory("observatory_module_loaded");
  let running = null;
  try {
    const serverStart = await measureAsync(() => startObservatoryServer({
      projectRoot: root,
      host: LOOPBACK_HOST,
      port: 0,
      accessToken: OBSERVATORY_ACCESS_TOKEN,
      clock: () => new Date(manifest.generated_at),
      limits: observatoryLimits,
    }));
    running = serverStart.value;
    captureMemory("server_started");
    const requestCounts = observeServerRequests(running.server);
    await sendCurrentProcessIpcMessage({
      ...observatoryServerIpcMetadata(),
      type: OBSERVATORY_READY_MESSAGE,
      pid: process.pid,
      parent_pid: process.ppid,
      host: running.address.host,
      port: running.address.port,
      start_ms: serverStart.duration_ms,
      server: {
        host: running.address.host,
        port: running.address.port,
        start_ms: serverStart.duration_ms,
      },
    });

    await waitForObservatoryServerCommands({
      diagnosticsEnabled,
      forceGc,
      captureMemory,
      memoryTimeline,
      requestCounts,
      serverStartMs: serverStart.duration_ms,
      closeServer: async () => {
        await running.close();
        running = null;
        captureMemory("resources_closed");
      },
    });
  } finally {
    await running?.close();
  }
}

function observeServerRequests(server) {
  const counts = {
    requests: 0,
    cold_responses: 0,
    conditional_responses: 0,
    in_flight: 0,
  };
  server.on("request", (_request, response) => {
    counts.requests += 1;
    counts.in_flight += 1;
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      counts.in_flight -= 1;
      if (response.statusCode === 200) counts.cold_responses += 1;
      if (response.statusCode === 304) counts.conditional_responses += 1;
    };
    response.once("finish", settle);
    response.once("close", settle);
  });
  return counts;
}

function waitForObservatoryServerCommands({
  diagnosticsEnabled,
  forceGc,
  captureMemory,
  memoryTimeline,
  requestCounts,
  serverStartMs,
  closeServer,
}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let commandChain = Promise.resolve();
    let measuredAt = "server_started";

    const cleanup = () => {
      process.off("message", onMessage);
      process.off("disconnect", onDisconnect);
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const onDisconnect = () => {
      finish(reject, new Error("Observatory server worker lost its parent IPC channel"));
    };
    const onMessage = (message) => {
      if (settled) return;
      commandChain = commandChain
        .then(() => handleObservatoryServerCommand(message))
        .catch((error) => finish(reject, error));
    };
    const handleObservatoryServerCommand = async (message) => {
      if (
        !message
        || typeof message !== "object"
        || Array.isArray(message)
        || message.schema_version !== ENTERPRISE_OBSERVATORY_WORKER_SCHEMA
      ) {
        throw new TypeError("Observatory server worker received an invalid IPC command");
      }
      if (message.type === OBSERVATORY_CAPTURE_MESSAGE) {
        if (!diagnosticsEnabled) {
          throw new Error("Observatory memory capture was requested without diagnostics enabled");
        }
        if (typeof message.command_id !== "string" || message.command_id === "") {
          throw new TypeError("Observatory memory capture command omitted its command ID");
        }
        if (typeof message.stage !== "string" || message.stage === "") {
          throw new TypeError("Observatory memory capture command omitted its stage");
        }
        if (
          !message.details
          || typeof message.details !== "object"
          || Array.isArray(message.details)
        ) {
          throw new TypeError("Observatory memory capture details must be an object");
        }
        if (message.force_gc === true) {
          if (!forceGc) {
            throw new Error("Observatory forced GC was not enabled for this worker");
          }
          await runDiagnosticGarbageCollection();
        }
        captureMemory(message.stage, message.details);
        measuredAt = message.stage;
        await sendCurrentProcessIpcMessage({
          schema_version: ENTERPRISE_OBSERVATORY_WORKER_SCHEMA,
          type: OBSERVATORY_CAPTURED_MESSAGE,
          command_id: message.command_id,
          stage: message.stage,
        });
        return;
      }
      if (message.type !== OBSERVATORY_SNAPSHOT_MESSAGE) {
        throw new TypeError("Observatory server worker received an unsupported IPC command");
      }
      if (typeof message.command_id !== "string" || message.command_id === "") {
        throw new TypeError("Observatory snapshot command omitted its command ID");
      }
      for (const field of [
        "expected_requests",
        "expected_cold_responses",
        "expected_conditional_responses",
      ]) {
        if (!Number.isSafeInteger(message[field]) || message[field] < 0) {
          throw new TypeError(`Observatory snapshot command returned an invalid ${field}`);
        }
      }
      if (
        requestCounts.in_flight !== 0
        || requestCounts.requests !== message.expected_requests
        || requestCounts.cold_responses !== message.expected_cold_responses
        || requestCounts.conditional_responses !== message.expected_conditional_responses
      ) {
        throw new Error("Observatory server request counts do not match the load-driver contract");
      }

      const measuredMemory = {
        ...memorySnapshot(),
        attribution: OBSERVATORY_MEMORY_SCOPE,
        source_pid: process.pid,
      };
      await closeServer();
      const completion = {
        ...observatoryServerIpcMetadata(),
        type: OBSERVATORY_COMPLETE_MESSAGE,
        command_id: message.command_id,
        result: {
          listen_host: LOOPBACK_HOST,
          server_start_ms: serverStartMs,
          served_requests: requestCounts.requests,
          cold_responses: requestCounts.cold_responses,
          conditional_responses: requestCounts.conditional_responses,
          memory: measuredMemory,
          resources_closed: true,
          ...(diagnosticsEnabled ? {
            memory_diagnostics: {
              force_gc: forceGc,
              measured_at: measuredAt,
              timeline: memoryTimeline,
            },
          } : {}),
        },
      };
      await sendCurrentProcessIpcMessage(completion);
      finish(resolve);
      if (process.connected) process.disconnect();
    };

    process.on("message", onMessage);
    process.once("disconnect", onDisconnect);
  });
}

function observatoryServerIpcMetadata() {
  return {
    schema_version: ENTERPRISE_OBSERVATORY_WORKER_SCHEMA,
    ok: true,
    workload: "observatory",
    role: OBSERVATORY_SERVER_ROLE,
    memory_scope: OBSERVATORY_MEMORY_SCOPE,
    load_driver: {
      role: OBSERVATORY_LOAD_DRIVER_ROLE,
      pid: process.ppid,
      memory_included: false,
    },
    process: {
      pid: process.pid,
      parent_pid: process.ppid,
    },
  };
}

function sendCurrentProcessIpcMessage(message) {
  return new Promise((resolve, reject) => {
    if (typeof process.send !== "function" || !process.connected) {
      reject(new Error("Observatory server worker requires a connected IPC channel"));
      return;
    }
    process.send(message, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export function validateObservatoryColdResponse(response) {
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    throw new TypeError("Observatory cold request returned an invalid response");
  }
  if (response.statusCode !== 200) {
    const status = Number.isSafeInteger(response.statusCode)
      ? response.statusCode
      : "an invalid status";
    throw new Error(`Observatory cold request failed with HTTP ${status}`);
  }
  if (!Number.isSafeInteger(response.body_bytes) || response.body_bytes < 1) {
    throw new Error("Observatory cold request returned an empty model");
  }
  if (response.body_bytes > MAX_COLD_MODEL_BYTES) {
    throw new Error(`Observatory cold request exceeded the ${MAX_COLD_MODEL_BYTES}-byte limit`);
  }
  if (response.artifact_size_bytes !== response.body_bytes) {
    throw new Error("Observatory cold request artifact size does not match streamed bytes");
  }
  if (response.complete !== true) {
    throw new Error("Observatory cold request returned a truncated model");
  }
  if (!Number.isSafeInteger(response.content_length) || response.content_length < 1) {
    throw new Error("Observatory cold request did not return a valid Content-Length");
  }
  if (response.content_length !== response.body_bytes) {
    throw new Error("Observatory cold request body does not match Content-Length");
  }
  const etag = response.headers?.etag;
  if (typeof etag !== "string" || !OBSERVATORY_ETAG_PATTERN.test(etag)) {
    throw new Error("Observatory cold request did not return a valid SHA-256 ETag");
  }
  if (
    typeof response.sha256_base64url !== "string"
    || etag !== `"sha256-${response.sha256_base64url}"`
  ) {
    throw new Error("Observatory cold request ETag does not match the streamed model SHA-256");
  }
  return etag;
}

export function validateObservatoryModelArtifact(filePath, manifest, {
  limits = {},
  expectedSizeBytes = null,
  expectedSha256Base64url = null,
  maxBytes = MAX_COLD_MODEL_BYTES,
} = {}) {
  if (typeof filePath !== "string" || filePath === "") {
    throw new TypeError("Observatory model artifact path must be a non-empty string");
  }
  validateEnterpriseFixtureManifestForOracle(manifest);
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new TypeError("Observatory cold model artifact must be a regular non-symlink file");
  }
  if (!Number.isSafeInteger(stat.size) || stat.size < 1 || stat.size > maxBytes) {
    throw new Error(`Observatory cold model artifact must be between 1 and ${maxBytes} bytes`);
  }
  if (expectedSizeBytes !== null && stat.size !== expectedSizeBytes) {
    throw new Error("Observatory cold model artifact size does not match the streamed response");
  }
  const artifactBytes = fs.readFileSync(filePath);
  if (artifactBytes.byteLength !== stat.size) {
    throw new Error("Observatory cold model artifact changed while it was being read");
  }
  const artifactSha256 = crypto.createHash("sha256").update(artifactBytes).digest("base64url");
  if (expectedSha256Base64url !== null && artifactSha256 !== expectedSha256Base64url) {
    throw new Error("Observatory cold model artifact SHA-256 does not match the streamed response");
  }
  let model;
  try {
    model = JSON.parse(artifactBytes.toString("utf8"));
  } catch (error) {
    throw new Error("Observatory cold model is not valid JSON", { cause: error });
  }
  if (!isOracleObject(model)) {
    throw new TypeError("Observatory cold model must be a JSON object");
  }
  assertOracleObjectKeys(model, [
    "schemaVersion",
    "generatedAt",
    "project",
    "snapshots",
    "summary",
    "iterations",
    "contracts",
    "decisions",
    "changes",
    "verification",
    "semanticObservations",
    "dossiers",
    "unlinked",
    "records",
    "diagnostics",
  ], "Observatory cold model");
  if (model.schemaVersion !== "change-observatory:view:v1") {
    throw new TypeError("Observatory cold model returned an unsupported schema version");
  }
  if (model.generatedAt !== manifest.generated_at) {
    throw new Error("Observatory cold model generation timestamp does not match the fixture");
  }
  if (!isOracleObject(model.project) || model.project.id !== "enterprise-foundation-fixture") {
    throw new Error("Observatory cold model project does not match the enterprise fixture");
  }

  const maxRecords = oraclePositiveLimit(limits.maxRecords, 10_000);
  const maxCollectionItems = oraclePositiveLimit(limits.maxCollectionItems, 1_000);
  const maxDiagnostics = oraclePositiveLimit(limits.maxDiagnostics, 100);
  const baseRecords = 2 + manifest.scale.stories;
  const availableTraceRecords = Math.min(
    manifest.scale.trace_events,
    Math.max(0, maxRecords - baseRecords),
  );
  const expectedCounts = {
    iterations: manifest.scale.stories,
    contracts: 0,
    decisions: 0,
    changes: availableTraceRecords - Math.ceil(availableTraceRecords / 5),
    verification: Math.ceil(availableTraceRecords / 5),
    semanticObservations: 0,
    dossiers: manifest.scale.stories,
    unlinked: 0,
    records: Math.min(
      maxRecords,
      baseRecords + manifest.scale.trace_events + manifest.scale.records,
    ),
  };
  if (!isOracleObject(model.snapshots) || !isOracleObject(model.snapshots.counts)) {
    throw new TypeError("Observatory cold model omitted snapshot counts");
  }
  for (const [field, expected] of Object.entries(expectedCounts)) {
    if (model.snapshots.counts[field] !== expected) {
      throw new Error(
        `Observatory cold model snapshot ${field} is ${model.snapshots.counts[field]}; expected ${expected}`,
      );
    }
  }

  if (!isOracleObject(model.summary)) {
    throw new TypeError("Observatory cold model summary must be an object");
  }
  for (const field of ["asked", "changed", "decided"]) {
    if (!Array.isArray(model.summary[field])) {
      throw new TypeError(`Observatory cold model summary.${field} must be an array`);
    }
  }
  for (const field of [
    "iterations",
    "contracts",
    "decisions",
    "changes",
    "verification",
    "semanticObservations",
    "dossiers",
    "unlinked",
    "records",
    "diagnostics",
  ]) {
    if (!Array.isArray(model[field])) {
      throw new TypeError(`Observatory cold model ${field} must be an array`);
    }
  }
  for (const [field, expected] of Object.entries({
    iterations: Math.min(expectedCounts.iterations, maxCollectionItems),
    contracts: 0,
    decisions: 0,
    changes: Math.min(expectedCounts.changes, maxCollectionItems),
    verification: Math.min(expectedCounts.verification, maxCollectionItems),
    semanticObservations: 0,
    dossiers: Math.min(expectedCounts.dossiers, maxCollectionItems),
    unlinked: 0,
    records: Math.min(expectedCounts.records, maxCollectionItems),
  })) {
    if (model[field].length !== expected) {
      throw new Error(`Observatory cold model ${field} retained ${model[field].length}; expected ${expected}`);
    }
  }
  if (
    model.summary.asked.length !== 0
    || model.summary.decided.length !== 0
    || model.summary.changed.length !== Math.min(expectedCounts.changes, maxCollectionItems)
  ) {
    throw new Error("Observatory cold model summary collections do not match the bounded fixture projection");
  }

  const retainedDossierLaneCounts = validateOracleIterations(
    model.iterations,
    model.dossiers,
    manifest,
    availableTraceRecords,
    maxCollectionItems,
  );
  validateOracleTraceItems(
    model.changes,
    oracleExpectedTraceIndices(availableTraceRecords, false, maxCollectionItems),
    manifest,
    "implementation",
    "changes",
  );
  validateOracleTraceItems(
    model.verification,
    oracleExpectedTraceIndices(availableTraceRecords, true, maxCollectionItems),
    manifest,
    "test",
    "verification",
  );
  for (const [index, item] of model.summary.changed.entries()) {
    validateOracleEvidenceItem(item, `Observatory summary.changed[${index}]`);
  }
  validateOraclePublicRecords(
    model.records,
    oracleExpectedPublicRecords(manifest, maxRecords, maxCollectionItems),
  );

  const targetStoryId = manifest.query_targets.story_id;
  const targetStoryPath = manifest.query_targets.story_path;
  const targetIteration = model.iterations.find((item) => item?.id === targetStoryId);
  if (!targetIteration || !oracleHasSourcePath(targetIteration, targetStoryPath)) {
    throw new Error("Observatory cold model omitted the target iteration or its canonical source path");
  }
  const targetDossier = model.dossiers.find((item) => item?.storyId === targetStoryId);
  if (
    !targetDossier
    || targetDossier.schemaVersion !== "change-observatory:iteration-dossier:v1"
    || targetDossier.iterationId !== targetStoryId
    || !oracleHasSourcePath(targetDossier, targetStoryPath)
  ) {
    throw new Error("Observatory cold model omitted the target iteration dossier");
  }
  if (JSON.stringify(targetIteration.dossier) !== JSON.stringify(targetDossier)) {
    throw new Error("Observatory cold model target iteration is not attached to its dossier");
  }
  if (!isOracleObject(targetDossier.lanes)) {
    throw new TypeError("Observatory cold model target dossier omitted its lanes");
  }
  assertOracleObjectKeys(
    targetDossier.lanes,
    ["asked", "decided", "contract", "done", "verified"],
    "Observatory target dossier lanes",
  );
  const expectedLaneCounts = retainedDossierLaneCounts.get(targetStoryId);
  if (!expectedLaneCounts) {
    throw new Error("Observatory cold model target dossier was not covered by retained-lane validation");
  }
  for (const [lane, expected] of Object.entries(expectedLaneCounts)) {
    if (!Array.isArray(targetDossier.lanes[lane]?.items)) {
      throw new TypeError(`Observatory cold model target dossier ${lane} lane must contain items`);
    }
    if (targetDossier.lanes[lane].items.length !== expected) {
      throw new Error(
        `Observatory cold model target dossier ${lane} lane has ${targetDossier.lanes[lane].items.length} items; expected ${expected}`,
      );
    }
  }

  const incoherentDiagnosticCodes = new Set([
    "directory_unreadable",
    "file_too_large",
    "file_unreadable",
    "invalid_json",
    "invalid_jsonl",
    "invalid_jsonl_record_shape",
    "invalid_record_shape",
    "knowledge_base_missing",
    "max_depth_exceeded",
    "max_files_exceeded",
    "max_json_lines_exceeded",
    "max_total_bytes_exceeded",
    "project_record_missing",
  ]);
  if (model.diagnostics.length > maxDiagnostics) {
    throw new Error("Observatory cold model diagnostics exceed the configured bound");
  }
  const actualDiagnosticCodes = new Set();
  const diagnosticOccurrences = new Map();
  for (const diagnostic of model.diagnostics) {
    if (!isOracleObject(diagnostic)) {
      throw new TypeError("Observatory cold model returned a malformed diagnostic");
    }
    if (diagnostic.severity === "error" || incoherentDiagnosticCodes.has(diagnostic.code)) {
      throw new Error(`Observatory cold model reported incoherent diagnostic ${diagnostic.code}`);
    }
    if (
      typeof diagnostic.code !== "string"
      || diagnostic.code === ""
      || typeof diagnostic.message !== "string"
      || diagnostic.message === ""
      || !Number.isSafeInteger(diagnostic.occurrences)
      || diagnostic.occurrences < 1
      || !Array.isArray(diagnostic.sourceRefs)
    ) {
      throw new TypeError("Observatory cold model returned an incomplete diagnostic");
    }
    actualDiagnosticCodes.add(diagnostic.code);
    diagnosticOccurrences.set(
      diagnostic.code,
      (diagnosticOccurrences.get(diagnostic.code) ?? 0) + diagnostic.occurrences,
    );
  }
  const expectedTruncationCodes = new Set();
  const totalCanonicalRecords = baseRecords
    + manifest.scale.trace_events
    + manifest.scale.records;
  if (totalCanonicalRecords > maxRecords) expectedTruncationCodes.add("max_records_exceeded");
  if (
    expectedCounts.changes > maxCollectionItems
    || expectedCounts.verification > maxCollectionItems
    || expectedCounts.records > maxCollectionItems
    || expectedCounts.iterations > maxCollectionItems
    || expectedCounts.dossiers > maxCollectionItems
  ) {
    expectedTruncationCodes.add("collection_truncated");
  }
  if (manifest.scale.stories + availableTraceRecords > maxCollectionItems) {
    expectedTruncationCodes.add("dossier_nested_items_truncated");
  }
  const allowedDiagnosticCodes = new Set([
    "dossier_link_target_missing",
    "dossier_lane_missing",
    ...expectedTruncationCodes,
  ]);
  for (const code of actualDiagnosticCodes) {
    if (!allowedDiagnosticCodes.has(code)) {
      throw new Error(`Observatory cold model reported unexpected diagnostic ${code}`);
    }
  }
  for (const diagnostic of model.diagnostics) {
    const expectedSeverity = diagnostic.code === "dossier_lane_missing" ? "info" : "warning";
    if (diagnostic.severity !== expectedSeverity) {
      throw new Error(`Observatory cold model diagnostic ${diagnostic.code} has wrong severity`);
    }
  }
  const expectedLaneMissingOccurrences = oracleExpectedMissingLaneDiagnostics(
    manifest,
    availableTraceRecords,
    maxCollectionItems,
  );
  if (diagnosticOccurrences.get("dossier_link_target_missing") !== manifest.scale.stories * 2) {
    throw new Error("Observatory cold model dossier-link diagnostics do not match the fixture");
  }
  if (diagnosticOccurrences.get("dossier_lane_missing") !== expectedLaneMissingOccurrences) {
    throw new Error("Observatory cold model dossier-lane diagnostics do not match the fixture");
  }
  const expectedCollectionTruncations = [
    expectedCounts.changes,
    expectedCounts.iterations,
    expectedCounts.changes,
    expectedCounts.verification,
    expectedCounts.dossiers,
    expectedCounts.records,
  ].filter((count) => count > maxCollectionItems).length;
  if (
    expectedCollectionTruncations > 0
    && diagnosticOccurrences.get("collection_truncated") !== expectedCollectionTruncations
  ) {
    throw new Error("Observatory cold model collection-truncation diagnostics are incomplete");
  }
  if (
    totalCanonicalRecords > maxRecords
    && diagnosticOccurrences.get("max_records_exceeded") !== 1
  ) {
    throw new Error("Observatory cold model record-truncation diagnostic is incomplete");
  }
  for (const code of expectedTruncationCodes) {
    if (!actualDiagnosticCodes.has(code)) {
      throw new Error(`Observatory cold model omitted expected truncation diagnostic ${code}`);
    }
  }

  return {
    passed: true,
    schema_version: model.schemaVersion,
    generated_at: model.generatedAt,
    project_id: model.project.id,
    artifact: {
      size_bytes: stat.size,
      sha256_base64url: artifactSha256,
      max_bytes: maxBytes,
    },
    snapshots: {
      iterations: expectedCounts.iterations,
      dossiers: expectedCounts.dossiers,
      records: expectedCounts.records,
      changes: expectedCounts.changes,
      verification: expectedCounts.verification,
    },
    target: {
      story_id: targetStoryId,
      story_path: targetStoryPath,
      dossier_lane_counts: expectedLaneCounts,
    },
    truncation_diagnostics: [...expectedTruncationCodes].sort(),
  };
}

function validateEnterpriseFixtureManifestForOracle(manifest) {
  if (!isOracleObject(manifest) || manifest.schema_version !== "enterprise-foundation-fixture:v1") {
    throw new TypeError("Observatory model oracle requires an enterprise fixture manifest");
  }
  if (!isOracleObject(manifest.scale) || !isOracleObject(manifest.file_counts)) {
    throw new TypeError("Enterprise fixture manifest omitted scale or file counts");
  }
  for (const field of ["source_files", "stories", "records", "dependency_edges", "trace_events"]) {
    if (!Number.isSafeInteger(manifest.scale[field]) || manifest.scale[field] < 1) {
      throw new TypeError(`Enterprise fixture manifest returned invalid scale.${field}`);
    }
  }
  if (!Number.isSafeInteger(manifest.layout?.records_per_shard) || manifest.layout.records_per_shard < 1) {
    throw new TypeError("Enterprise fixture manifest returned invalid layout.records_per_shard");
  }
  const expectedFileCounts = {
    source_files: manifest.scale.source_files,
    story_files: manifest.scale.stories,
    record_shards: Math.ceil(manifest.scale.records / manifest.layout?.records_per_shard),
    dependency_files: 1,
    trace_files: Math.min(manifest.scale.stories, manifest.scale.trace_events),
  };
  expectedFileCounts.canonical_files = 2
    + expectedFileCounts.story_files
    + expectedFileCounts.record_shards
    + expectedFileCounts.trace_files;
  for (const [field, expected] of Object.entries(expectedFileCounts)) {
    if (manifest.file_counts[field] !== expected) {
      throw new Error(`Enterprise fixture manifest file_counts.${field} does not match its scale`);
    }
  }
  if (
    typeof manifest.generated_at !== "string"
    || typeof manifest.query_targets?.story_id !== "string"
    || typeof manifest.query_targets?.story_path !== "string"
  ) {
    throw new TypeError("Enterprise fixture manifest omitted model-oracle targets");
  }
}

function validateOracleIterations(
  iterations,
  dossiers,
  manifest,
  availableTraceRecords,
  maxCollectionItems,
) {
  if (iterations.length !== dossiers.length) {
    throw new Error("Observatory retained iterations and dossiers must have the same length");
  }
  const seenIterationIds = new Set();
  const seenDossierIds = new Set();
  const seenEvidenceIds = new Set();
  const retainedLaneCounts = new Map();
  let remainingNestedItems = maxCollectionItems;
  for (let index = 0; index < iterations.length; index += 1) {
    const expectedStoryId = oracleStoryId(index, manifest.scale.stories);
    const expectedPath = `.sdlc/stories/${expectedStoryId}/story.json`;
    const iteration = iterations[index];
    if (!isOracleObject(iteration) || iteration.id !== expectedStoryId) {
      throw new Error(`Observatory retained iteration ${index} does not match ${expectedStoryId}`);
    }
    if (seenIterationIds.has(iteration.id) || !oracleHasSourcePath(iteration, expectedPath)) {
      throw new Error(`Observatory retained iteration ${expectedStoryId} is duplicate or unproven`);
    }
    seenIterationIds.add(iteration.id);

    const dossier = dossiers[index];
    if (
      !isOracleObject(dossier)
      || dossier.schemaVersion !== "change-observatory:iteration-dossier:v1"
      || dossier.iterationId !== expectedStoryId
      || dossier.storyId !== expectedStoryId
      || dossier.provenance !== "recorded"
      || !oracleHasSourcePath(dossier, expectedPath)
      || !isOracleObject(dossier.links)
      || !Array.isArray(dossier.links.requirementIds)
      || !Array.isArray(dossier.links.contractIds)
      || !isOracleObject(dossier.lanes)
      || !Array.isArray(dossier.diagnostics)
      || dossier.status !== "partial"
    ) {
      throw new Error(`Observatory retained dossier ${index} is not a canonical story dossier`);
    }
    if (seenDossierIds.has(dossier.storyId)) {
      throw new Error(`Observatory retained dossier ${dossier.storyId} is duplicated`);
    }
    seenDossierIds.add(dossier.storyId);
    assertOracleObjectKeys(
      dossier.lanes,
      ["asked", "decided", "contract", "done", "verified"],
      `Observatory dossier ${expectedStoryId} lanes`,
    );
    const candidates = oracleDossierCandidateLaneCounts(
      index,
      availableTraceRecords,
      manifest,
    );
    const expectedCounts = {};
    for (const laneName of ["asked", "decided", "contract", "done", "verified"]) {
      const lane = dossier.lanes[laneName];
      const candidateCount = candidates[laneName];
      const expectedCount = Math.min(candidateCount, remainingNestedItems);
      remainingNestedItems -= expectedCount;
      expectedCounts[laneName] = expectedCount;
      const expectedStatus = expectedCount > 0
        ? "recorded"
        : candidateCount > 0 ? "malformed" : "missing";
      if (
        !isOracleObject(lane)
        || lane.status !== expectedStatus
        || lane.provenance !== expectedStatus
        || !Array.isArray(lane.sourceRefs)
        || lane.sourceRefs.length < 1
        || !Array.isArray(lane.items)
        || lane.items.length !== expectedCount
      ) {
        throw new TypeError(
          `Observatory dossier ${expectedStoryId} lane ${laneName} does not match its bounded evidence count`,
        );
      }
      for (const [itemIndex, item] of lane.items.entries()) {
        validateOracleEvidenceItem(
          item,
          `Observatory dossier ${expectedStoryId} ${laneName}[${itemIndex}]`,
        );
        if (seenEvidenceIds.has(item.id)) {
          throw new Error(`Observatory dossier evidence ${item.id} is duplicated`);
        }
        seenEvidenceIds.add(item.id);
        if (
          (laneName === "asked" && (item.id !== expectedStoryId || item.type !== "story"))
          || (laneName === "done"
            && (item.type !== "implementation" || item.storyId !== expectedStoryId))
          || (laneName === "verified" && (item.type !== "test" || item.storyId !== expectedStoryId))
        ) {
          throw new Error(
            `Observatory dossier ${expectedStoryId} lane ${laneName} contains foreign evidence`,
          );
        }
      }
    }
    retainedLaneCounts.set(expectedStoryId, expectedCounts);
    if (JSON.stringify(iteration.dossier) !== JSON.stringify(dossier)) {
      throw new Error(`Observatory retained iteration ${expectedStoryId} has a different dossier`);
    }
  }
  return retainedLaneCounts;
}

function oracleDossierCandidateLaneCounts(storyIndex, availableTraceRecords, manifest) {
  const range = oracleStoryTraceRange(storyIndex, manifest);
  const retainedEnd = Math.min(range.end, availableTraceRecords);
  const retainedTraceCount = Math.max(0, retainedEnd - range.start);
  const verified = retainedTraceCount === 0
    ? 0
    : oracleMultiplesOfFive(range.start, retainedEnd);
  return {
    asked: 1,
    decided: 0,
    contract: 0,
    done: retainedTraceCount - verified,
    verified,
  };
}

function oracleExpectedMissingLaneDiagnostics(
  manifest,
  availableTraceRecords,
  maxCollectionItems,
) {
  let remainingNestedItems = maxCollectionItems;
  let missing = 0;
  for (let storyIndex = 0; storyIndex < manifest.scale.stories; storyIndex += 1) {
    const candidates = oracleDossierCandidateLaneCounts(
      storyIndex,
      availableTraceRecords,
      manifest,
    );
    for (const laneName of ["asked", "decided", "contract", "done", "verified"]) {
      const candidateCount = candidates[laneName];
      const retained = Math.min(candidateCount, remainingNestedItems);
      remainingNestedItems -= retained;
      if (retained === 0 && candidateCount === 0) missing += 1;
    }
  }
  return missing;
}

function oracleStoryTraceRange(storyIndex, manifest) {
  const fileCount = manifest.file_counts.trace_files;
  if (storyIndex >= fileCount) return { start: manifest.scale.trace_events, end: manifest.scale.trace_events };
  const perFile = Math.floor(manifest.scale.trace_events / fileCount);
  const filesWithExtra = manifest.scale.trace_events % fileCount;
  const start = storyIndex < filesWithExtra
    ? storyIndex * (perFile + 1)
    : (perFile + 1) * filesWithExtra + (storyIndex - filesWithExtra) * perFile;
  const count = perFile + (storyIndex < filesWithExtra ? 1 : 0);
  return { start, end: start + count };
}

function oracleMultiplesOfFive(start, end) {
  if (end <= start) return 0;
  return Math.floor((end - 1) / 5) - Math.floor((start - 1) / 5);
}

function validateOracleEvidenceItem(item, label) {
  if (
    !isOracleObject(item)
    || typeof item.id !== "string"
    || item.id === ""
    || typeof item.type !== "string"
    || item.type === ""
    || typeof item.provenance !== "string"
    || item.provenance === ""
    || !Array.isArray(item.sourceRefs)
    || item.sourceRefs.length < 1
    || !item.sourceRefs.every((sourceRef) =>
      isOracleObject(sourceRef)
      && typeof sourceRef.path === "string"
      && sourceRef.path.startsWith(".sdlc/"))
  ) {
    throw new TypeError(`${label} is not canonical evidence`);
  }
}

function oracleExpectedTraceIndices(traceRecordCount, verification, limit) {
  const indices = [];
  for (let index = traceRecordCount - 1; index >= 0 && indices.length < limit; index -= 1) {
    if ((index % 5 === 0) === verification) indices.push(index);
  }
  return indices;
}

function validateOracleTraceItems(items, expectedIndices, manifest, expectedType, label) {
  if (items.length !== expectedIndices.length) {
    throw new Error(`Observatory ${label} retained an unexpected number of trace items`);
  }
  const width = oracleIdentifierWidth(manifest.scale.trace_events);
  const seen = new Set();
  for (let position = 0; position < items.length; position += 1) {
    const item = items[position];
    const traceIndex = expectedIndices[position];
    const expectedId = `TR-${String(traceIndex).padStart(width, "0")}`;
    const location = oracleTraceLocation(traceIndex, manifest);
    validateOracleEvidenceItem(item, `Observatory ${label}[${position}]`);
    if (
      item.id !== expectedId
      || item.type !== expectedType
      || item.storyId !== location.storyId
      || !oracleHasSourceLocation(item, location.path, location.line)
      || seen.has(item.id)
    ) {
      throw new Error(`Observatory ${label}[${position}] does not match deterministic trace ${expectedId}`);
    }
    seen.add(item.id);
  }
}

function oracleExpectedPublicRecords(manifest, maxRecords, maxCollectionItems) {
  const expected = [];
  let scanned = 0;
  const add = (record) => {
    if (scanned >= maxRecords) return false;
    scanned += 1;
    if (expected.length < maxCollectionItems) expected.push(record);
    return expected.length < maxCollectionItems;
  };
  if (!add({
    id: "DEP-ENTERPRISE-FIXTURE",
    kind: "dependency",
    path: manifest.query_targets.dependency_path,
    line: null,
    format: "json",
  })) return expected;
  if (!add({
    id: "project:.sdlc/project.json",
    kind: "project",
    path: ".sdlc/project.json",
    line: null,
    format: "json",
  })) return expected;
  for (let index = 0; index < manifest.scale.stories; index += 1) {
    const id = oracleStoryId(index, manifest.scale.stories);
    if (!add({
      id,
      kind: "story",
      path: `.sdlc/stories/${id}/story.json`,
      line: null,
      format: "json",
    })) return expected;
  }
  const traceWidth = oracleIdentifierWidth(manifest.scale.trace_events);
  for (let index = 0; index < manifest.scale.trace_events; index += 1) {
    const location = oracleTraceLocation(index, manifest);
    if (!add({
      id: `TR-${String(index).padStart(traceWidth, "0")}`,
      kind: "trace",
      path: location.path,
      line: location.line,
      format: "jsonl",
    })) return expected;
  }
  const recordWidth = oracleIdentifierWidth(manifest.scale.records);
  for (let index = 0; index < manifest.scale.records; index += 1) {
    const shard = Math.floor(index / manifest.layout.records_per_shard);
    if (!add({
      id: `REC-${String(index).padStart(recordWidth, "0")}`,
      kind: "record",
      path: `.sdlc/work-items/records-${String(shard).padStart(6, "0")}.jsonl`,
      line: (index % manifest.layout.records_per_shard) + 1,
      format: "jsonl",
    })) return expected;
  }
  return expected;
}

function validateOraclePublicRecords(items, expectedRecords) {
  if (items.length !== expectedRecords.length) {
    throw new Error("Observatory public records do not match the bounded fixture projection");
  }
  const seen = new Set();
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const expected = expectedRecords[index];
    if (
      !isOracleObject(item)
      || item.id !== expected.id
      || item.type !== expected.kind
      || item.kind !== expected.kind
      || item.path !== expected.path
      || item.line !== expected.line
      || item.format !== expected.format
      || item.provenance !== "recorded"
      || typeof item.rawHref !== "string"
      || item.rawHref === ""
      || !oracleHasSourceLocation(item, expected.path, expected.line)
    ) {
      throw new Error(`Observatory public record ${index} does not match ${expected.path}`);
    }
    const identity = `${item.path}:${item.line ?? 0}`;
    if (seen.has(identity)) throw new Error(`Observatory public record ${identity} is duplicated`);
    seen.add(identity);
  }
}

function oracleTraceLocation(index, manifest) {
  const fileCount = manifest.file_counts.trace_files;
  const perFile = Math.floor(manifest.scale.trace_events / fileCount);
  const filesWithExtra = manifest.scale.trace_events % fileCount;
  const expandedPrefix = (perFile + 1) * filesWithExtra;
  const storyIndex = index < expandedPrefix
    ? Math.floor(index / (perFile + 1))
    : filesWithExtra + Math.floor((index - expandedPrefix) / perFile);
  const storyStart = storyIndex < filesWithExtra
    ? storyIndex * (perFile + 1)
    : expandedPrefix + (storyIndex - filesWithExtra) * perFile;
  const storyId = oracleStoryId(storyIndex, manifest.scale.stories);
  return {
    storyId,
    path: `.sdlc/traces/${storyId}.jsonl`,
    line: index - storyStart + 1,
  };
}

function oracleStoryId(index, storyCount) {
  return `ST-ENT-${String(index).padStart(oracleIdentifierWidth(storyCount), "0")}`;
}

function oracleIdentifierWidth(count) {
  return Math.max(6, String(Math.max(0, count - 1)).length);
}

function oracleHasSourceLocation(value, expectedPath, expectedLine) {
  return Array.isArray(value?.sourceRefs) && value.sourceRefs.some((sourceRef) =>
    sourceRef?.path === expectedPath
    && (expectedLine === null ? sourceRef.line === undefined : sourceRef.line === expectedLine));
}

function oraclePositiveLimit(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function isOracleObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertOracleObjectKeys(value, expectedKeys, label) {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} returned an unexpected object shape`);
  }
}

function oracleHasSourcePath(value, expectedPath) {
  return Array.isArray(value?.sourceRefs)
    && value.sourceRefs.some((sourceRef) => sourceRef?.path === expectedPath);
}

function validateObservatoryWarmResponse(response, expectedEtag, requestNumber) {
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    throw new TypeError(`Observatory warm request ${requestNumber} returned an invalid response`);
  }
  if (response.statusCode !== 304) {
    throw new Error(
      `Observatory warm request ${requestNumber} returned HTTP ${response.statusCode}`,
    );
  }
  if (response.complete !== true) {
    throw new Error(`Observatory warm request ${requestNumber} was truncated`);
  }
  if (response.headers?.etag !== expectedEtag) {
    throw new Error(`Observatory warm request ${requestNumber} returned a different ETag`);
  }
  if (response.body_bytes !== 0) {
    throw new Error(`Observatory warm request ${requestNumber} returned a response body`);
  }
}

function runCanonicalQuery(session, manifest) {
  const sourceDiscovery = discoverBaselineSourcePaths({
    projectRoot: session.root,
    requestedPaths: [manifest.layout.source_root],
    policy: {
      max_discovered_files: manifest.scale.source_files + 1,
    },
  });
  if (sourceDiscovery.truncated) {
    throw new Error("Canonical source discovery exceeded the fixture scale");
  }
  const storyStatuses = {};
  const stories = session.stories();
  for (const story of stories) {
    const status = String(story.status || "unknown");
    storyStatuses[status] = (storyStatuses[status] || 0) + 1;
  }

  let records = 0;
  let targetRecord = null;
  for (const file of session.listFiles({
    under: manifest.layout.records_root,
    extensions: [".jsonl"],
  })) {
    for (const record of session.readJsonLines(file.path)) {
      if (!record.valid) continue;
      records += 1;
      if (record.value.id === manifest.query_targets.record_id) {
        targetRecord = {
          id: record.value.id,
          path: record.path,
          line: record.line,
          story_id: record.value.story_id,
          sequence: record.value.sequence,
        };
      }
    }
  }

  const dependencyGraph = session.readJson(manifest.query_targets.dependency_path);
  let traceEvents = 0;
  let targetStoryTraceEvents = 0;
  for (const file of session.listFiles({
    under: manifest.layout.traces_root,
    extensions: [".jsonl"],
  })) {
    for (const record of session.readJsonLines(file.path)) {
      if (!record.valid) continue;
      traceEvents += 1;
      if (record.value.story_id === manifest.query_targets.story_id) {
        targetStoryTraceEvents += 1;
      }
    }
  }

  return {
    canonical_files: session.catalog().files.length,
    source_files: sourceDiscovery.discovered_count,
    stories: stories.length,
    story_statuses: storyStatuses,
    records,
    dependency_edges: Array.isArray(dependencyGraph.edges) ? dependencyGraph.edges.length : 0,
    trace_events: traceEvents,
    target_story_trace_events: targetStoryTraceEvents,
    target_record_found: targetRecord !== null,
    target_record: targetRecord,
  };
}

function requestModel(running, agent, {
  ifNoneMatch = null,
  computeSha256 = false,
  outputPath = null,
  maxBodyBytes = MAX_COLD_MODEL_BYTES,
} = {}) {
  return new Promise((resolve, reject) => {
    let outputDescriptor = null;
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      if (outputDescriptor !== null) {
        try {
          fs.closeSync(outputDescriptor);
        } catch (error) {
          if (callback === resolve) {
            reject(error);
            return;
          }
        }
        outputDescriptor = null;
      }
      callback(value);
    };
    if (outputPath !== null) {
      try {
        outputDescriptor = fs.openSync(outputPath, "wx");
      } catch (error) {
        finish(reject, error);
        return;
      }
    }
    const headers = {
      Host: `${running.address.host}:${running.address.port}`,
      Authorization: `Bearer ${running.accessToken}`,
    };
    if (ifNoneMatch) headers["If-None-Match"] = ifNoneMatch;
    const request = http.request({
      host: running.address.host,
      port: running.address.port,
      path: "/api/v1/observatory",
      method: "GET",
      agent,
      headers,
    }, (response) => {
      let bodyBytes = 0;
      let ended = false;
      const digest = computeSha256 ? crypto.createHash("sha256") : null;
      let contentLength = null;
      try {
        contentLength = parseResponseContentLength(response.headers["content-length"]);
        if (contentLength !== null && contentLength > maxBodyBytes) {
          throw new Error(`Observatory response exceeds the ${maxBodyBytes}-byte cold-model limit`);
        }
      } catch (error) {
        response.destroy(error);
        finish(reject, error);
        return;
      }
      response.on("data", (chunk) => {
        if (settled) return;
        try {
          if (bodyBytes + chunk.byteLength > maxBodyBytes) {
            throw new Error(`Observatory response exceeds the ${maxBodyBytes}-byte cold-model limit`);
          }
          if (outputDescriptor === null) {
            bodyBytes += chunk.byteLength;
            digest?.update(chunk);
            return;
          }
          let offset = 0;
          while (offset < chunk.byteLength) {
            const bytesWritten = fs.writeSync(
              outputDescriptor,
              chunk,
              offset,
              chunk.byteLength - offset,
            );
            if (!Number.isSafeInteger(bytesWritten) || bytesWritten < 1) {
              throw new Error("Observatory cold model artifact write made no forward progress");
            }
            const written = chunk.subarray(offset, offset + bytesWritten);
            digest?.update(written);
            bodyBytes += bytesWritten;
            offset += bytesWritten;
          }
        } catch (error) {
          response.destroy(error);
          finish(reject, error);
        }
      });
      response.once("aborted", () => finish(
        reject,
        new Error("Observatory response was truncated before Content-Length was satisfied"),
      ));
      response.once("error", (error) => finish(reject, error));
      response.once("end", () => {
        ended = true;
        if (response.complete !== true) {
          finish(reject, new Error("Observatory response ended before the message was complete"));
          return;
        }
        let artifactSize = null;
        try {
          artifactSize = outputDescriptor === null ? null : fs.fstatSync(outputDescriptor).size;
        } catch (error) {
          finish(reject, error);
          return;
        }
        if (artifactSize !== null && artifactSize !== bodyBytes) {
          finish(reject, new Error(
            "Observatory cold model artifact size does not match streamed bytes",
          ));
          return;
        }
        finish(resolve, {
          statusCode: response.statusCode,
          headers: response.headers,
          body_bytes: bodyBytes,
          content_length: contentLength,
          complete: true,
          sha256_base64url: digest?.digest("base64url") ?? null,
          artifact_size_bytes: artifactSize,
        });
      });
      response.once("close", () => {
        if (!ended && response.complete !== true) {
          finish(reject, new Error("Observatory response connection closed before completion"));
        }
      });
    });
    request.on("error", (error) => finish(reject, error));
    request.end();
  });
}

function parseResponseContentLength(value) {
  if (value === undefined) return null;
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/u.test(value)) {
    throw new Error("Observatory response returned an invalid Content-Length header");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error("Observatory response Content-Length exceeds the safe integer range");
  }
  return parsed;
}

function sha256FileHex(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function platformThresholds(platform) {
  const windows = platform === "win32";
  return {
    query_ms: windows ? 4_000 : 2_000,
    observatory_warm_p95_ms: windows ? 250 : 100,
    rss_bytes: (windows ? 320 : 256) * 1024 * 1024,
  };
}

function memorySnapshot() {
  const memory = process.memoryUsage();
  const resourceUsage = typeof process.resourceUsage === "function" ? process.resourceUsage() : null;
  const resourceMax = normalizeResourceMaxRssBytes(resourceUsage?.maxRSS);
  return {
    rss_bytes: memory.rss,
    heap_used_bytes: memory.heapUsed,
    max_rss_bytes: Math.max(memory.rss, resourceMax),
  };
}

function detailedMemorySnapshot() {
  const memory = process.memoryUsage();
  const resourceUsage = typeof process.resourceUsage === "function" ? process.resourceUsage() : null;
  const resourceMax = normalizeResourceMaxRssBytes(resourceUsage?.maxRSS);
  return {
    rss_bytes: memory.rss,
    heap_total_bytes: memory.heapTotal,
    heap_used_bytes: memory.heapUsed,
    external_bytes: memory.external,
    array_buffers_bytes: memory.arrayBuffers,
    max_rss_bytes: Math.max(memory.rss, resourceMax),
  };
}

export function normalizeResourceMaxRssBytes(rawValue, {
  platform = process.platform,
  uvVersion = process.versions.uv,
} = {}) {
  const raw = Number(rawValue || 0);
  if (!Number.isSafeInteger(raw) || raw < 1) return 0;

  // libuv < 1.45 passed macOS getrusage bytes through unchanged. Starting
  // with 1.45, libuv normalizes macOS to the KiB contract used elsewhere.
  const multiplier = platform === "darwin" && compareVersions(uvVersion, "1.45.0") < 0
    ? 1
    : 1024;
  const bytes = raw * multiplier;
  if (!Number.isSafeInteger(bytes)) {
    throw new RangeError("Normalized max RSS exceeds the safe integer range");
  }
  return bytes;
}

function compareVersions(leftVersion, rightVersion) {
  const left = parseNumericVersion(leftVersion, "libuv version");
  const right = parseNumericVersion(rightVersion, "comparison version");
  const width = Math.max(left.length, right.length);
  for (let index = 0; index < width; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function parseNumericVersion(value, label) {
  if (typeof value !== "string" || !/^\d+(?:\.\d+){1,2}(?:[-+].*)?$/u.test(value)) {
    throw new TypeError(`${label} must be a numeric semantic version`);
  }
  return value.split(/[.+-]/u, 3).map((component) => Number.parseInt(component, 10));
}

function diagnosticWarmMilestones(iterations) {
  return new Set([
    1,
    Math.min(10, iterations),
    Math.max(1, Math.ceil(iterations / 2)),
    iterations,
  ]);
}

async function runDiagnosticGarbageCollection() {
  await new Promise((resolve) => setImmediate(resolve));
  globalThis.gc();
  await new Promise((resolve) => setImmediate(resolve));
  globalThis.gc();
}

function aggregateIsolatedMemory(canonicalQuery, observatory) {
  validateMemorySnapshot(canonicalQuery, "canonical query memory");
  validateMemorySnapshot(observatory, "Observatory memory");
  const aggregate = {
    aggregation: "maximum_of_isolated_workloads",
    rss_bytes: Math.max(canonicalQuery.rss_bytes, observatory.rss_bytes),
    heap_used_bytes: Math.max(canonicalQuery.heap_used_bytes, observatory.heap_used_bytes),
    max_rss_bytes: Math.max(canonicalQuery.max_rss_bytes, observatory.max_rss_bytes),
    canonical_query: canonicalQuery,
    observatory,
  };
  validateMemorySnapshot(aggregate, "aggregate isolated memory");
  for (const field of ["rss_bytes", "heap_used_bytes", "max_rss_bytes"]) {
    const expected = Math.max(canonicalQuery[field], observatory[field]);
    if (aggregate[field] !== expected) {
      throw new TypeError(`Aggregate isolated memory returned an inconsistent ${field}`);
    }
  }
  return aggregate;
}

function validateMemorySnapshot(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  for (const field of ["rss_bytes", "heap_used_bytes", "max_rss_bytes"]) {
    if (!Number.isSafeInteger(value[field]) || value[field] < 0) {
      throw new TypeError(`${label}.${field} must be a non-negative safe integer`);
    }
  }
  if (value.max_rss_bytes < value.rss_bytes) {
    throw new TypeError(`${label}.max_rss_bytes must be greater than or equal to rss_bytes`);
  }
  if (value.rss_bytes < value.heap_used_bytes) {
    throw new TypeError(`${label}.rss_bytes must be greater than or equal to heap_used_bytes`);
  }
}

function validateMemoryDiagnostics(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Observatory worker memory diagnostics must be an object");
  }
  if (typeof value.force_gc !== "boolean") {
    throw new TypeError("Observatory worker memory diagnostics force_gc must be a boolean");
  }
  if (typeof value.measured_at !== "string" || value.measured_at === "") {
    throw new TypeError("Observatory worker memory diagnostics measured_at must be a stage");
  }
  if (!Array.isArray(value.timeline) || value.timeline.length === 0) {
    throw new TypeError("Observatory worker memory diagnostics timeline must not be empty");
  }
  for (const [index, snapshot] of value.timeline.entries()) {
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
      throw new TypeError(`Observatory worker memory timeline entry ${index} must be an object`);
    }
    if (typeof snapshot.stage !== "string" || snapshot.stage === "") {
      throw new TypeError(`Observatory worker memory timeline entry ${index} must name a stage`);
    }
    for (const field of [
      "rss_bytes",
      "heap_total_bytes",
      "heap_used_bytes",
      "external_bytes",
      "array_buffers_bytes",
      "max_rss_bytes",
    ]) {
      if (!Number.isSafeInteger(snapshot[field]) || snapshot[field] < 0) {
        throw new TypeError(
          `Observatory worker memory timeline entry ${index}.${field} must be a non-negative safe integer`,
        );
      }
    }
    if (snapshot.max_rss_bytes < snapshot.rss_bytes) {
      throw new TypeError(
        `Observatory worker memory timeline entry ${index} has max RSS below current RSS`,
      );
    }
    if (snapshot.heap_total_bytes < snapshot.heap_used_bytes) {
      throw new TypeError(
        `Observatory worker memory timeline entry ${index} has heap total below heap used`,
      );
    }
  }
}

function validateWorkerProcess(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} process metadata must be an object`);
  }
  if (!Number.isSafeInteger(value.pid) || value.pid < 1) {
    throw new TypeError(`${label} returned an invalid process ID`);
  }
  if (!Number.isSafeInteger(value.parent_pid) || value.parent_pid < 1) {
    throw new TypeError(`${label} returned an invalid parent process ID`);
  }
}

export function sequentialWorkersAreIsolated(canonicalWorker, observatoryWorker, parentPid) {
  if (!Number.isSafeInteger(parentPid) || parentPid < 1) return false;
  for (const worker of [canonicalWorker, observatoryWorker]) {
    if (!worker || typeof worker !== "object" || Array.isArray(worker)) return false;
    if (!Number.isSafeInteger(worker.pid) || worker.pid < 1 || worker.pid === parentPid) {
      return false;
    }
    if (worker.parent_pid !== parentPid || worker.terminated !== true) return false;
  }
  return true;
}

function assertFiniteNonNegative(value, label) {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} must be a finite non-negative number`);
  }
}

function measure(callback) {
  const startedAt = performance.now();
  const value = callback();
  return { duration_ms: roundMilliseconds(performance.now() - startedAt), value };
}

async function measureAsync(callback) {
  const startedAt = performance.now();
  const value = await callback();
  return { duration_ms: roundMilliseconds(performance.now() - startedAt), value };
}

function percentile(values, fraction) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new TypeError("percentile requires at least one value");
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  return roundMilliseconds(sorted[index]);
}

function roundMilliseconds(value) {
  return Number(value.toFixed(3));
}

function positiveInteger(value, fallback, label) {
  const normalized = value === undefined || value === null ? fallback : Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 1) {
    throw new TypeError(`${label} must be a positive integer`);
  }
  return normalized;
}

function nonNegativeInteger(value, fallback, label) {
  const normalized = value === undefined || value === null ? fallback : Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new TypeError(`${label} must be a non-negative integer`);
  }
  return normalized;
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
    } else if (flag === "--out") {
      options.outputPath = requiredArgument(argv, ++index, flag);
    } else if (flag === "--diagnostic-memory-timeline") {
      options.diagnosticMemoryTimeline = true;
    } else if (flag === "--diagnostic-force-gc") {
      options.diagnosticMemoryTimeline = true;
      options.diagnosticForceGc = true;
    } else if (flag === "--enforce") {
      options.enforce = true;
    } else {
      throw new TypeError(`Unknown benchmark option: ${flag}`);
    }
  }
  return options;
}

function parseCanonicalQueryWorkerArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!["--fixture-root", "--fixture-manifest", "--expected-manifest-sha256"].includes(flag)) {
      throw new TypeError(`Unknown canonical query worker option: ${flag}`);
    }
    if (values.has(flag)) {
      throw new TypeError(`Duplicate canonical query worker option: ${flag}`);
    }
    values.set(flag, requiredArgument(argv, ++index, flag));
  }
  if (
    !values.has("--fixture-root")
    || !values.has("--fixture-manifest")
    || !values.has("--expected-manifest-sha256")
  ) {
    throw new TypeError(
      "Canonical query worker requires --fixture-root, --fixture-manifest and --expected-manifest-sha256",
    );
  }
  return {
    fixtureRoot: values.get("--fixture-root"),
    fixtureManifest: values.get("--fixture-manifest"),
    expectedManifestSha256: values.get("--expected-manifest-sha256"),
  };
}

function parseObservatoryWorkerArguments(argv) {
  const requiredFlags = [
    "--fixture-root",
    "--fixture-manifest",
    "--expected-manifest-sha256",
    "--limits-json",
  ];
  const optionalFlags = ["--memory-diagnostics-json"];
  const allowedFlags = [...requiredFlags, ...optionalFlags];
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!allowedFlags.includes(flag)) {
      throw new TypeError(`Unknown Observatory worker option: ${flag}`);
    }
    if (values.has(flag)) {
      throw new TypeError(`Duplicate Observatory worker option: ${flag}`);
    }
    values.set(flag, requiredArgument(argv, ++index, flag));
  }
  if (requiredFlags.some((flag) => !values.has(flag))) {
    throw new TypeError(
      "Observatory worker requires --fixture-root, --fixture-manifest, --expected-manifest-sha256 and --limits-json",
    );
  }
  const observatoryLimits = JSON.parse(values.get("--limits-json"));
  if (!observatoryLimits || typeof observatoryLimits !== "object" || Array.isArray(observatoryLimits)) {
    throw new TypeError("Observatory worker limits must be an object");
  }
  let memoryDiagnostics = null;
  if (values.has("--memory-diagnostics-json")) {
    memoryDiagnostics = JSON.parse(values.get("--memory-diagnostics-json"));
    if (
      !memoryDiagnostics
      || typeof memoryDiagnostics !== "object"
      || Array.isArray(memoryDiagnostics)
      || memoryDiagnostics.enabled !== true
      || (memoryDiagnostics.forceGc !== undefined
        && typeof memoryDiagnostics.forceGc !== "boolean")
    ) {
      throw new TypeError("Observatory worker memory diagnostics must be an enabled object");
    }
  }
  return {
    fixtureRoot: values.get("--fixture-root"),
    fixtureManifest: values.get("--fixture-manifest"),
    expectedManifestSha256: values.get("--expected-manifest-sha256"),
    observatoryLimits,
    memoryDiagnostics,
  };
}

function parseObservatoryModelVerifierArguments(argv) {
  const requiredFlags = [
    "--fixture-root",
    "--fixture-manifest",
    "--expected-manifest-sha256",
    "--model-artifact",
    "--expected-model-bytes",
    "--expected-model-sha256",
    "--limits-json",
  ];
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!requiredFlags.includes(flag)) {
      throw new TypeError(`Unknown Observatory model verifier option: ${flag}`);
    }
    if (values.has(flag)) {
      throw new TypeError(`Duplicate Observatory model verifier option: ${flag}`);
    }
    values.set(flag, requiredArgument(argv, ++index, flag));
  }
  if (requiredFlags.some((flag) => !values.has(flag))) {
    throw new TypeError("Observatory model verifier requires all integrity and fixture options");
  }
  const observatoryLimits = JSON.parse(values.get("--limits-json"));
  if (!isOracleObject(observatoryLimits)) {
    throw new TypeError("Observatory model verifier limits must be an object");
  }
  const expectedModelBytes = Number(values.get("--expected-model-bytes"));
  if (!Number.isSafeInteger(expectedModelBytes) || expectedModelBytes < 1) {
    throw new TypeError("Observatory model verifier expected bytes must be positive");
  }
  return {
    fixtureRoot: values.get("--fixture-root"),
    fixtureManifest: values.get("--fixture-manifest"),
    expectedManifestSha256: values.get("--expected-manifest-sha256"),
    modelArtifact: values.get("--model-artifact"),
    expectedModelBytes,
    expectedModelSha256: values.get("--expected-model-sha256"),
    observatoryLimits,
  };
}

function requiredArgument(argv, index, flag) {
  const value = argv[index];
  if (value === undefined || value.startsWith("--")) {
    throw new TypeError(`${flag} requires a value`);
  }
  return value;
}

function writeResult(value, outputPath = null) {
  const body = `${JSON.stringify(value, null, 2)}\n`;
  if (outputPath) {
    const target = path.resolve(String(outputPath));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, body, "utf8");
  }
  process.stdout.write(body);
}

function errorEnvelope(error) {
  return {
    schema_version: ENTERPRISE_PERFORMANCE_BENCHMARK_SCHEMA,
    ok: false,
    error: {
      code: "benchmark_failed",
      message: error instanceof Error ? error.message : String(error),
    },
  };
}

function canonicalQueryWorkerErrorEnvelope(error) {
  return {
    schema_version: ENTERPRISE_CANONICAL_QUERY_WORKER_SCHEMA,
    ok: false,
    workload: "canonical_query",
    process: {
      pid: process.pid,
      parent_pid: process.ppid,
    },
    error: {
      code: "canonical_query_worker_failed",
      message: error instanceof Error ? error.message : String(error),
    },
  };
}

function observatoryWorkerErrorEnvelope(error) {
  return {
    schema_version: ENTERPRISE_OBSERVATORY_WORKER_SCHEMA,
    type: OBSERVATORY_ERROR_MESSAGE,
    ok: false,
    workload: "observatory",
    role: OBSERVATORY_SERVER_ROLE,
    memory_scope: OBSERVATORY_MEMORY_SCOPE,
    process: {
      pid: process.pid,
      parent_pid: process.ppid,
    },
    error: {
      code: "observatory_worker_failed",
      message: error instanceof Error ? error.message : String(error),
    },
  };
}

function observatoryModelVerifierErrorEnvelope(error) {
  return {
    schema_version: ENTERPRISE_OBSERVATORY_MODEL_VERIFIER_SCHEMA,
    ok: false,
    workload: "observatory_model_verification",
    process: {
      pid: process.pid,
      parent_pid: process.ppid,
    },
    error: {
      code: "observatory_model_verifier_failed",
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
  const argumentsList = process.argv.slice(2);
  if (argumentsList[0] === CANONICAL_QUERY_WORKER_FLAG) {
    try {
      const workerOptions = parseCanonicalQueryWorkerArguments(argumentsList.slice(1));
      writeResult(await buildCanonicalQueryWorkerEnvelope(workerOptions));
    } catch (error) {
      writeResult(canonicalQueryWorkerErrorEnvelope(error));
      process.exitCode = 1;
    }
  } else if (argumentsList[0] === OBSERVATORY_WORKER_FLAG) {
    try {
      const workerOptions = parseObservatoryWorkerArguments(argumentsList.slice(1));
      await runObservatoryServerWorker(workerOptions);
    } catch (error) {
      try {
        await sendCurrentProcessIpcMessage(observatoryWorkerErrorEnvelope(error));
      } catch {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      }
      process.exitCode = 1;
    }
  } else if (argumentsList[0] === OBSERVATORY_MODEL_VERIFIER_FLAG) {
    try {
      const verifierOptions = parseObservatoryModelVerifierArguments(argumentsList.slice(1));
      writeResult(buildObservatoryModelVerifierEnvelope(verifierOptions));
    } catch (error) {
      writeResult(observatoryModelVerifierErrorEnvelope(error));
      process.exitCode = 1;
    }
  } else {
    let options = {};
    try {
      options = parseArguments(argumentsList);
      const result = await runEnterprisePerformanceBenchmark(options);
      writeResult(result, options.outputPath);
      if (options.enforce && !result.evaluation.passed) process.exitCode = 1;
    } catch (error) {
      writeResult(errorEnvelope(error), options.outputPath);
      process.exitCode = 1;
    }
  }
}

export { ENTERPRISE_FOUNDATION_DEFAULT_SCALE };
