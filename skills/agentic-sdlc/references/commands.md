# CLI Commands

Run commands with Node from the plugin root:

```bash
node bin/agentic-sdlc.mjs <command>
```

When the command targets another project, pass `--root <target-project>`.

## Initialize

```bash
node bin/agentic-sdlc.mjs init --root <project> --project-name "Product Name"
```

Creates `.sdlc/`, project metadata, KB directories, generated README, and default phase contracts.

For an existing repository, initialize and propose a baseline in one step:

```bash
node bin/agentic-sdlc.mjs onboard existing-project \
  --root <project> \
  --project-name "Product Name" \
  --document README.md \
  --source docs \
  --question "Which inferred facts are canonical?"
```

Summarize `.sdlc/baseline/BASELINE-INITIAL-current-state.md` in chat, including inferred summary, documents read, detected stack, important files, assumptions, and open questions. Do not make the user open the file as the main approval flow. Approve only after explicit confirmation:

```bash
node bin/agentic-sdlc.mjs baseline approve \
  --root <project> \
  --id BASELINE-INITIAL \
  --actor-type human \
  --approval-source explicit-user \
  --summary "Confirmed current-state baseline"
```

## Approval Governance

Approval commands require a formal source. `--actor-type human` alone is not enough.

Use `--approval-source explicit-user` when the user explicitly approves the specific artifact and include `--summary` or `--approval-evidence`. A short "ok" or "yes" applies only to the artifact or decision that was shown immediately before it; do not reuse it for newly created templates, capability profiles, recommendations, contracts, or task start confirmations. Use `--approval-source ci` for approved CI actors. Use `--approval-source bootstrap` only for provisional migration records; bootstrap approvals do not satisfy strict gates by default.

## Create Contract

```bash
node bin/agentic-sdlc.mjs contract create \
  --root <project> \
  --phase design \
  --context-summary "Design the approved workflow into story-scoped delivery units."
```

Creates a contract from `templates/sdlc-config.json`. Normal contract creation requires enough agreed context to guide the phase. If the context, output format, or phase-driving decisions are missing, ask the user first.

Project-specific context can be attached while creating a contract:

```bash
node bin/agentic-sdlc.mjs contract create \
  --root <project> \
  --phase analysis \
  --context-file .sdlc/requirements/REQ-001.md \
  --context-summary "Analyze the MVP around the approved business workflow." \
  --qa "Who approves this phase?|Product owner" \
  --qa "Which external provider is authoritative for MVP?|Provider selected by the approved requirement" \
  --constraint "Provider-specific logic must stay behind an adapter" \
  --output-ref functional-analysis:functional-analysis-v1:new
```

Use `--allow-incomplete-contract` only to persist an explicit clarification, migration, or recovery draft. It is not approval to start phase work. Story contracts automatically update `story.contract_id`; changing a story that already references a different contract requires explicit `--replace-story-contract`.
`output link` and `story complete-step` require an approved, fresh story contract before durable phase output is linked or completed. Use `--allow-unapproved-contract-output` only for explicit migration or recovery of pre-existing artifacts.

By default, the contract execution policy inherits the main Codex thread model and reasoning level. Override them only when needed:

```bash
node bin/agentic-sdlc.mjs contract create \
  --root <project> \
  --phase implementation \
  --model codex-model-id \
  --reasoning high \
  --execution-note "Use higher reasoning for a high-risk architecture change"
```

Supported default reasoning levels are `inherit`, `minimal`, `low`, `medium`, and `high`. Teams can change the allowed levels in `templates/sdlc-config.json`.

Capability policy and bindings can be attached while creating a contract:

```bash
node bin/agentic-sdlc.mjs contract create \
  --root <project> \
  --phase implementation \
  --capability-policy-json '{"mcp":{"required":["repo"],"allowed":[],"forbidden":[]},"skills":{"required":["agentic-sdlc"],"allowed":[],"forbidden":[]},"tools":{"required":[],"allowed":["test-runner"],"forbidden":[]},"approval_required_for":["production_write"]}' \
  --capability-binding-json '{"type":"mcp","name":"repo","binding_id":"repo-main","target":{"repo":"local"},"permissions":["read"]}'
```

