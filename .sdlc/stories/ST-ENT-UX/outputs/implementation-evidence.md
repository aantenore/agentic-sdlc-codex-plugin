# Change delivery evidence

## What was asked?

Make the plugin understandable and safely usable by a person who does not know its internal vocabulary. The main explanation must say, in ordinary English or Italian, what happened, what changes for the person, whether a decision is needed, what remains protected, and what to do next. Technical names, identifiers, paths, commands, hashes, and internal control terms remain available only as optional supporting detail.

The canonical request is [REQ-ENTERPRISE-CONTROL-PLANE-001-R2](../../../requirements/REQ-ENTERPRISE-CONTROL-PLANE-001-R2.json), delivered through story `ST-ENT-UX` and its current [implementation contract](../../../contracts/contract-ST-ENT-UX-implementation-v3.json).

## Delta from the Foundation delivery

The [Foundation implementation evidence](../../ST-ENT-FOUNDATION/outputs/implementation-evidence.md) established configuration safety, canonical query foundations, enterprise fixtures, and initial plain-language guidance. This story adds the complete human-facing product layer without changing those safety or performance boundaries.

Delivered here:

- one reusable English/Italian guidance contract for outcome, impact, decision, protection, and next action;
- human-first explanations for requirements, work briefs, per-delivery choices, protected operations, status, gates, and errors;
- hierarchical help, static shell completion, deterministic presentation presets, stable JSON errors, and compact actionable status;
- a transactional local installer/updater with read-only check and plan, plan-hash-bound apply, locking, staging, recovery, byte verification, rollback, custom destination, and machine-readable output;
- an English/Italian Change Observatory with progressive disclosure and the same five-field explanation contract;
- updated self-service, installation, and Observatory documentation.

Explicit non-goals were adding runtime dependencies or services, accessing production or secrets, changing requirement scope, weakening controls, allowing presets to authorize work, allowing read-only installer modes to recover or mutate state, and hiding technical evidence from reviewers.

## Human-readable behavior

The primary experience now explains the real project, destination, editable area, review moments, and lifetime of one pull request or local release in plain language. It does not ask a person to interpret internal levels or authority records.

Paths from POSIX, Windows drive-letter, and UNC formats, as well as executable command lines, are filtered from primary guidance and preserved in optional technical details. Change Observatory sends approval or correction actions back to the Codex chat and asks for a natural-language answer. English and Italian help localize mandatory and conditional inputs instead of exposing untranslated rule fragments.

The contract draft explicitly remains a proposal until reviewed. Internal freshness work is described as an automatic refresh inside unchanged scope rather than as a new product decision. Every new pull request or local release still receives its own non-reusable choice.

## Self-service CLI

- Root, group, and command help work without opening a project and show practical behavior before technical syntax.
- Requirement and contract help include the real mandatory and conditional inputs plus runnable examples.
- Bash, Zsh, Fish, and PowerShell completion is static and deterministic; it never evaluates generated commands.
- Built-in and file-backed presets are presentation-only. Protected, mutating, authority, target, path, command, and confirmation options are rejected from imported presets; explicit CLI arguments remain authoritative.
- Machine mode returns one stable JSON error envelope, including when `--json=true` or `--json true` is present before a parse failure.

## Transactional local installer

- Running without a mode and running `plan` are read-only.
- `check` and `plan` report an interrupted transaction but do not repair or change it.
- Only `apply` may recover an interrupted transaction, and it then continues only after revalidating the exact current plan hash.
- A live lock is never stolen because it is old; only an owner confirmed dead may be reclaimed.
- Plugin and marketplace bytes are staged, allowlisted, hashed, installed, and verified as one recoverable transaction.
- Optional global RTK configuration remains an explicit separate boundary.
- English and Italian installer help use the same five human fields before optional commands, paths, SHA-256 values, HOME, or RTK details.

## Change Observatory

- Every supported record receives one consistent human projection in summaries, lists, and inspectors.
- English and Italian journeys distinguish proposals, usable choices, revoked or closed work, approvals, corrections, and errors.
- Canonical fields and raw evidence remain available through progressive disclosure without being promoted into the primary explanation.
- Loopback-only binding, host validation, token handling, traversal rejection, symlink checks, read-only HTTP behavior, private-reasoning redaction, and bounded source/model responses remain unchanged.

## Verification

Outcome: passed.

- `npm run check` passed.
- `npm test` passed 523/523, followed by the enforcing enterprise benchmark.
- Focused CLI and human-guidance verification passed 56/56.
- Focused Change Observatory verification passed 64/64.
- Transactional installer verification passed 17/17 Python tests and 1/1 Node integration test.
- An independent read-only audit rechecked seven previously identified human-experience and recovery findings; all seven passed in English and Italian.
- Browser QA of the Italian Observatory journey passed with zero console errors.
- `git diff --check` passed.
- `doctor --json` passed for plugin version 0.11.0.
- `npm pack --dry-run --json` passed with 156 entries, package size 890,266 bytes, unpacked size 3,544,877 bytes, and shasum `fd0179ba525ea7669b0648907cab877139910dcb`.

The final enterprise benchmark used the deterministic 1,000-story, 10,000-record, 5,000-edge, 100,000-trace-event workload. Canonical query time was 576.727 ms against a 2,000 ms limit; warm Observatory p95 was 25.393 ms against a 100 ms limit; maximum RSS was 236,650,496 bytes against a 268,435,456-byte limit.

Machine-readable evidence: [ST-ENT-UX-full-suite.json](../../../tests/ST-ENT-UX-full-suite.json).

## Why this design?

A shared guidance contract prevents wording and safety boundaries from drifting between commands, installer output, and the Observatory. Catalog-driven help and completion make self-service behavior discoverable without duplicating dispatch logic. Presentation-only presets are deliberately separate from execution authority. The installer separates observation from mutation so recovery cannot be triggered accidentally by a diagnostic command.

The implementation keeps the Node.js standard library, preserves Node.js 18.18+ compatibility, adds no mandatory runtime dependency, and retains existing commands and compatible machine-readable fields.

## Generated explanation

For a non-specialist: the plugin now tells you, in ordinary language, what it understood and what it is about to do. It shows the real boundaries of the current pull request or local installation and asks again only at the agreed review moments. If you need the exact IDs, paths, commands, or audit records, they are still available underneath the explanation.

This explanation is an inference generated by Codex from the approved requirement and contract, current project snapshot, implementation, tests, browser review, packaging checks, and independent audit cited here.

## Lineage

- Current immutable project snapshot: `.sdlc/baseline/BASELINE-ENTERPRISE-PLATFORM-003.json`.
- Requirement: `.sdlc/requirements/REQ-ENTERPRISE-CONTROL-PLANE-001-R2.json`.
- Story: `.sdlc/stories/ST-ENT-UX/story.json`.
- Current contract: `.sdlc/contracts/contract-ST-ENT-UX-implementation-v3.json`.
- Capability boundary: `.sdlc/capability-discovery/profiles/CAP-PROFILE-ST-ENT-UX.json` and `.sdlc/capability-discovery/recommendations/CAP-REC-ST-ENT-UX.json`.
- Exact choice for this pull request: `.sdlc/autonomy/deliveries/AUT-PR-ENT-UX-V4.json`.
- Task-start receipts: `.sdlc/autonomy/executions/AUT-PR-ENT-UX-V4/start.json` and `.sdlc/stories/ST-ENT-UX/task-start.json`.
- Trace: `.sdlc/traces/ST-ENT-UX.jsonl`.
- Output registry entry: this document is linked as `implementation-evidence` in delta mode from the Foundation evidence.
