# BASELINE-LOCAL-RUNTIME-HARDENING-R2 Current State

Status: approved
Kind: existing-project

## Summary
Post-validation delivery baseline: exact 0.13.5 code identity and supported-runtime workflow at commit 512b5ec, immutable local qualification evidence, and official installer mechanism; subsequent work may add governance/report records but must not change these sources without repeating affected validation.

## Product Signal
Codex plugin for contract-driven delivery, verified assessments, and visual project lineage.

## Architecture And Component Signals
- Source root: lib
- Source root: bin
- docs/architecture.md: Architecture > Core Design Choices > Local Observability And Integrity Boundary > Command-Scoped Canonical Queries > Existing Project Baseline > Assessment Control Plane > Configurable Workflow Plane > Autonomy Control Plane > Intent Routing Layer > Contract Model > Approval Governance > Capability Discovery Layer
- docs/agent-interactions.md: Assessment Interactions > Activation > Exactly Two Normal Checkpoints > Contract For Every Question > Checkpoint 1 — Project Context > Required question > Prepare The Immutable Proposal > Checkpoint 2 — Combined Proposal And Complete Tranche > Budget in the same checkpoint > Required question > Internal Command Choreography > Requirement And Story Lineage
- docs/codeburn-metering.md: CodeBurn advisory metering adapter > What each input means > Shell-free command configuration > Start snapshot > Current snapshot and delta > Persisted evidence > Limitations and enforcement boundary > Library API
- docs/getting-started.md: Getting Started > Choose A Starting Request > Conversation And Control Have Different Jobs > The Delivery Journey > Declare paths before work starts > Walk Through One Complete First Project > What You Approve > Autonomy Is Explained Before You Choose > New Requirement And New Pull Request > Continue An Existing Pull Request > Local-Only Result Or Release > When the local destination does not exist yet
- docs/how-it-works.md: How Agentic SDLC 0.13.5 Works > One End-To-End Governed Delivery > 1. The Mental Model > 2. Canonical State Versus Derived State > 3. The Two-Checkpoint Assessment > Checkpoint 1: confirm project context > Checkpoint 2: approve one complete tranche > 4. Requirement Limits And A Fresh Choice For Every Delivery > Optional technical mapping > 5. Exact Authorization: Action × Subject > Delivery actions are authorized, executed, then completed > 6. Execution, Verification, Recovery, and Release

## Detected Stack
- node: package-json (package.json)
- automation: npm-scripts (package.json)

## Key Files
- .github/workflows/ci.yml (47ba198414b2d1decac1c435fd67d48af9651d70e00a9c9b77a193906e35ce75)
- .github/workflows/release.yml (ff56a639ec7b8ceb69fd8482eb6ea7b6a827ae63dbfff8e00669a2cf9ad7e575)
- package.json (277f57466b08bcdbab474a409f2c9d8cf04bd5a5011a5f6ca4441383967fcd6f)
- README.md (df8450244a1d0003a538b9769a83bc2e50b312fa5db59cebc281b7a0a2d6adbc)

