# Enterprise portfolio delivery evidence

## What was agreed

Deliver one safe, useful view across an explicit set of local Agentic SDLC projects without scanning neighbouring folders or weakening any project's boundaries. The portfolio must remain read-only, load full project detail only when a person selects it, isolate unavailable projects, work on Node.js 18/20/24, and explain failures in ordinary language.

This delivery implements `REQ-ENT-PORTFOLIO-R2` through story `ST-ENT-PORTFOLIO-R2` and approved contract `contract-ST-ENT-PORTFOLIO-R2-implementation-v3`.

The autonomy choice applies only to this pull request. In plain language, the user chose: **work independently inside the agreed files and acceptance criteria, but stop at protected boundaries and retain evidence for every operation**. That choice cannot be reused for a later PR or local installation. The current host can audit actions but cannot independently sign them, so the runtime narrows protected operations to recorded checkpoints; this is an extra safety restriction, not a request for the user to understand internal labels.

## What a person can do now

1. Create one small manifest listing only the projects to compare.
2. Run `agentic-sdlc portfolio status --root <workspace> --manifest <relative.json> --json` for a compact terminal or CI result.
3. Run `agentic-sdlc observe --root <workspace> --portfolio-manifest <relative.json>` for the local browser view.
4. Start from the bounded summary, then select one project when full lineage is needed.
5. Use browser Back and Forward to revisit project selections without mixing one project's data with another's.

An unavailable or malformed project becomes one isolated card with a useful explanation; it does not make the remaining portfolio unusable.

## Delivered behavior

- A versioned JSON Schema and fail-closed manifest parser accept at most 64 explicitly ordered projects.
- Paths stay beneath the declared portfolio root, symbolic links and duplicate physical roots are rejected, and filesystem identities remain exact above JavaScript's safe-integer range.
- Summary collection is bounded by file count, bytes, parsed records, preview items, and four concurrent readers by default.
- Active workflows, blockers, risks, budgets, dependencies, releases, malformed evidence, and unavailable roots determine project and overall health.
- Aggregate strings are presentation-redacted; fallback IDs use anonymous ordinals rather than filenames, paths, or hashes derived from secret names.
- Full project models are lazy and kept in an access-ordered eight-entry cache by default.
- Eviction, refresh failure, and shutdown clear stale data and dispose resources. Shutdown waits only for a bounded grace period, while a still-active lease completes deferred cleanup later and emits closed-cardinality telemetry.
- Portfolio APIs never return absolute project paths or the per-run access token.
- The browser clears prior project state before a delayed fetch, binds evidence to the selected manifest project, validates the URL selection, and exposes accessible English/Italian headings and regions.
- Existing single-project Observatory behavior remains unchanged when no portfolio manifest is supplied.

## Verification

Outcome: passed on final source commit `801c3914811d23b8902afb4d2c8c1c898b6a0ebf`.

- Node.js 24 full suite: 920/920 tests passed.
- Node.js 18 and 20 targeted Observatory/CLI compatibility suites passed.
- `npm run check` passed.
- `git diff --check origin/main...HEAD` passed.
- Known private-key, provider-token, JWT, credential-URL, and high-risk secret-material patterns were absent from the branch diff.
- Every branch commit is authored and committed by `Antonio Antenore <ant_ant95@hotmail.it>`; no branch identity contains `reply` or `noreply`.
- Independent final review found no remaining P0 or P1 issue. Its P2 deferred-disposal telemetry follow-up is resolved, and the final governance fix prevents an artifact that is both explicit evidence and an approved output from being recorded twice.

The enforcing enterprise benchmark used 1,000 stories, 10,000 records, 5,000 dependency edges, and 100,000 trace events. Canonical query time was 483.449 ms against a 2,000 ms limit; warm Observatory p95 was 11.424 ms against a 100 ms limit; maximum RSS was 226,050,048 bytes against a 268,435,456-byte limit. Resources closed successfully.

Machine-readable evidence: [ST-ENT-PORTFOLIO-R2-final-801c391.json](../../../tests/ST-ENT-PORTFOLIO-R2-final-801c391.json).

## Safety boundaries

The manifest is explicit and local. It does not discover sibling projects, mutate target projects, authorize tools, grant repository access, approve a pull request, merge code, deploy, read secrets, or transfer an autonomy choice to another delivery. Summary and detail reads have independent deterministic limits. Invalid configuration fails before the server reports ready.

## Lineage

- Requirement: `.sdlc/requirements/REQ-ENT-PORTFOLIO-R2.json`.
- Story: `.sdlc/stories/ST-ENT-PORTFOLIO-R2/story.json`.
- Contract: `.sdlc/contracts/contract-ST-ENT-PORTFOLIO-R2-implementation-v3.json`.
- Exact PR autonomy choice: `.sdlc/autonomy/deliveries/AUT-PR-ENT-PORTFOLIO-R3.json`.
- Test evidence: `.sdlc/tests/ST-ENT-PORTFOLIO-R2-final-801c391.json`.
- Trace: `.sdlc/traces/ST-ENT-PORTFOLIO-R2.jsonl`.

This explanation is an inference generated by Codex from the approved requirement and contract, implementation, final tests, review findings, and recorded delivery actions cited above.
