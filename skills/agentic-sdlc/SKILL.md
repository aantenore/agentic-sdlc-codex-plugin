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

   For an existing repository with useful current code, docs, or configuration, prefer onboarding so the KB starts with an explicit proposed baseline instead of pretending the historical SDLC is known:

   ```bash
   node <plugin-root>/bin/agentic-sdlc.mjs onboard existing-project \
     --root <target-project> \
     --project-name "<name>" \
     --document README.md \
     --question "Which inferred facts are canonical?"
   ```

   Treat `.sdlc/baseline/<id>.json` as proposed until the user explicitly confirms what is canonical. When asking for that confirmation, summarize the baseline contents in chat: inferred project summary, documents read, detected stack, important files, assumptions, and open questions. Do not tell the user to inspect `.sdlc/baseline/<id>.json` or `<id>-current-state.md` manually as the main approval path; links are supporting evidence only.

3. When the user invokes Agentic SDLC for project context, discovery, analysis, assessment, design, implementation, validation, release, or any other phase work, first normalize the request into canonical route intent JSON and run `task start` before doing the work. Do not treat natural-language requests such as "initial technical assessment" as permission to analyze directly; normalize them to the closest configured action, for example `technical_analysis` with `artifact_type` `technical-analysis`. Do not keyword-match inside the CLI. `task start` wraps route decision plus contract readiness: proceed only when it returns `ready_to_execute`. If it returns `needs_user_input`, `needs_normalization`, or `contract_revision_required`, show the returned `assistant_message` when available, translate it to the active chat language, ask the user, and stop. Do not lead with raw fields such as `blocking_reasons`, status codes, baseline, template, or contract. Explain them first in practical terms: trusted project context, assessment format, and work brief. If the approval depends on files, summarize the relevant file contents directly in chat before asking for a decision.

   ```bash
   node <plugin-root>/bin/agentic-sdlc.mjs task start \
     --root <target-project> \
     --intent-json '<canonical-route-intent-json>' \
     --json
   ```

   Use `--confirm-start` only after the user explicitly confirms the concrete task start. This is operational authorization, not formal SDLC approval.

4. Select the SDLC phase: `discovery`, `analysis`, `design`, `implementation`, `validation`, or `release`.
5. When a requirement needs decomposition, propose a work breakdown and dependency graph, then ask the user to approve or correct it before treating it as canonical:

   ```bash
   node <plugin-root>/bin/agentic-sdlc.mjs breakdown propose --root <target-project> --id BD-REQ-001 --requirement REQ-001 --item story:ST-001
   node <plugin-root>/bin/agentic-sdlc.mjs dependency propose --root <target-project> --id DEP-REQ-001 --edge ST-002:ST-001:requires_artifact:validation:artifact_linked
   ```

