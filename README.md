# Agentic SDLC Codex Plugin

Agentic SDLC is a Codex plugin that turns a classic software development life cycle into a contract-driven, agent-legible operating system.

The plugin gives Codex a reusable SDLC skill and a cross-platform Node CLI. The CLI creates a shared `.sdlc/` knowledge base inside the target project, so teams and agents can work in parallel through Git branches and pull requests.

## What It Implements

- Phase contracts for Discovery, Analysis, Design, Implementation, Validation, and Release.
- Existing-project onboarding with an inferred baseline that must be confirmed before it becomes canonical.
- A Git-first knowledge base for requirements, stories, decisions, assumptions, risks, tests, traces, and releases.
- Story-scoped workspaces so multiple agents can work in parallel without overwriting each other.
- Work breakdown agreements for project-local epics, stories, tasks, and approved decomposition choices.
- Contextual capability discovery for project/story profiles, skill/MCP/tool/model recommendations, install approvals, and technical decision matrices.
- Contract capability policies for agreed skills, MCPs, tools, bindings, permissions, and approval boundaries.
- Approved dependency graphs that control orchestration, stale downstream work, and strict gates.
- Append-only trace logs for decisions, tests, implementation events, gate reviews, and release notes.
- Parallel orchestration commands for multi-chat work, story claims, handoffs, locks, and sync/push attribution.
- Story step completion and handoff packages so functional, technical, implementation, validation, and release lanes can pass work between chats or machines.
- Activity and query reports that reconstruct what happened from canonical KB records with business, developer, agent-verbose, or structured natural-language-normalized filters.
- Output consistency registry for approved artifact templates, story-artifact links, and reuse/delta decisions.
- KB manifests, trace compaction, archive plans, and local regenerable cache for faster lookup without treating cache as source of truth.
- Language-agnostic request routing: Codex normalizes user intent to canonical JSON, then the CLI deterministically decides the SDLC route from project state and policy.
- Formal approval governance that separates implementation permission from approved SDLC artifacts.
- Gate checks that validate contract completeness, story readiness, and traceability.
- A regenerable search index over `.sdlc/` content.

## Process At A Glance

```mermaid
flowchart LR
  Discovery["Discovery"] --> Analysis["Analysis"]
  Analysis --> Design["Design"]
  Design --> Implementation["Implementation"]
  Implementation --> Validation["Validation"]
  Validation --> Release["Release"]

  Contract["Phase or story contract"] --> Discovery
  Contract --> Analysis
  Contract --> Design
  Contract --> Implementation
  Contract --> Validation
  Contract --> Release

  KB["Shared .sdlc knowledge base"] <--> Discovery
  KB <--> Analysis
  KB <--> Design
  KB <--> Implementation
  KB <--> Validation
  KB <--> Release
  Gate["Strict gate check"] --> Release
```

```mermaid
flowchart TB
  Story["Story"] --> Resolve["output resolve"]
  Resolve --> Registry["output-contracts registry"]
  Registry --> Template["Approved template"]
  Registry --> Base["Related base artifact"]
  Template --> Produce["Produce artifact"]
  Base --> Delta["Reuse plus delta"]
  Delta --> Link["output link"]
  Produce --> Link
  Link --> Registry

  KB["Canonical KB files"] --> Cache["Local cache"]
  Cache -.-> Resolve
  Cache -.-> Gate["gate check --strict"]
```

## Install In Codex

Import this repository as a Codex plugin. The plugin root is the repository root and contains `.codex-plugin/plugin.json`.

The plugin is portable across Codex installations because the manifest references only repository-relative paths:

- `.codex-plugin/plugin.json` for the plugin metadata;
- `assets/` for the composer icon and light/dark logo images;
- `skills/agentic-sdlc/` for the Codex skill and agent card assets;
- `bin/`, `schemas/`, `templates/`, and `docs/` for the cross-platform CLI and reusable SDLC method.

