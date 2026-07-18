# Privacy-safe operational observability delivery evidence

## What was asked?

Extend the approved enterprise control-plane requirement with operational visibility that can be trusted during local development and support: tamper-evident traces, privacy protection before storage and presentation, correlated failures, bounded health and service-level signals, and a verifiable support bundle. Preserve the existing lifecycle, workflow, autonomy, assessment, Change Observatory, and cross-platform behavior.

The canonical request is `REQ-ENTERPRISE-CONTROL-PLANE-001-R2`, delivered through `ST-ENT-OBSERVABILITY` and `contract-ST-ENT-OBSERVABILITY-implementation`.

## Scope and non-goals

This delivery is a delta from the approved enterprise Foundation evidence. It adds local, bounded observability and hardens the evidence boundaries used by the current CLI and Change Observatory.

Delivered here:

- crash-safe hash chaining and verification for newly written general trace events while preserving the exact legacy prefix;
- evidence fingerprints, a small validated manifest for large evidence, and fail-closed detection of modification, deletion, reordering, duplication, truncation, replacement, and evidence drift;
- shared redaction for known provider credentials, credential assignments, URL user information, private keys, cookies, sensitive keys, and configured PII before persistence and again before presentation;
- explicit preservation of legitimate Git SHA values, UUIDs, correlation IDs, and governed action identifiers because entropy alone is not evidence of a secret;
- one correlation ID and stable privacy-safe error envelope per CLI or HTTP operation;
- bounded local metrics, liveness, readiness, SLI/SLO evaluation, and a redacted support bundle with a reproducible content-integrity digest;
- authenticated loopback Observatory operations, bounded source streaming, ETag reuse, single-flight caching, and stable memory under the enterprise fixture;
- English and Italian outcome-first guidance that keeps internal record vocabulary in optional technical details.

Explicit non-goals are external telemetry export, hosted monitoring, production access, secret retrieval, deployment, a new mandatory dependency, rewriting historical trace bytes, provider-signed authenticity claims, or any change to the agreed six phases and two-checkpoint assessment journey.

## Inputs

- Requirement: `.sdlc/requirements/REQ-ENTERPRISE-CONTROL-PLANE-001-R2.json`.
- Story and plan: `.sdlc/stories/ST-ENT-OBSERVABILITY/story.json` and `.sdlc/stories/ST-ENT-OBSERVABILITY/plan.md`.
- Approved work brief: `.sdlc/contracts/contract-ST-ENT-OBSERVABILITY-implementation.json`.
- Delivery boundary: `.sdlc/autonomy/deliveries/AUT-PR-ENT-OBSERVABILITY.json`.
- Capability boundary: `.sdlc/capability-discovery/profiles/CAP-PROFILE-ST-ENT-OBSERVABILITY.json` and `.sdlc/capability-discovery/recommendations/CAP-REC-ST-ENT-OBSERVABILITY.json`.
- Base artifact: `.sdlc/stories/ST-ENT-FOUNDATION/outputs/implementation-evidence.md`.
- Existing workflow, assessment, autonomy, configuration, and Observatory compatibility tests.

## What changed?

The implementation introduces a reusable observability layer under `lib/observability/`, a hardened trace-integrity boundary under `lib/trace-integrity.mjs`, configuration parsing and safety validation, CLI and Observatory integration, schemas and templates for durable evidence, and browser presentation changes. Documentation explains the operational model, support workflow, privacy boundary, and the distinction between local tamper evidence and trusted origin authentication.

Trace writes use an integrity checkpoint, bounded snapshots, no-follow file handles, directory and inode guards, atomic checkpoint replacement, and a lock whose cleanup is ownership-safe. Workflow events retain their own semantic chain and are journaled so a process crash cannot leave a semantic transition outside the sealed general trace.

Privacy handling is centralized and configurable. Built-in detectors cover concrete credential contexts; user-provided patterns are bounded and rejected when they can introduce pathological regular-expression behavior. The same policy is applied defensively at persistence and presentation boundaries. Evidence representation is versioned so historical fingerprints produced before the entropy-classification correction remain verifiable without treating new high-entropy identifiers as secrets.

