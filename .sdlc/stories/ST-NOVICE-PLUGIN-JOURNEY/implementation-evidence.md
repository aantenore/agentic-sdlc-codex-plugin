# Change delivery evidence

## What was asked?

Act as a first-time plugin user, decide whether the requirement-to-delivery
journey is understandable, fix it where it is not, test it, publish it in atomic
commits, and merge the exact PR to `main`. The canonical scope is story
`ST-NOVICE-PLUGIN-JOURNEY`, linked to requirement
`REQ-ENTERPRISE-CONTROL-PLANE-001-R2`.

## Scope and non-goals

Delivered one governed pull request from `codex/ST-NOVICE-PLUGIN-JOURNEY` to
`main`. The allowed paths are `.codex-plugin`, `.sdlc`, `README.md`, `bin`,
`docs`, `lib`, `skills`, and `test`. Installs, secrets, production, external
services, remote deployment, destructive work, and scope expansion remain
excluded.

## Inputs

- Requirement: `.sdlc/requirements/REQ-ENTERPRISE-CONTROL-PLANE-001-R2.json`
- Story: `.sdlc/stories/ST-NOVICE-PLUGIN-JOURNEY/story.json`
- Contract:
  `.sdlc/contracts/contract-ST-NOVICE-PLUGIN-JOURNEY-implementation-v2.json`
- Delivery profile:
  `.sdlc/autonomy/deliveries/AUT-PR-NOVICE-PLUGIN-JOURNEY-002.json`
- Pre-change project snapshot:
  `.sdlc/baseline/BASELINE-ENTERPRISE-PLATFORM-006.json`
- Existing CLI, plugin metadata, skill instructions, documentation, and tests.
- Three independent novice reviews of the CLI journey, documentation, and
  implementation order.

## What changed?

- The CLI no longer requires a contract before requirement intake or story
  decomposition. Decomposition requires a current approved requirement and
  remains planning even if a caller tries to confirm an early task start.
- Fresh status and approval views hide untouched bootstrap phase contracts.
  Task-start approval requests are limited to the active story, phase, contract,
  output template, and capability records.
- Status, baseline responses, and root help expose one practical next step. The
  focused help catalog now includes runtime-required flags, conditions, enums,
  and runnable examples for the governed recovery path.
- Plugin starters and the core skill cover an assessment, a new PR, an existing
  PR, and a local-only result. The public order is requirement, optional
  decomposition, output/work brief, a fresh autonomy choice for this delivery,
  one task start, implementation/test, and the named destination.
- `docs/getting-started.md` explains in ordinary language what Codex does, what
  the deterministic CLI validates, and how local execution, repository
  publication, and deployment differ.
- New black-box tests reproduce a novice journey without internal IDs in the
  conversation layer and prove the deterministic lifecycle handoff.
- Action evidence that changes in a later commit is now verified against the
  exact Git revision bound to its receipt. The gate keeps the historical proof
  and reports the later change instead of incorrectly treating it as tampering.

## Why was it decided?

The previous entry points exposed internal records before the user had agreed a
requirement, and two early routes depended on a contract that could only be
created later. The chosen design keeps language understanding in Codex and keeps
the CLI deterministic: it validates structured facts and refuses invalid order,
but it does not add keyword-based natural-language classification. The
assessment keeps its existing two-checkpoint exception. Compatibility fields and
the published JSON help shape remain unchanged.

## Outputs

- Updated CLI routing, status, approval scoping, and self-service help.
- Updated plugin manifest, agent starter, README, core skill, and documentation
  map.
- New `docs/getting-started.md`.
- New novice metadata and end-to-end requirement journey tests.
- Updated story plan, implementation log, governance records, and this evidence.

## Verification

- `npm run check`: passed.
- Targeted novice and CLI help tests: 26/26 passed.
- Existing routing, task-start, approval, and status regressions: 15/15 passed.
- Full `npm test`: 986/986 passed. An earlier full run had one subprocess
  `ETIMEDOUT`; that exact test passed alone in 1.65 seconds before the clean full
  rerun passed.
- Delivery-autonomy end-to-end regression: 10/10 passed, including verification
  of a changed working-tree file against the exact receipt-bound Git revision.
- `npm run doctor`: all available checks passed.
- `npm pack --dry-run --json`: passed; 213 package entries.
- Real package verification: archive structure, allowlist, metadata consistency,
  npm install, CLI help, doctor, both installer plans, and zero-write checks
  passed.
- Changed-file secret review: 47 files scanned; no known access-token, bearer,
  basic-auth, JWT, URL-userinfo, private-key, or credential-value pattern was
  found. Generic high-entropy candidates were classified as canonical hashes,
  record IDs, paths, or prose rather than credentials.
- Strict story gate: passed after this approved evidence was linked. A later
  documentation commit is verified from its exact earlier Git revision; the
  remaining findings are non-blocking historical or pre-change warnings.
- Remote CI and post-merge `main` verification are completed during the governed
  publication steps and reported with the final delivery.

## Generated explanation

The plugin now starts from the result a person wants instead of asking them to
understand its internal records. It agrees what “done” means, splits the work
only when useful, shows the actual files and checks, asks how independently to
work for that one delivery, and starts implementation once. A local result, a
repository PR, and a production deployment are presented as different
boundaries.

This explanation is generated from the approved requirement, story, work brief,
delivery profile, implemented files, and verification results listed in this
document. No private reasoning trace is included.

## Lineage

- Requirement: `REQ-ENTERPRISE-CONTROL-PLANE-001-R2`
- Story: `ST-NOVICE-PLUGIN-JOURNEY`
- Contract: `contract-ST-NOVICE-PLUGIN-JOURNEY-implementation-v2`
- Delivery: `AUT-PR-NOVICE-PLUGIN-JOURNEY-002`
- Capability profile: `CAP-PROFILE-ST-NOVICE-PLUGIN-JOURNEY`
- Capability recommendation: `CAP-REC-ST-NOVICE-PLUGIN-JOURNEY`
- Trace: `.sdlc/traces/ST-NOVICE-PLUGIN-JOURNEY.jsonl`
- Output template: `implementation-evidence-v1`, mode `delta`
- Commits, PR URL, action receipts, CI checks, and merge SHA are bound during
  the publication lifecycle.