No project knowledge is stored in the plugin installation. Each target project gets its own `.sdlc/` directory, which can be shared through Git.

Recommended local install uses the same personal marketplace flow as other local Codex plugins:

```bash
git clone https://github.com/aantenore/agentic-sdlc-codex-plugin.git \
  "$HOME/plugins/agentic-sdlc-codex-plugin"

cd "$HOME/plugins/agentic-sdlc-codex-plugin"
python3 scripts/install-personal-marketplace.py
codex plugin add agentic-sdlc-codex-plugin@personal
codex plugin list | grep agentic-sdlc-codex-plugin
```

For development from an existing checkout, expose that checkout under the personal plugin parent before running the installer:

```bash
mkdir -p "$HOME/plugins"
ln -s "$(pwd)" "$HOME/plugins/agentic-sdlc-codex-plugin"
python3 scripts/install-personal-marketplace.py
codex plugin add agentic-sdlc-codex-plugin@personal
```

The installer only updates the machine-local `~/.agents/plugins/marketplace.json`; do not commit that file into this repository. Start a new Codex thread after installing or reinstalling so Codex loads the plugin skill and assets from the installed plugin cache.

Validate the portable package before sharing:

```bash
python /path/to/plugin-creator/scripts/validate_plugin.py .
python /path/to/skill-creator/scripts/quick_validate.py skills/agentic-sdlc
```

See [Portable Codex Install](docs/portable-install.md) for the full portability model.

After import, invoke the skill with:

```text
Use $agentic-sdlc to initialize this project.
```

## CLI Usage

The CLI has no runtime dependencies beyond Node.js.

```bash
node bin/agentic-sdlc.mjs init --project-name "My Product"
node bin/agentic-sdlc.mjs onboard existing-project --project-name "Legacy Product" --document README.md
node bin/agentic-sdlc.mjs baseline approve --id BASELINE-INITIAL --actor-type human --approval-source explicit-user --summary "Confirmed current baseline"
node bin/agentic-sdlc.mjs contract create --phase discovery --context-summary "Discover the validated product problem and user constraints"
node bin/agentic-sdlc.mjs story create --id ST-001 --title "Implement a business workflow"
node bin/agentic-sdlc.mjs work item create --type epic --id EP-001 --title "Business workflow"
node bin/agentic-sdlc.mjs breakdown propose --id BD-REQ-001 --requirement REQ-001 --item story:ST-001
node bin/agentic-sdlc.mjs breakdown approve --id BD-REQ-001 --actor-type human --approval-source explicit-user --summary "Approved breakdown"
node bin/agentic-sdlc.mjs dependency propose --id DEP-001 --edge ST-002:ST-001:requires_artifact:validation:artifact_linked
node bin/agentic-sdlc.mjs dependency approve --id DEP-001 --actor-type human --approval-source explicit-user --summary "Approved dependency graph"
node bin/agentic-sdlc.mjs capability profile propose --id CAP-PROFILE-ST-001 --story ST-001 --phase analysis --context-file .sdlc/requirements/REQ-001.md
node bin/agentic-sdlc.mjs capability profile approve --id CAP-PROFILE-ST-001 --actor-type human --approval-source explicit-user --summary "Approved capability profile"
node bin/agentic-sdlc.mjs capability recommend --id CAP-REC-ST-001 --profile CAP-PROFILE-ST-001 --available-capabilities-file .sdlc/decisions/available-capabilities.json
node bin/agentic-sdlc.mjs capability approve --id CAP-REC-ST-001 --actor-type human --approval-source explicit-user --summary "Approved capability recommendation"
node bin/agentic-sdlc.mjs story claim --id ST-001 --agent codex --branch feature/ST-001
node bin/agentic-sdlc.mjs approval requests --story ST-001
node bin/agentic-sdlc.mjs story complete-step --id ST-001 --step functional-analysis --type functional-analysis --summary "Functional review complete"
node bin/agentic-sdlc.mjs story prepare-handoff --id ST-001 --to-agent implementation-agent --release-claim --summary "Ready for implementation"
node bin/agentic-sdlc.mjs output template propose --type functional-analysis --summary "Standard functional analysis"
node bin/agentic-sdlc.mjs output template approve --id functional-analysis-v1 --actor-type human --approval-source explicit-user --summary "Approved output template"
node bin/agentic-sdlc.mjs output resolve --story ST-001 --type functional-analysis
node bin/agentic-sdlc.mjs trace append --story ST-001 --type decision --summary "Keep provider-specific logic behind an adapter"
node bin/agentic-sdlc.mjs trace append --story ST-001 --type implementation --summary "Codex implemented the requested change" --actor codex --actor-type agent --requested-by antonioantenore --requested-by-type human --request-summary "Add the requested workflow"
node bin/agentic-sdlc.mjs sync record --story ST-001 --event push --summary "Pushed feature/ST-001"
node bin/agentic-sdlc.mjs report activity --since 3d --view business --out .sdlc/reports/activity.md
node bin/agentic-sdlc.mjs report query --text "dimmi tutte le modifiche fatte da me" --json
node bin/agentic-sdlc.mjs report query --query-json '{"subjects":["stories"],"time":{"since":"10d","until":"now"},"filters":{"text":["functional"]}}'
node bin/agentic-sdlc.mjs task start --intent-json '{"requested_action":"implement_story","confidence":0.95,"referenced_entities":[{"type":"story","id":"ST-001"}],"provided_artifacts":[],"missing_context":[],"proposed_phase":"implementation","artifact_type":null,"skip_phases":[]}'
node bin/agentic-sdlc.mjs gate check --story ST-001 --out .sdlc/reports/ST-001-gate-report.json
node bin/agentic-sdlc.mjs orchestrate status
node bin/agentic-sdlc.mjs manifest rebuild
node bin/agentic-sdlc.mjs trace compact --story ST-001
node bin/agentic-sdlc.mjs archive closed --before 90d
node bin/agentic-sdlc.mjs cache rebuild
node bin/agentic-sdlc.mjs index rebuild
node bin/agentic-sdlc.mjs kb search "business workflow"
```

