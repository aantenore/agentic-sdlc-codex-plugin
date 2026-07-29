# ST-LOCAL-RUNTIME-HARDENING-R2 Plan

## Objective

Publish the already validated Agentic SDLC 0.13.5 hardening through a
story-scoped pull request, merge it into `origin/main` without force, and
replace the official local Codex installation only after remote CI is green.

## Scope

- In scope:
  - Rematerialize the exact product tree validated at
    `512b5ec543ca3ae248f37d94222419203684a356` as one R2-governed commit
    whose parent is the current `origin/main`.
  - Preserve the R1 validation and four fresh local-project replay evidence.
  - Run remote pull-request CI on every supported operating-system and Node
    runtime cell.
  - Merge normally, record release evidence, install through the official
    local plugin transaction, and prove source/remote/installed parity.
  - Preserve the user's original dirty TravelOps worktree byte for byte.
- Out of scope:
  - New product-code behavior after the frozen 0.13.5 validation.
  - Force-push, cloud or production deployment, secrets, unrelated branches,
    and changes to the user's original worktree.

## Assignment

- Claim: `ST-LOCAL-RUNTIME-HARDENING-R2`
- Agent or owner: `codex`
- Branch: `codex/ST-LOCAL-RUNTIME-HARDENING-R2`
- Dependencies:
  - R1 implementation commit `512b5ec543ca3ae248f37d94222419203684a356`
  - R1 validation record
    `.sdlc/tests/ST-LOCAL-RUNTIME-HARDENING-R1-validation.json`
  - Four successful fresh-project replay repositories and receipts

## Implementation Approach

1. Start from the fetched `origin/main` commit
   `1b53a836134158e6fa852b0330ab125b00e37a2d`.
2. Apply the exact R1 commit without committing, then prove the working product
   tree is identical to R1 outside `.sdlc`.
3. Reuse immutable test and replay evidence only after that identity proof.
4. Create one R2-authorized commit, push the story branch, open a PR, and wait
   for the complete remote matrix.
5. Merge through the approved checkpoint, finalize lifecycle evidence, then
   install and verify the exact final `origin/main` identity.

## Sync And Handoff

- Sync events to record: R2 commit, branch push, PR URL, CI conclusion, merge
  SHA, official-install transaction, installed-only smoke, final gate.
- Handoff target: `origin/main` and the official Codex local plugin cache.
- Handoff artifacts: R2 implementation evidence, identity validation record,
  remote CI receipts, release/install report, lifecycle-complete gate.
- Open items: remote CI, merge, official install, final parity.

## Validation

- `git diff --exit-code 512b5ec... -- . ':(exclude).sdlc'`
- `agentic-sdlc doctor --json`
- Exact SHA-256 binding to the R1 validation record and four runtime TAP logs
- Pull-request CI for Node 18.20.3, 20.12.0, 21.6.0, and 24 on the configured
  operating systems
- Official installer check/plan/apply/verify/validate/confirm transaction
- Installed-only help, doctor, provenance, version, commit, fingerprint, and
  cache/staging byte-parity checks
- Final strict lifecycle-complete gate

## Open Questions

- None.
