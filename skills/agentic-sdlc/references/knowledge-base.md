# Shared Knowledge Base

The project KB lives under `<target-project>/.sdlc/`. It is the durable source of truth for agentic SDLC work.

## Required Structure

```text
.sdlc/
  project.json
  README.md
  contracts/
  output-contracts/
  requirements/
  stories/
  orchestration/
  locks/
  handoffs/
  decisions/
  assumptions/
  risks/
  tests/
  traces/
  releases/
  cache/
  indexes/
  reports/
```

## Source Of Truth

Use JSON and Markdown files as source of truth. Treat generated cache and indexes as derived artifacts. Reports are durable evidence when they support a review, gate, or release decision.

## What Belongs In The KB

- Contracts and phase rules.
- Output contract registry, approved templates, story-artifact links, and structural output decisions.
- Requirements and constraints.
- Story workspaces and claims.
- Orchestration snapshots for parent chats.
- Phase/shared-artifact locks.
- Handoffs between agents, phases, and Codex chats.
- Architecture and product decision records.
- Explicit assumptions and rejected alternatives.
- Risks and mitigations.
- Test plans and evidence.
- Release notes and feedback loops.
- Cache/index files only as local regenerable acceleration data.

## What Does Not Belong In The Plugin

- Project-specific contracts.
- Project-specific traces.
- Project-specific decisions.
- Private project knowledge.
- Generated cache and indexes for a specific project.

Those artifacts must stay in the project `.sdlc/` directory.

## Output Consistency

Before producing a durable output, inspect `.sdlc/output-contracts/registry.json`.

- Use an approved template for the artifact type.
- Prefer reuse plus delta when another story already covers the same requirement.
- Ask the user before proposing a new template, changing structure, or creating a duplicate new artifact.
- Link the final artifact with `output link` so future agents can discover it.

## Cache Policy

`.sdlc/cache/` is local and regenerable. It may store full-text indexes, story-requirement graphs, artifact fingerprints, compact summaries, dependency graphs, and `output resolve` results.

Never cite cache files as canonical evidence. Cite the source paths recorded in the cache entry instead.

## Attribution

Claims, traces, handoffs, approvals, locks, and sync events should record:

- actor id and type;
- Codex thread/run/session when available;
- Git branch and head SHA;
- event timestamp;
- evidence paths or related artifact IDs.