## Intent Routing

Use `route decide` when the user request could mean intake, story decomposition, contract creation, implementation, validation, or release. Codex first converts the conversation into the canonical schema in [schemas/route-intent.schema.json](schemas/route-intent.schema.json). The CLI then checks `.sdlc/` state, confidence thresholds, required story/contract/output evidence, and returns the next route without writing canonical artifacts.

```bash
node bin/agentic-sdlc.mjs route decide --json --intent-json '{
  "requested_action": "implement_story",
  "confidence": 0.92,
  "referenced_entities": [{"type": "story", "id": "ST-001"}],
  "provided_artifacts": [],
  "missing_context": [],
  "proposed_phase": "implementation",
  "artifact_type": null,
  "skip_phases": []
}'
```

Raw text passed with `--text` is treated only as untrusted context. The CLI never keyword-matches natural language; low confidence, missing context, phase skips, new templates, duplicate outputs, and implementation starts are routed to confirmation or clarification.

For technical analysis, the route layer also checks whether an approved capability profile exists. If it does not, the returned next commands point to `capability profile propose` before contract creation, so architecture decisions can use project-specific evidence and approved skill/MCP/tool choices.

## Task Front Door

Use `task start` before Codex executes work for a user request. It wraps route decision plus contract readiness and returns one of three operational outcomes:

- `ready_to_execute`: the request has canonical intent, an applicable approved contract, no contract readiness gaps, and any required start confirmation was supplied with `--confirm-start`.
- `needs_user_input`: Codex must ask the user to normalize intent, create/approve/clarify a contract, or confirm the concrete task start.
- `contract_revision_required`: the user explicitly requested `--revise-contract`, or the selected contract does not match the phase.

