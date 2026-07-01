# Contract Generation

The contract-building behavior must be domain-agnostic. Do not hardcode TravelOps, a business domain, a technology stack, or a delivery method. Instead, contextualize each generated contract from the target project's evidence.

## Context Gathering Order

1. Read `.sdlc/project.json`.
2. Search the project KB for relevant requirements, stories, decisions, assumptions, risks, tests, and traces.
3. Inspect user-provided files or repository files that the user names.
4. Ask the user concise questions only for missing critical inputs.
5. Generate or update the contract with the gathered context recorded in `contextualization`.

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

Avoid generic brainstorming questions when the KB already contains enough evidence.

## CLI Pattern

Use `--context-file` for authoritative files, `--qa` for answered questions, and `--question` for open questions that must remain visible.

```bash
node <plugin-root>/bin/agentic-sdlc.mjs contract create \
  --root <target-project> \
  --phase analysis \
  --context-file .sdlc/requirements/REQ-001.md \
  --context-summary "Analyze the MVP around disruption-aware travel replanning." \
  --qa "Who approves this phase?|Product owner" \
  --question "Which weather provider is authoritative for MVP?" \
  --constraint "Must keep provider-specific logic behind an adapter" \
  --assumption "External provider sandbox access is available" \
  --reasoning high \
  --execution-note "Higher reasoning requested for integration-risk analysis"
```

The example mentions a travel product only as sample project context. The contract-generation process itself is generic.

## Output Rule

Every generated contract should answer:

- Which project is this for?
- Which phase or story does it govern?
- Which sources informed it?
- Which questions were answered?
- Which questions remain open?
- Which assumptions and constraints shape the work?
- Which artifacts must be produced and validated?
- Which Codex model/reasoning policy should spawned agents follow?
