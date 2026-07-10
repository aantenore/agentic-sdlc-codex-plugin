---
name: agentic-sdlc-assessment
description: Contextualize an existing software project and produce an initial technical, functional, architecture, or product assessment through Agentic SDLC. Use for natural requests in any language such as "contextualize this project", "contestualizza questo progetto e prepara un assessment tecnico/funzionale", or "assess the architecture and project health", including requests that combine existing-project onboarding, evidence review, a requested file format, artifact generation, verification, and KB linking.
---

# Agentic SDLC Assessment

## Operating Contract

Load `../agentic-sdlc/SKILL.md` for the core CLI, contract, output-link, trace, and gate rules. Use this skill as the product-specific choreography for an initial project assessment.

Keep the normal journey to at most two user checkpoints:

1. inferred project context;
2. one combined assessment proposal.

Do not expose baseline, capability profile, recommendation, template, contract, or route records as separate product steps. Prepare and record them behind the two plain-language decisions below. Add another decision only for a material exception: an install, external access, a secret, production access, a destructive action, an out-of-scope write, or a material change to the approved proposal.

Treat the target project's `.sdlc/` as the canonical KB. Treat cache and indexes as derived. Do not produce assessment findings before the applicable project context and work proposal are approved.

## Enter The Journey

1. Resolve the target project root from the user's request; otherwise use the current workspace root.
2. Capture any output format, destination, evidence boundary, exclusions, and autonomy scope already stated by the user. Preserve explicit autonomy boundaries exactly; do not generalize them.
3. Initialize or onboard an existing project according to the core skill. For a repository with useful current files, prefer `onboard existing-project` so inferred history remains proposed rather than canonical.
4. Select one explicit story for the assessment, for example `ST-INITIAL-ASSESSMENT`. Reuse an existing story only when it represents the same assessment scope and output lineage; otherwise reserve a new ID. Show the ID and create/reuse decision in checkpoint 2.
5. Normalize the request into route intent JSON and reference the selected story. Use `technical_analysis` with `artifact_type: technical-analysis` for a technical, architecture, or combined project assessment; use `functional_analysis` with `artifact_type: functional-analysis` for a primarily functional assessment.
6. Inspect repository files, canonical `.sdlc/` evidence, and user-provided local files read-only. Do not use external sources unless their use was explicitly requested or approved.
7. Do not persist a contract or output yet. After checkpoint 2 is approved, create or reuse the selected story and link it to the applicable requirement before any contract, output-template, output-resolution, or output-link command. Assessment output is story-scoped; never fall back to a project-only contract that cannot be linked to a canonical result.

Ask an immediate clarification only when the target project cannot be identified or the request is too ambiguous to distinguish an assessment from implementation. Fold all other missing information into one of the two checkpoints.

## Checkpoint 1: Inferred Project Context

Present a decision-ready summary in the user's language. Include:

- product purpose, users, and current lifecycle stage when evidenced;
- detected stack, runtime, deployment model, and important integrations;
- architecture boundaries and key components;
- documents and paths inspected;
- known constraints and explicit non-goals;
- inferred facts, assumptions, contradictions, confidence, and open questions;
- facts that cannot be recovered from repository evidence, such as unstored historical intent.

Distinguish observed facts from inference. Summarize the meaningful file contents in chat; paths are supporting evidence, not a substitute for the summary.

Ask the user to approve or correct this context. State explicitly:

> This decision makes only the presented project context canonical. It does not approve the assessment scope, format, tools, work brief, writes, or execution start.

Record direct confirmation as an approval of the baseline only. Never reuse that approval for a capability record, output template, contract, or `--confirm-start`. If a fresh approved baseline already exists, reuse it; present it for correction when the user asked to contextualize the project, but do not manufacture a new approval for unchanged facts.

After corrections, refresh the context summary and obtain confirmation within this same checkpoint. Do not start a third context round unless contradictory evidence makes the baseline unsafe to use.

