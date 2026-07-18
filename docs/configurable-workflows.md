# Configurable workflows

Agentic SDLC can follow different agreed sequences instead of forcing every request through the same software-delivery process. For example, a new feature can use discovery through release, a small change can use intake through closure, and an assessment can keep its two normal approval moments.

The practical rule is simple: choosing a process decides **which steps come next**. It does not decide **what the agent is allowed to do**. For each pull request or local release, the user still chooses separately whether the agent must ask at every step, may continue between agreed review moments, or may finish that one delivery inside the displayed limits.

Once work starts, later edits to the general process do not change that run. A project-specific adjustment must be reviewed before use, and it applies only to new runs. The technical sections below call the reusable process a *definition*, the project-specific adjustment an *overlay*, and one running use of it an *instance*.

## Built-in processes

Four presets are shipped with the plugin:

| Preset | Intended use | Stable journey |
| --- | --- | --- |
| Software project | Feature delivery from discovery through release | `discovery`, `analysis`, `design`, `implementation`, `validation`, `release` |
| Change request | A bounded change with review and verification | Intake, impact review, approval, implementation, validation, closure |
| Technical assessment | The existing guided assessment | Project context, complete proposal, execution, verification, completion; exactly two normal user checkpoints |
| Generic governed process | A reusable approval-and-execution skeleton | Draft, review, approval, execution, verification, completion |

Existing projects keep the six software phases already stored in their project configuration. The technical-assessment preset complements the existing `assessment-proposal:v1` and `assessment-workflow:v1` records; it does not replace their files, commands, JSON fields, or two-checkpoint behavior.

## Definitions, overlays, and running instances

A workflow definition contains stable state and transition identifiers. It is versioned and content-hashed. Approval applies to one exact version, so a later edit becomes a new proposal instead of silently changing active work.

An overlay is a limited, versioned customization. It may change human labels, descriptions, metadata, and parameters for an already allowed guard. It cannot change state or transition identifiers, the initial state, transition direction, ordered phases, or recorded history. The CLI explains the effective result before an overlay is approved.

Starting an instance pins three hashes:

- the approved definition version;
- the approved overlay version, when one is selected;
- the effective definition produced from both.

Updating a definition or overlay therefore affects only new instances. A running instance continues against the exact process it started with.

## Append-only history

Each transition is appended to `events.jsonl`. Events carry a sequence number, the preceding event hash, their own content hash, an actor, a timestamp, and an idempotency key. Replay validates the complete chain before calculating current status.

The engine rejects an invalid transition, an unknown guard, a reused idempotency key with different intent, an unexpected sequence, a timestamp that moves backwards, and evidence that has been modified, reordered, duplicated, or truncated when a known checkpoint is supplied. Custom guards are names from an allowlist plus validated parameters; workflow data is never executed as JavaScript, a module import, or a shell command.

## Storage

Canonical records live under the target project:

```text
.sdlc/workflows/
  definitions/<definition-id>/v<version>.json
  overlays/<overlay-id>/v<version>.json
  instances/<instance-id>/instance.json
  instances/<instance-id>/events.jsonl
```

Definitions and overlays are immutable after approval. Instance headers are immutable after start. Only the event stream is extended during normal execution.

## Command journey

Use focused help for the exact options supported by the installed version:

```bash
agentic-sdlc workflow definition list
agentic-sdlc workflow definition show --id software-project --definition-version 1
agentic-sdlc workflow definition propose --id my-process --definition-version 1 --definition-file workflow.json
agentic-sdlc workflow definition approve --id my-process --definition-version 1 --actor-type human --approval-source explicit-user --summary "I confirm these steps and checks"

agentic-sdlc workflow overlay propose --id labels-it --overlay-version 1 --definition my-process --definition-version 1 --overlay-file labels-it.json
agentic-sdlc workflow overlay approve --id labels-it --overlay-version 1 --actor-type human --approval-source explicit-user --summary "I confirm these project-specific labels and checks"
agentic-sdlc workflow overlay explain --id labels-it --overlay-version 1

agentic-sdlc workflow instance start --id change-184 --definition change-request --definition-version 1
agentic-sdlc workflow instance transition --id change-184 --to impact-review --request-id review-1
agentic-sdlc workflow instance status --id change-184
agentic-sdlc workflow instance explain --id change-184
```

Human output begins with the outcome, practical impact, any decision needed, what remains protected, and one next action. `--json` returns stable machine output. Internal hashes and record paths remain supporting detail rather than prerequisites for understanding the result.

## Local releases and pull requests

The workflow chosen for a requirement does not choose autonomy for a delivery. Every pull request or local release still receives its own non-reusable working choice, exact destination, allowed files, and protected-action receipts. A local release also keeps its own smoke test and rollback procedure. A new workflow version cannot reuse or widen an earlier delivery choice.
