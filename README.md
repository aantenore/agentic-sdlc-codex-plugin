# Agentic SDLC Codex Plugin

Agentic SDLC 0.5.0 gives Codex a guided way to understand an existing software project and deliver a verified technical or functional assessment. The normal experience is intentionally simple: Codex explains what it inferred, proposes the work in plain language, creates the requested real file, verifies it, and returns an auditable result.

Project state stays in the target repository under `.sdlc/`. The plugin installation contains only reusable skills, templates, schemas, and the cross-platform Node.js CLI.

## Start Here

Install the plugin, open the target project in a new Codex task, and use the first starter prompt:

```text
Contextualize this project and prepare an initial technical assessment.
```

The dedicated `Project Assessment` skill is visible in Codex and can also be selected implicitly from equivalent natural-language requests, including requests in languages other than English.

## The Assessment Journey

A normal local, read-only assessment has at most two user checkpoints.

### 1. Confirm Project Context

Codex inspects the repository and summarizes:

- the product purpose, users, and current state supported by evidence;
- the detected stack, runtime, integrations, and architecture boundaries;
- the files and documents used;
- observed facts versus inferences;
- assumptions, contradictions, confidence, and missing information.

Approve or correct that summary. This decision confirms only the project context; it does not start the assessment.

### 2. Approve One Work Proposal

Codex then presents one concrete proposal containing:

- outcome, audience, scope, exclusions, and depth;
- the stable assessment record ID, for example `ST-INITIAL-ASSESSMENT`, and whether it will be created or reused;
- evidence sources and checks;
- ordered report sections;
- real output format, destination, and delivery mode;
- installed local tools and exact read/write boundaries;
- assumptions, limitations, and actions that would require a new decision;
- what approval will authorize and what it will not authorize.

One answer approves or changes that exact bundle. After approval, Codex first creates or reuses the displayed story, persists the bundle with `authorization grant`, and cites that authorization for internal approvals and `task start --confirm-start`. It then completes the assessment, verifies the artifact, records the result, and summarizes it in chat without adding a routine third checkpoint.

An extra decision is required only when execution would cross a displayed boundary, for example a new installation, external or production access, secrets, destructive work, writes outside the agreed paths, or a material proposal change.

## Canonical Output Formats

Requested formats are stored as canonical delivery metadata; a Markdown file renamed to another extension is rejected.

| Canonical format | Accepted aliases | Extension | Media type | Generator/verifier |
| --- | --- | --- | --- | --- |
| `markdown` | `md`, `markdown` | `.md` | `text/markdown` | Native checks |
| `docx` | `word`, `doc`, `docx` | `.docx` | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | `documents` |
| `xlsx` | `excel`, `spreadsheet`, `workbook`, `xlsx` | `.xlsx` | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` | `spreadsheets` |
| `pdf` | `pdf` | `.pdf` | `application/pdf` | `pdf` |
| `pptx` | `powerpoint`, `slides`, `pptx` | `.pptx` | `application/vnd.openxmlformats-officedocument.presentationml.presentation` | `presentations` |
| `html` | `html` | `.html` | `text/html` | Native generation plus rendered validation |
| `json` | `json` | `.json` | `application/json` | Native parse validation |
| `csv` | `csv` | `.csv` | `text/csv` | `spreadsheets` |

Assessment delivery is either `artifact` or `artifact-plus-chat-summary`; the latter is the default.

## Verification And Receipt

Every linked artifact receives deterministic format checks and a stored verification receipt. The receipt includes the canonical format, verifier, checks performed, artifact SHA-256, evidence hashes, and verification time.

DOCX, XLSX, PDF, PPTX, and HTML outputs also require render or visual-check evidence. The evidence must be a real project file outside `.sdlc/cache/` and `.sdlc/indexes/`, and it must be passed when the artifact is linked:

```bash
node bin/agentic-sdlc.mjs output link \
  --story ST-INITIAL-ASSESSMENT \
  --type technical-analysis \
  --artifact docs/technical-assessment.pdf \
  --template technical-analysis-v1 \
  --mode new \
  --requirement REQ-001 \
  --evidence .sdlc/tests/ST-INITIAL-ASSESSMENT-render-check.md
```

There is no separate receipt command. Inspect the persisted output link and its `verification_receipt` with:

```bash
node bin/agentic-sdlc.mjs output status \
  --story ST-INITIAL-ASSESSMENT \
  --type technical-analysis \
  --json
