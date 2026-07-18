# BASELINE-ENTERPRISE-PLATFORM-003 Current State

Status: approved
Kind: existing-project

## Summary
Agentic SDLC 0.11.0 current project state after complete ST-ENT-UX implementation and validation, covering human-first EN/IT guidance, self-service CLI, transactional installer, localized Observatory, tests, documentation, schemas, and unchanged enterprise performance boundaries.

## Product Signal
Codex plugin for contract-driven delivery, verified assessments, and visual project lineage.

## Architecture And Component Signals
- Source root: lib
- Source root: bin
- README.md: Agentic SDLC Codex Plugin > Documentation Map > Quick Start > Self-service CLI > Change Observatory > How It Works > What The Two Checkpoints Mean > Autonomy Is Negotiated Per Requirement And Selected Per Delivery > CodeBurn Versus Exact Metering > RTK Context Optimization > Canonical Output Formats > Generation And Layered Verification Receipts
- docs/architecture.md: Architecture > Core Design Choices > Command-Scoped Canonical Queries > Existing Project Baseline > Assessment Control Plane > Autonomy Control Plane > Intent Routing Layer > Contract Model > Approval Governance > Capability Discovery Layer > Work Breakdown And Dependencies > Output Consistency Layer
- docs/agent-interactions.md: Assessment Interactions > Activation > Exactly Two Normal Checkpoints > Contract For Every Question > Checkpoint 1 — Project Context > Required question > Prepare The Immutable Proposal > Checkpoint 2 — Combined Proposal And Complete Tranche > Budget in the same checkpoint > Required question > Internal Command Choreography > Requirement And Story Lineage
- docs/codeburn-metering.md: CodeBurn advisory metering adapter > What each input means > Shell-free command configuration > Start snapshot > Current snapshot and delta > Persisted evidence > Limitations and enforcement boundary > Library API
- docs/how-it-works.md: How Agentic SDLC 0.11.0 Works > 1. The Mental Model > 2. Canonical State Versus Derived State > 3. The Two-Checkpoint Assessment > Checkpoint 1: confirm project context > Checkpoint 2: approve one complete tranche > 4. Requirement Ceiling And Per-Delivery Selection > 5. Exact Authorization: Action × Subject > Delivery actions are authorized, executed, then completed > 6. Execution, Verification, Recovery, and Release > Apply is exact and idempotent > Execution is measured as one tree
- docs/kb-structure.md: Knowledge Base Structure > Source Of Truth > `project.json` > `baseline/` > `assessments/` > `receipts/` > `contracts/` > `capability-discovery/` > `work-items/`, `work-breakdown/`, And `dependencies/` > `output-contracts/` > `requirements/` > `autonomy/`

## Detected Stack
- node: package-json (package.json)
- automation: npm-scripts (package.json)

## Key Files
- .github/workflows/ci.yml (59da0395f1ea2f2444ff5916381d947b2f0825847d77b9e91cbe09f9e951f9d3)
- .github/workflows/release.yml (5cf40e57e2ff4ac2f6a36c9c4578e66a0224d8b62acd21ce506b4c7a1837cfb4)
- package.json (45a274477a20d1716e1780a7691c6d74c3089d48c21256dbb6328af91e375342)
- README.md (36a0c6b6d461fac56d477104ad11a697da9b9a89f5933efe12fff2e558a9caa5)

