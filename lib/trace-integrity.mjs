import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const EVENT_SCHEMA = "trace-integrity-event:v1";
const CHECKPOINT_SCHEMA = "trace-integrity-checkpoint:v1";
const HASH_ALGORITHM = "sha256";
const MODE = "local_tamper_evidence";
const INTEGRITY_FIELD = "_trace_integrity";
const WINDOWS_REPLACE_ERRORS = new Set(["EACCES", "EEXIST", "EPERM"]);

export class TraceIntegrityError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "TraceIntegrityError";
    this.code = code;
    if (options.details !== undefined) this.details = options.details;
  }
}

/**
 * Append one JSON event and durably seal it into the local trace hash chain.
 *
 * This is tamper evidence on the same host, not proof of authenticity. A party
 * able to rewrite both the trace and its checkpoint can create a new history.
 */
export function sealTraceEvent(options = {}) {
  const context = operationContext(options);
  const event = normalizeEvent(options.event);
  return withTraceLock(context, () => {
    restoreCheckpointBackup(context);
    let checkpoint = readCheckpoint(context, { required: false });
    const traceBytes = readTraceBytes(context, { missingAsEmpty: true });

    if (checkpoint === null) {
      const legacy = inspectLegacyPrefix(traceBytes);
      checkpoint = buildCheckpoint({
        context,
        legacy,
        committedOffset: traceBytes.length,
        newCount: 0,
        lastEventHash: legacy.sha256,
        rollingHash: initialRollingHash(legacy),
      });
      writeCheckpointAtomic(context, checkpoint, "initialize");
    }

    const recovery = recoverLocked(context, checkpoint);
    checkpoint = recovery.checkpoint;
    const integrity = verifyLocked(context, checkpoint);
    if (!integrity.valid) {
      throw new TraceIntegrityError(
        "integrity_violation",
        "Refusing to append because the trace or checkpoint failed local integrity verification",
        { details: integrity.errors },
      );
    }

    const sequence = checkpoint.new_writes.count + 1;
    const previousHash = checkpoint.new_writes.last_event_hash;
    const sealedEvent = sealEvent(event, sequence, previousHash, context.dependencies);
    const line = Buffer.from(`${JSON.stringify(sealedEvent)}\n`, "utf8");
    const appended = appendDurably(context, checkpoint.committed_offset, line, sealedEvent);
    const nextCheckpoint = buildCheckpoint({
      context,
      legacy: checkpoint.legacy_prefix,
      committedOffset: appended.endOffset,
      newCount: sequence,
      lastEventHash: sealedEvent[INTEGRITY_FIELD].event_hash,
      rollingHash: advanceRollingHash(
        checkpoint.new_writes.rolling_hash,
        hashBuffer(line, context.dependencies),
        context.dependencies,
      ),
    });
    writeCheckpointAtomic(context, nextCheckpoint, "append");

    return Object.freeze({
      event: deepFreeze(cloneJson(sealedEvent)),
      checkpoint: deepFreeze(cloneJson(nextCheckpoint)),
      recovery: deepFreeze(cloneJson(recovery.summary)),
      mode: MODE,
      authenticity_claimed: false,
    });
  });
}

/** Verify the immutable legacy prefix, new hash chain, and sidecar checkpoint. */
export function verifyTraceIntegrity(options = {}) {
  const context = operationContext(options);
  const backupPresent = isRegularFile(context.checkpointBackupPath, context.dependencies, {
    missing: true,
  });
  let checkpoint;
  try {
    checkpoint = readCheckpoint(context, { required: false });
  } catch (error) {
    if (!(error instanceof TraceIntegrityError) || error.code !== "checkpoint_invalid_json") throw error;
    const report = verifyLocked(context, null);
    report.initialized = true;
    addError(report, error.code, "checkpoint", error.message);
    report.checkpoint.status = "invalid";
    return deepFreeze(report);
  }
  const report = verifyLocked(context, checkpoint);
  if (checkpoint === null && backupPresent) {
    addError(report, "checkpoint_recovery_required", "checkpoint", "A recoverable checkpoint backup exists");
    report.recovery_needed = true;
    report.valid = false;
  }
  // Verification intentionally creates no lock or directory. A concurrent
  // writer can only produce a fail-closed transient mismatch, never a false
  // successful report assembled from an uncommitted append.
  return deepFreeze(report);
}

/**
 * Recover only interrupted writes produced by this module.
 *
 * Complete, valid chained records are adopted. An incomplete final record is
 * truncated to the last durable checkpoint. Complete invalid data is never
 * discarded automatically because it may be evidence of external tampering.
 */
export function recoverTraceIntegrity(options = {}) {
  const context = operationContext(options);
  return withTraceLock(context, () => {
    restoreCheckpointBackup(context);
    const checkpoint = readCheckpoint(context, { required: false });
    if (checkpoint === null) {
      const bytes = readTraceBytes(context, { missingAsEmpty: true });
      const lines = splitJsonLines(bytes);
      if (lines.records.some((record) => isSealedRecord(record.value))) {
        throw new TraceIntegrityError(
          "checkpoint_missing",
          "The trace contains sealed events but its integrity checkpoint is missing",
        );
      }
      if (lines.partial.length > 0) {
        throw new TraceIntegrityError(
          "legacy_prefix_incomplete",
          "An unsealed legacy trace ends with an incomplete JSONL record",
        );
      }
      return deepFreeze({
        recovered: false,
        adopted_events: 0,
        truncated_bytes: 0,
        checkpoint: null,
        mode: MODE,
        authenticity_claimed: false,
      });
    }
    const result = recoverLocked(context, checkpoint);
    return deepFreeze({ ...cloneJson(result.summary), checkpoint: cloneJson(result.checkpoint) });
  });
}

