import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  defaultLegacyProviderForAction,
  legacyProviderBindingsForProfile,
  legacyProviderForAction,
  normalizeLegacyProviderId,
} from "../../lib/delivery/provider-compatibility.mjs";
import {
  DELIVERY_PROVIDER_SPI_VERSION,
  DeliveryProviderError,
  createProviderRegistry,
  validateProviderOperationReceiptIntegrity,
} from "../../lib/delivery/provider-registry.mjs";
import { createGitRemoteProvider } from "../../lib/delivery/providers/git-remote.mjs";
import {
  canonicalGitHubPullRequestUrl,
  createGitHubCliProvider,
} from "../../lib/delivery/providers/github-cli.mjs";
import { createLocalFilesystemProvider } from "../../lib/delivery/providers/local-filesystem.mjs";
import { assertAgainstSchema, validateAgainstSchema } from "../../lib/json-schema-validator.mjs";

const SHA = Object.freeze({
  base: "a".repeat(40),
  before: "b".repeat(40),
  head: "c".repeat(40),
  merge: "d".repeat(40),
});
const TIME = Object.freeze({
  authorized: "2026-07-18T10:00:00.000Z",
  precondition: "2026-07-18T10:00:01.000Z",
  completed: "2026-07-18T10:01:00.000Z",
});

function operation(id, action, subject, observedAt = TIME.precondition) {
  return { id, action, subject, observed_at: observedAt };
}

function assertProviderError(callback, code) {
  assert.throws(callback, (error) => {
    assert.equal(error instanceof DeliveryProviderError, true);
    assert.equal(error.code, code);
    return true;
  });
}

test("registry exposes only observer/verifier capabilities and rejects execution hooks", () => {
  const registry = createProviderRegistry([
    createGitRemoteProvider({ commandRunner: () => "" }),
    createGitHubCliProvider({ commandRunner: () => "{}" }),
    createLocalFilesystemProvider(),
  ]);
  assert.deepEqual(registry.list().map((provider) => provider.id), [
    "git-remote",
    "github-cli",
    "local-filesystem",
  ]);
  for (const provider of registry.list()) {
    assert.equal(provider.spi_version, DELIVERY_PROVIDER_SPI_VERSION);
    assert.equal(Object.hasOwn(provider, "execute"), false);
    assert.equal(Object.hasOwn(provider, "push"), false);
    assert.equal(Object.hasOwn(provider, "merge"), false);
    assert.equal(Object.hasOwn(provider, "release"), false);
  }
  assert.equal(registry.supports("git-remote", "git.push", "precondition"), true);
  assert.equal(registry.supports("git-remote", "pull_request.merge", "completion"), false);

  assertProviderError(() => createProviderRegistry([{
    id: "unsafe",
    adapter_version: "1.0.0",
    spi_version: DELIVERY_PROVIDER_SPI_VERSION,
    capabilities: { "git.push": ["precondition"] },
    observePrecondition: () => ({ observed: true }),
    execute: () => {},
  }]), "provider_execution_forbidden");
  assertProviderError(() => registry.get("missing"), "provider_unknown");
});

