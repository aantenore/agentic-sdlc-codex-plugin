# ST-ENT-WORKFLOWS Plan

## Objective

Deliver a reusable, versioned workflow engine with four governed presets, safe overlays, pinned event-sourced instances, and a human-readable CLI while preserving existing SDLC and assessment behavior.

## Scope

- In scope: workflow definitions, presets, allowlisted guards, governed overlays, append-only instance events, CLI commands, schemas, tests, documentation, and assessment compatibility evidence.
- Out of scope: arbitrary executable workflow code, production or external access, changing the six configured SDLC phases, replacing assessment v1 records, or reusing one delivery choice for another PR or local release.

## Assignment

- Claim: active for `ST-ENT-WORKFLOWS`.
- Agent or owner: Codex, with isolated domain and CLI subagents.
- Branch: `codex/ST-ENT-WORKFLOWS`.
- Dependencies: `ST-ENT-FOUNDATION` complete; approved project context, contract, capability choice, and per-PR profile recorded before implementation.

## Implementation Approach

1. Add deterministic workflow-domain primitives, schemas, presets, guards, overlay restrictions, instance pinning, and hash-chained replay.
2. Add storage-backed, human-readable CLI commands with stable JSON, help, and completion.
3. Prove compatibility for the six SDLC phases and assessment's two normal checkpoints.
4. Add documentation, strict-gate evidence, full regression validation, package verification, and PR delivery receipts.

## Sync And Handoff

- Sync events to record: contract/profile/start, atomic commits, focused/full tests, strict gate, push, PR, CI, and merge.
- Handoff target: `main` through the exact governed pull request.
- Handoff artifacts: implementation evidence, test receipts, action receipts, and updated project documentation.
- Open items: none; scope is fixed by the approved contract.

## Validation

- Focused domain and CLI tests.
- Existing assessment golden tests and six-phase initialization regression.
- `npm run check`, full `npm test`, `doctor`, package dry run, and strict story gate.
- Independent review for security, compatibility, and human readability.

## Open Questions

- None.
