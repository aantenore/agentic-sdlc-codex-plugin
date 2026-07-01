---
name: travelops-sdlc
description: Use this skill when a user wants to run a contract-driven agentic SDLC in Codex, initialize or maintain a shared project knowledge base, create SDLC phase contracts, split work into story-scoped parallel tracks, validate gates, capture decisions/tests/traces, or use the TravelOps SDLC plugin in a software project.
---

# TravelOps SDLC

## Purpose

Use this skill to operate a stateless, contract-driven SDLC for a target project. The plugin contains process templates, schemas, and CLI automation; all contracts, traces, and knowledge base artifacts must be saved inside the target project's `.sdlc/` directory.

## Core Rule

Never store project contracts or project KB state inside the plugin installation. Treat the plugin as reusable method code only. Treat `<target-project>/.sdlc/` as the project source of truth.

## Workflow

1. Identify the target project root. Default to the current workspace root unless the user names another project.
2. If `.sdlc/project.json` is missing, initialize the project:

   ```bash
   node <plugin-root>/bin/travelops-sdlc.mjs init --root <target-project> --project-name "<name>"
   ```

3. Select the SDLC phase: `discovery`, `analysis`, `design`, `implementation`, `validation`, or `release`.
4. Create or update a phase contract before doing phase work:

   ```bash
   node <plugin-root>/bin/travelops-sdlc.mjs contract create --root <target-project> --phase <phase>
   ```

5. For implementation work, create and claim a story before editing code:

   ```bash
   node <plugin-root>/bin/travelops-sdlc.mjs story create --root <target-project> --id ST-001 --title "..."
   node <plugin-root>/bin/travelops-sdlc.mjs story claim --root <target-project> --id ST-001 --agent codex --branch feature/ST-001
   ```

6. Capture durable decisions, assumptions, risks, tests, and release evidence as traces:

   ```bash
   node <plugin-root>/bin/travelops-sdlc.mjs trace append --root <target-project> --story ST-001 --type decision --summary "..."
   ```

7. Run a gate check before closing a phase or merging implementation work:

   ```bash
   node <plugin-root>/bin/travelops-sdlc.mjs gate check --root <target-project> --story ST-001
   ```

8. Rebuild/search the KB index when context retrieval is needed:

   ```bash
   node <plugin-root>/bin/travelops-sdlc.mjs index rebuild --root <target-project>
   node <plugin-root>/bin/travelops-sdlc.mjs kb search --root <target-project> "query"
   ```

## References

- Read `references/process.md` when explaining or executing the SDLC phases.
- Read `references/contracts.md` when creating or reviewing contracts.
- Read `references/knowledge-base.md` when initializing, sharing, or auditing `.sdlc/`.
- Read `references/parallel-work.md` when multiple agents or developers work concurrently.
- Read `references/commands.md` for CLI command details.

## Validation

Before claiming the SDLC is complete or a story is ready to merge:

- verify `.sdlc/project.json` exists in the target project;
- verify relevant contracts exist under `.sdlc/contracts/`;
- verify story work is under `.sdlc/stories/<story-id>/`;
- verify decisions and evidence are captured in `.sdlc/traces/`;
- run `gate check`;
- report any errors or warnings instead of hiding them.
