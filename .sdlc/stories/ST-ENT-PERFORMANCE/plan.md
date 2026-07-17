# ST-ENT-PERFORMANCE plan

## Objective

Meet the approved enterprise query, warm-response, and RSS budgets without weakening canonical evidence, portability, or public behavior.

## Scope

- Reuse one canonical catalog inside each CLI command.
- Replace repeated Observatory scans and pairwise joins with bounded indexes and retained-only projections.
- Add revision-aware single-flight caching and conditional responses.
- Add a deterministic, enforcing enterprise benchmark with complete semantic verification.
- Keep `.sdlc` authoritative, Node.js standard-library only, loopback/read-only server behavior, and Node.js 18.18+ compatibility.

Out of scope: production deployment, external services, new runtime dependencies, process-global truth, and later enterprise stories.

## Assignment

- Claim: `ST-ENT-PERFORMANCE`.
- Agent: `codex`.
- Branch: `codex/ST-ENT-PERFORMANCE`.
- Base: merged Foundation story on `main`.
- Delivery: `PR-ENT-PERFORMANCE-V4` under its exact non-reusable delivery choice.

## Implementation approach

1. Create one command-scoped canonical query session and preserve CLI compatibility.
2. Build bounded relationship indexes and normalize only retained view-model data.
3. Cache serialized Observatory models by a verified canonical revision and strong ETag.
4. Attribute canonical query and Observatory RSS to isolated worker processes.
5. Verify the full bounded model independently, then enforce exact count, latency, memory, cache, cleanup, and protocol gates.
6. Validate historical completed deliveries against their immutable event-time records when a successor contract becomes current, while retaining fail-closed tamper checks.
7. Run Node.js 24, Node.js 18.20.8, the complete repository suite, and CI before merge.

## Validation

- `npm run check`.
- `npm test` including 451 repository tests and the enforcing benchmark.
- Targeted Node.js 18.20.8 and Node.js 24 suites for query, normalizer, cache/server, and benchmark protocol.
- Five consecutive final-code enterprise benchmark runs.
- Independent review of index semantics, cache/race boundaries, retained-memory bounds, and IPC termination.
- Full GitHub Actions matrix before merge.

## Decisions

- Keep caches command/process scoped and disposable.
- Keep canonical relationship IDs exact; bound presentation only.
- Use a bounded hybrid directory snapshot, with the legacy digest as fallback.
- Reject chunked response serialization after it increased RSS.
- Preserve the first terminal worker cause and disarm later deadlines.
- Treat the story and task-start files as current projections; historical verification remains bound to immutable contract, profile, decision, receipt, and trace evidence.

## Open questions

None.
