# Self-service CLI

The command line starts with the answer a person needs, even when they do not
know the plugin's internal model. Human output always explains:

1. what happened;
2. what changes in practice;
3. whether you need to decide anything;
4. what remains protected;
5. the next useful step.

Record IDs, stored policy labels, paths, hashes, and diagnostic codes appear
after **Technical details (optional)**. JSON retains those fields for
automation.

## Find the right command

Focused help works outside an initialized project and follows the command
hierarchy:

```bash
agentic-sdlc help
agentic-sdlc help autonomy
agentic-sdlc help autonomy delivery
agentic-sdlc help autonomy delivery approve --locale it
```

Use `status` when you only want to know what needs attention now:

```bash
agentic-sdlc status
agentic-sdlc status --locale it
agentic-sdlc status --json
```

The human view gives one recommended next action. The JSON view preserves the
existing project and count fields, adds `schema_version: cli-status:v1`, and
includes the same summary and next action in a stable machine-readable shape.

## Choose presentation without changing authority

Built-in presets change only language and presentation:

```bash
agentic-sdlc preset list
agentic-sdlc preset show human-it
agentic-sdlc status --cli-preset human-it
agentic-sdlc status --cli-preset machine
```

The built-ins are `human-en`, `human-it`, `machine`, `diagnostic`, and
`no-browser`. Explicit command options win over preset values.

A preset cannot choose a command, approve work, widen a path, select a target,
or add an execution flag. Import rejects every option outside the presentation
allowlist before accessing project state. This keeps a shared preset from
quietly changing what the plugin is allowed to do.

Export is deterministic, so the same preset produces byte-identical JSON:

```bash
agentic-sdlc preset export human-it
agentic-sdlc preset export human-it > human-it.json
agentic-sdlc status --cli-preset @human-it.json
```

The exported file is directly reimportable. Import validates its schema and
presentation-only allowlist before reading project state.

## Enable shell completion

Completion generation is deterministic and does not evaluate project files:

```bash
agentic-sdlc completion bash
agentic-sdlc completion zsh
agentic-sdlc completion fish
agentic-sdlc completion powershell
```

Load or install the printed script using the normal completion mechanism for
your shell. Regenerate it after upgrading if the command catalog changes.

## Understand an autonomy answer

The primary message uses ordinary language. For example, it says that the
requirement defines the most freedom a future change may request, while every
pull request or local release still receives its own separate choice. If the
current installation can only record who approved the work, it explains that
the agent must stop at the named checkpoints unless a trusted host supplies a
signed approval for that exact delivery.

Only the optional technical section names stored values such as
`bounded-autonomous`, `audit_only`, the delivery-profile ID, or receipt paths.
Those values remain available for audit and automation without making them a
prerequisite for understanding the decision.

## Install or update locally

The local installer uses a reviewable transaction:

```bash
python3 scripts/install-personal-marketplace-v2.py check --locale it
python3 scripts/install-personal-marketplace-v2.py plan --locale it --json
python3 scripts/install-personal-marketplace-v2.py apply --locale it --plan-hash <plan_hash-from-plan> --json
python3 scripts/install-personal-marketplace-v2.py validate --locale it --transaction-id <transaction_id-from-apply> --receipt-hash <receipt_hash-from-apply>
python3 scripts/install-personal-marketplace-v2.py confirm --locale it --transaction-id <transaction_id-from-apply> --receipt-hash <receipt_hash-from-apply>
```

V2 is the canonical local installer. `check` and `plan` never write. With no
command, it also creates a plan only. `apply` accepts one exact plan hash,
recalculates it under a lock, stages and byte-verifies the package, and retains
the prior plugin plus marketplace bytes. `validate` proves the installed state
still matches the receipt; then `confirm` keeps it or the returned `restore`
command restores the byte-exact previous state. Unexpected data stops recovery
without being overwritten. Use `--home /absolute/path` to inspect or manage
another explicit destination.

V2 never changes global settings. RTK remains a separate, explicit V1
compatibility operation and must run only after the V2 transaction has been
confirmed or restored:

```bash
python3 scripts/install-personal-marketplace.py plan --with-rtk --json
python3 scripts/install-personal-marketplace.py apply --with-rtk --plan-hash <plan_hash-from-plan>
```

The compatibility installer verifies an existing RTK binary; it does not
download or upgrade one. Apply executes a private copy whose bytes match the
reviewed plan. This step changes the current user's global Codex instructions
for every project; it is intentionally outside V2's retained-backup boundary.
See [Portable install](portable-install.md) for supported environments, trust
boundaries, removal, and recovery.
