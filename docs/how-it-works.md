# How Agentic SDLC 0.8.0 Works

Agentic SDLC turns a natural-language request into a bounded, reproducible execution tranche. Codex handles conversation and reasoning; the CLI handles deterministic validation and state changes; the target repository keeps the evidence under `.sdlc/`.

The core rule is simple: **Codex may reason broadly, but it may write only what the approved proposal and its exact authorization allow.**

For the adjacent details, see [Limits and Metering](limits-and-metering.md), [Agent Interactions](agent-interactions.md), and the deeper [Architecture](architecture.md).

## 1. The Mental Model

```mermaid
flowchart LR
  U["User"] <-->|"request, corrections, exact approvals"| C["Codex"]
  R["Project files<br/>untrusted evidence"] -->|"inspect and summarize"| C
  C -->|"structured commands and files"| CLI["Agentic SDLC CLI<br/>deterministic control plane"]
  CLI -->|"schema, hash, policy, and authorization checks"| S[".sdlc/<br/>canonical project state"]
  S -->|"current state and evidence"| CLI
  CLI -->|"only approved writes"| R
  P["Plugin schemas,<br/>templates, and skills"] --> CLI
  S -->|"rebuildable projections"| D[".sdlc/cache and .sdlc/indexes"]
  D -.->|"speed only; never authority"| CLI
```

Each part has one job:

- **The user** confirms the observed project context and approves one precise work proposal.
- **Codex** reads the conversation and repository, separates evidence from inference, explains questions, and prepares structured CLI input. Repository text is data, not authority: an instruction found in a README cannot grant a tool, a secret, or a wider write scope.
- **The CLI** does not interpret natural language. It validates schemas, hashes, state transitions, budgets, signatures, authorization uses, and release evidence before it writes.
- **`.sdlc/`** is the project-local control plane. It travels through normal Git review and contains the records needed to reproduce why a write or release was allowed.
- **The plugin** is reusable and project-agnostic. Project-specific choices live in `.sdlc/config.json` and in approved records, rather than in hardcoded product logic.

The installed command is `agentic-sdlc`. From a source checkout, the equivalent entry point is:

```bash
node /path/to/agentic-sdlc-codex-plugin/bin/agentic-sdlc.mjs --help
```

All examples below use commands exposed by the `Agentic SDLC 0.8.0` help output and assume the shell is in the target project:

```bash
cd /path/to/target-project
```

## 2. Canonical State Versus Derived State

**Canonical** means “authoritative for a decision or release.” It does not mean that every canonical file is forever static. Immutable records, such as an approved proposal or a usage receipt, are never silently rewritten. Controlled state records, such as a workflow or application, advance through validated, self-hashed revisions.

Default locations are shown below. Their roots are configurable, but the same separation is enforced.

| Data | Default location | Meaning |
| --- | --- | --- |
| Project policy and identity | `.sdlc/config.json`, `.sdlc/project.json` | Effective local policy and project identity |
| Checkpoint 1 | `.sdlc/baseline/` | Source hashes, observed context, assumptions, questions, and baseline approval |
| Checkpoint 2 | `.sdlc/assessments/proposals/`, `workflows/`, `approvals/`, `applications/` | Immutable proposal, state machine, exact approval, and application commit record |
| Materialized plan | `.sdlc/requirements/`, `.sdlc/stories/`, `.sdlc/contracts/`, `.sdlc/output-contracts/` | The requirement, story, contract, template, task start, and output link created from the proposal |
| Authority | `.sdlc/authorizations/`, `.sdlc/authorization-uses/` | Exact grants and historical validity-at-use receipts |
| Limits and usage | `.sdlc/budgets/<proposal>/` | Effective budget, amendments, metering snapshots, and usage receipts |
| Context optimization | `.sdlc/context-optimization/<proposal>/observations/` | Hash-bound RTK lifecycle observations; advisory evidence with zero budget credit |
| Verification | `.sdlc/receipts/generation/`, `.sdlc/receipts/verification/` | Generator identity, artifact hash, semantic checks, and render evidence |
| Release | `.sdlc/releases/gates/`, `.sdlc/releases/manifests/`, `.sdlc/archive/` | Gate decision, released lineage, rollback information, and logical history classification |
| Delivered artifact | The approved project path, for example `docs/technical-assessment.md` | Canonical only after it is linked, hash-bound, and verified |
| Derived acceleration | `.sdlc/cache/`, `.sdlc/indexes/` | Rebuildable lookup data; never accepted as approval or release evidence |

