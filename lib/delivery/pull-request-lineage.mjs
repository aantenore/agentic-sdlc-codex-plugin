function sortedUnique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

export function buildPullRequestCommitLineage(profile, options = {}) {
  const resolveRequirementLogicalId = options.resolveRequirementLogicalId
    || ((ref) => ref?.id || null);
  return {
    schema_version: "pull-request-commit-lineage:v1",
    delivery_kind: profile?.delivery_kind || null,
    repository: options.repository ?? profile?.pull_request_target?.repository ?? null,
    base_branch: profile?.pull_request_target?.base_branch || null,
    head_branch: profile?.pull_request_target?.head_branch || null,
    story_ids: sortedUnique((profile?.story_refs || []).map((item) => item.id)),
    requirement_logical_ids: sortedUnique(
      (profile?.requirement_profile_refs || []).map(resolveRequirementLogicalId),
    ),
  };
}
