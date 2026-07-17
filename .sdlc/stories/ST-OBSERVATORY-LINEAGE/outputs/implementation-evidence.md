# Change delivery evidence

## What was asked?

Extend the installed Change Observatory so each SDLC story can be read as a coherent iteration dossier: what was asked, decided, contracted, done, and verified, including recorded rationale, generated explanation, source provenance, and enough lineage for a non-technical reader to reconstruct the work.

Canonical request: [REQ-CHANGE-OBSERVATORY-001](../../../requirements/REQ-CHANGE-OBSERVATORY-001.json). Story: [ST-OBSERVATORY-LINEAGE](../story.json). Approved execution boundary: [contract-ST-OBSERVATORY-LINEAGE-implementation-v2](../../../contracts/contract-ST-OBSERVATORY-LINEAGE-implementation-v2.json).

This artifact is the dossier delta over the completed [Change Observatory integration evidence](../../ST-OBSERVATORY-INTEGRATION/outputs/implementation-evidence.md).

## Scope and non-goals

Delivered scope:

- Additive `change-observatory:iteration-dossier:v1` projection with five canonical lanes: Asked, Decided, Contract, Done, and Verified.
- Explicit one-hop, typed, fail-closed linkage with provenance, source references, diagnostics, deterministic ordering, and a global nested-item budget.
- Separate recorded rationale and generated explanation throughout the server projection, browser model, dossier cards, and inspector.
- Responsive native browser dossier selector, five-lane desktop view, stacked mobile view, raw-source drawer, and explicit missing/malformed/unlinked states.
- Iterative bounded scans that suppress content when private-reasoning inspection cannot safely complete.
- Coordinated plugin version `0.10.0`, documentation, adversarial tests, package verification, and real loopback-browser evidence.

Explicit non-goals:

- No LLM call, inferred intent, reconstructed reasoning, or generated history inside the application.
- No fuzzy, semantic, timestamp, filename, free-text, shared-requirement, or transitive record joins.
- No hosted service, telemetry, external upload, public bind, new runtime dependency, frontend build step, or mutable evidence API.
- No rewrite of valid historical SDLC records merely to make older evidence look complete.

## Inputs

- [Requirement](../../../requirements/REQ-CHANGE-OBSERVATORY-001.json)
- [Story](../story.json)
- [Approved implementation contract v2](../../../contracts/contract-ST-OBSERVATORY-LINEAGE-implementation-v2.json)
- [Final delegated authorization](../../../authorizations/AUTH-OBSERVATORY-LINEAGE-FINAL-V1.json)
- [Task-start receipt](../task-start.json)
- [Approved capability profile](../../../capability-discovery/profiles/CAP-PROFILE-OBSERVATORY-LINEAGE.json)
- [Approved capability recommendation](../../../capability-discovery/recommendations/CAP-REC-OBSERVATORY-LINEAGE.json)
- Existing Change Observatory normalizer, source reader, browser model, components, styles, tests, and integration evidence

## What changed?

Evidence normalization and ownership:

- `lib/change-observatory/normalizer.mjs` emits a story-scoped dossier schema and places records only through direct story identity, a unique coherent contract, explicit requirement mapping, an exact unique related identifier, or a canonical unambiguous single-object evidence path.
- Shared requirements do not propagate project records, ambiguous identifiers cannot link, contract/story conflicts are excluded, duplicate story IDs suppress the dossier, and malformed or cross-story evidence produces diagnostics rather than content.
- Story requests populate Asked; decisions and approvals populate Decided; approved briefs populate Contract; implementation and sync evidence populate Done; tests, gates, completed steps, and product releases populate Verified. A story-release sync event never becomes a product release.
- All item placement shares one configurable global budget and a stable total order independent of filesystem creation order.

Private-data and source safety:

- `lib/change-observatory/source-reader.mjs` and the normalizer use iterative scans bounded to 25,000 nodes and depth 512.
- If the scan limit is reached, raw content is omitted and `private_reasoning_scan_limited` is recorded; no partially inspected record is exposed.
- JSONL evidence remains multi-record even when it contains one line, so it cannot masquerade as a canonical single-object evidence link.

Browser behavior:

- `ui/change-observatory/model.js` accepts only dossiers owned by the selected story and recomputes lane and dossier states from accepted canonical items.
- Foreign items, contradictory recorded-empty states, missing lanes with items, malformed lanes, and legacy release shortcuts fail closed instead of yielding a false complete state.
- `components.js`, `app.js`, and `styles.css` render the selector, five evidence lanes, rationale and explanation blocks, linkage provenance, raw-source controls, unlinked disclosure, responsive stacking, and accessible status labels.

Tests, docs, and packaging:

- Normalizer, server, and UI tests cover explicit-link matrices, ambiguous and cross-story evidence, rationale/explanation separation, bounded scans, state contradictions, ownership, ordering, and global limits.
- README and operating documentation describe the proof-bound dossier, token cost, installed launch path, limitations, and version `0.10.0`.
- Package and plugin manifests move together to `0.10.0`; the installable package continues to include the full observatory and its Codex skill.

## Why was it decided?

Chosen approach: construct a deterministic server-side dossier from canonical `.sdlc` records, then apply an independent browser-side ownership and state check before rendering it.

Evidence-backed rationale:

