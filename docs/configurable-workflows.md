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

Each transition is appended to `events.jsonl`. Events carry a sequence number, the preceding event hash, their own content hash, an actor, a timestamp, and an idempotency key. `checkpoint.json` records the last fully accepted sequence, state, event hash, and cumulative audit-trace hash. Replay validates the complete event chain and the ordered full content of its matching audit records against that durable checkpoint before calculating current status.

The engine rejects an invalid transition, an unknown guard, a reused idempotency key with different intent, an unexpected sequence, a timestamp that moves backwards, and evidence that has been modified, reordered, duplicated, appended without completing its checkpoint update, or truncated. Custom guards are names from an allowlist plus validated parameters; workflow data is never executed as JavaScript, a module import, or a shell command.

Start first records one stable intent, writes the instance into same-filesystem staging, validates every staged byte, and only then publishes the complete directory. The start record remains until the matching audit trace is durable. A retry with the exact same intent can therefore finish an interruption after a process termination without creating a second instance; status and transitions cannot use the instance while that start record remains.

A transition holds one instance lock and records a hash-bound `pending-transition.json` before changing canonical history. The journal anchors the exact byte prefix of both the event stream and the project trace. It appends and synchronizes the event, atomically replaces the checkpoint, records one deterministic trace, and removes the pending record only after all three agree. If a crash leaves only the beginning of the one event or trace line owned by that journal, recovery may truncate and rewrite only that exact suffix. Any different or unrelated suffix stops recovery without changing it.

If a crash interrupts that sequence, status and explanation remain read-only and stop safely: they do not guess a state or repair evidence. The primary message simply asks the operator to repeat the same transition toward the same destination. The optional technical details retain the exact request identifier needed to validate the pending record against the pinned instance, the old checkpoint, the event, the new checkpoint, and the trace, then complete only the missing writes exactly once. A different retry cannot take over that recovery. If the pending record itself is invalid, or the event/checkpoint mismatch has no valid pending record, recovery requires restoring the instance files from one trusted copy. Deleting or rebuilding a checkpoint merely to silence the error is never accepted.

The runtime treats persistence as a commit protocol rather than a sequence of ordinary writes. It flushes each event, journal, checkpoint, and trace file through a write-capable handle and then flushes the containing directory before the next boundary. On POSIX local filesystems this includes the directory entry. Node does not provide the same directory-flush guarantee on every Windows filesystem: failure to open the directory, invalid paths, ACL failures during open, and sharing failures still stop the operation; after a directory was opened successfully, only the specific Windows errors that mean directory flushing is unsupported are accepted as a platform limitation. The file contents are flushed, but metadata durability after sudden power loss ultimately retains the guarantee of the host OS and filesystem.

Runtime validation also requires one matching start trace and exactly one matching transition trace for every accepted event, in the same order. A cumulative hash in the checkpoint binds the full content of those records, including attribution, evidence, outcome, Git/run context, and summary. This detects isolated audit edits and an event/checkpoint pair restored to an older state while its later audit trace remains. These are strong local consistency checks, not a claim that local files are impossible to rewrite: an administrator able to replace the checkpoint and complete project trace consistently can also replace the local evidence of the change. Preventing that stronger coordinated rollback requires an external append-only or host-signed anchor. Network shares and filesystems without reliable hard-link, atomic-rename, locking, and flush semantics are outside the crash-durability guarantee and should use such an external evidence store.

## Storage

Canonical records live under the target project:

```text
.sdlc/workflows/
  definitions/<definition-id>/v<version>.json
  overlays/<overlay-id>/v<version>.json
  instances/.starts/<instance-id>.json       # present only while an interrupted start awaits the exact retry
  instances/.staging/<instance-id>/...       # same-filesystem material prepared before publication
  instances/<instance-id>/instance.json
  instances/<instance-id>/events.jsonl
  instances/<instance-id>/checkpoint.json
  instances/<instance-id>/pending-transition.json  # present only while an interrupted transition awaits the same retry
.sdlc/traces/project.jsonl                    # start and transition audit records used by the cross-check
```

Definitions and overlays are immutable after approval. Instance headers are immutable after start. During normal execution the event stream is extended and its checkpoint is replaced under the same instance lock; neither record is accepted without the other. The pending record is a recovery journal, not a second source of current status.

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
