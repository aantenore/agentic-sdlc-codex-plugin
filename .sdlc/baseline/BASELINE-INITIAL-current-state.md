# BASELINE-INITIAL Current State

Status: approved
Kind: existing-project

## Summary
Current Agentic SDLC 0.9.0 context, including the installed Change Observatory, IntentABI projection, RTK optimization, identity migration, and current schemas/tests.

## Product Signal
Codex plugin for contract-driven delivery, verified assessments, and visual project lineage.

## Architecture And Component Signals
- Source root: lib
- Source root: bin
- docs/architecture.md: Architecture > Core Design Choices > Existing Project Baseline > Assessment Control Plane > Intent Routing Layer > Contract Model > Approval Governance > Capability Discovery Layer > Work Breakdown And Dependencies > Output Consistency Layer > Change Observatory Presentation Layer > Local Optimization Layer
- docs/agent-interactions.md: Assessment Interactions > Activation > Exactly Two Normal Checkpoints > Contract For Every Question > Checkpoint 1 — Project Context > Required question > Prepare The Immutable Proposal > Checkpoint 2 — Combined Proposal And Complete Tranche > Budget in the same checkpoint > Required question > Internal Command Choreography > Requirement And Story Lineage
- docs/codeburn-metering.md: CodeBurn advisory metering adapter > What each input means > Shell-free command configuration > Start snapshot > Current snapshot and delta > Persisted evidence > Limitations and enforcement boundary > Library API
- docs/kb-structure.md: Knowledge Base Structure > Source Of Truth > `project.json` > `baseline/` > `assessments/` > `receipts/` > `contracts/` > `capability-discovery/` > `work-items/`, `work-breakdown/`, And `dependencies/` > `output-contracts/` > `requirements/` > `stories/`

## Detected Stack
- node: package-json (package.json)
- automation: npm-scripts (package.json)

## Key Files
- .github/workflows/ci.yml (59da0395f1ea2f2444ff5916381d947b2f0825847d77b9e91cbe09f9e951f9d3)
- .github/workflows/release.yml (5cf40e57e2ff4ac2f6a36c9c4578e66a0224d8b62acd21ce506b4c7a1837cfb4)
- package.json (9af4b2bee3d9004bfa40427251472648588f7b03096439736cb00bcabb4ad764)
- README.md (976bf1bdbfe4b1967c37a7c8129e9df7301d4915ab6ab706917387ebecea29b0)

