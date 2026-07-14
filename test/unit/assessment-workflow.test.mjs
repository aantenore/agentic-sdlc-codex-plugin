import test from "node:test";
import assert from "node:assert/strict";

import {
  allowedAssessmentTransitions,
  buildAssessmentProposal,
  buildAssessmentUserMessage,
  computeProposalHash,
  createAssessmentWorkflow,
  preflightAssessmentProposal,
  transitionAssessmentWorkflow,
  validateAssessmentWorkflowIntegrity,
  validateProposalIntegrity,
} from "../../lib/assessment-workflow.mjs";

const HASH_A = "a".repeat(64);
const CREATED_AT = "2026-07-14T08:00:00.000Z";

function proposalInput(overrides = {}) {
  return {
    id: "proposal-001",
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
    objective: "Assess and improve the delivery process",
    baseline_ref: { id: "baseline-1", approved_content_hash: HASH_A },
    scope: {
      id: "scope-1",
      included: ["workflow", "tests"],
      excluded: ["production writes"],
    },
    story_reservation: {
      id: "story-1",
      phase: "analysis",
      acceptance_criteria: ["Find failure modes"],
    },
    deliverable: { artifact_type: "markdown", path: "docs/assessment.md" },
    capabilities: { filesystem: "read", shell: "test-only" },
    contract_draft: { contract_id: "contract-1", version: 1 },
    route_intent: { route: "assessment", reason: "process audit" },
    write_set: ["docs/assessment.md"],
    execution_budget: { budget_id: "budget-1", mode: "hard" },
    security: { network: false, secrets: false, production: false },
    approvals: [{ type: "host", required: true }],
    authorization_ref: null,
    application: { strategy: "atomic", rollback: "remove new artifact" },
    ...overrides,
  };
}

test("assessment proposal is canonical, immutable, and content-bound", () => {
  const proposal = buildAssessmentProposal(proposalInput());
  const reordered = buildAssessmentProposal(proposalInput({
    scope: {
      excluded: ["production writes"],
      included: ["workflow", "tests"],
      id: "scope-1",
    },
  }));

  assert.equal(proposal.schema_version, "assessment-proposal:v1");
  assert.equal(proposal.status, "proposal_pending");
  assert.equal(proposal.proposal_hash, reordered.proposal_hash);
  assert.equal(proposal.proposal_hash, computeProposalHash(proposal));
  assert.equal(validateProposalIntegrity(proposal).valid, true);
  assert.equal(Object.isFrozen(proposal.scope), true);

  const tampered = structuredClone(proposal);
  tampered.scope.included.push("unexpected write");
  const integrity = validateProposalIntegrity(tampered);
  assert.equal(integrity.valid, false);
  assert.match(integrity.errors.join("\n"), /does not match/);
});

test("proposal timestamps are explicit and monotonic", () => {
  assert.throws(
    () => buildAssessmentProposal(proposalInput({ updated_at: "2026-07-14T07:59:59.000Z" })),
    /must not be earlier/,
  );
  assert.throws(() => buildAssessmentProposal(proposalInput({ created_at: undefined })), /created_at/);
});

test("workflow enforces legal, authorized, chronological transitions", () => {
  const proposal = buildAssessmentProposal(proposalInput());
  const workflow = createAssessmentWorkflow({ proposal, created_at: CREATED_AT });

  assert.equal(validateAssessmentWorkflowIntegrity(workflow).valid, true);
  assert.deepEqual(allowedAssessmentTransitions("proposal_pending"), ["authorized", "cancelled"]);
  assert.throws(
    () => transitionAssessmentWorkflow(workflow, "running", { at: "2026-07-14T08:01:00.000Z" }),
    /Invalid assessment workflow transition/,
  );
  assert.throws(
    () => transitionAssessmentWorkflow(workflow, "authorized", { at: "2026-07-14T08:01:00.000Z" }),
    /authorization_ref/,
  );

  const authorized = transitionAssessmentWorkflow(workflow, "authorized", {
    at: "2026-07-14T08:01:00.000Z",
    authorization_ref: "authorization-1",
    proposal_hash: proposal.proposal_hash,
    idempotency_key: "authorize-1",
    actor: { type: "human", id: "antonio" },
  });
  assert.equal(authorized.state, "authorized");
  assert.equal(authorized.revision, 1);
  assert.equal(validateAssessmentWorkflowIntegrity(authorized).valid, true);

  const replay = transitionAssessmentWorkflow(authorized, "authorized", {
    idempotency_key: "authorize-1",
  });
  assert.deepEqual(replay, authorized);
  assert.throws(
    () => transitionAssessmentWorkflow(authorized, "running", { idempotency_key: "authorize-1" }),
    /already used/,
  );
  assert.throws(
    () => transitionAssessmentWorkflow(authorized, "running", { at: "2026-07-14T08:00:30.000Z" }),
    /earlier than workflow.updated_at/,
  );

  const running = transitionAssessmentWorkflow(authorized, "running", {
    at: "2026-07-14T08:02:00.000Z",
    idempotency_key: "start-1",
  });
  assert.equal(running.state, "running");
  assert.equal(validateAssessmentWorkflowIntegrity(running).valid, true);
});

