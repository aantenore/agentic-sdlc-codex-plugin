# ST-ENT-OBSERVABILITY Plan

## Objective

Deliver privacy-safe, tamper-evident operational observability for both the CLI and Change Observatory without changing the existing governed lifecycle semantics.

## Scope

- In scope:
  - Seal all newly written general trace events into a crash-safe hash chain and verify modification, deletion, reordering, duplication, and truncation at the strict gate.
  - Preserve legacy trace bytes through an explicit prefix anchor; never rewrite historical events in place.
  - Redact provider credentials, sensitive keys, URL credentials, private keys, and configured PII before persistence and again before presentation.
  - Preserve legitimate governance identifiers such as Git SHA values, UUIDs, correlation IDs, and `AUT-ACT-*` receipts; entropy alone is not a secret decision.
  - Generate one bounded correlation ID per CLI or HTTP operation and return stable, redacted structured errors for expected and unexpected failures.
  - Add bounded in-memory metrics, liveness, readiness, SLI/SLO evaluation, and a redacted support bundle with a reproducible content-integrity digest.
  - Complete the existing Observatory ETag/single-flight design in the UI client while retaining `Cache-Control: no-store` and read-only project behavior.
  - Close source/static read TOCTOU windows with handle-bound bounded reads and fail-closed identity revalidation.
  - Keep all user-facing guidance human-first in English and Italian, with internal IDs only in optional technical details.
- Out of scope:
  - External telemetry export, production deployment, secret access, or any global installation.
  - Claiming that local hashes authenticate origin or are tamper-proof against an attacker who can rewrite both data and checkpoints; strong authenticity requires a trusted host signature or external anchor.
  - Replacing the existing workflow-instance chain, the six lifecycle phases, or the assessment two-checkpoint journey.

## Assignment

- Claim: story-scoped implementation claim after the exact contract and delivery profile are approved.
- Agent or owner: Codex.
- Branch: `codex/ST-ENT-OBSERVABILITY`.
- Dependencies: approved `REQ-ENTERPRISE-CONTROL-PLANE-001-R2`, current `main`, Node.js standard library, existing Agentic SDLC and test-runner capabilities.

## Implementation Approach

1. Introduce small standard-library modules for privacy redaction, operation context/errors, metrics/SLO/support bundles, and trace integrity.
2. Integrate correlation, redaction-before-write, trace sealing, evidence drift checks, and catch-all error normalization into the CLI and strict gate.
3. Extend Observatory with redacted model/source projection, liveness/readiness/metrics/SLO/support endpoints, stable error envelopes, and bounded handle-based reads.
4. Add an in-memory UI ETag cache that reuses a validated model on `304` and fails closed when no validated cached body exists.
5. Document the operational model and add negative, concurrency, crash-recovery, compatibility, no-mutation, and enterprise-scale tests.

## Sync And Handoff

- Sync events to record: governed commits, release-candidate push, pull-request creation/update, CI/security result, and protected merge.
- Handoff target: `main` after all required checks pass.
- Handoff artifacts: implementation log, test evidence, strict-gate report, support-bundle examples, PR/merge evidence, and immutable action receipts.
- Open items: none; external exporters remain deliberately disabled and outside this delivery.

## Validation

- Unit tests for redaction idempotence/fail-closed limits, trace tamper/crash/concurrency cases, correlation/error normalization, metrics/SLO boundaries, support bundle integrity, and legitimate high-entropy identifiers.
- Observatory tests for secret/PII presentation, ETag `200 -> 304`, readiness recovery, single-flight concurrency, authenticated operational endpoints, TOCTOU swaps, and zero project mutation.
- CLI regression tests for JSON catch-all errors, human guidance, correlation propagation, strict-gate trace failures, help/completion, and EN/IT output.
- `npm run check`, full `npm test`, enterprise benchmark, doctor, package dry run, strict story gate, and package-content verification.

## Open Questions

- None.
