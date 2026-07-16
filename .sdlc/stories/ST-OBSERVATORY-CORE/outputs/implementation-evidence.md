# Change delivery evidence

## What was asked?

Build the local, dependency-free core of the install-integrated SDLC Change Observatory: normalize canonical `.sdlc` evidence into a stable lineage model and expose it through a safe, read-only loopback API. The originating requirement is [REQ-CHANGE-OBSERVATORY-001](../../../requirements/REQ-CHANGE-OBSERVATORY-001.json); the story boundary is [ST-OBSERVATORY-CORE](../story.json).

## Scope and non-goals

Delivered in this lane:

- versioned normalization of canonical `.sdlc` records;
- explicit `recorded`, `inferred`, `missing`, and `malformed` provenance;
- bounded diagnostics for empty, partial, legacy, malformed, and oversized evidence;
- read-only HTTP endpoints for health, normalized lineage, and source records;
- static-asset serving primitives for the bundled UI;
- loopback-only binding, Host validation, restrictive CSP, no CORS, and path containment;
- deterministic unit and security tests.

Excluded by contract and left to the integration/UI lanes: CLI dispatch, browser launch, package wiring, visual components, external services, deployment, dependencies, and any reconstruction of unstored history. Private chain-of-thought is neither generated nor exposed; explicitly flagged private reasoning is redacted.

## Inputs

- Requirement: [REQ-CHANGE-OBSERVATORY-001](../../../requirements/REQ-CHANGE-OBSERVATORY-001.json)
- Story: [ST-OBSERVATORY-CORE](../story.json)
- Approved contract: [contract-ST-OBSERVATORY-CORE-implementation](../../../contracts/contract-ST-OBSERVATORY-CORE-implementation.json)
- Approved capability boundary: [CAP-REC-CHANGE-OBSERVATORY](../../../capability-discovery/recommendations/CAP-REC-CHANGE-OBSERVATORY.json)
- Approved output format: [implementation-evidence-v1](../../../output-contracts/templates/implementation-evidence-v1.md)
- Project architecture: `docs/architecture.md`
- Existing dependency-free Node runtime and project-local `.sdlc` conventions.

## What changed?

Normalization and provenance:

- `lib/change-observatory/normalizer.mjs` scans canonical evidence within configurable bounds, excludes derived cache/index content, tolerates schema variation, and emits `change-observatory:view:v1`.
- The model exposes project metadata, summary answers, story-phase iterations, contracts, decisions and approvals, changes, verification, source metadata, and bounded diagnostics.
- Optional `trace-narrative:v1` fields become labeled explanation, input, output, alternative, and evidence references. Legacy summaries remain exact deterministic fallbacks rather than synthesized history.

Security and serving:

- `lib/change-observatory/path-safety.mjs` enforces portable relative paths plus realpath containment.
- `lib/change-observatory/source-reader.mjs` provides bounded canonical-source access, excludes derived files, and redacts explicitly stored private reasoning.
- `lib/change-observatory/server.mjs` exposes `/api/v1/health`, `/api/v1/observatory`, and `/api/v1/source`, serves optional bundled assets, and rejects non-loopback binds, invalid Host values, write methods, traversal, and symlink escape.
- `lib/change-observatory/index.mjs` is the stable integration surface.

Verification:

- `test/unit/change-observatory-normalizer.test.mjs` covers representative, empty, absent, partial, legacy, malformed, oversized, narrative, and redaction cases.
- `test/unit/change-observatory-server.test.mjs` covers endpoints, security headers, no CORS, Host, method, traversal, symlink, derived records, static assets, HEAD, and loopback binding.

## Why was it decided?

The implementation uses only Node built-ins and browser-native contracts because the plugin must work immediately after installation without a build step, dependency install, or hosted service. Canonical `.sdlc` files remain authoritative; normalization is tolerant at the boundary but never silently promotes malformed or inferred information to recorded fact. Realpath containment is applied after lexical validation because lexical checks alone cannot stop symlink escape. The server returns source-linked facts rather than pre-rendered prose so technical and non-technical clients can choose their own presentation without changing evidence semantics.

