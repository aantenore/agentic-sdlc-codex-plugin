# BASELINE-INITIAL Current State

Status: proposed
Kind: existing-project

## Summary
Initial baseline for existing project agentic-sdlc-codex-plugin.

## Product Signal
Codex plugin for project contextualization, verified assessments, and traceable software delivery.

## Architecture And Component Signals
- Source root: lib
- Source root: bin
- docs/architecture.md: Architecture > Core Design Choices > Existing Project Baseline > Assessment Control Plane > Intent Routing Layer > Contract Model > Approval Governance > Capability Discovery Layer > Work Breakdown And Dependencies > Output Consistency Layer > Local Optimization Layer > Parallel Work Model

## Detected Stack
- node: package-json (package.json)
- automation: npm-scripts (package.json)

## Key Files
- .github/workflows/ci.yml (59da0395f1ea2f2444ff5916381d947b2f0825847d77b9e91cbe09f9e951f9d3)
- .github/workflows/release.yml (5cf40e57e2ff4ac2f6a36c9c4578e66a0224d8b62acd21ce506b4c7a1837cfb4)
- package.json (d18b6e4c71a207f27a6ec99808cda5d357d9eaaf5d608bea648d191c5455a2c4)
- README.md (bcae3a22962e0db48df6e8a65629706f9a5f970a3e5c855e1132ff43e745a8d6)

## Imported Documents
- README.md: Agentic SDLC Codex Plugin; sections Agentic SDLC Codex Plugin > Documentation Map > Quick Start > How It Works > What The Two Checkpoints Mean > Autonomy And Limits Are Separate Controls > CodeBurn Versus Exact Metering > Canonical Output Formats > Generation And Layered Verification Receipts > Install > Update > Uninstall; evidence bcae3a22962e0db48df6e8a65629706f9a5f970a3e5c855e1132ff43e745a8d6
- docs/architecture.md: Architecture; sections Architecture > Core Design Choices > Existing Project Baseline > Assessment Control Plane > Intent Routing Layer > Contract Model > Approval Governance > Capability Discovery Layer > Work Breakdown And Dependencies > Output Consistency Layer > Local Optimization Layer > Parallel Work Model; evidence 3743d05c1c8ea0ca42d88f3145c7c1fd171d8c846ca5f48e8e9bb518554580f9
- docs/how-it-works.md: How Agentic SDLC 0.6.0 Works; sections How Agentic SDLC 0.6.0 Works > 1. The Mental Model > 2. Canonical State Versus Derived State > 3. The Two-Checkpoint Assessment > Checkpoint 1: confirm project context > Checkpoint 2: approve one complete tranche > 4. Exact Authorization: Action × Subject > 5. Execution, Verification, Recovery, and Release > Apply is exact and idempotent > Execution is measured as one tree > Output verification is layered > Completion is a release transaction; evidence 62f002dc698a31bdaf0b12b68eba785d578e08f0328b4aed0bdf81d5de577c28

## Open Questions
- Quali fatti inferiti devono diventare il contesto canonico del progetto?

## Caveats
- This is inferred from repository files and imported documents.
- Historical authorship, prior approvals, and rationale are unknown unless present in evidence files.

## Approval Guidance
Approve this baseline only after the user confirms which inferred facts are canonical. Use bootstrap only for migration/provisional records.