Hashes bind the chain together:

1. JSON records use a stable canonical JSON SHA-256 hash.
2. Files use the SHA-256 hash of their exact bytes.
3. Downstream records store the upstream ID, path, and hash.
4. A changed source, proposal, authorization, artifact, receipt, gate, or manifest therefore breaks validation instead of silently changing meaning.

Hashes provide integrity and binding; they are not encryption and do not make untrusted input safe by themselves.

## 3. The Two-Checkpoint Assessment

A normal assessment has exactly two logical user checkpoints. Internal records are not seven extra approvals; they are materialized from the one approved proposal.

```mermaid
sequenceDiagram
  actor U as User
  participant C as Codex
  participant CLI as Agentic SDLC CLI
  participant S as .sdlc

  C->>CLI: onboard existing-project or baseline propose
  CLI->>S: write proposed baseline and source hashes
  C->>U: explain observed facts, inferences, assumptions, and gaps
  U->>C: Checkpoint 1 — confirm or correct project context
  C->>CLI: baseline approve
  CLI->>S: record approved canonical baseline

  C->>CLI: assessment proposal prepare
  CLI->>S: write immutable proposal and proposal_pending workflow
  C->>U: show exact scope, output, tools, paths, write-set, budget, and exclusions
  U->>C: Checkpoint 2 — approve, revise, or reject that exact proposal hash
  C->>CLI: assessment proposal approve
  CLI->>S: write approval, content authorization, and authorized workflow
  C->>CLI: assessment proposal apply
  CLI->>S: materialize the approved records and enter running

  Note over U,S: No routine third approval. A new question appears only for an explicit boundary or budget exception.
```

### Checkpoint 1: confirm project context

Codex inspects the repository and proposes a baseline containing source paths and hashes, detected stack, observable current state, imported documents, assumptions, and open questions. The user confirms or corrects that summary.

This approval means: “this is an acceptable project context for preparing a proposal.” It does **not** authorize the assessment, implementation, tool installation, external access, or any output.

```bash
agentic-sdlc onboard existing-project \
  --project-name "Example Service" \
  --document README.md \
  --source src \
  --summary "Observable current state for review"

agentic-sdlc baseline status --id BASELINE-INITIAL

agentic-sdlc baseline approve \
  --id BASELINE-INITIAL \
  --actor-type human \
  --approval-source explicit-user \
  --summary "The context is accurate; treat the roadmap as outdated"
```

If a hashed baseline source changes after approval, proposal application fails. Codex must refresh the baseline and ask for checkpoint 1 again; an old approval cannot authorize a new context.

### Checkpoint 2: approve one complete tranche

The proposal includes the exact:

- objective, boundary, requirement, and reserved story;
- output type, format, template, path, sections, and acceptance criteria;
- contract draft, route intent, capabilities, external/production access flags, and security rules;
- action/path write-set;
- limits, measurement accuracy, warnings, hard-stop behavior, and completion reserve;
- baseline reference and every field covered by `proposal_hash`.

```bash
agentic-sdlc assessment proposal prepare \
  --id ASSESS-001 \
  --baseline BASELINE-INITIAL \
  --scope-title "Architecture assessment" \
  --scope-summary "Assess current architecture, delivery risks, and prioritized improvements" \
  --story ST-ASSESS-001 \
  --requirement REQ-ASSESS-001 \
  --type technical-analysis \
  --artifact docs/technical-assessment.md \
  --template technical-analysis-v1 \
  --format markdown \
  --section "Executive summary" \
  --section "Architecture and risks" \
  --acceptance "Every major claim is linked to approved baseline evidence"

agentic-sdlc assessment proposal approve \
  --id ASSESS-001 \
  --actor-type human \
  --approval-source explicit-user \
  --summary "I approve the exact displayed proposal ASSESS-001"
```

