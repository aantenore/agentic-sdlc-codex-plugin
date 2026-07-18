import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  TraceIntegrityError,
  recoverTraceIntegrity,
  sealTraceEvent,
  verifyTraceIntegrity,
} from "../../lib/trace-integrity.mjs";

function fixture(t, { legacy = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "trace-integrity-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
  const tracePath = path.join(root, "trace.jsonl");
  const checkpointPath = path.join(root, ".integrity", "trace.checkpoint.json");
  if (legacy) {
    fs.writeFileSync(tracePath, '{"type":"legacy","value":1}\n{"type":"legacy","value":2}\n');
  }
  return { root, tracePath, checkpointPath };
}

function options(paths, extra = {}) {
  return { tracePath: paths.tracePath, checkpointPath: paths.checkpointPath, ...extra };
}

function jsonLines(tracePath) {
  return fs.readFileSync(tracePath, "utf8").trimEnd().split("\n").map((line) => JSON.parse(line));
}

function writeLines(tracePath, records) {
  fs.writeFileSync(tracePath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
}

function sealedFixture(t) {
  const paths = fixture(t);
  sealTraceEvent(options(paths, { event: { type: "command", id: "one", value: 1 } }));
  sealTraceEvent(options(paths, { event: { type: "command", id: "two", value: 2 } }));
  return paths;
}

function errorCodes(report) {
  return new Set(report.errors.map((entry) => entry.code));
}

test("seals a legacy prefix and returns synchronous, locally verifiable events", (t) => {
  const paths = fixture(t);
  const first = sealTraceEvent(options(paths, {
    event: { type: "command", id: "one", nested: { ok: true } },
    dependencies: { now: () => new Date("2026-07-18T10:00:00.000Z") },
  }));

  assert.equal(first.mode, "local_tamper_evidence");
  assert.equal(first.authenticity_claimed, false);
  assert.equal(first.event.type, "command");
  assert.equal(first.event._trace_integrity.sequence, 1);
  assert.equal(first.event._trace_integrity.authenticity_claimed, false);
  assert.equal(first.checkpoint.legacy_prefix.line_count, 2);
  assert.equal(first.checkpoint.new_writes.count, 1);
  assert.equal(first.recovery.recovered, false);
  assert.throws(() => { first.event.type = "changed"; }, TypeError);

  const second = sealTraceEvent(options(paths, { event: { type: "command", id: "two" } }));
  assert.equal(second.event._trace_integrity.sequence, 2);
  assert.equal(
    second.event._trace_integrity.previous_hash,
    first.event._trace_integrity.event_hash,
  );

  const report = verifyTraceIntegrity(options(paths));
  assert.equal(report.valid, true);
  assert.equal(report.initialized, true);
  assert.equal(report.legacy_prefix.status, "verified");
  assert.equal(report.legacy_prefix.line_count, 2);
  assert.equal(report.new_writes.status, "verified");
  assert.equal(report.new_writes.count, 2);
  assert.equal(report.checkpoint.status, "verified");
  assert.equal(report.authenticity_claimed, false);
});

test("reports an intact legacy-only trace as unsealed rather than authenticated", (t) => {
  const paths = fixture(t);
  const report = verifyTraceIntegrity(options(paths));
  assert.equal(report.valid, true);
  assert.equal(report.initialized, false);
  assert.equal(report.legacy_prefix.status, "unsealed");
  assert.equal(report.new_writes.status, "not_initialized");
  assert.equal(report.checkpoint.status, "missing");
  assert.equal(report.authenticity_claimed, false);
  assert.equal(fs.existsSync(path.dirname(paths.checkpointPath)), false);
});

test("detects modification of the immutable legacy prefix", (t) => {
  const paths = sealedFixture(t);
  const bytes = fs.readFileSync(paths.tracePath);
  const marker = bytes.indexOf(Buffer.from("legacy"));
  bytes[marker] = "L".charCodeAt(0);
  fs.writeFileSync(paths.tracePath, bytes);

  const report = verifyTraceIntegrity(options(paths));
  assert.equal(report.valid, false);
  assert.equal(report.legacy_prefix.valid, false);
  assert.equal(errorCodes(report).has("legacy_prefix_modified"), true);
});

test("detects modification of a sealed event, including exact JSONL byte drift", (t) => {
  const paths = sealedFixture(t);
  const records = jsonLines(paths.tracePath);
  records[2].value = 99;
  writeLines(paths.tracePath, records);

  const report = verifyTraceIntegrity(options(paths));
  assert.equal(report.valid, false);
  assert.equal(report.new_writes.valid, false);
  assert.equal(errorCodes(report).has("event_hash_mismatch"), true);
  assert.equal(errorCodes(report).has("rolling_hash_mismatch"), true);
});

test("detects deletion of a sealed record", (t) => {
  const paths = sealedFixture(t);
  const records = jsonLines(paths.tracePath);
  records.splice(2, 1);
  writeLines(paths.tracePath, records);

  const report = verifyTraceIntegrity(options(paths));
  assert.equal(report.valid, false);
  assert.equal(errorCodes(report).has("trace_truncated"), true);
  assert.equal(errorCodes(report).has("event_deleted_or_missing"), true);
});

test("detects reordered sealed records", (t) => {
  const paths = sealedFixture(t);
  const records = jsonLines(paths.tracePath);
  [records[2], records[3]] = [records[3], records[2]];
  writeLines(paths.tracePath, records);

  const report = verifyTraceIntegrity(options(paths));
  assert.equal(report.valid, false);
  assert.equal(errorCodes(report).has("event_reordered"), true);
  assert.equal(errorCodes(report).has("previous_hash_mismatch"), true);
});

test("detects duplicated sealed records", (t) => {
  const paths = sealedFixture(t);
  const records = jsonLines(paths.tracePath);
  records.splice(3, 0, structuredClone(records[2]));
  writeLines(paths.tracePath, records);

  const report = verifyTraceIntegrity(options(paths));
  assert.equal(report.valid, false);
  assert.equal(errorCodes(report).has("duplicate_event"), true);
});

test("detects trace truncation and an incomplete committed record", (t) => {
  const paths = sealedFixture(t);
  const bytes = fs.readFileSync(paths.tracePath);
  fs.writeFileSync(paths.tracePath, bytes.subarray(0, bytes.length - 13));

  const report = verifyTraceIntegrity(options(paths));
  assert.equal(report.valid, false);
  assert.equal(errorCodes(report).has("trace_truncated"), true);
});

test("detects bytes appended beyond the checkpoint without silently adopting them", (t) => {
  const paths = sealedFixture(t);
  fs.appendFileSync(paths.tracePath, '{"foreign":true}\n');

  const report = verifyTraceIntegrity(options(paths));
  assert.equal(report.valid, false);
  assert.equal(report.recovery_needed, true);
  assert.equal(errorCodes(report).has("checkpoint_drift"), true);
  assert.throws(
    () => recoverTraceIntegrity(options(paths)),
    (error) => error instanceof TraceIntegrityError && error.code === "unexpected_complete_tail",
  );
});

test("detects checkpoint field drift through its self-hash and trace comparison", (t) => {
  const paths = sealedFixture(t);
  const checkpoint = JSON.parse(fs.readFileSync(paths.checkpointPath, "utf8"));
  checkpoint.new_writes.rolling_hash = "0".repeat(64);
  fs.writeFileSync(paths.checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`);

  const report = verifyTraceIntegrity(options(paths));
  assert.equal(report.valid, false);
  assert.equal(report.checkpoint.valid, false);
  assert.equal(errorCodes(report).has("checkpoint_hash_mismatch"), true);
  assert.equal(errorCodes(report).has("rolling_hash_mismatch"), true);
});

test("reports a malformed checkpoint as invalid without hiding the sealed trace", (t) => {
  const paths = sealedFixture(t);
  fs.writeFileSync(paths.checkpointPath, "{not-json\n");

  const report = verifyTraceIntegrity(options(paths));
  assert.equal(report.valid, false);
  assert.equal(report.initialized, true);
  assert.equal(report.checkpoint.status, "invalid");
  assert.equal(errorCodes(report).has("checkpoint_invalid_json"), true);
  assert.equal(errorCodes(report).has("checkpoint_missing"), true);
});

test("does not re-baseline sealed events when their checkpoint is deleted", (t) => {
  const paths = sealedFixture(t);
  fs.unlinkSync(paths.checkpointPath);

  const report = verifyTraceIntegrity(options(paths));
  assert.equal(report.valid, false);
  assert.equal(errorCodes(report).has("checkpoint_missing"), true);
  assert.throws(
    () => sealTraceEvent(options(paths, { event: { type: "third" } })),
    (error) => error instanceof TraceIntegrityError && error.code === "checkpoint_missing",
  );
});

test("adopts a complete fsynced event after a crash before checkpoint commit", (t) => {
  const paths = fixture(t, { legacy: false });
  sealTraceEvent(options(paths, { event: { type: "first" } }));
  assert.throws(
    () => sealTraceEvent(options(paths, {
      event: { type: "recover-me" },
      hooks: {
        after_append_fsync() {
          throw new Error("simulated process crash after append fsync");
        },
      },
    })),
    /simulated process crash/,
  );

  const before = verifyTraceIntegrity(options(paths));
  assert.equal(before.valid, false);
  assert.equal(before.recovery_needed, true);
  const recovered = recoverTraceIntegrity(options(paths));
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.adopted_events, 1);
  assert.equal(recovered.truncated_bytes, 0);
  assert.equal(recovered.checkpoint.new_writes.count, 2);
  assert.equal(verifyTraceIntegrity(options(paths)).valid, true);
});

test("truncates only an incomplete append and retains the last durable checkpoint", (t) => {
  const paths = fixture(t, { legacy: false });
  sealTraceEvent(options(paths, { event: { type: "first" } }));
  let injected = false;
  const partialWriter = (descriptor, buffer, offset, length, position) => {
    if (!injected) {
      injected = true;
      const partialLength = Math.max(1, Math.floor(length / 2));
      fs.writeSync(descriptor, buffer, offset, partialLength, position);
      const error = new Error("simulated partial append");
      error.code = "EIO";
      throw error;
    }
    return fs.writeSync(descriptor, buffer, offset, length, position);
  };
  assert.throws(
    () => sealTraceEvent(options(paths, {
      event: { type: "partial" },
      dependencies: { appendWriteSync: partialWriter },
    })),
    /simulated partial append/,
  );

  const recovered = recoverTraceIntegrity(options(paths));
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.adopted_events, 0);
  assert.ok(recovered.truncated_bytes > 0);
  const report = verifyTraceIntegrity(options(paths));
  assert.equal(report.valid, true);
  assert.equal(report.new_writes.count, 1);
});

test("refuses an incomplete legacy prefix rather than modifying it", (t) => {
  const paths = fixture(t, { legacy: false });
  fs.writeFileSync(paths.tracePath, '{"legacy":true}');
  assert.throws(
    () => sealTraceEvent(options(paths, { event: { type: "first" } })),
    (error) => error instanceof TraceIntegrityError && error.code === "legacy_prefix_incomplete",
  );
  assert.equal(fs.readFileSync(paths.tracePath, "utf8"), '{"legacy":true}');
});

test("serializes writers with an owned lock and reclaims a proven dead owner", (t) => {
  const paths = fixture(t, { legacy: false });
  fs.mkdirSync(path.dirname(paths.checkpointPath), { recursive: true });
  const lockPath = `${paths.checkpointPath}.lock`;
  fs.writeFileSync(lockPath, `${JSON.stringify({ pid: process.pid, token: "live" })}\n`);
  assert.throws(
    () => sealTraceEvent(options(paths, {
      event: { type: "blocked" },
      lockTimeoutMs: 0,
    })),
    (error) => error instanceof TraceIntegrityError && error.code === "lock_timeout",
  );

  fs.writeFileSync(lockPath, `${JSON.stringify({ pid: 999_999_999, token: "dead" })}\n`);
  const result = sealTraceEvent(options(paths, {
    event: { type: "after-dead-owner" },
    dependencies: { processAlive: () => false },
  }));
  assert.equal(result.event._trace_integrity.sequence, 1);
  assert.equal(fs.existsSync(lockPath), false);
});

test("rejects a symbolic-link trace at the no-follow append boundary", (t) => {
  if (process.platform === "win32") return;
  const paths = fixture(t, { legacy: false });
  const target = path.join(paths.root, "target.jsonl");
  fs.writeFileSync(target, "");
  fs.symlinkSync(target, paths.tracePath);

  assert.throws(
    () => sealTraceEvent(options(paths, { event: { type: "first" } })),
    (error) => error instanceof TraceIntegrityError && error.code === "symlink_forbidden",
  );
});

test("uses the deterministic Windows checkpoint replacement fallback", (t) => {
  const paths = fixture(t, { legacy: false });
  sealTraceEvent(options(paths, { event: { type: "first" } }));
  let fallbackTriggered = false;
  const renameSync = (source, destination) => {
    const replacingCheckpoint = destination === paths.checkpointPath
      && path.basename(source).endsWith(".tmp")
      && fs.existsSync(paths.checkpointPath);
    if (replacingCheckpoint && !fallbackTriggered) {
      fallbackTriggered = true;
      const error = new Error("simulated Windows replacement denial");
      error.code = "EPERM";
      throw error;
    }
    return fs.renameSync(source, destination);
  };

  const result = sealTraceEvent(options(paths, {
    event: { type: "second" },
    dependencies: { platform: "win32", renameSync },
  }));
  assert.equal(fallbackTriggered, true);
  assert.equal(result.event._trace_integrity.sequence, 2);
  assert.equal(fs.existsSync(`${paths.checkpointPath}.previous`), false);
  assert.equal(verifyTraceIntegrity(options(paths)).valid, true);
});

test("rejects reserved metadata and non-JSON event values", (t) => {
  const paths = fixture(t, { legacy: false });
  assert.throws(
    () => sealTraceEvent(options(paths, { event: { _trace_integrity: {} } })),
    (error) => error instanceof TraceIntegrityError && error.code === "reserved_field",
  );
  assert.throws(
    () => sealTraceEvent(options(paths, { event: { invalid: undefined } })),
    (error) => error instanceof TraceIntegrityError && error.code === "non_json_value",
  );
});
