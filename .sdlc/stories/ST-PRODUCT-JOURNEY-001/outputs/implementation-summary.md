# Agentic SDLC 0.5.0 Product Journey

## Outcome

Agentic SDLC is now a complete bounded project-assessment product rather than an SDLC engine that exposes its internal records to the user. A natural request can contextualize an existing repository, explain the inferred facts in plain language, agree one combined assessment proposal, execute autonomously inside that scope, and deliver a verified artifact in the requested real format.

## Product Corrections

- Added a dedicated project-assessment skill and reusable semantic assessment preset.
- Limited the normal local journey to two understandable checkpoints: project context, then one combined work proposal.
- Made approval scope explicit and persistent. A short answer applies only to what was shown; broader autonomy is stored as scoped delegated authorization and later actions are recorded as automation.
- Added first-class `markdown`, `docx`, `xlsx`, `pdf`, `pptx`, `html`, `json`, and `csv` delivery metadata, including common Word and Excel aliases.
- Enforced extension, media type, generator, delivery mode, artifact freshness, and verification receipts when outputs are linked.
- Added structural verification for OOXML, PDF, JSON, HTML, CSV, and text artifacts, plus mandatory render evidence for visual formats.
- Made existing-project onboarding discover product, architecture, stack, source, test, and documentation evidence and summarize assumptions and unknowns.
- Fixed task-start freshness checks, same-agent claim resume, approval queue sequencing, source excerpts, and stale internal refresh behavior.
- Added a product-facing manifest, doctor command, clean-install workflow, multi-platform CI, and tagged-release packaging with checksums.

## Verification

- `npm test`: 80 of 80 tests passed.
- `npm run check`: passed.
- `npm run doctor -- --json`: passed with version `0.5.0` consistent across CLI, package, and manifest.
- Plugin manifest validation and both skill validators passed.
- `npm pack --dry-run --json`: passed; 65 reusable files, no project-only KB content in the package.
- The final installed plugin is enabled at `0.5.0`; its cached CLI hash matches the repository CLI and its doctor passes.
- A real Italian Codex request selected the installed core and assessment skills, inspected a fixture repository, ran its tests, explained product, users, stack, implementation, documented-versus-present architecture, assumptions, unknowns, and exact approval scope, then stopped at Checkpoint 1.
- Real DOCX and XLSX assessment artifacts were generated with format libraries, rendered and visually inspected, linked with OOXML verification receipts, and accepted by strict gates.

## Product Boundary

The autonomous happy path covers repository inspection, already-installed local tools, local checks, canonical bookkeeping, one agreed output, verification, and chat summary. New installations, external services, secrets, production access, destructive actions, deployment, and writes outside the displayed scope still require a separate explicit decision.

## Release Decision

The `0.5.0` implementation is ready for repository delivery. Public release publication remains a separate tag-driven action.
