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

3. When the user's request could map to different SDLC actions, normalize it into canonical route intent JSON and run `route decide`. Do not keyword-match the user's language. If confidence is low or the JSON is incomplete, ask for confirmation or missing context before acting:

   ```bash
   node <plugin-root>/bin/agentic-sdlc.mjs route decide \
     --root <target-project> \
     --intent-json '<canonical-route-intent-json>' \
     --json
   ```

4. Select the SDLC phase: `discovery`, `analysis`, `design`, `implementation`, `validation`, or `release`.
5. When a requirement needs decomposition, propose a work breakdown and dependency graph, then ask the user to approve or correct it before treating it as canonical:

   ```bash
   node <plugin-root>/bin/agentic-sdlc.mjs breakdown propose --root <target-project> --id BD-REQ-001 --requirement REQ-001 --item story:ST-001
   node <plugin-root>/bin/agentic-sdlc.mjs dependency propose --root <target-project> --id DEP-REQ-001 --edge ST-002:ST-001:requires_artifact:validation:artifact_linked
   ```

6. Before creating a contract, gather project-specific context from `.sdlc/`, user-provided files, repository files, or direct user answers. If critical context is missing, ask concise questions instead of inventing details.
7. Before technical analysis or a contract that depends on project-specific tooling, profile the project/story and propose capability recommendations. Do not keyword-match the user's language. Use repo files, `.sdlc/`, user files, or canonical JSON normalized by Codex:

   ```bash
   node <plugin-root>/bin/agentic-sdlc.mjs capability profile propose \
     --root <target-project> \
     --id CAP-PROFILE-ST-001 \
     --story ST-001 \
     --phase analysis \
     --context-file .sdlc/requirements/REQ-001.md

   node <plugin-root>/bin/agentic-sdlc.mjs capability profile approve \
     --root <target-project> \
     --id CAP-PROFILE-ST-001 \
     --actor-type human

   node <plugin-root>/bin/agentic-sdlc.mjs capability recommend \
     --root <target-project> \
     --id CAP-REC-ST-001 \
     --profile CAP-PROFILE-ST-001 \
     --available-capabilities-file .sdlc/decisions/available-capabilities.json
   ```

   Ask for approval before installing missing skills/plugins or using external, write, production, tenant, workspace, endpoint, or secret-bearing targets. Use `capability approve --approve-install` only when that installation approval was explicitly granted.

8. Decide the contract execution policy and capability policy with the user only when it matters. By default, leave model and reasoning as `inherit`, which means spawned Codex agents reuse the main Codex thread settings. Set `--model`, `--reasoning`, capability policies, capability bindings, or `--capability-recommendation` only when the user asks, the approved capability recommendation says so, or the project KB mandates them.
9. Create or update a phase contract before doing phase work. Pass known context and approved capability recommendations into the contract:

   ```bash
   node <plugin-root>/bin/agentic-sdlc.mjs contract create \
     --root <target-project> \
     --phase <phase> \
     --context-file .sdlc/requirements/REQ-001.md \
     --context-summary "Project-specific summary" \
     --qa "Who is the target user?|Back-office operators" \
     --capability-recommendation CAP-REC-ST-001 \
     --output-ref functional-analysis:functional-analysis-v1:new
   ```

10. Before creating a durable output artifact, resolve the project-wide output contract:

   ```bash
   node <plugin-root>/bin/agentic-sdlc.mjs output resolve --root <target-project> --story ST-001 --type functional-analysis
   ```

   If an approved template exists, use it. If a related story already covers the same requirement, prefer reuse plus delta. If no template exists or the structure must change, propose a template and ask the user to approve it before making it canonical:

   ```bash
   node <plugin-root>/bin/agentic-sdlc.mjs output template propose --root <target-project> --type functional-analysis --summary "..."
   node <plugin-root>/bin/agentic-sdlc.mjs output template approve --root <target-project> --id functional-analysis-v1 --actor-type human
   ```

11. Link every durable output back to story, requirement, approved template, and mode. The CLI records fingerprints, and strict gates fail if the artifact, base artifact, or approved template changes after linking:

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

12. For implementation work or parallel worker work, inspect the current orchestration state before editing:

   ```bash
   node <plugin-root>/bin/agentic-sdlc.mjs orchestrate status --root <target-project> --json
   ```

13. Create and claim a story before editing code. Include actor/run/thread attribution when available:

   ```bash
   node <plugin-root>/bin/agentic-sdlc.mjs story create --root <target-project> --id ST-001 --title "..."
   node <plugin-root>/bin/agentic-sdlc.mjs story claim --root <target-project> --id ST-001 --agent codex --branch feature/ST-001 --thread-id <thread-id>
   ```

14. Capture durable decisions, assumptions, risks, tests, handoffs, sync/push events, dependency revalidation, and release evidence as traces. Strict gates require `test` and `release` traces to include real evidence paths outside cache/index directories:

   ```bash
   node <plugin-root>/bin/agentic-sdlc.mjs trace append --root <target-project> --story ST-001 --type decision --summary "..." --actor codex --actor-type agent
   node <plugin-root>/bin/agentic-sdlc.mjs trace append --root <target-project> --story ST-001 --type test --summary "Tests passed" --evidence .sdlc/tests/ST-001-test-run.json
   node <plugin-root>/bin/agentic-sdlc.mjs sync record --root <target-project> --story ST-001 --event push --summary "Pushed feature/ST-001"
   ```

15. Use `story handoff` when passing work between chats or phases, and close it when the receiving lane accepts it. Use phase locks only for shared phase artifacts that multiple story lanes could modify.

16. Run a strict gate check before closing a phase or merging implementation work:

   ```bash
   node <plugin-root>/bin/agentic-sdlc.mjs gate check --root <target-project> --story ST-001 --strict --out .sdlc/reports/ST-001-gate-report.json
   ```

17. Release claims and locks when work is complete or handed off.

18. Rebuild/search the local cache and KB index when context retrieval is needed:

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
- verify approved breakdowns and dependency graph entries are satisfied when the story uses them;
- verify capability profiles and recommendations referenced by contracts are approved, fresh, and not missing install approvals;
- verify contract capability policies have required bindings or explicit open questions;
- verify story work is under `.sdlc/stories/<story-id>/`;
- verify decisions and evidence are captured in `.sdlc/traces/`;
- run `gate check`;
- report any errors or warnings instead of hiding them.
