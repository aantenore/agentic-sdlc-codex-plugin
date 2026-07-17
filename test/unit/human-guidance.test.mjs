import assert from "node:assert/strict";
import test from "node:test";

import {
  actionCheckpointGuidance,
  createHumanGuidance,
  deliveryAutonomyApprovalGuidance,
  deliveryAutonomyProposalGuidance,
  deliveryAutonomyStatusGuidance,
  gateGuidance,
  requirementAutonomyCeilingGuidance,
} from "../../lib/human-guidance.mjs";

const CANONICAL_CODES = [
  "supervised",
  "checkpointed",
  "bounded-autonomous",
  "audit_only",
  "host_verified",
  "pull_request.merge",
];

function humanText(block) {
  return `${block.result}\n${block.impact}\n${block.next_action}`;
}

function assertCanonicalCodesOnlyInDetails(block) {
  assert.deepEqual(Object.keys(block), ["result", "impact", "next_action", "details"]);
  for (const code of CANONICAL_CODES) assert.doesNotMatch(humanText(block), new RegExp(code, "u"));
  assert.equal(typeof block.result, "string");
  assert.equal(typeof block.impact, "string");
  assert.equal(typeof block.next_action, "string");
  assert.equal(typeof block.details, "object");
}

test("explains an Italian requirement ceiling without treating it as delivery authority", () => {
  const guidance = requirementAutonomyCeilingGuidance({
    requirement_id: "REQ-1",
    profile_id: "AUT-REQ-1",
    status: "approved",
    autonomy_ceiling: "bounded-autonomous",
    effective_level: "checkpointed",
    authority_mode: "audit_only",
    reason_codes: ["requirement.authority.audit_only_caps_autonomy"],
  }, { locale: "it" });

  assertCanonicalCodesOnlyInDetails(guidance);
  assert.match(guidance.result, /scegliere al massimo/u);
  assert.match(guidance.impact, /livello reale verrà deciso separatamente/u);
  assert.match(guidance.impact, /soltanto con lavoro autonomo tra checkpoint concordati/u);
  assert.match(guidance.impact, /non ha una firma digitale verificabile/u);
  assert.match(guidance.next_action, /non autorizza una pull request/u);
  assert.equal(guidance.details.autonomy_ceiling, "bounded-autonomous");
  assert.equal(guidance.details.effective_level, "checkpointed");
  assert.equal(guidance.details.authority_mode, "audit_only");
  assert.equal(guidance.details.narrowed, true);
  assert.throws(() => { guidance.details.narrowed = false; }, TypeError);
});

test("explains audit-only narrowing on a proposal bound to one PR and no executed merge", () => {
  const guidance = deliveryAutonomyProposalGuidance({
    id: "AUT-DEL-184",
    status: "proposed",
    delivery_kind: "pull_request",
    requested_level: "bounded-autonomous",
    authority_assurance: { mode: "audit_only" },
    pull_request_target: {
      pr_url: "https://github.example/pr/184",
      merge_allowed: true,
    },
    reason_codes: ["delivery.authority.audit_only_caps_autonomy"],
  }, { locale: "en" });

  assertCanonicalCodesOnlyInDetails(guidance);
  assert.match(guidance.result, /ready for review/u);
  assert.match(guidance.impact, /requested level is independent completion/u);
  assert.match(guidance.impact, /use only independent work between agreed checkpoints/u);
  assert.match(guidance.impact, /only to the identified pull request/u);
  assert.match(guidance.impact, /has not performed it/u);
  assert.equal(guidance.details.requested_level, "bounded-autonomous");
  assert.equal(guidance.details.effective_level, "checkpointed");
  assert.equal(guidance.details.effective_level_inferred, true);
  assert.equal(guidance.details.single_delivery, true);
  assert.equal(guidance.details.reusable_for_another_delivery, false);
  assert.equal(guidance.details.merge_executed, false);
});

test("explains a host-verified approval while keeping merge a separate unexecuted action", () => {
  const guidance = deliveryAutonomyApprovalGuidance({
    profile_id: "AUT-DEL-9",
    status: "active",
    delivery_kind: "pull_request",
    requested_level: "bounded-autonomous",
    effective_level: "bounded-autonomous",
    authority_mode: "host_verified",
    authority_verified: true,
    merge_allowed: true,
    merge_executed: false,
  }, { locale: "it" });

  assertCanonicalCodesOnlyInDetails(guidance);
  assert.match(guidance.result, /approvata e attiva/u);
  assert.match(guidance.impact, /approvazione firmata/u);
  assert.match(guidance.impact, /soltanto per la pull request identificata/u);
  assert.match(guidance.next_action, /non lo ha eseguito/u);
  assert.equal(guidance.details.authority_mode, "host_verified");
  assert.equal(guidance.details.authority_verified, true);
  assert.equal(guidance.details.merge_allowed, true);
  assert.equal(guidance.details.merge_executed, false);
});

test("reports active and terminal delivery status with an explicit single-delivery boundary", () => {
  const active = deliveryAutonomyStatusGuidance({
    status: "active",
    delivery_kind: "pull_request",
    requested_level: "checkpointed",
    effective_level: "checkpointed",
    authority_mode: "audit_only",
  });
  assertCanonicalCodesOnlyInDetails(active);
  assert.match(active.result, /active for one pull request/u);
  assert.match(active.impact, /cannot be reused/u);

  const closed = deliveryAutonomyStatusGuidance({
    status: "merged",
    delivery_kind: "pull_request",
    requested_level: "checkpointed",
    effective_level: "checkpointed",
    authority_mode: "audit_only",
    merge_executed: true,
  });
  assertCanonicalCodesOnlyInDetails(closed);
  assert.match(closed.result, /closed and cannot be reused/u);
  assert.match(closed.next_action, /Create a new profile/u);
  assert.equal(closed.details.merge_executed, true);
});