```

The final chat response reports the assessment verdict, major risks, recommendations, artifact path, verification performed, limitations, and open decisions.

## Install

Use a source checkout that is separate from the generated personal-plugin directory:

```bash
cd /path/to/agentic-sdlc-codex-plugin
python3 scripts/install-personal-marketplace.py
codex plugin add agentic-sdlc-codex-plugin@personal
codex plugin list --json
```

On systems where Python 3 is exposed as `python` or `py -3`, use that launcher for the same script. Start a new Codex task after installation so the app reloads plugin skills and agent cards.

The installer stages the package allowlist into `~/plugins/agentic-sdlc-codex-plugin` and updates the plugin entry in `~/.agents/plugins/marketplace.json`. It refuses unsafe destinations instead of replacing a symlink, Git checkout, source checkout, or unmanaged directory.

## Update

Update the source checkout, rerun the staging installer, and add the plugin again. The current Codex CLI has no dedicated plugin-update subcommand; re-adding refreshes the installed cache, including when the version is unchanged.

```bash
cd /path/to/agentic-sdlc-codex-plugin
python3 scripts/install-personal-marketplace.py
codex plugin add agentic-sdlc-codex-plugin@personal
codex plugin list --json
```

Do not edit the generated tree under `~/plugins` directly. Start a new Codex task after the refresh.

## Uninstall

Remove the installed plugin and cache with the supported Codex command:

```bash
codex plugin remove agentic-sdlc-codex-plugin@personal
codex plugin list --json
```

This intentionally leaves the source checkout, generated staging directory, and personal marketplace entry in place. For permanent local cleanup, remove only `~/plugins/agentic-sdlc-codex-plugin` and only the matching JSON entry from `~/.agents/plugins/marketplace.json`; preserve every unrelated plugin entry. Do not remove the shared `personal` marketplace source just to uninstall this plugin.

## Diagnose An Install

Run the built-in doctor from the source checkout. The npm script and direct CLI form execute the same checks; use `--root` to include an initialized target project's KB and output registry:

```bash
npm run doctor
npm run doctor -- --root /path/to/target-project --json
node bin/agentic-sdlc.mjs doctor --root /path/to/target-project --json
codex plugin list --available --json
npm run check
npm pack --dry-run --json
```

Doctor checks the Node runtime, version consistency, first assessment prompt, core and assessment skills, assessment agent card, preset, and project records when `.sdlc/` exists. A failed check returns a non-zero exit code.

For maintainer validation when the Codex system validators are available:

```bash
uv run --with pyyaml python /path/to/plugin-creator/scripts/validate_plugin.py .
uv run --with pyyaml python /path/to/skill-creator/scripts/quick_validate.py skills/agentic-sdlc
uv run --with pyyaml python /path/to/skill-creator/scripts/quick_validate.py skills/agentic-sdlc-assessment
```

If the plugin is absent or shows an older version, rerun the installer and `codex plugin add`, confirm the result with `codex plugin list --json`, then open a new Codex task. See [Portable Codex Install](docs/portable-install.md) for the full troubleshooting matrix.

## Safety Boundaries

- Repository evidence is read-only unless the approved proposal names a write.
- Normal writes are limited to the agreed artifact and canonical `.sdlc/` records.
- New installs, external systems, secrets, production access, destructive actions, and unrelated writes require an explicit decision.
- Every assessment uses an explicit story before its contract or output is persisted.
- A free-text scope is not an automation credential. Checkpoint 2 creates a persisted `authorization grant`; each covered approval and agent-confirmed `task start --confirm-start` must cite it with `--authorization <id>`.
- Cache and indexes are derived data and never count as canonical evidence.

## Advanced CLI

The CLI remains available for automation and advanced project workflows:

```bash
node bin/agentic-sdlc.mjs --help
node bin/agentic-sdlc.mjs doctor --root /path/to/project --json
node bin/agentic-sdlc.mjs status --root /path/to/project
node bin/agentic-sdlc.mjs approval requests --root /path/to/project --json
node bin/agentic-sdlc.mjs gate check --root /path/to/project --story ST-INITIAL-ASSESSMENT --strict --json
```

Natural-language interpretation stays in Codex. The CLI accepts canonical structured intent and performs deterministic state, format, authorization, and evidence checks.

## Repository Layout

```text
.codex-plugin/plugin.json                    Plugin metadata and starter prompts
assets/                                      Plugin artwork
bin/agentic-sdlc.mjs                         Cross-platform Node.js CLI
docs/agent-interactions.md                   Two-checkpoint assessment interaction
docs/portable-install.md                     Install and recovery guide
schemas/                                     Canonical data contracts
skills/agentic-sdlc/                         Core project workflow skill
skills/agentic-sdlc-assessment/              Guided assessment skill
skills/agentic-sdlc-assessment/agents/       Assessment agent card
templates/                                   Reusable artifact templates
```

More detail: [Assessment Interactions](docs/agent-interactions.md) and [Portable Codex Install](docs/portable-install.md).