`--confirm-start` is operational authorization only. It does not approve a contract; formal approvals still require `contract approve --approval-source explicit-user` with user-confirmed summary or evidence.

```bash
node bin/agentic-sdlc.mjs task start --json --intent-json '{
  "requested_action": "implement_story",
  "confidence": 0.95,
  "referenced_entities": [{"type": "story", "id": "ST-001"}],
  "provided_artifacts": [],
  "missing_context": [],
  "proposed_phase": "implementation",
  "artifact_type": null,
  "skip_phases": []
}'
```

## Existing Project Onboarding

For an existing repository, use onboarding instead of pretending the SDLC knows the past history:

```bash
node bin/agentic-sdlc.mjs onboard existing-project \
  --project-name "Existing Product" \
  --document README.md \
  --source docs \
  --question "Which inferred facts are canonical?"
```

This initializes `.sdlc/` when needed and writes `.sdlc/baseline/BASELINE-INITIAL.json` plus a readable current-state report. The baseline is `proposed` by default: detected stack, key files, documents, assumptions, and open questions are evidence, not confirmed truth. Approve it only after the user confirms what is canonical.

## Approval Governance

Approvals are formal SDLC events, not a side effect of telling an agent to implement or push. Human approvals must include an explicit source and a summary or evidence:

```bash
node bin/agentic-sdlc.mjs contract approve \
  --id contract-ST-001-analysis \
  --actor-type human \
  --approval-source explicit-user \
  --summary "Approved analysis contract and output structure"
```

Use `--approval-source bootstrap` only for migration or provisional records. Bootstrap approvals are marked provisional and do not satisfy strict gates by default.

## Collaboration Model

The plugin intentionally keeps the project knowledge base in `.sdlc/`, not inside the plugin installation. That makes the knowledge base shareable with other developers and agents.

Recommended workflow:

1. Run `orchestrate status` or `orchestrate plan` to see available lanes.
2. Claim one story per worker chat with `story claim`.
3. Work on the claimed branch and append decisions/evidence through `trace append`.
4. Use `story complete-step` to mark functional, technical, implementation, validation, or release work as complete with hashed evidence.
5. Use `story prepare-handoff --release-claim` when passing work from analysis to implementation or validation, then `story handoff close` when the receiving lane accepts it.
6. Use `sync record --event push` after pushing or merging so other chats know what changed.
7. Run `report activity --since 3d --view dev|business|agent-verbose` to reconstruct recent work from the KB.
8. Run `gate check --story <id> --strict` before review or merge.
9. Release claims and locks when work is done.

Before producing a durable artifact, run `output resolve --story <id> --type <artifact-type>`. If there is no approved output template for that type, propose one and stop for user agreement before creating a contract that references it. If another story already covered the same requirement, the default is to reuse the approved base artifact and create only a delta. New templates, duplicate new outputs, or structure changes require user approval and an auditable registry decision. Story-specific contracts must include `--output-ref artifact-type:template-id:mode` by default; `contract create` rejects missing story output refs and refs to draft or missing templates unless an explicit migration/clarification override is used. `output link` requires the story contract to be approved and fresh. Strict gates require those refs to be satisfied by output links.

Use `approval requests --story <id>` whenever a gate or route needs human input. It returns the pending baseline, output-template, contract clarification, contract approval, and output-link actions with a summary and suggested command. Agents should show this summary to the user and stop until the user approves, answers, or requests changes.

Derived cache and indexes under `.sdlc/cache/` and `.sdlc/indexes/` can be regenerated and must not be treated as the source of truth. `output resolve` verifies cached recommendations against canonical KB files and rejects tampered cache results.

## Activity, Handoff, And KB Scale

`story complete-step` creates a story-local completion record under `.sdlc/stories/<story-id>/steps/`, requires an approved fresh story contract, appends a `story.complete-step` trace, and verifies linked output artifacts when `--type` is supplied. `story prepare-handoff` writes a handoff package with the story state, claim, completed steps, output links, dependencies, handoffs, and recent traces, then can release the active claim so another chat or machine can continue.

