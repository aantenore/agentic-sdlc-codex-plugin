# Change Observatory

Change Observatory is the visual, local-first lineage reader bundled with Agentic SDLC. It turns canonical `.sdlc/` records into a presentation that a non-technical stakeholder can start with and a technical reviewer can drill through to raw evidence.

## Launch After Installation

In Codex, ask:

```text
Open the Change Observatory for this project.
```

The installed `Change Observatory` skill resolves its own plugin root and runs the plugin-local CLI. It does not assume that `agentic-sdlc` is globally available in `PATH`.

An npm, Git, or tarball installation that exposes the package bin can launch it directly:

```bash
agentic-sdlc observe --root /path/to/project
```

Automation can suppress browser opening and consume the first NDJSON event:

```bash
agentic-sdlc observe \
  --root /path/to/project \
  --host 127.0.0.1 \
  --port 0 \
  --no-open \
  --json
```

`observatory.ready.url` is the browser URL. Keep the process alive while using the application and stop it with `SIGINT` or `SIGTERM`.

## What It Shows

- the recorded request and requirement behind an iteration;
- what changed, grouped by recorded intent where available;
- decisions, approvals, rationale summaries, alternatives, and evidence;
- contract evolution and implementation/validation/release state;
- tests, gates, handoffs, sync events, and missing or malformed lineage;
- raw canonical JSON, JSONL, Markdown, and text evidence under `.sdlc/`.

The interface uses `recorded`, `inferred`, `missing`, and `malformed` provenance explicitly. It never silently turns an absent record into a completed phase.

The three overview answers use an injectable semantic-ranking policy rather than recency alone: implementation evidence ranks ahead of operational sync events for “What changed?”, while approvals, recorded rationale, and alternatives rank ahead of task-start bookkeeping for “Why was it decided?”. Equivalent diagnostics are grouped by fingerprint in both the server model and browser client; non-error diagnostics stay collapsed so lineage remains visible, while errors open automatically.

## Explainability Without Private Reasoning

`trace append` can store a shareable narrative with repeatable input/output summaries, a rationale summary, alternatives, and an optional explanation:

```bash
agentic-sdlc trace append \
  --root /path/to/project \
  --story ST-001 \
  --type implementation \
  --summary "Added the local lineage launcher" \
  --input-summary "Approved implementation contract" \
  --output-summary "Installed observe command" \
  --rationale-summary "Keep project evidence local and reproducible" \
  --alternative "Hosted dashboard" \
  --explanation "The installed plugin can now open the recorded delivery lineage." \
  --explanation-kind codex-generated
```

The stored explanation scope is always `recorded-evidence-only`. Valid kinds are `codex-generated`, `deterministic`, and `human-authored`; the UI presents all three under the neutral “Plain-language explanation” label and preserves the authoring badge. Private chain-of-thought, internal reasoning traces, and equivalent fields are not part of the narrative contract; if legacy or malformed evidence declares them, the observatory fails closed and redacts the affected surface.

## Security And Privacy Boundary

- The server binds only to `127.0.0.1`; non-loopback hosts are rejected.
- Every run creates a random capability token. It travels in the URL fragment, is held in browser session memory, and is sent as a bearer token only to the same-origin evidence APIs.
- The project root and bundled UI directory identities are pinned for the run. Root replacement and symlink swaps are rejected.
- `.sdlc` must be a real directory, not a symlink. Symlink components, cache/index paths, traversal, unsupported extensions, oversized responses, and malformed structured raw content fail closed.
- Only `GET` and `HEAD` are accepted. Responses use no-store caching, same-origin resource policy, a restrictive CSP, and no CORS permission.
- The application and server do not write to the target project.

The token protects against unrelated local processes guessing the random port. It is an ephemeral local capability, not a multi-user identity or remote-access system. Do not publish the URL, tunnel the port, or bind it to another interface.

## Troubleshooting

Run the installed plugin-local doctor when launch fails:

```bash
node /path/to/installed-plugin/bin/agentic-sdlc.mjs doctor \
  --root /path/to/project \
  --json
```

The doctor checks the launcher, core, UI, skill, agent card, package/manifest version, and optional target-project KB. A missing `.sdlc` directory is displayed as missing lineage rather than initialized or modified automatically. A malformed `.sdlc/config.json` does not block `observe`, because the read-only observatory is dispatched before mutable workflow configuration is loaded.
