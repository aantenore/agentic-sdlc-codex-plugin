# Contract Generation

The contract-building behavior must be domain-agnostic. Do not hardcode a product name, business domain, technology stack, or delivery method. Instead, contextualize each generated contract from the target project's evidence.

## Context Gathering Order

1. Read `.sdlc/project.json`.
2. Search the project KB for relevant requirements, stories, decisions, assumptions, risks, tests, traces, and output contracts.
3. Inspect user-provided files or repository files that the user names.
4. Ask the user concise questions only for missing critical inputs, output format decisions, or approval boundaries.
5. Generate or update the contract only after the critical answers are known, with the gathered context recorded in `contextualization`.

## Model And Reasoning Policy

Contracts may specify which Codex model and reasoning level spawned agents should use. This is not a domain rule; it is an execution policy for the contract.

Default behavior:

- Set `execution_policy.model.mode` to `inherit`.
- Set `execution_policy.reasoning.mode` to `inherit`.
- Interpret `inherit` as "reuse the main Codex thread settings".

Override behavior:

- Ask the user before setting a model override unless a project artifact already requires it.
- Propose a higher or lower reasoning level when phase risk clearly calls for it, then ask the user before storing the override.
- Store a short `execution_policy.notes` entry when the override changes cost, latency, risk, or review expectations.
- Keep model IDs as free-form Codex model identifiers; do not hardcode a model catalog into prompts or contracts.

Use higher reasoning for phases with broad architectural ambiguity, high-risk implementation, security-sensitive validation, or release decisions. Use inherited reasoning for routine contract generation and normal implementation work unless the user chooses otherwise.

## What To Ask

Ask only questions that change the contract. Good questions include:

- What outcome must this phase produce?
- Who approves this gate?
- Which requirements or files are authoritative inputs?
- Which integrations, APIs, or external systems are in scope?
- Which constraints or non-functional requirements are non-negotiable?
- What counts as evidence that this phase is done?
- What can the agent do autonomously, and what requires approval?
- Should this contract inherit the main Codex thread model/reasoning, or use a specific model or reasoning level?
- Should any required output use an existing approved template, a delta from a base artifact, or a user-approved new structure?

Avoid generic brainstorming questions when the KB already contains enough evidence.

## CLI Pattern

Use `--context-file` for authoritative files and `--qa` for answered questions. Ask the user before normal contract creation when questions are still open. Use `--question` with `--allow-incomplete-contract` only for an explicit clarification, migration, or recovery draft.

```bash
node <plugin-root>/bin/agentic-sdlc.mjs contract create \
  --root <target-project> \
  --phase analysis \
  --context-file .sdlc/requirements/REQ-001.md \
  --context-summary "Analyze the MVP around the approved business workflow." \
  --qa "Who approves this phase?|Product owner" \
  --qa "Which external provider is authoritative for MVP?|Provider selected by the approved requirement" \
  --constraint "Must keep provider-specific logic behind an adapter" \
  --assumption "External provider sandbox access is available" \
  --reasoning high \
  --execution-note "Higher reasoning requested for integration-risk analysis"
```

## Output Rule

Every generated contract should answer:

- Which project is this for?
- Which phase or story does it govern?
- Which sources informed it?
- Which questions were answered?
- Which questions remain open?
- Which assumptions and constraints shape the work?
- Which artifacts must be produced and validated?
- Which output templates or registry links govern those artifacts?
- Which Codex model/reasoning policy should spawned agents follow?
- Which orchestration scope applies: single story, multiple story lanes, or shared phase artifact?
- Which actor attribution, handoff, lock, and strict gate rules apply?
