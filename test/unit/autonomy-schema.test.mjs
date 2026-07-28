import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  AUTONOMY_LEVELS,
  buildDeliveryExecutionProfile,
  buildRequirementExecutionProfile,
} from "../../lib/autonomy-policy.mjs";
import {
  assertAgainstSchema,
  validateAgainstSchema,
} from "../../lib/json-schema-validator.mjs";

const NOW = "2026-07-17T10:00:00.000Z";
const HASH = Object.freeze({
  approval: "a".repeat(64),
  contract: "b".repeat(64),
  requirement: "c".repeat(64),
  requirementProfile: "d".repeat(64),
  story: "e".repeat(64),
});

function ref(id, hash = HASH.approval, refPath = null) {
  return { id, path: refPath, hash };
}

function requirementProfile(overrides = {}) {
  return buildRequirementExecutionProfile({
    id: "AUT-REQ-SCHEMA",
    status: "active",
    requirement_ref: {
      id: "REQ-SCHEMA",
      version: 1,
      path: ".sdlc/requirements/REQ-SCHEMA.json",
      hash: HASH.requirement,
    },
    autonomy_ceiling: "bounded-autonomous",
    phase_levels: { release: "checkpointed" },
    material_scope: {
      objective: "Validate the autonomy artifact schemas",
      scope: ["schemas", "tests"],
      non_goals: ["production deployment"],
    },
    constraints: {
      allowed_tools: ["apply_patch"],
      allowed_capabilities: ["repository.write"],
      allowed_environments: ["workspace"],
      allowed_write_paths: ["schemas/", "test/"],
      forbidden_actions: ["production.deploy"],
      budget_ref: null,
    },
    approval_ref: ref("APPROVAL-REQ-SCHEMA"),
    created_at: NOW,
    valid_from: NOW,
    ...overrides,
  });
}

function deliveryProfile(requirement, overrides = {}) {
  return buildDeliveryExecutionProfile({
    id: "AUT-DELIVERY-SCHEMA",
    status: "active",
    delivery_id: "PR-SCHEMA",
    delivery_kind: "pull_request",
    requirement_profile_refs: [ref(requirement.id, requirement.profile_hash)],
    story_refs: [ref("ST-SCHEMA", HASH.story)],
    contract_refs: [ref("CONTRACT-SCHEMA", HASH.contract)],
    material_scope: {
      objective: "Ship one exact pull request",
      scope: ["ST-SCHEMA", "CONTRACT-SCHEMA"],
      release_target: "pull_request",
    },
    requested_level: "checkpointed",
    phase_levels: { release: "supervised" },
    constraints: {
      allowed_tools: ["apply_patch"],
      allowed_capabilities: ["repository.write"],
      allowed_environments: ["workspace"],
      allowed_write_paths: ["schemas/", "test/"],
      forbidden_actions: ["production.deploy"],
      budget_ref: null,
    },
    pull_request_target: {
      repository: "aantenore/agentic-sdlc-codex-plugin",
      base_branch: "main",
      head_branch: "codex/requirement-pr-autonomy",
      allowed_actions: ["git.commit", "git.push"],
      merge_allowed: false,
    },
    approval_ref: ref("APPROVAL-DELIVERY-SCHEMA"),
    created_at: NOW,
    valid_from: NOW,
    ...overrides,
  });
}

function localDeliveryProfile(requirement) {
  return buildDeliveryExecutionProfile({
    id: "AUT-LOCAL-SCHEMA",
    status: "active",
    delivery_id: "LOCAL-SCHEMA",
    delivery_kind: "local_release",
    requirement_profile_refs: [ref(requirement.id, requirement.profile_hash)],
    story_refs: [ref("ST-SCHEMA", HASH.story)],
    contract_refs: [ref("CONTRACT-SCHEMA", HASH.contract)],
    material_scope: {
      objective: "Install and verify one local build",
      scope: ["local package"],
      release_target: "/workspace/travelops/dist",
    },
    requested_level: "bounded-autonomous",
    constraints: {
      allowed_tools: ["exec_command"],
      allowed_capabilities: ["package.local"],
      allowed_environments: ["local"],
      allowed_write_paths: ["/workspace/travelops/dist"],
      forbidden_actions: ["production.deploy"],
      budget_ref: null,
    },
    local_release_target: {
      environment: "local",
      root_path: "/workspace/travelops",
      allowed_write_paths: ["/workspace/travelops/dist"],
      allowed_actions: ["build.local", "release.local", "test.run"],
      smoke_tests: ['["node","--version"]'],
      rollback: { required: true, procedure: "Restore the previous local package" },
      external_access_allowed: false,
      production_access_allowed: false,
      destructive_actions_allowed: false,
    },
    approval_ref: ref("APPROVAL-LOCAL-SCHEMA"),
    created_at: NOW,
    valid_from: NOW,
  });
}

