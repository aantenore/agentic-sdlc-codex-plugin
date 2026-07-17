# Change delivery evidence

## What was asked?

Make the plugin's core reads and Change Observatory reliable at enterprise scale without changing canonical `.sdlc` truth, public CLI behavior, security boundaries, or Node.js 18.18+ portability.

The canonical request is [REQ-ENTERPRISE-CONTROL-PLANE-001-R2](../../../requirements/REQ-ENTERPRISE-CONTROL-PLANE-001-R2.json), delivered here through story `ST-ENT-PERFORMANCE` and its current [implementation contract](../../../contracts/contract-ST-ENT-PERFORMANCE-implementation-v4.json).

## Scope and non-goals

Delivered in this story:

- one command-scoped canonical query session shared by orchestration, reports, cache/index/manifest reads, and trace lookup;
- deterministic one-pass and indexed Change Observatory normalization with bounded collections, dossiers, lineage, evidence, identifiers, JSONL, and private-reasoning traversal;
- single-flight, revision-aware model caching with strong ETags and conditional responses;
- bounded concurrent validation of files, directories, symlinks, readability, and project identities without weakening race checks;
- a deterministic full-scale benchmark and independent semantic model verifier;
- process-isolated RSS attribution, worker protocol hardening, deterministic cleanup, and cross-platform max-RSS normalization;
- documentation of the canonical-versus-derived boundary and practical cache behavior.

Explicit non-goals were production deployment, external services, new runtime dependencies, process-global canonical state, persistent derived truth, and the observability, workflow, governance, portfolio, usability, and release stories that follow this performance lane.

## Inputs

- Requirement: `.sdlc/requirements/REQ-ENTERPRISE-CONTROL-PLANE-001-R2.json`, revision 2.
- Story: `.sdlc/stories/ST-ENT-PERFORMANCE/story.json`.
- Approved current contract: `.sdlc/contracts/contract-ST-ENT-PERFORMANCE-implementation-v4.json`.
- Fresh post-Foundation baseline: `.sdlc/baseline/BASELINE-ENT-PERFORMANCE-START-001.json`.
- Base delivery evidence: [Foundation implementation evidence](../../ST-ENT-FOUNDATION/outputs/implementation-evidence.md).
- Exact delivery boundary: `.sdlc/autonomy/deliveries/AUT-PR-ENT-PERFORMANCE-V4.json`.
- Existing canonical store, CLI query paths, Change Observatory model/server, security tests, and enterprise fixture.
- Contract constraints: Node.js standard library only; `.sdlc` remains authoritative; all caches/indexes remain disposable; path, symlink, evidence, JSON, exit-code, and read-only behavior remain compatible.

## What changed?

### Command-scoped canonical reads

- Added `lib/canonical-query-session.mjs` to build one deterministic catalog per command and serve orchestration, report, trace, and source queries from it.
- Reused bytes and parsed values by canonical path/hash while detecting external changes and supporting precise invalidation.
- Removed repeated full scans across the measured CLI paths without adding cross-command state.

### Bounded Observatory normalization

- Added `lib/change-observatory/record-index.mjs` and converted relationship joins to one bounded indexing pass.
- Added direct builders for selectors that can emit at most one entry per record, while retaining the priority heap for bounded multi-value fan-out.
- Materialized only retained top-ranked collections and bounded dossier lanes, diagnostics, source references, raw records, JSONL prefixes, identifiers, evidence, and private-reasoning traversal.
- Preserved canonical IDs for joins even when display IDs are shortened, preventing long-ID collisions and cross-story lineage.

### Revision-aware conditional cache

- Added a single-flight model cache that serializes once per canonical revision and serves byte-identical strong-ETag responses.
- Warm validation compares structured stat signatures and reuses verified digests without rereading unchanged file bodies.
- Ordinary directories use a bounded direct snapshot; wide or long-name directories retain the fixed legacy digest. The aggregate slot/name-byte budget bounds the optimization without changing digest or revision bytes.
- Invalid and intermediate snapshots are released before later scans; symlink, directory-identity, unreadable-entry, same-size mutation, and TOCTOU checks remain fail-closed.

### Enterprise benchmark and worker safety

