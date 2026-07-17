---
name: agentic-sdlc
description: Use this skill when a user wants to run a contract-driven agentic SDLC in Codex, initialize or maintain a shared project knowledge base, create SDLC phase contracts, split work into story-scoped parallel tracks, validate gates, capture decisions/tests/traces, or use the Agentic SDLC plugin in a software project.
---

# Agentic SDLC

## Purpose

Use this skill to operate a stateless, contract-driven SDLC for a target project. The plugin contains process templates, schemas, and CLI automation; all requirements, execution profiles, contracts, output contracts, traces, and knowledge base artifacts must be saved inside the target project's `.sdlc/` directory.

For a request to contextualize an existing project and produce a technical, functional, architecture, or product assessment, load `../agentic-sdlc-assessment/SKILL.md` and follow that dedicated journey. It is the product entry point for assessments and has exactly two normal plain-language checkpoints. The assessment proposal, budget, contract draft, route intent, write-set, and verification plan form one hash-bound execution tranche. Do not expand it into separate capability, template, contract, budget, and start questions.

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

3. When the user invokes Agentic SDLC for project context, discovery, analysis, design, implementation, validation, release, or other generic phase work, normalize the request into canonical route intent JSON and run `task start` before doing the work. For an assessment, follow the dedicated skill instead: approve the baseline, prepare and approve the immutable combined proposal, apply it idempotently, then run the proposal-bound task start. Do not treat natural-language requests such as "initial technical assessment" as permission to analyze directly. Do not keyword-match inside the CLI. Proceed only when the relevant start decision is `ready_to_execute`. That decision must include an approved requirement ceiling and, for implementation or release delivery, an explicit profile for the current pull request or local release. If it needs input or revision, explain the practical boundary before asking. If approval depends on files, summarize their meaningful content directly in chat.

   ```bash
   node <plugin-root>/bin/agentic-sdlc.mjs task start \
     --root <target-project> \
     --intent-json '<canonical-route-intent-json>' \
     --json
   ```

   Use `--confirm-start` only after the user explicitly confirms the concrete task start or grants a persistent authorization that includes `task.start.confirm`. An agent or system confirmation must cite that grant with `--authorization <id>`. This is operational authorization, not formal SDLC approval.

4. Select the SDLC phase: `discovery`, `analysis`, `design`, `implementation`, `validation`, or `release`.
5. Agree the requirement before treating decomposition as canonical. New requirements use `requirement:v2` and move through `propose`, `approve`, `revise`, and `supersede`; `requirement create` is only a compatibility alias for a proposal and must not create approved authority. Capture outcome, acceptance criteria, non-goals, constraints, NFRs, integrations, source hashes, revision lineage, and the linked requirement execution profile. That profile sets an autonomy ceiling and is not an executable grant. A material change creates a new revision and invalidates downstream profiles bound to the prior hash.

   ```bash
   node <plugin-root>/bin/agentic-sdlc.mjs requirement propose \
     --root <target-project> \
     --id REQ-001 \
     --title "Bounded outcome" \
     --summary "Agreed outcome and material scope" \
     --acceptance "Observable acceptance evidence exists" \
     --autonomy-ceiling checkpointed

   node <plugin-root>/bin/agentic-sdlc.mjs requirement approve \
     --root <target-project> \
     --id REQ-001 \
     --actor-type human \
     --approval-source explicit-user \
     --summary "Approve this requirement revision and ceiling"

   node <plugin-root>/bin/agentic-sdlc.mjs autonomy requirement status \
     --root <target-project> \
     --id REQ-001
   ```

   After approval, when the requirement needs decomposition, propose a work breakdown and dependency graph, then ask the user to approve or correct it before treating it as canonical:

   ```bash
   node <plugin-root>/bin/agentic-sdlc.mjs breakdown propose --root <target-project> --id BD-REQ-001 --requirement REQ-001 --item story:ST-001
   node <plugin-root>/bin/agentic-sdlc.mjs dependency propose --root <target-project> --id DEP-REQ-001 --edge ST-002:ST-001:requires_artifact:validation:artifact_linked
   ```

