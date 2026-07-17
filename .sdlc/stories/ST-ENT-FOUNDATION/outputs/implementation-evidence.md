# Change delivery evidence

## What was asked?

Build the first trustworthy enterprise foundation for the plugin: project behavior must remain stable across plugin upgrades, implementation sources must be discovered correctly, large canonical project state must remain queryable within measured budgets, and user-facing governance must be understandable without knowing the plugin's internal vocabulary.

The canonical request is [REQ-ENTERPRISE-CONTROL-PLANE-001-R2](../../../requirements/REQ-ENTERPRISE-CONTROL-PLANE-001-R2.json), delivered here through story `ST-ENT-FOUNDATION`.

## Scope and non-goals

Delivered in this story:

- fully materialized, versioned project configuration with a hash-bound lock;
- read-only migration preview followed by exact plan-hash application;
- fail-closed behavior for drifted or invalid configuration while recovery reads remain available;
- implementation-source discovery independent from knowledge-base search extensions;
- a path-safe, command-scoped canonical store;
- a deterministic enterprise fixture and benchmark for 1,000 source files, 1,000 stories, 10,000 records, 5,000 dependency edges, and 100,000 trace events;
- plain-language English and Italian guidance for requirement ceilings, one-delivery autonomy, checkpoints, task start, signed authority, actions, and gates;
- documentation for safe configuration migration and per-delivery autonomy.

Explicit non-goals for this foundation delivery were production deployment, secrets, external services, mandatory runtime dependencies, destructive migration of approved records, and the later observability, workflow-engine, portfolio, and release stories reserved by the approved enterprise breakdown.

## Inputs

- Requirement: `.sdlc/requirements/REQ-ENTERPRISE-CONTROL-PLANE-001-R2.json`, revision 2.
- Story: `.sdlc/stories/ST-ENT-FOUNDATION/story.json`.
- Approved contract: `.sdlc/contracts/contract-ST-ENT-FOUNDATION-implementation.json`.
- Historical pre-change baseline: `.sdlc/baseline/BASELINE-ENTERPRISE-PLATFORM-001.json`.
- Delivery boundary: `.sdlc/autonomy/deliveries/AUT-PR-ENT-FOUNDATION.json`.
- Capability recommendation: `.sdlc/capability-discovery/recommendations/CAP-REC-ST-ENT-FOUNDATION.json`.
- Compatibility source: `templates/config-compat/0.11.0.json` and its verified manifest.
- Existing CLI, schemas, templates, package scripts, and test suite in the repository.
- Assumption retained from the contract: approved 0.11.0 effective configuration is the compatibility baseline for legacy projects.

## What changed?

### Stable configuration

- Added `lib/effective-config.mjs`, configuration lock and migration schemas, and a frozen compatibility snapshot.
- Initialized projects now store the complete effective configuration plus `.sdlc/config.lock.json`.
- Added `config status` and dry-run-first `config migrate`; application requires the reviewed plan hash and revalidates all inputs under lock.
- Active-release migration no longer changes configuration as a side effect.
- Drifted or invalid configuration blocks governed writes but preserves status, doctor, and migration recovery paths.

### Correct source discovery and scalable reads

- Added `lib/baseline-source-discovery.mjs` so implementation evidence is discovered by its own source policy rather than KB index extensions.
- Preserved approved pre-change baselines after confirmed task start as historical evidence, reporting later changes as warnings instead of impossible refresh approvals.
- Added `lib/canonical-store.mjs` with deterministic project-relative keys, path/symlink safety, command-scoped reuse, invalidation, and bounded metrics.
- Added a deterministic enterprise fixture plus `scripts/benchmark-foundation.mjs` with query, warm-read, memory, and cleanup budgets.

### Human-readable operation

- Added `lib/human-guidance.mjs` with immutable English and Italian guidance blocks: result, impact, next action, then technical details.
- Requirement output now explains that its autonomy value is only a future maximum; every pull request or local release still receives a separate, non-reusable choice.
- Delivery status reports the level the agent can actually use. Unsigned approval narrows full autonomy to checkpoints; host-verified mode without a verified signature fails closed.
- Action authorization explicitly distinguishes permission from execution.
- Task-start and gate output translate common blockers into plain language and keep canonical codes under technical details.
- Unsupported locales fail before command execution, avoiding a late error after writes.

## Why was it decided?

The configuration is fully materialized instead of being re-merged with whichever defaults happen to ship in a later plugin version. This makes upgrades predictable and allows a reviewed migration to be reproduced by hash. A compatibility snapshot was chosen over silently inheriting new defaults because authority, autonomy, gate, and budget behavior must never change by installation side effect.

The canonical store remains command-scoped and disposable rather than becoming a second source of truth. This preserves the existing `.sdlc` evidence model while reducing repeated reads inside a command. A process-global cache was rejected because stale cross-command state would be harder to reason about and invalidate safely.

Autonomy is explained in work terms first and internal labels second. Automatic progression based only on the number of successful earlier runs was rejected: success history does not authorize a different pull request. The exact requirement, contract, repository, branch, paths, actions, checkpoints, expiry, and evidence determine each delivery independently.