## Imported Documents
- README.md: Agentic SDLC Codex Plugin; sections Agentic SDLC Codex Plugin > In plain English > Technical summary > Documentation Map > Quick Start > Required: run candidate_registration.command.argv with its exact environment, > then candidate_registration.verification.argv with its exact environment. > Default target example only; do not use it for a custom returned target: > Start a new Codex task > One complete first project > Know where work happens > Self-service CLI; evidence df8450244a1d0003a538b9769a83bc2e50b312fa5db59cebc281b7a0a2d6adbc
- docs/architecture.md: Architecture; sections Architecture > Core Design Choices > Local Observability And Integrity Boundary > Command-Scoped Canonical Queries > Existing Project Baseline > Assessment Control Plane > Configurable Workflow Plane > Autonomy Control Plane > Intent Routing Layer > Contract Model > Approval Governance > Capability Discovery Layer; evidence a4f6b18efc2d8844277d2ceeece78098fdfc9104ac291ca78619f031e4bf7a7b
- docs/product-assessment.md: Product Assessment: Guided Project Assessment Journey; sections Product Assessment: Guided Project Assessment Journey > Executive Verdict > Before The Change > Target After The Complete Change Set > Assessment Scope > Product Strengths Before The Change > Pre-Change Product Gaps > Target Product Behavior > Checkpoint 1: Project Context > Checkpoint 2: Combined Work Proposal > Execution And Delivery > Format Product Contract; evidence 0afac961db4dbc23a98b5c826e83959d6d2c1906192744be4fa5c57026318b99
- docs/agent-interactions.md: Assessment Interactions; sections Assessment Interactions > Activation > Exactly Two Normal Checkpoints > Contract For Every Question > Checkpoint 1 — Project Context > Required question > Prepare The Immutable Proposal > Checkpoint 2 — Combined Proposal And Complete Tranche > Budget in the same checkpoint > Required question > Internal Command Choreography > Requirement And Story Lineage; evidence f85516f44ff9e3aa80828bd81b7bca2dd1d083e52974c99153c31d691495f4bb
- docs/change-observatory.md: Change Observatory; sections Change Observatory > Launch After Installation > Open An Explicit Project Portfolio > Operational Checks And Diagnostics > What It Shows > Proof-Bound Iteration Dossiers > Intent Evidence > Explainability Without Private Reasoning > Security And Privacy Boundary > Troubleshooting; evidence 683af3ee43fea25656d3c3f105be9734d6761ccba4d22d15fe41d60c6b736b20
- docs/codeburn-metering.md: CodeBurn advisory metering adapter; sections CodeBurn advisory metering adapter > What each input means > Shell-free command configuration > Start snapshot > Current snapshot and delta > Persisted evidence > Limitations and enforcement boundary > Library API; evidence 0e35c058467adb30350e707e78d6b2a2491ee6c10b9a1e6ad367c996c05198a9
- docs/codex-session-metering.md: Native Codex session metering; sections Native Codex session metering > What is measured > Use > Assurance and limits > Cross-platform boundary; evidence 23d331fc516b9fce9cf60826e3acf901f39d3d3e70972ac97524df1c12764636
- docs/configurable-workflows.md: Configurable workflows; sections Configurable workflows > Built-in processes > First custom phase: copy, edit, approve, start > Definitions, overlays, and running instances > Append-only history > Storage > Command journey > Local releases and pull requests; evidence 0c7223b572dc6e11412d5b8f0f9c6921bb9480c1d9e800d789f1d55bcf4b8bd2
- docs/configuration-safety.md: Configuration safety; sections Configuration safety > The short version > Review before applying > Adopt an exact manifestless v0.11 project > Change the autonomy rollout mode > Esempio in italiano > English example > Technical records; evidence c01877890599e20543c2c62355c6789cee44219dfb3dfde6907118707c574531
- docs/getting-started.md: Getting Started; sections Getting Started > Choose A Starting Request > Conversation And Control Have Different Jobs > The Delivery Journey > Declare paths before work starts > Walk Through One Complete First Project > What You Approve > Autonomy Is Explained Before You Choose > New Requirement And New Pull Request > Continue An Existing Pull Request > Local-Only Result Or Release > When the local destination does not exist yet; evidence 912f6fc23f17aa93158c10099cdb0b9c8a9defd3fffa9ed712ecc07f6d4d9ed8
- docs/how-it-works.md: How Agentic SDLC 0.13.5 Works; sections How Agentic SDLC 0.13.5 Works > One End-To-End Governed Delivery > 1. The Mental Model > 2. Canonical State Versus Derived State > 3. The Two-Checkpoint Assessment > Checkpoint 1: confirm project context > Checkpoint 2: approve one complete tranche > 4. Requirement Limits And A Fresh Choice For Every Delivery > Optional technical mapping > 5. Exact Authorization: Action × Subject > Delivery actions are authorized, executed, then completed > 6. Execution, Verification, Recovery, and Release; evidence 10d13d27510d91d39115318aaa9e6bf0b870d38b9d04bf3d4c4ee11ee86916d9
- docs/kb-structure.md: Knowledge Base Structure; sections Knowledge Base Structure > Source Of Truth > Observability Policy In `.sdlc/config.json` > `project.json` > `baseline/` > `assessments/` > `workflows/` > `receipts/` > `contracts/` > `capability-discovery/` > `work-items/`, `work-breakdown/`, And `dependencies/` > `output-contracts/`; evidence 4d9c7a2b449ec7f5f1872336bb7bae128d527bcd68b80f36d683a1bf3a7a2301

## Open Questions
- None

## Caveats
- This is inferred from repository files and imported documents.
- Historical authorship, prior approvals, and rationale are unknown unless present in evidence files.

## Approval Guidance
Approve this baseline only after the user confirms which inferred facts are canonical. Use bootstrap only for migration/provisional records.
