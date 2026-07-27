# Remediation report: `valerio_fixes`

## Scope

This remediation was prepared from the updated `main` commit
`87ddf9d2d1261804f0b92960ae91311ed97d90cd`. It addresses the correctness,
portability, validation, and maintenance issues found during a fresh review of
the plugin.

Historical personal-data duplication in `.sdlc` was intentionally left
unchanged. Existing approvals, receipts, and identities were not rewritten or
fabricated.

## Fixes

### Deterministic Git content and SDLC integrity

- Added repository-wide Git attributes for LF-normalized text and explicitly
  binary artifact types.
- Added a nested `.sdlc/.gitattributes`, and made `agentic-sdlc init` create it
  for every new project.
- Added the new file to the exact, governed initialization mutation set.
- Migrated this repository's legacy `.sdlc/config.json` through the official
  plan-hash workflow, creating a matching effective-config lock and migration
  receipt.

This prevents `core.autocrlf` from changing trace, checkpoint, approval, and
evidence bytes after checkout on Windows.

### Sandbox-safe path protection

- Extracted project path inspection into `lib/project-path-safety.mjs`.
- Symlink checks now start at the trusted project boundary instead of scanning
  from the Windows volume root.
- The boundary itself and every existing descendant are still checked without
  following links, and paths outside the boundary fail closed.

This preserves the security property while allowing commands to run in managed
sandboxes that expose only a nested workspace.

### JSON Schema correctness

- Implemented the `propertyNames` keyword used by the shipped configuration
  and execution-budget schemas.
- Replaced permissive `Date.parse` checks with strict calendar, clock, leap
  year, and timezone-offset validation.

Invalid metric names and impossible timestamps such as February 31 are now
rejected deterministically.

### Windows RTK execution

- Bare command names backed by Windows command shims (`npm`, `pnpm`, `yarn`,
  `jest`, and `vitest`) are resolved to `.cmd` before shell-free execution.
- Explicit executable suffixes remain unchanged.
- RTK and native fallback routes now use the same resolved command.

### Complete source syntax coverage

- Replaced the manually maintained `node --check` chain with recursive source
  discovery across `bin`, `lib`, `scripts`, and `ui`.
- The check now covers all JavaScript module variants and newly added files,
  including modules that the previous list omitted.

### Supported runtime policy

- Raised the supported runtime floor to Node.js 22.
- Updated CI and release verification to Node.js 22 and 24.
- Updated doctor output, benchmark guards, documentation, and workflow
  regression tests to match the policy.

Node.js 18 and 20 are no longer used as supported release targets.

## Regression coverage

New or extended tests cover:

- project-boundary inspection without access to volume-root parents;
- rejection of boundary escapes and symlink descendants;
- `propertyNames`, real leap days, impossible dates, clock fields, and offsets;
- automatic and explicit Windows command-shim routing;
- recursive syntax-check discovery;
- creation of `.sdlc/.gitattributes` during governed initialization;
- the Node 22/24 CI and release matrices.

Validation was run with Node.js 24.14.0. Targeted unit, Windows initialization,
observability, configuration-migration, release-workflow, schema, packaging,
and installed-plugin scenarios passed. The complete suite was also attempted;
remaining local failures were confined to tests that require Windows symlink
privileges unavailable in the managed sandbox and to process-resource
exhaustion under the suite's default high concurrency. The affected functional
paths were rerun serially where applicable.

## Operational note

The committed attributes take effect when the branch is checked out or cloned.
That clean checkout is the authoritative verification for historical `.sdlc`
hashes; no historical approval or evidence record should be edited merely to
make a gate pass.

A clean-clone verification confirmed zero CRLF bytes in the affected trace and
evidence files and removed every EOL-related checkpoint, truncation, rolling
hash, and evidence-drift error. The historical `ST-ENT-RELEASE-R1` gate still
reports 15 pre-existing delivery action receipts that cannot prove their
original Git commit boundary. Those immutable receipts were not rewritten or
re-created, because doing so would fabricate historical delivery evidence.
