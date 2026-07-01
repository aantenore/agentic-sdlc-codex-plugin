# CLI Commands

Run commands with Node from the plugin root:

```bash
node bin/travelops-sdlc.mjs <command>
```

When the command targets another project, pass `--root <target-project>`.

## Initialize

```bash
node bin/travelops-sdlc.mjs init --root <project> --project-name "Product Name"
```

Creates `.sdlc/`, project metadata, KB directories, generated README, and default phase contracts.

## Create Contract

```bash
node bin/travelops-sdlc.mjs contract create --root <project> --phase design
```

Creates a contract from `templates/sdlc-config.json`.

## Create And Claim Story

```bash
node bin/travelops-sdlc.mjs story create --root <project> --id ST-001 --title "Build itinerary replanning"
node bin/travelops-sdlc.mjs story claim --root <project> --id ST-001 --agent codex --branch feature/ST-001
```

## Append Trace

```bash
node bin/travelops-sdlc.mjs trace append --root <project> --story ST-001 --type test --summary "Unit tests passed"
```

Valid trace types: `assumption`, `decision`, `gate`, `implementation`, `release`, `risk`, `test`.

## Gate Check

```bash
node bin/travelops-sdlc.mjs gate check --root <project> --story ST-001
```

Returns non-zero when blocking errors are found.

## Index And Search

```bash
node bin/travelops-sdlc.mjs index rebuild --root <project>
node bin/travelops-sdlc.mjs kb search --root <project> "weather replanning"
```