function validDecision() {
  return {
    kind: "autonomy_decision",
    schema_version: "autonomy-decision:v1",
    version: 1,
    id: "AUT-DECISION-SCHEMA",
    delivery: {
      id: "PR-SCHEMA",
      kind: "pull_request",
      profile_id: "AUT-DELIVERY-SCHEMA",
      profile_hash: HASH.requirementProfile,
    },
    phase: "implementation",
    requested_level: "bounded-autonomous",
    effective_level: "checkpointed",
    execution_status: "checkpoint_required",
    requires_human_approval: false,
    requires_checkpoint: true,
    autonomous: false,
    blocked: false,
    source_constraints: [{
      source: "host",
      level: "checkpointed",
      valid: true,
      blocked: false,
      reason_codes: ["authority.audit_only_caps_autonomy"],
    }],
    reason_codes: ["authority.audit_only_caps_autonomy"],
    material_drift: [],
    evaluated_at: NOW,
    decision_hash: "f".repeat(64),
    hash_algorithm: "sha256:stable-json:v1",
  };
}

function deliveryActionReceipt({
  schemaVersion = "delivery-action-receipt:v2",
  status = "completed",
  includeCompletionRequest = status === "completed",
} = {}) {
  const profileRef = ref(
    "AUT-DELIVERY-SCHEMA",
    HASH.requirementProfile,
    ".sdlc/autonomy/deliveries/AUT-DELIVERY-SCHEMA.json",
  );
  const authorizationRef = ref(
    "AUT-ACT-AUTHORIZED",
    "1".repeat(64),
    ".sdlc/autonomy/actions/AUT-ACT-AUTHORIZED.json",
  );
  const evidence = [{ path: ".sdlc/tests/ST-SCHEMA.json", sha256: "2".repeat(64) }];
  const receipt = {
    id: status === "completed" ? "AUT-ACT-COMPLETED" : "AUT-ACT-AUTHORIZED",
    kind: "delivery_action_receipt",
    schema_version: schemaVersion,
    profile_ref: profileRef,
    delivery: { id: "PR-SCHEMA", kind: "pull_request" },
    action: "test.run",
    effective_level: "checkpointed",
    checkpoint_required: false,
    approval: null,
    runtime_target: null,
    action_details: {},
    authorization_receipt_ref: status === "completed" ? authorizationRef : null,
    local_release_verification: null,
    evidence: status === "completed" ? evidence : [],
    outcome: status === "completed" ? "passed" : null,
    status,
    authorized_by: { id: "schema-test", type: "agent" },
    authorized_at: NOW,
    audit: {},
    receipt_hash: "3".repeat(64),
    hash_algorithm: "sha256:stable-json:v1",
  };
  if (includeCompletionRequest) {
    receipt.completion_request = {
      schema_version: "delivery-action-completion-request:v1",
      profile_ref: profileRef,
      action: "test.run",
      outcome: "passed",
      authorization_receipt_ref: authorizationRef,
      evidence,
      operation_args: {},
      request_hash: "4".repeat(64),
      hash_algorithm: "sha256:stable-json:v1",
    };
  }
  return receipt;
}

function profileTaskStartReceipt({
  schemaVersion = "profile-task-start-receipt:v2",
  includeWorkflowRef = schemaVersion === "profile-task-start-receipt:v2",
} = {}) {
  return {
    id: "START-ST-SCHEMA",
    kind: "profile_task_start_receipt",
    schema_version: schemaVersion,
    story_id: "ST-SCHEMA",
    phase: "implementation",
    route: "claim_and_implement",
    contract_id: "CONTRACT-SCHEMA",
    contract_approval_hash: HASH.contract,
    delivery_profile_ref: null,
    autonomy_decision_ref: null,
    ...(includeWorkflowRef
      ? {
          workflow_instance_ref: ref(
            "WF-ST-SCHEMA",
            HASH.story,
            ".sdlc/workflows/instances/WF-ST-SCHEMA/instance.json",
          ),
        }
      : {}),
    delivery_start_receipt_ref: null,
    autonomy_level: "supervised",
    start_basis: "explicit-confirmation",
    status: "confirmed",
    authorization_ref: null,
    authorization_use_ref: null,
    authority_assurance: {},
    confirmed_by: { id: "schema-test", type: "agent" },
    confirmed_at: NOW,
    audit: {},
  };
}

