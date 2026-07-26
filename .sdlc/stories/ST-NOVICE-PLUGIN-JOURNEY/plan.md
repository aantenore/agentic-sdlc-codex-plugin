# ST-NOVICE-PLUGIN-JOURNEY Plan

## Objective

Make the plugin understandable and usable for a first-time Codex user who wants
to agree one requirement and deliver it as a new PR, an existing PR update, or a
verified local-only result.

## Scope

- In scope: conversational first-use guidance, deterministic lifecycle routing,
  active-scope approvals, CLI recovery help, starter prompts, documentation,
  black-box novice tests, package verification, and the governed PR to `main`.
- Out of scope: installs, secrets, production, external services, remote
  deployment, destructive work, and unrelated product behavior.

## Assignment

- Claim: `.sdlc/stories/ST-NOVICE-PLUGIN-JOURNEY/claim.json`
- Agent or owner: `codex`
- Branch: `codex/ST-NOVICE-PLUGIN-JOURNEY`
- Dependencies: approved requirement
  `REQ-ENTERPRISE-CONTROL-PLANE-001-R2`, approved implementation contract
  `contract-ST-NOVICE-PLUGIN-JOURNEY-implementation-v2`, and delivery profile
  `AUT-PR-NOVICE-PLUGIN-JOURNEY-002`.

## Implementation Approach

1. Reproduce the first-use journey in a clean temporary project.
2. Keep natural-language interpretation in Codex and deterministic validation in
   the CLI.
3. Enforce the order requirement → optional decomposition → output/work brief →
   per-delivery autonomy → one task start → implementation/test → destination.
4. Hide untouched bootstrap contracts and scope approval prompts to the active
   story, phase, and contract.
5. Make root and focused CLI help complete enough for recovery and automation.
6. Add novice-facing starters and a plain-language getting-started guide for new
   PR, existing PR, and local-only delivery.
7. Verify targeted behavior, the full suite, doctor, package contents,
   installable artifact, strict story gate, secret patterns, remote CI, and the
   merged `main`.

## Sync And Handoff

- Sync events to record: atomic commits, exact push, ready PR, protected merge,
  and post-merge verification.
- Handoff target: repository `github.com/aantenore/agentic-sdlc-codex-plugin`,
  base `main`.
- Handoff artifacts: implementation evidence, test output, package verification,
  action receipts, PR, and merge result.
- Open items: remote CI and post-merge verification remain until publication.

## Validation

- `npm run check`
- `npm test`
- `npm run doctor`
- novice lifecycle, metadata, and CLI help tests
- `npm pack --dry-run --json`
- `scripts/verify-release-package.mjs`
- exact secret-pattern and high-entropy classification of changed files
- strict story gate
- GitHub CI and post-merge `main` verification

## Open Questions

- None.