```mermaid
flowchart LR
  Analysis["Functional or technical lane"] --> Complete["story complete-step"]
  Complete --> StepRecord["steps/<step>.json"]
  Complete --> Trace["story.complete-step trace"]
  StepRecord --> Handoff["story prepare-handoff"]
  Trace --> Handoff
  Handoff --> Package["handoff package"]
  Handoff --> Release["optional claim release"]
  Package --> NextAgent["Next agent or developer"]
```

`report activity` answers questions such as "what happened in the last 3 days?" from canonical trace files. The business view groups decisions, validation, risks, handoffs, and releases; the developer view includes evidence, related IDs, branch and SHA; the agent-verbose view includes raw trace/run metadata. Every item includes source file and line.

For broader natural-language filtering, use `report query`. The CLI intentionally does not keyword-match raw natural language. Codex or another LLM normalizes the request into canonical query JSON, then the CLI filters deterministic records from `.sdlc/`: activity, stories, story steps, outputs, contracts, handoffs, work items, approvals, and tests. Without `--query-json` or `--query-file`, `report query --text "<request>"` returns the expected query shape and examples.

Examples of normalized requests:

```bash
node bin/agentic-sdlc.mjs report query --query-json '{
  "intent": "find_changes_by_actor",
  "subjects": ["activity", "stories", "outputs", "contracts", "approvals"],
  "filters": {"actor": ["antonio"]},
  "sort": "created_at_desc"
}'

node bin/agentic-sdlc.mjs report query --query-json '{
  "intent": "find_changes_requested_by_user",
  "subjects": ["activity"],
  "filters": {"requester": ["antonioantenore"]},
  "sort": "created_at_desc"
}'

node bin/agentic-sdlc.mjs report query --query-json '{
  "intent": "find_new_functional_stories",
  "subjects": ["stories"],
  "time": {"since": "10d", "until": "now", "field": "created_at"},
  "filters": {"text": ["functional"]},
  "sort": "created_at_desc"
}'
```

For large KBs, `manifest rebuild` writes `.sdlc/manifests/kb-manifest.json` as a compact shared map of stories, contracts, output links, approvals, and activity. `trace compact` writes non-destructive summaries under `.sdlc/traces/compactions/`; original JSONL traces remain canonical. `archive closed` creates an archive plan for old reports and compactions and only moves files when `--apply` is explicitly passed.

## Parallel Orchestration

Multiple Codex chats can work safely when each chat owns a different story claim:

```bash
node bin/agentic-sdlc.mjs orchestrate plan --json
node bin/agentic-sdlc.mjs story claim --id ST-001 --agent analysis-chat --branch feature/ST-001 --thread-id codex-thread-a
node bin/agentic-sdlc.mjs story claim --id ST-002 --agent implementation-chat --branch feature/ST-002 --thread-id codex-thread-b
```

A parent chat can coordinate several stories by reading `orchestrate status --json`, assigning available lanes, and requiring each worker chat to write attributed trace, handoff, sync, and gate evidence into `.sdlc/`.

For shared phase artifacts, use phase locks:

```bash
node bin/agentic-sdlc.mjs phase lock --phase analysis --reason "Updating shared functional analysis"
node bin/agentic-sdlc.mjs phase release --id LOCK-analysis-20260701123000 --reason "Analysis artifact handed off"
```

The CLI rejects a second active lock for the same phase/scope and uses local lock files to serialize claim, phase-lock, and output-registry mutations inside one workspace.

## Contextual Contract Generation

Contract templates are generic, but generated contracts are project-specific. The agent should inspect `.sdlc/`, read user-provided files, and ask targeted questions before creating or revising a contract.