Binding files must be canonical project files, never `.sdlc/cache/` or `.sdlc/indexes/`.

Approved capability recommendations can also be applied to a contract. This pulls in the agreed capability policy, bindings, open questions, and model/reasoning suggestions:

```bash
node bin/agentic-sdlc.mjs contract create \
  --root <project> \
  --phase analysis \
  --story ST-001 \
  --context-summary "Technical analysis for the approved workflow." \
  --capability-recommendation CAP-REC-ST-001
```

## Create And Claim Story

```bash
node bin/agentic-sdlc.mjs story create --root <project> --id ST-001 --title "Implement a business workflow"
node bin/agentic-sdlc.mjs story claim --root <project> --id ST-001 --agent codex --branch feature/ST-001 --thread-id <codex-thread-id>
node bin/agentic-sdlc.mjs story complete-step --root <project> --id ST-001 --step functional-analysis --type functional-analysis --summary "Functional review complete"
node bin/agentic-sdlc.mjs story prepare-handoff --root <project> --id ST-001 --to-agent implementation-agent --release-claim --summary "Ready for implementation"
node bin/agentic-sdlc.mjs story release --root <project> --id ST-001 --agent codex --reason "Work handed off"
```

One story should have one active claim. Release the claim before another chat claims the same story, or use `--force` only after human coordination. The CLI serializes local claim changes and strict gates enforce the configured branch pattern.

`story complete-step` records a completed SDLC lane under `.sdlc/stories/<story-id>/steps/`, appends a trace, requires an approved fresh story contract, and validates linked output artifacts when `--type` is provided. `story prepare-handoff` creates a story handoff package containing story state, claim, completed steps, output links, dependency status, open handoffs, and recent traces. Use `--release-claim` when the receiving chat or developer should be able to claim the story after pulling the KB.

## Work Breakdown And Dependencies

```bash
node bin/agentic-sdlc.mjs work item create --root <project> --type epic --id EP-001 --title "Workflow epic" --requirement REQ-001
node bin/agentic-sdlc.mjs work item create --root <project> --type task --id TASK-001 --title "Backend task" --story ST-001
node bin/agentic-sdlc.mjs breakdown propose --root <project> --id BD-REQ-001 --requirement REQ-001 --item epic:EP-001 --item story:ST-001
node bin/agentic-sdlc.mjs breakdown approve --root <project> --id BD-REQ-001 --actor-type human --approval-source explicit-user --summary "Approved breakdown"
node bin/agentic-sdlc.mjs dependency propose --root <project> --id DEP-REQ-001 --edge ST-002:ST-001:requires_artifact:validation:artifact_linked
node bin/agentic-sdlc.mjs dependency approve --root <project> --id DEP-REQ-001 --actor-type human --approval-source explicit-user --summary "Approved dependency graph"
node bin/agentic-sdlc.mjs dependency status --root <project> --story ST-002
node bin/agentic-sdlc.mjs story deps --root <project> --id ST-002
```

Breakdowns and dependencies are proposed first, then approved by a human/CI actor or by delegated automation when the user explicitly gave a matching approval level. Hard dependency scopes block orchestration and strict gates; soft dependencies remain visible as warnings. When upstream artifacts change, record a `dependency.revalidate` trace on downstream stories after review.

## Capability Discovery

