# Change delivery evidence

## What was asked?

Harden the plugin changes identified during the portability review, preserve supported runtimes, test the complete result, publish it through an exact pull request, and merge it into `main` only after the checks pass.

The canonical request is [REQ-ENTERPRISE-CONTROL-PLANE-001-R2](../../../requirements/REQ-ENTERPRISE-CONTROL-PLANE-001-R2.json), delivered by story `ST-PORTABLE-WORKFLOW-HARDENING`.

## Scope and non-goals

This delta adds:

- safe Windows handling for executable files and command shims;
- stricter, calendar-aware JSON Schema date and date-time validation;
- trusted project-root checks that remain portable across macOS path aliases;
- recursive syntax discovery instead of a hand-maintained source list;
- line-ending rules for Git checkouts and newly initialized `.sdlc` folders;
- narrower Windows symlink skips, including directory-junction coverage;
- deterministic user fixtures and project-root subprocess behavior;
- regression tests for every changed boundary.

The existing `0.13.0` Caveman and Codex-session metering changes from `main` are preserved. This story does not install software, publish a package release, deploy to production, change secrets, or grant reusable authority to another pull request.

## Inputs

- Requirement: `.sdlc/requirements/REQ-ENTERPRISE-CONTROL-PLANE-001-R2.json`.
- Story: `.sdlc/stories/ST-PORTABLE-WORKFLOW-HARDENING/story.json`.
- Approved contract: `.sdlc/contracts/contract-ST-PORTABLE-WORKFLOW-HARDENING-implementation-v2.json`.
- Delivery profile: `.sdlc/autonomy/deliveries/AUT-PR-PORTABLE-WORKFLOW-HARDENING-002.json`.
- Task-start receipt: `.sdlc/stories/ST-PORTABLE-WORKFLOW-HARDENING/task-start.json`.
- Base implementation evidence: `.sdlc/stories/ST-ENT-FOUNDATION/outputs/implementation-evidence.md`.
- Full-suite validation base: `b7ff4540d60751f74ff041a37b32e0da1fa9b7b2`.
- Final synchronized base: `2d9ade8e597035343fef5bb2ce5ce1162a30f731`; its non-overlapping Caveman CRLF normalization has separate targeted evidence.
- Independent code-review findings and the repository's existing CI, package, doctor, benchmark, and security checks.

## What changed?

### Windows command execution

- `lib/rtk-optimization-adapter.mjs` now treats `.exe` and `.com` as directly executable and converts only recognized npm, pnpm, yarn, Jest, and Vitest `.cmd` or `.bat` shims into verified `node <launcher.js>` vectors.
- PATH lookup is directory-major, accepts only safe executable suffixes, rejects implicit current-directory lookup, and bounds shim inspection.
- Opaque, commented, reassigned, or unsupported shell shims fail closed. Commands such as `git.cmd`, `rg.bat`, `node.cmd`, `pytest.bat`, and `bun.cmd` are not passed to shell-free spawning as if they were native executables.
- CLI optimization now runs both optimized and native fallback commands from the requested project root.

### Validation and filesystem boundaries

- `lib/json-schema-validator.mjs` implements `propertyNames`, validates real Gregorian calendar dates, accepts lowercase RFC3339 `t` and `z`, and limits leap seconds to valid UTC transition instants.
- `lib/project-path-safety.mjs` centralizes trusted-boundary validation for explicit roots and mutation primitives. It rejects escapes and linked descendants without traversing unrelated volume parents.
- The macOS `/var` and `/private/var` aliases are compared by their canonical trusted boundary so valid temporary projects are not rejected.

### Portable source and test behavior

- `scripts/check-source-syntax.mjs` deterministically discovers every JavaScript source under `bin`, `lib`, `scripts`, and `ui`; `npm run check` no longer depends on a manually curated list.
- Root and `.sdlc` `.gitattributes` files enforce LF for source and executable text while marking binary assets explicitly.
- Windows symlink tests probe only the capability each assertion needs. Directory-root checks use junctions where that is the standard Windows-compatible form.
- End-to-end Windows command routing creates a real `.cmd` shim and verifies both the optimized and native fallback child working directories.
- UI date rendering uses an explicit stable locale, and user identity fixtures no longer depend on the machine account.

## Why was it decided?

Windows batch files are shell scripts, not native executables. Passing them directly to `spawn(..., { shell: false })` is unreliable and can hide shell behavior. The accepted design recognizes a small, reviewed set of Node-generated shims and converts them into an explicit executable plus arguments; every other batch form is rejected. Invoking a general shell was rejected because it would broaden quoting, injection, and portability risks.

Filesystem validation starts at the trusted project boundary rather than walking volume parents. This keeps the security property relevant to the project while avoiding false failures caused by operating-system aliases outside that boundary.

