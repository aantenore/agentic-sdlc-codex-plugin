import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { computeStableHash } from "../../lib/canonical.mjs";
import {
  computeActorIdentityHash,
  createCommandSubject,
  validateCommandSubjectIntegrity,
} from "../../lib/governance/command-subject.mjs";
import {
  computeGovernanceDecisionHash,
  computeGovernanceRevocationHash,
  computeGovernanceUseReceiptHash,
  createGovernancePolicy,
  createGovernanceRevocation,
  createGovernanceUseReceipt,
  evaluateGovernancePolicy,
  validateGovernanceDecisionIntegrity,
  validateGovernancePolicyIntegrity,
  validateGovernanceRevocationIntegrity,
  validateGovernanceUseReceiptIntegrity,
} from "../../lib/governance/policy-engine.mjs";
import { validateAgainstSchema } from "../../lib/json-schema-validator.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SCHEMA_DIR = path.join(ROOT, "schemas");
const VALID_FROM = "2026-07-18T10:00:00.000Z";
const EVALUATED_AT = "2026-07-18T10:05:00.000Z";
const EXPIRES_AT = "2026-07-19T10:00:00.000Z";
const HASH_A = computeStableHash({ evidence: "contract-a" });
const HASH_B = computeStableHash({ evidence: "contract-b" });
const WRITER = Object.freeze({ type: "agent", id: "writer-1" });
const REVIEWER_ONE = Object.freeze({ type: "human", id: "reviewer-1" });
const REVIEWER_TWO = Object.freeze({ type: "human", id: "reviewer-2" });

function subject(overrides = {}) {
  return createCommandSubject({
    command_path: overrides.command_path ?? "story update",
    canonical_action: overrides.action ?? "story.update",
    scope_refs: overrides.scope_refs ?? [{ kind: "path", id: ".sdlc/stories/ST-1" }],
    evidence_refs: overrides.evidence_refs ?? [{ kind: "contract", id: "CONTRACT-1", hash: HASH_A }],
    payloads: overrides.payloads ?? { request: { mutable: true } },
  });
}

function policyFor(commandSubject, overrides = {}) {
  return createGovernancePolicy({
    id: overrides.id ?? "POLICY-1",
    valid_from: overrides.valid_from ?? VALID_FROM,
    expires_at: Object.hasOwn(overrides, "expires_at") ? overrides.expires_at : EXPIRES_AT,
    decision_ttl_seconds: overrides.decision_ttl_seconds ?? 600,
    role_bindings: overrides.role_bindings ?? [
      { id: "BIND-WRITER", role: "writer", actor: WRITER },
    ],
    rules: overrides.rules ?? [
      {
        id: "ALLOW-STORY",
        effect: "allow",
        action: commandSubject.command.action,
        scope_refs: commandSubject.scope_refs,
        evidence_refs: commandSubject.evidence_refs,
        actor_roles: ["writer"],
      },
    ],
  });
}

function decide(policy, commandSubject, overrides = {}) {
  return evaluateGovernancePolicy({
    policy,
    subject: commandSubject,
    actor: overrides.actor ?? WRITER,
    approvals: overrides.approvals ?? [],
    revocations: overrides.revocations ?? [],
    evaluated_at: overrides.evaluated_at ?? EVALUATED_AT,
    decision_id: overrides.decision_id ?? "DECISION-1",
  });
}

function approval(id, actor, commandSubject, overrides = {}) {
  return {
    id,
    actor,
    subject_hash: overrides.subject_hash ?? commandSubject.subject_hash,
    approved_at: overrides.approved_at ?? "2026-07-18T10:04:00.000Z",
    expires_at: Object.hasOwn(overrides, "expires_at")
      ? overrides.expires_at
      : "2026-07-18T11:00:00.000Z",
    evidence_ref: overrides.evidence_ref ?? {
      kind: "approval_receipt",
      id: `EVIDENCE-${id}`,
      hash: computeStableHash({ id, actor }),
    },
  };
}

function schemaValid(schemaName, value) {
  return validateAgainstSchema(value, schemaName, { schemaDir: SCHEMA_DIR });
}

