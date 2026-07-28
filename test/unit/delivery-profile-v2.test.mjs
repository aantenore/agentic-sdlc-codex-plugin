import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDeliveryExecutionProfile,
  buildDeliveryExecutionProfileV2,
  computeDeliveryExecutionProfileHash,
  validateDeliveryExecutionProfileIntegrity,
} from "../../lib/autonomy-policy.mjs";
import { computeStableHash } from "../../lib/canonical.mjs";
import { providerBindingForAction } from "../../lib/delivery/provider-compatibility.mjs";
import { createDefaultDeliveryProviderRegistry } from "../../lib/delivery/default-providers.mjs";
import { DeliveryProviderError } from "../../lib/delivery/provider-registry.mjs";
import { assertAgainstSchema, validateAgainstSchema } from "../../lib/json-schema-validator.mjs";

const HASH = Object.freeze({
  approval: "a".repeat(64),
  requirement: "b".repeat(64),
  story: "c".repeat(64),
  contract: "d".repeat(64),
});
const NOW = "2026-07-18T10:00:00.000Z";

function ref(id, hash) {
  return { id, path: `.sdlc/${id}.json`, hash };
}

function sharedInput(overrides = {}) {
  return {
    id: "AUT-PR-V2-GOLDEN",
    status: "active",
    delivery_id: "PR-V2-GOLDEN",
    delivery_kind: "pull_request",
    requirement_profile_refs: [ref("AUT-REQ-GOLDEN", HASH.requirement)],
    story_refs: [ref("ST-GOLDEN", HASH.story)],
    contract_refs: [ref("CONTRACT-GOLDEN", HASH.contract)],
    material_scope: { objective: "Verify explicit provider bindings", release_target: "pull_request" },
    requested_level: "checkpointed",
    phase_levels: { release: "supervised" },
    constraints: {
      allowed_tools: ["exec_command"],
      allowed_capabilities: ["git.push"],
      allowed_environments: ["pull_request"],
      allowed_write_paths: ["lib/"],
      forbidden_actions: ["production.deploy"],
      budget_ref: null,
    },
    pull_request_target: {
      repository: "aantenore/agentic-sdlc-codex-plugin",
      base_branch: "main",
      head_branch: "codex/provider-v2",
      allowed_actions: ["git.push", "pull_request.create", "pull_request.update"],
      merge_allowed: false,
    },
    authority_assurance: { mode: "audit_only" },
    approval_ref: ref("APPROVAL-GOLDEN", HASH.approval),
    created_at: NOW,
    valid_from: NOW,
    ...overrides,
  };
}

function pullRequestBindings(overrides = {}) {
  return [
    { action: "git.push", provider_id: overrides.git || "git-remote" },
    { action: "pull_request.create", provider_id: overrides.pr || "github-cli" },
    { action: "pull_request.merge", provider_id: overrides.pr || "github-cli" },
    { action: "pull_request.update", provider_id: overrides.pr || "github-cli" },
  ];
}

function existingPullRequestBindings(overrides = {}) {
  return [
    { action: "git.push", provider_id: overrides.git || "git-remote" },
    { action: "pull_request.merge", provider_id: overrides.pr || "github-cli" },
    { action: "pull_request.update", provider_id: overrides.pr || "github-cli" },
  ];
}

test("v1 profile hash remains a fixed compatibility golden", () => {
  const profile = buildDeliveryExecutionProfile(sharedInput());
  assert.equal(profile.schema_version, "delivery-execution-profile:v1");
  assert.equal(profile.profile_hash, "472ada85ed307c088d186f5ca993b4410c599e4ab51ba19a9afcb434b6896b72");
  assert.equal(validateDeliveryExecutionProfileIntegrity(profile).valid, true);
  assertAgainstSchema(profile, "delivery-execution-profile");
});

test("v2 PR profiles round-trip with exact, independently hash-bound provider bindings", () => {
  const profile = buildDeliveryExecutionProfileV2({
    ...sharedInput(),
    schema_version: "delivery-execution-profile:v2",
    provider_bindings: pullRequestBindings(),
  });
  assert.equal(profile.schema_version, "delivery-execution-profile:v2");
  assert.equal(profile.version, 2);
  assert.equal(profile.provider_bindings_hash, computeStableHash(profile.provider_bindings));
  assert.deepEqual(buildDeliveryExecutionProfileV2(profile), profile);
  assert.equal(validateDeliveryExecutionProfileIntegrity(profile).valid, true);
  assertAgainstSchema(profile, "delivery-execution-profile-v2");

  const tampered = structuredClone(profile);
  tampered.provider_bindings[0].provider_id = "other-git";
  tampered.profile_hash = computeDeliveryExecutionProfileHash(tampered);
  assert.equal(validateDeliveryExecutionProfileIntegrity(tampered).valid, false);

  const reordered = structuredClone(profile);
  [reordered.provider_bindings[0], reordered.provider_bindings[1]] = [
    reordered.provider_bindings[1],
    reordered.provider_bindings[0],
  ];
  assert.equal(validateAgainstSchema(reordered, "delivery-execution-profile-v2").valid, false);
});

