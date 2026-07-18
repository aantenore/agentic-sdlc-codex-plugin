import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { computeStableHash } from "../../lib/canonical.mjs";
import { createCommandSubject } from "../../lib/governance/command-subject.mjs";
import {
  MutationGovernanceError,
  appendJsonLineNoFollow,
  assertMutationExecutionAuthorized,
  consumeBootstrapMutationGrant,
  createBootstrapMutationGrant,
  createProjectMutationGovernance,
  currentMutationGovernance,
  normalizeProjectMutationPath,
  runWithMutationGovernance,
  withGovernedMutation,
} from "../../lib/governance/mutation-guard.mjs";
import {
  createGovernancePolicy,
  createGovernanceRevocation,
  evaluateGovernancePolicy,
} from "../../lib/governance/policy-engine.mjs";

const ACTOR = Object.freeze({ type: "agent", id: "writer-1" });
const NOW = "2026-07-18T12:00:00.000Z";
const EVIDENCE_HASH = computeStableHash({ contract: "exact" });
const EXACT_EVIDENCE = Object.freeze([{ kind: "contract", id: "CONTRACT-1", hash: EVIDENCE_HASH }]);

function fixture(t, label = "guard") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `agentic-sdlc-${label}-`));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function mutationSubject({ action = "story.update", commandPath = "story update", operation = "file.write", projectPath = ".sdlc/story.json", evidence = EXACT_EVIDENCE } = {}) {
  return createCommandSubject({
    command_path: commandPath,
    canonical_action: action,
    scope_refs: [
      { kind: "mutation_operation", id: operation },
      { kind: "project_path", id: projectPath },
    ],
    evidence_refs: evidence,
  });
}

function policyFor(subject) {
  return createGovernancePolicy({
    id: "POLICY-MUTATION-1",
    valid_from: "2026-07-18T00:00:00.000Z",
    expires_at: "2026-07-19T00:00:00.000Z",
    decision_ttl_seconds: 600,
    role_bindings: [{ id: "BIND-WRITER", role: "writer", actor: ACTOR }],
    rules: [{
      id: "ALLOW-EXACT-MUTATION",
      effect: "allow",
      action: subject.command.action,
      scope_refs: subject.scope_refs,
      evidence_refs: subject.evidence_refs,
      actor_roles: ["writer"],
    }],
  });
}

function guardedContext(root, overrides = {}) {
  const subject = mutationSubject(overrides);
  const policy = overrides.policy ?? policyFor(subject);
  let sequence = 0;
  return {
    mode: overrides.mode ?? "enforce",
    fail_closed: true,
    root,
    canonical_action: overrides.contextAction ?? "story.update",
    command_path: overrides.contextCommandPath ?? "story update",
    evidence_refs: overrides.contextEvidence ?? EXACT_EVIDENCE,
    observations: overrides.observations ?? [],
    now: overrides.now ?? (() => NOW),
    decision_provider: overrides.decisionProvider ?? (({ subject: actual }) => evaluateGovernancePolicy({
      policy,
      subject: actual,
      actor: ACTOR,
      evaluated_at: NOW,
      decision_id: `DECISION-${++sequence}`,
    })),
  };
}

test("enforce decides synchronously before the first byte and binds lower writer gateways", () => {
  const root = fixture(test, "before-byte");
  const target = path.join(root, ".sdlc", "story.json");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const context = guardedContext(root);

  runWithMutationGovernance(context, () => {
    withGovernedMutation({ operation: "file.write", path: target }, () => {
      assert.equal(assertMutationExecutionAuthorized({ operation: "file.write", path: target }), true);
      fs.writeFileSync(target, "allowed");
    });
  });
  assert.equal(fs.readFileSync(target, "utf8"), "allowed");

  const deniedTarget = path.join(root, ".sdlc", "denied.json");
  let callbackStarted = false;
  assert.throws(
    () => runWithMutationGovernance(context, () => withGovernedMutation(
      { operation: "file.write", path: deniedTarget },
      () => {
        callbackStarted = true;
        fs.writeFileSync(deniedTarget, "must-not-exist");
      },
    )),
    (error) => error instanceof MutationGovernanceError && error.code === "MUTATION_GOVERNANCE_DENIED",
  );
  assert.equal(callbackStarted, false);
  assert.equal(fs.existsSync(deniedTarget), false);
});

