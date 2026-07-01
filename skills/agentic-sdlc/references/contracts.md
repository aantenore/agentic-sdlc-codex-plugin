# Contract Model

A contract is the operational descriptor for an SDLC phase or story. It tells Codex and human reviewers how the step must be executed, produced, validated, and traced.

Contracts are project-bound. The templates are generic, but generated contracts must include the target project identity and contextualization metadata captured from the project KB, user input, files, and open questions.

## Required Fields

- `id`: Stable contract identifier.
- `phase`: One of `discovery`, `analysis`, `design`, `implementation`, `validation`, `release`.
- `project`: Target project identity.
- `purpose`: Why this phase exists.
- `owner_agent`: Default agent role responsible for the phase.
- `inputs`: Required source material.
- `outputs`: Required artifacts.
- `validation`: Gate criteria.
- `allowed_tools`: Tool classes allowed for the phase.
- `kb_writes`: Knowledge base sections that must be updated.
- `human_gate`: Whether human approval is required.
- `execution_policy`: Codex runtime policy for model and reasoning inheritance or override.
- `contextualization`: Project-specific summary, source files, questions, assumptions, and constraints.

## Execution Policy

Use `execution_policy` to make agent execution settings explicit:

```json
{
  "execution_policy": {
    "runtime": "codex",
    "model": {
      "mode": "inherit",
      "value": null
    },
    "reasoning": {
      "mode": "inherit",
      "level": null
    },
    "notes": []
  }
}
```

`inherit` means spawned agents should reuse the main Codex thread settings. Use `override` only when the user or project KB has selected a specific Codex model or reasoning level for the contract.

## Template Source

The default contract templates are defined in `templates/sdlc-config.json` at the plugin root. Teams can fork or replace that file, then pass a custom template directory through:

```bash
node <plugin-root>/bin/agentic-sdlc.mjs --template-dir <dir> ...
```

## Review Guidance

Reject or revise a contract when:

- it is not bound to a project;
- it does not record context sources or questions;
- outputs are not testable;
- validation criteria are subjective only;
- allowed tools are too broad for the risk level;
- execution policy overrides are present without rationale or user/project backing;
- human approval is missing for high-impact actions;
- KB writes are missing for decisions, assumptions, risks, or tests.