No mandatory package was added. This keeps Node.js 18.18+ and packaged-plugin portability intact; later optional integrations can use explicit adapters.

## Outputs

- Configuration resolver, lock, migration planner, CLI integration, schemas, templates, and compatibility snapshot.
- Implementation-source discovery and baseline semantics.
- Command-scoped canonical store, deterministic fixture, and benchmark command.
- Human-guidance library and CLI presentation for autonomy, actions, task start, and gates.
- Unit and end-to-end regression coverage for all added behavior.
- `docs/configuration-safety.md` and expanded README guidance.
- Atomic commits:
  - `a61c2095cf017d70c741e0dc0264a2eb75f69cee` — approved enterprise program records;
  - `2d6a735d6e2b441a19fb6633b016adc505d6c2ba` — pinned effective project configuration;
  - `1f33394f86db9adf24abc3b82aa4e12d6876b443` — command-scoped canonical store and benchmark;
  - `8dc8192a2c210710d3a92ff5f09992bf10cd6e3d` — plain-language governed work.

## Verification

### Criterion 1: upgrades cannot silently change effective policy

Outcome: passed.

- `test/unit/effective-config.test.mjs` verifies deterministic materialization, frozen compatibility behavior, lock integrity, drift detection, plan hashes, and idempotent migration.
- `test/cli.e2e.mjs` verifies human-readable status, dry-run/apply, stale plan rejection, invalid lock recovery, and separate release-history migration.
- `npm run check` passed after the final changes.
- Packaged-plugin installation is covered by the clean 97-test CLI E2E run.

### Criterion 2: implementation sources are independent from KB extensions

Outcome: passed.

- `test/unit/baseline-source-discovery.test.mjs` verifies source extensions, exclusions, explicit files, deterministic truncation, policy validation, and symlink rejection.
- CLI onboarding and baseline E2E tests verify automatic project evidence discovery and the approved pre-change snapshot behavior.

### Criterion 3: path-safe store and deterministic enterprise harness

Outcome: passed.

- `test/unit/canonical-store.test.mjs` verifies deterministic reuse, external-change detection, invalidation, regular-file walking, path escape rejection, malformed JSON rejection, root swaps, and symlink-root rejection.
- Enterprise fixture and benchmark unit tests verify deterministic counts, IDs, timestamps, cleanup, and machine-readable failures.
- Final benchmark: canonical query 572.210 ms within 2,000 ms; 50 warm reads 7.020 ms within 100 ms; maximum RSS 116,178,944 bytes within 268,435,456 bytes; fixture cleanup completed.

### Additional usability and safety verification

Outcome: passed.

- `test/unit/human-guidance.test.mjs`: 9/9 passed.
- `test/cli.e2e.mjs`: 97/97 passed in an isolated full-file run.
- All five autonomy delivery scenarios passed across resource-controlled runs, including exact commit/push chains, provider-verified merge, strict local release, and revocation integrity.
- A monolithic all-files run encountered two operating-system process terminations under load; both affected scenarios passed when rerun alone. These were resource terminations, not failed behavioral assertions.
- `git diff --check` and `npm run check` passed.

Evidence files: `.sdlc/stories/ST-ENT-FOUNDATION/evidence/commit-001.txt` through `commit-004.txt`, delivery action receipts under `.sdlc/autonomy/actions/`, and the append-only story trace.

## Generated explanation

For a non-specialist, this change means the plugin now remembers the exact rules a project approved instead of silently adopting different rules after an update. It can scan and query a much larger project with measured limits, and when it needs a decision it first says what is happening, what that means, and what to do next. A choice made for one pull request never becomes standing permission for another one.

This explanation is an inference generated by Codex from the requirement, approved contract, committed code, test results, benchmark output, and action receipts cited in this document.

## Lineage

- Requirement: `.sdlc/requirements/REQ-ENTERPRISE-CONTROL-PLANE-001-R2.json`.
- Requirement autonomy ceiling: `.sdlc/autonomy/requirements/AUT-REQ-ENTERPRISE-CONTROL-PLANE-001-R2-R2.json`.
- Story: `.sdlc/stories/ST-ENT-FOUNDATION/story.json`.
- Contract and approval: `.sdlc/contracts/contract-ST-ENT-FOUNDATION-implementation.json`.
- Capability boundary: `.sdlc/capability-discovery/profiles/CAP-PROFILE-ST-ENT-FOUNDATION.json` and `.sdlc/capability-discovery/recommendations/CAP-REC-ST-ENT-FOUNDATION.json`.
- Delivery profile: `.sdlc/autonomy/deliveries/AUT-PR-ENT-FOUNDATION.json`.
- Task-start receipt: `.sdlc/autonomy/executions/AUT-PR-ENT-FOUNDATION/start.json`.
- Trace: `.sdlc/traces/ST-ENT-FOUNDATION.jsonl`.
- Commit evidence: `.sdlc/stories/ST-ENT-FOUNDATION/evidence/commit-001.txt` through `commit-004.txt`.
- Output registry entry: created by linking this document as `implementation-evidence` with template `implementation-evidence-v1` in mode `new`.