test("action, operation, path, and evidence must all match exactly", () => {
  const root = fixture(test, "exact-target");
  fs.mkdirSync(path.join(root, ".sdlc"), { recursive: true });
  const exactPath = path.join(root, ".sdlc", "story.json");
  const context = guardedContext(root);
  const variants = [
    { operation: "file.remove", path: exactPath },
    { canonical_action: "story.complete", operation: "file.write", path: exactPath },
    { operation: "file.write", path: path.join(root, ".sdlc", "other.json") },
    {
      operation: "file.write",
      path: exactPath,
      evidence_refs: [{ kind: "contract", id: "CONTRACT-1", hash: "0".repeat(64) }],
    },
  ];
  for (const variant of variants) {
    assert.throws(
      () => runWithMutationGovernance(context, () => withGovernedMutation(variant, () => assert.fail("denied callback ran"))),
      /no approval for this exact action and file/u,
    );
  }
});

test("disabled preserves 0.11 behavior, audit observes failures, and enforce blocks them", () => {
  const root = fixture(test, "modes");
  const target = path.join(root, "record.json");
  let disabledRan = false;
  runWithMutationGovernance({ mode: "disabled", root }, () => {
    withGovernedMutation(null, () => { disabledRan = true; });
  });
  assert.equal(disabledRan, true);

  const observations = [];
  let auditRan = false;
  runWithMutationGovernance(guardedContext(root, {
    mode: "audit",
    observations,
    decisionProvider: () => { throw new Error("unavailable evaluator"); },
  }), () => {
    withGovernedMutation({ operation: "file.write", path: target }, () => { auditRan = true; });
  });
  assert.equal(auditRan, true);
  assert.equal(observations.at(-1).allowed, false);
  assert.deepEqual(observations.at(-1).reason_codes, ["mutation.decision_error"]);

  let enforceRan = false;
  assert.throws(
    () => runWithMutationGovernance(guardedContext(root, {
      decisionProvider: () => { throw new Error("unavailable evaluator"); },
    }), () => withGovernedMutation({ operation: "file.write", path: target }, () => { enforceRan = true; })),
    /no approval for this exact action and file/u,
  );
  assert.equal(enforceRan, false);
});

test("missing, unknown, and asynchronous decisions fail closed", () => {
  const root = fixture(test, "metadata");
  const target = path.join(root, "record.json");
  assert.throws(
    () => runWithMutationGovernance({
      mode: "enforce",
      fail_closed: true,
      root,
      canonical_action: "story.update",
      command_path: "story update",
      decision_provider: () => Promise.resolve({ decision: "allow" }),
    }, () => withGovernedMutation({ operation: "file.write", path: target }, () => assert.fail("async allow ran"))),
    /no approval for this exact action and file/u,
  );
  assert.throws(
    () => runWithMutationGovernance(guardedContext(root), () => withGovernedMutation({}, () => assert.fail("missing ran"))),
    (error) => error.code === "MUTATION_METADATA_MISSING",
  );
  assert.throws(
    () => runWithMutationGovernance({
      mode: "enforce",
      root,
      canonical_action: "unknown command*",
      command_path: "unknown command",
    }, () => {}),
    (error) => error.code === "MUTATION_METADATA_MISSING",
  );
});

test("path normalization rejects traversal, globs, root writes, and symlinks", () => {
  const root = fixture(test, "paths");
  const outside = fixture(test, "outside");
  fs.mkdirSync(path.join(root, "safe"));
  fs.symlinkSync(outside, path.join(root, "safe", "linked"), "dir");
  assert.equal(normalizeProjectMutationPath(root, path.join(root, "safe", "file.json")), "safe/file.json");
  assert.throws(() => normalizeProjectMutationPath(root, root), /inside the project root/u);
  assert.throws(() => normalizeProjectMutationPath(root, "../outside.json"), /inside the project root/u);
  assert.throws(() => normalizeProjectMutationPath(root, "safe/*.json"), /glob/u);
  assert.throws(() => normalizeProjectMutationPath(root, path.join(root, "safe", "linked", "file.json")), /symbolic link/u);
});

