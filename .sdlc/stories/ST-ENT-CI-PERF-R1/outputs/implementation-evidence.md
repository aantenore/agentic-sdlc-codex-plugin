# Stable, fail-closed enterprise performance gate

## Why this follow-up exists

The post-merge CI run for version 0.12.0 passed all 976 functional tests on Windows and Node 18, but one shared runner exceeded two absolute timing budgets. Re-running the same commit without code changes passed. This proves runner variability rather than a functional regression.

This follow-up has its own story and delivery record so it does not overwrite the already completed release history.

## Agreed behavior

- Correctness still runs on Ubuntu, macOS and Windows with Node 18.18, 20 and 24.
- `npm test` runs correctness only.
- `npm run benchmark:enterprise` keeps the existing enforcing thresholds.
- `npm run test:enterprise` remains the explicit combined local verification command.
- CI runs the benchmark exactly once, as a separate step inside the already required Ubuntu/Node 24 check. A failure therefore blocks this pull request without changing repository protection settings.
- Tagged-release verification applies the same canonical performance check before packaging.
- The workflow guard rejects mutable action references, `continue-on-error`, and a job-level condition that could silently skip the required check.

## Protected boundaries

No benchmark threshold, supported operating system, supported Node version, repository protection setting, package version, production system, credential, secret, Git tag, npm publication, or GitHub release is changed.

The autonomy choice belongs only to this pull request. It cannot be reused for a later pull request or local installation.

## Verification before commit

- Complete Node 24.15 suite: 978/978 passed.
- Focused workflow and benchmark tests: 56/56 passed on Node 18.18, Node 20.20 and Node 24.15.
- Enterprise benchmark passed with unchanged limits: canonical query 486.109 ms / 2,000 ms; warm Observatory p95 12.094 ms / 100 ms; RSS 266,092,544 / 268,435,456 bytes.
- `npm run check`, YAML parsing, `npm pack --dry-run`, and `git diff --check` passed.
- Independent review found and closed three fail-open risks before commit: a non-required sibling job, `continue-on-error`, and a skipped required job.

## Delivery evidence

Commit, pull-request, CI, GitGuardian, merge, post-merge CI, and local-install evidence are recorded after each protected operation succeeds.

The immutable local verification record is `.sdlc/tests/ST-ENT-CI-PERF-R1-local.json`. Its final pre-commit run confirms 978/978 complete Node 24 tests, 56/56 focused workflow tests, unchanged benchmark limits, static checks, package dry run, YAML parsing, and a clean diff check.