- A server projection centralizes compatibility, bounded reading, provenance, and link validation while keeping the browser independent from storage-layout details.
- Independent browser ownership checks prevent a malformed or future server payload from silently crossing story boundaries.
- Typed one-hop links preserve auditability. Every placement can state which exact canonical relationship justified it.
- Missing, malformed, ambiguous, and unlinked states are useful product information; hiding them would create false certainty.
- Rationale and generated explanation serve different purposes. Keeping them separate lets a reader distinguish a recorded decision reason from a later plain-language summary.

Alternatives rejected:

- Semantic or fuzzy joins: rejected because similar language is not proof that two records belong to the same story.
- Requirement fan-out and transitive graph traversal: rejected because shared context can leak one story's execution evidence into another dossier.
- Browser-generated explanations: rejected because the installed app must work offline, remain deterministic, and never invent project history.
- Recursive unbounded inspection: rejected because deeply nested hostile data can exhaust the runtime or escape complete safety inspection.

Trade-offs:

- Older records without explicit linkage remain unlinked or missing even when a human might infer a relationship.
- Five evidence-rich lanes can be dense on desktop; responsive stacking and raw-detail disclosure preserve readability without discarding lineage.
- The browser validates the server projection again, which duplicates a narrow set of ownership/state rules in exchange for defense in depth.

## Outputs

- Versioned per-story iteration dossier in `lib/change-observatory/normalizer.mjs`.
- Bounded raw-source inspection in `lib/change-observatory/source-reader.mjs`.
- Native visual dossier in `ui/change-observatory/model.js`, `components.js`, `app.js`, and `styles.css`.
- Adversarial backend and frontend regression coverage.
- Coordinated plugin/package release surface `0.10.0` and updated user documentation.
- Desktop evidence: [1440x1000 screenshot](../../../tests/ST-OBSERVATORY-LINEAGE-desktop.png).
- Mobile evidence: [390x900 screenshot](../../../tests/ST-OBSERVATORY-LINEAGE-mobile.png).
- Structured verification: [ST-OBSERVATORY-LINEAGE-test-evidence.json](../../../tests/ST-OBSERVATORY-LINEAGE-test-evidence.json).

## Verification

Automated outcome: `npm test` passed 273 tests with 0 failures. The 42 targeted normalizer, server, and UI tests passed. `npm run check`, `npm run doctor`, `npm pack --dry-run --json`, and `git diff --check` passed. Independent adversarial review found no remaining P0/P1 defect.

Acceptance mapping:

1. Explicit linkage: adversarial fixtures verify direct story, unique contract, explicit requirement, unique related ID, and canonical single-object evidence joins while rejecting ambiguous, conflicting, shared, transitive, JSONL, malformed, and free-text alternatives.
2. Rationale separation: normalizer and UI tests plus real browser QA show recorded rationale independently from generated explanation; neither is used as a fallback for the other.
3. Story isolation: backend and browser ownership checks reject foreign records, duplicate stories, contract/story conflicts, and contradictory lane state; diagnostics remain explicit.
4. Installed responsive product: package-install coverage and a real plugin-local server passed at 1440x1000 and 390x900. All five lanes rendered, raw evidence opened, mobile width stayed bounded, and the browser console stayed clean without an LLM runtime.

Security and robustness checks include the global item cap, deterministic ordering, 12,000-level hostile nesting, 25,000-node and 512-depth scan limits, content suppression on incomplete inspection, and fail-closed malformed evidence.

## Generated explanation

Codex-generated from the recorded requirement, approved contract, implementation trace, tests, independent review, and real browser QA: Change Observatory can now show one story as an evidence-backed dossier. A reader sees the original request, decisions and their recorded reasons, the approved work brief, implementation, tests, and release evidence in five clear steps. Every item states why it belongs there and can open its source. If the project did not record enough proof, the app says so instead of guessing.

## Lineage

- Requirement: [REQ-CHANGE-OBSERVATORY-001](../../../requirements/REQ-CHANGE-OBSERVATORY-001.json)
- Story: [ST-OBSERVATORY-LINEAGE](../story.json)
- Approved contract: [contract-ST-OBSERVATORY-LINEAGE-implementation-v2](../../../contracts/contract-ST-OBSERVATORY-LINEAGE-implementation-v2.json)
- Authorization: [AUTH-OBSERVATORY-LINEAGE-FINAL-V1](../../../authorizations/AUTH-OBSERVATORY-LINEAGE-FINAL-V1.json)
- Capability boundary: [CAP-PROFILE-OBSERVATORY-LINEAGE](../../../capability-discovery/profiles/CAP-PROFILE-OBSERVATORY-LINEAGE.json) and [CAP-REC-OBSERVATORY-LINEAGE](../../../capability-discovery/recommendations/CAP-REC-OBSERVATORY-LINEAGE.json)
- Task start: [task-start.json](../task-start.json)
- Story trace: [ST-OBSERVATORY-LINEAGE.jsonl](../../../traces/ST-OBSERVATORY-LINEAGE.jsonl)
- Structured tests: [ST-OBSERVATORY-LINEAGE-test-evidence.json](../../../tests/ST-OBSERVATORY-LINEAGE-test-evidence.json)
- Desktop visual evidence: [ST-OBSERVATORY-LINEAGE-desktop.png](../../../tests/ST-OBSERVATORY-LINEAGE-desktop.png)
- Mobile visual evidence: [ST-OBSERVATORY-LINEAGE-mobile.png](../../../tests/ST-OBSERVATORY-LINEAGE-mobile.png)
- Branch: `codex/ST-OBSERVATORY-LINEAGE`; delivery commit, main-branch consolidation, tag, and release are recorded by Git and sync traces after final validation.