test("AsyncLocalStorage isolates concurrent commands and prevents nested downgrades", async () => {
  const rootA = fixture(test, "concurrent-a");
  const rootB = fixture(test, "concurrent-b");
  const pathA = path.join(rootA, ".sdlc", "story.json");
  const pathB = path.join(rootB, ".sdlc", "story.json");
  fs.mkdirSync(path.dirname(pathA), { recursive: true });
  fs.mkdirSync(path.dirname(pathB), { recursive: true });
  const seen = [];
  await Promise.all([
    runWithMutationGovernance(guardedContext(rootA), async () => {
      await new Promise((resolve) => setImmediate(resolve));
      seen.push(currentMutationGovernance().root);
      withGovernedMutation({ operation: "file.write", path: pathA }, () => fs.writeFileSync(pathA, "A"));
    }),
    runWithMutationGovernance(guardedContext(rootB), async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      seen.push(currentMutationGovernance().root);
      withGovernedMutation({ operation: "file.write", path: pathB }, () => fs.writeFileSync(pathB, "B"));
    }),
  ]);
  assert.deepEqual(new Set(seen), new Set([rootA, rootB]));
  assert.equal(fs.readFileSync(pathA, "utf8"), "A");
  assert.equal(fs.readFileSync(pathB, "utf8"), "B");

  assert.throws(
    () => runWithMutationGovernance(guardedContext(rootA), () =>
      runWithMutationGovernance({ mode: "audit", root: rootA }, () => assert.fail("downgrade ran"))),
    (error) => error.code === "MUTATION_GOVERNANCE_DOWNGRADE",
  );
});

test("authorization tokens expire with their callback and remain active only until an async callback settles", async () => {
  const root = fixture(test, "authorization-lifecycle");
  const target = path.join(root, ".sdlc", "story.json");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  let detachedResult;
  let settleDetached;
  const detached = new Promise((resolve) => { settleDetached = resolve; });

  await runWithMutationGovernance(guardedContext(root), async () => {
    await withGovernedMutation({ operation: "file.write", path: target }, async () => {
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(assertMutationExecutionAuthorized({ operation: "file.write", path: target }), true);
    });
    withGovernedMutation({ operation: "file.write", path: target }, () => {
      setImmediate(() => {
        try {
          assertMutationExecutionAuthorized({ operation: "file.write", path: target });
          detachedResult = null;
        } catch (error) {
          detachedResult = error;
        } finally {
          settleDetached();
        }
      });
    });
    await detached;
  });
  assert.equal(detachedResult?.code, "MUTATION_GOVERNANCE_DENIED");
  assert.deepEqual(detachedResult?.details?.reason_codes, ["mutation.authorization_inactive"]);
});

test("a gateway rechecks expiration before the first byte", () => {
  const root = fixture(test, "authorization-expiry");
  const target = path.join(root, ".sdlc", "story.json");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  let checkedAt = NOW;
  const context = guardedContext(root, { now: () => checkedAt });
  assert.throws(
    () => runWithMutationGovernance(context, () => withGovernedMutation(
      { operation: "file.write", path: target },
      () => {
        checkedAt = "2026-07-18T12:10:00.000Z";
        assertMutationExecutionAuthorized({ operation: "file.write", path: target });
        fs.writeFileSync(target, "must-not-exist");
      },
    )),
    (error) => error.code === "MUTATION_GOVERNANCE_DENIED"
      && error.details.reason_codes.includes("mutation.authorization_expired"),
  );
  assert.equal(fs.existsSync(target), false);
});