## Imported Documents
- README.md: Agentic SDLC Codex Plugin; sections Agentic SDLC Codex Plugin > Documentation Map > Quick Start > Self-service CLI > Change Observatory > How It Works > What The Two Checkpoints Mean > Autonomy Is Negotiated Per Requirement And Selected Per Delivery > CodeBurn Versus Exact Metering > RTK Context Optimization > Canonical Output Formats > Generation And Layered Verification Receipts; evidence 36a0c6b6d461fac56d477104ad11a697da9b9a89f5933efe12fff2e558a9caa5
- docs/architecture.md: Architecture; sections Architecture > Core Design Choices > Command-Scoped Canonical Queries > Existing Project Baseline > Assessment Control Plane > Autonomy Control Plane > Intent Routing Layer > Contract Model > Approval Governance > Capability Discovery Layer > Work Breakdown And Dependencies > Output Consistency Layer; evidence 2e911f8de9c7551e18318909da2f4dbe5d35371873ab5acd9d886feccd19f382
- docs/product-assessment.md: Product Assessment: Guided Project Assessment Journey; sections Product Assessment: Guided Project Assessment Journey > Executive Verdict > Before The Change > Target After The Complete Change Set > Assessment Scope > Product Strengths Before The Change > Pre-Change Product Gaps > Target Product Behavior > Checkpoint 1: Project Context > Checkpoint 2: Combined Work Proposal > Execution And Delivery > Format Product Contract; evidence 0afac961db4dbc23a98b5c826e83959d6d2c1906192744be4fa5c57026318b99
- docs/agent-interactions.md: Assessment Interactions; sections Assessment Interactions > Activation > Exactly Two Normal Checkpoints > Contract For Every Question > Checkpoint 1 — Project Context > Required question > Prepare The Immutable Proposal > Checkpoint 2 — Combined Proposal And Complete Tranche > Budget in the same checkpoint > Required question > Internal Command Choreography > Requirement And Story Lineage; evidence 8cb04a23491a4f3cdd7c1ad3872195d4345dad13c2b2e55c20bf8939f32cb076
- docs/change-observatory.md: Change Observatory; sections Change Observatory > Launch After Installation > What It Shows > Proof-Bound Iteration Dossiers > Intent Evidence > Explainability Without Private Reasoning > Security And Privacy Boundary > Troubleshooting; evidence 20d6c8a8a4322a6e0102fefd88542e3ce8660bec0ad5aa9319030dbad89c5876
- docs/codeburn-metering.md: CodeBurn advisory metering adapter; sections CodeBurn advisory metering adapter > What each input means > Shell-free command configuration > Start snapshot > Current snapshot and delta > Persisted evidence > Limitations and enforcement boundary > Library API; evidence 91ab00cb901e59ae8f61913a6ac4f59efe528a122aad9950dbe151e6e5da02c4
- docs/configuration-safety.md: Configuration safety; sections Configuration safety > The short version > Review before applying > Esempio in italiano > English example > Technical records; evidence c7c9a66dcd10eea95ef6bbe2addecb32eaafe6894ad0d56a835295fe5c13d2d5
- docs/how-it-works.md: How Agentic SDLC 0.11.0 Works; sections How Agentic SDLC 0.11.0 Works > 1. The Mental Model > 2. Canonical State Versus Derived State > 3. The Two-Checkpoint Assessment > Checkpoint 1: confirm project context > Checkpoint 2: approve one complete tranche > 4. Requirement Ceiling And Per-Delivery Selection > 5. Exact Authorization: Action × Subject > Delivery actions are authorized, executed, then completed > 6. Execution, Verification, Recovery, and Release > Apply is exact and idempotent > Execution is measured as one tree; evidence 65426d060cb348e5ac50ae3982620c3ee94579a59bcb0d48d143c5a5f7c3ca67
- docs/kb-structure.md: Knowledge Base Structure; sections Knowledge Base Structure > Source Of Truth > `project.json` > `baseline/` > `assessments/` > `receipts/` > `contracts/` > `capability-discovery/` > `work-items/`, `work-breakdown/`, And `dependencies/` > `output-contracts/` > `requirements/` > `autonomy/`; evidence 1ec451205b866f88f7751d0ad7165ee1dfbdec00d88effcf286c708f80702413
- docs/limits-and-metering.md: Limits, autonomy, and metering; sections Limits, autonomy, and metering > What “blank cheque” means here > Exact action × subject permissions > Delivery action receipts do not execute actions > Delegated authorization example > Budget model > Common and custom metrics > Complete budget input example > Warnings, soft limits, hard limits, and reserve > Exact, estimated, and unavailable > Why Ed25519 attestation is required > Trusted source configuration; evidence 9a404be43e6c103a81804d1f8e655a34d2b312bd1e92bda3d8bb7d847fcc8adf
- docs/portable-install.md: Portable Codex Install; sections Portable Codex Install > Package Surface > Prerequisites > Install > What The Installer Changes > Update > Uninstall > Doctor > Maintainer Validators > Installed-Journey Smoke Check > Portability Boundaries; evidence 0945642f40fd13eac8225c21876d42ab8e3d235fe437e73ce075f60db7c9b855
- docs/README.md: Agentic SDLC documentation; sections Agentic SDLC documentation > Start here > Find a page by goal > Recommended reading paths > User approving work > Operator configuring controls > Maintainer changing the plugin > The core idea in one diagram; evidence ed393abe60d9f89150e0de37db86c59ac82b051c0ae4878b86f1673720c0ed6d

## Open Questions
- None

## Caveats
- This is inferred from repository files and imported documents.
- Historical authorship, prior approvals, and rationale are unknown unless present in evidence files.

## Approval Guidance
Approve this baseline only after the user confirms which inferred facts are canonical. Use bootstrap only for migration/provisional records.