6. Before creating a contract, gather project-specific context from `.sdlc/`, user-provided files, repository files, or direct user answers. If critical context, output format, acceptance criteria, delivery target, autonomy choice, or a phase-guiding decision is missing, ask concise questions and stop instead of inventing details or creating a vague contract. Use `--allow-incomplete-contract` only for explicit clarification, migration, or recovery drafts, never to start phase work.
7. Before technical analysis or a contract that depends on project-specific tooling, profile the project/story and propose capability recommendations. Do not keyword-match the user's language. Use repo files, `.sdlc/`, user files, or canonical JSON normalized by Codex:

   ```bash
   node <plugin-root>/bin/agentic-sdlc.mjs capability profile propose \
     --root <target-project> \
     --id CAP-PROFILE-ST-001 \
     --story ST-001 \
     --phase analysis \
     --context-file .sdlc/requirements/REQ-001.json

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

   Ask for approval before installing missing skills/plugins or using external, write, production, tenant, workspace, endpoint, or secret-bearing targets. When presenting internal capability artifacts, do not teach the SDLC model to the user. Translate them into business/work language: "project evidence and boundaries" means the files, checks, and tool limits I may rely on; "allowed tools for this work" means the concrete tools, permissions, targets, and install decisions I want to use. Explain whether you need more information, whether installs or external access are involved, what approval allows, and what it does not approve. When `capability profile propose` or `capability recommend` returns `assistant_message`, show the business-facing explanation instead of summarizing only IDs. The explanation must be large enough to approve from chat: say what artifact was produced, what is inside it, what decision is needed, and what approval does not cover. If a CLI freshness/hash/stale check appears, do not expose those internal terms as the primary explanation. Say what it means operationally: for example, "I am refreshing the internal reference to the approved tools boundary; this does not change what you approved." Ask again only if the allowed files, tools, installs, external access, output, or work scope changed. Use `capability approve --approve-install` only when that installation approval was explicitly granted.

   Formal SDLC approvals are not implied by a user asking the agent to implement or push. A direct human or CI approval needs host- or CI-issued evidence; an agent-supplied `actor-type human` flag is not authority. By default, a short approval such as "ok", "yes", or "approve" applies only to the immutable subject immediately shown. Assessment checkpoint 2 must create a host approval receipt and proposal-bound content authorization with exact actions, subject hashes, artifact types, use policy, and authority assurance. Every automated use records a validity-at-use receipt. Free-text scope is not an automation credential. A broader delegated scope can cover later artifacts only inside the same immutable delivery unit; it can never supply the required autonomy choice for another pull request or local release. Delegated automation never covers installs, protected-branch merge, remote deploys, secrets, external services, production, destructive actions, or unrelated work unless the exact action and target were explicitly displayed and authoritatively approved. Use bootstrap only for migration/provisional records; it does not satisfy strict gates by default.

8. Decide the contract execution policy and capability policy with the user only when it matters. By default, leave model and reasoning as `inherit`, which means spawned Codex agents reuse the main Codex thread settings. Set `--model`, `--reasoning`, capability policies, capability bindings, or `--capability-recommendation` only when the user asks, the approved capability recommendation says so, or the project KB mandates them.
9. Before creating a phase/story contract that will produce a durable output, resolve the output type. If there is no approved output template for that step/type, propose the template, summarize it to the user using the returned `assistant_message` or `approval requests`, and stop. Do not create a contract that references a draft template and do not produce the phase output until the user agrees the format:

   ```bash
   node <plugin-root>/bin/agentic-sdlc.mjs output resolve --root <target-project> --story ST-001 --type functional-analysis
   node <plugin-root>/bin/agentic-sdlc.mjs output template propose --root <target-project> --type functional-analysis --summary "..."
   node <plugin-root>/bin/agentic-sdlc.mjs approval requests --root <target-project> --story ST-001
   ```

10. Create or locate the story first, then create its final phase contract before doing phase work. It must include enough agreed context, zero unresolved open questions, exact requirement execution profile references, and `--output-ref` for durable story outputs. When delivery work is in scope, reserve a new stable profile ID and store it through `--delivery-profile`; this writes only the planned `delivery_execution_profile_id`, not a delivery-profile hash or approval. Approve the contract before step 13 creates the matching profile against the approved hashes. Never rewrite the approved contract to point back to that profile. A contract or phase override may narrow the effective autonomy level but never widen it.

   Story contract creation auto-populates `story.contract_id`; use `--replace-story-contract` only for explicit renegotiation or recovery. Contract creation is a proposal, not approval to proceed. Summarize the complete contract through `approval requests` and stop until the user explicitly approves, answers, requests changes, or has already granted a broader contract-approval scope that clearly covers it. A broader contract approval never supplies the mandatory autonomy choice for a new delivery unit.

   Show the returned `assistant_message` whenever available: it explains what is being approved, what approval means, and what happens next. When `assistant_message_presentation.translate_to_chat_language` is true, translate and contextualize it in the active chat language while preserving artifact IDs, story IDs, contract IDs, template IDs, file paths, CLI commands, status codes, and schema keys. Keep the primary explanation non-technical and business-facing: say "project context" before baseline, "project evidence and boundaries" before capability profile, "allowed tools for this work" before capability recommendation, "assessment format" before template, and "work brief" before contract. For every prepared artifact, show what it contains, what decision is needed, what is missing, what approval authorizes, and what it does not authorize. Give enough detail for a decision in chat; do not make JSON or Markdown the primary approval flow. Approval scope is single-use and artifact-specific unless the user explicitly grants a broader in-delivery scope. Ask again for every new delivery unit. Do not produce technical/functional analysis, implementation outputs, tests, or release evidence before the contract is approved:

   ```bash
   node <plugin-root>/bin/agentic-sdlc.mjs story create --root <target-project> --id ST-001 --title "..." --requirement REQ-001
   node <plugin-root>/bin/agentic-sdlc.mjs contract create \
     --root <target-project> \
     --phase <phase> \
     --story ST-001 \
     --context-file .sdlc/requirements/REQ-001.json \
     --context-summary "Project-specific summary" \
     --qa "Who is the target user?|Back-office operators" \
     --capability-recommendation CAP-REC-ST-001 \
     --delivery-profile AUT-PR-184 \
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