test("git-remote emits hash-bound, idempotent push observations without executing Git mutations", () => {
  const calls = [];
  let remoteState = "before";
  const sourceCwd = path.join(os.tmpdir(), "provider-source-checkout");
  const relocatedCwd = path.join(os.tmpdir(), "provider-relocated-checkout");
  const runner = (executable, args, options) => {
    calls.push({ executable, args, options });
    assert.equal(executable, "git");
    assert.equal(options.shell, false);
    assert.equal(args.includes("push"), false);
    if (remoteState === "before") {
      return `${SHA.before}\trefs/heads/provider-spi\n${SHA.base}\trefs/heads/main\n`;
    }
    return `${SHA.head}\trefs/heads/provider-spi\n`;
  };
  const registry = createProviderRegistry([createGitRemoteProvider({ commandRunner: runner })]);
  const subject = {
    repository: "example.test/acme/travelops",
    remote: "origin",
    destination_ref: "refs/heads/provider-spi",
    base_ref: "refs/heads/main",
    source_sha: SHA.head,
  };
  const before = operation("PUSH-001", "git.push", subject);
  const precondition = registry.observePrecondition("git-remote", before, { cwd: sourceCwd });
  const retry = registry.observePrecondition("git-remote", before, { cwd: sourceCwd });

  assert.deepEqual(retry, precondition);
  assert.equal(Object.hasOwn(precondition.subject, "cwd"), false);
  assert.equal(precondition.proof.previous_sha, SHA.before);
  assert.equal(precondition.proof.base_sha, SHA.base);
  assert.equal(precondition.precondition_receipt_ref, null);
  assert.equal(validateProviderOperationReceiptIntegrity(precondition).valid, true);
  assertAgainstSchema(precondition, "provider-operation-receipt");
  assert.deepEqual(calls[0].args, [
    "-C", sourceCwd, "ls-remote", "--heads", "origin",
    "refs/heads/provider-spi", "refs/heads/main",
  ]);

  remoteState = "after";
  const completion = registry.verifyCompletion(
    "git-remote",
    operation("PUSH-001", "git.push", subject, TIME.completed),
    precondition,
    { cwd: relocatedCwd },
  );
  assert.equal(completion.proof.observed_sha, SHA.head);
  assert.deepEqual(completion.precondition_receipt_ref, {
    id: precondition.id,
    hash: precondition.receipt_hash,
  });
  assert.equal(validateProviderOperationReceiptIntegrity(completion).valid, true);
  assertAgainstSchema(completion, "provider-operation-receipt");
  assert.equal(calls.at(-1).options.cwd, relocatedCwd);
  assert.deepEqual(calls.at(-1).args.slice(0, 2), ["-C", relocatedCwd]);
  assert.equal(calls.every((call) => call.args.includes("push") === false), true);
});

test("git-remote can complete a legacy cwd-bound receipt from a relocated checkout", () => {
  const calls = [];
  let remoteState = "before";
  const sourceCwd = path.join(os.tmpdir(), "legacy-provider-source");
  const relocatedCwd = path.join(os.tmpdir(), "legacy-provider-relocated");
  const registry = createProviderRegistry([createGitRemoteProvider({
    commandRunner: (_executable, args, options) => {
      calls.push({ args, options });
      return remoteState === "before"
        ? `${SHA.before}\trefs/heads/provider-spi\n${SHA.base}\trefs/heads/main\n`
        : `${SHA.head}\trefs/heads/provider-spi\n`;
    },
  })]);
  const legacySubject = {
    cwd: sourceCwd,
    repository: "example.test/acme/travelops",
    remote: "origin",
    destination_ref: "refs/heads/provider-spi",
    base_ref: "refs/heads/main",
    source_sha: SHA.head,
  };
  const precondition = registry.observePrecondition(
    "git-remote",
    operation("PUSH-LEGACY-CWD", "git.push", legacySubject),
  );
  assert.equal(precondition.subject.cwd, sourceCwd);
  assert.equal(calls[0].options.cwd, sourceCwd);

  remoteState = "after";
  const completion = registry.verifyCompletion(
    "git-remote",
    operation("PUSH-LEGACY-CWD", "git.push", legacySubject, TIME.completed),
    precondition,
    { cwd: relocatedCwd },
  );
  assert.equal(completion.proof.observed_sha, SHA.head);
  assert.equal(completion.subject.cwd, sourceCwd);
  assert.equal(calls.at(-1).options.cwd, relocatedCwd);
  assert.deepEqual(calls.at(-1).args.slice(0, 2), ["-C", relocatedCwd]);
});