test("command subjects retain exact safe refs and hashes but never arbitrary payload values", () => {
  const secretText = "never-persist-this-prompt-or-secret";
  const first = subject({ payloads: { request: { prompt: secretText, nested: [1, 2, 3] } } });
  const second = createCommandSubject({
    command_path: "story update",
    canonical_action: "story.update",
    evidence_refs: [{ hash: HASH_A, id: "CONTRACT-1", kind: "contract" }],
    scope_refs: [{ id: ".sdlc/stories/ST-1", kind: "path" }],
    payload_refs: [{ name: "request", hash: computeStableHash({ prompt: secretText, nested: [1, 2, 3] }) }],
  });

  assert.equal(first.subject_hash, second.subject_hash);
  assert.equal(JSON.stringify(first).includes(secretText), false);
  assert.deepEqual(first.payload_refs, [{ name: "request", hash: computeStableHash({ prompt: secretText, nested: [1, 2, 3] }) }]);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.command), true);
  assert.equal(validateCommandSubjectIntegrity(first).valid, true);
  assert.throws(
    () => subject({ scope_refs: [{ kind: "owner", id: "person@example.com" }] }),
    /unsafe or unsupported format/u,
  );
  assert.throws(
    () => subject({ payloads: { api_token: "sensitive" } }),
    /sensitive/u,
  );
  assert.throws(
    () => createCommandSubject({
      command_path: "story update",
      canonical_action: "story.update",
      scope_refs: [],
      evidence_refs: [],
      raw_arguments: { prompt: secretText },
    }),
    /unsupported field/u,
  );
  let unsafeKeyError;
  try {
    createCommandSubject({
      command_path: "story update",
      canonical_action: "story.update",
      scope_refs: [],
      evidence_refs: [],
      payloads: { [secretText]: "value" },
    });
  } catch (error) {
    unsafeKeyError = error;
  }
  assert.ok(unsafeKeyError);
  assert.equal(unsafeKeyError.message.includes(secretText), false);
});

test("allow requires exact action, complete scope set, and complete evidence set", () => {
  const exact = subject();
  const policy = policyFor(exact);
  assert.equal(decide(policy, exact).decision, "allow");

  const variants = [
    subject({ action: "story.complete" }),
    subject({ scope_refs: [{ kind: "path", id: ".sdlc/stories/ST-2" }] }),
    subject({ evidence_refs: [{ kind: "contract", id: "CONTRACT-1", hash: HASH_B }] }),
    subject({ evidence_refs: [
      { kind: "contract", id: "CONTRACT-1", hash: HASH_A },
      { kind: "test", id: "TEST-1", hash: HASH_B },
    ] }),
  ];
  for (const [index, variant] of variants.entries()) {
    const decision = decide(policy, variant, { decision_id: `DECISION-MISMATCH-${index}` });
    assert.equal(decision.decision, "deny");
    assert.ok(decision.reason_codes.includes("rule.no_exact_match"));
  }
});

test("an exact deny rule wins even when an exact allow rule also succeeds", () => {
  const exact = subject();
  const allow = {
    id: "ALLOW-STORY",
    effect: "allow",
    action: exact.command.action,
    scope_refs: exact.scope_refs,
    evidence_refs: exact.evidence_refs,
    actor_roles: ["writer"],
  };
  const deny = { ...allow, id: "DENY-STORY", effect: "deny", actor_roles: [] };
  const policy = policyFor(exact, { rules: [allow, deny] });
  const decision = decide(policy, exact);

  assert.equal(decision.decision, "deny");
  assert.deepEqual(decision.matched_deny_rule_ids, ["DENY-STORY"]);
  assert.ok(decision.reason_codes.includes("rule.explicit_deny"));
});

test("actor bindings are exact, expire exclusively, and can be revoked by exact hash", () => {
  const exact = subject();
  const expiringPolicy = policyFor(exact, {
    role_bindings: [{
      id: "BIND-WRITER",
      role: "writer",
      actor: WRITER,
      expires_at: EVALUATED_AT,
    }],
  });
  assert.equal(decide(expiringPolicy, exact).decision, "deny");
  assert.equal(decide(policyFor(exact), exact, { actor: { type: "agent", id: "writer-2" } }).decision, "deny");

  const policy = policyFor(exact);
  const binding = policy.role_bindings[0];
  const revocation = createGovernanceRevocation({
    id: "REVOKE-BINDING",
    target: { kind: "role_binding", id: binding.id, hash: computeStableHash(binding) },
    effective_at: "2026-07-18T10:03:00.000Z",
    created_at: "2026-07-18T10:02:00.000Z",
    reason: "Writer access removed",
    revoked_by: { type: "human", id: "security-1" },
  });
  assert.equal(decide(policy, exact, { revocations: [revocation] }).decision, "deny");

  const unrelated = createGovernanceRevocation({
    id: "REVOKE-OTHER-SNAPSHOT",
    target: { kind: "role_binding", id: binding.id, hash: "0".repeat(64) },
    effective_at: "2026-07-18T10:03:00.000Z",
    created_at: "2026-07-18T10:02:00.000Z",
    reason: "Different immutable binding snapshot",
    revoked_by: { type: "human", id: "security-1" },
  });
  assert.equal(decide(policy, exact, { revocations: [unrelated] }).decision, "allow");
});

