# Portable Codex Install

Agentic SDLC 0.10.0 is a self-contained Codex plugin. The repository root is the plugin root because it contains `.codex-plugin/plugin.json`; all manifest and agent-card paths are repository-relative.

## Package Surface

The staged plugin contains:

```text
.codex-plugin/plugin.json
assets/
bin/
docs/
lib/
schemas/
scripts/
skills/agentic-sdlc/
skills/agentic-sdlc-assessment/
skills/change-observatory/
templates/
ui/change-observatory/
LICENSE
package.json
README.md
```

The assessment and Change Observatory skills each include `agents/openai.yaml`, making `Project Assessment` and `Change Observatory` visible and available for implicit invocation. The first product starter remains:

```text
Contextualize this project and prepare an initial technical assessment.
```

The npm `files` allowlist defines the package surface. Project-specific `.sdlc/` data, repository tests, Git metadata, and unlisted root files do not travel with the plugin.

## Prerequisites

- Codex with the `codex plugin` command group.
- Node.js 18.18 or newer for `bin/agentic-sdlc.mjs`.
- Python 3.8 or newer for the repository staging installer.
- A source checkout outside the generated `~/plugins/agentic-sdlc-codex-plugin` destination.
- Optional: RTK 0.43 or newer on `PATH` for the gateway's default automatic runtime route. The first candidate is canonicalized and must resolve outside the project root; project-local or configured custom providers require the explicit per-invocation trust switch described below.

Use `python3`, `python`, or `py -3` according to the Python 3 launcher available on the machine.

## Install

From the source checkout:

```bash
cd /path/to/agentic-sdlc-codex-plugin
python3 scripts/install-personal-marketplace.py
codex plugin add agentic-sdlc-codex-plugin@personal
codex plugin list --json
```

RTK integration does not require changing the installation command. If RTK is
already installed and you also want the installer to configure its guidance in
the current user's **global Codex instructions**, use the explicit opt-in:

```bash
python3 scripts/install-personal-marketplace.py --with-rtk
codex plugin add agentic-sdlc-codex-plugin@personal
codex plugin list --json
```

The flag does not install or upgrade RTK. Because the instruction change is
global, it can affect Codex behavior in projects that do not use Agentic SDLC;
omitting `--with-rtk` leaves those global instructions unchanged. The plugin's
project-local gateway and fail-open native fallback remain available according
to `.sdlc/config.json`. `--rtk-executable /absolute/path/to/rtk` only tells the
installer which binary to use while configuring and verifying global guidance;
it does not rewrite the project gateway command. For automatic runtime routing,
put RTK on `PATH`. The gateway resolves and canonicalizes the first candidate
before detection and executes that exact absolute path. A PATH candidate or
symlink target inside the project root is inert by default. Alternatively,
configure the absolute executable in the project provider command and pass
`--trust-custom-rtk-command` on each CLI invocation that may execute it.

A successful list result contains an installed, enabled entry with:

```json
{
  "pluginId": "agentic-sdlc-codex-plugin@personal",
  "version": "0.10.0",
  "installed": true,
  "enabled": true
}
```

Start a new Codex task after installing. Existing tasks do not need to be treated as proof that the new skills and card were reloaded.

### What The Installer Changes

The script:

1. reads the package allowlist and adds npm's standard root files;
2. builds a clean sibling staging directory;
3. replaces `~/plugins/agentic-sdlc-codex-plugin` only when the destination is managed and safe;
4. creates or updates only this plugin's entry in `~/.agents/plugins/marketplace.json`;
5. preserves unrelated marketplace entries.

With `--with-rtk`, it additionally configures RTK's global Codex instruction
profile for the current user. This is the only opt-in global change; it still
does not install RTK or modify target-project evidence.

The script honors `HOME`. It refuses to traverse or replace a symlink, Windows junction/reparse point, Git checkout, source checkout, or directory with unmanaged top-level content and leaves that destination untouched for inspection.

Treat the generated tree under `~/plugins` as installation output. Do not clone into it, symlink it to the source, or update it with Git.

## Update

There is no dedicated update subcommand in the current Codex plugin CLI. Refresh the source checkout by your normal source-control process, rerun the staging installer, and add the plugin again:

```bash
cd /path/to/agentic-sdlc-codex-plugin
python3 scripts/install-personal-marketplace.py
codex plugin add agentic-sdlc-codex-plugin@personal
codex plugin list --json
```

If the installation previously used global RTK guidance, repeat the opt-in so
the installed RTK binary refreshes its global Codex instructions:

```bash
python3 scripts/install-personal-marketplace.py --with-rtk
codex plugin add agentic-sdlc-codex-plugin@personal
```

Re-adding is supported and refreshes the installed cache. The installer replaces the complete managed staging tree, so files removed from the package do not remain stale. Start a new Codex task afterward.

For a released build, change the semantic version. During local development at the same version, the same staging-and-add sequence is the supported refresh workaround; a cachebuster is optional maintainer tooling, not an end-user update command.