test("receipt tampering and wrong precondition bindings fail closed", () => {
  let remoteState = "before";
  const registry = createProviderRegistry([createGitRemoteProvider({
    commandRunner: () => remoteState === "before"
      ? `${SHA.base}\trefs/heads/main\n`
      : `${SHA.head}\trefs/heads/provider-spi\n`,
  })]);
  const subject = {
    cwd: process.cwd(),
    remote: "origin",
    destination_ref: "refs/heads/provider-spi",
    base_ref: "refs/heads/main",
    source_sha: SHA.head,
  };
  const precondition = registry.observePrecondition(
    "git-remote",
    operation("PUSH-TAMPER", "git.push", subject),
  );
  const tampered = structuredClone(precondition);
  tampered.proof.base_sha = SHA.before;
  assert.equal(validateProviderOperationReceiptIntegrity(tampered).valid, false);
  assert.equal(validateAgainstSchema(tampered, "provider-operation-receipt").valid, true);

  remoteState = "after";
  assertProviderError(() => registry.verifyCompletion(
    "git-remote",
    operation("PUSH-TAMPER", "git.push", subject, TIME.completed),
    tampered,
  ), "provider_receipt_invalid");
  assertProviderError(() => registry.verifyCompletion(
    "git-remote",
    operation("OTHER-OP", "git.push", subject, TIME.completed),
    precondition,
  ), "provider_precondition_mismatch");
});

test("generic Git fails closed for every pull-request state operation", () => {
  let calls = 0;
  const registry = createProviderRegistry([createGitRemoteProvider({ commandRunner: () => { calls += 1; return ""; } })]);
  for (const action of ["pull_request.create", "pull_request.update", "pull_request.merge"]) {
    assertProviderError(() => registry.observePrecondition(
      "git-remote",
      operation(`GENERIC-${action}`, action, { repository: "git.example/acme/repo" }),
    ), "provider_operation_unsupported");
  }
  assert.equal(calls, 0);
});

test("git-remote rejects option injection and unsafe refs before invoking the runner", () => {
  let calls = 0;
  const registry = createProviderRegistry([createGitRemoteProvider({ commandRunner: () => { calls += 1; return ""; } })]);
  const base = {
    cwd: process.cwd(),
    remote: "origin",
    destination_ref: "refs/heads/provider-spi",
    base_ref: "refs/heads/main",
    source_sha: SHA.head,
  };
  assertProviderError(() => registry.observePrecondition(
    "git-remote",
    operation("INJECT-REMOTE", "git.push", { ...base, remote: "--upload-pack=evil" }),
  ), "provider_operation_invalid");
  assertProviderError(() => registry.observePrecondition(
    "git-remote",
    operation("INJECT-REF", "git.push", { ...base, destination_ref: "refs/heads/x\nrefs/heads/main" }),
  ), "provider_operation_invalid");
  assert.equal(calls, 0);
});

test("github-cli preserves exact merge precondition and completion verification", () => {
  const calls = [];
  let merged = false;
  const open = {
    url: "https://github.com/acme/travelops/pull/42",
    state: "OPEN",
    isDraft: false,
    headRefOid: SHA.head,
    headRefName: "provider-spi",
    baseRefName: "main",
  };
  const runner = (executable, args, options) => {
    calls.push({ executable, args, options });
    assert.equal(executable, "gh");
    assert.equal(options.shell, false);
    assert.equal(args.includes("merge"), false);
    return JSON.stringify(merged ? {
      ...open,
      state: "MERGED",
      mergedAt: "2026-07-18T10:00:30.000Z",
      mergeCommit: { oid: SHA.merge },
    } : open);
  };
  const registry = createProviderRegistry([createGitHubCliProvider({ commandRunner: runner })]);
  const subject = {
    repository: "github.com/acme/travelops",
    pr_url: "https://github.com/acme/travelops/pull/42",
    head_branch: "provider-spi",
    base_branch: "main",
    source_sha: SHA.head,
    authorized_at: TIME.authorized,
  };
  const precondition = registry.observePrecondition(
    "github-cli",
    operation("PR-MERGE-42", "pull_request.merge", subject),
  );
  assert.equal(precondition.proof.state, "OPEN");
  assert.equal(precondition.proof.is_draft, false);
  assert.deepEqual(calls[0].args, [
    "pr", "view", subject.pr_url,
    "--json", "url,state,isDraft,headRefOid,headRefName,baseRefName",
  ]);

  merged = true;
  const completion = registry.verifyCompletion(
    "github-cli",
    operation("PR-MERGE-42", "pull_request.merge", subject, TIME.completed),
    precondition,
  );
  assert.equal(completion.proof.state, "MERGED");
  assert.equal(completion.proof.merge_commit_sha, SHA.merge);
  assert.equal(completion.proof.merged_at, "2026-07-18T10:00:30.000Z");
  assert.equal(validateProviderOperationReceiptIntegrity(completion).valid, true);
  assertAgainstSchema(completion, "provider-operation-receipt");
  assert.equal(calls.every((call) => call.args.includes("merge") === false), true);
});