The Observatory retains a read-only model. Health checks separate shallow liveness from warm readiness, operational endpoints require the loopback token, source reads are handle-bound and size-limited, non-success responses are streamed within fixed bounds, and the warm cache uses single-flight construction plus bounded metadata.

## Why was it decided?

The design keeps observability local and additive because the plugin must remain portable and dependency-free. Hash chaining plus a sidecar checkpoint provides useful local tamper evidence without claiming that the same host can prove origin authenticity. Redacting twice limits accidental disclosure even if either storage or presentation code regresses. Concrete credential detectors are used instead of generic entropy classification because hashes and governed identifiers are intentionally high entropy and must stay readable.

Evidence bytes, file identities, configuration revisions, and error envelopes are bounded to keep hostile or malformed project data from becoming a memory, CPU, path, or disclosure problem. Existing workflows and compatibility snapshots are preserved rather than migrated in place.

## Outputs

- Operational context, redaction, metrics, SLO, and support-bundle modules.
- Crash-safe general trace sealing, recovery, and exact-snapshot verification.
- Versioned trace evidence manifest schema and reusable template.
- CLI and Change Observatory operational endpoints and presentation.
- Configuration, architecture, operating, knowledge-base, and product documentation.
- Negative, compatibility, privacy, concurrency, crash-recovery, browser, and enterprise-performance tests.
- Immutable action, trace, validation, and output-verification evidence under `.sdlc/`.

## Verification

Outcome: passed locally before final governance linkage; the canonical final gate evidence is recorded separately after the current project snapshot and output link are sealed.

- Syntax and source checks passed with `npm run check`.
- The complete Node test suite passed 734 of 734 tests, followed by the enforcing enterprise benchmark.
- Focused tests covered trace tampering and recovery, workflow crash consistency, redaction and configured PII, credential contexts, evidence manifests, correlated CLI and HTTP errors, authenticated operational endpoints, support-bundle reproducibility, ETag behavior, cache concurrency, and UI guidance.
- `npm run doctor -- --root .` passed.
- `npm pack --dry-run --json` passed and included the new modules, schema, template, UI, documentation, and tests.
- The deterministic enterprise fixture exercised 1,000 sources, 1,000 stories, 10,000 records, 5,000 dependency edges, and 100,000 trace events. Canonical query time was 610.354 ms, warm Observatory p95 was 12.415 ms, and maximum Observatory RSS was 243,400,704 bytes, all inside the approved limits.
- Machine-readable command outcomes and measured budgets are stored in `.sdlc/stories/ST-ENT-OBSERVABILITY/evidence/final-validation-v2.txt`.

## Generated explanation

For a non-specialist: the plugin can now tell whether its local activity history was unexpectedly changed, remove concrete credentials and configured personal data before showing or saving operational information, attach one reference code to a failure, and produce a safe diagnostic package. These protections remain local; they do not claim that the computer itself can prove who originally created the evidence.

This explanation is an inference generated by Codex from the approved requirement, story, contract, implementation, tests, documentation, and evidence cited here. It does not contain private reasoning.

## Lineage

- Requirement: `.sdlc/requirements/REQ-ENTERPRISE-CONTROL-PLANE-001-R2.json`.
- Story: `.sdlc/stories/ST-ENT-OBSERVABILITY/story.json`.
- Contract: `.sdlc/contracts/contract-ST-ENT-OBSERVABILITY-implementation.json`.
- Delivery choice: `.sdlc/autonomy/deliveries/AUT-PR-ENT-OBSERVABILITY.json`.
- Task start: `.sdlc/stories/ST-ENT-OBSERVABILITY/task-start.json`.
- Trace and checkpoint: `.sdlc/traces/ST-ENT-OBSERVABILITY.jsonl` and `.sdlc/traces/.integrity/ST-ENT-OBSERVABILITY.jsonl.checkpoint.json`.
- Validation evidence: `.sdlc/stories/ST-ENT-OBSERVABILITY/evidence/final-validation-v2.txt`.
- Commit and protected-action evidence: `.sdlc/stories/ST-ENT-OBSERVABILITY/evidence/` and `.sdlc/autonomy/actions/`.
- Output registry entry: created by the final `output link` operation for this artifact.
