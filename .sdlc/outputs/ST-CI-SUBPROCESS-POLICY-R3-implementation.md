# CI subprocess policy implementation evidence

Story: `ST-CI-SUBPROCESS-POLICY-R3`

Outcome: passed.

The CI correctness matrix now sets `AGENTIC_SDLC_TEST_CONCURRENCY=1` only for
`macos-latest` with Node `18.20.3`. The other eleven operating-system and
Node-version cells use concurrency `2`.

The correction does not increase subprocess timeouts, skip or weaken tests,
change runtime behavior, change the release workflow, or change package version
`0.13.5`.

Local validation completed on the branch:

- recursive syntax check: 197 JavaScript files passed;
- workflow contract regression: 10/10 passed;
- full Node 24.15.0 suite: 1251 tests, 1249 passed, 0 failed, 2 skipped;
- `git diff --check`: passed.

The machine-readable evidence, including file hashes and test duration, is
recorded in
`.sdlc/tests/ST-CI-SUBPROCESS-POLICY-R3-implementation.json`.

Remote acceptance remains pending until both the pull-request SHA and the final
`origin/main` SHA pass all twelve CI matrix cells.