test("github-cli proves create and update without exposing mutation commands", () => {
  const body = "updated body";
  const bodyHash = crypto.createHash("sha256").update(body, "utf8").digest("hex");
  const calls = [];
  let mode = "create-before";
  const created = {
    url: "https://github.com/acme/travelops/pull/43",
    state: "OPEN",
    isDraft: false,
    headRefOid: SHA.head,
    headRefName: "provider-spi",
    baseRefName: "main",
    createdAt: "2026-07-18T10:00:30.000Z",
  };
  const runner = (_executable, args) => {
    calls.push(args);
    if (args[1] === "list") return JSON.stringify(mode === "create-before" ? [] : [created]);
    return JSON.stringify(mode === "update-before" ? {
      ...created,
      title: "Old title",
      body: "old body",
      updatedAt: "2026-07-18T09:00:00.000Z",
    } : {
      ...created,
      title: "New title",
      body,
      updatedAt: "2026-07-18T10:00:45.000Z",
    });
  };
  const registry = createProviderRegistry([createGitHubCliProvider({ commandRunner: runner })]);
  const createSubject = {
    repository: "acme/travelops",
    head_branch: "provider-spi",
    base_branch: "main",
    source_sha: SHA.head,
    authorized_at: TIME.authorized,
  };
  const createPrecondition = registry.observePrecondition(
    "github-cli",
    operation("PR-CREATE-43", "pull_request.create", createSubject),
  );
  mode = "create-after";
  const createCompletion = registry.verifyCompletion(
    "github-cli",
    operation("PR-CREATE-43", "pull_request.create", createSubject, TIME.completed),
    createPrecondition,
  );
  assert.equal(createCompletion.proof.pr_url, created.url);

  const updateSubject = {
    ...createSubject,
    pr_url: created.url,
    expected: { title: "New title", body_sha256: bodyHash, is_draft: false },
  };
  mode = "update-before";
  const updatePrecondition = registry.observePrecondition(
    "github-cli",
    operation("PR-UPDATE-43", "pull_request.update", updateSubject),
  );
  mode = "update-after";
  const updateCompletion = registry.verifyCompletion(
    "github-cli",
    operation("PR-UPDATE-43", "pull_request.update", updateSubject, TIME.completed),
    updatePrecondition,
  );
  assert.equal(updateCompletion.proof.expected.body_sha256, bodyHash);
  assert.equal(calls.flat().some((arg) => ["create", "edit", "ready", "merge"].includes(arg)), false);
});

test("github-cli rejects URL and branch argument injection before running gh", () => {
  let calls = 0;
  const registry = createProviderRegistry([createGitHubCliProvider({ commandRunner: () => { calls += 1; return "{}"; } })]);
  const subject = {
    repository: "acme/travelops",
    pr_url: "https://github.com/acme/travelops/pull/42?x=1",
    head_branch: "provider-spi",
    base_branch: "main",
    source_sha: SHA.head,
    authorized_at: TIME.authorized,
  };
  assert.equal(canonicalGitHubPullRequestUrl(subject.pr_url), null);
  assertProviderError(() => registry.observePrecondition(
    "github-cli",
    operation("PR-INJECT-URL", "pull_request.merge", subject),
  ), "provider_operation_invalid");
  assertProviderError(() => registry.observePrecondition(
    "github-cli",
    operation("PR-INJECT-BRANCH", "pull_request.merge", {
      ...subject,
      pr_url: "https://github.com/acme/travelops/pull/42",
      head_branch: "--repo=other",
    }),
  ), "provider_operation_invalid");
  assert.equal(calls, 0);
});