Approval means: “perform only this proposal hash.” It does not approve future conclusions, a larger budget, a different file, extra tools, secrets, deployment, production access, or destructive work.

In the default `audit_only` authority mode, the actor is recorded but the CLI cannot independently prove who invoked it. In `host_verified` mode, `--host-receipt-file` must supply an Ed25519-signed host/CI receipt bound to the exact question, proposal hash, response, actor, constraints, and decision time. The signing key must be in `authority_policy.trusted_host_keys`.

Every question presented by Codex should state, in plain language:

1. what is being asked;
2. why the answer is needed;
3. what a “yes” authorizes;
4. what it does not authorize;
5. an exact example answer; and
6. how each answer changes the proposal or workflow.

## 4. Exact Authorization: Action × Subject

An authorization is not a bag of actions plus a bag of subjects. That would accidentally allow every combination. Version 2 stores each permitted **action–subject pair** separately.

```mermaid
flowchart LR
  P["Approved proposal hash"] --> A["Content authorization"]
  W["Approved write-set"] --> A
  A --> U["Allowed use<br/>action + subject_hash + use_hash"]

  O["Requested operation"] --> ACT["Exact action<br/>for example output.link"]
  O --> SUB["Canonical subject<br/>proposal + subject ID + artifact types + boundaries"]
  SUB --> SH["subject_hash = SHA-256 subject"]
  ACT --> UH["use_hash = SHA-256 action + subject_hash"]
  SH --> UH
  U --> V{"Valid at this use time?"}
  UH --> V
  L["valid_from, expires_at,<br/>revocation, replay, max uses"] --> V
  V -->|"allow"| R["Immutable authorization usage receipt"]
  V -->|"deny"| F["Fail closed; no mutation"]
  R --> G["Release gate checks exact complete receipt set"]
```

For example, these are different permissions:

- `requirement.create × REQ-ASSESS-001`;
- `contract.approve × contract-ST-ASSESS-001-analysis`;
- `output.link × ST-ASSESS-001` for artifact type `technical-analysis`;
- `assessment.proposal.complete × ASSESS-001`.

Permission to link the output does not imply permission to create another requirement. Permission for one story does not imply permission for another story, even when both IDs appear somewhere in the same proposal.

Immediately before a covered mutation, the CLI validates:

- the authorization schema and immutable hash;
- the proposal ID and proposal hash;
- the exact action–subject `use_hash`;
- artifact types and approval boundaries in the canonical subject;
- `valid_from`, `expires_at`, closure or revocation time;
- replay policy and maximum accepted uses;
- scope and authority assurance constraints.

If allowed, the CLI writes a receipt that embeds the authorization snapshot and the exact `used_at` decision. Closing or revoking an authorization blocks future uses, but a valid historical receipt remains auditable at the time it was used. Completion requires the exact proposal-defined set of accepted use receipts; one broad or unrelated receipt cannot satisfy the gate.

## 5. Execution, Verification, Recovery, and Release

The normal workflow state is:

```text
proposal_pending → authorized → running → verifying → completed
```

Execution and recovery share the same validation rules:

```mermaid
flowchart TB
  subgraph N["Normal execution"]
    AP["Apply approved proposal"] --> M["Materialize requirement, story,<br/>template, contract, and task start"]
    M --> RUN["running"]
    RUN --> ART["Generate artifact and generator receipt"]
    ART --> LINK["Link exact output and consume output.link authorization"]
    LINK --> VER["Verify container, content, and render when required"]
    RUN --> USE["Record cumulative budget usage"]
    VER --> COMP["assessment proposal complete"]
    USE --> COMP
    COMP --> CHECKS["Validate lineage, authorization,<br/>budget, artifact, source revision, and rollback"]
    CHECKS --> GATE["Immutable release gate receipt"]
    GATE --> MAN["Immutable release manifest"]
    MAN --> DONE["completed; authorization closed"]
  end

  subgraph R["Crash-safe replay"]
    PS["Proposal seed"] -.-> RP["Restore missing pending workflow"]
    AS["Approval with embedded authorization snapshot"] -.-> RA["Restore only the exact authorization and workflow"]
    APP["Application commit record"] -.-> RAP["Repair running marker without duplicating writes"]
    AM["Budget amendment seed"] -.-> RAM["Rebuild effective budget and resume only if usage is allowed"]
    MS["Release manifest seed"] -.-> RC["Revalidate release and repair terminal markers"]
  end

  RP -.-> AP
  RA -.-> AP
  RAP -.-> RUN
  RAM -.-> RUN
  RC -.-> DONE
```

### Apply is exact and idempotent

`assessment proposal apply` consumes the proposal-bound authorization and materializes only the approved write-set. Existing records are reused only when their semantic content exactly matches the proposal. The application record is the commit marker for that materialization.

```bash
agentic-sdlc assessment proposal apply --id ASSESS-001
agentic-sdlc assessment proposal status --id ASSESS-001
```

The authorization ID returned by approval may also be supplied explicitly with `--authorization`. Omitting it uses the authorization referenced by the matching approval.

### Execution is measured as one tree

Main-agent and subagent usage is aggregated into the proposal budget. Manual values are estimated or unavailable. Exact hard-limit evidence must come from a configured trusted adapter with a valid signed attestation.

An exact runtime receipt is imported like this:

```bash
agentic-sdlc budget usage record \
  --proposal ASSESS-001 \
  --receipt-file .sdlc/receipts/runtime/USAGE-001.json
```

CodeBurn can provide a local advisory baseline and incremental observations. It is always estimated/advisory and cannot, by itself, prove a financial or token hard limit:

```bash
agentic-sdlc budget meter start \
  --proposal ASSESS-001 \
  --adapter codeburn \
  --id METER-ASSESS-001-CODEBURN \
  --provider codex \
  --project "Example Service" \
  --from 2026-07-15 \
  --to 2026-07-15

agentic-sdlc budget meter record \
  --proposal ASSESS-001 \
  --adapter codeburn \
  --baseline METER-ASSESS-001-CODEBURN

agentic-sdlc budget status --proposal ASSESS-001
```

Capture the CodeBurn baseline after checkpoint 2 approval and before `apply`. See [Limits and Metering](limits-and-metering.md) for exact-versus-advisory rules and cost attribution.

RTK is a separate context-optimization gateway, not another usage meter. Inspect
its provider and project-cumulative counters, route a supported noisy command,
or capture a manual diagnostic with:

```bash
agentic-sdlc optimization status --proposal ASSESS-001 --json
agentic-sdlc optimization run --proposal ASSESS-001 --command-json '["npm","test"]'
agentic-sdlc optimization capture --proposal ASSESS-001 --phase manual --json
```

The gateway passes an argument vector without a shell. Supported fixed test,
execution-safe read-only Git, and `rg` profiles use RTK when its configured
version is operational; `--exact` preserves the same allowlisted argv while
bypassing filtering, and the default fallback runs that same safe command when
RTK is unavailable. With active assessment work, `--proposal` is required and
the cost gate is evaluated before either route starts. Apply,
budget-checkpoint, and completion hooks automatically
capture configured lifecycle observations. Operators use `phase=manual` only
for diagnostics; lifecycle phase labels belong to those automatic hooks.