test("policy expiry and policy revocation fail closed", () => {
  const exact = subject();
  const expired = policyFor(exact, { expires_at: EVALUATED_AT });
  const expiredDecision = decide(expired, exact);
  assert.equal(expiredDecision.decision, "deny");
  assert.ok(expiredDecision.reason_codes.includes("policy.expired"));

  const policy = policyFor(exact);
  const revocation = createGovernanceRevocation({
    id: "REVOKE-POLICY",
    target: { kind: "policy", id: policy.id, hash: policy.policy_hash },
    effective_at: "2026-07-18T10:04:00.000Z",
    reason: "Policy superseded",
    revoked_by: { type: "human", id: "security-1" },
  });
  const revokedDecision = decide(policy, exact, { revocations: [revocation] });
  assert.equal(revokedDecision.decision, "deny");
  assert.ok(revokedDecision.reason_codes.includes("policy.revoked"));
});

test("quorum counts distinct bound identities, never repeated approval records", () => {
  const exact = subject();
  const policy = policyFor(exact, {
    role_bindings: [
      { id: "BIND-WRITER", role: "writer", actor: WRITER },
      { id: "BIND-REVIEWER-1", role: "reviewer", actor: REVIEWER_ONE },
      { id: "BIND-REVIEWER-2", role: "reviewer", actor: REVIEWER_TWO },
    ],
    rules: [{
      id: "ALLOW-WITH-QUORUM",
      effect: "allow",
      action: exact.command.action,
      scope_refs: exact.scope_refs,
      evidence_refs: exact.evidence_refs,
      actor_roles: ["writer"],
      quorum: { minimum: 2, roles: ["reviewer"], distinct_identities: true },
    }],
  });
  const repeatedIdentity = [
    approval("APPROVAL-1", REVIEWER_ONE, exact),
    approval("APPROVAL-2", REVIEWER_ONE, exact),
  ];
  const denied = decide(policy, exact, { approvals: repeatedIdentity });
  assert.equal(denied.decision, "deny");
  assert.ok(denied.reason_codes.includes("quorum.distinct_identities_not_met"));

  const allowed = decide(policy, exact, {
    approvals: [approval("APPROVAL-1", REVIEWER_ONE, exact), approval("APPROVAL-2", REVIEWER_TWO, exact)],
  });
  assert.equal(allowed.decision, "allow");
  assert.equal(allowed.grant.approval_refs.length, 2);
  assert.notEqual(allowed.grant.approval_refs[0].actor_identity_hash, allowed.grant.approval_refs[1].actor_identity_hash);
});

test("segregation of duties rejects one identity serving both sides for the same subject", () => {
  const exact = subject();
  const policy = policyFor(exact, {
    role_bindings: [
      { id: "BIND-WRITER", role: "writer", actor: WRITER },
      { id: "BIND-WRITER-AS-REVIEWER", role: "reviewer", actor: WRITER },
      { id: "BIND-REVIEWER-1", role: "reviewer", actor: REVIEWER_ONE },
    ],
    rules: [{
      id: "ALLOW-SEPARATED",
      effect: "allow",
      action: exact.command.action,
      scope_refs: exact.scope_refs,
      evidence_refs: exact.evidence_refs,
      actor_roles: ["writer"],
      quorum: { minimum: 1, roles: ["reviewer"], distinct_identities: true },
      separation_of_duties: [{ left_role: "writer", right_role: "reviewer" }],
    }],
  });
  const selfApproved = decide(policy, exact, { approvals: [approval("APPROVAL-SELF", WRITER, exact)] });
  assert.equal(selfApproved.decision, "deny");
  assert.ok(selfApproved.reason_codes.includes("separation_of_duties.identity_overlap"));

  const separatedPolicy = policyFor(exact, {
    role_bindings: [
      { id: "BIND-WRITER", role: "writer", actor: WRITER },
      { id: "BIND-REVIEWER-1", role: "reviewer", actor: REVIEWER_ONE },
    ],
    rules: policy.rules,
  });

  const otherSubjectApproval = approval("APPROVAL-OTHER", REVIEWER_ONE, exact, { subject_hash: HASH_B });
  const wrongSubject = decide(separatedPolicy, exact, { approvals: [otherSubjectApproval] });
  assert.equal(wrongSubject.decision, "deny");
  assert.ok(wrongSubject.reason_codes.includes("quorum.distinct_identities_not_met"));

  assert.equal(
    decide(separatedPolicy, exact, { approvals: [approval("APPROVAL-REVIEWER", REVIEWER_ONE, exact)] }).decision,
    "allow",
  );
});