```bash
node bin/agentic-sdlc.mjs capability profile propose \
  --root <project> \
  --id CAP-PROFILE-ST-001 \
  --story ST-001 \
  --phase analysis \
  --context-file .sdlc/requirements/REQ-001.md
node bin/agentic-sdlc.mjs capability profile approve --root <project> --id CAP-PROFILE-ST-001 --actor-type human --approval-source explicit-user --summary "Approved capability profile"
node bin/agentic-sdlc.mjs capability recommend \
  --root <project> \
  --id CAP-REC-ST-001 \
  --profile CAP-PROFILE-ST-001 \
  --available-capabilities-file .sdlc/decisions/available-capabilities.json
node bin/agentic-sdlc.mjs capability approve --root <project> --id CAP-REC-ST-001 --actor-type human --approval-source explicit-user --summary "Approved capability recommendation"
node bin/agentic-sdlc.mjs capability status --root <project> --story ST-001 --json
```

Use profile records to capture project/story context, detected stack, constraints, integrations, evidence, source paths, and source hashes. Use recommendation records to capture skills, MCPs, tools, connectors, plugins, models, concrete bindings, decision matrices, open questions, and execution-policy suggestions.

If a recommendation requires installing a missing skill/plugin/connector or using a new external/write/production target, approval is separate:

```bash
node bin/agentic-sdlc.mjs capability approve --root <project> --id CAP-REC-ST-001 --actor-type human --approval-source explicit-user --summary "Approved install" --approve-install
```

Without install approval, the recommendation can be stored but cannot be applied to a contract. Strict gates also fail when a contract references stale or modified capability recommendations.

## Orchestrate Parallel Work

```bash
node bin/agentic-sdlc.mjs orchestrate status --root <project> --json
node bin/agentic-sdlc.mjs orchestrate plan --root <project> --limit 10
```

Use `status` before opening another Codex chat. Use `plan` to find available story lanes for a parent orchestrator chat.

## Route Intent

```bash
node bin/agentic-sdlc.mjs route decide --root <project> --json --intent-json '<canonical-route-intent-json>'
node bin/agentic-sdlc.mjs route --root <project> --json --intent-file .sdlc/requests/ST-001-route-intent.json
node bin/agentic-sdlc.mjs task start --root <project> --json --intent-json '<canonical-route-intent-json>'
```

The route command is deterministic. Codex or another LLM must first normalize the user's request into `schemas/route-intent.schema.json`; the CLI does not classify raw natural language. `--text` can be provided for audit/debug context, but it is ignored for routing. Intent files cannot live under `.sdlc/cache/` or `.sdlc/indexes/`.

Minimum canonical intent:

```json
{
  "requested_action": "implement_story",
  "confidence": 0.92,
  "referenced_entities": [{ "type": "story", "id": "ST-001" }],
  "provided_artifacts": [],
  "missing_context": [],
  "proposed_phase": "implementation",
  "artifact_type": null,
  "skip_phases": []
}
```

The decision output contains the selected route, confidence result, deterministic checks, blocking reasons, questions for the user, and suggested next CLI commands. Low confidence, missing context, phase skips, implementation starts, new templates, duplicate outputs, and missing capability profiles for technical analysis require confirmation or clarification according to `routing_policy`.

Use `task start` as the operational front door before Codex performs phase work. It runs route decision, finds the applicable story or phase contract, blocks missing/incomplete/unapproved/stale contracts, and returns `ready_to_execute` only when execution is allowed. `--confirm-start` confirms the concrete start of work, but it does not count as formal contract approval. `--revise-contract` deliberately stops for contract revision even when a usable contract exists.

## Handoff And Locks

```bash
node bin/agentic-sdlc.mjs story handoff --root <project> --id ST-001 --to-agent implementation-agent --artifact .sdlc/requirements/functional-analysis.md
node bin/agentic-sdlc.mjs story prepare-handoff --root <project> --id ST-001 --to-agent implementation-agent --release-claim
node bin/agentic-sdlc.mjs story handoff close --root <project> --id HND-ST-001-20260701123000 --status closed
node bin/agentic-sdlc.mjs phase lock --root <project> --phase analysis --reason "Updating shared analysis artifact"
node bin/agentic-sdlc.mjs phase release --root <project> --id LOCK-analysis-20260701123000 --reason "Shared artifact stable"
```

