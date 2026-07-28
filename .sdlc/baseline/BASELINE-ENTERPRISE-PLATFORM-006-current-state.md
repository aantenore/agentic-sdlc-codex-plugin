# BASELINE-ENTERPRISE-PLATFORM-006 Current State

Status: approved
Kind: existing-project

## Summary
Refreshed the same agreed evidence set after the PR review fix: Windows commands now resolve to absolute PATH executables and transient test-fixture cleanup retries remain bounded.

## Product Signal
Codex plugin for contract-driven delivery, verified assessments, and visual project lineage.

## Architecture And Component Signals
- Source root: lib
- Source root: bin
- README.md: Agentic SDLC Codex Plugin > In plain English > Technical summary > Documentation Map > Quick Start > Start a new Codex task > Know where work happens > Self-service CLI > Change Observatory > How It Works > What The Two Checkpoints Mean > Autonomy Is Negotiated Per Requirement And Selected Per Delivery
- docs/architecture.md: Architecture > Core Design Choices > Local Observability And Integrity Boundary > Command-Scoped Canonical Queries > Existing Project Baseline > Assessment Control Plane > Configurable Workflow Plane > Autonomy Control Plane > Intent Routing Layer > Contract Model > Approval Governance > Capability Discovery Layer
- docs/agent-interactions.md: Assessment Interactions > Activation > Exactly Two Normal Checkpoints > Contract For Every Question > Checkpoint 1 — Project Context > Required question > Prepare The Immutable Proposal > Checkpoint 2 — Combined Proposal And Complete Tranche > Budget in the same checkpoint > Required question > Internal Command Choreography > Requirement And Story Lineage
- docs/codeburn-metering.md: CodeBurn advisory metering adapter > What each input means > Shell-free command configuration > Start snapshot > Current snapshot and delta > Persisted evidence > Limitations and enforcement boundary > Library API
- docs/how-it-works.md: How Agentic SDLC 0.13.0 Works > 1. The Mental Model > 2. Canonical State Versus Derived State > 3. The Two-Checkpoint Assessment > Checkpoint 1: confirm project context > Checkpoint 2: approve one complete tranche > 4. Requirement Limits And A Fresh Choice For Every Delivery > Optional technical mapping > 5. Exact Authorization: Action × Subject > Delivery actions are authorized, executed, then completed > 6. Execution, Verification, Recovery, and Release > Apply is exact and idempotent

## Detected Stack
- node: package-json (package.json)
- automation: npm-scripts (package.json)

## Key Files
- .github/workflows/ci.yml (6d07ecd049dd1646bbde89cd4c4269563e523a49b766b83a7125cb0cf6c62b91)
- .github/workflows/release.yml (d7364d820d631871e4b41bb4aa8826861a92986bdaa63e20fe7b6314561e3d4c)
- package.json (d4856e3ca478f9f7edba530a9a447672f5a82640bfdd9d6ac4b94b554ef7eee6)
- README.md (cad149906ca2938f6771f967f3e17b5051a3152b31f7158010d5c935ed825bc0)