test("evaluation requires injected or explicit time and ids and stays deterministic", () => {
  const exact = subject();
  const policy = policyFor(exact);
  assert.throws(
    () => evaluateGovernancePolicy({ policy, subject: exact, actor: WRITER }),
    /time provider is injected/u,
  );
  const dependencies = {
    now: () => EVALUATED_AT,
    id: (kind) => `${kind.toUpperCase()}-INJECTED`,
  };
  const first = evaluateGovernancePolicy({ policy, subject: exact, actor: WRITER }, dependencies);
  const second = evaluateGovernancePolicy({ policy, subject: exact, actor: WRITER }, dependencies);
  assert.equal(first.id, "DECISION-INJECTED");
  assert.equal(first.decision_hash, second.decision_hash);

  const source = fs.readFileSync(path.join(ROOT, "lib", "governance", "policy-engine.mjs"), "utf8");
  assert.doesNotMatch(source, /node:fs|process\.env|Date\.now\(\)|new Date\(\)/u);
});

test("use receipts replay the decision, enforce expiry/revocation, and reject forged allows", () => {
  const exact = subject();
  const policy = policyFor(exact);
  const decision = decide(policy, exact);
  const receipt = createGovernanceUseReceipt({
    policy,
    decision,
    receipt_id: "USE-1",
    used_at: "2026-07-18T10:06:00.000Z",
    evidence_refs: [{ kind: "execution", id: "EXEC-1", hash: HASH_B }],
  });
  assert.equal(validateGovernanceUseReceiptIntegrity(receipt).valid, true);
  assert.equal(Object.isFrozen(receipt), true);

  assert.throws(
    () => createGovernanceUseReceipt({
      policy,
      decision,
      receipt_id: "USE-EXPIRED",
      used_at: decision.valid_until,
    }),
    /expired/u,
  );

  const revokeDecision = createGovernanceRevocation({
    id: "REVOKE-DECISION",
    target: { kind: "decision", id: decision.id, hash: decision.decision_hash },
    effective_at: "2026-07-18T10:05:30.000Z",
    reason: "Decision withdrawn before use",
    revoked_by: { type: "human", id: "security-1" },
  });
  assert.throws(
    () => createGovernanceUseReceipt({
      policy,
      decision,
      receipt_id: "USE-REVOKED",
      used_at: "2026-07-18T10:06:00.000Z",
      revocations: [revokeDecision],
    }),
    /revoked/u,
  );

  const forgedBase = {
    ...structuredClone(decision),
    actor: { type: "agent", id: "intruder" },
    actor_identity_hash: computeActorIdentityHash({ type: "agent", id: "intruder" }),
  };
  forgedBase.decision_hash = computeGovernanceDecisionHash(forgedBase);
  assert.equal(validateGovernanceDecisionIntegrity(forgedBase).valid, true);
  assert.throws(
    () => createGovernanceUseReceipt({
      policy,
      decision: forgedBase,
      receipt_id: "USE-FORGED",
      used_at: "2026-07-18T10:06:00.000Z",
    }),
    /does not replay/u,
  );
});

