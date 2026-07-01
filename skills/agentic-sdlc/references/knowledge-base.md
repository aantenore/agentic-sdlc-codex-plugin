# Shared Knowledge Base

The project KB lives under `<target-project>/.sdlc/`. It is the durable source of truth for agentic SDLC work.

## Required Structure

```text
.sdlc/
  project.json
  README.md
  contracts/
  requirements/
  stories/
  decisions/
  assumptions/
  risks/
  tests/
  traces/
  releases/
  indexes/
  reports/
```

## Source Of Truth

Use JSON and Markdown files as source of truth. Treat generated indexes and reports as derived artifacts.

## What Belongs In The KB

- Contracts and phase rules.
- Requirements and constraints.
- Story workspaces and claims.
- Architecture and product decision records.
- Explicit assumptions and rejected alternatives.
- Risks and mitigations.
- Test plans and evidence.
- Release notes and feedback loops.

## What Does Not Belong In The Plugin

- Project-specific contracts.
- Project-specific traces.
- Project-specific decisions.
- Private project knowledge.
- Generated indexes for a specific project.

Those artifacts must stay in the project `.sdlc/` directory.