test("workflow refuses a tampered historical state", () => {
  const proposal = buildAssessmentProposal(proposalInput());
  const workflow = createAssessmentWorkflow({ proposal, created_at: CREATED_AT });
  const tampered = structuredClone(workflow);
  tampered.state = "completed";
  tampered.terminal = true;

  assert.equal(validateAssessmentWorkflowIntegrity(tampered).valid, false);
  assert.throws(
    () => transitionAssessmentWorkflow(tampered, "cancelled", { at: "2026-07-14T08:01:00.000Z" }),
    /failed integrity validation/,
  );
});

test("workflow can explicitly model checkpoint-one context before proposal review", () => {
  const proposal = buildAssessmentProposal(proposalInput());
  const contextPending = createAssessmentWorkflow({
    proposal,
    state: "context_pending",
    created_at: CREATED_AT,
  });

  assert.equal(contextPending.initial_state, "context_pending");
  assert.deepEqual(allowedAssessmentTransitions("context_pending"), ["proposal_pending", "cancelled"]);
  const proposalPending = transitionAssessmentWorkflow(contextPending, "proposal_pending", {
    at: "2026-07-14T08:00:30.000Z",
    reason: "Checkpoint-one context was approved",
    idempotency_key: "context-approved-1",
  });
  assert.equal(proposalPending.state, "proposal_pending");
  assert.equal(validateAssessmentWorkflowIntegrity(proposalPending).valid, true);
  assert.throws(
    () => transitionAssessmentWorkflow(contextPending, "authorized", {
      at: "2026-07-14T08:00:30.000Z",
      authorization_ref: "authorization-1",
    }),
    /Invalid assessment workflow transition/,
  );
});

test("proposal preflight is conflict-safe and idempotent", () => {
  const candidate = proposalInput();
  const ready = preflightAssessmentProposal({ candidate, idempotency_key: "create-1" });
  assert.equal(ready.ok, true);
  assert.equal(ready.status, "ready");
  assert.equal(ready.action, "create");

  const replayByRecord = preflightAssessmentProposal({
    candidate,
    idempotency_key: "create-1",
    idempotency_record: ready.idempotency_record,
  });
  assert.equal(replayByRecord.status, "idempotent_replay");
  assert.equal(replayByRecord.action, "reuse");

  const changed = proposalInput({ objective: "Materially changed objective" });
  const conflict = preflightAssessmentProposal({
    candidate: changed,
    idempotency_key: "create-1",
    idempotency_record: ready.idempotency_record,
  });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.status, "conflict");

  const existingReplay = preflightAssessmentProposal({ candidate, existing: ready.proposal });
  assert.equal(existingReplay.status, "idempotent_replay");
  assert.equal(existingReplay.proposal.proposal_hash, ready.proposal.proposal_hash);

  const expectedHashConflict = preflightAssessmentProposal({
    candidate,
    expected_proposal_hash: "f".repeat(64),
  });
  assert.equal(expectedHashConflict.status, "conflict");
});

test("user message names the exact approval boundary and gives actionable examples", () => {
  const proposal = buildAssessmentProposal(proposalInput());
  const message = buildAssessmentUserMessage(proposal, { language: "it" });

  assert.match(message.text, new RegExp(proposal.id));
  assert.match(message.text, new RegExp(proposal.proposal_hash));
  assert.match(message.examples.approve, new RegExp(proposal.proposal_hash));
  assert.match(message.examples.revise, /modifica precisa/);
  assert.match(message.examples.reject, /Non autorizzo/);
  assert.equal(message.approval_scope.applies_only_to_presented_content, true);
  assert.equal(message.approval_scope.authorizes_future_material_changes, false);
});
