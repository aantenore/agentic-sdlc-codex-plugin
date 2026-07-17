import crypto from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import {
  CANONICAL_SOURCE_EXTENSIONS,
  normalizeObservatoryLimits,
} from "./constants.mjs";
import {
  ObservatoryPathError,
  assertDirectoryIdentity,
  captureDirectoryIdentity,
  isContainedPath,
  resolveKnowledgeBaseBoundary,
} from "./path-safety.mjs";

const DERIVED_DIRECTORIES = new Set(["cache", "indexes"]);
const SUPPORTED_EXTENSIONS = new Set(CANONICAL_SOURCE_EXTENSIONS);
const NO_FOLLOW_FLAG = fsConstants.O_NOFOLLOW ?? 0;
const REVISION_FORMAT = "change-observatory:canonical-revision:v1";
const DEFAULT_STABILITY_ATTEMPTS = 2;
const DEFAULT_VALIDATION_CONCURRENCY = 32;
const MAX_VALIDATION_CONCURRENCY = 128;

export function createObservatoryModelCache(options = {}) {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("Observatory model cache options must be an object");
  }
  if (typeof options.projectRoot !== "string" || options.projectRoot.trim() === "") {
    throw new TypeError("Observatory model cache requires a project root");
  }
  if (typeof options.buildModel !== "function") {
    throw new TypeError("Observatory model cache requires a model builder");
  }
  if (options.serialize !== undefined && typeof options.serialize !== "function") {
    throw new TypeError("Observatory model cache serializer must be a function");
  }
  if (options.onFastPathCheck !== undefined && typeof options.onFastPathCheck !== "function") {
    throw new TypeError("Observatory model cache onFastPathCheck must be a function");
  }

  const projectRoot = options.projectRoot;
  const buildModel = options.buildModel;
  const serialize = options.serialize ?? serializeJson;
  const limits = normalizeObservatoryLimits(options.limits);
  const stabilityAttempts = options.stabilityAttempts ?? DEFAULT_STABILITY_ATTEMPTS;
  if (!Number.isSafeInteger(stabilityAttempts) || stabilityAttempts < 1) {
    throw new TypeError("Observatory model cache stabilityAttempts must be a positive safe integer");
  }
  const validationConcurrency = options.validationConcurrency ?? DEFAULT_VALIDATION_CONCURRENCY;
  if (
    !Number.isSafeInteger(validationConcurrency)
    || validationConcurrency < 1
    || validationConcurrency > MAX_VALIDATION_CONCURRENCY
  ) {
    throw new TypeError(
      `Observatory model cache validationConcurrency must be an integer between 1 and ${MAX_VALIDATION_CONCURRENCY}`,
    );
  }
  const onFastPathCheck = options.onFastPathCheck ?? null;

  let cached = null;
  let inFlight = null;
  let projectIdentity = null;
  let digestIndex = new Map();
  let validationSnapshot = null;

  async function get() {
    if (inFlight) return inFlight;

    const operation = refresh();
    inFlight = operation;
    try {
      return await operation;
    } finally {
      if (inFlight === operation) inFlight = null;
    }
  }

  async function refresh() {
    if (!projectIdentity) {
      projectIdentity = await captureDirectoryIdentity(projectRoot, {
        code: "project_boundary_changed",
        label: "project root",
      });
    } else {
      await assertDirectoryIdentity(projectIdentity);
    }

    if (cached && validationSnapshot) {
      const valid = await validateCanonicalSnapshot(projectIdentity, validationSnapshot, {
        concurrency: validationConcurrency,
        onCheck: onFastPathCheck,
      });
      await assertDirectoryIdentity(projectIdentity);
      if (valid) return cached;
    }

    let before = await scanCanonicalRevision(projectIdentity.root, {
      limits,
      previousDigestIndex: digestIndex,
    });
    digestIndex = before.digestIndex;
    await assertDirectoryIdentity(projectIdentity);

    if (cached && cached.revision === before.revision) {
      validationSnapshot = before.validationSnapshot;
      return cached;
    }

    for (let attempt = 0; attempt < stabilityAttempts; attempt += 1) {
      const model = await buildModel();
      const body = normalizeSerializedBody(await serialize(model));
      const after = await scanCanonicalRevision(projectIdentity.root, {
        limits,
        previousDigestIndex: before.digestIndex,
      });
      digestIndex = after.digestIndex;
      await assertDirectoryIdentity(projectIdentity);

      if (before.revision === after.revision) {
        const entry = Object.freeze({
          revision: after.revision,
          etag: strongEtag(body),
          body,
        });
        cached = entry;
        validationSnapshot = after.validationSnapshot;
        return entry;
      }
      before = after;
    }

    throw new ObservatoryPathError(
      "canonical_revision_changed",
      "Canonical evidence changed while the Observatory model was being built",
      409,
    );
  }

  return Object.freeze({
    get,
    clear() {
      cached = null;
      validationSnapshot = null;
    },
  });
}