function operationContext(options) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("Trace integrity options must be an object");
  }
  const tracePath = requirePath(options.tracePath ?? options.trace_path, "tracePath");
  const checkpointPath = path.resolve(
    options.checkpointPath
      ?? options.checkpoint_path
      ?? path.join(path.dirname(tracePath), ".integrity", `${path.basename(tracePath)}.checkpoint.json`),
  );
  if (checkpointPath === tracePath) {
    throw new TraceIntegrityError("invalid_path", "Trace and checkpoint paths must be different");
  }
  const dependencies = resolveDependencies(options.dependencies);
  const hooks = normalizeHooks(options.hooks);
  return {
    tracePath,
    checkpointPath,
    checkpointBackupPath: `${checkpointPath}.previous`,
    lockPath: path.resolve(options.lockPath ?? options.lock_path ?? `${checkpointPath}.lock`),
    lockTimeoutMs: nonNegativeInteger(options.lockTimeoutMs ?? options.lock_timeout_ms ?? 5_000, "lockTimeoutMs"),
    lockRetryMs: positiveInteger(options.lockRetryMs ?? options.lock_retry_ms ?? 20, "lockRetryMs"),
    dependencies,
    hooks,
  };
}

function resolveDependencies(overrides = {}) {
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    throw new TypeError("Trace integrity dependencies must be an object");
  }
  const defaults = {
    appendWriteSync: fs.writeSync.bind(fs),
    chmodSync: fs.chmodSync.bind(fs),
    closeSync: fs.closeSync.bind(fs),
    constants: fs.constants,
    createHash: crypto.createHash.bind(crypto),
    existsSync: fs.existsSync.bind(fs),
    fstatSync: fs.fstatSync.bind(fs),
    fsyncSync: fs.fsyncSync.bind(fs),
    ftruncateSync: fs.ftruncateSync.bind(fs),
    lstatSync: fs.lstatSync.bind(fs),
    mkdirSync: fs.mkdirSync.bind(fs),
    now: () => new Date(),
    openSync: fs.openSync.bind(fs),
    platform: process.platform,
    processAlive: defaultProcessAlive,
    randomBytes: crypto.randomBytes.bind(crypto),
    readFileSync: fs.readFileSync.bind(fs),
    readSync: fs.readSync.bind(fs),
    renameSync: fs.renameSync.bind(fs),
    sleepSync: defaultSleepSync,
    unlinkSync: fs.unlinkSync.bind(fs),
    writeSync: fs.writeSync.bind(fs),
  };
  const resolved = { ...defaults, ...overrides };
  for (const name of [
    "appendWriteSync", "closeSync", "createHash", "fstatSync", "fsyncSync", "ftruncateSync",
    "lstatSync", "mkdirSync", "now", "openSync", "processAlive", "randomBytes", "readFileSync",
    "renameSync", "sleepSync", "unlinkSync", "writeSync",
  ]) {
    if (typeof resolved[name] !== "function") throw new TypeError(`Trace integrity dependency ${name} must be a function`);
  }
  return resolved;
}

function normalizeHooks(hooks = {}) {
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) {
    throw new TypeError("Trace integrity hooks must be an object");
  }
  for (const [name, hook] of Object.entries(hooks)) {
    if (typeof hook !== "function") throw new TypeError(`Trace integrity hook ${name} must be a function`);
  }
  return hooks;
}

function callHook(context, name, details) {
  const result = context.hooks[name]?.(Object.freeze({ ...details }));
  if (result && typeof result.then === "function") {
    throw new TypeError(`Trace integrity hook ${name} must be synchronous`);
  }
}

function withTraceLock(context, operation) {
  ensurePrivateDirectory(path.dirname(context.checkpointPath), context.dependencies);
  const lock = acquireLock(context);
  try {
    return operation();
  } finally {
    releaseLock(context, lock);
  }
}

function acquireLock(context) {
  const { dependencies: deps } = context;
  const startedAt = Date.now();
  const token = deps.randomBytes(16).toString("hex");
  const content = `${JSON.stringify({
    schema_version: "trace-integrity-lock:v1",
    pid: process.pid,
    token,
    created_at: isoNow(deps),
  })}\n`;
  const flags = deps.constants.O_WRONLY | deps.constants.O_CREAT | deps.constants.O_EXCL | noFollowFlag(deps);

  for (;;) {
    let descriptor;
    try {
      descriptor = deps.openSync(context.lockPath, flags, 0o600);
      assertOpenedRegularFile(context.lockPath, descriptor, deps);
      writeAll(descriptor, Buffer.from(content), deps.writeSync);
      deps.fsyncSync(descriptor);
      deps.closeSync(descriptor);
      descriptor = undefined;
      fsyncDirectory(path.dirname(context.lockPath), deps);
      return { token, content };
    } catch (error) {
      if (descriptor !== undefined) safeClose(descriptor, deps);
      if (error?.code !== "EEXIST") {
        if (error?.code === "ELOOP") throw symlinkError(context.lockPath, error);
        throw error;
      }
      if (reclaimDeadLock(context)) continue;
      if (Date.now() - startedAt >= context.lockTimeoutMs) {
        throw new TraceIntegrityError(
          "lock_timeout",
          `Timed out waiting for trace integrity lock: ${context.lockPath}`,
          { cause: error },
        );
      }
      deps.sleepSync(Math.max(0, Math.min(context.lockRetryMs, context.lockTimeoutMs - (Date.now() - startedAt))));
    }
  }
}

