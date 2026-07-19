# Agentic SDLC 0.12 release evidence

## What was agreed

Prepare Agentic SDLC 0.12.0 so its release package can be proved safe before publication, its local installer can recover the exact previous state, and protected delivery operations remain tied to the requirement and contract agreed for this pull request.

The canonical request is [REQ-ENT-RELEASE-R1](../../../requirements/REQ-ENT-RELEASE-R1.json), implemented by story [ST-ENT-RELEASE-R1](../story.json) under the approved [release contract v2](../../../contracts/contract-ST-ENT-RELEASE-R1-implementation-v2.json).

For this pull request, Antonio chose: **complete the agreed work independently, including tests, push and merge, while remaining inside the named repository, branch, files and acceptance criteria**. This choice belongs only to this PR. The local installation has its own separate choice and evidence; neither choice becomes permanent permission for later work.

The runtime records extra checkpoints because this host can audit actions but cannot issue a signed host receipt. In practical terms, that is an additional safety restriction; it does not ask the user to understand or manage internal authority labels.

## Scope and non-goals

Delivered scope:

- deterministic policy-driven validation of the real npm tarball, including paths, file types, permissions, duplicate keys, metadata, size limits and install smoke tests;
- Installer V2 with read-only `check` and `plan`, plan-hash-bound `apply`, `validate`, `confirm`, and exact `restore` from a durable transaction receipt;
- a least-privilege GitHub release workflow that verifies the exact draft assets before publication, derives prerelease status from strict SemVer and can safely retry an interrupted run;
- package, plugin, CLI and documentation alignment on version 0.12.0, with Installer V2 as the normal self-service path;
- focused CLI help aligned with the inputs actually accepted at runtime;
- post-merge receipts that prove exact fast-forward, two-parent merge and squash transitions while rejecting ambiguous history.

Explicit exclusions:

- This PR does not publish to npm, create a Git tag or create a GitHub release.
- It does not install the plugin locally; that is executed only after merge under a separate local-release record.
- Installer V2 does not change global Codex configuration, `AGENTS.md`, or `RTK.md`.
- The legacy installer remains only as an explicit compatibility bridge; it is not the recommended path.
- No production system, credential or secret is used.

## What changed

Package verification and workflow safety:

- `lib/release/`, `scripts/verify-release-package.mjs`, `config/release-artifact-policy.json`, schemas and tests now verify the packed artifact before it can be published.
- `.github/workflows/release.yml` keeps permissions minimal, pins third-party actions by immutable commit, verifies draft ownership and content, and publishes only after the sealed verification step.
- Strict SemVer parsing, exact run ownership and retry recovery close ambiguity in prerelease and interrupted-publication paths.

Reversible local installation:

- `scripts/install-personal-marketplace-v2.py` implements a zero-write planning phase and a receipt-bound transaction whose restore operation preserves the previous bytes.
- Packaging and documentation make Installer V2 canonical while keeping the old installer available only when explicitly requested.

Usability and governed delivery:

- CLI help now shows the mandatory and conditional inputs for story creation and claims, output resolution, contract approval and canonical task start.
- GitHub delivery verification binds the PR base commit and accepts only the exact provable post-merge transitions. Over-advanced, rebased or merge-queue states fail closed when their history cannot be proved.
- When the approved path list had to include `bin`, the original PR profile was revoked and replaced by a newly approved exact profile instead of silently widening it.

## Why this approach

The verifier operates on the artifact created by `npm pack`, not only on source files, because publication safety depends on the archive that users actually install. Archive parsing is bounded and rejects ambiguous or non-portable names before extraction.

Installer planning is separated from mutation so a person or automated workflow can inspect the exact destinations and rollback plan without changing the machine. Applying that plan requires its hash, and every later phase is bound to the same transaction receipt.

Publication stays draft-first and fail-closed. A retry can continue only when the existing draft and assets are proved to belong to the exact workflow run; otherwise the workflow stops.

Autonomy remains requirement- and delivery-specific. A history of successful PRs may inform a new proposal, but it never authorizes a new PR or local release by itself.

## Outputs

- Versioned package and plugin metadata for 0.12.0.
- Policy, verifier, bounded tar reader, workflow guard and release schemas.
- Canonical reversible Installer V2 and updated installation documentation.
- Verified, retry-safe GitHub release workflow.
- Human-readable focused CLI help and exact post-merge receipt handling.
- Machine-readable final test evidence: [ST-ENT-RELEASE-R1-final-95d03b6.json](../../../tests/ST-ENT-RELEASE-R1-final-95d03b6.json).

## Verification

Final result on source commit `95d03b603f6332e6745b643f6f1c95880b00aefc`: passed.

- Complete Node.js 24 suite: 965/965 tests passed.
- Final release verifier, archive, workflow guard and real packed-install subset: 31/31 passed.
- Node.js 18 compatibility: 38/38 release, real-pack and delivery-transition checks passed.
- Node.js 20 compatibility: 38/38 release, real-pack and delivery-transition checks passed.
- Python installer transaction suite: 27/27 passed.
- `npm run check`, doctor, CLI help/version, dry-run packaging and `git diff --check` passed.
- The dry-run package is `agentic-sdlc-codex-plugin@0.12.0`, contains 212 allowlisted entries and includes no lifecycle publication step.
- Enterprise benchmark passed: canonical query 487.118 ms against 2,000 ms; warm Observatory p95 12.273 ms against 100 ms; maximum RSS 224,755,712 bytes against 268,435,456 bytes; resources closed.
- Branch commits use `Antonio Antenore <ant_ant95@hotmail.it>` for both author and committer, with no `reply` or `noreply` identity in this delivery.
- Known private-key, credential-bearing URL, provider-token and other high-risk secret-material patterns were absent from the branch delta.

One earlier all-files run encountered an operating-system worker PID timeout after 960 of 961 tests; the affected test passed in isolation. The definitive full run after the final fix passed 965 of 965, so no behavioral failure remains.

## Generated explanation

Codex-generated inference from the approved requirement, contract, implementation, tests and delivery records: version 0.12.0 is prepared so the exact package can be checked before anyone publishes it, and a local installation can be rolled back to the exact previous bytes if anything fails. The user does not need to interpret internal labels: permission is agreed separately for each PR or local release, and the tool explains the allowed work, protected boundaries and next action in ordinary language.

## Lineage

- Requirement: [REQ-ENT-RELEASE-R1](../../../requirements/REQ-ENT-RELEASE-R1.json).
- Story: [ST-ENT-RELEASE-R1](../story.json).
- Approved contract: [contract-ST-ENT-RELEASE-R1-implementation-v2](../../../contracts/contract-ST-ENT-RELEASE-R1-implementation-v2.json).
- Exact PR autonomy choice: [AUT-PR-ENT-RELEASE-R2](../../../autonomy/deliveries/AUT-PR-ENT-RELEASE-R2.json).
- Local release choice, intentionally separate: [AUT-LOCAL-ENT-RELEASE-R1](../../../autonomy/deliveries/AUT-LOCAL-ENT-RELEASE-R1.json).
- Test evidence: [ST-ENT-RELEASE-R1-final-95d03b6.json](../../../tests/ST-ENT-RELEASE-R1-final-95d03b6.json).
- Story trace: [ST-ENT-RELEASE-R1.jsonl](../../../traces/ST-ENT-RELEASE-R1.jsonl).

The atomic implementation commits are recorded in Git; final push, CI, PR and merge receipts are appended after those protected operations occur.
