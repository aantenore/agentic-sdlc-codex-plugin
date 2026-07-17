# BASELINE-ENTERPRISE-PLATFORM-001 Current State

Status: approved
Kind: existing-project

## Summary
Agentic SDLC 0.11.0 current-state baseline for enterprise hardening across performance, observability, usability, useful workflow features, portability, and first-class management of projects, change requests, and project-creation processes.

## Product Signal
Codex plugin for contract-driven delivery, verified assessments, and visual project lineage.

## Architecture And Component Signals
- Source root: lib
- Source root: bin
- README.md: Agentic SDLC Codex Plugin > Documentation Map > Quick Start > Change Observatory > How It Works > What The Two Checkpoints Mean > Autonomy Is Negotiated Per Requirement And Selected Per Delivery > CodeBurn Versus Exact Metering > RTK Context Optimization > Canonical Output Formats > Generation And Layered Verification Receipts > Install
- docs/architecture.md: Architecture > Core Design Choices > Existing Project Baseline > Assessment Control Plane > Autonomy Control Plane > Intent Routing Layer > Contract Model > Approval Governance > Capability Discovery Layer > Work Breakdown And Dependencies > Output Consistency Layer > Change Observatory Presentation Layer
- docs/how-it-works.md: How Agentic SDLC 0.11.0 Works > 1. The Mental Model > 2. Canonical State Versus Derived State > 3. The Two-Checkpoint Assessment > Checkpoint 1: confirm project context > Checkpoint 2: approve one complete tranche > 4. Requirement Ceiling And Per-Delivery Selection > 5. Exact Authorization: Action × Subject > Delivery actions are authorized, executed, then completed > 6. Execution, Verification, Recovery, and Release > Apply is exact and idempotent > Execution is measured as one tree
- docs/agent-interactions.md: Assessment Interactions > Activation > Exactly Two Normal Checkpoints > Contract For Every Question > Checkpoint 1 — Project Context > Required question > Prepare The Immutable Proposal > Checkpoint 2 — Combined Proposal And Complete Tranche > Budget in the same checkpoint > Required question > Internal Command Choreography > Requirement And Story Lineage
- docs/kb-structure.md: Knowledge Base Structure > Source Of Truth > `project.json` > `baseline/` > `assessments/` > `receipts/` > `contracts/` > `capability-discovery/` > `work-items/`, `work-breakdown/`, And `dependencies/` > `output-contracts/` > `requirements/` > `autonomy/`
- docs/codeburn-metering.md: CodeBurn advisory metering adapter > What each input means > Shell-free command configuration > Start snapshot > Current snapshot and delta > Persisted evidence > Limitations and enforcement boundary > Library API

## Detected Stack
- node: package-json (package.json)
- automation: npm-scripts (package.json)

## Key Files
- .github/workflows/ci.yml (59da0395f1ea2f2444ff5916381d947b2f0825847d77b9e91cbe09f9e951f9d3)
- .github/workflows/release.yml (5cf40e57e2ff4ac2f6a36c9c4578e66a0224d8b62acd21ce506b4c7a1837cfb4)
- package.json (c80577249961fc7c0e01056d65eeb25b2feffe1552f3f1c479b437067bbbc272)
- README.md (821912da38052af063f3fa84fda8fe4bf23c1fed21e9f016071dcc8af98107b4)