Use phase locks for shared phase artifacts, not for normal story-scoped work. A second active lock for the same phase/scope is rejected unless `--force` is used after coordination.

## Append Trace

```bash
node bin/agentic-sdlc.mjs trace append --root <project> --story ST-001 --type test --summary "Unit tests passed" --evidence .sdlc/tests/ST-001-test-run.json --actor codex --actor-type agent
node bin/agentic-sdlc.mjs trace append --root <project> --story ST-001 --type implementation --summary "Codex implemented a requested change" --actor codex --actor-type agent --requested-by antonioantenore --requested-by-type human --authorized-by antonioantenore --authorized-by-type human --request-summary "Implement the requested feature"
```

Valid trace types: `assumption`, `decision`, `gate`, `claim`, `handoff`, `implementation`, `lock`, `release`, `risk`, `sync`, `test`.

Record push and merge events explicitly:

```bash
node bin/agentic-sdlc.mjs sync record --root <project> --story ST-001 --event push --remote origin --summary "Pushed feature/ST-001"
```

## Gate Check

```bash
node bin/agentic-sdlc.mjs gate check --root <project> --story ST-001 --strict --out .sdlc/reports/ST-001-gate-report.json
```

With `--story`, the default scope is story-scoped, so unrelated story lanes do not block each other. Use `--scope all` for project-wide checks. Returns non-zero when blocking errors are found. Use `--out` to persist JSON or Markdown gate evidence.

## Output Consistency

```bash
node bin/agentic-sdlc.mjs output template propose --root <project> --type functional-analysis --summary "Standard functional analysis"
node bin/agentic-sdlc.mjs output template approve --root <project> --id functional-analysis-v1 --actor-type human --approval-source explicit-user --summary "Approved output template"
node bin/agentic-sdlc.mjs output resolve --root <project> --story ST-001 --type functional-analysis
node bin/agentic-sdlc.mjs output link \
  --root <project> \
  --story ST-001 \
  --type functional-analysis \
  --artifact .sdlc/requirements/functional-analysis.md \
  --template functional-analysis-v1 \
  --mode new \
  --requirement REQ-001
node bin/agentic-sdlc.mjs output status --root <project> --story ST-001
```

`output resolve` checks the approved template registry and related story links. If another story already covers the same requirement, the expected result is reuse plus delta. `output link` requires an approved fresh story contract, then records the final user-agreed artifact, approved template, mode, requirements, and content fingerprints. Strict gates fail when linked outputs use unapproved or changed templates, create unjustified duplicates, omit requirements, point to cache/index files, or drift after linking.

When a duplicate new output or structure override is intentionally approved, run `output link` with `--decision-id` and `--rationale` as a human or CI actor. The CLI records the approved decision in the registry:

```bash
node bin/agentic-sdlc.mjs output link \
  --root <project> \
  --story ST-002 \
  --type functional-analysis \
  --artifact .sdlc/requirements/ST-002-functional-analysis.md \
  --template functional-analysis-v1 \
  --mode new \
  --requirement REQ-001 \
  --decision-id DEC-output-override-001 \
  --rationale "User approved a separate artifact because the workflow diverges" \
  --actor-type human \
  --approval-source explicit-user \
  --summary "Approved separate artifact"
```

## Cache, Index, And Search

```bash
node bin/agentic-sdlc.mjs cache rebuild --root <project>
node bin/agentic-sdlc.mjs cache status --root <project>
node bin/agentic-sdlc.mjs cache clear --root <project>
node bin/agentic-sdlc.mjs manifest rebuild --root <project>
node bin/agentic-sdlc.mjs trace compact --root <project> --story ST-001
node bin/agentic-sdlc.mjs archive closed --root <project> --before 90d
node bin/agentic-sdlc.mjs index rebuild --root <project>
node bin/agentic-sdlc.mjs kb search --root <project> "business workflow"
```