function reclaimDeadLock(context) {
  const { dependencies: deps } = context;
  let before;
  let record;
  try {
    before = deps.lstatSync(context.lockPath);
    if (before.isSymbolicLink()) throw symlinkError(context.lockPath);
    if (!before.isFile()) throw new TraceIntegrityError("invalid_lock", "Trace integrity lock is not a regular file");
    record = JSON.parse(readFileNoFollow(context.lockPath, deps).toString("utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    if (error instanceof TraceIntegrityError) throw error;
    return false;
  }
  if (!Number.isSafeInteger(record?.pid) || record.pid <= 0 || deps.processAlive(record.pid)) return false;
  let after;
  try {
    after = deps.lstatSync(context.lockPath);
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    throw error;
  }
  if (!sameFileIdentity(before, after)) return false;
  deps.unlinkSync(context.lockPath);
  fsyncDirectory(path.dirname(context.lockPath), deps);
  return true;
}

function releaseLock(context, lock) {
  const { dependencies: deps } = context;
  try {
    const content = readFileNoFollow(context.lockPath, deps).toString("utf8");
    const record = JSON.parse(content);
    if (record?.token !== lock.token) return;
    deps.unlinkSync(context.lockPath);
    fsyncDirectory(path.dirname(context.lockPath), deps);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function inspectLegacyPrefix(bytes) {
  const parsed = splitJsonLines(bytes);
  if (parsed.partial.length > 0) {
    throw new TraceIntegrityError(
      "legacy_prefix_incomplete",
      "The legacy JSONL prefix must end with a newline before integrity sealing can begin",
    );
  }
  for (const record of parsed.records) {
    if (isSealedRecord(record.value)) {
      throw new TraceIntegrityError(
        "checkpoint_missing",
        "A sealed trace event exists without its integrity checkpoint",
      );
    }
  }
  return {
    line_count: parsed.records.length,
    byte_length: bytes.length,
    sha256: hashBuffer(bytes),
  };
}

function buildCheckpoint({ context, legacy, committedOffset, newCount, lastEventHash, rollingHash }) {
  const body = {
    kind: "trace_integrity_checkpoint",
    schema_version: CHECKPOINT_SCHEMA,
    mode: MODE,
    authenticity_claimed: false,
    hash_algorithm: HASH_ALGORITHM,
    trace_file: path.basename(context.tracePath),
    legacy_prefix: {
      line_count: legacy.line_count,
      byte_length: legacy.byte_length,
      sha256: legacy.sha256,
    },
    new_writes: {
      count: newCount,
      first_sequence: newCount === 0 ? null : 1,
      last_sequence: newCount === 0 ? null : newCount,
      last_event_hash: lastEventHash,
      rolling_hash: rollingHash,
    },
    committed_offset: committedOffset,
    updated_at: isoNow(context.dependencies),
  };
  return { ...body, checkpoint_hash: hashCanonical(body, context.dependencies) };
}

function readCheckpoint(context, { required }) {
  let bytes;
  try {
    bytes = readFileNoFollow(context.checkpointPath, context.dependencies);
  } catch (error) {
    if (error?.code === "ENOENT" && !required) return null;
    if (error?.code === "ELOOP") throw symlinkError(context.checkpointPath, error);
    throw error;
  }
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw new TraceIntegrityError("checkpoint_invalid_json", "Integrity checkpoint is not valid JSON", { cause: error });
  }
}

function writeCheckpointAtomic(context, checkpoint, stage) {
  const { dependencies: deps } = context;
  const directory = path.dirname(context.checkpointPath);
  ensurePrivateDirectory(directory, deps);
  const token = deps.randomBytes(12).toString("hex");
  const temporaryPath = path.join(directory, `.${path.basename(context.checkpointPath)}.${process.pid}.${token}.tmp`);
  const content = Buffer.from(`${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
  let descriptor;
  let movedCurrent = false;
  try {
    descriptor = deps.openSync(
      temporaryPath,
      deps.constants.O_WRONLY | deps.constants.O_CREAT | deps.constants.O_EXCL | noFollowFlag(deps),
      0o600,
    );
    assertOpenedRegularFile(temporaryPath, descriptor, deps);
    writeAll(descriptor, content, deps.writeSync);
    deps.fsyncSync(descriptor);
    deps.closeSync(descriptor);
    descriptor = undefined;
    callHook(context, "before_checkpoint_commit", { stage, checkpoint: cloneJson(checkpoint) });
    try {
      deps.renameSync(temporaryPath, context.checkpointPath);
    } catch (error) {
      if (deps.platform !== "win32" || !WINDOWS_REPLACE_ERRORS.has(error?.code)) throw error;
      if (deps.existsSync(context.checkpointBackupPath)) {
        throw new TraceIntegrityError(
          "checkpoint_backup_exists",
          "Cannot replace the checkpoint while a previous recovery backup exists",
          { cause: error },
        );
      }
      deps.renameSync(context.checkpointPath, context.checkpointBackupPath);
      movedCurrent = true;
      fsyncDirectory(directory, deps);
      deps.renameSync(temporaryPath, context.checkpointPath);
    }
    fsyncDirectory(directory, deps);
    if (movedCurrent) {
      deps.unlinkSync(context.checkpointBackupPath);
      fsyncDirectory(directory, deps);
    }
    callHook(context, "after_checkpoint_commit", { stage, checkpoint: cloneJson(checkpoint) });
  } catch (error) {
    if (descriptor !== undefined) safeClose(descriptor, deps);
    if (movedCurrent && !deps.existsSync(context.checkpointPath) && deps.existsSync(context.checkpointBackupPath)) {
      try {
        deps.renameSync(context.checkpointBackupPath, context.checkpointPath);
        fsyncDirectory(directory, deps);
      } catch {
        // Leave the fixed .previous file for deterministic recovery on the next operation.
      }
    }
    try {
      if (deps.existsSync(temporaryPath)) deps.unlinkSync(temporaryPath);
    } catch {
      // A leftover same-directory temp file is harmless and never treated as canonical state.
    }
    throw error;
  }
}

function restoreCheckpointBackup(context) {
  const { dependencies: deps } = context;
  const checkpointExists = deps.existsSync(context.checkpointPath);
  const backupExists = deps.existsSync(context.checkpointBackupPath);
  if (!backupExists) return false;
  const backupIsFile = isRegularFile(context.checkpointBackupPath, deps);
  if (!backupIsFile) throw new TraceIntegrityError("checkpoint_backup_invalid", "Checkpoint recovery backup is not a regular file");
  if (checkpointExists) {
    const current = readCheckpoint(context, { required: true });
    const currentErrors = validateCheckpoint(current, context);
    if (currentErrors.length > 0) {
      throw new TraceIntegrityError(
        "checkpoint_recovery_ambiguous",
        "Both current and backup checkpoints exist, but the current checkpoint is invalid; neither was discarded",
        { details: currentErrors },
      );
    }
    deps.unlinkSync(context.checkpointBackupPath);
    fsyncDirectory(path.dirname(context.checkpointPath), deps);
    return false;
  }
  deps.renameSync(context.checkpointBackupPath, context.checkpointPath);
  fsyncDirectory(path.dirname(context.checkpointPath), deps);
  return true;
}

function appendDurably(context, expectedOffset, line, sealedEvent) {
  const { dependencies: deps } = context;
  deps.mkdirSync(path.dirname(context.tracePath), { recursive: true, mode: 0o700 });
  const flags = deps.constants.O_WRONLY | deps.constants.O_APPEND | deps.constants.O_CREAT | noFollowFlag(deps);
  let descriptor;
  try {
    descriptor = deps.openSync(context.tracePath, flags, 0o600);
    assertOpenedRegularFile(context.tracePath, descriptor, deps);
    const startOffset = Number(deps.fstatSync(descriptor).size);
    if (startOffset !== expectedOffset) {
      throw new TraceIntegrityError(
        "checkpoint_drift",
        `Trace length ${startOffset} does not match committed offset ${expectedOffset}`,
      );
    }
    callHook(context, "before_append", { start_offset: startOffset, bytes: line.length, event: cloneJson(sealedEvent) });
    writeAll(descriptor, line, deps.appendWriteSync);
    callHook(context, "after_append_write", { start_offset: startOffset, bytes: line.length, event: cloneJson(sealedEvent) });
    deps.fsyncSync(descriptor);
    fsyncDirectory(path.dirname(context.tracePath), deps);
    callHook(context, "after_append_fsync", { start_offset: startOffset, bytes: line.length, event: cloneJson(sealedEvent) });
    return { startOffset, endOffset: startOffset + line.length };
  } catch (error) {
    if (error?.code === "ELOOP") throw symlinkError(context.tracePath, error);
    throw error;
  } finally {
    if (descriptor !== undefined) safeClose(descriptor, deps);
  }
}

function recoverLocked(context, checkpoint) {
  const before = verifyLocked(context, checkpoint, { allowUncommittedTail: true });
  if (!before.valid) {
    throw new TraceIntegrityError(
      "integrity_violation",
      "Cannot recover because committed trace data or its checkpoint failed verification",
      { details: before.errors },
    );
  }
  const bytes = readTraceBytes(context, { missingAsEmpty: true });
  const tail = bytes.subarray(checkpoint.committed_offset);
  if (tail.length === 0) {
    return {
      checkpoint,
      summary: {
        recovered: false,
        adopted_events: 0,
        truncated_bytes: 0,
        mode: MODE,
        authenticity_claimed: false,
      },
    };
  }

  const parsed = splitJsonLines(tail);
  let expectedSequence = checkpoint.new_writes.count + 1;
  let previousHash = checkpoint.new_writes.last_event_hash;
  let rollingHash = checkpoint.new_writes.rolling_hash;
  let adoptedBytes = 0;
  for (const record of parsed.records) {
    const errors = validateSealedRecord(record.value, expectedSequence, previousHash, context.dependencies);
    if (errors.length > 0) {
      throw new TraceIntegrityError(
        "unexpected_complete_tail",
        "A complete uncommitted trace record is invalid and will not be discarded automatically",
        { details: errors },
      );
    }
    const line = tail.subarray(record.start, record.end);
    rollingHash = advanceRollingHash(rollingHash, hashBuffer(line, context.dependencies), context.dependencies);
    previousHash = record.value[INTEGRITY_FIELD].event_hash;
    expectedSequence += 1;
    adoptedBytes = record.end;
  }

  const truncatedBytes = parsed.partial.length;
  const recoveredOffset = checkpoint.committed_offset + adoptedBytes;
  if (truncatedBytes > 0) {
    callHook(context, "before_recovery_truncate", {
      committed_offset: checkpoint.committed_offset,
      recovered_offset: recoveredOffset,
      truncated_bytes: truncatedBytes,
    });
    truncateDurably(context, recoveredOffset);
    callHook(context, "after_recovery_truncate", {
      recovered_offset: recoveredOffset,
      truncated_bytes: truncatedBytes,
    });
  }

  const adoptedEvents = parsed.records.length;
  let recoveredCheckpoint = checkpoint;
  if (adoptedEvents > 0) {
    recoveredCheckpoint = buildCheckpoint({
      context,
      legacy: checkpoint.legacy_prefix,
      committedOffset: recoveredOffset,
      newCount: checkpoint.new_writes.count + adoptedEvents,
      lastEventHash: previousHash,
      rollingHash,
    });
    writeCheckpointAtomic(context, recoveredCheckpoint, "recovery");
  }
  return {
    checkpoint: recoveredCheckpoint,
    summary: {
      recovered: adoptedEvents > 0 || truncatedBytes > 0,
      adopted_events: adoptedEvents,
      truncated_bytes: truncatedBytes,
      mode: MODE,
      authenticity_claimed: false,
    },
  };
}

function truncateDurably(context, length) {
  const { dependencies: deps } = context;
  let descriptor;
  try {
    descriptor = deps.openSync(context.tracePath, deps.constants.O_WRONLY | noFollowFlag(deps));
    assertOpenedRegularFile(context.tracePath, descriptor, deps);
    deps.ftruncateSync(descriptor, length);
    deps.fsyncSync(descriptor);
  } catch (error) {
    if (error?.code === "ELOOP") throw symlinkError(context.tracePath, error);
    throw error;
  } finally {
    if (descriptor !== undefined) safeClose(descriptor, deps);
  }
}

function verifyLocked(context, checkpoint, { allowUncommittedTail = false } = {}) {
  const bytes = readTraceBytes(context, { missingAsEmpty: true });
  const report = {
    valid: true,
    mode: MODE,
    authenticity_claimed: false,
    initialized: checkpoint !== null,
    trace_path: context.tracePath,
    checkpoint_path: context.checkpointPath,
    recovery_needed: false,
    legacy_prefix: { valid: true, status: checkpoint ? "pending" : "unsealed", line_count: 0, byte_length: bytes.length, sha256: null, errors: [] },
    new_writes: { valid: true, status: checkpoint ? "pending" : "not_initialized", count: 0, last_sequence: null, last_event_hash: null, rolling_hash: null, errors: [] },
    checkpoint: { valid: true, status: checkpoint ? "pending" : "missing", errors: [] },
    errors: [],
  };

  if (checkpoint === null) {
    try {
      const legacy = inspectLegacyPrefix(bytes);
      Object.assign(report.legacy_prefix, { status: "unsealed", ...legacy });
    } catch (error) {
      const code = error?.code ?? "trace_invalid";
      addError(report, code, code === "checkpoint_missing" ? "checkpoint" : "legacy_prefix", error.message);
      if (code === "checkpoint_missing") report.recovery_needed = true;
    }
    return report;
  }

  const checkpointErrors = validateCheckpoint(checkpoint, context);
  for (const entry of checkpointErrors) addError(report, entry.code, "checkpoint", entry.message);
  if (checkpointErrors.some((entry) => entry.fatal)) {
    report.legacy_prefix.status = "unknown";
    report.new_writes.status = "unknown";
    report.checkpoint.status = "invalid";
    return report;
  }

  const legacyLength = checkpoint.legacy_prefix.byte_length;
  const committedOffset = checkpoint.committed_offset;
  if (bytes.length < committedOffset) {
    addError(report, "trace_truncated", "new_writes", `Trace has ${bytes.length} bytes but checkpoint commits ${committedOffset}`);
  } else if (bytes.length > committedOffset && !allowUncommittedTail) {
    addError(report, "checkpoint_drift", "checkpoint", `Trace has ${bytes.length - committedOffset} uncommitted bytes after the checkpoint`);
    report.recovery_needed = true;
  }
  if (bytes.length < legacyLength) {
    addError(report, "legacy_prefix_truncated", "legacy_prefix", "Trace is shorter than its sealed legacy prefix");
    return report;
  }

  const legacyBytes = bytes.subarray(0, legacyLength);
  const actualLegacyHash = hashBuffer(legacyBytes, context.dependencies);
  let legacyRecords = [];
  try {
    const parsedLegacy = splitJsonLines(legacyBytes);
    legacyRecords = parsedLegacy.records;
    if (parsedLegacy.partial.length > 0) {
      addError(report, "legacy_prefix_boundary_invalid", "legacy_prefix", "Legacy prefix boundary splits a JSONL record");
    }
  } catch (error) {
    addError(report, "legacy_prefix_invalid_json", "legacy_prefix", error.message);
  }
  Object.assign(report.legacy_prefix, {
    status: report.legacy_prefix.valid ? "verified" : "invalid",
    line_count: legacyRecords.length,
    byte_length: legacyLength,
    sha256: actualLegacyHash,
  });
  if (actualLegacyHash !== checkpoint.legacy_prefix.sha256) {
    addError(report, "legacy_prefix_modified", "legacy_prefix", "Legacy prefix bytes no longer match the checkpoint hash");
  }
  if (legacyRecords.length !== checkpoint.legacy_prefix.line_count) {
    addError(report, "legacy_prefix_line_count_mismatch", "legacy_prefix", "Legacy prefix line count no longer matches the checkpoint");
  }

  const availableCommittedEnd = Math.min(committedOffset, bytes.length);
  const newBytes = bytes.subarray(legacyLength, availableCommittedEnd);
  let parsedNew = { records: [], partial: Buffer.alloc(0) };
  try {
    parsedNew = splitJsonLines(newBytes);
  } catch (error) {
    addError(report, "new_write_invalid_json", "new_writes", error.message);
  }
  if (parsedNew.partial.length > 0) {
    addError(report, "trace_truncated", "new_writes", "Committed new-write data ends with an incomplete JSONL record");
  }

  let expectedSequence = 1;
  let previousHash = checkpoint.legacy_prefix.sha256;
  let rollingHash = initialRollingHash(checkpoint.legacy_prefix, context.dependencies);
  const seenEventHashes = new Set();
  for (const record of parsedNew.records) {
    const recordErrors = validateSealedRecord(record.value, expectedSequence, previousHash, context.dependencies);
    for (const entry of recordErrors) addError(report, entry.code, "new_writes", entry.message, { line: checkpoint.legacy_prefix.line_count + expectedSequence });
    const eventHash = record.value?.[INTEGRITY_FIELD]?.event_hash;
    if (typeof eventHash === "string" && seenEventHashes.has(eventHash)) {
      addError(report, "duplicate_event", "new_writes", `Duplicate sealed event hash at sequence ${expectedSequence}`);
    }
    if (typeof eventHash === "string") seenEventHashes.add(eventHash);
    const line = newBytes.subarray(record.start, record.end);
    rollingHash = advanceRollingHash(rollingHash, hashBuffer(line, context.dependencies), context.dependencies);
    if (typeof eventHash === "string") previousHash = eventHash;
    expectedSequence += 1;
  }

  const actualCount = parsedNew.records.length;
  Object.assign(report.new_writes, {
    status: report.new_writes.valid ? "verified" : "invalid",
    count: actualCount,
    last_sequence: actualCount === 0 ? null : actualCount,
    last_event_hash: previousHash,
    rolling_hash: rollingHash,
  });
  if (actualCount !== checkpoint.new_writes.count) {
    addError(report, "event_deleted_or_missing", "new_writes", `Checkpoint expects ${checkpoint.new_writes.count} sealed events but found ${actualCount}`);
  }
  if (previousHash !== checkpoint.new_writes.last_event_hash) {
    addError(report, "last_event_hash_mismatch", "new_writes", "Last event hash no longer matches the checkpoint");
  }
  if (rollingHash !== checkpoint.new_writes.rolling_hash) {
    addError(report, "rolling_hash_mismatch", "new_writes", "New-write byte history no longer matches the checkpoint");
  }
  if (legacyLength + newBytes.length !== committedOffset) {
    addError(report, "checkpoint_offset_mismatch", "checkpoint", "Checkpoint offset does not align with its legacy and new-write records");
  }

  report.legacy_prefix.status = report.legacy_prefix.valid ? "verified" : "invalid";
  report.new_writes.status = report.new_writes.valid ? "verified" : "invalid";
  report.checkpoint.status = report.checkpoint.valid ? "verified" : "invalid";
  return report;
}

function validateCheckpoint(checkpoint, context) {
  const errors = [];
  const fatal = (code, message) => errors.push({ code, message, fatal: true });
  const soft = (code, message) => errors.push({ code, message, fatal: false });
  if (!checkpoint || typeof checkpoint !== "object" || Array.isArray(checkpoint)) {
    fatal("checkpoint_shape_invalid", "Checkpoint must be a JSON object");
    return errors;
  }
  if (checkpoint.schema_version !== CHECKPOINT_SCHEMA) fatal("checkpoint_schema_invalid", `Checkpoint schema must be ${CHECKPOINT_SCHEMA}`);
  if (checkpoint.kind !== "trace_integrity_checkpoint") fatal("checkpoint_kind_invalid", "Checkpoint kind is invalid");
  if (checkpoint.mode !== MODE || checkpoint.authenticity_claimed !== false) {
    soft("checkpoint_claim_invalid", "Checkpoint must describe local tamper evidence without claiming authenticity");
  }
  if (checkpoint.hash_algorithm !== HASH_ALGORITHM) fatal("checkpoint_hash_algorithm_invalid", "Checkpoint hash algorithm must be sha256");
  if (checkpoint.trace_file !== path.basename(context.tracePath)) soft("checkpoint_trace_mismatch", "Checkpoint is bound to a different trace filename");
  if (!isLegacySummary(checkpoint.legacy_prefix)) fatal("checkpoint_legacy_invalid", "Checkpoint legacy_prefix is invalid");
  if (!isNewWriteSummary(checkpoint.new_writes)) fatal("checkpoint_new_writes_invalid", "Checkpoint new_writes is invalid");
  if (!Number.isSafeInteger(checkpoint.committed_offset) || checkpoint.committed_offset < 0) fatal("checkpoint_offset_invalid", "Checkpoint committed_offset is invalid");
  if (errors.some((entry) => entry.fatal)) return errors;
  const body = { ...checkpoint };
  delete body.checkpoint_hash;
  const expectedHash = hashCanonical(body, context.dependencies);
  if (checkpoint.checkpoint_hash !== expectedHash) soft("checkpoint_hash_mismatch", "Checkpoint content does not match its self-hash");
  if (checkpoint.committed_offset < checkpoint.legacy_prefix.byte_length) soft("checkpoint_offset_invalid", "Checkpoint offset precedes the legacy prefix boundary");
  if (checkpoint.new_writes.count === 0 && checkpoint.new_writes.last_event_hash !== checkpoint.legacy_prefix.sha256) {
    soft("checkpoint_anchor_mismatch", "Empty new-write chain is not anchored to the legacy prefix hash");
  }
  return errors;
}

function validateSealedRecord(record, expectedSequence, previousHash, dependencies) {
  const errors = [];
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return [{ code: "sealed_event_invalid", message: `Sequence ${expectedSequence} is not a JSON object` }];
  }
  const integrity = record[INTEGRITY_FIELD];
  if (!integrity || typeof integrity !== "object" || Array.isArray(integrity)) {
    return [{ code: "sealed_event_missing_integrity", message: `Sequence ${expectedSequence} lacks integrity metadata` }];
  }
  if (integrity.schema_version !== EVENT_SCHEMA) errors.push({ code: "sealed_event_schema_invalid", message: `Sequence ${expectedSequence} has an invalid integrity schema` });
  if (integrity.mode !== MODE || integrity.authenticity_claimed !== false) errors.push({ code: "sealed_event_claim_invalid", message: `Sequence ${expectedSequence} makes an invalid integrity claim` });
  if (integrity.hash_algorithm !== HASH_ALGORITHM) errors.push({ code: "sealed_event_hash_algorithm_invalid", message: `Sequence ${expectedSequence} must use sha256` });
  if (integrity.sequence !== expectedSequence) errors.push({ code: "event_reordered", message: `Expected sequence ${expectedSequence}, found ${String(integrity.sequence)}` });
  if (integrity.previous_hash !== previousHash) errors.push({ code: "previous_hash_mismatch", message: `Sequence ${expectedSequence} is not chained to the previous event` });
  const cleanEvent = { ...record };
  delete cleanEvent[INTEGRITY_FIELD];
  const baseIntegrity = { ...integrity };
  delete baseIntegrity.event_hash;
  let expectedHash;
  try {
    expectedHash = hashCanonical({ event: cleanEvent, integrity: baseIntegrity }, dependencies);
  } catch (error) {
    errors.push({ code: "sealed_event_invalid", message: `Sequence ${expectedSequence} cannot be canonicalized: ${error.message}` });
  }
  if (expectedHash && integrity.event_hash !== expectedHash) errors.push({ code: "event_hash_mismatch", message: `Sequence ${expectedSequence} content does not match its event hash` });
  return errors;
}

function sealEvent(event, sequence, previousHash, dependencies) {
  const integrity = {
    schema_version: EVENT_SCHEMA,
    mode: MODE,
    authenticity_claimed: false,
    hash_algorithm: HASH_ALGORITHM,
    sequence,
    previous_hash: previousHash,
  };
  const eventHash = hashCanonical({ event, integrity }, dependencies);
  return { ...cloneJson(event), [INTEGRITY_FIELD]: { ...integrity, event_hash: eventHash } };
}

function normalizeEvent(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new TraceIntegrityError("event_invalid", "Trace event must be a plain JSON object");
  }
  if (Object.hasOwn(event, INTEGRITY_FIELD)) {
    throw new TraceIntegrityError("reserved_field", `Trace event cannot define reserved field ${INTEGRITY_FIELD}`);
  }
  canonicalJson(event);
  return cloneJson(event);
}

function splitJsonLines(bytes) {
  const records = [];
  let start = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] !== 0x0a) continue;
    const end = index + 1;
    let contentEnd = index;
    if (contentEnd > start && bytes[contentEnd - 1] === 0x0d) contentEnd -= 1;
    const text = bytes.subarray(start, contentEnd).toString("utf8");
    if (text.trim() === "") {
      throw new TraceIntegrityError("blank_jsonl_record", `Blank JSONL record at byte ${start}`);
    }
    try {
      records.push({ start, end, value: JSON.parse(text) });
    } catch (error) {
      throw new TraceIntegrityError("invalid_jsonl_record", `Invalid JSONL record at byte ${start}`, { cause: error });
    }
    start = end;
  }
  return { records, partial: bytes.subarray(start) };
}

function isSealedRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) && value[INTEGRITY_FIELD]?.schema_version === EVENT_SCHEMA;
}

function readTraceBytes(context, { missingAsEmpty }) {
  try {
    return readFileNoFollow(context.tracePath, context.dependencies);
  } catch (error) {
    if (error?.code === "ENOENT" && missingAsEmpty) return Buffer.alloc(0);
    if (error?.code === "ELOOP") throw symlinkError(context.tracePath, error);
    throw error;
  }
}

function readFileNoFollow(filePath, dependencies) {
  let descriptor;
  try {
    descriptor = dependencies.openSync(filePath, dependencies.constants.O_RDONLY | noFollowFlag(dependencies));
    assertOpenedRegularFile(filePath, descriptor, dependencies);
    return dependencies.readFileSync(descriptor);
  } finally {
    if (descriptor !== undefined) safeClose(descriptor, dependencies);
  }
}

function assertOpenedRegularFile(filePath, descriptor, dependencies) {
  const opened = dependencies.fstatSync(descriptor);
  if (!opened.isFile()) throw new TraceIntegrityError("not_regular_file", `Refusing non-regular file: ${filePath}`);
  const current = dependencies.lstatSync(filePath);
  if (current.isSymbolicLink()) throw symlinkError(filePath);
  if (!current.isFile() || !sameFileIdentity(opened, current)) {
    throw new TraceIntegrityError("file_replaced", `File changed while it was being opened: ${filePath}`);
  }
}

function sameFileIdentity(left, right) {
  if (left.dev === undefined || right.dev === undefined || left.ino === undefined || right.ino === undefined) return true;
  if (Number(left.ino) === 0 || Number(right.ino) === 0) {
    return Number(left.size) === Number(right.size) && Number(left.mtimeMs) === Number(right.mtimeMs);
  }
  return left.dev === right.dev && left.ino === right.ino;
}

function isRegularFile(filePath, dependencies, { missing = false } = {}) {
  try {
    const stat = dependencies.lstatSync(filePath);
    if (stat.isSymbolicLink()) throw symlinkError(filePath);
    return stat.isFile();
  } catch (error) {
    if (error?.code === "ENOENT" && missing) return false;
    throw error;
  }
}

function ensurePrivateDirectory(directory, dependencies) {
  const existed = dependencies.existsSync(directory);
  dependencies.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = dependencies.lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new TraceIntegrityError("unsafe_directory", `Integrity directory must be a real directory: ${directory}`);
  }
  if (!existed) {
    try {
      dependencies.chmodSync(directory, 0o700);
    } catch (error) {
      if (dependencies.platform !== "win32") throw error;
    }
  }
}

function fsyncDirectory(directory, dependencies) {
  let descriptor;
  try {
    descriptor = dependencies.openSync(directory, dependencies.constants.O_RDONLY);
    dependencies.fsyncSync(descriptor);
  } catch (error) {
    if (dependencies.platform !== "win32" || !["EACCES", "EBADF", "EINVAL", "EISDIR", "EPERM"].includes(error?.code)) throw error;
  } finally {
    if (descriptor !== undefined) safeClose(descriptor, dependencies);
  }
}

function writeAll(descriptor, buffer, writer) {
  let offset = 0;
  while (offset < buffer.length) {
    const written = writer(descriptor, buffer, offset, buffer.length - offset, null);
    if (!Number.isInteger(written) || written <= 0) {
      throw new TraceIntegrityError("short_write", "Filesystem append made no forward progress");
    }
    offset += written;
  }
}

function safeClose(descriptor, dependencies) {
  try {
    dependencies.closeSync(descriptor);
  } catch {
    // Preserve the primary filesystem error.
  }
}

function initialRollingHash(legacy, dependencies) {
  return hashString(`trace-integrity-rolling:v1\0${legacy.byte_length}\0${legacy.sha256}`, dependencies);
}

function advanceRollingHash(previous, lineHash, dependencies) {
  return hashString(`trace-integrity-record:v1\0${previous}\0${lineHash}`, dependencies);
}

function hashCanonical(value, dependencies) {
  return hashString(canonicalJson(value), dependencies);
}

function hashString(value, dependencies) {
  const createHash = dependencies?.createHash ?? crypto.createHash.bind(crypto);
  return createHash(HASH_ALGORITHM).update(value, "utf8").digest("hex");
}

function hashBuffer(value, dependencies) {
  const createHash = dependencies?.createHash ?? crypto.createHash.bind(crypto);
  return createHash(HASH_ALGORITHM).update(value).digest("hex");
}

function canonicalJson(value) {
  const seen = new Set();
  const normalize = (current, label) => {
    if (current === null || typeof current === "string" || typeof current === "boolean") return current;
    if (typeof current === "number") {
      if (!Number.isFinite(current)) throw new TraceIntegrityError("non_json_value", `${label} must contain only finite JSON numbers`);
      return current;
    }
    if (Array.isArray(current)) {
      if (seen.has(current)) throw new TraceIntegrityError("cyclic_value", `${label} cannot contain cycles`);
      seen.add(current);
      const result = current.map((entry, index) => normalize(entry, `${label}[${index}]`));
      seen.delete(current);
      return result;
    }
    if (typeof current !== "object" || current === undefined) {
      throw new TraceIntegrityError("non_json_value", `${label} contains a non-JSON value`);
    }
    const prototype = Object.getPrototypeOf(current);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TraceIntegrityError("non_plain_object", `${label} must contain only plain JSON objects`);
    }
    if (seen.has(current)) throw new TraceIntegrityError("cyclic_value", `${label} cannot contain cycles`);
    seen.add(current);
    const result = {};
    for (const key of Object.keys(current).sort()) result[key] = normalize(current[key], `${label}.${key}`);
    seen.delete(current);
    return result;
  };
  return JSON.stringify(normalize(value, "value"));
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const entry of Object.values(value)) deepFreeze(entry);
  return Object.freeze(value);
}

function addError(report, code, scope, message, details = {}) {
  const entry = { code, scope, message, ...details };
  report.errors.push(entry);
  report.valid = false;
  report[scope].valid = false;
  report[scope].errors.push(entry);
}

function isLegacySummary(value) {
  return value
    && typeof value === "object"
    && Number.isSafeInteger(value.line_count)
    && value.line_count >= 0
    && Number.isSafeInteger(value.byte_length)
    && value.byte_length >= 0
    && isSha256(value.sha256);
}

function isNewWriteSummary(value) {
  return value
    && typeof value === "object"
    && Number.isSafeInteger(value.count)
    && value.count >= 0
    && (value.count === 0
      ? value.first_sequence === null && value.last_sequence === null
      : value.first_sequence === 1 && value.last_sequence === value.count)
    && isSha256(value.last_event_hash)
    && isSha256(value.rolling_hash);
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function noFollowFlag(dependencies) {
  return dependencies.constants.O_NOFOLLOW ?? 0;
}

function isoNow(dependencies) {
  const value = dependencies.now();
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TraceIntegrityError("invalid_time", "Injected clock returned an invalid time");
  return date.toISOString();
}

function defaultProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

function defaultSleepSync(milliseconds) {
  if (milliseconds <= 0) return;
  const signal = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(signal, 0, 0, milliseconds);
}

function requirePath(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${name} must be a non-empty path`);
  return path.resolve(value);
}

function nonNegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} must be a non-negative integer`);
  return value;
}

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${name} must be a positive integer`);
  return value;
}

function symlinkError(filePath, cause) {
  return new TraceIntegrityError("symlink_forbidden", `Refusing symbolic link: ${filePath}`, { cause });
}
