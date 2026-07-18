import { immutableJson, isPlainRecord, requireNonEmptyString } from "../canonical.mjs";
import { DeliveryProviderError } from "./provider-registry.mjs";

export const LEGACY_DELIVERY_PROVIDER_MAPPING_VERSION = "delivery-provider-compatibility:v1";

const LEGACY_PROVIDER_ALIASES = Object.freeze({
  git: "git-remote",
  "git-remote": "git-remote",
  github: "github-cli",
  "github-cli": "github-cli",
  local: "local-filesystem",
  filesystem: "local-filesystem",
  "local-filesystem": "local-filesystem",
});

const LEGACY_ACTION_BINDINGS = Object.freeze({
  "git.push": "git-remote",
  "pull_request.create": "github-cli",
  "pull_request.update": "github-cli",
  "pull_request.merge": "github-cli",
  "release.local": "local-filesystem",
});

/**
 * Maps historical v1 behavior in memory. It never mutates or rewrites the
 * approved profile: callers can attach these bindings to a runtime view while
 * preserving the original bytes and profile hash.
 */
export function legacyProviderBindingsForProfile(profile) {
  if (!isPlainRecord(profile)) {
    throw new DeliveryProviderError("Legacy delivery profile must be an object", "provider_binding_invalid");
  }
  const kind = requireNonEmptyString(profile.delivery_kind, "delivery_profile.delivery_kind");
  if (kind === "pull_request") {
    const repository = requireNonEmptyString(
      profile.pull_request_target?.repository,
      "delivery_profile.pull_request_target.repository",
    );
    const github = isGitHubRepository(repository);
    return immutableJson({
      schema_version: LEGACY_DELIVERY_PROVIDER_MAPPING_VERSION,
      source_schema_version: profile.schema_version || "delivery-execution-profile:v1",
      source_profile_hash: profile.profile_hash || null,
      derived_only: true,
      bindings: {
        remote_ref: {
          provider_id: "git-remote",
          actions: ["git.push"],
        },
        pull_request: {
          provider_id: github ? "github-cli" : "git-remote",
          actions: ["pull_request.create", "pull_request.merge", "pull_request.update"],
          compatibility: github ? "backward-compatible" : "unsupported-fail-closed",
        },
      },
    });
  }
  if (kind === "local_release") {
    requireNonEmptyString(
      profile.local_release_target?.root_path,
      "delivery_profile.local_release_target.root_path",
    );
    return immutableJson({
      schema_version: LEGACY_DELIVERY_PROVIDER_MAPPING_VERSION,
      source_schema_version: profile.schema_version || "delivery-execution-profile:v1",
      source_profile_hash: profile.profile_hash || null,
      derived_only: true,
      bindings: {
        local_release: {
          provider_id: "local-filesystem",
          actions: ["release.local"],
        },
      },
    });
  }
  throw new DeliveryProviderError(
    `Unsupported legacy delivery kind '${kind}'`,
    "provider_binding_invalid",
    { delivery_kind: kind },
  );
}

export function legacyProviderForAction(profile, action) {
  const normalizedAction = requireNonEmptyString(action, "delivery_action").toLowerCase();
  const derived = legacyProviderBindingsForProfile(profile);
  const binding = Object.values(derived.bindings).find((candidate) => candidate.actions.includes(normalizedAction));
  if (!binding) return null;
  return immutableJson({
    provider_id: binding.provider_id,
    action: normalizedAction,
    compatibility: binding.compatibility || "backward-compatible",
    derived_only: true,
  });
}

export function normalizeLegacyProviderId(providerId) {
  const value = requireNonEmptyString(providerId, "provider_id").toLowerCase();
  const normalized = LEGACY_PROVIDER_ALIASES[value];
  if (!normalized) {
    throw new DeliveryProviderError(
      `Unknown legacy provider id '${providerId}'`,
      "provider_unknown",
      { provider_id: value },
    );
  }
  return normalized;
}

export function defaultLegacyProviderForAction(action) {
  const normalizedAction = requireNonEmptyString(action, "delivery_action").toLowerCase();
  return LEGACY_ACTION_BINDINGS[normalizedAction] || null;
}

function isGitHubRepository(repository) {
  const value = repository.toLowerCase().replace(/^https?:\/\//u, "").replace(/\.git$/u, "");
  return value.startsWith("github.com/") || /^[^/]+\/[^/]+$/u.test(value);
}