## Prepare The Combined Proposal

Inspect the output registry to plan reuse before proposing a new artifact. Prefer an approved related artifact plus a delta when it satisfies the request. For a new technical assessment, read the `technical-assessment` preset from `<plugin-root>/templates/technical-assessment.md` and tailor depth to the approved context. The same semantic model may support a combined technical/functional assessment; do not delete required sections merely because one section is brief or not evidenced. Describe the exact delivery in checkpoint 2, but do not persist the template or call story-scoped output commands before the selected assessment story exists.

Profile project capabilities from evidence. Read `.sdlc/config.json` before deciding whether capability records require a user-facing decision.

Treat capability profile and recommendation preparation as background bookkeeping only when all of these are true:

- policy explicitly allows automatic use of already-installed capabilities, such as `capability_discovery_policy.default_auto_use_installed: true`;
- every capability is already installed, local, and read-only for evidence collection;
- there is no install, external target, secret, production target, tenant/workspace mutation, or destructive action;
- writes are limited to canonical SDLC bookkeeping and the output path that checkpoint 2 will show;
- no policy entry requires a separate decision for the concrete action.

Still list the concrete tools in checkpoint 2. A configuration policy can avoid a separate product checkpoint, but it does not by itself authorize a formal automation approval. Approval of checkpoint 2 must be persisted with `authorization grant`; every covered automation approval and the confirmed task start must cite that authorization. If any condition is false, make the capability or access decision visible in checkpoint 2 and wait.

## Checkpoint 2: Combined Assessment Proposal

Show one proposal with concrete values, not placeholders. It must contain all of the following:

1. **Outcome**: assessment type, decision it should support, and intended audience.
2. **Assessment record**: the explicit story ID, whether it will be created or reused, and why it represents this assessment.
3. **Scope**: included areas, excluded areas, depth, and whether this is a new artifact, reuse, or delta.
4. **Evidence sources**: exact repository directories, KB records, user files, local commands/checks, and any approved external sources.
5. **Sections**: the ordered report sections and any format-specific mapping, including what will be marked not evidenced.
6. **Artifact**: canonical format, normalized alias, extension, media type, destination path, delivery mode, generator capability, and verifier capability.
7. **Tools and actions**: installed skills/tools, read/write permissions, targets, and checks that will actually run.
8. **Limits**: assumptions, missing information, non-goals, access boundaries, time/depth limits, and actions that would require a new decision.
9. **Start**: state that approval authorizes creation/reuse of the displayed story, a persistent authorization limited to this bundle, creation/approval only of the represented records, `task start --confirm-start --authorization <id>`, generation of the displayed artifact, format-specific verification, KB linking, and the final chat summary.
10. **Approval boundary**: state what the answer covers and what it does not cover.

Ask one question: approve this exact combined proposal or describe changes. Do not ask separate questions for format, tools, template, contract, or start.

A short approval applies only to the elements visibly represented in the proposal. It may support separate formal records only when each record is an exact encoding of those displayed elements. If the selected story, generated template, capability recommendation, or contract differs materially, present a revised combined proposal before approval.

After approval, create or reuse the displayed story before any contract or output operation. Do not use a project-level placeholder in place of a story-scoped assessment:

```bash
node <plugin-root>/bin/agentic-sdlc.mjs story create \
  --root <target-project> \
  --id ST-INITIAL-ASSESSMENT \
  --title "Initial project assessment" \
  --acceptance "Deliver the approved assessment artifact with verification evidence"
```

If the story already exists, verify its identity, scope, requirement links, and output lineage and reuse it without `--force`. Then run `output resolve --story ST-INITIAL-ASSESSMENT --type <assessment-artifact-type>` before creating the output template and story contract.

The checkpoint 2 approval must become a persistent authorization. The grant must be made by the human or CI actor that provided the decision, name the story in its scope, and enumerate the exact approval and start actions it covers:

```bash
node <plugin-root>/bin/agentic-sdlc.mjs authorization grant \
  --root <target-project> \
  --id AUTH-ASSESSMENT-001 \
  --scope "ST-INITIAL-ASSESSMENT: <exact approved assessment scope and output>" \
  --allow-action capability.profile.approve \
  --allow-action capability.approve \
  --allow-action output.template.approve \
  --allow-action contract.approve \
  --allow-action task.start.confirm \
  --allow-artifact-type technical-analysis \
  --allow-subject CAP-PROFILE-ST-INITIAL-ASSESSMENT \
  --allow-subject CAP-REC-ST-INITIAL-ASSESSMENT \
  --allow-subject technical-analysis-v1 \
  --allow-subject contract-ST-INITIAL-ASSESSMENT-analysis \
  --allow-subject ST-INITIAL-ASSESSMENT \
  --actor "<human-or-ci-id>" \
  --actor-type human \
  --approval-source explicit-user \
  --summary "<who delegated which approval level, for which assessment, within which limits>"
```

Every later automation approval must cite that record, for example:

```bash
node <plugin-root>/bin/agentic-sdlc.mjs output template approve \
  --root <target-project> \
  --id technical-analysis-v1 \
  --actor codex \
  --actor-type agent \
  --approval-source automation \
  --authorization AUTH-ASSESSMENT-001 \
  --summary "Approved within the exact assessment proposal authorized by AUTH-ASSESSMENT-001."
```

`--scope` is descriptive and, when supplied on the later command, must match the grant; it is never a substitute for `--authorization <id>`. Reuse an existing active, unexpired grant only when its actions, artifact types, story, and scope cover the exact proposal. Never relabel delegated autonomy as a direct approval of later records. Do not infer that phrases such as "handle the assessment" include installs, external services, secrets, production, destructive actions, or unrelated writes. A direct human or CI decision is required for `--approve-install`; delegated automation cannot approve an installation.

After the story contract is approved and unchanged, confirm the story-scoped start with the same authorization:

```bash
node <plugin-root>/bin/agentic-sdlc.mjs task start \
  --root <target-project> \
  --story ST-INITIAL-ASSESSMENT \
  --contract-id contract-ST-INITIAL-ASSESSMENT-analysis \
  --intent-json '<canonical-route-intent-json>' \
  --confirm-start \
  --actor codex \
  --actor-type agent \
  --authorization AUTH-ASSESSMENT-001 \
  --json
```

For an agent-confirmed start, `--authorization` is mandatory and the grant must allow `task.start.confirm`. Never rely on checkpoint text, `--scope`, or contract approval alone as task-start authorization.

## Canonical Formats

Normalize aliases before creating the output template and contract. Store the template's canonical values in `delivery.format`, `delivery.extension`, `delivery.media_type`, `delivery.mode`, and `delivery.generator`. Preserve them on the linked output as `delivery_format`, `delivery_extension`, `media_type`, `delivery_mode`, and `generator`.

| Canonical format | Accepted aliases | Extension | Media type | Generator and verifier |
| --- | --- | --- | --- | --- |
| `markdown` | `md`, `markdown` | `.md` | `text/markdown` | native Markdown checks (`generator: null`) |
| `docx` | `word`, `doc`, `docx` | `.docx` | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | `documents` |
| `xlsx` | `excel`, `spreadsheet`, `workbook`, `xlsx` | `.xlsx` | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | `spreadsheets` |
| `pdf` | `pdf` | `.pdf` | `application/pdf` | `pdf` |
| `pptx` | `powerpoint`, `slides`, `pptx` | `.pptx` | `application/vnd.openxmlformats-officedocument.presentationml.presentation` | `presentations` |
| `html` | `html` | `.html` | `text/html` | native HTML generation and rendered validation (`generator: null`) |
| `json` | `json` | `.json` | `application/json` | native structured generation and schema/syntax validation (`generator: null`) |
| `csv` | `csv` | `.csv` | `text/csv` | `spreadsheets` |