test("distinguishes audit-only and host-verified action checkpoints without executing merge", () => {
  const audit = actionCheckpointGuidance({
    status: "checkpoint_required",
    action: "pull_request.merge",
    authority_mode: "audit_only",
    merge_executed: false,
  }, { locale: "en" });
  assertCanonicalCodesOnlyInDetails(audit);
  assert.match(audit.result, /paused before execution/u);
  assert.match(audit.impact, /cannot independently verify the approver/u);
  assert.match(audit.next_action, /No merge has been performed/u);
  assert.equal(audit.details.action, "pull_request.merge");
  assert.equal(audit.details.host_receipt_required, false);
  assert.equal(audit.details.execution_performed, false);

  const verified = actionCheckpointGuidance({
    status: "checkpoint_required",
    action: "pull_request.merge",
    authority_mode: "host_verified",
    host_receipt_required: true,
    merge_executed: false,
  }, { locale: "it" });
  assertCanonicalCodesOnlyInDetails(verified);
  assert.match(verified.impact, /prova attendibile/u);
  assert.match(verified.next_action, /Fornisci la prova attendibile/u);
  assert.match(verified.next_action, /Nessun merge è stato eseguito/u);
  assert.equal(verified.details.host_receipt_required, true);

  const authorized = actionCheckpointGuidance({
    status: "authorized",
    action: "pull_request.merge",
    authority_mode: "host_verified",
    authority_verified: true,
    merge_executed: false,
  }, { locale: "en" });
  assertCanonicalCodesOnlyInDetails(authorized);
  assert.match(authorized.result, /authorized, but it has not been executed/u);
  assert.match(authorized.impact, /signed approval has been verified/u);
  assert.match(authorized.next_action, /^Run only the exact displayed operation/u);
  assert.doesNotMatch(authorized.next_action, /Provide|Confirm/u);
});

test("fails closed in human status when an active delivery cannot be evaluated", () => {
  const guidance = deliveryAutonomyStatusGuidance({
    status: "needs_repair",
    delivery_kind: "pull_request",
    requested_level: "bounded-autonomous",
    effective_level: "supervised",
    authority_mode: "host_verified",
    reason_codes: ["autonomy_profile_evaluation_failed"],
  });
  assertCanonicalCodesOnlyInDetails(guidance);
  assert.match(guidance.result, /needs repair and cannot be used now/u);
  assert.match(guidance.impact, /execution is stopped at step-by-step control/u);
  assert.match(guidance.next_action, /Repair and reapprove/u);
  assert.equal(guidance.details.effective_level, "supervised");
});

test("never presents unverified host authority as effective full autonomy", () => {
  const guidance = deliveryAutonomyStatusGuidance({
    status: "active",
    delivery_kind: "pull_request",
    requested_level: "bounded-autonomous",
    effective_level: "bounded-autonomous",
    authority_mode: "host_verified",
    authority_verified: false,
  });
  assertCanonicalCodesOnlyInDetails(guidance);
  assert.match(guidance.impact, /step-by-step control/u);
  assert.match(guidance.impact, /signed approval .* is required/u);
  assert.doesNotMatch(guidance.impact, /agent can actually work with independent completion/u);
  assert.equal(guidance.details.effective_level, "supervised");
  assert.equal(guidance.details.authority_verified, false);
});

test("explains passed and failed gates without leaking canonical blocker codes", () => {
  const passed = gateGuidance({
    status: "passed",
    scope: "story",
    merge_executed: false,
    warnings: ["gate.optional_evidence_missing"],
  }, { locale: "en" });
  assertCanonicalCodesOnlyInDetails(passed);
  assert.match(passed.result, /without a blocking issue/u);
  assert.match(passed.impact, /did not change, release, deploy, or merge anything/u);
  assert.deepEqual(passed.details.warnings, ["gate.optional_evidence_missing"]);

  const failed = gateGuidance({
    status: "failed",
    errors: ["baseline.source_stale", "contract.approval_missing"],
    next_command: "agentic-sdlc gate check --strict",
  }, { locale: "it" });
  assertCanonicalCodesOnlyInDetails(failed);
  assert.match(failed.result, /2 blocco\/i/u);
  assert.doesNotMatch(humanText(failed), /baseline\.source_stale/u);
  assert.deepEqual(failed.details.errors, ["baseline.source_stale", "contract.approval_missing"]);
  assert.equal(failed.details.next_command, "agentic-sdlc gate check --strict");
});

test("supports localized message overrides without changing the block contract", () => {
  const guidance = createHumanGuidance({
    locale: "en-US",
    messages: {
      "gate.result.passed": "CUSTOM RESULT",
      "gate.impact.passed": "CUSTOM IMPACT",
      "gate.next.passed": "CUSTOM NEXT",
    },
  }).gate({ status: "passed" });
  assert.deepEqual(
    {
      result: guidance.result,
      impact: guidance.impact,
      next_action: guidance.next_action,
    },
    {
      result: "CUSTOM RESULT",
      impact: "CUSTOM IMPACT",
      next_action: "CUSTOM NEXT",
    },
  );
  assert.throws(() => createHumanGuidance({ locale: "fr" }), /Unsupported/u);
});
