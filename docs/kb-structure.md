# Knowledge Base Structure

Agentic SDLC uses a Git-first project knowledge base. The plugin is stateless; the KB is created inside each target project.

The sample records below use TravelOps as an example product. The structure is generic and should be reused for any project.

```text
<target-project>/
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

The source of truth is the human-readable and machine-readable files under `.sdlc/`:

- JSON for structured contracts, stories, claims, and machine validation.
- Markdown for narrative requirements, decisions, risks, plans, reports, and release notes.
- JSONL for append-only trace logs.

Indexes and reports are derived artifacts. They can be rebuilt from source files.

## `project.json`

Project metadata and KB policy.

Example:

```json
{
  "project_id": "travelops",
  "project_name": "TravelOps",
  "schema_version": "0.1.0",
  "sdlc_version": "0.1.0",
  "knowledge_base": {
    "storage": "git",
    "canonical_path": ".sdlc",
    "stateless_plugin": true,
    "concurrency_model": "story-scoped workspaces with append-only traces",
    "source_of_truth": "JSON and Markdown files under .sdlc",
    "derived_artifacts": ["indexes", "reports"]
  }
}
```

## `contracts/`

Contracts define how phases and story work must be executed and validated.

Examples:

```text
.sdlc/contracts/contract-discovery-v1.json
.sdlc/contracts/contract-analysis-v1.json
.sdlc/contracts/contract-ST-001-implementation.json
```

Contracts are generated from `templates/sdlc-config.json` and follow the shape documented in `templates/contract-template.json`.

Every generated contract is bound to the current project and records contextualization data:

```json
{
  "id": "contract-ST-001-analysis",
  "project": {
    "project_id": "travelops",
    "project_name": "TravelOps"
  },
  "phase": "analysis",
  "contextualization": {
    "summary": "Analyze the TravelOps MVP around disruption-aware travel replanning.",
    "context_sources": [
      {
        "path": ".sdlc/requirements/REQ-001.md",
        "sha256": "content-hash",
        "size_bytes": 1200,
        "excerpt": "Problem statement and constraints..."
      }
    ],
    "questions": [
      {
        "question": "Which weather provider is authoritative for MVP?",
        "answer": null,
        "status": "open"
      }
    ],
    "constraints": [
      "Provider-specific logic must stay behind an adapter"
    ],
    "assumptions": [
      "Weather provider sandbox access is available"
    ],
    "open_questions": 1
  }
}
```

## `requirements/`

Requirements and analysis artifacts.

Examples:

```text
.sdlc/requirements/REQ-001.md
.sdlc/requirements/non-functional-requirements.md
.sdlc/requirements/functional-analysis.md
.sdlc/requirements/integration-map.md
```

Agents should link stories and tests back to requirement IDs when possible.

## `stories/`

Story-scoped workspaces. This is the main parallel work unit.

Example:

```text
.sdlc/stories/ST-001/
  story.json
  claim.json
  plan.md
  implementation-log.md
```

`story.json` stores structured story data:

```json
{
  "id": "ST-001",
  "title": "Replan a trekking activity when rain is forecast",
  "status": "draft",
  "phase": "implementation",
  "contract_id": "contract-ST-001-implementation",
  "acceptance_criteria": [
    "Given rain during trekking, the itinerary proposes a compatible indoor alternative."
  ]
}
```

`claim.json` prevents accidental parallel writes to the same story:

```json
{
  "story_id": "ST-001",
  "agent": "codex",
  "branch": "feature/ST-001",
  "status": "active"
}
```

## `decisions/`

Decision records explain why a technical or product choice was made.

Recommended naming:

```text
.sdlc/decisions/ADR-0001-problem-framing.md
.sdlc/decisions/ADR-0002-weather-provider-strategy.md
```

Recommended content:

```text
# ADR-0002 Weather Provider Strategy

Status: Accepted
Context: ...
Decision: ...
Alternatives Considered: ...
Consequences: ...
Related: REQ-003, ST-001
```

## `assumptions/`

Explicit assumptions that need validation or later review.

Examples:

```text
.sdlc/assumptions/ASM-001-weather-refresh-rate.md
.sdlc/assumptions/ASM-002-user-location-permission.md
```

## `risks/`

Delivery, product, technical, operational, or compliance risks.

Examples:

```text
.sdlc/risks/RISK-001-map-api-cost.md
.sdlc/risks/RISK-002-weather-api-availability.md
```

## `tests/`

Test plans and test evidence.

Examples:

```text
.sdlc/tests/ST-001-test-strategy.md
.sdlc/tests/ST-001-test-run.json
.sdlc/tests/ST-001-validation-summary.md
```

Tests should link to acceptance criteria and requirements.

## `traces/`

Append-only JSONL event logs. Traces show what agents did, what they decided, and what evidence they produced.

Example:

```text
.sdlc/traces/ST-001.jsonl
```

Example event:

```json
{
  "id": "TR-20260701084828-7514f5",
  "story_id": "ST-001",
  "type": "decision",
  "summary": "Use weather events as replanning triggers",
  "actor": "codex",
  "evidence": [],
  "related": ["ADR-0002", "REQ-003"],
  "created_at": "2026-07-01T08:48:28.935Z"
}
```

Valid trace types:

```text
assumption, decision, gate, implementation, release, risk, test
```

## `releases/`

Release notes, rollout plans, observability signals, and feedback loops.

Examples:

```text
.sdlc/releases/REL-001.md
.sdlc/releases/observability-plan.md
.sdlc/releases/feedback-loop.md
```

## `indexes/`

Generated search indexes.

Example:

```text
.sdlc/indexes/kb-index.json
```

Rebuild with:

```bash
node bin/agentic-sdlc.mjs index rebuild --root <target-project>
```

## `reports/`

Generated gate, audit, or quality reports. Reports are useful review artifacts but should be reproducible from source KB files.

## Merge Strategy

Review `.sdlc/` changes with code changes. A pull request should show both:

- the implementation diff;
- the contract, story, decision, trace, and test evidence that explain the implementation.

This keeps agent work auditable after the chat session is gone.