Cache and indexes are local derived artifacts. They can accelerate context retrieval and output resolution, but canonical requirements, approvals, decisions, tests, traces, and outputs must stay in source-of-truth `.sdlc/` folders.
If a cached output resolution differs from canonical KB files, the CLI rejects it and asks for `cache rebuild`.

`manifest rebuild` creates a compact, shared KB map under `.sdlc/manifests/`. `trace compact` creates non-destructive summaries under `.sdlc/traces/compactions/`; original JSONL traces remain canonical. `archive closed` writes an archive plan for old reports and compactions and moves files only with `--apply`.

## Activity Reports

```bash
node bin/agentic-sdlc.mjs report activity --root <project> --since 3d --view business --out .sdlc/reports/activity.md
node bin/agentic-sdlc.mjs report activity --root <project> --since 3d --view dev --json
node bin/agentic-sdlc.mjs report activity --root <project> --since 12h --view agent-verbose --story ST-001
node bin/agentic-sdlc.mjs approval requests --root <project> --story ST-001 --json
node bin/agentic-sdlc.mjs report query --root <project> --text "show all changes made by me" --json
node bin/agentic-sdlc.mjs report query --root <project> --query-json '<canonical-report-query-json>' --json
```

Activity reports reconstruct what happened from canonical trace files only. Business view focuses on decisions, validation, risk, handoffs, implementation, and release. Dev view includes evidence, branch/SHA, related IDs, and source lines. Agent-verbose view includes raw trace, git, and run metadata for audit.

Use `approval requests` before continuing when a baseline, capability profile, capability recommendation, output template, contract clarification, contract approval, or canonical output link needs human agreement. Proposal commands for those artifact types return an `assistant_message` and `approval_request` too; show those when available instead of saying only that artifacts were prepared. The command is intentionally user-facing and returns `assistant_message` plus `assistant_message_presentation`. Agents should translate and contextualize `assistant_message` in the active chat language when `translate_to_chat_language` is true. Present plain-language meaning first: baseline means trusted project context, capability profile means tools-and-permissions boundaries, capability recommendation means concrete tool choices, output template means assessment/output format, and contract means the work brief. Preserve IDs, paths, commands, status codes, and schema keys only as technical detail when needed. Present what must be reviewed, why it matters, what approval means, whether more information is needed, and what will happen next. Do not reduce approval to a bare question, a file link, or a list of artifact IDs; summarize relevant baseline report, capability records, template, contract, and source-list contents directly in chat. For output-template approvals, show the sections, template content when useful, delivery/presentation options, recommended delivery, and delivery question before asking. Approval scope is exact: a user response approves only the displayed request, not later artifacts. Then stop until the user approves, answers, or asks for changes.

Use `report query` for broader natural-language history questions. Codex or another LLM should normalize the user request into `schemas/report-query.schema.json`; the CLI then filters canonical KB records deterministically. Supported subjects are `activity`, `stories`, `story_steps`, `outputs`, `contracts`, `handoffs`, `work_items`, `approvals`, `tests`, and `all`.

Example normalized query for "all changes made by me":

```json
{
  "intent": "find_changes_by_actor",
  "confidence": 0.95,
  "subjects": ["activity", "stories", "outputs", "contracts", "approvals"],
  "filters": {
    "actor": ["<current-user-id-or-email>"]
  },
  "sort": "created_at_desc"
}
```

Example normalized query for "all changes made by Codex at my request":

```json
{
  "intent": "find_changes_requested_by_user",
  "confidence": 0.95,
  "subjects": ["activity"],
  "filters": {
    "executor": ["codex"],
    "requester": ["<current-user-id-or-email>"]
  },
  "sort": "created_at_desc"
}
```

Example normalized query for "all new functional stories from the last 10 days":

```json
{
  "intent": "find_new_functional_stories",
  "confidence": 0.95,
  "subjects": ["stories"],
  "time": {
    "since": "10d",
    "until": "now",
    "field": "created_at"
  },
  "filters": {
    "text": ["functional"]
  },
  "sort": "created_at_desc"
}
```
