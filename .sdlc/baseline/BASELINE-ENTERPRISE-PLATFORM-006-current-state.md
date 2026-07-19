# BASELINE-ENTERPRISE-PLATFORM-006 Current State

Status: approved
Kind: existing-project

## Summary
Agentic SDLC 0.11.0 current project state after governance PR #9 and the approved portfolio implementation scope are present in this worktree; the refreshed snapshot binds the exact current source, documentation, schema, UI and test evidence before portfolio delivery begins.

## Product Signal
Codex plugin for contract-driven delivery, verified assessments, and visual project lineage.

## Architecture And Component Signals
- Source root: lib
- Source root: bin
- README.md: Agentic SDLC Codex Plugin > Documentation Map > Quick Start > Self-service CLI > Change Observatory > How It Works > What The Two Checkpoints Mean > Autonomy Is Negotiated Per Requirement And Selected Per Delivery > CodeBurn Versus Exact Metering > RTK Context Optimization > Canonical Output Formats > Generation And Layered Verification Receipts
- docs/architecture.md: Architecture > Core Design Choices > Local Observability And Integrity Boundary > Command-Scoped Canonical Queries > Existing Project Baseline > Assessment Control Plane > Configurable Workflow Plane > Autonomy Control Plane > Intent Routing Layer > Contract Model > Approval Governance > Capability Discovery Layer
- docs/agent-interactions.md: Assessment Interactions > Activation > Exactly Two Normal Checkpoints > Contract For Every Question > Checkpoint 1 — Project Context > Required question > Prepare The Immutable Proposal > Checkpoint 2 — Combined Proposal And Complete Tranche > Budget in the same checkpoint > Required question > Internal Command Choreography > Requirement And Story Lineage
- docs/codeburn-metering.md: CodeBurn advisory metering adapter > What each input means > Shell-free command configuration > Start snapshot > Current snapshot and delta > Persisted evidence > Limitations and enforcement boundary > Library API
- docs/how-it-works.md: How Agentic SDLC 0.11.0 Works > 1. The Mental Model > 2. Canonical State Versus Derived State > 3. The Two-Checkpoint Assessment > Checkpoint 1: confirm project context > Checkpoint 2: approve one complete tranche > 4. Requirement Limits And A Fresh Choice For Every Delivery > Optional technical mapping > 5. Exact Authorization: Action × Subject > Delivery actions are authorized, executed, then completed > 6. Execution, Verification, Recovery, and Release > Apply is exact and idempotent

## Detected Stack
- node: package-json (package.json)
- automation: npm-scripts (package.json)

## Key Files
- .github/workflows/ci.yml (59da0395f1ea2f2444ff5916381d947b2f0825847d77b9e91cbe09f9e951f9d3)
- .github/workflows/release.yml (5cf40e57e2ff4ac2f6a36c9c4578e66a0224d8b62acd21ce506b4c7a1837cfb4)
- package.json (373951d0289aa2da6b3a10f4a35467cae805ae1ec00f92385ef2d5d2ff4d2a64)
- README.md (02acf5b1105dacd6877f1fb6ff6f55dfaec9c20aa2bec456fa5f14fb26c5e608)