Use only `artifact` or `artifact-plus-chat-summary` as `delivery_mode`; default to `artifact-plus-chat-summary` for an assessment unless the user requests otherwise.

Do not fake a format by renaming a Markdown file. The artifact extension must match the approved canonical format. Treat an output-link extension mismatch as a deterministic failure and repair the artifact or proposal; never bypass the check.

## Generate And Verify

Load and follow the format skill before generating or validating a non-native artifact:

- use `documents` for DOCX creation and rendered inspection;
- use `spreadsheets` for XLSX and CSV creation, recalculation where relevant, structural inspection, and visual verification of workbooks;
- use `pdf` for PDF creation, page rendering, and page-level inspection;
- use `presentations` for PPTX creation, slide rendering, and deck inspection.

If conversion crosses formats, use and verify with every relevant skill. For example, use both `documents` and `pdf` when a DOCX is the source of a delivered PDF. If a required skill is unavailable, do not improvise a substitute file; request the install decision.

Apply the preset's semantic sections in every format:

- render DOCX as ordered headings, narrative, and native tables;
- render XLSX as the prescribed worksheets with stable IDs and evidence references;
- render PPTX as a concise decision deck with detailed evidence in appendix slides;
- represent JSON with section keys and stable record IDs;
- flatten CSV into records with section, record ID, field, value, and evidence IDs.

Verify both content and container:

- every material finding distinguishes fact from inference and cites evidence;
- all required sections exist, even when the value is `Not evidenced` or `Not assessed`;
- risks, recommendations, roadmap items, evidence, and open decisions have stable cross-referenced IDs;
- the file opens in the target format and rendered content is legible and complete;
- the final extension and media type match the approved output record.

Save render or visual-check evidence inside the target project, outside `.sdlc/cache/` and `.sdlc/indexes/`. For `docx`, `xlsx`, `pdf`, `pptx`, and `html`, `output link` must receive at least one such file with `--evidence`; container validation alone is insufficient. Use repeatable `--evidence` options when multiple rendered pages, sheets, slides, or viewport checks are material:

```bash
node <plugin-root>/bin/agentic-sdlc.mjs output link \
  --root <target-project> \
  --story ST-INITIAL-ASSESSMENT \
  --type technical-analysis \
  --artifact docs/technical-assessment.pdf \
  --template technical-analysis-v1 \
  --mode new \
  --requirement REQ-001 \
  --evidence .sdlc/tests/ST-INITIAL-ASSESSMENT-render-check.md
```

The link stores a verification receipt containing format, verifier, checks, evidence hashes, artifact hash, and verification time. Inspect it with `output status --story ST-INITIAL-ASSESSMENT --type technical-analysis --json`; there is no separate receipt command.

## Complete Without A Third Checkpoint

After checkpoint 2 is approved:

1. create or reuse the explicit assessment story shown in checkpoint 2;
2. persist checkpoint 2 with `authorization grant`, including `task.start.confirm` and the exact approval actions;
3. resolve output reuse, create the story-scoped contract/output records, and cite `--authorization <id>` on every automation approval;
4. run `task start --confirm-start --authorization <id>` only after the story contract is approved and unchanged;
5. perform the read-only assessment and write only the approved artifact plus required canonical `.sdlc/` bookkeeping;
6. generate and verify the artifact with the required format skill;
7. link it through `output link` using the approved template, story/requirement, reuse mode, and exact artifact path; for DOCX, XLSX, PDF, PPTX, or HTML, pass render or visual-check evidence with `--evidence`;
8. append evidence traces and run the applicable gate or deterministic validation;
9. return a concise chat summary with the verdict, major risks, recommendations, artifact path, verification performed, limitations, and open decisions.

Do not add a normal approval checkpoint for reviewing the completed assessment. The user may request revisions after delivery. Stop and request a new decision only when execution would cross a displayed boundary or the proposal can no longer be fulfilled as approved.
