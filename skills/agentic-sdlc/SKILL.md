---
name: agentic-sdlc
description: Use this skill when a user wants to run a contract-driven agentic SDLC in Codex, initialize or maintain a shared project knowledge base, create SDLC phase contracts, split work into story-scoped parallel tracks, validate gates, capture decisions/tests/traces, or use the Agentic SDLC plugin in a software project.
---

# Agentic SDLC

## Purpose

Use this skill to operate a stateless, contract-driven SDLC for a target project. The plugin contains process templates, schemas, and CLI automation; all contracts, output contracts, traces, and knowledge base artifacts must be saved inside the target project's `.sdlc/` directory.

## Core Rule

Never store project contracts or project KB state inside the plugin installation. Treat the plugin as reusable method code only. Treat `<target-project>/.sdlc/` as the project source of truth. Treat `<target-project>/.sdlc/cache/` and `<target-project>/.sdlc/indexes/` as derived local optimization artifacts, never as canonical evidence.

## Workflow

1. Identify the target project root. Default to the current workspace root unless the user names another project.
2. If `.sdlc/project.json` is missing, initialize the project:

   ```bash
   node <plugin-root>/bin/agentic-sdlc.mjs init --root <target-project> --project-name "<name>"
   ```

3. Select the SDLC phase: `discovery`, `analysis`, `design`, `implementation`, `validation`, or `release`.
4. Before creating a contract, gather project-specific context from `.sdlc/`, user-provided files, repository files, or direct user answers. If critical context is missing, ask concise questions instead of inventing details.
5. Decide the contract execution policy with the user only when it matters. By default, leave model and reasoning as `inherit`, which means spawned Codex agents reuse the main Codex thread settings. Set `--model` or `--reasoning` only when the user asks for a different Codex execution profile or the project KB already mandates one.
6. Create or update a phase contract before doing phase work. Pass known context into the contract:

   ```bash
   node <plugin-root>/bin/agentic-sdlc.mjs contract create \
     --root <target-project> \
     --phase <phase> \
     --context-file .sdlc/requirements/REQ-001.md \
     --context-summary "Project-specific summary" \
     --qa "Who is the target user?|Back-office operators" \
     --output-ref functional-analysis:functional-analysis-v1:new
   ```

7. Before creating a durable output artifact, resolve the project-wide output contract:

   ```bash
   node <plugin-root>/bin/agentic-sdlc.mjs output resolve --root <target-project> --story ST-001 --type functional-analysis
   ```

   If an approved template exists, use it. If a related story already covers the same requirement, prefer reuse plus delta. If no template exists or the structure must change, propose a template and ask the user to approve it before making it canonical:

   ```bash
   node <plugin-root>/bin/agentic-sdlc.mjs output template propose --root <target-project> --type functional-analysis --summary "..."
   node <plugin-root>/bin/agentic-sdlc.mjs output template approve --root <target-project> --id functional-analysis-v1 --actor-type human
   ```

8. Link every durable output back to story, requirement, approved template, and mode. The CLI records fingerprints, and strict gates fail if the artifact, base artifact, or approved template changes after linking:

   ```bash
   node <plugin-root>/bin/agentic-sdlc.mjs output link \
     --root <target-project> \
     --story ST-001 \
     --type functional-analysis \
     --artifact .sdlc/requirements/functional-analysis.md \
     --template functional-analysis-v1 \
     --mode new \
     --requirement REQ-001
   ```

9. For implementation work or parallel worker work, inspect the current orchestration state before editing:

   ```bash
   node <plugin-root>/bin/agentic-sdlc.mjs orchestrate status --root <target-project> --json
   ```

10. Create and claim a story before editing code. Include actor/run/thread attribution when available:

   ```bash
   node <plugin-root>/bin/agentic-sdlc.mjs story create --root <target-project> --id ST-001 --title "..."
   node <plugin-root>/bin/agentic-sdlc.mjs story claim --root <target-project> --id ST-001 --agent codex --branch feature/ST-001 --thread-id <thread-id>
   ```

11. Capture durable decisions, assumptions, risks, tests, handoffs, sync/push events, and release evidence as traces. Strict gates require `test` and `release` traces to include real evidence paths outside cache/index directories:

   ```bash
   node <plugin-root>/bin/agentic-sdlc.mjs trace append --root <target-project> --story ST-001 --type decision --summary "..." --actor codex --actor-type agent
   node <plugin-root>/bin/agentic-sdlc.mjs trace append --root <target-project> --story ST-001 --type test --summary "Tests passed" --evidence .sdlc/tests/ST-001-test-run.json
   node <plugin-root>/bin/agentic-sdlc.mjs sync record --root <target-project> --story ST-001 --event push --summary "Pushed feature/ST-001"
   ```

12. Use `story handoff` when passing work between chats or phases, and close it when the receiving lane accepts it. Use phase locks only for shared phase artifacts that multiple story lanes could modify.

13. Run a strict gate check before closing a phase or merging implementation work:

   ```bash
   node <plugin-root>/bin/agentic-sdlc.mjs gate check --root <target-project> --story ST-001 --strict --out .sdlc/reports/ST-001-gate-report.json
   ```

14. Release claims and locks when work is complete or handed off.

15. Rebuild/search the local cache and KB index when context retrieval is needed:

   ```bash
   node <plugin-root>/bin/agentic-sdlc.mjs cache rebuild --root <target-project>
   node <plugin-root>/bin/agentic-sdlc.mjs cache status --root <target-project>
   node <plugin-root>/bin/agentic-sdlc.mjs index rebuild --root <target-project>
   node <plugin-root>/bin/agentic-sdlc.mjs kb search --root <target-project> "query"
   ```

## References

- Read `references/process.md` when explaining or executing the SDLC phases.
- Read `references/contract-generation.md` before creating or revising contracts.
- Read `references/contracts.md` when creating or reviewing contracts.
- Read `references/knowledge-base.md` when initializing, sharing, or auditing `.sdlc/`.
- Read `references/parallel-work.md` when multiple agents or developers work concurrently.
- Read `references/commands.md` for CLI command details.

## Validation

Before claiming the SDLC is complete or a story is ready to merge:

- verify `.sdlc/project.json` exists in the target project;
- verify relevant contracts exist under `.sdlc/contracts/`;
- verify durable outputs are linked in `.sdlc/output-contracts/registry.json` with approved templates;
- verify story work is under `.sdlc/stories/<story-id>/`;
- verify decisions and evidence are captured in `.sdlc/traces/`;
- run `gate check`;
- report any errors or warnings instead of hiding them.
