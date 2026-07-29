# R2 publication implementation evidence

## What was asked?

Publish and officially install the already validated Agentic SDLC 0.13.5
local-project hardening while preserving the complete governance lineage,
updating `origin/main` without force, and leaving the user's original dirty
TravelOps worktree unchanged.

## Scope and non-goals

This successor story governs publication and installation. It does not alter
the product behavior validated by R1. The product patch is rematerialized on a
fresh story-scoped branch whose parent is the fetched `origin/main`, because
the immutable delivery lineage binds commit authorization to repository, base
branch, head branch, story, and requirement.

Cloud or production deployment, secrets, force-push, unrelated branch
integration, and edits to the user's original worktree remain excluded.

## Inputs

- Base commit:
  `1b53a836134158e6fa852b0330ab125b00e37a2d`
- Validated source commit:
  `512b5ec543ca3ae248f37d94222419203684a356`
- Requirement:
  `REQ-ENTERPRISE-CONTROL-PLANE-001-R4`
- Story:
  `ST-LOCAL-RUNTIME-HARDENING-R2`
- Contract:
  `contract-ST-LOCAL-RUNTIME-HARDENING-R2-implementation`
- Delivery profile:
  `AUT-PR-LOCAL-RUNTIME-HARDENING-R2`
- Validation record:
  `.sdlc/tests/ST-LOCAL-RUNTIME-HARDENING-R1-validation.json`

## What changed?

- Created a fresh worktree from current `origin/main`.
- Applied the exact validated R1 commit with `--no-commit`.
- Copied the append-only post-validation R1 and R2 governance records.
- Started and claimed the R2 story on
  `codex/ST-LOCAL-RUNTIME-HARDENING-R2`.
- Added this R2 publication plan and immutable identity evidence.

No product file differs from the validated R1 tree outside `.sdlc`.

## Why was it decided?

Reusing the already committed R1 SHA on a different story branch would not
satisfy pull-request commit coverage: delivery lineage includes the head branch
and story IDs. A fresh R2-authorized commit preserves identical product bytes
while giving commit, push, PR, CI, and merge one coherent audit chain.

The expensive local suites and project replays are reused only because the
product-tree identity check is empty, doctor reports the same distributed
fingerprint, and the evidence files are bound by SHA-256. Remote PR CI is still
required and is not replaced by the reuse.

## Outputs

- Product version: `0.13.5`
- Product fingerprint:
  `46bb81ecee4daa9909a3b56cf531eb2d1dd74ea5691d6e994f6274c3b12a8f4e`
- R2 identity record:
  `.sdlc/tests/ST-LOCAL-RUNTIME-HARDENING-R2-identity.json`
- R2 plan:
  `.sdlc/stories/ST-LOCAL-RUNTIME-HARDENING-R2/plan.md`

## Verification

- Product-tree comparison against `512b5ec...`, excluding `.sdlc`: passed
  with an empty diff.
- `git diff --check`: passed.
- Source doctor: passed on Node 24.15.0, version 0.13.5, engine policy
  `^18.20.3 || ^20.12.0 || >=21.6.0`, fingerprint
  `46bb81ecee4daa9909a3b56cf531eb2d1dd74ea5691d6e994f6274c3b12a8f4e`.
- R1 validation record SHA-256:
  `06195c9f5e938cae6d14e257a7de08fe6ae722e13208a4ec934ee8b7b83c1ad5`.
- Full-suite TAP SHA-256 values:
  - Node 18.20.3:
    `c6ae1c33526a6852631be9926515394b7b71bea4b8491e6ff5409fdd8568f71b`
  - Node 20.12.0:
    `3e3f279151cde8104e122acb07194253d5bd79447cfab63ed495094e7d5ee0b7`
  - Node 21.6.0:
    `9803b43ca428f8e9d64c8ff46f10ae451102aa89874076b9376899b42ab46042`
  - Node 24.15.0:
    `33fb56a22e11f5640a71beceab5cc777d774540537d4277bc9c24e29f0454a4c`

Remote CI, merge, official installation, installed-only smoke, and final
source/remote/installed parity remain release-phase work.

## Generated explanation

The same code that passed the complete local matrix and four first-user
project replays is now on a clean, story-specific publication path. No feature
or fix was silently added during the branch repair; the repair changes only
the Git/governance lineage needed to make the final push and PR verifiable.

## Lineage

- Requirement: `REQ-ENTERPRISE-CONTROL-PLANE-001-R4`
- Story: `ST-LOCAL-RUNTIME-HARDENING-R2`
- Contract:
  `contract-ST-LOCAL-RUNTIME-HARDENING-R2-implementation`
- Requirement profile:
  `AUT-REQ-ENTERPRISE-CONTROL-PLANE-001-R4-R4`
- Delivery profile: `AUT-PR-LOCAL-RUNTIME-HARDENING-R2`
- Workflow: `WF-ST-LOCAL-RUNTIME-HARDENING-R2`
- Task start:
  `.sdlc/stories/ST-LOCAL-RUNTIME-HARDENING-R2/task-start.json`
