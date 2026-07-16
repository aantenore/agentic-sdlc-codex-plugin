# RTK - Rust Token Killer (Codex CLI)

**Usage**: Token-optimized CLI proxy for shell commands.

## Rule

Prefer `rtk` for supported read, search, Git, test, build, and log commands whose
output enters the model context. Use the native command or `rtk proxy` when
byte-exact output, full JSON, an interactive process, or unresolved diagnostics
are required. Canonical `.sdlc` records are never rewritten or compressed.

Examples:

```bash
rtk git status
rtk cargo test
rtk npm run build
rtk test npm test
rtk pytest -q
rtk rg "pattern" path
```

## Meta Commands

```bash
rtk gain            # Token savings analytics
rtk gain --history  # Recent command savings history
rtk proxy <cmd>     # Run raw command without filtering
```

## Verification

```bash
rtk --version
rtk gain
which rtk
```
