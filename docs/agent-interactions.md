# Assessment Interactions

This document defines the user-facing behavior of the `Project Assessment` skill. The goal is a useful project assessment, not a lesson in internal workflow records.

## Activation

The skill is visible in Codex through its agent card and allows implicit invocation. The first starter prompt is exactly:

```text
Contextualize this project and prepare an initial technical assessment.
```

Equivalent natural requests should select the same journey, for example:

- "Assess the current architecture and technical risks."
- "Contestualizza il progetto e prepara un assessment tecnico iniziale."
- "Prepare a functional assessment of this existing application."
- "Review this repository and give me a Word assessment."

The request may name a project root, format, destination, exclusions, evidence sources, or autonomy boundary. Preserve those choices; do not ask for them again when they are already clear.

## Two-Checkpoint Rule

A normal low-risk assessment has at most two user checkpoints:

1. inferred project context;
2. one combined work proposal.

Internal context, tool, output, work-brief, and routing records are implementation details. Prepare them behind these two plain-language decisions instead of exposing one approval per record.

When project context is still proposed or stale, `approval requests` returns only that context decision. Format, capability, contract, and start decisions cannot leak into checkpoint 1. After context is approved, checkpoint 2 may present the represented work records as one combined bundle.

An additional decision is allowed only when the work cannot continue inside the approved proposal, such as a new installation, external or production access, secrets, a destructive action, a write outside the displayed paths, or a material change to scope, format, evidence, or tools.

## Checkpoint 1: Project Context

Inspect the repository and any user-provided local files read-only. Present a decision-ready summary in the user's language that covers:

- evidenced product purpose, users, and current lifecycle state;
- stack, runtimes, deployment model, and integrations;
- architecture boundaries and important components;
- documents, directories, and files inspected;
- constraints and explicit non-goals;
- observed facts, inferences, assumptions, contradictions, and confidence;
- important facts that repository evidence cannot recover.

Do not substitute a list of paths or an internal JSON file for the summary. Paths are supporting evidence.

End with one clear decision:

> Approve or correct this project context. This confirms only the context I may rely on; it does not approve the assessment scope, format, tools, writes, or start.

Apply corrections and ask again within the same checkpoint. Reuse a fresh, already-confirmed context when possible, while still letting the user correct it when contextualization was requested.

## Checkpoint 2: Combined Proposal

Resolve reuse before proposing a new artifact. Prefer an existing approved assessment plus a delta when that fully addresses the request.

Present one proposal with concrete values under these headings:

1. **Outcome**: assessment type, intended decision, and audience.
2. **Assessment record**: the explicit story ID, whether it will be created or reused, and why it represents this assessment.
3. **Scope**: included and excluded areas, depth, and new/reuse/delta mode.
4. **Evidence**: exact directories, files, local commands, project records, and any approved external sources.
5. **Sections**: ordered report sections and how missing evidence will be marked.
6. **Artifact**: canonical format, aliases normalized, extension, media type, destination, delivery mode, generator, and verifier.
7. **Tools and actions**: installed tools, read/write permissions, targets, and checks that will run.
8. **Limits**: assumptions, missing information, non-goals, access boundaries, and triggers for a new decision.
9. **Start and delivery**: creation/reuse of the story, persistent authorization, represented records, authorized task start, exact artifact, and final chat summary.
10. **Approval boundary**: what this answer covers and what remains outside it.

Ask one question: approve this exact proposal or describe changes. Do not split format, tools, report structure, work brief, and start into separate questions.

A short answer applies only to the visible bundle. If any internal representation differs materially from that bundle, revise the proposal before work starts.

## Execute Without A Third Checkpoint

After checkpoint 2 is approved:

1. create or reuse the explicit assessment story shown in the proposal;
2. persist the proposal with `authorization grant`, including the exact approval actions and `task.start.confirm`;
3. create the story-scoped output records and contract, using `--authorization <id>` on every automation approval;
4. confirm execution with `task start --confirm-start --authorization <id>`;
5. perform the agreed read-only analysis and only the displayed writes;
6. generate the artifact in its real canonical format;
7. verify content, container, and visual rendering where required;
8. link the artifact with its evidence and persist the verification receipt;
9. run the applicable deterministic checks;
10. return the artifact path and concise assessment summary.

Do not add a routine approval round for the completed assessment. The user can request revisions after delivery.

## Canonical Formats

Normalize requested aliases before presenting checkpoint 2.

