# Agent Interactions

Agentic SDLC models software delivery as a sequence of contract-governed agent handoffs. The plugin is stateless; every project-specific artifact is written under the target project's `.sdlc/` directory.

The examples below use a TravelOps-style travel-planning product as sample context. The plugin behavior is not tied to that domain.

## Interaction Pattern

Each phase follows the same loop:

```text
phase contract
  -> agent reads required inputs from .sdlc/
  -> agent produces phase outputs
  -> agent appends trace evidence
  -> gate check validates required artifacts
  -> human approves or sends the phase back for repair
  -> next agent receives structured inputs
```

The model is not "agents freely coding." It is bounded execution:

- contracts define the work;
- the KB stores the durable context;
- traces explain what happened;
- gates catch missing evidence;
- humans approve important transitions.

## Contract Builder Behavior

The contract-building agent is generic. It does not know the project domain in advance. Before creating a contract it should:

1. Read `.sdlc/project.json`.
2. Search or inspect relevant `.sdlc/` artifacts.
3. Read user-provided files when the user points to them.
4. Ask concise questions for missing critical context.
5. Store the evidence, answers, assumptions, constraints, and open questions inside the generated contract.

Example:

```bash
node bin/agentic-sdlc.mjs contract create \
  --phase analysis \
  --context-file .sdlc/requirements/REQ-001.md \
  --context-summary "Analyze the TravelOps MVP around disruption-aware travel replanning." \
  --qa "Who approves this phase?|Product owner" \
  --question "Which weather provider is authoritative for MVP?" \
  --constraint "Provider-specific logic must stay behind an adapter"
```

## Example 1: Discovery Agent

The Discovery Agent starts from an idea or product request.

```bash
node bin/agentic-sdlc.mjs init --project-name "TravelOps"
node bin/agentic-sdlc.mjs contract create --phase discovery
```

Reads:

```text
.sdlc/project.json
.sdlc/contracts/contract-discovery-v1.json
.sdlc/requirements/
.sdlc/assumptions/
```

Produces:

```text
.sdlc/requirements/REQ-001.md
.sdlc/assumptions/ASM-001.md
.sdlc/risks/RISK-001.md
.sdlc/decisions/ADR-0001-problem-framing.md
```

Trace example:

```bash
node bin/agentic-sdlc.mjs trace append \
  --type decision \
  --summary "Target the MVP on disruption-aware travel replanning instead of generic itinerary generation."
```

Handoff to Analysis:

```text
Problem statement, target users, constraints, competitor alternatives,
discarded options, and success metrics are now durable KB artifacts.
```

## Example 2: Analysis Agent

The Analysis Agent turns discovery output into functional and technical boundaries.

```bash
node bin/agentic-sdlc.mjs contract create --phase analysis
```

Reads:

```text
.sdlc/requirements/
.sdlc/assumptions/
.sdlc/risks/
.sdlc/decisions/
.sdlc/contracts/contract-analysis-v1.json
```

Produces:

```text
.sdlc/requirements/functional-analysis.md
.sdlc/requirements/integration-map.md
.sdlc/risks/RISK-002-weather-api-availability.md
.sdlc/decisions/ADR-0002-weather-provider-strategy.md
```

Trace example:

```bash
node bin/agentic-sdlc.mjs trace append \
  --type assumption \
  --summary "Weather data can be refreshed at itinerary checkpoint granularity for MVP."
```

Handoff to Design:

```text
Functional flows, edge cases, API/mock strategy, and integration risks.
```

## Example 3: Design Agent

The Design Agent converts analysis into story workspaces and acceptance criteria.

```bash
node bin/agentic-sdlc.mjs contract create --phase design
node bin/agentic-sdlc.mjs story create \
  --id ST-001 \
  --title "Replan a trekking activity when rain is forecast" \
  --phase design \
  --acceptance "Given rain during trekking, the itinerary proposes a compatible indoor alternative."
```

Reads:

```text
.sdlc/requirements/functional-analysis.md
.sdlc/requirements/integration-map.md
.sdlc/decisions/
.sdlc/risks/
```

