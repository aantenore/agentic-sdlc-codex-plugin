import test from "node:test";
import assert from "node:assert/strict";

import { buildPullRequestCommitLineage } from "../../lib/delivery/pull-request-lineage.mjs";

function profile(requirementProfileId, overrides = {}) {
  return {
    delivery_kind: "pull_request",
    story_refs: [{ id: "ST-1" }],
    requirement_profile_refs: [{ id: requirementProfileId }],
    pull_request_target: {
      repository: "github.com/example/project",
      base_branch: "main",
      head_branch: "codex/ST-1",
    },
    ...overrides,
  };
}

test("commit lineage survives an approved requirement revision in the same logical family", () => {
  const logicalIds = new Map([
    ["AUT-REQ-1", "REQ-LOGICAL"],
    ["AUT-REQ-1-R2", "REQ-LOGICAL"],
  ]);
  const options = {
    resolveRequirementLogicalId: (ref) => logicalIds.get(ref.id),
  };

  assert.deepEqual(
    buildPullRequestCommitLineage(profile("AUT-REQ-1"), options),
    buildPullRequestCommitLineage(profile("AUT-REQ-1-R2"), options),
  );
});

test("commit lineage remains isolated across logical requirements and pull-request targets", () => {
  const options = {
    resolveRequirementLogicalId: (ref) => ref.id,
  };
  const baseline = buildPullRequestCommitLineage(profile("REQ-A"), options);

  assert.notDeepEqual(baseline, buildPullRequestCommitLineage(profile("REQ-B"), options));
  assert.notDeepEqual(baseline, buildPullRequestCommitLineage(profile("REQ-A", {
    story_refs: [{ id: "ST-2" }],
  }), options));
  assert.notDeepEqual(baseline, buildPullRequestCommitLineage(profile("REQ-A", {
    pull_request_target: {
      repository: "github.com/example/project",
      base_branch: "main",
      head_branch: "codex/ST-2",
    },
  }), options));
});
