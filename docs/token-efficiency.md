# Token Efficiency

Agentic SDLC reduces model context at two boundaries while leaving canonical
project evidence unchanged.

## Compact derived JSON

`kb search --json` omits the internal `search_text` copy of each matched file.
The response retains the ranked score, path, title, extension, byte size,
source hash, and snippet, plus `context_optimization` metrics. Read the source
path only when its full content is needed.

`cache status --json` reports cache validity, drift, collection counts, and the
same optimization metrics without serializing the complete derived cache.

Both commands expose the previous large payload explicitly:

```bash
agentic-sdlc kb search "checkout risk" --json --full
agentic-sdlc cache status --json --full
```

Use `--full` only when the omitted derived field is required. It never changes
canonical `.sdlc` files. Search limits are validated and bounded to 1-100.

## RTK for shell output

The repository includes an opt-in [RTK](https://github.com/rtk-ai/rtk)
instruction profile in `AGENTS.md` and `RTK.md`. RTK is an Apache-2.0 command
proxy that filters noisy Git, search, test, build, and log output before it
enters the model context.

Install RTK using a pinned release or its official installation guide, then
configure this checkout:

```bash
rtk --version
rtk init --codex
rtk init --codex --show
```

The integration is fail-open: if RTK is unavailable, use native commands.
Bypass filtering for byte-exact output, full JSON, interactive programs, or
unresolved failures:

```bash
rtk proxy <command>
```

Use RTK's test-aware wrapper for this repository's Node test suite; `rtk npm
test` only strips npm boilerplate, while `rtk test npm test` summarizes
successful test output:

```bash
rtk test npm test
```

Measure project-local savings with:

```bash
rtk gain --project --format json
```

RTK operates only on command output. It must not be used to rewrite contracts,
approvals, hashes, receipts, or other canonical SDLC evidence.