export async function computeCanonicalRevision(projectRoot, options = {}) {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("Canonical revision options must be an object");
  }
  if (options.onDirectorySnapshot !== undefined && typeof options.onDirectorySnapshot !== "function") {
    throw new TypeError("Canonical revision onDirectorySnapshot must be a function");
  }
  const scan = await scanCanonicalRevision(projectRoot, {
    limits: normalizeObservatoryLimits(options.limits),
    onDirectorySnapshot: options.onDirectorySnapshot ?? null,
    previousDigestIndex: new Map(),
  });
  return scan.revision;
}

async function scanCanonicalRevision(projectRoot, {
  limits,
  onDirectorySnapshot = null,
  previousDigestIndex,
}) {
  const boundary = await resolveKnowledgeBaseBoundary(projectRoot, { allowMissing: true });
  const projectIdentity = await captureDirectoryIdentity(boundary.projectRoot, {
    code: "project_boundary_changed",
    label: "project root",
  });
  const revision = crypto.createHash("sha256");
  appendHashField(revision, REVISION_FORMAT);

  if (!boundary.knowledgeBaseRoot) {
    appendRevisionRecord(revision, "knowledge-base", ".sdlc", "missing");
    await assertDirectoryIdentity(projectIdentity);
    return {
      revision: revision.digest("hex"),
      digestIndex: new Map(),
      validationSnapshot: emptyValidationSnapshot(boundary.projectRoot),
    };
  }

  const knowledgeBaseIdentity = await captureDirectoryIdentity(boundary.knowledgeBaseRoot, {
    code: "knowledge_base_boundary_changed",
    label: "project knowledge base",
  });
  const state = {
    digestIndex: new Map(),
    directoryObservations: [],
    fileCount: 0,
    fileObservations: [],
    limitRecorded: false,
    symlinkObservations: [],
    totalBytes: 0n,
    unreadableEntryObservations: [],
    stopped: false,
    limits,
    onDirectorySnapshot,
    previousDigestIndex,
    revision,
    root: boundary.knowledgeBaseRoot,
  };

  appendRevisionRecord(revision, "knowledge-base", ".sdlc", "present");
  await walkCanonicalDirectory(state, boundary.knowledgeBaseRoot, "", 0);
  await verifyObservations(state);
  await assertDirectoryIdentity(knowledgeBaseIdentity);
  await assertDirectoryIdentity(projectIdentity);

  return {
    revision: revision.digest("hex"),
    digestIndex: state.digestIndex,
    validationSnapshot: createValidationSnapshot(knowledgeBaseIdentity, state),
  };
}

function emptyValidationSnapshot(projectRoot) {
  return Object.freeze({
    directoryObservations: Object.freeze([]),
    fileObservations: Object.freeze([]),
    knowledgeBaseIdentity: null,
    knowledgeBasePath: path.join(projectRoot, ".sdlc"),
    root: null,
    symlinkObservations: Object.freeze([]),
    unreadableEntryObservations: Object.freeze([]),
  });
}

function createValidationSnapshot(knowledgeBaseIdentity, state) {
  return Object.freeze({
    directoryObservations: Object.freeze(state.directoryObservations.slice()),
    fileObservations: Object.freeze(state.fileObservations.slice()),
    knowledgeBaseIdentity,
    knowledgeBasePath: knowledgeBaseIdentity.root,
    root: state.root,
    symlinkObservations: Object.freeze(state.symlinkObservations.slice()),
    unreadableEntryObservations: Object.freeze(state.unreadableEntryObservations.slice()),
  });
}

