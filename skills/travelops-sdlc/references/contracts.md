# Contract Model

A contract is the operational descriptor for an SDLC phase or story. It tells Codex and human reviewers how the step must be executed, produced, validated, and traced.

## Required Fields

- `id`: Stable contract identifier.
- `phase`: One of `discovery`, `analysis`, `design`, `implementation`, `validation`, `release`.
- `purpose`: Why this phase exists.
- `owner_agent`: Default agent role responsible for the phase.
- `inputs`: Required source material.
- `outputs`: Required artifacts.
- `validation`: Gate criteria.
- `allowed_tools`: Tool classes allowed for the phase.
- `kb_writes`: Knowledge base sections that must be updated.
- `human_gate`: Whether human approval is required.

## Template Source

The default contract templates are defined in `templates/sdlc-config.json` at the plugin root. Teams can fork or replace that file, then pass a custom template directory through:

```bash
node <plugin-root>/bin/travelops-sdlc.mjs --template-dir <dir> ...
```

## Review Guidance

Reject or revise a contract when:

- outputs are not testable;
- validation criteria are subjective only;
- allowed tools are too broad for the risk level;
- human approval is missing for high-impact actions;
- KB writes are missing for decisions, assumptions, risks, or tests.
