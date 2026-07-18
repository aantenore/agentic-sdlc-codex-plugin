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
agentic-sdlc observe --root /path/to/project --locale en
```

Use `--locale it` for Italian. The language choice is carried to the browser in
the local URL; it does not weaken the per-run token or the loopback-only
boundary.

For a reader who does not know the plugin, every delivery-control record starts
with five practical answers: what happened, what changes in practice, whether a
decision is needed, what remains protected, and what to do next. Exact policy
names, identifiers, and stored reason codes appear only after the optional
**Technical details** divider or in the explicit raw-evidence drawer.

In italiano: ogni decisione viene prima spiegata come risultato, impatto,
decisione richiesta, protezioni ancora attive e prossimo passo. Livelli, codici
e identificativi interni restano nei **Dettagli tecnici** facoltativi.

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
- a proof-bound dossier for each story, ordered as Asked, Decided, Contract,
  Done, and Verified;
- what changed, grouped by recorded intent where available;
- decisions, approvals, rationale summaries, alternatives, and evidence;
- how independently the current delivery may proceed, whether a review is now
  needed, and which sensitive actions remain protected; exact internal settings
  and recorded reason codes stay in technical details;
- immutable delivery start/close state and exact action authorization/completion receipts, without treating an authorization as proof that the action ran;
- contract evolution and implementation/validation/release state;
- tests, gates, handoffs, sync events, and missing or malformed lineage;
- content-free IntentABI Codex shadow observations, when explicitly linked to a story trace;
- raw canonical JSON, JSONL, Markdown, and text evidence under `.sdlc/`.

The working agreement is presented as a practical answer, not as policy
vocabulary. A reader first sees what may be completed for this delivery, which
sensitive action still requires a review, and that the choice expires with this
delivery. Internal level and authority codes remain available only in technical
details and the raw-evidence drawer.

The interface uses `recorded`, `inferred`, `missing`, and `malformed` provenance explicitly. It never silently turns an absent record into a completed phase.

## Proof-Bound Iteration Dossiers

The global lists remain useful for portfolio-level inspection, but they are not
the causal lineage of one iteration. Each recorded story therefore has an
additive dossier that groups its evidence into five lanes:

1. **Asked** — the story, explicitly linked requirements, and recorded request;
2. **Decided** — the agreed working limit, the choice made specifically for the
   current delivery, approvals, assumptions, risks, and their stored rationale
   or alternatives; internal policy records remain available as technical
   evidence;
3. **Contract** — the exact story contract and any contract-bound approval;
4. **Done** — implementation, delivery-action completion, and sync evidence recorded for the story;
5. **Verified** — tests, gates, completed steps, local smoke receipts, remote host/provider evidence when present, and release evidence.

A lane membership is allowed only when canonical evidence records an explicit
`story_id`, `requirement_id`, `related` identifier, contract identifier, or
evidence path that resolves to the story. Time proximity, filename similarity,
display titles, and free-text semantics are never lineage signals. The server
computes the dossier once; the browser only validates and renders that bounded
projection and does not attempt a second semantic join.

An autonomy record belongs to a story dossier only through its explicit story,
contract, requirement-profile, or delivery-profile reference. The Observatory
must not infer that a choice for one PR also applies to another PR or local
release.

An empty lane is shown as `missing`, not inferred from another story or from the
Git history. Records that cannot be bound explicitly stay visible in the global
views and diagnostics instead of being attached to the nearest iteration. This
also means a repository can honestly show project-level operational evidence
without pretending that an unrecorded historical story existed.

## Intent Evidence

The optional Intent evidence view reads the IntentABI Codex envelope schema
`io.github.aantenore.intentabi/authenticated-codex-shadow-evidence/v1alpha1`
from canonical files under `.sdlc/observations/intentabi/`. It is an additive
read model: these observations never become requests, changes, decisions,
contracts, phase completions, or verification results.

Each observation must use the exact lowercase path
`.sdlc/observations/intentabi/<event-id>.json`, where `<event-id>` is the same
UUID v4 stored in the envelope. Nested paths, descriptive filenames, mismatched
IDs, and JSONL batches are omitted so filenames cannot become a side channel.

An observation is linked to a story only when a canonical trace lists the exact
observation path in its top-level `evidence` array and records a non-empty
`story_id`. Without both records it remains explicitly `unlinked`; timestamps,
filenames, and nearby iterations are never used to infer lineage.

The application displays only the event ID, shadow mode, submitted input choice,
preparation outcome and reason, proof-presence state, and `MAC present / not
verified`. It does not load IntentABI key material or derive the trusted binding,
so it cannot verify the MAC. Candidate observation is not presented as semantic
equivalence, a cache hit, authorization to reuse, token savings, or permission to
submit transformed content. The original input remains the submitted input in
this v1alpha1 contract.

The parser accepts the exact upstream envelope shape and projects only those
display fields. Unknown or additional fields, including raw prompt, candidate,
or output content, make the entry malformed and cause its content to be omitted
from both the normalized model and the source drawer. The source drawer returns
the same safe projection rather than the full envelope and omits file-level
hash and size metadata for this evidence class.

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

The stored explanation scope is always `recorded-evidence-only`. Valid kinds are `codex-generated`, `deterministic`, and `human-authored`; the UI presents all three under the neutral “Plain-language explanation” label and preserves the authoring badge. A recorded `rationale_summary` remains a distinct “Recorded rationale” field rather than being collapsed into that generated explanation. Private chain-of-thought, internal reasoning traces, and equivalent fields are not part of the narrative contract; if legacy or malformed evidence declares them, the observatory fails closed and redacts the affected surface.

## Security And Privacy Boundary

- The server binds only to `127.0.0.1`; non-loopback hosts are rejected.
- Every run creates a random capability token. It travels in the URL fragment, is held in browser session memory, and is sent as a bearer token only to the same-origin evidence APIs.
- The project root and bundled UI directory identities are pinned for the run. Root replacement and symlink swaps are rejected.
- `.sdlc` must be a real directory, not a symlink. Symlink components, cache/index paths, traversal, unsupported extensions, oversized responses, and malformed structured raw content fail closed.
- Only `GET` and `HEAD` are accepted. Responses use no-store caching, same-origin resource policy, a restrictive CSP, and no CORS permission.
- The application and server do not write to the target project.

The server keeps one serialized read model for the current canonical revision. Concurrent requests share one rebuild, and subsequent requests receive a strong `ETag`; an unchanged conditional `GET` or `HEAD` returns `304` without serializing or transferring the model again. Before every reuse, the server rechecks the project boundary and a deterministic, bounded snapshot of canonical source content. Changes during a rebuild cause a retry rather than publishing a mixed revision. Derived cache and index directories never participate in the revision.

The same configured limits bound revision scanning and normalization: file count, individual file bytes, aggregate bytes, depth, and record collection size. The loopback server scans up to the configured record budget but materializes at most 1,000 entries in each visual collection by default; an embedding API may choose another explicit bound. Oversized or unreadable evidence is represented by a stable diagnostic boundary instead of causing an unbounded read. The deterministic enterprise benchmark verifies warm-response p95 and RSS budgets on the full canonical workload.

The token protects against unrelated local processes guessing the random port. It is an ephemeral local capability, not a multi-user identity or remote-access system. Do not publish the URL, tunnel the port, or bind it to another interface.

## Troubleshooting

Run the installed plugin-local doctor when launch fails:

```bash
node /path/to/installed-plugin/bin/agentic-sdlc.mjs doctor \
  --root /path/to/project \
  --json
```

The doctor checks the launcher, core, UI, skill, agent card, package/manifest version, and optional target-project KB. A missing `.sdlc` directory is displayed as missing lineage rather than initialized or modified automatically. A malformed `.sdlc/config.json` does not block `observe`, because the read-only observatory is dispatched before mutable workflow configuration is loaded.