```bash
node bin/agentic-sdlc.mjs contract create \
  --phase analysis \
  --context-file .sdlc/requirements/REQ-001.md \
  --context-summary "Analyze the MVP around the approved business workflow." \
  --qa "Who approves this phase?|Product owner" \
  --qa "Which external provider is authoritative for MVP?|Provider selected by the approved requirement" \
  --constraint "Provider-specific logic must stay behind an adapter"
```

The resulting contract stores project identity, context source references, answered/open questions, assumptions, and constraints under `contextualization`.
If a question is still open, ask the user before normal contract creation. `--allow-incomplete-contract` is only for explicit clarification, migration, or recovery drafts and must not be used to start phase work. Story contracts automatically populate `story.contract_id`; replacing a different story contract requires explicit `--replace-story-contract`.
Durable phase outputs are blocked until the story contract is approved and fresh: `output link` and `story complete-step` reject draft contracts unless `--allow-unapproved-contract-output` is used for explicit migration or recovery.

Contracts also carry an `execution_policy`. By default, generated contracts tell spawned Codex agents to inherit the model and reasoning level from the main Codex thread. Override them only when a phase needs a different execution profile:

```bash
node bin/agentic-sdlc.mjs contract create \
  --phase implementation \
  --context-summary "Implement the approved story under the current architecture constraints." \
  --model codex-model-id \
  --reasoning high \
  --execution-note "Use higher reasoning for risky architecture changes"
```

Model identifiers are stored as free-form Codex model IDs so the plugin does not need hardcoded model catalogs. Reasoning levels are configurable in `templates/sdlc-config.json`.

Contracts can also carry a `capability_policy` and `capability_bindings`. Use these to agree which skills, MCPs, tools, concrete targets, permissions, and approval-required actions are allowed for the step. Required MCP/tool capabilities must either have a binding or remain as explicit open questions before strict gates pass.

## Capability Discovery

Capability discovery is the technical architect layer. Codex or another LLM can inspect the repo, `.sdlc/`, user files, and available skills/MCPs/tools, then submit canonical JSON. The CLI stores only validated project evidence under `.sdlc/capability-discovery/`; it does not infer technologies from user-language keywords.

```mermaid
flowchart LR
  Context["Repo, KB, user files"] --> Profile["capability profile propose"]
  Profile --> ProfileApproval["profile approve"]
  Available["Installed capabilities snapshot"] --> Recommend["capability recommend"]
  ProfileApproval --> Recommend
  Recommend --> RecommendationApproval["capability approve"]
  RecommendationApproval --> Contract["contract create --capability-recommendation"]
  Contract --> Gate["gate check --strict"]
```

Use `--approve-install` only when the user or CI has explicitly approved installing missing capabilities. Without that approval, an install-required recommendation can be recorded but cannot be applied to a contract.

```bash
node bin/agentic-sdlc.mjs contract create \
  --phase analysis \
  --story ST-001 \
  --context-summary "Technical analysis for the approved workflow." \
  --output-ref technical-analysis:technical-analysis-v1:new \
  --capability-recommendation CAP-REC-ST-001
```

## How Agents Interact

The SDLC is designed as a handoff chain. Each phase agent reads the previous phase artifacts, works under a contract, writes evidence to the project KB, and leaves the next phase with structured inputs.

Detailed examples are available in:

- [Agent Interactions](docs/agent-interactions.md)
- [Knowledge Base Structure](docs/kb-structure.md)

## Repository Layout

```text
.codex-plugin/plugin.json      Codex plugin manifest
assets/                       Plugin icon and light/dark logo images
skills/agentic-sdlc/          Codex skill, references, and agent card assets
bin/agentic-sdlc.mjs          Cross-platform CLI
scripts/generate-plugin-assets.mjs  Deterministic asset generator
templates/sdlc-config.json     Configurable SDLC phase contracts and policies
templates/kb-readme.md         Generated project KB guide
schemas/                       JSON schemas for SDLC artifacts
docs/architecture.md           Implementation architecture
docs/agent-interactions.md     Phase-by-phase agent examples
docs/kb-structure.md           Detailed project KB structure
```
