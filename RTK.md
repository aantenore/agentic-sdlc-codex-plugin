# RTK - Rust Token Killer (Codex CLI)

**Usage**: Token-optimized command output through the Agentic SDLC gateway.

## Rule

Prefer the shell-free `agentic-sdlc optimization run` gateway for supported
read-only Git/search commands and fixed test commands whose output enters model
context. Pass commands as JSON argument vectors, never shell strings. The
gateway uses native fallback when RTK is unavailable. Add `--exact` for
unfiltered output or full/machine-readable formats of an otherwise allowlisted
command. Exact and native routes still suppress ripgrep config loading and Git
external diff/textconv helpers; Git signature-verification helpers are rejected.
The gateway does not allow mutations, unknown
executables, external preprocessors, or interactive commands. Canonical `.sdlc` records are never
filtered or compressed. When an assessment is active, include its `--proposal`;
the cost gate can block the command before either RTK or the native fallback runs.

Examples:

```bash
agentic-sdlc optimization run --proposal ASSESS-001 --command-json '["git","status","--short"]'
agentic-sdlc optimization run --proposal ASSESS-001 --command-json '["rg","pattern","path"]'
agentic-sdlc optimization run --proposal ASSESS-001 --command-json '["npm","test"]'
agentic-sdlc optimization run --proposal ASSESS-001 --command-json '["git","diff","--binary"]' --exact
```

## Meta Commands

```bash
agentic-sdlc optimization status --json
rtk gain --project --format json
```

## Verification

```bash
agentic-sdlc doctor --json
rtk --version
rtk gain --project --format json
```