test("pointer governance persists exact receipts and reloads revocations before use", () => {
  const root = fixture(test, "receipts-and-revocation");
  const governanceRoot = path.join(root, ".sdlc", "governance");
  const target = path.join(root, ".sdlc", "story.json");
  fs.mkdirSync(governanceRoot, { recursive: true });
  const subject = mutationSubject();
  const policy = policyFor(subject);
  fs.writeFileSync(path.join(governanceRoot, "policy.json"), `${JSON.stringify(policy)}\n`);
  const pointer = {
    mode: "enforce",
    policy_file: ".sdlc/governance/policy.json",
    decision_receipts_root: ".sdlc/governance/decisions",
    use_receipts_root: ".sdlc/governance/uses",
    revocations_root: ".sdlc/governance/revocations",
    fail_closed: true,
  };
  const governance = () => createProjectMutationGovernance({
    root,
    governance_policy: pointer,
    canonical_action: "story.update",
    command_path: "story update",
    verified_actor: { verified: true, assurance: "host_verified", actor: ACTOR },
    evidence_paths: [],
    now: () => NOW,
  });

  runWithMutationGovernance(governance(), () => {
    withGovernedMutation({ operation: "file.write", path: target, evidence_refs: EXACT_EVIDENCE }, () => {
      assertMutationExecutionAuthorized({ operation: "file.write", path: target, evidence_refs: EXACT_EVIDENCE });
      fs.writeFileSync(target, "allowed");
    });
  });
  const decisions = fs.readdirSync(path.join(governanceRoot, "decisions"));
  const uses = fs.readdirSync(path.join(governanceRoot, "uses"));
  assert.equal(decisions.length, 1);
  assert.equal(uses.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(governanceRoot, "decisions", decisions[0]), "utf8")).kind, "governance_policy_decision");
  assert.equal(JSON.parse(fs.readFileSync(path.join(governanceRoot, "uses", uses[0]), "utf8")).kind, "governance_policy_use_receipt");

  const deniedTarget = path.join(root, ".sdlc", "story-revoked.json");
  const revokedSubject = mutationSubject({ projectPath: ".sdlc/story-revoked.json" });
  const revokedPolicy = policyFor(revokedSubject);
  fs.writeFileSync(path.join(governanceRoot, "policy.json"), `${JSON.stringify(revokedPolicy)}\n`);
  const revocationsRoot = path.join(governanceRoot, "revocations");
  fs.mkdirSync(revocationsRoot);
  const revokedGovernance = createProjectMutationGovernance({
    root,
    governance_policy: pointer,
    canonical_action: "story.update",
    command_path: "story update",
    verified_actor: { verified: true, assurance: "host_verified", actor: ACTOR },
    evidence_paths: [],
    now: () => NOW,
  });
  assert.throws(
    () => runWithMutationGovernance(revokedGovernance, () => withGovernedMutation(
      { operation: "file.write", path: deniedTarget, evidence_refs: EXACT_EVIDENCE },
      () => {
        const issuedDecision = revokedGovernance.observations.at(-1).decision;
        const revocation = createGovernanceRevocation({
          id: "REVOKE-DECISION-BEFORE-USE",
          target: { kind: "decision", id: issuedDecision.id, hash: issuedDecision.decision_hash },
          effective_at: NOW,
          reason: "Revoke between decision and physical use",
          revoked_by: { type: "human", id: "security-1" },
        });
        fs.writeFileSync(path.join(revocationsRoot, "revoke-policy.json"), `${JSON.stringify(revocation)}\n`);
        assertMutationExecutionAuthorized({ operation: "file.write", path: deniedTarget, evidence_refs: EXACT_EVIDENCE });
        fs.writeFileSync(deniedTarget, "must-not-exist");
      },
    )),
    (error) => error.code === "MUTATION_GOVERNANCE_DENIED"
      && error.details.reason_codes.includes("mutation.authorization_revalidation_failed"),
  );
  assert.equal(fs.existsSync(deniedTarget), false);
});

test("enforce rejects a self-asserted actor without verified host or CI identity", () => {
  const root = fixture(test, "unverified-identity");
  const subject = mutationSubject({ evidence: [] });
  const policy = policyFor(subject);
  const governance = createProjectMutationGovernance({
    root,
    governance_policy: policy,
    canonical_action: "story.update",
    command_path: "story update",
    actor: { type: "human", id: "self-asserted-name" },
  });
  assert.equal(governance.mode, "enforce");
  assert.match(governance.configuration_error, /identity verified by the host or CI/u);
});

test("project configuration is optional and pointer/inline policies are bounded and no-follow", () => {
  const root = fixture(test, "config");
  fs.mkdirSync(path.join(root, ".sdlc", "governance"), { recursive: true });
  const disabled = createProjectMutationGovernance({ root });
  assert.equal(disabled.mode, "disabled");

  const subject = mutationSubject();
  const policy = policyFor(subject);
  const inline = createProjectMutationGovernance({
    root,
    governance_policy: policy,
    canonical_action: "story.update",
    command_path: "story update",
    verified_actor: { verified: true, assurance: "host_verified", actor: ACTOR },
    evidence_paths: [],
    now: () => NOW,
  });
  assert.equal(inline.mode, "enforce");

  const policyPath = path.join(root, ".sdlc", "governance", "policy.json");
  fs.writeFileSync(policyPath, `${JSON.stringify(policy)}\n`);
  const pointer = {
    mode: "audit",
    policy_file: ".sdlc/governance/policy.json",
    decision_receipts_root: ".sdlc/governance/decisions",
    use_receipts_root: ".sdlc/governance/uses",
    revocations_root: ".sdlc/governance/revocations",
    fail_closed: false,
  };
  assert.equal(createProjectMutationGovernance({
    root,
    governance_policy: pointer,
    canonical_action: "story.update",
    command_path: "story update",
    actor: ACTOR,
    now: () => NOW,
  }).mode, "audit");

  const outside = path.join(root, "outside-policy.json");
  fs.writeFileSync(outside, `${JSON.stringify(policy)}\n`);
  fs.rmSync(policyPath);
  fs.symlinkSync(outside, policyPath);
  const unsafe = createProjectMutationGovernance({
    root,
    governance_policy: { ...pointer, mode: "enforce", fail_closed: true },
    canonical_action: "story.update",
    command_path: "story update",
    actor: ACTOR,
  });
  assert.equal(unsafe.mode, "enforce");
  assert.match(unsafe.configuration_error, /symbolic link/u);
});

