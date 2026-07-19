# ST-ENT-GOVERNANCE Plan

## Objective

Make every local state mutation pass through an explainable, deny-by-default
governance decision, while keeping delivery provider-neutral and preserving all
approved v1 behavior. A person must be able to choose the independence level for
each pull request in plain language without learning internal plugin terms.

## Scope

- In scope:
  - One canonical CLI resolver with explicit action and mutation metadata.
  - Pure RBAC, segregation-of-duties, quorum, and immutable decision receipts.
  - Exact-scope enforcement immediately before every state mutation.
  - Provider SPI with GitHub CLI, generic Git remote, and local filesystem adapters.
  - Versioned delivery profile v2 with explicit provider bindings and unchanged v1 hashes.
  - A mandatory, non-reusable autonomy choice for each pull request.
  - Italian and English plain-language guidance plus golden readability tests.
- Out of scope:
  - Hosted identity, remote policy service, production access, and secret handling.
  - Executing pushes, merges, deployments, or releases from provider adapters.
  - Rewriting approved v1 records or silently changing the 0.11 compatibility snapshot.

## Assignment

- Claim: To be recorded after the implementation contract and delivery profile are approved.
- Agent or owner: Codex, under Antonio's exact enterprise-program delegation.
- Branch: `codex/ST-ENT-GOVERNANCE`.
- Dependencies: approved `REQ-ENTERPRISE-CONTROL-PLANE-001-R2`, merged observability PR #8,
  and approved per-delivery profile `AUT-PR-ENT-GOVERNANCE`.

## Implementation Approach

1. Make the command catalog the single source for CLI resolution, canonical actions,
   mutation classification, parser flags, and handler parity.
2. Add a side-effect-free policy evaluator that defaults to deny and emits stable,
   hash-bound decisions for exact subjects, paths, identities, and evidence.
3. Add a mutation guard at writer and process boundaries, including narrow,
   hash-bound bootstrap recovery cases, and prove denial happens before the first byte.
4. Extract delivery observations into provider adapters; adapters observe and verify
   preconditions/completion but never execute remote mutations.
5. Introduce delivery profile v2 provider bindings while loading v1 records without
   rewriting or changing their approved hashes.
6. Replace internal vocabulary in primary messages with outcome, impact, choice, and
   next action; require a fresh independence choice for every pull request.

Atomic delivery order:

- `refactor(cli): centralize command resolution and mutation metadata`
- `feat(governance): add default-deny policy decisions`
- `feat(governance): enforce exact mutation grants`
- `refactor(delivery): introduce provider-neutral verification SPI`
- `feat(autonomy): bind delivery profiles to explicit providers`
- `feat(ux): ask autonomy in plain language for every pull request`
- focused hardening commits only if validation exposes a distinct defect

## Sync And Handoff

- Sync events to record: contract approval, delivery-profile approval, task start,
  each atomic commit, full validation, push, PR creation, CI result, and merge.
- Handoff target: `main` through one reviewed pull request.
- Handoff artifacts: implementation evidence, compatibility results, security tests,
  provider receipts, readability journeys, CI evidence, and merge verification.
- Open items: None. Antonio selected full autonomy within the agreed limits for this
  exact PR; current local authority can still require recorded checkpoints.

## Validation

- Static checks and catalog-to-handler parity.
- Unit and end-to-end tests on Node 18.18, 20, and 24.
- Negative security tests for deny-before-write, path escape, symlink, TOCTOU,
  unknown actions, quorum identity reuse, crash/retry, and receipt tampering.
- Golden compatibility tests proving v1 profile bytes, hashes, and approvals do not change.
- Provider-contract tests for GitHub, generic Git, and local filesystem behavior.
- Italian and English readability journeys for proposal, approval, restriction, error,
  completion, and next action.
- Full `npm run check`, `npm test`, `npm run doctor`, package dry-run, and CI matrix.
- GitGuardian must be green before merge.

## Open Questions

- None.