test("v2 existing PR profiles pin number, URL, and reviewed head without a create action", () => {
  const reviewedHeadSha = "1".repeat(40);
  const input = {
    ...sharedInput({
      delivery_id: "PR-184",
      pull_request_target: {
        repository: "aantenore/agentic-sdlc-codex-plugin",
        base_branch: "main",
        head_branch: "codex/provider-v2",
        mode: "existing",
        pr_number: 184,
        pr_url: "https://github.com/aantenore/agentic-sdlc-codex-plugin/pull/184",
        reviewed_head_sha: reviewedHeadSha,
        allowed_actions: ["git.push", "pull_request.update"],
        merge_allowed: false,
      },
    }),
    provider_bindings: existingPullRequestBindings(),
  };
  const profile = buildDeliveryExecutionProfileV2(input);
  assert.equal(profile.pull_request_target.mode, "existing");
  assert.equal(profile.pull_request_target.pr_number, 184);
  assert.equal(profile.pull_request_target.reviewed_head_sha, reviewedHeadSha);
  assert.equal(profile.pull_request_target.allowed_actions.includes("pull_request.create"), false);
  assert.equal(profile.provider_bindings.some((binding) => binding.action === "pull_request.create"), false);
  assert.deepEqual(buildDeliveryExecutionProfileV2(profile), profile);
  assert.equal(validateDeliveryExecutionProfileIntegrity(profile).valid, true);
  assertAgainstSchema(profile, "delivery-execution-profile-v2");

  assert.throws(() => buildDeliveryExecutionProfileV2({
    ...input,
    pull_request_target: {
      ...input.pull_request_target,
      pr_url: "https://github.com/aantenore/agentic-sdlc-codex-plugin/pull/185",
    },
  }), /must identify the exact approved PR number/u);
  assert.throws(() => buildDeliveryExecutionProfileV2({
    ...input,
    pull_request_target: {
      ...input.pull_request_target,
      allowed_actions: [...input.pull_request_target.allowed_actions, "pull_request.create"],
    },
  }), /cannot include pull_request\.create/u);
});

test("v2 local releases bind only release.local to a filesystem observer", () => {
  const profile = buildDeliveryExecutionProfileV2({
    ...sharedInput({
      id: "AUT-LOCAL-V2",
      delivery_id: "LOCAL-V2",
      delivery_kind: "local_release",
      pull_request_target: null,
      local_release_target: {
        environment: "local",
        root_path: "/workspace/travelops",
        allowed_write_paths: ["/workspace/travelops/dist"],
        allowed_actions: ["build.local", "release.local", "test.run"],
        smoke_tests: ['["node","--version"]'],
        rollback: { required: true, procedure: "Restore the previous package" },
        external_access_allowed: false,
        production_access_allowed: false,
        destructive_actions_allowed: false,
      },
    }),
    provider_bindings: [{ action: "release.local", provider_id: "local-filesystem" }],
  });
  assert.deepEqual(profile.provider_bindings, [
    { action: "release.local", provider_id: "local-filesystem" },
  ]);
  assert.equal(profile.local_release_target.smoke_cwd, undefined);
  assert.deepEqual(buildDeliveryExecutionProfileV2(profile), profile);
  assertAgainstSchema(profile, "delivery-execution-profile-v2");
});

test("local release smoke working directories stay inside an allowed write path", () => {
  const base = {
    ...sharedInput({
      id: "AUT-LOCAL-SMOKE-CWD",
      delivery_id: "LOCAL-SMOKE-CWD",
      delivery_kind: "local_release",
      pull_request_target: null,
      local_release_target: {
        environment: "local",
        root_path: "/workspace/travelops/release",
        allowed_write_paths: ["/workspace/travelops/release/app"],
        allowed_actions: ["build.local", "release.local", "test.run"],
        smoke_tests: ['["npm","run","smoke:local"]'],
        smoke_cwd: "/workspace/travelops/release/app/package",
        rollback: { required: true, procedure: "Restore the previous package" },
        external_access_allowed: false,
        production_access_allowed: false,
        destructive_actions_allowed: false,
      },
    }),
    provider_bindings: [{ action: "release.local", provider_id: "local-filesystem" }],
  };
  const profile = buildDeliveryExecutionProfileV2(base);
  assert.equal(
    profile.local_release_target.smoke_cwd,
    "/workspace/travelops/release/app/package",
  );
  assert.deepEqual(buildDeliveryExecutionProfileV2(profile), profile);
  assertAgainstSchema(profile, "delivery-execution-profile-v2");

  assert.throws(() => buildDeliveryExecutionProfileV2({
    ...base,
    local_release_target: {
      ...base.local_release_target,
      smoke_cwd: "/workspace/travelops/release/other",
    },
  }), /smoke_cwd must be equal to or inside one allowed_write_path/u);
});

test("v2 has no implicit provider fallback and unsupported bindings fail closed", () => {
  const explicit = buildDeliveryExecutionProfileV2({
    ...sharedInput(),
    provider_bindings: pullRequestBindings({ git: "missing-provider" }),
  });
  assert.deepEqual(providerBindingForAction(explicit, "git.push"), {
    provider_id: "missing-provider",
    action: "git.push",
    compatibility: "explicit-v2",
    derived_only: false,
  });
  assert.equal(providerBindingForAction(explicit, "repository.write"), null);
  const registry = createDefaultDeliveryProviderRegistry();
  assert.equal(registry.supports("github-cli", "git.push", "precondition"), false);
  assert.equal(registry.supports("git-remote", "pull_request.merge", "completion"), false);
  assert.throws(() => registry.supports("missing-provider", "git.push", "precondition"), (error) => {
    assert.equal(error instanceof DeliveryProviderError, true);
    assert.equal(error.code, "provider_unknown");
    return true;
  });
});