12. Confirm how every durable output will link back to story, requirement, approved template, and mode, but do not create or link an implementation/release output before the final contract, delivery profile, and task start are approved. After execution produces the artifact, run `output link` before completing the phase lane. `output link` requires the story contract to be approved and fresh unless `--allow-unapproved-contract-output` is being used for explicit migration/recovery. The CLI records fingerprints, and strict gates fail if the artifact, base artifact, or approved template changes after linking:

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

13. Before every delivery, propose and obtain explicit approval for one delivery execution profile. Ask even when another PR or local release already implemented the same requirement. A delivery profile is deliberately one implementation lane: exactly one story and its one approved contract, for exactly one PR or local release. If several stories must ship together, agree an aggregation story/contract first instead of placing unrelated contracts in one profile. Show the requirement ceiling, recommended and requested level, effective cap, exact target, canonical actions, write paths, automatic phases, checkpoints, exclusions, and what would require another decision. The user chooses `supervised`, `checkpointed`, or `bounded-autonomous`; history may inform the recommendation but never grant the choice. Use `--json` when presenting the proposed record so the reviewer can inspect the complete hash-bound subject, not only a prose summary.

   For a pull request:

   ```bash
   node <plugin-root>/bin/agentic-sdlc.mjs autonomy delivery propose \
     --root <target-project> \
     --id AUT-PR-184 \
     --delivery PR-184 \
     --kind pull_request \
     --story ST-001 \
     --contract contract-ST-001-implementation \
     --requirement REQ-001 \
     --level checkpointed \
     --repository owner/repository \
     --base main \
     --head feature/ST-001 \
     --write-path src \
     --allow-action repository.write \
     --allow-action test.run \
     --allow-action git.commit \
     --allow-action git.push \
     --allow-action pull_request.update \
     --json
   ```

   For a local release:

   ```bash
   node <plugin-root>/bin/agentic-sdlc.mjs autonomy delivery propose \
     --root <target-project> \
     --id AUT-LOCAL-REL-009 \
     --delivery LOCAL-REL-009 \
     --kind local_release \
     --story ST-001 \
     --contract contract-ST-001-release \
     --requirement REQ-001 \
     --level bounded-autonomous \
     --target-root /absolute/project/.local-release \
     --write-path /absolute/project/.local-release/app \
     --allow-action build.local \
     --allow-action test.run \
     --allow-action release.local \
     --smoke-test '["npm","run","smoke:local"]' \
     --rollback "Restore the previous local package and restart the local process" \
     --json
   ```

   Approve and inspect the exact profile:

   ```bash
   node <plugin-root>/bin/agentic-sdlc.mjs autonomy delivery approve \
     --root <target-project> \
     --id AUT-PR-184 \
     --actor-type human \
     --approval-source explicit-user \
     --summary "Select checkpointed autonomy for PR-184 only"

   node <plugin-root>/bin/agentic-sdlc.mjs autonomy delivery explain \
     --root <target-project> \
     --id AUT-PR-184
   ```

   In the default `audit_only` authority mode, any requested `bounded-autonomous` level is intentionally narrowed to effective `checkpointed`, including for a local-only release. Do not describe that as bounded execution. To obtain effective `bounded-autonomous`, an external trusted host or CI must first issue an Ed25519-signed receipt for the exact delivery-profile approval subject. Configure `authority_policy.mode: host_verified` and the matching public key in `authority_policy.trusted_host_keys`, then pass that external receipt with `autonomy delivery approve --host-receipt-file <path.json>`. The CLI validates the receipt; it does not mint trusted authority for itself.

   Verify that the approved profile ID equals the planned `delivery_execution_profile_id` in the already approved contract. Then evaluate task start with that profile. Task start is automatic only when the effective level is not `supervised` **and** the current phase appears in that level's configured `autonomy_policy.presets.<level>.automatic_phases`. Otherwise the command returns the exact confirmation checkpoint; follow step 3 and rerun with `--confirm-start` or a matching authorization. The stock `checkpointed` preset makes analysis, design, implementation, and validation automatic, while keeping release actions checkpointed. Do not rewrite the contract:

   ```bash
   node <plugin-root>/bin/agentic-sdlc.mjs task start \
     --root <target-project> \
     --story ST-001 \
     --delivery-profile AUT-PR-184 \
     --intent-json '<canonical-route-intent-json>' \
     --json
   ```

   The effective level is the minimum of host, project, requirement, delivery, contract, capability, environment, and budget. The profile is non-reusable, permits one concurrent run, and closes when terminal. Protected-branch merge, remote deployment, production access, destructive work, and material drift are explicit exceptions.

   Every state-changing delivery action uses an authorize → execute → complete sequence. First request an authorization receipt for the exact canonical action and runtime target. If the command reports `checkpoint_required`, show that subject and rerun with `--confirm-action` plus formal approval attribution. Under `authority_policy.mode: host_verified`, this rerun must also supply `--host-receipt-file`; the external Ed25519 receipt signs action `autonomy.delivery.action.<canonical-action>` and the exact subject containing the profile, delivery, runtime target, and action details. In `audit_only`, the explicit approval is recorded but does not become host-verified authority. Then execute exactly the recorded operation through the host/tooling. Finally report `--outcome` with immutable evidence. For `git.commit`, bind the exact changed files with repeatable `--scope-path`; for `git.push`, bind the matching remote; for merge, bind the exact PR URL:

   ```bash
   node <plugin-root>/bin/agentic-sdlc.mjs autonomy delivery action \
     --root <target-project> --id AUT-PR-184 \
     --action git.commit --scope-path src/example.mjs --json

   # Execute exactly one non-merge commit whose parent and file set match the receipt.
   node <plugin-root>/bin/agentic-sdlc.mjs autonomy delivery action \
     --root <target-project> --id AUT-PR-184 \
     --action git.commit --outcome passed \
     --evidence evidence/PR-184-commit.txt --json

   node <plugin-root>/bin/agentic-sdlc.mjs autonomy delivery action \
     --root <target-project> --id AUT-PR-184 \
     --action git.push --remote origin --json
   # Push the exact recorded SHA/ref, collect host or provider evidence, then complete it.
   node <plugin-root>/bin/agentic-sdlc.mjs autonomy delivery action \
     --root <target-project> --id AUT-PR-184 \
     --action git.push --outcome passed \
     --evidence evidence/PR-184-push.json --json
   ```

   An `authorized` receipt grants only the displayed operation; it does not run it. Push authorization observes the base SHA directly on the selected remote, requires exactly one passing `git.commit` completion for every commit from that SHA to the exact head, and rejects the remote if any configured fetch/push URL identifies another repository. Push/merge authorization records a live remote pre-state, and completion queries the exact Git remote or GitHub PR for the expected post-state after authorization. That observation and the declared evidence are hash-bound, but the observation is not a provider-signed offline attestation; retain durable host/CI/provider evidence and do not call a generic file signed proof. A passing `pull_request.merge` completion or `release.local` completion creates the terminal close receipt automatically; do not manually close either as `merged` or `released`. Other terminal outcomes use `autonomy delivery close` with a formal reason and approval.

   For local release completion, repeat the exact approved shell-free smoke-test argv and rollback. The CLI runs the smoke command in its supported read-only, no-network sandbox and stores structured output hashes before automatically closing the profile as `released`:

   ```bash
   node <plugin-root>/bin/agentic-sdlc.mjs autonomy delivery action \
     --root <target-project> --id AUT-LOCAL-REL-009 \
     --action release.local --confirm-action \
     --actor-type human --approval-source explicit-user \
     --summary "Release this exact local target" \
     --host-receipt-file evidence/AUT-LOCAL-REL-009-release-action.json \
     --json

   # Perform the approved local write, then let completion run the exact smoke test.
   node <plugin-root>/bin/agentic-sdlc.mjs autonomy delivery action \
     --root <target-project> --id AUT-LOCAL-REL-009 \
     --action release.local --outcome passed \
     --evidence .local-release/release-evidence.json \
     --smoke-test '["npm","run","smoke:local"]' \
     --rollback "Restore the previous local package and restart the local process" \
     --json
   ```

   For implementation work or parallel worker work, inspect the current orchestration state before editing:

   ```bash
   node <plugin-root>/bin/agentic-sdlc.mjs orchestrate status --root <target-project> --json
   ```