## Imported Documents
- README.md: Agentic SDLC Codex Plugin; sections Agentic SDLC Codex Plugin > Documentation Map > Quick Start > Change Observatory > How It Works > What The Two Checkpoints Mean > Autonomy And Limits Are Separate Controls > CodeBurn Versus Exact Metering > RTK Context Optimization > Canonical Output Formats > Generation And Layered Verification Receipts > Install; evidence 976bf1bdbfe4b1967c37a7c8129e9df7301d4915ab6ab706917387ebecea29b0
- docs/architecture.md: Architecture; sections Architecture > Core Design Choices > Existing Project Baseline > Assessment Control Plane > Intent Routing Layer > Contract Model > Approval Governance > Capability Discovery Layer > Work Breakdown And Dependencies > Output Consistency Layer > Change Observatory Presentation Layer > Local Optimization Layer; evidence 495fd6a6871926160a46eae090d42060f7c6dfbb0ac917710167a80ce0998d4d
- docs/product-assessment.md: Product Assessment: Guided Project Assessment Journey; sections Product Assessment: Guided Project Assessment Journey > Executive Verdict > Before The Change > Target After The Complete Change Set > Assessment Scope > Product Strengths Before The Change > Pre-Change Product Gaps > Target Product Behavior > Checkpoint 1: Project Context > Checkpoint 2: Combined Work Proposal > Execution And Delivery > Format Product Contract; evidence e94b5766bba27d394021634f0c6dae1c2d1625b05461791254fc3e487c73203f
- docs/agent-interactions.md: Assessment Interactions; sections Assessment Interactions > Activation > Exactly Two Normal Checkpoints > Contract For Every Question > Checkpoint 1 — Project Context > Required question > Prepare The Immutable Proposal > Checkpoint 2 — Combined Proposal And Complete Tranche > Budget in the same checkpoint > Required question > Internal Command Choreography > Requirement And Story Lineage; evidence dd4a408bf0e3b3b4c2f959c799e8ede28f762b8bdce0f7a147c6823a275b9d0d
- docs/change-observatory.md: Change Observatory; sections Change Observatory > Launch After Installation > What It Shows > Intent Evidence > Explainability Without Private Reasoning > Security And Privacy Boundary > Troubleshooting; evidence 85e0dc8fec8385fe628378a555217b197cfb7451fcc32d36971b19ec7b4ae92d
- docs/codeburn-metering.md: CodeBurn advisory metering adapter; sections CodeBurn advisory metering adapter > What each input means > Shell-free command configuration > Start snapshot > Current snapshot and delta > Persisted evidence > Limitations and enforcement boundary > Library API; evidence 91ab00cb901e59ae8f61913a6ac4f59efe528a122aad9950dbe151e6e5da02c4
- docs/how-it-works.md: How Agentic SDLC 0.9.0 Works; sections How Agentic SDLC 0.9.0 Works > 1. The Mental Model > 2. Canonical State Versus Derived State > 3. The Two-Checkpoint Assessment > Checkpoint 1: confirm project context > Checkpoint 2: approve one complete tranche > 4. Exact Authorization: Action × Subject > 5. Execution, Verification, Recovery, and Release > Apply is exact and idempotent > Execution is measured as one tree > Output verification is layered > Completion is a release transaction; evidence c3792bd326e3074437fe649fe7f2f31d2f335f36023dd6d115b53192e74e2e0c
- docs/kb-structure.md: Knowledge Base Structure; sections Knowledge Base Structure > Source Of Truth > `project.json` > `baseline/` > `assessments/` > `receipts/` > `contracts/` > `capability-discovery/` > `work-items/`, `work-breakdown/`, And `dependencies/` > `output-contracts/` > `requirements/` > `stories/`; evidence 9e78d73b4d58a242e1f3038cfe2e75c02bfd7248e51c51d1117b688893f9227b
- docs/limits-and-metering.md: Limits, autonomy, and metering; sections Limits, autonomy, and metering > What “blank cheque” means here > Exact action × subject permissions > Delegated authorization example > Budget model > Common and custom metrics > Complete budget input example > Warnings, soft limits, hard limits, and reserve > Exact, estimated, and unavailable > Why Ed25519 attestation is required > Trusted source configuration > RTK optimization and the cost gate; evidence b86a2a10b5ca708a6a683f16b3223a650f44b58482b95b3b1dcab3111d9dfbc2
- docs/portable-install.md: Portable Codex Install; sections Portable Codex Install > Package Surface > Prerequisites > Install > What The Installer Changes > Update > Uninstall > Doctor > Maintainer Validators > Installed-Journey Smoke Check > Portability Boundaries; evidence efc5de875e7c87e8816affc9de630a4608408d5c906cd004ed6e43b885c77d1c
- docs/README.md: Agentic SDLC documentation; sections Agentic SDLC documentation > Start here > Find a page by goal > Recommended reading paths > User approving work > Operator configuring controls > Maintainer changing the plugin > The core idea in one diagram; evidence 44bd144ca2ef242454ae6fdaeff939a0cc8e42a4a1c22a823b47d5da6a0b2824
- docs/token-efficiency.md: Token Efficiency; sections Token Efficiency > Savings map > Compact derived JSON > RTK command gateway > Lifecycle observations > Project cumulative versus proposal delta > Zero budget credit and a sovereign cost gate; evidence c33128e57fda037ebf6d40be20ba2a45b463c932c31f088b0876a99fe38302c7

## Open Questions
- None

## Caveats
- This is inferred from repository files and imported documents.
- Historical authorship, prior approvals, and rationale are unknown unless present in evidence files.

## Approval Guidance
Approve this baseline only after the user confirms which inferred facts are canonical. Use bootstrap only for migration/provisional records.
