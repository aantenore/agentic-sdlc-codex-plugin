# ST-PRODUCT-JOURNEY-001 Plan

## Objective

Turn Agentic SDLC from an expert-operated governance engine into a complete, plain-language project assessment product while preserving strict, scoped governance.

## Scope

- In scope: assessment journey, approval semantics, canonical formats, verification, onboarding context, installed-plugin behavior, tests, packaging, CI, and release readiness.
- Out of scope: production deployment, secrets, external systems, destructive operations, unrelated repositories, and public tag publication.

## Assignment

- Claim: released after implementation completion.
- Agent or owner: Codex, requested by Antonio.
- Branch: `codex/ST-PRODUCT-JOURNEY-001`.
- Dependencies: approved current baseline, approved implementation contract, approved output template, and scoped delegated authorizations.

## Implementation Approach

1. Audit the original user journey as a product, not only as an SDLC mechanism.
2. Implement a dedicated two-checkpoint assessment journey and reusable preset.
3. Make output delivery and delegated authority deterministic, persistent, and gate-validated.
4. Add realistic artifact, installation, packaging, and cross-platform release checks.
5. Exercise the installed plugin with the original natural-language scenario and close all strict gates.

## Sync And Handoff

- Sync events to record: commit and push after the strict gate passes.
- Handoff target: repository `main` after feature-branch verification.
- Handoff artifacts: implementation summary and `TEST-0.5.0-product-journey` evidence.
- Open items: none for the bounded local assessment product.

## Validation

- `npm test` with all 80 scenarios passing.
- `npm run check` and `npm run doctor -- --json`.
- Plugin manifest and both skill validators.
- Package dry run, clean plugin reinstall, installed doctor, and source/install hash match.
- Real DOCX/XLSX generation, render inspection, output linking, and strict gates.
- Real Italian Codex checkpoint interaction.
- Story-scoped strict gate with no errors or warnings.

## Open Questions

- None.