14. After the delivery profile is approved, claim the existing story before editing code. Include actor/run/thread attribution when available:

   ```bash
   node <plugin-root>/bin/agentic-sdlc.mjs story claim --root <target-project> --id ST-001 --agent codex --branch feature/ST-001 --thread-id <thread-id>
   ```

15. Capture durable autonomy decisions, assumptions, risks, tests, handoffs, sync/push/PR events, dependency revalidation, and release evidence as traces. Include requirement/profile, delivery/profile, requested/effective level, and deterministic reason-code references. Strict gates require `test` and `release` traces to include real evidence paths outside cache/index directories and explicit successful outcomes (`passed` for tests; `ready` or `passed` for release). A local release also requires target-bound smoke-test evidence and its rollback procedure:

   ```bash
   node <plugin-root>/bin/agentic-sdlc.mjs trace append --root <target-project> --story ST-001 --type decision --summary "..." --actor codex --actor-type agent
   node <plugin-root>/bin/agentic-sdlc.mjs trace append --root <target-project> --story ST-001 --type implementation --summary "Codex implemented the requested change" --actor codex --actor-type agent --requested-by antonioantenore --requested-by-type human --request-summary "User-requested change"
   node <plugin-root>/bin/agentic-sdlc.mjs trace append --root <target-project> --story ST-001 --type implementation --summary "Added the requested launcher" --input-summary "Approved contract" --output-summary "Installed launcher" --rationale-summary "Keep evidence local" --alternative "Hosted dashboard" --explanation "The installed plugin now opens recorded project lineage locally." --explanation-kind codex-generated
   node <plugin-root>/bin/agentic-sdlc.mjs trace append --root <target-project> --story ST-001 --type test --outcome passed --summary "Tests passed" --evidence .sdlc/tests/ST-001-test-run.json
   node <plugin-root>/bin/agentic-sdlc.mjs sync record --root <target-project> --story ST-001 --event push --summary "Pushed feature/ST-001"
   ```

   Keep `actor` as the executor. When an agent acts because a human or another system requested it, record `requested_by`; when execution was explicitly authorized, record `authorized_by`. This lets reports answer both "what did Codex execute?" and "what was done on Antonio's request?" without rewriting attribution. Narrative flags are optional; when used, store only shareable summaries derived from recorded evidence. Never put private chain-of-thought, hidden scratch reasoning, or secrets in a trace narrative.

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