Produces:

```text
.sdlc/stories/ST-001/story.json
.sdlc/stories/ST-001/plan.md
.sdlc/stories/ST-001/implementation-log.md
.sdlc/tests/ST-001-test-strategy.md
.sdlc/decisions/ADR-0003-replanning-scope.md
```

Handoff to Implementation:

```text
Story ID, acceptance criteria, active contract, planned branch,
test strategy, and relevant decisions.
```

## Example 4: Implementation Agent

The Implementation Agent works only after a story has been claimed.

```bash
node bin/agentic-sdlc.mjs contract create \
  --phase implementation \
  --story ST-001 \
  --id contract-ST-001-implementation

node bin/agentic-sdlc.mjs story claim \
  --id ST-001 \
  --agent codex \
  --branch feature/ST-001
```

Reads:

```text
.sdlc/stories/ST-001/story.json
.sdlc/stories/ST-001/claim.json
.sdlc/contracts/contract-ST-001-implementation.json
.sdlc/tests/ST-001-test-strategy.md
.sdlc/decisions/
```

Produces:

```text
application code changes
.sdlc/stories/ST-001/implementation-log.md
.sdlc/traces/ST-001.jsonl
.sdlc/tests/ST-001-test-run.json
```

Trace examples:

```bash
node bin/agentic-sdlc.mjs trace append \
  --story ST-001 \
  --type implementation \
  --summary "Added weather-triggered replanning service and fallback activity selector."

node bin/agentic-sdlc.mjs trace append \
  --story ST-001 \
  --type test \
  --summary "Unit and integration tests passed for rain-triggered replanning."
```

Handoff to Validation:

```text
Code diff, implementation log, test evidence, unresolved risks,
and trace events linked to the story.
```

## Example 5: Validation Agent

The Validation Agent checks whether the story satisfies its contract and acceptance criteria.

```bash
node bin/agentic-sdlc.mjs gate check --story ST-001
```

Reads:

```text
.sdlc/stories/ST-001/story.json
.sdlc/contracts/contract-ST-001-implementation.json
.sdlc/traces/ST-001.jsonl
.sdlc/tests/
.sdlc/risks/
```

Produces:

```text
.sdlc/reports/ST-001-gate-report.md
.sdlc/tests/ST-001-validation-summary.md
.sdlc/traces/ST-001.jsonl
```

Trace example:

```bash
node bin/agentic-sdlc.mjs trace append \
  --story ST-001 \
  --type gate \
  --summary "Validation gate passed with test evidence linked."
```

Handoff to Release:

```text
Gate result, validation summary, accepted risks, and release notes input.
```

## Example 6: Release Agent

The Release Agent packages the validated change and keeps feedback observable.

Reads:

```text
.sdlc/reports/
.sdlc/tests/
.sdlc/traces/
.sdlc/decisions/
.sdlc/risks/
```

Produces:

```text
.sdlc/releases/REL-001.md
.sdlc/releases/observability-plan.md
.sdlc/releases/feedback-loop.md
.sdlc/traces/ST-001.jsonl
```

Trace example:

```bash
node bin/agentic-sdlc.mjs trace append \
  --story ST-001 \
  --type release \
  --summary "Released disruption-aware replanning MVP with weather signal monitoring."
```

## Parallel Agent Example

Two agents can work at the same time when work is split by story:

```text
Agent A
  story: ST-001
  branch: feature/ST-001
  trace: .sdlc/traces/ST-001.jsonl

Agent B
  story: ST-002
  branch: feature/ST-002
  trace: .sdlc/traces/ST-002.jsonl
```

They share global context through `.sdlc/requirements`, `.sdlc/decisions`, and `.sdlc/risks`, but their active work and evidence stay story-scoped.

## Human Governance

Humans approve phase gates, resolve conflicting decisions, split stories, accept risks, and decide when a trace or contract must be corrected. Agents can propose changes and produce evidence, but they should not silently bypass gates.