async function validateCanonicalSnapshot(projectIdentity, snapshot, { concurrency, onCheck }) {
  try {
    await assertDirectoryIdentity(projectIdentity);
    if (!snapshot.knowledgeBaseIdentity) {
      const missing = await knowledgeBaseStillMissing(snapshot.knowledgeBasePath);
      await assertDirectoryIdentity(projectIdentity);
      return missing;
    }
    if (!await directoryIdentityMatches(snapshot.knowledgeBaseIdentity)) return false;

    const groups = [
      ["file", snapshot.fileObservations, validateFileObservation],
      ["symlink", snapshot.symlinkObservations, (observation) => (
        validateSymlinkObservation(snapshot.root, observation)
      )],
      ["unreadable", snapshot.unreadableEntryObservations, validateUnreadableEntryObservation],
    ];
    for (const [kind, observations, validate] of groups) {
      const valid = await runBoundedChecks(observations, {
        concurrency,
        kind,
        onCheck,
        validate,
      });
      if (!valid) return false;
    }

    const directoriesValid = await runBoundedChecks(snapshot.directoryObservations, {
      concurrency,
      kind: "directory",
      onCheck,
      validate: validateDirectoryObservation,
    });
    if (!directoriesValid) return false;
    if (!await directoryIdentityMatches(snapshot.knowledgeBaseIdentity)) return false;
    await assertDirectoryIdentity(projectIdentity);
    return true;
  } catch (error) {
    if (error instanceof ObservatoryPathError) {
      if (error.code === "project_boundary_changed") throw error;
      return false;
    }
    throw error;
  }
}