Rejected alternatives:

- React/Vite or another build pipeline: conflicts with zero-build installed operation.
- A hosted dashboard: conflicts with local-first evidence and introduces external trust boundaries.
- Reading Git history as canonical SDLC intent: would invent rationale not present in `.sdlc`.
- Serving the whole project root: would expand raw access beyond the selected canonical knowledge base.
- Exposing arbitrary reasoning fields: conflicts with the explicit no-private-chain-of-thought boundary.

Trade-off: the normalizer favors explicit missing states and diagnostics over a visually complete but speculative timeline. Large or corrupt evidence is bounded and may be omitted with a visible diagnostic.

## Outputs

- Public module: `lib/change-observatory/index.mjs`
- Versioned view model: `change-observatory:view:v1`
- Versioned source response: `change-observatory:source:v1`
- Loopback server start API: `startObservatoryServer({ projectRoot, assetRoot?, host, port, limits?, clock? })`
- Request-handler API: `createObservatoryRequestHandler(options)`
- Test evidence: [test-evidence.json](test-evidence.json)
- Implementation and security tests under `test/unit/`.

## Verification

| Acceptance criterion | Evidence | Outcome |
| --- | --- | --- |
| Stable versioned model with explicit provenance | `change-observatory-normalizer.test.mjs`: representative lineage and provenance assertions | Passed |
| Read-only loopback endpoints without traversal or symlink escape | `change-observatory-server.test.mjs`: health/model/source, Host, methods, traversal, two symlink boundaries, cache rejection | Passed |
| Empty, partial, legacy, malformed, and oversized KBs remain bounded and non-speculative | `change-observatory-normalizer.test.mjs`: missing, legacy, malformed, diagnostic cap, file/source limits | Passed |
| Deterministic Node tests cover core and security invariants | [test-evidence.json](test-evidence.json): 8/8 targeted tests, `npm run check`, and `git diff --check` | Passed |

No package-wide pass is claimed by this worker lane; final package and installed-launcher verification belongs to the integration orchestrator.

## Generated explanation

Codex-generated from the recorded requirement, approved contract, changed files, and passing test evidence: the plugin now has a local evidence engine that can tell the visual app what was requested, changed, decided, and verified without inventing missing history. It reads only bounded project SDLC records, labels uncertainty, and exposes them over a loopback-only, read-only interface protected against Host abuse and path escape.

This paragraph is a generated explanation, not private chain-of-thought. Its sources are [REQ-CHANGE-OBSERVATORY-001](../../../requirements/REQ-CHANGE-OBSERVATORY-001.json), [the approved contract](../../../contracts/contract-ST-OBSERVATORY-CORE-implementation.json), and [test-evidence.json](test-evidence.json).

## Lineage

- Requirement: `REQ-CHANGE-OBSERVATORY-001`
- Story: `ST-OBSERVATORY-CORE`
- Contract/version: `contract-ST-OBSERVATORY-CORE-implementation`, `schema_version: 0.1.0`
- Approved contract content hash: `872b1f000d7276eaa711f9421792d9f46c95868f0424e42058ec8fc7d2420288`
- Capability recommendation: `CAP-REC-CHANGE-OBSERVATORY`
- Task start: [task-start.json](../task-start.json)
- Claim: [claim.json](../claim.json), branch `codex/ST-OBSERVATORY-CORE`
- Test evidence: [test-evidence.json](test-evidence.json)
- Trace: `../../../traces/ST-OBSERVATORY-CORE.jsonl`
- Commit: story-scoped Git commit on `codex/ST-OBSERVATORY-CORE`; the immutable SHA is delivered in the worker handoff.
- Output registry link and step completion: intentionally delegated to the parent orchestrator after integration, per worker scope.
