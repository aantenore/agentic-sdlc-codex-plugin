# ST-PORTABLE-WORKFLOW-HARDENING Plan

## Objective

Make the reviewed portability hardening safe on Windows, macOS, and Linux without dropping Node.js 18.18, 20, or 24 support.

## Scope

- In scope:
  - shell-free Windows command-shim routing and fail-closed unsupported forms;
  - RFC3339, calendar, and `propertyNames` validation;
  - trusted project-root checks across platform path aliases;
  - deterministic recursive syntax discovery and line-ending policy;
  - capability-specific Windows symlink and junction coverage;
  - full local validation, PR CI, and merge to `main`.
- Out of scope:
  - installing or upgrading RTK, Caveman, Node.js, or other software;
  - publishing an npm or plugin release;
  - production deployment, secret changes, or external-service configuration;
  - changing unrelated capability profiles or reusing this PR's autonomy profile.

## Assignment

- Claim: active until delivery closes.
- Agent or owner: `codex`.
- Branch: `codex/ST-PORTABLE-WORKFLOW-HARDENING`.
- Dependencies: approved requirement, contract, exact PR delivery profile, and synchronized `main`.

## Implementation Approach

1. Reproduce each portability issue through focused regression tests.
2. Add the smallest platform-neutral production boundary that fails closed.
3. Preserve existing `main` changes and supported runtime declarations.
4. Run focused, package, full-suite, doctor, benchmark, and security checks.
5. Link human-readable delta evidence, pass the strict gate, and use exact action receipts for commits, push, PR, and merge.

## Sync And Handoff

- Sync events to record: every `main` fast-forward before evidence freeze and the final remote delivery.
- Handoff target: GitHub pull request into `main`.
- Handoff artifacts: implementation evidence, machine-readable test evidence, gate report, CI checks, and action receipts.
- Open items: remote operating-system and Node.js matrix must pass before merge.

## Validation

- `npm test -- --test-concurrency=2`
- `python3 test/installer-transaction.test.py`
- `npm run check`
- `node --test test/release-package-verifier.e2e.mjs`
- `npm pack --dry-run --json`
- `npm run doctor`
- `npm run smoke`
- `npm run benchmark:enterprise`
- `git diff --check`
- changed-tree credential signature scan and GitHub secret-scanning status
- independent post-sync review with no blocker, P1, or P2 issue
- strict story gate and complete GitHub CI matrix

## Open Questions

- None.