RTK gain counters are cumulative for the project root and can include concurrent
activity. The hash-linked observation delta estimates the change since the
previous proposal observation; it is not provider token usage or billing truth.
Both are reported so the project total is never confused with proposal-local
evidence. Every observation fixes `usage_adjustment_applied` at `0` and
`gate_override` at `false`: usage receipts alone determine `budget_decision`,
and warning, soft-limit, completion-reserve, hard-limit, and metering-violation
policy remains sovereign. See [Token Efficiency](token-efficiency.md) for the
full gateway and evidence model.

### Output verification is layered

Codex creates the approved artifact, and the CLI links it to the approved story, requirement, template, and proposal authorization. The link stores the artifact fingerprint and a separate verification receipt.

“Verified” is not a single Boolean:

- `container_verified` proves the real file/container is structurally valid;
- `content_verified` proves required semantic content is present;
- `render_verified` proves visual formats render legibly using separate evidence;
- `independent_verified` is optional evidence from a genuinely separate verifier.

A generator receipt proves which capability produced the exact artifact hash; it does not replace render evidence. Inspect the persisted result with:

```bash
agentic-sdlc output status \
  --story ST-ASSESS-001 \
  --type technical-analysis \
  --json
```

Format-specific linking examples are in [Agent Interactions](agent-interactions.md).

### Completion is a release transaction

```bash
agentic-sdlc assessment proposal complete --id ASSESS-001

agentic-sdlc gate check \
  --scope release-manifest \
  --release-manifest RELEASE-ASSESS-001 \
  --strict \
  --json
```

Completion admits the release only when all seven mandatory gate checks pass.
When RTK lifecycle observations exist, it adds an eighth
`context_optimization` evidence check; this validates their hashes, lineage,
proposal binding, and zero-credit fields without changing the budget decision.

| Gate check | What it proves |
| --- | --- |
| `proposal_integrity` | The exact immutable proposal is still valid |
| `active_scope_lineage` | Requirement, story, contract, workflow, and approved materialization agree |
| `layered_output_verification` | The linked artifact hash and required verification dimensions pass |
| `execution_budget` | Effective budget, amendments, usage, reserve, accuracy, and final coverage are valid |
| `context_optimization` (optional) | Referenced RTK observations are intact, proposal-bound, advisory-only, and grant no budget or gate override |
| `historical_authorization_at_use` | Every required action–subject use has an accepted, historically valid receipt |
| `source_revision` | The release is bound to an exact Git revision or project snapshot |
| `rollback` | Rollback instructions and target agree with that source revision |

The gate receipt attests those checks. The release manifest inventories their exact IDs, paths, and hashes. Completion then closes the content authorization so it cannot be reused for future work.

### What crash recovery does—and does not do

Each mutating lane uses a local lock. Replay looks for a narrow immutable seed and reconstructs only missing state:

| Interrupted operation | Recovery seed | Safe recovery behavior |
| --- | --- | --- |
| Proposal preparation | Immutable proposal | Recreate only the missing `proposal_pending` workflow |
| Proposal approval | Approval containing the authorization snapshot | Restore that exact authorization and authorized workflow after host/hash validation |
| Proposal application | Exact materialized records and application commit record | Reuse matching records and repair a missing `running` marker without duplicating writes |
| Budget amendment | Immutable amendment | Rebuild the effective budget/application reference and resume only after re-evaluating all usage |
| Completion | Gate/manifest evidence | Revalidate the full release and repair story, application, or workflow terminal markers |

Completion state writes are validated as a transaction and rolled back if validation fails. If a recovery seed is absent, corrupt, stale, signed by an untrusted key, or semantically different, recovery fails closed. It never recreates a wider permission from a free-text summary.

## 6. Failure and Exception Paths

Warnings report progress. A boundary crossing or non-automatic limit creates an explicit exception; it never silently expands the approved tranche.