async function runBoundedChecks(observations, {
  concurrency,
  kind,
  onCheck,
  validate,
}) {
  if (observations.length === 0) return true;
  let cursor = 0;
  let valid = true;

  async function worker() {
    while (valid) {
      const index = cursor;
      cursor += 1;
      if (index >= observations.length) return;
      const observation = observations[index];
      const event = Object.freeze({ kind, path: observation.path });
      if (onCheck) await onCheck(Object.freeze({ ...event, event: "start" }));
      try {
        if (!await validate(observation)) valid = false;
      } finally {
        if (onCheck) await onCheck(Object.freeze({ ...event, event: "end" }));
      }
    }
  }

  const workerCount = Math.min(concurrency, observations.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return valid;
}

async function validateFileObservation(observation) {
  const current = await inspectLstat(observation.path);
  if (
    !current.readable
    || !current.stats.isFile()
    || statFingerprint(current.stats) !== observation.fingerprint
  ) {
    return false;
  }
  if (observation.readable !== false) return true;
  const probe = await probeStableFile(observation.path, observation.fingerprint);
  return !probe.readable;
}

async function validateSymlinkObservation(root, observation) {
  const current = await inspectLstat(observation.path);
  if (
    !current.readable
    || !current.stats.isSymbolicLink()
    || statFingerprint(current.stats) !== observation.fingerprint
  ) {
    return false;
  }
  let target;
  try {
    target = await fs.readlink(observation.path);
  } catch (error) {
    if (isRaceError(error) || error?.code === "ELOOP") {
      throw boundaryChanged("A symbolic link changed while canonical evidence was inspected", error);
    }
    return observation.unreadable;
  }
  if (observation.unreadable || target !== observation.target) return false;
  return await resolveSymlinkState(root, observation.path) === observation.resolution;
}

async function validateUnreadableEntryObservation(observation) {
  const current = await inspectLstat(observation.path);
  return !current.readable;
}

async function validateDirectoryObservation(observation) {
  const current = await inspectLstat(observation.path);
  if (
    !current.readable
    || !current.stats.isDirectory()
    || statFingerprint(current.stats) !== observation.fingerprint
  ) {
    return false;
  }
  if (observation.readable === null) return true;
  const directoryRead = await readDirectoryEntries(observation.path);
  return directoryRead.readable === observation.readable
    && (!directoryRead.readable || directoryRead.snapshot === observation.snapshot);
}

async function directoryIdentityMatches(identity) {
  try {
    await assertDirectoryIdentity(identity);
    return true;
  } catch (error) {
    if (error instanceof ObservatoryPathError) return false;
    throw error;
  }
}

async function knowledgeBaseStillMissing(knowledgeBasePath) {
  try {
    await fs.lstat(knowledgeBasePath);
    return false;
  } catch (error) {
    return error?.code === "ENOENT";
  }
}

async function walkCanonicalDirectory(state, directory, relativeDirectory, depth) {
  const inspected = await inspectLstat(directory);
  if (!inspected.readable) {
    throw unavailablePath("Canonical evidence could not be inspected", inspected.error);
  }
  const before = inspected.stats;
  if (!before.isDirectory() || before.isSymbolicLink()) {
    throw boundaryChanged("A canonical evidence directory changed while its revision was read");
  }
  const directoryFingerprint = statFingerprint(before);
  const observation = {
    fingerprint: directoryFingerprint,
    path: directory,
    readable: null,
    snapshot: null,
  };
  state.directoryObservations.push(observation);

  if (depth > state.limits.maxDepth) {
    appendRevisionRecord(
      state.revision,
      "depth-limit",
      toCanonicalPath(relativeDirectory),
      String(state.limits.maxDepth),
    );
    return;
  }

  const directoryRead = await readDirectoryEntries(directory);
  observation.readable = directoryRead.readable;
  observation.snapshot = directoryRead.snapshot;
  if (!directoryRead.readable) {
    appendRevisionRecord(
      state.revision,
      "directory-unreadable",
      toCanonicalPath(relativeDirectory),
      "unreadable",
    );
    return;
  }
  if (state.onDirectorySnapshot) {
    await state.onDirectorySnapshot(Object.freeze({
      path: toCanonicalPath(relativeDirectory),
      snapshot: directoryRead.snapshot,
    }));
  }

  for (const entry of directoryRead.entries) {
    if (state.stopped) break;
    const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
    const absolute = path.join(directory, entry.name);
    if (!isContainedPath(state.root, absolute)) {
      throw new ObservatoryPathError(
        "knowledge_base_escape",
        "Canonical evidence resolved outside the project knowledge base",
        403,
      );
    }
    if (
      entry.isFile()
      && SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
      && state.fileCount >= state.limits.maxFiles
    ) {
      stopAtLimit(state, "max-files", ".sdlc", state.limits.maxFiles);
      break;
    }

    const entryInspection = await inspectLstat(absolute);
    if (!entryInspection.readable) {
      recordUnreadableEntry(state, entry, absolute, relative);
      continue;
    }
    const stats = entryInspection.stats;
    if (stats.isSymbolicLink()) {
      await recordSymlink(state, absolute, relative, stats);
      continue;
    }
    if (stats.isDirectory()) {
      if (relativeDirectory === "" && DERIVED_DIRECTORIES.has(entry.name.toLowerCase())) {
        continue;
      }
      await walkCanonicalDirectory(state, absolute, relative, depth + 1);
      continue;
    }
    if (!stats.isFile() || !SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      continue;
    }
    await recordCanonicalFile(state, absolute, relative, stats);
  }
}

async function recordCanonicalFile(state, absolute, relative, initialStats) {
  if (state.fileCount >= state.limits.maxFiles) {
    stopAtLimit(state, "max-files", ".sdlc", state.limits.maxFiles);
    return;
  }
  state.fileCount += 1;

  const fingerprint = statFingerprint(initialStats);
  const observation = { path: absolute, fingerprint, readable: null };
  state.fileObservations.push(observation);
  const size = initialStats.size;
  if (size > BigInt(state.limits.maxFileBytes)) {
    appendRevisionRecord(
      state.revision,
      "file-too-large",
      toCanonicalPath(relative),
      String(size),
    );
    return;
  }
  if (state.totalBytes + size > BigInt(state.limits.maxTotalBytes)) {
    stopAtLimit(
      state,
      "max-total-bytes",
      toCanonicalPath(relative),
      state.limits.maxTotalBytes,
    );
    return;
  }

  const previous = state.previousDigestIndex.get(relative);
  let read;

  if (previous?.fingerprint === fingerprint) {
    read = await probeStableFile(absolute, fingerprint);
    if (read.readable) read.digest = previous.digest;
  } else {
    read = await hashStableFile(absolute, fingerprint);
  }
  if (!read.readable) {
    observation.readable = false;
    appendRevisionRecord(
      state.revision,
      "file-unreadable",
      toCanonicalPath(relative),
      "unreadable",
    );
    return;
  }

  observation.readable = true;
  state.totalBytes += size;
  state.digestIndex.set(relative, { fingerprint, digest: read.digest });
  appendRevisionRecord(state.revision, "file", toCanonicalPath(relative), read.digest);
}

async function recordSymlink(state, absolute, relative, initialStats) {
  const fingerprint = statFingerprint(initialStats);
  let target;
  try {
    target = await fs.readlink(absolute);
  } catch (error) {
    if (isRaceError(error) || error?.code === "ELOOP") {
      throw boundaryChanged("A symbolic link changed while canonical evidence was inspected", error);
    }
    state.symlinkObservations.push({
      fingerprint,
      path: absolute,
      resolution: null,
      target: null,
      unreadable: true,
    });
    appendRevisionRecord(
      state.revision,
      "symlink-unreadable",
      toCanonicalPath(relative),
      "unreadable",
    );
    return;
  }

  const resolution = await resolveSymlinkState(state.root, absolute);

  state.symlinkObservations.push({
    path: absolute,
    fingerprint,
    resolution,
    target,
    unreadable: false,
  });
  appendRevisionRecord(
    state.revision,
    "symlink",
    toCanonicalPath(relative),
    `${target}\0${resolution}`,
  );
}

async function hashStableFile(absolute, expectedFingerprint) {
  let handle;
  try {
    handle = await fs.open(absolute, fsConstants.O_RDONLY | NO_FOLLOW_FLAG);
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || statFingerprint(before) !== expectedFingerprint) {
      throw boundaryChanged("Canonical evidence changed while its revision was read");
    }
    const digest = crypto.createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1_024);
    let totalBytes = 0n;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null);
      if (bytesRead === 0) break;
      digest.update(buffer.subarray(0, bytesRead));
      totalBytes += BigInt(bytesRead);
    }
    const after = await handle.stat({ bigint: true });
    if (statFingerprint(after) !== expectedFingerprint || totalBytes !== after.size) {
      throw boundaryChanged("Canonical evidence changed while its revision was read");
    }
    return { readable: true, digest: digest.digest("hex") };
  } catch (error) {
    if (error instanceof ObservatoryPathError) throw error;
    if (isRaceError(error) || ["EISDIR", "ELOOP"].includes(error?.code)) {
      throw boundaryChanged("Canonical evidence changed while its revision was read", error);
    }
    return { readable: false };
  } finally {
    await closeQuietly(handle);
  }
}