## Imported Documents
- README.md: Agentic SDLC Codex Plugin; sections Agentic SDLC Codex Plugin > Documentation Map > Quick Start > Change Observatory > How It Works > What The Two Checkpoints Mean > Autonomy Is Negotiated Per Requirement And Selected Per Delivery > CodeBurn Versus Exact Metering > RTK Context Optimization > Canonical Output Formats > Generation And Layered Verification Receipts > Install; evidence 821912da38052af063f3fa84fda8fe4bf23c1fed21e9f016071dcc8af98107b4
- docs/README.md: Agentic SDLC documentation; sections Agentic SDLC documentation > Start here > Find a page by goal > Recommended reading paths > User approving work > Operator configuring controls > Maintainer changing the plugin > The core idea in one diagram; evidence 9e337e744a617eda030ebc5dc3fb52401d79bec34d58d520353ad57c4c676c8e
- docs/architecture.md: Architecture; sections Architecture > Core Design Choices > Existing Project Baseline > Assessment Control Plane > Autonomy Control Plane > Intent Routing Layer > Contract Model > Approval Governance > Capability Discovery Layer > Work Breakdown And Dependencies > Output Consistency Layer > Change Observatory Presentation Layer; evidence 0acc21b98f2458f04f4c6d2a07cd8132fc239363d8f2a35424bb9121622c5d39
- docs/how-it-works.md: How Agentic SDLC 0.11.0 Works; sections How Agentic SDLC 0.11.0 Works > 1. The Mental Model > 2. Canonical State Versus Derived State > 3. The Two-Checkpoint Assessment > Checkpoint 1: confirm project context > Checkpoint 2: approve one complete tranche > 4. Requirement Ceiling And Per-Delivery Selection > 5. Exact Authorization: Action × Subject > Delivery actions are authorized, executed, then completed > 6. Execution, Verification, Recovery, and Release > Apply is exact and idempotent > Execution is measured as one tree; evidence 65426d060cb348e5ac50ae3982620c3ee94579a59bcb0d48d143c5a5f7c3ca67
- docs/product-assessment.md: Product Assessment: Guided Project Assessment Journey; sections Product Assessment: Guided Project Assessment Journey > Executive Verdict > Before The Change > Target After The Complete Change Set > Assessment Scope > Product Strengths Before The Change > Pre-Change Product Gaps > Target Product Behavior > Checkpoint 1: Project Context > Checkpoint 2: Combined Work Proposal > Execution And Delivery > Format Product Contract; evidence 0afac961db4dbc23a98b5c826e83959d6d2c1906192744be4fa5c57026318b99
- docs/agent-interactions.md: Assessment Interactions; sections Assessment Interactions > Activation > Exactly Two Normal Checkpoints > Contract For Every Question > Checkpoint 1 — Project Context > Required question > Prepare The Immutable Proposal > Checkpoint 2 — Combined Proposal And Complete Tranche > Budget in the same checkpoint > Required question > Internal Command Choreography > Requirement And Story Lineage; evidence 8cb04a23491a4f3cdd7c1ad3872195d4345dad13c2b2e55c20bf8939f32cb076
- docs/limits-and-metering.md: Limits, autonomy, and metering; sections Limits, autonomy, and metering > What “blank cheque” means here > Exact action × subject permissions > Delivery action receipts do not execute actions > Delegated authorization example > Budget model > Common and custom metrics > Complete budget input example > Warnings, soft limits, hard limits, and reserve > Exact, estimated, and unavailable > Why Ed25519 attestation is required > Trusted source configuration; evidence 9a404be43e6c103a81804d1f8e655a34d2b312bd1e92bda3d8bb7d847fcc8adf
- docs/kb-structure.md: Knowledge Base Structure; sections Knowledge Base Structure > Source Of Truth > `project.json` > `baseline/` > `assessments/` > `receipts/` > `contracts/` > `capability-discovery/` > `work-items/`, `work-breakdown/`, And `dependencies/` > `output-contracts/` > `requirements/` > `autonomy/`; evidence 1ec451205b866f88f7751d0ad7165ee1dfbdec00d88effcf286c708f80702413
- docs/change-observatory.md: Change Observatory; sections Change Observatory > Launch After Installation > What It Shows > Proof-Bound Iteration Dossiers > Intent Evidence > Explainability Without Private Reasoning > Security And Privacy Boundary > Troubleshooting; evidence 8406f30ff08ebaa396b9efdbbb9fd380d854ac405e7c24a11067bf2be4172684
- docs/portable-install.md: Portable Codex Install; sections Portable Codex Install > Package Surface > Prerequisites > Install > What The Installer Changes > Update > Uninstall > Doctor > Maintainer Validators > Installed-Journey Smoke Check > Portability Boundaries; evidence 4d74129393a7f1ec866751edef3f366f9ce07275ba66551cbdfe31450600403c
- docs/token-efficiency.md: Token Efficiency; sections Token Efficiency > Savings map > Compact derived JSON > RTK command gateway > Lifecycle observations > Project cumulative versus proposal delta > Zero budget credit and a sovereign cost gate; evidence f72ad9639dedbd2eb7ec25e0802fc46fbaac173f52aa755e1300ddc2d1647c07
- docs/codeburn-metering.md: CodeBurn advisory metering adapter; sections CodeBurn advisory metering adapter > What each input means > Shell-free command configuration > Start snapshot > Current snapshot and delta > Persisted evidence > Limitations and enforcement boundary > Library API; evidence 91ab00cb901e59ae8f61913a6ac4f59efe528a122aad9950dbe151e6e5da02c4

## Open Questions
- Should portfolio-scale multi-project and multi-user hosted operation be part of this delivery, or remain an adapter-ready future boundary while this tranche hardens the single-project local-first core?

## Caveats
- This is inferred from repository files and imported documents.
- Historical authorship, prior approvals, and rationale are unknown unless present in evidence files.

## Approval Guidance
Approve this baseline only after the user confirms which inferred facts are canonical. Use bootstrap only for migration/provisional records.