```mermaid
flowchart TD
  X["Next action or new usage receipt"] --> B{"Inside approved scope,<br/>authority, and budget?"}
  B -->|"yes"| W{"Warning threshold?"}
  W -->|"no"| C["Continue running"]
  W -->|"yes"| N["Notify with measured usage and remaining budget"]
  N --> C

  B -->|"soft/hard limit, reserve risk,<br/>or metering violation"| E["exception_pending<br/>stop starting new work"]
  E --> Q["Ask one precise exception question"]
  Q -->|"approve only a budget delta"| A["Write immutable budget amendment"]
  A --> RE{"Re-evaluate all cumulative usage"}
  RE -->|"allowed"| C
  RE -->|"still blocked"| E
  Q -->|"no extension"| P["Stop or report a clearly non-released partial result"]

  B -->|"new scope, tool, path, access,<br/>secret, production, or destructive action"| NP["Prepare a new proposal or explicit boundary decision"]
  I["Invalid hash, signature, receipt,<br/>schema, or stale source"] --> F["Fail closed; do not advance state"]
```

An exception question must show the current value, measurement accuracy and source, remaining budget, completed and remaining work, requested increment, proposed new total, reason, and partial-delivery alternative.

Good exact answers are:

```text
Approve 20 additional active minutes for ASSESS-001, changing the total from 60 to 80 minutes. Do not change scope, tools, access, or output paths.
```

```text
Do not extend the budget. Stop and report the evidence collected so far as a non-released partial result, including every unmet acceptance criterion.
```

A budget amendment changes only the displayed limits. It cannot authorize a new artifact, path, tool, external system, secret, production action, destructive operation, or wider scope. If the amended budget is still exceeded, the workflow remains `exception_pending`.

Common fail-closed cases include:

- a baseline source changed after approval;
- the proposal, artifact, receipt, or manifest hash no longer matches;
- the requested action–subject pair was never granted or was already consumed;
- authorization expired or was revoked before use;
- a `host_verified` signature or trusted key check fails;
- a hard metric has no fresh, cumulative, trusted exact measurement;
- a visual artifact lacks separate render evidence;
- release lineage is incomplete or a rollback target does not match the source revision.

## 7. Active-Release Migration

Migration updates the control plane without rewriting approved history.

First run a dry plan against the newest valid released manifest:

```bash
agentic-sdlc migration active \
  --release-manifest RELEASE-ASSESS-001
```

The dry run:

1. validates the selected manifest, its one canonical gate receipt, and all referenced immutable active records;
2. rejects an older selected release when a newer valid release exists;
3. calculates missing configuration defaults;
4. identifies evidence belonging only to older valid releases;
5. quarantines corrupt or incomplete historical releases from the archive inventory instead of treating them as trustworthy history; and
6. reports the exact changes without writing them.

Apply that plan explicitly:

```bash
agentic-sdlc migration active \
  --release-manifest RELEASE-ASSESS-001 \
  --apply
```

`--apply` may merge missing configuration defaults and write an immutable `archive-record:v1` that classifies older released evidence as outside the active release scope. It rewrites **zero** immutable active records and moves **zero** files. The configuration/archive update is rolled back if the migration transaction fails.

Logical active-release migration is deliberately different from `archive closed --apply`, which is the separate, plan-first workflow for physical movement of eligible closed reports or trace compactions.

## 8. The Short Version

1. Codex inspects the repository as untrusted evidence.
2. The user confirms the project baseline.
3. Codex presents one complete, hash-bound proposal.
4. The user approves exactly that proposal.
5. The CLI creates an authorization containing exact action–subject pairs.
6. Every mutation records whether that permission was valid at the time of use.
7. Usage from the main agent and all subagents is aggregated under one budget.
8. The artifact is linked and verified in separate structural, semantic, and render dimensions.
9. Seven mandatory release checks bind the proposal, materialized records, usage, authorization, artifact, source revision, and rollback into one manifest; an optional context-optimization check validates referenced RTK evidence without affecting the budget gate.
10. Replays repair only exact missing state; ambiguity, stale evidence, or wider authority fails closed.

For conversational examples, continue with [Agent Interactions](agent-interactions.md). For the full component model, use [Architecture](architecture.md). For time, steps, tokens, costs, CodeBurn, hard limits, and amendments, use [Limits and Metering](limits-and-metering.md).
