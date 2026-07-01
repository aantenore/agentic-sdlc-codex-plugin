# CLI Commands

Run commands with Node from the plugin root:

```bash
node bin/agentic-sdlc.mjs <command>
```

When the command targets another project, pass `--root <target-project>`.

## Initialize

```bash
node bin/agentic-sdlc.mjs init --root <project> --project-name "Product Name"
```

Creates `.sdlc/`, project metadata, KB directories, generated README, and default phase contracts.

## Create Contract

```bash
node bin/agentic-sdlc.mjs contract create --root <project> --phase design
```

Creates a contract from `templates/sdlc-config.json`.

Project-specific context can be attached while creating a contract:

```bash
node bin/agentic-sdlc.mjs contract create \
  --root <project> \
  --phase analysis \
  --context-file .sdlc/requirements/REQ-001.md \
  --context-summary "Analyze the MVP around disruption-aware travel replanning." \
  --qa "Who approves this phase?|Product owner" \
  --question "Which external provider is authoritative for MVP?" \
  --constraint "Provider-specific logic must stay behind an adapter"
```

## Create And Claim Story

```bash
node bin/agentic-sdlc.mjs story create --root <project> --id ST-001 --title "Replan an activity when weather changes"
node bin/agentic-sdlc.mjs story claim --root <project> --id ST-001 --agent codex --branch feature/ST-001
```

## Append Trace

```bash
node bin/agentic-sdlc.mjs trace append --root <project> --story ST-001 --type test --summary "Unit tests passed"
```

Valid trace types: `assumption`, `decision`, `gate`, `implementation`, `release`, `risk`, `test`.

## Gate Check

```bash
node bin/agentic-sdlc.mjs gate check --root <project> --story ST-001
```

Returns non-zero when blocking errors are found.

## Index And Search

```bash
node bin/agentic-sdlc.mjs index rebuild --root <project>
node bin/agentic-sdlc.mjs kb search --root <project> "weather replanning"
```
