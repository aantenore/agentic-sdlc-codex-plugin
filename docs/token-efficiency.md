# Token Efficiency

Agentic SDLC reduces model context at two boundaries while leaving canonical
project evidence unchanged.

## Savings map

| High-volume boundary | Default optimization | Exact/full escape hatch |
| --- | --- | --- |
| KB search results | Compact ranked metadata and snippets; omit duplicated `search_text` | `kb search --json --full` |
| Cache diagnostics | Counts, drift, and fingerprints; omit the serialized derived cache | `cache status --json --full` |
| Test output | RTK test summary only for fixed, known-safe test vectors | `optimization run --exact` for the same allowlisted vector |
| Git status/diff/log/show | RTK read-only profile; machine formats stay native and mutations are rejected | `optimization run --exact` |
| `rg` search output | RTK search profile; JSON/NUL output stays native and external preprocessors are rejected | `optimization run --exact` |
| Budget correlation | Store small immutable counter observations and deltas, never command output | Read the referenced observation or raw RTK report separately |

The routing rule is deliberately conservative: optimize output that is noisy
and reconstructible, but preserve complete bytes for canonical evidence,
machine contracts, mutations, failures that still need diagnosis, and any
explicit exact request.

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

## RTK command gateway

[RTK](https://github.com/rtk-ai/rtk) filters noisy command output before it
enters model context. Agentic SDLC 0.10.0 integrates RTK 0.43+ behind a
configurable, shell-free gateway; RTK remains an optional, separately installed
binary.

Check the effective policy, provider version, cumulative project counters, and
the latest proposal observation with:

```bash
agentic-sdlc optimization status --root /path/to/project --proposal ASSESS-001 --json
```

Run an allowlisted command as an argument vector rather than a shell string:

```bash
agentic-sdlc optimization run \
  --root /path/to/project \
  --proposal ASSESS-001 \
  --command-json '["npm","test"]'
```

`--profile auto` chooses among the native, test, Git, and `rg` routes. Explicit
profiles remain allowlisted. Unknown executables, mutations, executable paths,
and external preprocessors are rejected. `RIPGREP_CONFIG_PATH` is neutralized
with `--no-config`; Git diff/log/show always disable external diff and textconv
drivers, and signature-verification options that invoke GPG are rejected. Use
`--exact` when an otherwise allowlisted command needs complete, unfiltered
output:

```bash
agentic-sdlc optimization run \
  --root /path/to/project \
  --command-json '["git","diff","--binary"]' \
  --exact
```

`--exact`, machine-output routes, disabled mode, and native fallback still
apply those anti-helper controls; exact means no RTK output filtering, not
permission to execute project-configured helpers.

The default `fallback: native` policy keeps work moving when RTK is missing,
below the configured minimum version, or unavailable. Set `fallback: error`
only when explicit gateway/manual operations deliberately require the provider.
Automatic lifecycle capture remains fail-open because advisory optimization
must not block an otherwise valid SDLC or budget transition. The gateway never
uses a shell and never routes writes to canonical `.sdlc` evidence through an
output filter.

When any assessment is authorized or active, `optimization run` requires its
`--proposal`. The evaluator reconstructs usage from receipts before spawning a
child: soft/hard/metering exceptions block it, and `completion_reserve` permits
only `assessment proposal complete`. A configured custom provider executable or
prefix argv is inert until the current invocation includes
`--trust-custom-rtk-command`. The standard `rtk` name is resolved once from
`PATH` and executed through its canonical absolute path. If the first candidate
or its real target is inside the project root, it is treated as custom and
requires the same invocation-local trust switch.

## Lifecycle observations

With `mode: automatic`, the configured lifecycle hooks capture RTK gain
observations at proposal apply, budget checkpoints, and completion. They are
stored under:

```text
.sdlc/context-optimization/<proposal>/observations/
```

Each observation is proposal- and execution-bound, hash-linked to its immediate
predecessor, and records the provider version, project-root scope, cumulative
counters, and computed delta. If counters reset, the provider version changes,
or the project scope changes, the delta is marked unavailable instead of being
silently misreported.
An apply-to-latest proposal total is reported only when every intermediate edge
is continuous; any reset, provider change, or scope change marks the whole
window discontinuous.

Manual capture is an explicit diagnostic for an already applied, active
assessment whose approved write set activated context observations. It is not a
way to manufacture an apply, checkpoint, or completion event:

```bash
agentic-sdlc optimization capture \
  --root /path/to/project \
  --proposal ASSESS-001 \
  --phase manual \
  --json
```

Operators should use only `phase=manual`; lifecycle phase labels are reserved
for the automatic hooks. When provider telemetry is unavailable and fallback is
native, no synthetic savings observation is persisted.

## Project cumulative versus proposal delta

RTK's `gain --project` contract reports counters accumulated for the project
root. Those counters can include other agents or concurrent sessions in the
same checkout, so they are shown as **project cumulative**, not attributed to
one proposal.

Each observation calculates an interval delta from its immediate predecessor.
For budget/status correlation, the CLI separately compares the proposal's
`apply` baseline with its latest observation. Both views are useful for trend
and command-output savings analysis, but remain estimates—not provider token
usage, billing records, or guaranteed proposal attribution. `optimization
status --proposal ... --json` exposes the project cumulative total and the
apply-to-latest proposal delta without conflating them.

## Zero budget credit and a sovereign cost gate

RTK optimization telemetry never subtracts from measured usage. Every persisted
observation and every budget advisory fixes:

```json
{
  "usage_adjustment_applied": 0,
  "gate_override": false
}
```

`budget status` may recommend using RTK more aggressively at warning, soft-limit,
or completion-reserve pressure, but the underlying budget decision is computed
only from append-only usage receipts. The recommendation cannot start work when
`allowed_to_start_next` is false, consume the completion reserve for new work,
override a hard limit, or cure a metering violation. In other words, optimization
adapts to the cost gate; the cost gate does not adapt to claimed savings.

At completion, valid observation references may be included in the release
manifest and an optional `context_optimization` gate check. That check proves
their integrity, lineage, proposal binding, and zero-credit semantics. It does
not change `budget_decision` or replace `execution_budget` evidence.

RTK operates only on command output. Contracts, approvals, hashes, usage
receipts, verification receipts, gate receipts, manifests, and other canonical
records remain unfiltered and authoritative.
