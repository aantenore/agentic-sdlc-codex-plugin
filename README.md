# Agentic SDLC Codex Plugin

Agentic SDLC is a Codex plugin that turns a classic software development life cycle into a contract-driven, agent-legible operating system.

The plugin gives Codex a reusable SDLC skill and a cross-platform Node CLI. The CLI creates a shared `.sdlc/` knowledge base inside the target project, so teams and agents can work in parallel through Git branches and pull requests.

## What It Implements

- Phase contracts for Discovery, Analysis, Design, Implementation, Validation, and Release.
- A Git-first knowledge base for requirements, stories, decisions, assumptions, risks, tests, traces, and releases.
- Story-scoped workspaces so multiple agents can work in parallel without overwriting each other.
- Append-only trace logs for decisions, tests, implementation events, gate reviews, and release notes.
- Gate checks that validate contract completeness, story readiness, and traceability.
- A regenerable search index over `.sdlc/` content.

## Install In Codex

Import this repository as a Codex plugin. The plugin root is the repository root and contains `.codex-plugin/plugin.json`.

After import, invoke the skill with:

```text
Use $agentic-sdlc to initialize this project.
```

## CLI Usage

The CLI has no runtime dependencies beyond Node.js.

```bash
node bin/agentic-sdlc.mjs init --project-name "My Product"
node bin/agentic-sdlc.mjs contract create --phase discovery
node bin/agentic-sdlc.mjs story create --id ST-001 --title "Replan an activity when weather changes"
node bin/agentic-sdlc.mjs story claim --id ST-001 --agent codex --branch feature/ST-001
node bin/agentic-sdlc.mjs trace append --story ST-001 --type decision --summary "Keep weather-provider logic behind an adapter"
node bin/agentic-sdlc.mjs gate check --story ST-001
node bin/agentic-sdlc.mjs index rebuild
node bin/agentic-sdlc.mjs kb search "weather replanning"
```

The examples use a travel-planning product as sample project context. The plugin itself is domain-agnostic.

## Collaboration Model

The plugin intentionally keeps the project knowledge base in `.sdlc/`, not inside the plugin installation. That makes the knowledge base shareable with other developers and agents.

Recommended workflow:

1. Create or claim a story with `story claim`.
2. Work on a dedicated branch.
3. Append decisions and evidence through `trace append`.
4. Run `gate check` before review.
5. Merge code and `.sdlc/` artifacts together.

Derived indexes under `.sdlc/indexes/` can be regenerated and do not need to be treated as the source of truth.

## Contextual Contract Generation

Contract templates are generic, but generated contracts are project-specific. The agent should inspect `.sdlc/`, read user-provided files, and ask targeted questions before creating or revising a contract.

```bash
node bin/agentic-sdlc.mjs contract create \
  --phase analysis \
  --context-file .sdlc/requirements/REQ-001.md \
  --context-summary "Analyze the MVP around disruption-aware travel replanning." \
  --qa "Who approves this phase?|Product owner" \
  --question "Which weather provider is authoritative for MVP?" \
  --constraint "Provider-specific logic must stay behind an adapter"
```

The resulting contract stores project identity, context source references, answered/open questions, assumptions, and constraints under `contextualization`.

## How Agents Interact

The SDLC is designed as a handoff chain. Each phase agent reads the previous phase artifacts, works under a contract, writes evidence to the project KB, and leaves the next phase with structured inputs.

Detailed examples are available in:

- [Agent Interactions](docs/agent-interactions.md)
- [Knowledge Base Structure](docs/kb-structure.md)

## Repository Layout

```text
.codex-plugin/plugin.json      Codex plugin manifest
skills/agentic-sdlc/         Codex skill and references
bin/agentic-sdlc.mjs         Cross-platform CLI
templates/sdlc-config.json     Configurable SDLC phase contracts and policies
templates/kb-readme.md         Generated project KB guide
schemas/                       JSON schemas for SDLC artifacts
docs/architecture.md           Implementation architecture
docs/agent-interactions.md     Phase-by-phase agent examples
docs/kb-structure.md           Detailed project KB structure
```