- Added `scripts/benchmark-enterprise-performance.mjs` and made it an enforcing part of `npm test`.
- The fixture contains 1,000 source files, 1,000 stories, 10,000 records, 5,000 dependency edges, and 100,000 trace events.
- Canonical query, Observatory server, load driver, and semantic verifier have explicit process roles; only workload processes count toward their RSS budgets.
- Cold response bytes are streamed to a bounded artifact and verified independently for complete bounded semantics, exact counts, diagnostics, ETag, manifest, and target-story lanes.
- Worker IPC uses strict message order, command IDs, output bounds, primary/secondary deadlines, process-tree cleanup, and first-terminal-event semantics.

### Immutable historical delivery validation

- Historical start decisions, action receipts, and protected-action traces are validated against the exact immutable contract, profile, hashes, and evidence recorded when the action occurred instead of the story's later mutable projection.
- Active deliveries still reproduce their decisions from current policy and current story state; historical handling does not weaken the live gate.
- Receipt/profile/delivery/story/action bindings, checkpoint minima, evidence hashes, commit transitions, remote provider proof, and close/revocation integrity continue to fail closed.
- A successor-contract regression scenario proves that a completed delivery remains verifiable, while the existing tamper scenario still proves that a forged terminal receipt is rejected.

## Why was it decided?

The command-scoped session and disposable model cache reduce repeated work without creating a second source of truth. A process-global canonical cache was rejected because its lifecycle and invalidation would be harder to prove across independent CLI runs.

The normalizer keeps exact canonical keys for relationships and bounds only materialized presentation. This avoids quadratic joins and accidental cross-story links while retaining deterministic truncation diagnostics.

Directory validation uses a hybrid representation: direct comparison removes tens of thousands of temporary SHA-256 contexts on the approved fixture, while a fixed digest fallback prevents wide unsupported directory contents from increasing retained memory without bound. A fully chunked response serializer was prototyped and rejected after it raised server RSS to about 291 MiB through allocator and copy overhead.

The benchmark uses isolated processes and an independent semantic verifier because a fast response is not sufficient if the process attribution is wrong or the returned model is incomplete. Thresholds, fixture scale, 50 warm requests, and validation depth were not weakened to obtain a passing result.

No dependency was added, preserving packaged-plugin and Windows portability.

## Outputs

- Command-scoped query session and compatibility coverage.
- Bounded indexed Observatory normalizer and record index.
- Single-flight revision/ETag cache and safe conditional server responses.
- Enterprise benchmark, semantic verifier, IPC/process cleanup harness, and default test gate.
- Strict historical-delivery verification that survives an approved successor contract without accepting cross-profile evidence or tampering.
- Updated architecture and Observatory documentation.
- Machine-readable benchmark evidence: [enterprise-performance-local.json](../evidence/enterprise-performance-local.json).
- Atomic implementation commits:
  - `5470ede3e71b272b3e8d3b068735de06a773170c` — governed Performance baseline and exact delivery setup;
  - `0d371ce2bf65c7917e5b6c71c794d9a42fcc7c95` — reusable canonical query sessions;
  - `93bad23fc28189bce472ff35167b8da6d00b74c7` — verified-revision model caching and ETags;
  - `1ceb976b224f422993d717655210fc31e4d08204` — bounded indexed lineage projections;
  - `106ab26ae12507bf54565bd1fd234109b5829e03` — bounded canonical cache validation;
  - `5d3617c8e8ad9a829eb88c53bcbc9729805042f9` — enforcing enterprise performance harness;
  - `3c3d03c5eb4c88c1c455e47bd46508f0ad63e332` — first-terminal-event worker semantics.

## Verification

### Criterion 1: measured paths avoid repeated scans and quadratic joins

Outcome: passed.

- Canonical query-session tests verify one catalog build, reuse, external-change detection, path safety, malformed-input policy, and exact invalidation.
- Normalizer tests verify one-pass indexes, direct-versus-generic equivalence, bounded fan-out, canonical ID isolation, stable ranking, deterministic truncation, raw-source bounds, and private-reasoning redaction.
- The representative v1 Change Observatory model digest remained byte-for-byte unchanged.

### Criterion 2: full enterprise scale stays within approved budgets

Outcome: passed.