18. Run a strict gate check before closing a phase or declaring implementation ready. The gate must validate the requirement revision and ceiling, current non-reused delivery profile, most-restrictive effective level, material-scope freshness, exact authorization uses, and local smoke/rollback evidence when applicable. A passing gate does not itself authorize protected-branch merge or remote/production deployment:

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

   Keep retrieval token-efficient: prefer the human-readable CLI view when it
   contains enough information. JSON from `kb search` and `cache status` is
   compact by default; add `--full` only when the omitted derived payload is
   genuinely needed.

   For supported noisy test, Git, and `rg` commands, use the project-configured
   RTK gateway rather than invoking an assumed global wrapper directly:

   ```bash
   node <plugin-root>/bin/agentic-sdlc.mjs optimization status --root <target-project> --proposal <proposal-id> --json
   node <plugin-root>/bin/agentic-sdlc.mjs optimization run --root <target-project> --proposal <proposal-id> --command-json '["npm","test"]'
   ```

   Add `--exact` for byte-exact or complete output from an already allowlisted
   command. It preserves argv but never allows mutations, external preprocessors,
   unknown executables, or arbitrary diagnostics. The gateway is shell-free and
   applies the configured native fallback only after the active proposal cost
   gate permits new work. A custom provider command requires the invocation-local
   `--trust-custom-rtk-command` switch after its exact argv has been reviewed.

   In an assessment execution, let the lifecycle capture optimization evidence
   automatically at apply, budget checkpoints, and completion. Use manual
   capture only for an explicit diagnostic:

   ```bash
   node <plugin-root>/bin/agentic-sdlc.mjs optimization capture --root <target-project> --proposal <proposal-id> --phase manual --json
   ```

   Never fabricate lifecycle phases with manual capture. Treat RTK counters as
   project-cumulative and the hash-linked proposal delta as interval-only,
   advisory evidence. RTK always applies zero usage credit and no gate override:
   budget usage comes only from receipts, and soft limits, completion reserve,
   hard limits, and metering violations remain sovereign. A release manifest
   may reference validated optimization observations without changing its
   `budget_decision`.

