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
- `output_contract_refs`: Story output coverage references to approved output templates and reuse mode. In strict mode, story contracts must have matching output links.
- `validation`: Gate criteria.
- `allowed_tools`: Tool classes allowed for the phase.
- `kb_writes`: Knowledge base sections that must be updated.
- `human_gate`: Whether human approval is required.
- `execution_policy`: Codex runtime policy for model and reasoning inheritance or override.
- `contextualization`: Project-specific summary, source files, questions, assumptions, and constraints.
- `audit`: Actor, Git, and run metadata for contract creation and updates.
- `approvals`: Human or CI gate decisions. The latest approved decision controls strict gate status only while its content hash still matches the contract.

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

## Phase Contracts Vs Output Contracts

Phase/story contracts define the work boundary: inputs, outputs, validation, allowed tools, KB writes, human gate, and execution policy.

Output contracts define the project-approved artifact structure for a specific output type. They live in `.sdlc/output-contracts/registry.json` and are linked with:

- `artifact_type`;
- approved `template_id`;
- story and requirement links;
- `mode`: `reuse`, `delta`, or `new`;
- optional base artifact for deltas.

Do not duplicate template structure inside every phase contract. Let the phase contract say which artifact must be produced, and let the output registry say how that artifact is structured and whether an existing artifact should be reused.

Approved contracts, approved templates, and linked artifacts carry hashes. If the approved content changes after approval or linking, strict gates fail until the contract, template, or artifact link is refreshed through the CLI.

## Template Source

The default contract templates are defined in `templates/sdlc-config.json` at the plugin root. Teams can fork or replace that file, then pass a custom template directory through:

```bash
node <plugin-root>/bin/agentic-sdlc.mjs --template-dir <dir> ...
```

At `init`, the effective config is copied into the target project's `.sdlc/config.json`. Existing projects use that project-local policy for gate and orchestration commands, so later template-dir changes cannot silently weaken the process.

## Review Guidance

Reject or revise a contract when:

- it is not bound to a project;
- it does not record context sources or questions;
- outputs are not testable;
- validation criteria are subjective only;
- allowed tools are too broad for the risk level;
- execution policy overrides are present without rationale or user/project backing;
- linked output artifacts do not use approved output templates;
- duplicate outputs are created without an approved decision;
- the latest human gate decision is not `approved` before phase exit;
- audit metadata is missing for contract updates;
- human approval is missing for high-impact actions;
- KB writes are missing for decisions, assumptions, risks, or tests.