test("autonomy builders produce schema-valid proposed, PR, and local-release artifacts", () => {
  const proposedRequirement = requirementProfile({
    status: "proposed",
    approval_ref: null,
  });
  const activeRequirement = requirementProfile();
  const pullRequest = deliveryProfile(activeRequirement);
  const localRelease = localDeliveryProfile(activeRequirement);

  assertAgainstSchema(proposedRequirement, "requirement-execution-profile");
  assertAgainstSchema(activeRequirement, "requirement-execution-profile");
  assertAgainstSchema(pullRequest, "delivery-execution-profile");
  assertAgainstSchema(localRelease, "delivery-execution-profile");
  assert.equal(pullRequest.local_release_target, null);
  assert.equal(localRelease.pull_request_target, null);
});

test("delivery action receipt v2 binds completions while v1 remains readable", () => {
  const currentAuthorization = deliveryActionReceipt({ status: "authorized" });
  const currentCompletion = deliveryActionReceipt();
  assertAgainstSchema(currentAuthorization, "delivery-action-receipt");
  assertAgainstSchema(currentCompletion, "delivery-action-receipt");

  const currentCompletionWithoutRequest = deliveryActionReceipt({
    includeCompletionRequest: false,
  });
  assert.equal(
    validateAgainstSchema(
      currentCompletionWithoutRequest,
      "delivery-action-receipt",
    ).valid,
    false,
  );

  const inconsistentAuthorization = deliveryActionReceipt({
    status: "authorized",
    includeCompletionRequest: true,
  });
  assert.equal(
    validateAgainstSchema(inconsistentAuthorization, "delivery-action-receipt").valid,
    false,
  );

  const legacyCompletion = deliveryActionReceipt({
    schemaVersion: "delivery-action-receipt:v1",
    includeCompletionRequest: false,
  });
  assertAgainstSchema(legacyCompletion, "delivery-action-receipt");
});

test("task-start receipt v2 requires workflow binding while byte-compatible v1 forbids it", () => {
  const schemaDir = path.join(process.cwd(), "schemas");
  const schemaRegistry = new Map();
  for (const schemaFile of [
    "profile-task-start-receipt-v1.schema.json",
    "profile-task-start-receipt.schema.json",
  ]) {
    const schema = JSON.parse(fs.readFileSync(path.join(schemaDir, schemaFile), "utf8"));
    assert.equal(schemaRegistry.has(schema.$id), false, `duplicate schema id ${schema.$id}`);
    schemaRegistry.set(schema.$id, schema);
  }
  assert.equal(schemaRegistry.size, 2);

  const current = profileTaskStartReceipt();
  const sharedCache = new Map();
  assert.equal(
    validateAgainstSchema(current, "profile-task-start-receipt", {
      schemaDir,
      cache: sharedCache,
    }).valid,
    true,
  );

  const currentWithoutBinding = profileTaskStartReceipt({
    includeWorkflowRef: false,
  });
  assert.equal(
    validateAgainstSchema(currentWithoutBinding, "profile-task-start-receipt").valid,
    false,
  );

  const legacy = profileTaskStartReceipt({
    schemaVersion: "profile-task-start-receipt:v1",
    includeWorkflowRef: false,
  });
  assertAgainstSchema(legacy, "profile-task-start-receipt");
  assert.equal(
    validateAgainstSchema(legacy, "profile-task-start-receipt-v1", {
      schemaDir,
      cache: sharedCache,
    }).valid,
    true,
  );
  assert.ok(sharedCache.has(path.join(schemaDir, "profile-task-start-receipt.schema.json")));
  assert.ok(sharedCache.has(path.join(schemaDir, "profile-task-start-receipt-v1.schema.json")));

  const mislabeledLegacy = profileTaskStartReceipt({
    schemaVersion: "profile-task-start-receipt:v1",
    includeWorkflowRef: true,
  });
  assert.equal(
    validateAgainstSchema(mislabeledLegacy, "profile-task-start-receipt").valid,
    false,
  );
  assert.equal(
    validateAgainstSchema(mislabeledLegacy, "profile-task-start-receipt-v1").valid,
    false,
  );
});

