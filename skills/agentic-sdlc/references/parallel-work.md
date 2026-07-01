# Parallel Work

Agentic SDLC supports parallel work through story-scoped ownership and append-only traces.

## Rules

- One story should have one active claim at a time.
- Each claim should name the agent, branch, and optional expiry.
- Implementation work should happen on a story branch such as `feature/ST-001`.
- Agents should append trace events instead of rewriting shared history.
- Teams should merge `.sdlc/` artifacts with the code changes they explain.

## Recommended Flow

1. Create a story workspace.
2. Claim the story.
3. Work on a dedicated branch.
4. Append decisions, assumptions, implementation notes, and test evidence.
5. Run `gate check`.
6. Review code and `.sdlc/` changes together.

## Conflict Handling

If two agents need the same story, split the story or coordinate a claim transfer. Do not use `--force` on a claim unless a human has decided the previous claim is stale or invalid.
