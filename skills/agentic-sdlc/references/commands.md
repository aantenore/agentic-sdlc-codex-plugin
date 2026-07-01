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

## Create Contract

```bash
node bin/agentic-sdlc.mjs contract create --root <project> --phase design
```

Creates a contract from `templates/sdlc-config.json`.

Project-specific context can be attached while creating a contract:

```bash
node bin/agentic-sdlc.mjs contract create \
  --root <project> \
  --phase analysis \
  --context-file .sdlc/requirements/REQ-001.md \
  --context-summary "Analyze the MVP around the approved business workflow." \
  --qa "Who approves this phase?|Product owner" \
  --question "Which external provider is authoritative for MVP?" \
  --constraint "Provider-specific logic must stay behind an adapter"
```

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

## Create And Claim Story

```bash
node bin/agentic-sdlc.mjs story create --root <project> --id ST-001 --title "Implement a business workflow"
node bin/agentic-sdlc.mjs story claim --root <project> --id ST-001 --agent codex --branch feature/ST-001 --thread-id <codex-thread-id>
node bin/agentic-sdlc.mjs story release --root <project> --id ST-001 --agent codex --reason "Work handed off"
```

One story should have one active claim. Release the claim before another chat claims the same story, or use `--force` only after human coordination.

## Orchestrate Parallel Work

```bash
node bin/agentic-sdlc.mjs orchestrate status --root <project> --json
node bin/agentic-sdlc.mjs orchestrate plan --root <project> --limit 10
```

Use `status` before opening another Codex chat. Use `plan` to find available story lanes for a parent orchestrator chat.

## Handoff And Locks

```bash
node bin/agentic-sdlc.mjs story handoff --root <project> --id ST-001 --to-agent implementation-agent --artifact .sdlc/requirements/functional-analysis.md
node bin/agentic-sdlc.mjs phase lock --root <project> --phase analysis --reason "Updating shared analysis artifact"
node bin/agentic-sdlc.mjs phase release --root <project> --id LOCK-analysis-20260701123000 --reason "Shared artifact stable"
```

Use phase locks for shared phase artifacts, not for normal story-scoped work.

## Append Trace

```bash
node bin/agentic-sdlc.mjs trace append --root <project> --story ST-001 --type test --summary "Unit tests passed" --actor codex --actor-type agent
```

Valid trace types: `assumption`, `decision`, `gate`, `claim`, `handoff`, `implementation`, `lock`, `release`, `risk`, `sync`, `test`.

Record push and merge events explicitly:

```bash
node bin/agentic-sdlc.mjs sync record --root <project> --story ST-001 --event push --remote origin --summary "Pushed feature/ST-001"
```

## Gate Check

```bash
node bin/agentic-sdlc.mjs gate check --root <project> --story ST-001 --strict
```

With `--story`, the default scope is story-scoped, so unrelated story lanes do not block each other. Use `--scope all` for project-wide checks. Returns non-zero when blocking errors are found.

## Output Consistency

```bash
node bin/agentic-sdlc.mjs output template propose --root <project> --type functional-analysis --summary "Standard functional analysis"
node bin/agentic-sdlc.mjs output template approve --root <project> --id functional-analysis-v1 --actor-type human
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

`output resolve` checks the approved template registry and related story links. If another story already covers the same requirement, the expected result is reuse plus delta. `output link` records the final user-agreed artifact, approved template, and mode. Strict gates fail when linked outputs use unapproved templates, create unjustified duplicates, or point to cache/index files.

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
  --actor-type human
```

## Cache, Index, And Search

```bash
node bin/agentic-sdlc.mjs cache rebuild --root <project>
node bin/agentic-sdlc.mjs cache status --root <project>
node bin/agentic-sdlc.mjs cache clear --root <project>
node bin/agentic-sdlc.mjs index rebuild --root <project>
node bin/agentic-sdlc.mjs kb search --root <project> "business workflow"
```

Cache and indexes are local derived artifacts. They can accelerate context retrieval and output resolution, but canonical requirements, approvals, decisions, tests, traces, and outputs must stay in source-of-truth `.sdlc/` folders.
