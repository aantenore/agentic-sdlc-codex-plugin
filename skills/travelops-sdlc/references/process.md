# SDLC Process

TravelOps SDLC keeps the classic SDLC sequence, but each phase is governed by an explicit contract and every durable decision is captured in the project knowledge base.

## Phases

1. Discovery
   - Define the problem, target users, constraints, competitors, process gaps, value hypothesis, and success metrics.
2. Analysis
   - Produce functional analysis, technical analysis, integration boundaries, API or mock strategy, edge cases, and risks.
3. Design
   - Convert analysis into stories, task decomposition, acceptance criteria, test strategy, UX notes, and architecture decisions.
4. Implementation
   - Implement story-scoped changes on dedicated branches with an active claim, tests, and trace evidence.
5. Validation
   - Validate against contracts, acceptance criteria, tests, risk mitigation, and release readiness.
6. Release
   - Produce release notes, deployment notes, observability signals, feedback loop, and updated project context.

## Operating Principle

The model proposes and executes bounded work. The harness, CLI, schemas, contracts, and human gates enforce the process. Human owners keep responsibility for objectives, architecture, trade-offs, and approvals.

## Phase Entry Checklist

- Current phase contract exists.
- Required inputs are present or missing inputs are logged as assumptions.
- Human gate expectations are explicit.
- KB writes for the phase are known.

## Phase Exit Checklist

- Required outputs exist.
- Validation criteria are satisfied or failures are recorded.
- Decisions, assumptions, risks, and evidence are traceable.
- Gate check has been run.