Syntax validation is derived from the source tree because a manual list silently stops checking newly added modules. Test skips are capability-specific because a machine that lacks file symlinks may still support junctions or another symlink form.

No runtime dependency was added, and the package still declares Node.js `>=18.18`.

## Outputs

- Hardened CLI, RTK adapter, JSON Schema validator, project path-safety module, and stable UI rendering.
- Recursive source syntax checker and line-ending policies.
- Cross-platform unit and end-to-end regression coverage.
- Canonical test evidence at `.sdlc/tests/ST-PORTABLE-WORKFLOW-HARDENING-final.json`.
- Story trace, output registry link, gate report, and exact delivery-action receipts generated by the governed workflow.

## Verification

### Windows command shims use a supported shell-free path

Outcome: passed locally; remote matrix pending before merge.

- Unit tests cover executable suffix normalization, real and opaque shims, dynamic npm prefixes, safe PATHEXT ordering, bounded parsing, and unsupported adapters.
- The CLI end-to-end test creates a real `jest.cmd` plus JavaScript launcher and verifies optimized and fallback execution from the project root.

### RFC3339 and calendar validation is correct

Outcome: passed.

- Tests cover Gregorian leap years, impossible dates and clock fields, lowercase separators, offset normalization, and valid versus misplaced leap seconds.

### Windows tests skip only unavailable capabilities

Outcome: passed.

- File, directory, and junction probes are independent.
- Manifest, portfolio, server, delivery-provider, mutation-guard, and release-tar tests retain non-symlink assertions even when one Windows capability is unavailable.

### Supported runtimes and operating systems remain covered

Outcome: configured; remote execution required before merge.

- `.github/workflows/ci.yml` retains Ubuntu, macOS, and Windows across Node.js 18.18.0, 20, and 24.
- The local package still declares Node.js `>=18.18`; no unsupported API or dependency was introduced.

### Complete validation bundle

Outcome: passed locally.

- `npm test -- --test-concurrency=2`: 1,019 passed, 0 failed, 1 Windows-only skip on macOS.
- `python3 test/installer-transaction.test.py`: 28 passed.
- `npm run check`: 81 JavaScript sources validated.
- Real offline package installation and installed-bin smoke test: passed.
- `npm pack --dry-run --json`: version `0.13.0`, 224 packaged entries.
- `npm run doctor` and `npm run smoke`: passed.
- Enterprise benchmark: passed within enforced query, warm-response, and memory budgets.
- `git diff --check`: passed.
- GitHub secret-scanning API: no open alerts before publication; changed-tree credential signatures: no matches.
- Independent post-sync review: no remaining blocker, P1, or P2 issue.
- Final `main` synchronization: 2 Caveman/CRLF tests, recursive syntax validation, and diff hygiene passed; the upstream files do not overlap this story's patch.

Exact machine-readable results are in `.sdlc/tests/ST-PORTABLE-WORKFLOW-HARDENING-final.json` and `.sdlc/tests/ST-PORTABLE-WORKFLOW-HARDENING-main-sync-2d9ade8.json`. The GitHub matrix result is intentionally not claimed until the pull request runs.

## Generated explanation

In practical terms, the plugin now handles Windows command wrappers deliberately instead of hoping the operating system will execute them like normal programs. It also validates dates and project paths more accurately, checks every source file automatically, and skips only the individual Windows checks a machine truly cannot perform. The changes do not weaken older supported Node.js versions or reuse this pull request's authority elsewhere.

This explanation is an inference generated by Codex from the approved requirement and contract, the implemented delta, the final local test evidence, and the independent review.

## Lineage

- Requirement: `.sdlc/requirements/REQ-ENTERPRISE-CONTROL-PLANE-001-R2.json`.
- Story: `.sdlc/stories/ST-PORTABLE-WORKFLOW-HARDENING/story.json`.
- Contract and approval: `.sdlc/contracts/contract-ST-PORTABLE-WORKFLOW-HARDENING-implementation-v2.json`.
- Exact delivery profile: `.sdlc/autonomy/deliveries/AUT-PR-PORTABLE-WORKFLOW-HARDENING-002.json`.
- Task start: `.sdlc/stories/ST-PORTABLE-WORKFLOW-HARDENING/task-start.json`.
- Test evidence: `.sdlc/tests/ST-PORTABLE-WORKFLOW-HARDENING-final.json`.
- Final base-sync evidence: `.sdlc/tests/ST-PORTABLE-WORKFLOW-HARDENING-main-sync-2d9ade8.json`.
- Trace: `.sdlc/traces/ST-PORTABLE-WORKFLOW-HARDENING.jsonl`.
- Output registry entry: created by linking this file as `implementation-evidence` with template `implementation-evidence-v1`, mode `delta`, and the enterprise-foundation evidence as its base.
- Commits, push, pull request, CI, and merge: bound to their exact subjects by append-only delivery-action receipts.