test("policy, decision, use, and revocation snapshots expose stable tamper checks", () => {
  const exact = subject();
  const policy = policyFor(exact);
  const decision = decide(policy, exact);
  const use = createGovernanceUseReceipt({
    policy,
    decision,
    receipt_id: "USE-1",
    used_at: "2026-07-18T10:06:00.000Z",
  });
  const revocation = createGovernanceRevocation({
    id: "REVOKE-POLICY",
    target: { kind: "policy", id: policy.id, hash: policy.policy_hash },
    effective_at: "2026-07-18T10:07:00.000Z",
    reason: "Superseded",
    revoked_by: { type: "human", id: "security-1" },
  });

  assert.equal(validateGovernancePolicyIntegrity(policy).valid, true);
  assert.equal(validateGovernanceDecisionIntegrity(decision).valid, true);
  assert.equal(validateGovernanceUseReceiptIntegrity(use).valid, true);
  assert.equal(validateGovernanceRevocationIntegrity(revocation).valid, true);
  assert.equal(validateGovernancePolicyIntegrity({ ...policy, decision_ttl_seconds: 601 }).valid, false);
  assert.equal(validateGovernanceDecisionIntegrity({ ...decision, actor_roles: [] }).valid, false);
  assert.equal(validateGovernanceUseReceiptIntegrity({ ...use, action: "story.complete" }).valid, false);
  assert.equal(validateGovernanceRevocationIntegrity({ ...revocation, reason: "Changed" }).valid, false);

  const extendedDecision = { ...decision, unexpected: "field" };
  extendedDecision.decision_hash = computeGovernanceDecisionHash(extendedDecision);
  assert.equal(validateGovernanceDecisionIntegrity(extendedDecision).valid, false);
  const extendedUse = { ...use, unexpected: "field" };
  extendedUse.receipt_hash = computeGovernanceUseReceiptHash(extendedUse);
  assert.equal(validateGovernanceUseReceiptIntegrity(extendedUse).valid, false);
  const extendedRevocation = { ...revocation, unexpected: "field" };
  extendedRevocation.revocation_hash = computeGovernanceRevocationHash(extendedRevocation);
  assert.equal(validateGovernanceRevocationIntegrity(extendedRevocation).valid, false);
});

test("all governance records conform to their schemas", () => {
  const exact = subject();
  const approvals = [approval("APPROVAL-1", REVIEWER_ONE, exact)];
  const policy = policyFor(exact, {
    role_bindings: [
      { id: "BIND-WRITER", role: "writer", actor: WRITER },
      { id: "BIND-REVIEWER", role: "reviewer", actor: REVIEWER_ONE },
    ],
    rules: [{
      id: "ALLOW-WITH-QUORUM",
      effect: "allow",
      action: exact.command.action,
      scope_refs: exact.scope_refs,
      evidence_refs: exact.evidence_refs,
      actor_roles: ["writer"],
      quorum: { minimum: 1, roles: ["reviewer"] },
      separation_of_duties: [{ left_role: "writer", right_role: "reviewer" }],
    }],
  });
  const decision = decide(policy, exact, { approvals });
  const use = createGovernanceUseReceipt({
    policy,
    decision,
    approvals,
    receipt_id: "USE-1",
    used_at: "2026-07-18T10:06:00.000Z",
  });
  const revocation = createGovernanceRevocation({
    id: "REVOKE-DECISION",
    target: { kind: "decision", id: decision.id, hash: decision.decision_hash },
    effective_at: "2026-07-18T10:07:00.000Z",
    reason: "No longer needed",
    revoked_by: { type: "human", id: "security-1" },
  });

  for (const [schemaName, value] of [
    ["governance-policy.schema.json", policy],
    ["governance-policy-decision.schema.json", decision],
    ["governance-policy-use-receipt.schema.json", use],
    ["governance-policy-revocation.schema.json", revocation],
  ]) {
    const result = schemaValid(schemaName, value);
    assert.equal(result.valid, true, `${schemaName}: ${JSON.stringify(result.errors)}`);
  }
});

test("governance configuration is optional and the frozen 0.11 snapshot remains unchanged", () => {
  const compat = JSON.parse(fs.readFileSync(
    path.join(ROOT, "templates", "config-compat", "sdlc-config-v1-0.11.0.json"),
    "utf8",
  ));
  assert.equal(computeStableHash(compat), "f460c67be74ec2e2385befa438b47740e2cb3400baf6327a03be9210634a419f");
  assert.equal(Object.hasOwn(compat, "governance_policy"), false);
  assert.equal(schemaValid("sdlc-config.schema.json", compat).valid, true);

  const configured = {
    ...compat,
    governance_policy: {
      mode: "enforce",
      policy_file: ".sdlc/governance/policy.json",
      decision_receipts_root: ".sdlc/governance/decisions",
      use_receipts_root: ".sdlc/governance/uses",
      revocations_root: ".sdlc/governance/revocations",
      fail_closed: true,
    },
  };
  const result = schemaValid("sdlc-config.schema.json", configured);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.equal(schemaValid("sdlc-config.schema.json", {
    ...configured,
    governance_policy: { ...configured.governance_policy, fail_closed: false },
  }).valid, false);
});
