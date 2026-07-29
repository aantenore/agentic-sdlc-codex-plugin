# Local runtime hardening implementation evidence

## What was asked?

Complete the local-software-project hardening of Agentic SDLC, fix every
observed blocker, publish the verified result to `origin/main`, and replace
the official local installation only after source, CI, and project replays
are green. The canonical scope is
`REQ-ENTERPRISE-CONTROL-PLANE-001-R4`, story
`ST-LOCAL-RUNTIME-HARDENING-R1`, and the active user goal recorded by the
Codex task.

## Scope and non-goals

This implementation phase covers the shared Node runtime policy, CLI
bootstrap and doctor behavior, benchmark entry points, first-user help,
CI/release matrices, packaging, and regression tests. It also repairs a test
fixture that changed the metadata of the host Node executable.

The pre-existing working diff is an explicit input captured by
`BASELINE-LOCAL-RUNTIME-HARDENING-R1`; this record does not claim that work
retroactively. Post-start review, corrections, tests, and evidence are
governed by the R4 contract. Cloud, production, application secrets, remote
deployment, force-push, and unrelated branch integration remain excluded.
Final PR merge, installed-plugin replacement, and four-project replay are
release/validation work and are not claimed complete by this implementation
artifact.

## Inputs

- Requirement:
  `.sdlc/requirements/REQ-ENTERPRISE-CONTROL-PLANE-001-R4.json`
- Contract:
  `.sdlc/contracts/contract-ST-LOCAL-RUNTIME-HARDENING-R1-implementation.json`
- Baseline:
  `.sdlc/baseline/BASELINE-LOCAL-RUNTIME-HARDENING-R1.json`
- Delivery profile:
  `.sdlc/autonomy/deliveries/AUT-PR-LOCAL-RUNTIME-HARDENING-R1.json`
- Upstream diagnosis: Node.js shutdown livelock reproduced on 18.18.0 and
  absent on 18.20.3; upstream fix floors are 18.20.3, 20.12.0, and 21.6.0.
- Frozen pre-commit worktree content hash:
  `12e3811ffcadcc62a663603fc31f07f8615c83876871b427af7274e1eb386501`

## What changed?

- Added `lib/runtime-support.mjs` as the single runtime policy used by CLI,
  doctor, and both benchmark entry points.
- Raised the package engine contract to
  `^18.20.3 || ^20.12.0 || >=21.6.0` and aligned README, install
  documentation, CI, and release workflows.
- Made unsupported runtimes fail before parsing or dispatch, including
  benchmark worker modes, while preserving raw Italian locale and JSON
  errors without consulting an unsafe project configuration.
- Made doctor verify the exact package engine range as part of version
  consistency.
- Completed `requirement supersede` focused help with required,
  conditional, and runnable inputs for human, CI, agent, system,
  automation, and bootstrap configurations.
- Replaced the native-provider test hard-link with a clone-capable copy so
  tests never change the host Node executable link count, mode, or ctime.
- Added regression coverage for every corrected behavior and expanded the
  compatibility matrix to Node 18.20.3, 20.12.0, 21.6.0, and 24.

## Why was it decided?

The minimum versions follow the first upstream-fixed releases rather than
masking the native shutdown defect with forced process termination. A shared
policy prevents drift between metadata and executable entry points. Runtime
errors use only static text plus the trusted runtime version, so reading
project privacy configuration before reporting them adds risk without
benefit. Test fixtures copy executable bytes because creating a hard link
itself mutates the source inode metadata and makes parallel compatibility
runs interfere.

Rejected alternatives were a watchdog or `process.exit()`, retaining the
unsafe 18.18 floor, testing only latest Node, or weakening stable-digest
checks. Those approaches would hide failures or reduce governance.

## Outputs

- Version `0.13.5`.
- Candidate distributed fingerprint:
  `46bb81ecee4daa9909a3b56cf531eb2d1dd74ea5691d6e994f6274c3b12a8f4e`.
- Runtime policy, CLI/doctor/benchmark integration, complete help, workflow
  matrices, documentation, and regression tests in the approved write
  scope.
- Local validation record:
  `.sdlc/tests/ST-LOCAL-RUNTIME-HARDENING-R1-precommit.json`.

## Verification

- Node 18.20.3: 1,250 tests; 1,247 passed; 0 failed; 3 skipped.
- Node 20.12.0: 1,250 tests; 1,247 passed; 0 failed; 3 skipped.
- Node 21.6.0: 1,250 tests; 1,247 passed; 0 failed; 3 skipped.
- Node 24.15.0: 1,250 tests; 1,248 passed; 0 failed; 2 skipped.
- Syntax check: 197 JavaScript source files passed.
- Doctor: passed, including runtime and engine/version consistency.
- Enterprise benchmark: passed; canonical query 496.229 ms, warm p95
  12.173 ms, maximum observed RSS 225,771,520 bytes.
- Package: 241 allowlisted entries, no `__pycache__`, `.pyc`, or `.pyo`;
  archive SHA-256
  `bb2731192866ac82064ddc231faee4351264d667c401dfdccf81ef9c3f652e52`.
- Distributed-package verifier and both read-only installer plans: passed.
- `git diff --check`: passed.
- All qualifying runs preserved the exact frozen worktree content hash and
  left no residual test workers.

Remote CI, four fresh project replays, merge, final official installation,
installed-only smoke, and final identity parity remain deliberately pending
at this phase boundary.

## Generated explanation

Agentic SDLC now refuses Node versions known to hang during shutdown, tells a
new user exactly how to recover, tests every promised runtime floor, and no
longer lets its own test fixtures alter the machine's Node installation.
This is inferred from the shared policy, regression suite, four-runtime
matrix, package verifier, and benchmark evidence listed above.

## Lineage

- Requirement: `REQ-ENTERPRISE-CONTROL-PLANE-001-R4`
- Story: `ST-LOCAL-RUNTIME-HARDENING-R1`
- Contract:
  `contract-ST-LOCAL-RUNTIME-HARDENING-R1-implementation`
- Requirement profile:
  `AUT-REQ-ENTERPRISE-CONTROL-PLANE-001-R4-R4`
- Delivery profile: `AUT-PR-LOCAL-RUNTIME-HARDENING-R1`
- Workflow: `WF-ST-LOCAL-RUNTIME-HARDENING-R1`
- Task start:
  `.sdlc/stories/ST-LOCAL-RUNTIME-HARDENING-R1/task-start.json`
- Final commit, PR, merge, release receipts, and installed identity will be
  added by the later validation and release phases.