21. Use activity reports or report queries when the user asks what happened, who changed something, which stories were created, which outputs changed, or similar history questions. For raw natural language, normalize the request into canonical report query JSON first; do not keyword-match the user's language in the CLI. Reports must cite canonical source files and must not infer unstored history:

   ```bash
   node <plugin-root>/bin/agentic-sdlc.mjs report activity --root <target-project> --since 3d --view business --out .sdlc/reports/activity.md
   node <plugin-root>/bin/agentic-sdlc.mjs report query --root <target-project> --query-json '<canonical-report-query-json>' --json
   ```

22. When upgrading an existing KB, migrate only a manifest-defined active release. Run `migration active --release-manifest <id>` first without `--apply`, explain the planned config changes and exact historical evidence set, then apply only after the release manifest and every referenced immutable record validate. The command may add missing configuration defaults and a logical `archive-record:v1`; it must never rewrite approved records or move historical files. Use `archive closed --apply` separately only for an explicitly requested filesystem move.

23. When the user explicitly requests correction of an identity embedded in `.sdlc`, use `migration identity` as a separate recovery class. Run it without `--apply` first. Confirm that legacy/canonical authorization, action-subject, revocation, every prior migration receipt, and supported file-reference lineage validates; the plan has no unsupported records or affected signed envelopes; and the source identity will be absent afterward. Signed evidence must be authoritatively reissued, never rewritten or re-signed by the migration. Apply only with the exact emitted `plan_hash`; any canonical snapshot drift requires a new preview and review. Require its digest-only receipt and rebuilt cache/index state; never use broad text replacement or store the source identity in the receipt. If the journaled shadow-tree swap is interrupted, do not remove or age-reclaim the lock: recover only with the verified lock's `nonce` and `plan_hash`, rolling back before commit or finalizing after commit.

24. When the user asks for a visual explanation of what was requested, changed, decided, or verified, load `../change-observatory/SKILL.md`. It launches the bundled read-only app through the installed plugin-local CLI; do not copy assets, add a build, or depend on global `PATH`.

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
- verify the exact `requirement:v2` revision is approved and its requirement execution profile is active and fresh;
- verify each pull request or local release has its own explicitly approved delivery execution profile;
- verify the effective autonomy is the most restrictive host/project/requirement/delivery/contract/capability/environment/budget result;
- verify `audit_only` never produces `bounded-autonomous` and that the highest level has host/CI assurance;
- verify no delivery profile or authorization was reused for another delivery;
- verify local releases identify target root, writes/actions, successful smoke tests, and rollback;
- verify protected-branch merge and remote/production deployment have separate exact authority when requested;
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