## Uninstall

Remove the installed plugin and its Codex cache:

```bash
codex plugin remove agentic-sdlc-codex-plugin@personal
codex plugin list --json
```

This command does not delete:

- the source checkout;
- target-project `.sdlc/` knowledge;
- `~/plugins/agentic-sdlc-codex-plugin`;
- the catalog entry in `~/.agents/plugins/marketplace.json`.

It also leaves RTK's independent global Codex instructions in place. Remove
those only if they are no longer wanted by any project:

```bash
rtk init -g --codex --uninstall
rtk init -g --codex --show
```

That retained catalog entry allows a later reinstall. For permanent machine cleanup, first run the supported remove command, then delete only the generated plugin directory and remove only the matching plugin object from the personal marketplace JSON with a JSON-aware editor. Preserve unrelated entries and do not remove the shared `personal` marketplace source.

## Doctor

Run the plugin's non-destructive doctor from the source checkout. The npm script and direct CLI form execute the same checks:

```bash
npm run doctor
npm run doctor -- --root /path/to/target-project --json
node bin/agentic-sdlc.mjs doctor --root /path/to/target-project --json
```

Without `--root`, doctor checks the repository used as the current directory. With a target root, it also validates the project KB and output registry when `.sdlc/` exists. It returns a non-zero exit code when a check fails.

For installation and package diagnostics, combine it with:

```bash
codex plugin list --available --json
npm run check
npm pack --dry-run --json
```

Interpret the results as follows:

| Check | Expected result | Recovery |
| --- | --- | --- |
| `codex plugin list --available --json` | Installed entry is enabled and reports `0.10.0` | Rerun staging, add again, then open a new task |
| `npm run doctor` or CLI doctor | Reports runtime, version, assessment entry point, all three skills, agent cards, Observatory launcher/UI, preset, optional RTK provider, and project KB checks as passed or not applicable | Repair a required failed item, restage, and open a new task |
| `npm run check` | JavaScript syntax checks pass | Repair the reported source syntax before reinstalling |
| Package dry run | Contains manifest, all three skills, agent cards, CLI, Observatory core/UI, schemas, and templates; excludes `.sdlc/` and `test/` | Repair `package.json` `files`, then restage |

If the staging script refuses the destination, inspect the printed path. Move or rename an unmanaged destination rather than forcing deletion; rerun the script only after the generated location is safe.

If the plugin is installed but `Project Assessment` is not visible, verify that the dry-run package includes `skills/agentic-sdlc-assessment/SKILL.md` and `skills/agentic-sdlc-assessment/agents/openai.yaml`, add the plugin again, and open a new Codex task.

### Maintainer Validators

When the Codex plugin and skill validator scripts are available locally, run them in an isolated `uv` environment so the validators receive their declared `PyYAML` dependency without modifying the plugin runtime:

```bash
uv run --with pyyaml python /path/to/plugin-creator/scripts/validate_plugin.py .
uv run --with pyyaml python /path/to/skill-creator/scripts/quick_validate.py skills/agentic-sdlc
uv run --with pyyaml python /path/to/skill-creator/scripts/quick_validate.py skills/agentic-sdlc-assessment
uv run --with pyyaml python /path/to/skill-creator/scripts/quick_validate.py skills/change-observatory
```

These are file validators, not Codex plugin subcommands. If `uv` is unavailable, use an isolated Python environment that already contains `PyYAML`; do not add it as a plugin runtime dependency.

## Installed-Journey Smoke Check

After installation, open a new Codex task in a disposable existing repository and submit:

```text
Contextualize this project and prepare an initial technical assessment.
```

The normal journey must expose no more than two decisions:

1. approve or correct the inferred project context;
2. approve or change one combined assessment proposal.

The combined proposal must name an explicit assessment story such as `ST-INITIAL-ASSESSMENT`. After approval, that story must exist before its contract or output, the approval must be persisted with `authorization grant`, and agent-driven approvals plus `task start --confirm-start` must use `--authorization <id>`.

The final delivery must include the real requested artifact, a concise chat summary, and a stored verification receipt. DOCX, XLSX, PDF, PPTX, and HTML links must also contain render or visual-check evidence.

Also submit this prompt in the disposable project:

```text
Open the Change Observatory for this project.
```

The installed skill must launch the plugin-local CLI, open or return a token-bearing loopback URL, render the bundled UI without a build, and leave the project tree unchanged. See [Change Observatory](change-observatory.md).

## Portability Boundaries

- The plugin is reusable code and method; target-project state remains in that project's `.sdlc/` directory.
- Cache and indexes are derived and are never accepted as canonical evidence.
- Without `--with-rtk`, the installer changes only the current user's plugin staging and personal marketplace files.
- Global Codex instructions change only when `--with-rtk` is explicitly passed; the flag never installs or upgrades RTK.
- The plugin has no runtime npm dependencies.
- External tools needed for a requested artifact format are selected and disclosed in the assessment proposal; missing tools require a decision before installation.