| Canonical format | Accepted aliases | Extension | Media type | Required capability |
| --- | --- | --- | --- | --- |
| `markdown` | `md`, `markdown` | `.md` | `text/markdown` | Native checks |
| `docx` | `word`, `doc`, `docx` | `.docx` | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | `documents` |
| `xlsx` | `excel`, `spreadsheet`, `workbook`, `xlsx` | `.xlsx` | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | `spreadsheets` |
| `pdf` | `pdf` | `.pdf` | `application/pdf` | `pdf` |
| `pptx` | `powerpoint`, `slides`, `pptx` | `.pptx` | `application/vnd.openxmlformats-officedocument.presentationml.presentation` | `presentations` |
| `html` | `html` | `.html` | `text/html` | Native generation plus browser rendering |
| `json` | `json` | `.json` | `application/json` | Native parse validation |
| `csv` | `csv` | `.csv` | `text/csv` | `spreadsheets` |

Use `artifact` or `artifact-plus-chat-summary` as the delivery mode. Default to `artifact-plus-chat-summary` for assessments.

Never create a fake format by renaming Markdown. Extension and media type must match the approved canonical format.

## Format Verification

Use the format capability before generating and inspecting a non-native artifact:

- `documents` for DOCX generation and rendered inspection;
- `spreadsheets` for XLSX/CSV generation, recalculation where relevant, structural checks, and workbook inspection;
- `pdf` for PDF generation, page rendering, and page inspection;
- `presentations` for PPTX generation, slide rendering, and deck inspection;
- a browser renderer for HTML layout and viewport inspection.

Verify that:

- every material finding distinguishes fact from inference and cites evidence;
- required sections exist, using `Not evidenced` or `Not assessed` when appropriate;
- risks, recommendations, roadmap items, evidence, and open decisions have stable IDs;
- the target application opens the file;
- rendered content is legible, complete, and free of overlap or clipping;
- the extension and media type match the proposal.

DOCX, XLSX, PDF, PPTX, and HTML require at least one render or visual-check evidence file when linking the output. Store evidence inside the project, but not under `.sdlc/cache/` or `.sdlc/indexes/`:

The evidence must be a separate file from the delivered artifact. Passing the artifact itself, including through a symlink alias, is rejected both when linking and during strict-gate revalidation.

```bash
node <plugin-root>/bin/agentic-sdlc.mjs output link \
  --root <target-project> \
  --story ST-INITIAL-ASSESSMENT \
  --type technical-analysis \
  --artifact docs/technical-assessment.docx \
  --template technical-analysis-v1 \
  --mode new \
  --requirement REQ-001 \
  --evidence .sdlc/tests/ST-INITIAL-ASSESSMENT-docx-render-check.md
```

Use repeatable `--evidence` options when multiple pages, sheets, slides, or viewports matter. A valid OOXML, PDF, or HTML container without visual evidence is insufficient for these formats.

## Verification Receipt

Linking stores a `verification_receipt` with:

- `status` and verifier;
- canonical format;
- deterministic checks performed;
- evidence paths and SHA-256 values;
- artifact SHA-256;
- verification timestamp.

There is no separate receipt command. Retrieve the persisted output link and receipt with:

```bash
node <plugin-root>/bin/agentic-sdlc.mjs output status \
  --root <target-project> \
  --story ST-INITIAL-ASSESSMENT \
  --type technical-analysis \
  --json
```

The chat delivery should state the artifact path, verification performed, evidence used, limitations, and any open decisions without dumping the raw receipt.

## Story And Persistent Authorization

After the user approves checkpoint 2, create the displayed assessment story before any contract or output operation:

```bash
node <plugin-root>/bin/agentic-sdlc.mjs story create \
  --root <target-project> \
  --id ST-INITIAL-ASSESSMENT \
  --title "Initial project assessment" \
  --acceptance "Deliver the approved assessment artifact with verification evidence"
```

If that story already exists, reuse it only when its scope, requirement links, and output lineage match the proposal; do not overwrite it with `--force`. Resolve reuse with `output resolve --story ST-INITIAL-ASSESSMENT --type technical-analysis` before persisting the output template and story contract.

The checkpoint approval itself must be persisted with `authorization grant`. Free-text scope is not enough. Use the human or CI actor that approved the proposal, include the story in the exact scope, and enumerate every covered action:

```bash
node <plugin-root>/bin/agentic-sdlc.mjs authorization grant \
  --root <target-project> \
  --id AUTH-ASSESSMENT-001 \
  --scope "ST-INITIAL-ASSESSMENT: technical assessment, read-only repository analysis, agreed local artifact" \
  --allow-action capability.profile.approve \
  --allow-action capability.approve \
  --allow-action output.template.approve \
  --allow-action contract.approve \
  --allow-action task.start.confirm \
  --allow-artifact-type technical-analysis \
  --allow-subject CAP-PROFILE-ST-001 \
  --allow-subject CAP-REC-ST-001 \
  --allow-subject technical-analysis-v1 \
  --allow-subject contract-ST-001-analysis \
  --allow-subject ST-001 \
  --actor antonio \
  --actor-type human \
  --approval-source explicit-user \
  --summary "Antonio delegated these exact assessment approvals within the displayed proposal."
```

Then cite that persistent ID on every covered automation approval:

The CLI enforces every non-empty authorization dimension together: action, exact subject, artifact type, expiry, approved authorization hash, and declared scope. Contract approval and task-start confirmation inherit artifact types from the contract output references. Strict gates repeat these checks and reject a receipt or approval whose authorization no longer covers the same work.

`task start` also requires the explicit `--story`, normalized intent story, selected contract, and `contract.story_id` to agree. Bootstrap-only, revoked, expired, stale, or incorrectly attributed approvals cannot start normal work. Capability installation remains outside delegated automation even when the automation actor is CI. Any other contract boundary declared through `approval_required_for` is excluded unless the direct authorization grant names that exact boundary with `--allow-boundary`; an omitted boundary is never inferred from free text.

```bash
node <plugin-root>/bin/agentic-sdlc.mjs contract approve \
  --root <target-project> \
  --id contract-ST-INITIAL-ASSESSMENT-analysis \
  --actor codex \
  --actor-type agent \
  --approval-source automation \
  --authorization AUTH-ASSESSMENT-001 \
  --summary "Approved within AUTH-ASSESSMENT-001 and the unchanged combined proposal."
```

After the contract is approved and unchanged, use the same authorization for the agent-confirmed start:

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

The rule is strict:

- `--scope` describes a boundary but never replaces `--authorization <id>`;
- the authorization must be active, unexpired, unchanged, and allow the exact action;
- an artifact type restriction must cover the assessment artifact;
- every later automated approval must reference the authorization;
- every agent-confirmed `task start --confirm-start` must use the authorization and the grant must allow `task.start.confirm`;
- installs, external systems, secrets, production, destructive actions, and unrelated writes remain outside scope unless explicitly decided, and installations require a direct human or CI decision.

Inspect or revoke persistent delegation with supported commands:

```bash
node <plugin-root>/bin/agentic-sdlc.mjs authorization status \
  --root <target-project> \
  --id AUTH-ASSESSMENT-001 \
  --json

node <plugin-root>/bin/agentic-sdlc.mjs authorization revoke \
  --root <target-project> \
  --id AUTH-ASSESSMENT-001 \
  --actor antonio \
  --actor-type human \
  --reason "Assessment completed"
```

## Exception Handling

| Condition | Agent behavior |
| --- | --- |
| Project root cannot be identified | Ask one immediate clarification |
| Request could mean implementation rather than assessment | Clarify intent before checkpoint 1 |
| Missing local read-only capability | Include the installation decision in checkpoint 2 or stop at the boundary |
| External evidence becomes necessary | Present source, access, and data boundary before use |
| Requested format cannot be generated or verified | Propose a supported alternative; do not fake the extension |
| Evidence changes after approval | Refresh internally if meaning is unchanged; otherwise revise the affected checkpoint |
| Scope, destination, tools, or access changes materially | Present one revised combined proposal |
| Assessment story is missing or does not match the proposal | Create a matching story or revise checkpoint 2 before contract/output work |
| Visual evidence is missing for DOCX/XLSX/PDF/PPTX/HTML | Do not link or claim completion |

## Internal Command Choreography

The agent may use project onboarding, canonical intent, capability records, output templates, work briefs, task start, output links, traces, and deterministic gates. Keep those details behind the product language above.

The internal sequence must preserve these invariants:

- no assessment findings before project context and the combined proposal are approved;
- no more than the two normal checkpoints;
- no assessment contract or output without an explicit matching story;
- no automation approval without a persistent authorization reference;
- no agent-confirmed task start without the same authorization and `task.start.confirm` action;
- no visual-format output link without evidence;
- no final completion claim without a passed verification receipt;
- no project-specific state inside the plugin installation.