- Five consecutive final-code runs all passed; RSS ranged from 238,436,352 to 251,117,568 bytes, below the 268,435,456-byte Unix limit.
- The recorded final evidence passed with an 824.99 ms canonical query and 36.762 ms warm p95, below the 2,000 ms and 100 ms Unix limits.
- The final full-suite gate benchmark passed at 248,266,752 bytes RSS, 837.385 ms query time, and 34.322 ms warm p95.
- Every run used the same manifest `c2e2f2cc...018a` and strong ETag `sha256-jS5g6E8I...V7xo`.

### Criterion 3: cache reuse never weakens canonical evidence checks

Outcome: passed.

- Model-cache/server tests cover add, remove, rename, type change, same-size mutation, metadata drift, unreadable entries, symlink escape, project/knowledge-base swaps, scan races, concurrent builds, exact ETags, GET/HEAD, and read-only behavior.
- Wide-directory and long-name tests verify bounded digest fallback plus correct invalidation.
- Model-cache/server suites passed on Node.js 24 and Node.js 18.20.8.

### Full compatibility and harness verification

Outcome: passed.

- `npm run check` passed.
- `npm test` passed 451/451 and then passed the enforcing full-scale benchmark.
- Benchmark protocol tests passed 40/40 on Node.js 24 and 40/40 on Node.js 18.20.8; the complete autonomy CLI suite also passed 5/5 on Node.js 18.20.8.
- Completion, disconnect, and IPC-error tests deterministically verify that the first terminal cause cannot be relabeled by a later timeout.
- A valid worker completion now disarms the primary work deadline before arming the bounded process-exit deadline, so a late but valid completion cannot be misclassified under parallel load.
- The autonomy regression scenario replaces the current story contract and task-start projection with a successor delivery, verifies the completed predecessor without policy reinterpretation, and then confirms that terminal-receipt tampering still fails the strict gate.
- Independent reviews found no remaining P0-P2 issues in direct indexing, cache validation, snapshot bounds, digest/revision compatibility, or worker semantics.

Evidence: `.sdlc/tests/ST-ENT-PERFORMANCE-full-suite.json`, [enterprise-performance-local.json](../evidence/enterprise-performance-local.json), and `commit-001.txt` through `commit-007.txt` in the story evidence directory.

## Generated explanation

For a non-specialist, this change means the plugin can now inspect a large project without repeatedly rereading and reconnecting the same information. The visual Observatory reuses a result only after checking that the underlying project evidence is still exactly the same; when nothing changed, it answers quickly with almost no response body. Large or unusual folders remain bounded instead of trading speed for uncontrolled memory.

This explanation is an inference generated by Codex from the approved requirement and contract, committed code, full-suite results, benchmark evidence, review findings, and action receipts cited here.

## Lineage

- Requirement: `.sdlc/requirements/REQ-ENTERPRISE-CONTROL-PLANE-001-R2.json`.
- Requirement autonomy maximum: `.sdlc/autonomy/requirements/AUT-REQ-ENTERPRISE-CONTROL-PLANE-001-R2-R2.json`.
- Story: `.sdlc/stories/ST-ENT-PERFORMANCE/story.json`.
- Contract and approval: `.sdlc/contracts/contract-ST-ENT-PERFORMANCE-implementation-v4.json`.
- Capability boundary: `.sdlc/capability-discovery/profiles/CAP-PROFILE-ST-ENT-PERFORMANCE.json` and `.sdlc/capability-discovery/recommendations/CAP-REC-ST-ENT-PERFORMANCE.json`.
- Delivery choice for this pull request: `.sdlc/autonomy/deliveries/AUT-PR-ENT-PERFORMANCE-V4.json`.
- Task-start receipt: `.sdlc/autonomy/executions/AUT-PR-ENT-PERFORMANCE-V4/start.json`.
- Trace: `.sdlc/traces/ST-ENT-PERFORMANCE.jsonl`.
- Commit evidence: `.sdlc/stories/ST-ENT-PERFORMANCE/evidence/commit-001.txt` through `commit-007.txt`.
- Output registry entry: created by linking this document as `implementation-evidence` with template `implementation-evidence-v1` in delta mode from the Foundation evidence.