test("profile schemas reject missing approvals, target ambiguity, and phase-level expansion", () => {
  const requirement = requirementProfile();
  const delivery = deliveryProfile(requirement);

  const unapprovedActiveRequirement = structuredClone(requirement);
  unapprovedActiveRequirement.approval_ref = null;
  assert.equal(
    validateAgainstSchema(unapprovedActiveRequirement, "requirement-execution-profile").valid,
    false,
  );

  const ambiguousTarget = structuredClone(delivery);
  ambiguousTarget.local_release_target = localDeliveryProfile(requirement).local_release_target;
  assert.equal(
    validateAgainstSchema(ambiguousTarget, "delivery-execution-profile").valid,
    false,
  );

  const expandingRequirement = structuredClone(requirement);
  expandingRequirement.autonomy_ceiling = "supervised";
  expandingRequirement.phase_levels = { implementation: "bounded-autonomous" };
  assert.equal(
    validateAgainstSchema(expandingRequirement, "requirement-execution-profile").valid,
    false,
  );

  const expandingDelivery = structuredClone(delivery);
  expandingDelivery.requested_level = "checkpointed";
  expandingDelivery.phase_levels = { validation: "bounded-autonomous" };
  assert.equal(
    validateAgainstSchema(expandingDelivery, "delivery-execution-profile").valid,
    false,
  );
});

test("autonomy schemas accept portable custom phases and reject unsafe phase keys", () => {
  const customPhase = "architecture-check";
  const requirement = requirementProfile({
    phase_levels: { [customPhase]: "checkpointed" },
  });
  const delivery = deliveryProfile(requirement, {
    phase_levels: { [customPhase]: "supervised" },
  });
  const decision = {
    ...validDecision(),
    phase: customPhase,
  };

  assertAgainstSchema(requirement, "requirement-execution-profile");
  assertAgainstSchema(delivery, "delivery-execution-profile");
  assertAgainstSchema(decision, "autonomy-decision");

  const unsafeRequirement = structuredClone(requirement);
  unsafeRequirement.phase_levels = { "../escape": "supervised" };
  assert.equal(
    validateAgainstSchema(unsafeRequirement, "requirement-execution-profile").valid,
    false,
  );
  const unsafeDecision = structuredClone(decision);
  unsafeDecision.phase = "../escape";
  assert.equal(validateAgainstSchema(unsafeDecision, "autonomy-decision").valid, false);
});

test("autonomy decision schema binds status flags and forbids downstream level expansion", () => {
  const decision = validDecision();
  assertAgainstSchema(decision, "autonomy-decision");

  const contradictory = structuredClone(decision);
  contradictory.execution_status = "ready";
  assert.equal(validateAgainstSchema(contradictory, "autonomy-decision").valid, false);

  const missingExactDelivery = structuredClone(decision);
  missingExactDelivery.delivery = null;
  assert.equal(validateAgainstSchema(missingExactDelivery, "autonomy-decision").valid, false);

  const expanding = structuredClone(decision);
  expanding.requested_level = "checkpointed";
  expanding.effective_level = "bounded-autonomous";
  assert.equal(validateAgainstSchema(expanding, "autonomy-decision").valid, false);
});

test("the shipped autonomy configuration is schema-valid and keeps explicit per-delivery selection", () => {
  const config = JSON.parse(fs.readFileSync(
    path.join(process.cwd(), "templates", "sdlc-config.json"),
    "utf8",
  ));
  assertAgainstSchema(config, "sdlc-config");

  assert.deepEqual(config.autonomy_policy.allowed_levels, AUTONOMY_LEVELS);
  assert.deepEqual(config.autonomy_policy.delivery_kinds, ["pull_request", "local_release"]);
  assert.equal(config.autonomy_policy.require_explicit_delivery_selection, true);
  assert.equal(config.autonomy_policy.fail_closed_on_unknown, true);
  assert.equal(config.autonomy_policy.legacy_default, "supervised");
  assert.equal(config.autonomy_policy.local_release.require_smoke_test, true);
  assert.equal(config.autonomy_policy.local_release.require_rollback, true);
});
