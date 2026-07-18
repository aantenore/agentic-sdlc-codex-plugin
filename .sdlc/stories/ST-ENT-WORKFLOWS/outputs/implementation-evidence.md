# Configurable workflow delivery evidence

## What was asked?

Make the process fit the requirement instead of forcing every request through one fixed software lifecycle. While a requirement is being agreed, the user can choose or refine its sequence of steps and checks. The autonomy for implementation remains a separate choice for each pull request or local release and is never inherited from an earlier delivery.

The user-facing explanation must be understandable without knowing plugin vocabulary. It therefore says first what happened, what changes in practice, whether the person must decide anything, what remains protected, and what to do next. Stored labels such as `bounded-autonomous`, `checkpointed`, `audit_only`, record IDs, paths, and hashes remain optional technical detail.

The canonical request is `REQ-ENTERPRISE-CONTROL-PLANE-001-R2`, delivered through `ST-ENT-WORKFLOWS` and contract `contract-ST-ENT-WORKFLOWS-implementation-v2`.

## Delta from the Foundation delivery

This story adds a reusable process layer without weakening the existing contract, capability, budget, approval, or delivery controls.

Delivered here:

- four included processes for a software project, a bounded change, a technical assessment, and a generic governed activity;
- versioned, content-bound definitions with stable states, transitions, phase order, and normal checkpoints;
- project-specific adjustments that can change explanations, labels, metadata, and parameters for already permitted checks, but cannot change process structure or history;
- immutable run headers that retain the exact selected definition and adjustment even when newer versions are created;
- append-only transition events with sequence, preceding-event hash, event hash, actor, timestamp, and retry-safe request ID;
- declarative guard names from an explicit allowlist, with no evaluation, dynamic import, module loading, or shell execution from workflow data;
- a complete English/Italian CLI for listing, showing, proposing, approving, explaining, starting, transitioning, and inspecting processes;
- JSON Schemas, compatibility contracts, product documentation, and package coverage.

Explicit non-goals were granting execution authority through a workflow, changing an active run after start, replacing existing assessment v1 records, changing the established six software phases, accepting arbitrary executable guards, or reusing one autonomy choice for another pull request or local release.

## How it works for a person

1. Choose an included way of working or propose a project-specific one.
2. Review and confirm its steps and checks. A proposal stays inactive until confirmed.
3. Start one tracked run. It keeps its exact selected version for its entire lifetime.
4. Move only to a permitted next step. Repeating the same request is safe and does not duplicate history.
5. Choose autonomy separately when the work will produce a pull request or local release.

In ordinary language, the process answers “which step comes next?” The delivery choice answers “how independently may the agent execute this one PR or local release?” Starting or approving a process does not authorize writes, tools, external access, commits, pushes, merges, releases, deployment, production, or secrets.

## Compatibility

The software-project preset preserves exactly:

`discovery → analysis → design → implementation → validation → release`

The technical-assessment preset preserves the existing `assessment-workflow:v1` state graph and exactly two normal user decisions: confirm the project context and confirm the complete proposal. Existing assessment commands, JSON fields, schemas, and stored records remain unchanged.

The frozen `sdlc-config:v1` compatibility snapshot for version 0.11.0 retains its exact canonical hash.

## Integrity and safety

- Definition, adjustment, effective configuration, instance, and event hashes use canonical stable JSON.
- Approval changes lifecycle status and evidence without changing the approved material-content hash.
- An adjustment is bound to one exact definition ID, version, and hash.
- Starting a run requires an approved adjustment; an unapproved adjustment can only be previewed.
- The instance stores exact definition, optional adjustment, and effective hashes.
- Replay verifies instance binding, sequence, previous hashes, event hashes, timestamps, routes, and retry IDs before calculating status.
- A supplied checkpoint detects a deleted tail as well as added uncheckpointed events.
- Transition facts are stored as a content hash rather than persisting the raw guard input.
- Project files store data only; they cannot add executable guard code.

## Verification

Outcome: passed.

- `npm run check` passed, including the workflow engine and preset modules.
- `npm test` passed 547/547 tests, followed by the enforcing enterprise benchmark.
- Focused tests covered the domain, presets, schemas, CLI journey, included-preset start, overlay preview/approval, idempotent retry, and legacy compatibility.
- Published workflow records conform to all six new JSON Schemas; structural additions are rejected.
- `git diff --check` passed.
- `npm run doctor` passed for plugin version 0.11.0.
- `npm pack --dry-run --json` passed with 165 entries, package size 915,898 bytes, unpacked size 3,669,628 bytes, and shasum `4e1085a5a5a41649a525f346b17f5b9ba8de43ac`.

The deterministic enterprise fixture contained 1,000 stories, 10,000 records, 5,000 dependency edges, and 100,000 trace events. Canonical query time was 567.594 ms against a 2,000 ms limit; warm Observatory p95 was 24.887 ms against a 100 ms limit; maximum RSS was 228,163,584 bytes against a 268,435,456-byte limit.

Machine-readable evidence: [ST-ENT-WORKFLOWS-full-suite.json](../../../tests/ST-ENT-WORKFLOWS-full-suite.json).

## Why this design?

Definitions, project adjustments, and running instances are separate so teams can reuse a process without hardcoding project names or silently altering work already underway. The event stream makes progress reconstructable and tamper-evident. Declarative allowlisted guards keep the extension point configurable without turning project data into executable code.

The autonomy model remains orthogonal on purpose. A requirement may set the maximum independence that future delivery can request, but every actual pull request or local release still asks for its own exact, non-reusable choice and its own protected-action evidence.

## Generated explanation

For a non-specialist: the plugin now lets you agree the steps for this kind of work, then separately decide how much freedom to give the agent for one concrete delivery. A later process update cannot change work that has already started. The technical IDs and hash records are available for audit, but you do not need to understand them to make the decision.

This explanation is an inference generated by Codex from the approved requirement and contract, current project snapshot, implementation, tests, package inspection, and compatibility evidence cited here.

## Lineage

- Current immutable project snapshot: `.sdlc/baseline/BASELINE-ENTERPRISE-PLATFORM-004.json`.
- Requirement: `.sdlc/requirements/REQ-ENTERPRISE-CONTROL-PLANE-001-R2.json`.
- Story: `.sdlc/stories/ST-ENT-WORKFLOWS/story.json`.
- Contract: `.sdlc/contracts/contract-ST-ENT-WORKFLOWS-implementation-v2.json`.
- Exact choice for this pull request: `.sdlc/autonomy/deliveries/AUT-PR-ENT-WORKFLOWS-V2.json`.
- Task-start receipts: `.sdlc/autonomy/executions/AUT-PR-ENT-WORKFLOWS-V2/start.json` and `.sdlc/stories/ST-ENT-WORKFLOWS/task-start.json`.
- Trace: `.sdlc/traces/ST-ENT-WORKFLOWS.jsonl`.