6. Before creating a contract, gather project-specific context from `.sdlc/`, user-provided files, repository files, or direct user answers. If critical context, output format, acceptance criteria, or a phase-guiding decision is missing, ask concise questions and stop instead of inventing details or creating a vague contract. Use `--allow-incomplete-contract` only for explicit clarification, migration, or recovery drafts, never to start phase work.
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
     --actor-type human \
     --approval-source explicit-user \
     --summary "<user-approved profile>"

   node <plugin-root>/bin/agentic-sdlc.mjs capability recommend \
     --root <target-project> \
     --id CAP-REC-ST-001 \
     --profile CAP-PROFILE-ST-001 \
     --available-capabilities-file .sdlc/decisions/available-capabilities.json
   ```

   Ask for approval before installing missing skills/plugins or using external, write, production, tenant, workspace, endpoint, or secret-bearing targets. When presenting capability artifacts, translate the names first: a capability profile means "the evidence, checks, and tool boundaries I may consider"; a capability recommendation means "the concrete tools, permissions, targets, and install decisions I want to use." Explain whether you need more information, whether installs or external access are involved, what approval allows, and what it does not approve. When `capability profile propose` or `capability recommend` returns `assistant_message`, show that content to the user instead of summarizing only IDs. Use `capability approve --approve-install` only when that installation approval was explicitly granted.

   Formal SDLC approvals are not implied by a user asking the agent to implement or push. Before any `approve` command with `--actor-type human`, ask for explicit confirmation of the specific artifact and record it with `--approval-source explicit-user` plus `--summary` or `--approval-evidence`. A short approval such as "ok", "yes", or "approve" applies only to the artifact or decision that was immediately shown and summarized to the user. Never reuse that approval for later artifacts, capability profiles, capability recommendations, output templates, contracts, or task start confirmations. Each newly created or changed artifact must be summarized and approved separately. Use `--approval-source bootstrap` only for migration/provisional records; bootstrap approvals do not satisfy strict gates by default.

8. Decide the contract execution policy and capability policy with the user only when it matters. By default, leave model and reasoning as `inherit`, which means spawned Codex agents reuse the main Codex thread settings. Set `--model`, `--reasoning`, capability policies, capability bindings, or `--capability-recommendation` only when the user asks, the approved capability recommendation says so, or the project KB mandates them.
9. Before creating a phase/story contract that will produce a durable output, resolve the output type. If there is no approved output template for that step/type, propose the template, summarize it to the user using the returned `assistant_message` or `approval requests`, and stop. Do not create a contract that references a draft template and do not produce the phase output until the user agrees the format:

   ```bash
   node <plugin-root>/bin/agentic-sdlc.mjs output resolve --root <target-project> --story ST-001 --type functional-analysis
   node <plugin-root>/bin/agentic-sdlc.mjs output template propose --root <target-project> --type functional-analysis --summary "..."
   node <plugin-root>/bin/agentic-sdlc.mjs approval requests --root <target-project> --story ST-001
   ```

10. Create or update a phase contract before doing phase work. Normal contract creation must include enough agreed context to guide the phase, zero unresolved open questions, and `--output-ref` for story contracts that produce durable outputs. Story contract creation auto-populates `story.contract_id`; use `--replace-story-contract` only for explicit renegotiation or recovery. Creating a draft contract is a proposal, not approval to proceed. After creating or finding an unapproved contract, summarize it to the user through `approval requests` and stop until the user explicitly approves, answers, or requests changes. Show the returned `assistant_message` whenever available: it explains what is being approved, what approval means, and what will happen next. When `assistant_message_presentation.translate_to_chat_language` is true, translate and contextualize that message in the active chat language yourself before showing it to the user; preserve artifact IDs, story IDs, contract IDs, template IDs, file paths, CLI commands, status codes, and schema keys exactly when they must be referenced. Keep the primary explanation non-technical: say "project context" before baseline, "tools and permissions profile" before capability profile, "tool choices" before capability recommendation, "assessment format" before template, and "work brief" before contract. Never say only "I prepared BASELINE-INITIAL, technical-analysis-v1, CAP-PROFILE..." and ask for approval; for every prepared artifact, show what is inside it, what decision is needed, what information is missing, and what approval does not cover. Do not collapse an approval request into a bare question or approval phrase: show what context will be used, what output structure is being agreed, what work is being authorized, how the result will be delivered, whether more information is needed, and what the user can answer naturally. Do not send the user to read JSON or Markdown by themselves as the main approval flow; summarize the meaningful content in chat and keep paths as evidence. Approval scope is single-use and artifact-specific: after the user approves a baseline, you may approve only that baseline; if you then create a template or contract, stop and ask again. Do not produce technical/functional analysis, implementation outputs, tests, or release evidence for that phase before the contract is approved:

   ```bash
   node <plugin-root>/bin/agentic-sdlc.mjs contract create \
     --root <target-project> \
     --phase <phase> \
     --context-file .sdlc/requirements/REQ-001.md \
     --context-summary "Project-specific summary" \
     --qa "Who is the target user?|Back-office operators" \
     --capability-recommendation CAP-REC-ST-001 \
     --output-ref functional-analysis:functional-analysis-v1:new
   node <plugin-root>/bin/agentic-sdlc.mjs approval requests --root <target-project> --story ST-001
   ```

11. Before creating a durable output artifact, resolve the project-wide output contract:

   ```bash
   node <plugin-root>/bin/agentic-sdlc.mjs output resolve --root <target-project> --story ST-001 --type functional-analysis
   ```

   If an approved template exists, use it. If a related story already covers the same requirement, prefer reuse plus delta. If no template exists or the structure must change, propose a template and ask the user to approve it before making it canonical:

   ```bash
   node <plugin-root>/bin/agentic-sdlc.mjs output template propose --root <target-project> --type functional-analysis --summary "..."
   node <plugin-root>/bin/agentic-sdlc.mjs output template approve --root <target-project> --id functional-analysis-v1 --actor-type human --approval-source explicit-user --summary "<user-approved template>"
   ```

12. Link every durable output back to story, requirement, approved template, and mode. `output link` requires the story contract to be approved and fresh unless `--allow-unapproved-contract-output` is being used for explicit migration/recovery. The CLI records fingerprints, and strict gates fail if the artifact, base artifact, or approved template changes after linking:

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

13. For implementation work or parallel worker work, inspect the current orchestration state before editing:

   ```bash
   node <plugin-root>/bin/agentic-sdlc.mjs orchestrate status --root <target-project> --json
   ```

14. Create and claim a story before editing code. Include actor/run/thread attribution when available:

   ```bash
   node <plugin-root>/bin/agentic-sdlc.mjs story create --root <target-project> --id ST-001 --title "..."
   node <plugin-root>/bin/agentic-sdlc.mjs story claim --root <target-project> --id ST-001 --agent codex --branch feature/ST-001 --thread-id <thread-id>
   ```

15. Capture durable decisions, assumptions, risks, tests, handoffs, sync/push events, dependency revalidation, and release evidence as traces. Strict gates require `test` and `release` traces to include real evidence paths outside cache/index directories:

   ```bash
   node <plugin-root>/bin/agentic-sdlc.mjs trace append --root <target-project> --story ST-001 --type decision --summary "..." --actor codex --actor-type agent
   node <plugin-root>/bin/agentic-sdlc.mjs trace append --root <target-project> --story ST-001 --type implementation --summary "Codex implemented the requested change" --actor codex --actor-type agent --requested-by antonioantenore --requested-by-type human --request-summary "User-requested change"
   node <plugin-root>/bin/agentic-sdlc.mjs trace append --root <target-project> --story ST-001 --type test --summary "Tests passed" --evidence .sdlc/tests/ST-001-test-run.json
   node <plugin-root>/bin/agentic-sdlc.mjs sync record --root <target-project> --story ST-001 --event push --summary "Pushed feature/ST-001"
   ```

   Keep `actor` as the executor. When an agent acts because a human or another system requested it, record `requested_by`; when execution was explicitly authorized, record `authorized_by`. This lets reports answer both "what did Codex execute?" and "what was done on Antonio's request?" without rewriting attribution.

16. When a phase lane is complete, record the step with hashed evidence. `story complete-step` requires the story contract to be approved and fresh unless `--allow-unapproved-contract-output` is being used for explicit migration/recovery. If the step produced a durable artifact, pass `--type` so the CLI verifies the output is linked in the registry:

   ```bash
   node <plugin-root>/bin/agentic-sdlc.mjs story complete-step \
     --root <target-project> \
     --id ST-001 \
     --step functional-analysis \
     --type functional-analysis \
     --summary "Functional analysis accepted for implementation"
   ```

17. Use `story prepare-handoff` when passing work between chats, machines, or phases. Use `--release-claim` only when the next agent should be able to claim the story after pulling the shared KB:

   ```bash
   node <plugin-root>/bin/agentic-sdlc.mjs story prepare-handoff \
     --root <target-project> \
     --id ST-001 \
     --to-agent implementation-agent \
     --release-claim \
     --summary "Ready for implementation"
   ```

   Close the handoff when the receiving lane accepts it. Use phase locks only for shared phase artifacts that multiple story lanes could modify.

18. Run a strict gate check before closing a phase or merging implementation work:

   ```bash
   node <plugin-root>/bin/agentic-sdlc.mjs gate check --root <target-project> --story ST-001 --strict --out .sdlc/reports/ST-001-gate-report.json
   ```

19. Release claims and locks when work is complete or handed off.

20. Rebuild/search the local cache and KB index when context retrieval is needed. For large KBs, rebuild the shared manifest and use non-destructive trace compaction before relying on long raw trace history:

   ```bash
   node <plugin-root>/bin/agentic-sdlc.mjs manifest rebuild --root <target-project>
   node <plugin-root>/bin/agentic-sdlc.mjs trace compact --root <target-project> --story ST-001
   node <plugin-root>/bin/agentic-sdlc.mjs cache rebuild --root <target-project>
   node <plugin-root>/bin/agentic-sdlc.mjs cache status --root <target-project>
   node <plugin-root>/bin/agentic-sdlc.mjs index rebuild --root <target-project>
   node <plugin-root>/bin/agentic-sdlc.mjs kb search --root <target-project> "query"
   ```

21. Use activity reports or report queries when the user asks what happened, who changed something, which stories were created, which outputs changed, or similar history questions. For raw natural language, normalize the request into canonical report query JSON first; do not keyword-match the user's language in the CLI. Reports must cite canonical source files and must not infer unstored history:

   ```bash
   node <plugin-root>/bin/agentic-sdlc.mjs report activity --root <target-project> --since 3d --view business --out .sdlc/reports/activity.md
   node <plugin-root>/bin/agentic-sdlc.mjs report query --root <target-project> --query-json '<canonical-report-query-json>' --json
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
- verify existing-project baselines are approved only after explicit user/CI confirmation;
- verify relevant contracts exist under `.sdlc/contracts/`;
- verify durable outputs are linked in `.sdlc/output-contracts/registry.json` with approved templates;
- verify approved breakdowns and dependency graph entries are satisfied when the story uses them;
- verify capability profiles and recommendations referenced by contracts are approved, fresh, and not missing install approvals;
- verify contract capability policies have required bindings or explicit open questions;
- verify story work is under `.sdlc/stories/<story-id>/`;
- verify decisions and evidence are captured in `.sdlc/traces/`;
- verify completed story lanes have step records under `.sdlc/stories/<story-id>/steps/` when work is handed off;
- verify activity reports, manifests, and trace compactions cite canonical source paths and do not use cache/index as evidence;
- verify approvals include `approval_source` and do not treat implementation permission as artifact approval;
- run `gate check`;
- report any errors or warnings instead of hiding them.