## Imported Documents
- README.md: Agentic SDLC Codex Plugin; sections Agentic SDLC Codex Plugin > In plain English > Technical summary > Documentation Map > Quick Start > Start a new Codex task > Know where work happens > Self-service CLI > Change Observatory > How It Works > What The Two Checkpoints Mean > Autonomy Is Negotiated Per Requirement And Selected Per Delivery; evidence cad149906ca2938f6771f967f3e17b5051a3152b31f7158010d5c935ed825bc0
- docs/architecture.md: Architecture; sections Architecture > Core Design Choices > Local Observability And Integrity Boundary > Command-Scoped Canonical Queries > Existing Project Baseline > Assessment Control Plane > Configurable Workflow Plane > Autonomy Control Plane > Intent Routing Layer > Contract Model > Approval Governance > Capability Discovery Layer; evidence 460fa1f28a61bd51567c4325c406ae10f6b5866e2e04e97911673822c11484bf
- docs/product-assessment.md: Product Assessment: Guided Project Assessment Journey; sections Product Assessment: Guided Project Assessment Journey > Executive Verdict > Before The Change > Target After The Complete Change Set > Assessment Scope > Product Strengths Before The Change > Pre-Change Product Gaps > Target Product Behavior > Checkpoint 1: Project Context > Checkpoint 2: Combined Work Proposal > Execution And Delivery > Format Product Contract; evidence 0afac961db4dbc23a98b5c826e83959d6d2c1906192744be4fa5c57026318b99
- docs/agent-interactions.md: Assessment Interactions; sections Assessment Interactions > Activation > Exactly Two Normal Checkpoints > Contract For Every Question > Checkpoint 1 — Project Context > Required question > Prepare The Immutable Proposal > Checkpoint 2 — Combined Proposal And Complete Tranche > Budget in the same checkpoint > Required question > Internal Command Choreography > Requirement And Story Lineage; evidence 9e072f578a9acc51a0007bc64207bf005b9d91c9ad7cfda568323432ff012311
- docs/change-observatory.md: Change Observatory; sections Change Observatory > Launch After Installation > Open An Explicit Project Portfolio > Operational Checks And Diagnostics > What It Shows > Proof-Bound Iteration Dossiers > Intent Evidence > Explainability Without Private Reasoning > Security And Privacy Boundary > Troubleshooting; evidence 683af3ee43fea25656d3c3f105be9734d6761ccba4d22d15fe41d60c6b736b20
- docs/codeburn-metering.md: CodeBurn advisory metering adapter; sections CodeBurn advisory metering adapter > What each input means > Shell-free command configuration > Start snapshot > Current snapshot and delta > Persisted evidence > Limitations and enforcement boundary > Library API; evidence 0e35c058467adb30350e707e78d6b2a2491ee6c10b9a1e6ad367c996c05198a9
- docs/configurable-workflows.md: Configurable workflows; sections Configurable workflows > Built-in processes > Definitions, overlays, and running instances > Append-only history > Storage > Command journey > Local releases and pull requests; evidence 49bc812e8acfe8bcde4658cae1899224f4c9e22ac2eafbb277a5a1940879fcce
- docs/configuration-safety.md: Configuration safety; sections Configuration safety > The short version > Review before applying > Esempio in italiano > English example > Technical records; evidence c7c9a66dcd10eea95ef6bbe2addecb32eaafe6894ad0d56a835295fe5c13d2d5
- docs/how-it-works.md: How Agentic SDLC 0.13.0 Works; sections How Agentic SDLC 0.13.0 Works > 1. The Mental Model > 2. Canonical State Versus Derived State > 3. The Two-Checkpoint Assessment > Checkpoint 1: confirm project context > Checkpoint 2: approve one complete tranche > 4. Requirement Limits And A Fresh Choice For Every Delivery > Optional technical mapping > 5. Exact Authorization: Action × Subject > Delivery actions are authorized, executed, then completed > 6. Execution, Verification, Recovery, and Release > Apply is exact and idempotent; evidence b1e400cf60699064bfe558947b705e41d474d5e60b0d4f21a8b7d37c8108811e
- docs/kb-structure.md: Knowledge Base Structure; sections Knowledge Base Structure > Source Of Truth > Observability Policy In `.sdlc/config.json` > `project.json` > `baseline/` > `assessments/` > `workflows/` > `receipts/` > `contracts/` > `capability-discovery/` > `work-items/`, `work-breakdown/`, And `dependencies/` > `output-contracts/`; evidence 67531e7157eb45f2b90a9214c74cdef64e5a424650f4a0a814c4de47371c04c5
- docs/limits-and-metering.md: Limits, autonomy, and metering; sections Limits, autonomy, and metering > What “blank cheque” means here > Exact action × subject permissions > Delivery action receipts do not execute actions > Delegated authorization example > Budget model > Common and custom metrics > Complete budget input example > Warnings, soft limits, hard limits, and reserve > Exact, estimated, and unavailable > Why Ed25519 attestation is required > Trusted source configuration; evidence 410b3694e362c9de6a6cc2ba4542cf1852d57f4b59455ebdcd4e40f6cc397033
- docs/portable-install.md: Portable Codex Install; sections Portable Codex Install > Package Surface > Prerequisites > Install > What The Installer Changes > Update > Uninstall > Doctor > Maintainer Validators > Installed-Journey Smoke Check > Portability Boundaries; evidence 684b39575584a10b7d97a8ea8aced8b77b139e5f145514415b431799a5ceb152

## Open Questions
- None

## Caveats
- This is inferred from repository files and imported documents.
- Historical authorship, prior approvals, and rationale are unknown unless present in evidence files.

## Approval Guidance
Approve this baseline only after the user confirms which inferred facts are canonical. Use bootstrap only for migration/provisional records.