## Imported Documents
- README.md: Agentic SDLC Codex Plugin; sections Agentic SDLC Codex Plugin > Documentation Map > Quick Start > Self-service CLI > Change Observatory > How It Works > What The Two Checkpoints Mean > Autonomy Is Negotiated Per Requirement And Selected Per Delivery > CodeBurn Versus Exact Metering > RTK Context Optimization > Canonical Output Formats > Generation And Layered Verification Receipts; evidence 02acf5b1105dacd6877f1fb6ff6f55dfaec9c20aa2bec456fa5f14fb26c5e608
- docs/architecture.md: Architecture; sections Architecture > Core Design Choices > Local Observability And Integrity Boundary > Command-Scoped Canonical Queries > Existing Project Baseline > Assessment Control Plane > Configurable Workflow Plane > Autonomy Control Plane > Intent Routing Layer > Contract Model > Approval Governance > Capability Discovery Layer; evidence 34dbe96e8e9606e0c9f73873fc55ff78f369fe327fc05a113cd9454f057b35ac
- docs/product-assessment.md: Product Assessment: Guided Project Assessment Journey; sections Product Assessment: Guided Project Assessment Journey > Executive Verdict > Before The Change > Target After The Complete Change Set > Assessment Scope > Product Strengths Before The Change > Pre-Change Product Gaps > Target Product Behavior > Checkpoint 1: Project Context > Checkpoint 2: Combined Work Proposal > Execution And Delivery > Format Product Contract; evidence 0afac961db4dbc23a98b5c826e83959d6d2c1906192744be4fa5c57026318b99
- docs/agent-interactions.md: Assessment Interactions; sections Assessment Interactions > Activation > Exactly Two Normal Checkpoints > Contract For Every Question > Checkpoint 1 — Project Context > Required question > Prepare The Immutable Proposal > Checkpoint 2 — Combined Proposal And Complete Tranche > Budget in the same checkpoint > Required question > Internal Command Choreography > Requirement And Story Lineage; evidence 9e072f578a9acc51a0007bc64207bf005b9d91c9ad7cfda568323432ff012311
- docs/change-observatory.md: Change Observatory; sections Change Observatory > Launch After Installation > Operational Checks And Diagnostics > What It Shows > Proof-Bound Iteration Dossiers > Intent Evidence > Explainability Without Private Reasoning > Security And Privacy Boundary > Troubleshooting; evidence 3415fdfdcf45c0573a3e8a5a0fba3810722fb29165afe97e630371bc2989938b
- docs/codeburn-metering.md: CodeBurn advisory metering adapter; sections CodeBurn advisory metering adapter > What each input means > Shell-free command configuration > Start snapshot > Current snapshot and delta > Persisted evidence > Limitations and enforcement boundary > Library API; evidence 91ab00cb901e59ae8f61913a6ac4f59efe528a122aad9950dbe151e6e5da02c4
- docs/configurable-workflows.md: Configurable workflows; sections Configurable workflows > Built-in processes > Definitions, overlays, and running instances > Append-only history > Storage > Command journey > Local releases and pull requests; evidence 49bc812e8acfe8bcde4658cae1899224f4c9e22ac2eafbb277a5a1940879fcce
- docs/configuration-safety.md: Configuration safety; sections Configuration safety > The short version > Review before applying > Esempio in italiano > English example > Technical records; evidence c7c9a66dcd10eea95ef6bbe2addecb32eaafe6894ad0d56a835295fe5c13d2d5
- docs/how-it-works.md: How Agentic SDLC 0.11.0 Works; sections How Agentic SDLC 0.11.0 Works > 1. The Mental Model > 2. Canonical State Versus Derived State > 3. The Two-Checkpoint Assessment > Checkpoint 1: confirm project context > Checkpoint 2: approve one complete tranche > 4. Requirement Limits And A Fresh Choice For Every Delivery > Optional technical mapping > 5. Exact Authorization: Action × Subject > Delivery actions are authorized, executed, then completed > 6. Execution, Verification, Recovery, and Release > Apply is exact and idempotent; evidence 139f3846021fe4ea983659fddc332eb75431c7894cb6f8c6c49f14838f875f84
- docs/kb-structure.md: Knowledge Base Structure; sections Knowledge Base Structure > Source Of Truth > Observability Policy In `.sdlc/config.json` > `project.json` > `baseline/` > `assessments/` > `workflows/` > `receipts/` > `contracts/` > `capability-discovery/` > `work-items/`, `work-breakdown/`, And `dependencies/` > `output-contracts/`; evidence 67531e7157eb45f2b90a9214c74cdef64e5a424650f4a0a814c4de47371c04c5
- docs/limits-and-metering.md: Limits, autonomy, and metering; sections Limits, autonomy, and metering > What “blank cheque” means here > Exact action × subject permissions > Delivery action receipts do not execute actions > Delegated authorization example > Budget model > Common and custom metrics > Complete budget input example > Warnings, soft limits, hard limits, and reserve > Exact, estimated, and unavailable > Why Ed25519 attestation is required > Trusted source configuration; evidence 9a404be43e6c103a81804d1f8e655a34d2b312bd1e92bda3d8bb7d847fcc8adf
- docs/portable-install.md: Portable Codex Install; sections Portable Codex Install > Package Surface > Prerequisites > Install > What The Installer Changes > Update > Uninstall > Doctor > Maintainer Validators > Installed-Journey Smoke Check > Portability Boundaries; evidence 0945642f40fd13eac8225c21876d42ab8e3d235fe437e73ce075f60db7c9b855

## Open Questions
- None

## Caveats
- This is inferred from repository files and imported documents.
- Historical authorship, prior approvals, and rationale are unknown unless present in evidence files.

## Approval Guidance
Approve this baseline only after the user confirms which inferred facts are canonical. Use bootstrap only for migration/provisional records.