async function probeStableFile(absolute, expectedFingerprint) {
  let handle;
  try {
    handle = await fs.open(absolute, fsConstants.O_RDONLY | NO_FOLLOW_FLAG);
    const stats = await handle.stat({ bigint: true });
    if (!stats.isFile() || statFingerprint(stats) !== expectedFingerprint) {
      throw boundaryChanged("Canonical evidence changed while its revision was read");
    }
    return { readable: true, digest: null };
  } catch (error) {
    if (error instanceof ObservatoryPathError) throw error;
    if (isRaceError(error) || ["EISDIR", "ELOOP"].includes(error?.code)) {
      throw boundaryChanged("Canonical evidence changed while its revision was read", error);
    }
    return { readable: false };
  } finally {
    await closeQuietly(handle);
  }
}

async function verifyObservations(state) {
  for (const observation of state.fileObservations) {
    const current = await inspectLstat(observation.path);
    if (
      !current.readable
      || !current.stats.isFile()
      || statFingerprint(current.stats) !== observation.fingerprint
    ) {
      throw boundaryChanged("Canonical evidence changed while its revision was read");
    }
  }
  for (const observation of state.symlinkObservations) {
    const current = await inspectLstat(observation.path);
    if (
      !current.readable
      || !current.stats.isSymbolicLink()
      || statFingerprint(current.stats) !== observation.fingerprint
    ) {
      throw boundaryChanged("A symbolic link changed while canonical evidence was inspected");
    }
    let target;
    try {
      target = await fs.readlink(observation.path);
    } catch (error) {
      if (isRaceError(error) || error?.code === "ELOOP" || !observation.unreadable) {
        throw boundaryChanged("A symbolic link changed while canonical evidence was inspected", error);
      }
      continue;
    }
    if (observation.unreadable || target !== observation.target) {
      throw boundaryChanged("A symbolic link changed while canonical evidence was inspected");
    }
    const resolution = await resolveSymlinkState(state.root, observation.path);
    if (resolution !== observation.resolution) {
      throw boundaryChanged("A symbolic link changed while canonical evidence was inspected");
    }
  }
  for (const observation of state.unreadableEntryObservations) {
    const current = await inspectLstat(observation.path);
    if (current.readable) {
      throw boundaryChanged("Canonical evidence readability changed while its revision was read");
    }
  }
  for (let index = state.directoryObservations.length - 1; index >= 0; index -= 1) {
    const observation = state.directoryObservations[index];
    const current = await inspectLstat(observation.path);
    if (
      !current.readable
      || !current.stats.isDirectory()
      || statFingerprint(current.stats) !== observation.fingerprint
    ) {
      throw boundaryChanged("A canonical evidence directory changed while its revision was read");
    }
    if (observation.readable === null) continue;
    const directoryRead = await readDirectoryEntries(observation.path);
    if (
      directoryRead.readable !== observation.readable
      || (directoryRead.readable && directoryRead.snapshot !== observation.snapshot)
    ) {
      throw boundaryChanged("A canonical evidence directory changed while its revision was read");
    }
  }
}