test("local-filesystem pins the root identity, permits bounded changes, and never runs release commands", (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "provider-local-"));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const outputPath = path.join(tempRoot, "dist");
  const registry = createProviderRegistry([createLocalFilesystemProvider()]);
  const subject = { root_path: tempRoot, allowed_write_paths: [outputPath] };
  const precondition = registry.observePrecondition(
    "local-filesystem",
    operation("LOCAL-RELEASE-001", "release.local", subject),
  );
  assert.equal(precondition.proof.allowed_write_paths[0].status, "absent");

  fs.mkdirSync(outputPath);
  fs.writeFileSync(path.join(outputPath, "artifact.txt"), "verified\n", "utf8");
  const completion = registry.verifyCompletion(
    "local-filesystem",
    operation("LOCAL-RELEASE-001", "release.local", subject, TIME.completed),
    precondition,
  );
  assert.equal(completion.proof.allowed_write_paths[0].status, "present");
  assert.equal(completion.proof.root_identity.inode, precondition.proof.root_identity.inode);
  assert.equal(validateProviderOperationReceiptIntegrity(completion).valid, true);
  assertAgainstSchema(completion, "provider-operation-receipt");
});

test("local-filesystem fails closed on traversal and symlink escape", (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "provider-boundary-"));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "provider-outside-"));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  const registry = createProviderRegistry([createLocalFilesystemProvider()]);

  assertProviderError(() => registry.observePrecondition(
    "local-filesystem",
    operation("LOCAL-TRAVERSAL", "release.local", {
      root_path: tempRoot,
      allowed_write_paths: [path.join(tempRoot, "..", path.basename(outside))],
    }),
  ), "provider_operation_invalid");

  const link = path.join(tempRoot, "linked");
  fs.symlinkSync(outside, link, "dir");
  assertProviderError(() => registry.observePrecondition(
    "local-filesystem",
    operation("LOCAL-SYMLINK", "release.local", {
      root_path: tempRoot,
      allowed_write_paths: [path.join(link, "artifact")],
    }),
  ), "provider_boundary_invalid");
});

test("legacy provider mappings are derived in memory without changing v1 profiles", () => {
  const profile = {
    schema_version: "delivery-execution-profile:v1",
    profile_hash: "f".repeat(64),
    delivery_kind: "pull_request",
    pull_request_target: {
      repository: "github.com/acme/travelops",
      base_branch: "main",
      head_branch: "provider-spi",
    },
  };
  const original = JSON.stringify(profile);
  const mapping = legacyProviderBindingsForProfile(profile);
  assert.equal(JSON.stringify(profile), original);
  assert.equal(mapping.derived_only, true);
  assert.equal(mapping.bindings.remote_ref.provider_id, "git-remote");
  assert.equal(mapping.bindings.pull_request.provider_id, "github-cli");
  assert.equal(Object.isFrozen(mapping), true);
  assert.deepEqual(legacyProviderForAction(profile, "pull_request.merge"), {
    provider_id: "github-cli",
    action: "pull_request.merge",
    compatibility: "backward-compatible",
    derived_only: true,
  });

  const generic = structuredClone(profile);
  generic.pull_request_target.repository = "git.example/acme/travelops";
  const genericMapping = legacyProviderBindingsForProfile(generic);
  assert.equal(genericMapping.bindings.pull_request.provider_id, "git-remote");
  assert.equal(genericMapping.bindings.pull_request.compatibility, "unsupported-fail-closed");
  assert.equal(normalizeLegacyProviderId("github"), "github-cli");
  assert.equal(defaultLegacyProviderForAction("release.local"), "local-filesystem");
  assert.equal(defaultLegacyProviderForAction("repository.write"), null);
});
