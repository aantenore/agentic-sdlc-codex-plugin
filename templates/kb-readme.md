# {{PROJECT_NAME}} SDLC Knowledge Base

This directory is the shared source of truth for the project SDLC.

It is intentionally stored in the project repository so people and agents can collaborate through Git branches, pull requests, and code review.

## Operating Rules

- Keep durable knowledge in `.sdlc/`, not only in chat history.
- Work in story-scoped folders when possible.
- Append trace events instead of rewriting history.
- Link requirements, stories, decisions, tests, and release evidence.
- Run `agentic-sdlc gate check` before merging implementation work.
- Rebuild indexes when search quality matters; indexes are derived artifacts.

## Directory Map

```text
contracts/      Phase contracts and story-specific contracts
requirements/   Product requirements and constraints
stories/        Story workspaces, claims, plans, and evidence
decisions/      Architecture and product decision records
assumptions/    Explicit assumptions and their review status
risks/          Delivery, technical, product, and operational risks
tests/          Test plans, test evidence, and coverage notes
traces/         Append-only event logs
releases/       Release notes, rollout evidence, feedback loops
indexes/        Regenerable search indexes
reports/        Generated gate and audit reports
```

## Human Governance

Agents may propose, generate, validate, and summarize. Humans keep responsibility for goals, architecture, trade-offs, approvals, and high-risk decisions.