async function resolveSymlinkState(root, symbolicLink) {
  try {
    const resolved = await fs.realpath(symbolicLink);
    return `${isContainedPath(root, resolved) ? "contained" : "escaped"}:${resolved}`;
  } catch (error) {
    return `unresolved:${error?.code ?? "unknown"}`;
  }
}

async function inspectLstat(target) {
  try {
    return { readable: true, stats: await fs.lstat(target, { bigint: true }) };
  } catch (error) {
    if (isRaceError(error)) {
      throw boundaryChanged("Canonical evidence changed while its revision was read", error);
    }
    return { readable: false, error };
  }
}

async function readDirectoryEntries(directory) {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isRaceError(error)) {
      throw boundaryChanged("A canonical evidence directory changed while its revision was read", error);
    }
    return { readable: false, entries: [], snapshot: null };
  }
  entries.sort((left, right) => compareStrings(left.name, right.name));
  const snapshot = crypto.createHash("sha256");
  appendHashField(snapshot, "change-observatory:directory-snapshot:v1");
  for (const entry of entries) {
    appendHashField(snapshot, entry.name);
    appendHashField(snapshot, directoryEntryType(entry));
  }
  return { readable: true, entries, snapshot: snapshot.digest("hex") };
}

function recordUnreadableEntry(state, entry, absolute, relative) {
  let type = null;
  if (entry.isDirectory()) type = "directory-unreadable";
  if (entry.isSymbolicLink()) type = "symlink-unreadable";
  if (entry.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
    if (state.fileCount >= state.limits.maxFiles) {
      stopAtLimit(state, "max-files", ".sdlc", state.limits.maxFiles);
      return;
    }
    type = "file-unreadable";
  }
  if (!type) return;

  state.unreadableEntryObservations.push({ path: absolute });
  appendRevisionRecord(state.revision, type, toCanonicalPath(relative), "unreadable");
}

function stopAtLimit(state, code, markerPath, limit) {
  if (!state.limitRecorded) {
    appendRevisionRecord(state.revision, "limit", markerPath, `${code}:${limit}`);
    state.limitRecorded = true;
  }
  state.stopped = true;
}

function directoryEntryType(entry) {
  if (entry.isSymbolicLink()) return "symlink";
  if (entry.isDirectory()) return "directory";
  if (entry.isFile()) return "file";
  return "other";
}

function isRaceError(error) {
  return error?.code === "ENOENT" || error?.code === "ENOTDIR";
}

async function closeQuietly(handle) {
  if (!handle) return;
  try {
    await handle.close();
  } catch {
    // The read outcome is authoritative; a close failure must not replace it.
  }
}

function statFingerprint(stats) {
  return [
    stats.dev,
    stats.ino,
    stats.mode,
    stats.size,
    stats.mtimeNs,
    stats.ctimeNs,
  ].map(String).join(":");
}

function toCanonicalPath(relative) {
  return relative ? `.sdlc/${relative}` : ".sdlc";
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function appendRevisionRecord(hash, type, recordPath, value) {
  appendHashField(hash, type);
  appendHashField(hash, recordPath);
  appendHashField(hash, value);
}

function appendHashField(hash, value) {
  const content = Buffer.from(String(value), "utf8");
  hash.update(String(content.byteLength));
  hash.update(":");
  hash.update(content);
}

function serializeJson(model) {
  const json = JSON.stringify(model);
  if (typeof json !== "string") {
    throw new TypeError("Observatory model must be JSON serializable");
  }
  return `${json}\n`;
}

function normalizeSerializedBody(value) {
  if (typeof value === "string") return Buffer.from(value, "utf8");
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof ArrayBuffer) return Buffer.from(value.slice(0));
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
  }
  throw new TypeError("Observatory model serializer must return a string or byte buffer");
}

function strongEtag(body) {
  const digest = crypto.createHash("sha256").update(body).digest("base64url");
  return `"sha256-${digest}"`;
}

function boundaryChanged(message, cause) {
  return new ObservatoryPathError("canonical_revision_changed", message, 409, { cause });
}

function unavailablePath(message, cause) {
  return new ObservatoryPathError("canonical_revision_unavailable", message, 403, { cause });
}