test("secure JSONL append uses a no-follow append descriptor and complete records", () => {
  const root = fixture(test, "append");
  const target = path.join(root, "events.jsonl");
  for (let index = 0; index < 100; index += 1) appendJsonLineNoFollow(target, { index });
  const records = fs.readFileSync(target, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(records.length, 100);
  assert.deepEqual(records.map(({ index }) => index), Array.from({ length: 100 }, (_, index) => index));

  const outside = path.join(root, "outside.jsonl");
  const linked = path.join(root, "linked.jsonl");
  fs.writeFileSync(outside, "");
  fs.symlinkSync(outside, linked);
  assert.throws(() => appendJsonLineNoFollow(linked, { denied: true }), /symbolic link/u);
  assert.equal(fs.readFileSync(outside, "utf8"), "");
});

test("bootstrap grants are exact and limited to first init or bound recovery material", () => {
  const root = fixture(test, "bootstrap");
  const hash = "a".repeat(64);
  const init = createBootstrapMutationGrant({
    root,
    canonical_action: "init",
    first_time: true,
    exact_mutations: [{ operation: "directory.create", path: ".sdlc" }],
  });
  assert.equal(init.canonical_action, "init");
  assert.deepEqual(init.exact_mutations, [{
    canonical_action: "init",
    operation: "directory.create",
    project_path: ".sdlc",
  }]);
  let initConsumed = false;
  consumeBootstrapMutationGrant(init, {
    canonical_action: "init",
    operation: "directory.create",
    path: ".sdlc",
  }, () => { initConsumed = true; });
  assert.equal(initConsumed, true);
  assert.throws(() => consumeBootstrapMutationGrant(init, {
    canonical_action: "init",
    operation: "directory.create",
    path: ".sdlc",
  }, () => assert.fail("reused grant ran")), /already consumed/u);

  const config = createBootstrapMutationGrant({
    root,
    canonical_action: "config.migrate",
    plan_hash: hash,
    expected_plan_hash: hash,
    exact_mutations: [{ operation: "transaction.execute", path: ".sdlc/config.json" }],
  });
  assert.equal(consumeBootstrapMutationGrant(config, {
    canonical_action: "config.migrate",
    operation: "transaction.execute",
    path: ".sdlc/config.json",
  }, () => "config-consumed"), "config-consumed");

  const identity = createBootstrapMutationGrant({
    root,
    canonical_action: "migration.identity",
    recover: true,
    nonce: "transaction-a",
    expected_nonce: "transaction-a",
    plan_hash: hash,
    expected_plan_hash: hash,
    exact_mutations: [{ operation: "transaction.execute", path: ".sdlc-identity-migration.lock" }],
  });
  assert.equal(consumeBootstrapMutationGrant(identity, {
    canonical_action: "migration.identity",
    operation: "transaction.execute",
    path: ".sdlc-identity-migration.lock",
  }, () => "identity-consumed"), "identity-consumed");
  assert.throws(() => createBootstrapMutationGrant({
    root,
    canonical_action: "init",
    first_time: false,
    exact_mutations: [{ operation: "directory.create", path: ".sdlc" }],
  }), /only valid before/u);
  assert.throws(() => createBootstrapMutationGrant({
    root,
    canonical_action: "config.migrate",
    plan_hash: hash,
    expected_plan_hash: "b".repeat(64),
    exact_mutations: [{ operation: "file.write", path: ".sdlc/config.json" }],
  }), /does not match/u);
  assert.throws(() => createBootstrapMutationGrant({
    root,
    canonical_action: "migration.identity",
    recover: true,
    nonce: "transaction-a",
    expected_nonce: "transaction-b",
    plan_hash: hash,
    expected_plan_hash: hash,
    exact_mutations: [{ operation: "file.write", path: ".sdlc/project.json" }],
  }), /exact transaction nonce/u);
  assert.throws(() => createBootstrapMutationGrant({
    root,
    canonical_action: "story.update",
    exact_mutations: [{ operation: "file.write", path: ".sdlc/story.json" }],
  }), /Unsupported bootstrap/u);
});
