# Architecture

Agentic SDLC separates the reusable method from project-specific knowledge.

```text
Codex plugin
  -> skill instructions
  -> templates
  -> schemas
  -> cross-platform CLI

Target project
  -> .sdlc/
     -> contracts
     -> output-contracts
     -> stories
     -> orchestration
     -> locks
     -> handoffs
     -> decisions
     -> traces
     -> tests
     -> releases
     -> cache
     -> indexes
```

```mermaid
flowchart TB
  subgraph Plugin["Reusable plugin"]
    Skill["Skill instructions"]
    Templates["Templates"]
    Schemas["Schemas"]
    CLI["Cross-platform CLI"]
  end

  subgraph Project["Target project"]
    KB[".sdlc source of truth"]
    OutputRegistry["Output contracts registry"]
    Traces["Append-only traces"]
    Cache["Local cache"]
    Indexes["Search indexes"]
  end

  Skill --> CLI
  Templates --> CLI
  Schemas --> CLI
  CLI --> KB
  CLI --> OutputRegistry
  CLI --> Traces
  KB --> Cache
  KB --> Indexes
  OutputRegistry --> Cache
  Cache -.-> CLI
  Indexes -.-> CLI
```

## Core Design Choices

The plugin is static and reusable. It contains the SDLC process, CLI, schemas, and templates.

The project knowledge base is dynamic and shared. It is created inside the target repository so it can be reviewed, branched, merged, and audited with normal Git workflows.

The source of truth is text and JSON. Cache and search indexes are derived artifacts that can be rebuilt. Reports are durable evidence when they support a review, gate, or release decision.

## Contract Model

Every SDLC phase is governed by a contract. A contract defines:

- phase objective;
- responsible agent role;
- required inputs;
- required outputs;
- validation criteria;
- allowed tools;
- required knowledge base writes;
- human approval gate;
- Codex execution policy for model and reasoning inheritance or override;
- operational metrics.

This keeps agent work bounded and reviewable.

```mermaid
flowchart LR
  UserInput["User input and files"] --> ContractBuilder["Contract builder"]
  KBContext["Existing KB context"] --> ContractBuilder
  Questions["Open or answered questions"] --> ContractBuilder
  ContractBuilder --> Contract["Phase or story contract"]

  Contract --> Agent["Phase agent"]
  OutputRegistry["Output registry"] --> Agent
  Agent --> Outputs["Durable outputs"]
  Agent --> Trace["Trace evidence"]
  Outputs --> Gate["Gate check"]
  Trace --> Gate
  Contract --> Gate
```

## Output Consistency Layer

Phase and story contracts define what work must happen. Output contracts define the approved shape of durable artifacts produced by that work.

`.sdlc/output-contracts/registry.json` is project-wide and source-of-truth. It stores:

- approved and draft templates by artifact type;
- story to requirement to artifact links;
- reuse, delta, or new output mode;
- user-approved decisions for new templates, structure changes, and justified duplicates.

Before creating a functional analysis, technical analysis, test plan, or similar artifact, an agent resolves the output type for the story. If a related story already covers the same requirement, the default recommendation is `reuse_delta`: reuse the approved base artifact and create only a targeted delta. A new template or incompatible output structure requires explicit user approval before it becomes canonical.

```mermaid
flowchart TB
  Story["Story"] --> Requirements["Linked requirements"]
  Requirements --> Resolve["Resolve output type"]
  Resolve --> ApprovedTemplate{"Approved template exists"}
  ApprovedTemplate -->|no| Propose["Propose template"]
  Propose --> HumanApproval["Human or CI approval"]
  HumanApproval --> Registry["Registry update"]
  ApprovedTemplate -->|yes| Related{"Related artifact exists"}
  Related -->|yes| ReuseDelta["Reuse base and create delta"]
  Related -->|no| NewArtifact["Create new artifact"]
  ReuseDelta --> Link["Link artifact"]
  NewArtifact --> Link
  Link --> Registry
```

## Local Optimization Layer

`.sdlc/cache/` contains regenerable lookup data such as full-text entries, story-requirement graphs, artifact fingerprints, template resolution, compact KB summaries, dependency graphs, and output resolution results.

Cache entries carry `source_paths`, `source_hashes`, `generated_at`, and `schema_version`. A hash mismatch marks the cache stale. Stale or missing cache is a warning because the CLI can fall back to canonical KB files. A canonical artifact under `.sdlc/cache/` or `.sdlc/indexes/` is a strict gate error because derived files cannot become source of truth.

```mermaid
flowchart LR
  Source["Canonical .sdlc files"] --> Hash["Source hashes"]
  Source --> Summary["Compact summaries"]
  Source --> Graph["Story requirement graph"]
  Source --> Fingerprints["Artifact fingerprints"]
  Hash --> Cache[".sdlc/cache/kb-cache.json"]
  Summary --> Cache
  Graph --> Cache
  Fingerprints --> Cache
  Cache --> Status["cache status"]
  Status --> Valid{"Hashes match"}
  Valid -->|yes| FastLookup["Use for fast lookup"]
  Valid -->|no| Rebuild["cache rebuild"]
  Rebuild --> Cache
```

## Parallel Work Model

Parallelism is story-scoped. Each agent or developer claims a story and works on a dedicated branch. The claim is stored in the story folder, while events are appended to a trace log.

For multiple Codex chats, one chat can act as parent orchestrator by reading `orchestrate status --json` and assigning available story lanes. Worker chats claim exactly one story, write attributed traces, record push/sync events, and release or hand off their claim when done.

Phase locks are reserved for shared artifacts that cannot be safely edited by multiple story lanes at once. Handoff records capture transfer between analysis, implementation, validation, and release agents.

This avoids one shared mutable planning document becoming a collaboration bottleneck.

For phase-by-phase examples, see [Agent Interactions](agent-interactions.md).

## Gate Model

Gate checks are mechanical validations over `.sdlc/` artifacts. They do not replace human judgment, but they catch missing contracts, missing acceptance criteria, incomplete traceability, stale claims, unapproved output templates, unjustified duplicate outputs, stale cache warnings, and release evidence gaps.

```mermaid
flowchart TB
  Gate["gate check --strict"] --> Contracts["Contracts approved"]
  Gate --> Stories["Story readiness"]
  Gate --> Traces["Attributed traces"]
  Gate --> OutputLinks["Output links"]
  Gate --> CachePolicy["Cache policy"]

  OutputLinks --> Templates["Approved templates"]
  OutputLinks --> DeltaBase["Delta has base artifact"]
  OutputLinks --> DuplicatePolicy["Duplicates have approved decision"]
  CachePolicy --> NoDerivedSource["Cache and indexes are not canonical"]

  Templates --> Result["Pass or fail"]
  DeltaBase --> Result
  DuplicatePolicy --> Result
  NoDerivedSource --> Result
```

## Extension Points

The CLI accepts a custom template directory through `--template-dir`. Teams can replace the SDLC phase configuration without changing the plugin code.

The schemas can be used by CI, pre-merge checks, or future MCP tools.

For the full project knowledge base layout, see [Knowledge Base Structure](kb-structure.md).
