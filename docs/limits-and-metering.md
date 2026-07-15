# Limits, autonomy, and metering

Yes: you can give an agent broad autonomy and still constrain it from several directions. The important qualification is that autonomy is broad **inside one approved proposal**, not a permanent global blank cheque.

In simple terms:

> permitted work = approved proposal ∩ exact authorization ∩ capability boundaries ∩ remaining budget

If any part does not allow an operation, the operation is not authorized. A larger budget does not expand scope, and a broader scope does not increase the budget.

See [How it works](how-it-works.md) for the complete lifecycle, [the documentation map](README.md) for related topics, and the [project overview](../README.md) for installation and quick-start commands.

## What “blank cheque” means here

A user may say, for example:

> Complete this assessment autonomously. You may inspect and update anything listed in the proposal, create the stated deliverable, run local tests, and push the result. Do not use production, secrets, new external services, destructive operations, or additional spend. Stop if the approved budget is insufficient.

That grants high day-to-day autonomy, but it still has an envelope:

| Control | What is fixed by the approved proposal |
|---|---|
| Outcome | The objective, acceptance criteria, and requested deliverable |
| Scope | Included and excluded subjects, depth, and delivery mode |
| Writes | The explicit write set: action, subject, path, and artifact type |
| Capabilities | Required and allowed tools or capability bindings |
| Environment | External and production access boundaries |
| Safety | Secret handling, destructive-action boundaries, and repository content treated as untrusted data |
| Resources | Time, steps, tokens, calls, cost, and custom metrics |
| Lifetime | Proposal hash, authorization validity window, use count, and terminal workflow state |

The current guided assessment command prepares proposals with `external_access: false` and `production_access: false`. It does not expose switches that silently turn those fields on. Installs, secrets, production access, destructive actions, out-of-scope writes, material proposal changes, and budget extensions are exception boundaries that require an explicit decision.

Read and write boundaries are also separate. Approved baseline sources and the proposal scope define what may be treated as input evidence. Each durable write must match a `write_set` entry containing its action, subject, project-relative path, and artifact type. Capability permission answers “which tool may do it”; path permission answers “where it may do it.” Both must allow the operation. The host filesystem sandbox remains an additional lower-level boundary.

```mermaid
flowchart TD
    U["User approves proposal hash"] --> P["Immutable proposal"]
    P --> W["Exact write set and deliverable"]
    P --> C["Tools, external, and production boundaries"]
    P --> B["Execution budget"]
    W --> A["Proposal-bound authorization"]
    C --> A
    B --> A
    A --> R["Run autonomously inside the envelope"]
    R -->|"new path, tool, access, scope, or budget"| E["Stop at an explicit exception"]
```

## Exact action × subject permissions

An authorization does not store one independent list of actions and another independent list of subjects and then combine every action with every subject. That would create accidental permissions.

Instead, each allowed use is one exact pair:

| Action | Subject | Meaning |
|---|---|---|
| `contract.approve` | `contract-ST-001-analysis` | Approve this contract only |
| `task.start.confirm` | `ST-001` | Start this story only |
| `output.link` | `ST-001` plus its proposal-bound artifact context | Link the approved output only |

The canonical assessment authorization stores the action, a hash of the complete subject, and a hash of the pair. Every accepted use creates an immutable validity-at-use receipt. The default use policy is `per-action-subject-once`, replay of the same pair is denied, and the authorization closes when the workflow becomes terminal.

```mermaid
flowchart LR
    A1["contract.approve"] --- P1["Allowed pair 1"]
    S1["contract-ST-001-analysis"] --- P1
    A2["task.start.confirm"] --- P2["Allowed pair 2"]
    S2["ST-001"] --- P2
    P1 --> H["Hash-bound allowed_uses"]
    P2 --> H
    H --> R["One receipt per accepted pair"]
    X["contract.approve × ST-001"] -.->|"not implied"| H
```

Wildcards are disabled by the default policy. When more than one action and more than one subject are involved, use explicit pairs so there is no ambiguous Cartesian product.

### Delegated authorization example

```bash
node bin/agentic-sdlc.mjs authorization grant \
  --root /path/to/project \
  --id AUTH-ST-001 \
  --scope "Only the approved analysis tranche for ST-001" \
  --allow-use contract.approve=contract-ST-001-analysis \
  --allow-use task.start.confirm=ST-001 \
  --allow-artifact-type technical-analysis \
  --max-uses 2 \
  --expires-at 2026-07-15T18:00:00.000Z \
  --actor-type human \
  --approval-source explicit-user \
  --summary "Approve these two exact action-subject uses only"
```

Every option has a specific purpose:

| Option | What it asks for | Example effect |
|---|---|---|
| `authorization grant` | Create a delegated authorization record | It does not execute the task |
| `--root` | Project whose `.sdlc/` store receives the record | No other project is covered |
| `--id` | Stable authorization identifier | Reuse this ID only for the same intended grant |
| `--scope` | Plain-language boundary | Helpful for humans; it does not replace exact pairs |
| `--allow-use` | One `action=subject` pair; repeat once per pair | `contract.approve` is not granted for `ST-001` |
| `--allow-artifact-type` | Permitted artifact classification | Other artifact types remain disallowed |
| `--max-uses` | Maximum accepted uses across the grant | Two pairs can be consumed at most twice in total |
| `--expires-at` | UTC expiry instant | A later use fails even if a pair is otherwise correct |
| `--actor-type` | Type of root approver | A grant requires `human` or `ci`, not an agent self-grant |
| `--approval-source` | Authority source | `explicit-user` must correspond to a human approval |
| `--summary` | Exact meaning of the approval | Stored in the immutable approval content |

For the normal assessment workflow, prefer `assessment proposal approve`: it derives all required action-subject pairs from the displayed proposal instead of asking you to assemble them manually.

## Budget model

An execution budget belongs to one proposal execution tree, including subagents. Each metric defines:

- a `unit` such as `seconds`, `steps`, `tokens`, `calls`, `money`, or a custom unit;
- a metering level: `exact`, `estimated`, or `unavailable`;
- an optional `soft` limit;
- an optional `hard` limit;
- a `currency` for monetary values, otherwise `null`.

At least one of `soft` or `hard` is required for every metric. When both exist, `soft` must be lower than `hard`. A hard limit is accepted only with `metering: "exact"`.

### Common and custom metrics

| Metric | Typical meaning | Important detail |
|---|---|---|
| `active_time_seconds` | Time actively spent executing | The default policy excludes user wait and external wait |
| `steps` | Runtime or workflow steps | A hard ceiling needs a trusted adapter that defines and counts a step consistently |
| `tokens` | Aggregate token use | The default is estimated and soft-only |
| `input_tokens` / `output_tokens` | Token components | Useful when separate thresholds matter |
| `cache_read_tokens` / `cache_write_tokens` | Cache token components | Keep separate unless the budget explicitly chooses a total formula |
| `model_calls` | Model requests | CodeBurn maps this from its `calls` counter |
| `tool_calls` | Tool invocations | CodeBurn does not currently expose a built-in mapping for this metric |
| `cost` | Decimal monetary amount | Currency must match every receipt and estimate |
| `quality_checks` | Example custom counter | The evaluator is generic, but an adapter or manual observation must emit the same metric name |

Custom metric names may use letters, numbers, `.`, `_`, and `-`, starting with a letter. The core budget evaluator needs no custom branch, but measurement still matters: CodeBurn can map only its allowlisted token, call, and cost sources. A different metric needs a different adapter or a manual advisory observation.

### Complete budget input example

Save this as `budget.json`:

```json
{
  "scope": "proposal_execution_tree",
  "warning_thresholds_percent": [70, 90],
  "completion_reserve_percent": 15,
  "limits": {
    "active_time_seconds": {
      "unit": "seconds",
      "metering": "exact",
      "soft": 2700,
      "hard": 3600,
      "currency": null
    },
    "steps": {
      "unit": "steps",
      "metering": "exact",
      "soft": 40,
      "hard": 60,
      "currency": null
    },
    "tokens": {
      "unit": "tokens",
      "metering": "estimated",
      "soft": 200000,
      "hard": null,
      "currency": null
    },
    "model_calls": {
      "unit": "calls",
      "metering": "estimated",
      "soft": 120,
      "hard": null,
      "currency": null
    },
    "cost": {
      "unit": "money",
      "metering": "estimated",
      "soft": "5.00",
      "hard": null,
      "currency": "USD"
    },
    "quality_checks": {
      "unit": "checks",
      "metering": "estimated",
      "soft": 20,
      "hard": null,
      "currency": null
    }
  },
  "limit_policy": {
    "on_warning": "notify",
    "on_soft_limit": "checkpoint",
    "on_hard_limit": "stop",
    "on_metering_violation": "stop"
  },
  "extensions": {
    "active_time_excludes_user_wait": true,
    "active_time_excludes_external_wait": true,
    "aggregation": "proposal_execution_tree",
    "automatic_extension": false,
    "on_limit": "request_extension"
  }
}
```

Field meanings:

| Field | Meaning |
|---|---|
| `scope` | Aggregate the main agent and its subagents for this proposal |
| `warning_thresholds_percent` | Notify at 70% and 90% of metrics that have a hard limit |
| `completion_reserve_percent` | At 85% of a hard ceiling, preserve the final 15% for verification and delivery |
| `limits.<name>.unit` | Unit used for validation and arithmetic |
| `limits.<name>.metering` | Required evidence quality for that metric |
| `limits.<name>.soft` | Pause/checkpoint threshold; `null` means no soft threshold |
| `limits.<name>.hard` | Absolute stop threshold; `null` means no hard ceiling |
| `limits.<name>.currency` | Currency or billing unit for money; otherwise `null` |
| `limit_policy.on_warning` | Notify without stopping new work |
| `limit_policy.on_soft_limit` | Record the intended checkpoint, partial-delivery, or stop behavior |
| `limit_policy.on_hard_limit` | Always `stop` |
| `limit_policy.on_metering_violation` | Always `stop` because evidence is insufficient for the promised hard control |
| `extensions.active_time_excludes_*` | Define which waits do not consume active time |
| `extensions.aggregation` | Define the execution tree whose usage is combined |
| `extensions.automatic_extension` | `false`: limits never raise themselves |
| `extensions.on_limit` | Ask for an explicit extension decision |

The CLI derives the canonical budget ID as `BUDGET-<proposal-id>`, so the input file does not need an `id`. The two hard metrics in this example are usable only when a trusted exact-metering adapter is configured before proposal approval. Without signed exact coverage, completion fails closed.

Use the file when preparing a proposal:

```bash
node bin/agentic-sdlc.mjs assessment proposal prepare \
  --root /path/to/project \
  --id ASSESS-001 \
  --baseline BASELINE-001 \
  --scope-title "Architecture and delivery assessment" \
  --scope-summary "Assess architecture, delivery risks, and prioritized improvements" \
  --budget-file ./budget.json
```

| Option | What it asks for |
|---|---|
| `assessment proposal prepare` | Build the immutable checkpoint-2 proposal; it does not approve it |
| `--root` | Target project root |
| `--id` | Stable proposal identifier used by later commands |
| `--baseline` | Exact approved checkpoint-1 context to use |
| `--scope-title` | Short human-readable name for the tranche |
| `--scope-summary` | Precise included objective; exclusions should be stated here or in proposal scope data |
| `--budget-file` | JSON file containing the limits shown above |

## Warnings, soft limits, hard limits, and reserve

The decision order is deliberate:

```mermaid
flowchart TD
    M["Aggregate append-only usage receipts"] --> H{"Hard limit reached?"}
    H -->|"yes"| HS["hard_limit: stop"]
    H -->|"no"| V{"Hard metric lacks trusted exact evidence?"}
    V -->|"yes"| VS["metering_violation: stop"]
    V -->|"no"| S{"Soft limit reached?"}
    S -->|"yes"| SP["soft_limit: exception_pending"]
    S -->|"no"| R{"Inside final 15% reserve?"}
    R -->|"yes"| RP["completion_reserve: completion work only"]
    R -->|"no"| W{"Warning threshold reached?"}
    W -->|"yes"| N["warning: notify and continue"]
    W -->|"no"| OK["within_budget: continue"]
```

- **Warning:** a configured percentage of a hard ceiling has been reached. Work may continue.
- **Soft limit:** the planned checkpoint has been reached. New work pauses and the workflow moves to `exception_pending`.
- **Completion reserve:** with the default 15% reserve, crossing 85% of a hard ceiling blocks new work but preserves the remainder for verification, packaging, release evidence, and delivery.
- **Hard limit:** usage has reached the absolute ceiling. Work stops.
- **Metering violation:** a hard control was promised but the available evidence is not exact and trusted. The system stops instead of pretending the limit was enforced.

Warning percentages and the completion reserve are calculated only for metrics with a hard ceiling. A soft-only token or cost estimate still triggers its soft checkpoint, but it has no percentage-based reserve because there is no hard total from which to calculate one.

## Exact, estimated, and unavailable

| Level | Meaning | Can support a hard limit? |
|---|---|---|
| `exact` | Cumulative measurement from an approved adapter, cryptographically attested and bound to this execution and budget | Yes |
| `estimated` | Useful observation with known uncertainty, such as CodeBurn local-log counters and catalog pricing | No |
| `unavailable` | No meaningful observation is currently available | No |

Typing `"exact"` into JSON does not make a measurement exact. Manual CLI input is restricted to `estimated` or `unavailable`. An exact receipt must be imported from a trusted runtime adapter.

### Why Ed25519 attestation is required

For a hard metric, the trusted adapter must produce a cumulative measurement that binds all of these facts:

- execution ID;
- budget ID and immutable budget hash;
- adapter ID;
- measured values and metering level;
- execution and coverage timestamps;
- final observation time;
- optional signed enforcement-hook receipt;
- pricing reference and evidence.

The adapter signs the canonical payload hash with an Ed25519 private key. The project configuration contains only the corresponding public key. Validation resolves exactly one `key_id`, verifies the signature, verifies the receipt and attestation hashes, and checks that the measurement exactly matches the usage receipt.

```mermaid
sequenceDiagram
    participant R as Runtime adapter
    participant K as Ed25519 private key
    participant S as .sdlc receipt store
    participant V as Agentic SDLC validator
    participant P as Trusted public-key policy
    R->>R: Measure cumulative usage
    R->>K: Sign canonical measurement payload hash
    K-->>R: Ed25519 signature
    R->>S: Write attestation and usage receipt
    V->>S: Read immutable files and hashes
    V->>P: Resolve adapter, metrics, and key_id
    P-->>V: Trusted Ed25519 public key
    V->>V: Verify signature, binding, coverage, and freshness
    V-->>S: Accept exact evidence or fail closed
```

At completion, the latest valid exact receipt must cover the workflow from its execution start. Its final cumulative observation must be no older than `completion_freshness_seconds`, unless a signed enforcement-hook receipt covers the completion checkpoint.

### Trusted source configuration

This is a syntactically valid example; replace the illustrative public key with the real reviewed adapter key:

```json
{
  "default_trust": "deny",
  "completion_freshness_seconds": 60,
  "trusted_sources": [
    {
      "adapter": "runtime-meter-v1",
      "metrics": ["active_time_seconds", "steps"],
      "trusted_keys": [
        {
          "key_id": "runtime-meter-prod-2026-01",
          "algorithm": "Ed25519",
          "public_key": "-----BEGIN PUBLIC KEY-----\nREPLACE_WITH_THE_REVIEWED_ED25519_PUBLIC_KEY\n-----END PUBLIC KEY-----\n"
        }
      ]
    }
  ]
}
```

| Field | What it controls |
|---|---|
| `default_trust: "deny"` | No adapter becomes trusted merely because it emits a receipt |
| `completion_freshness_seconds` | Maximum age of the final cumulative observation at completion without a covering hook |
| `trusted_sources[].adapter` | Exact adapter identity accepted by receipts |
| `trusted_sources[].metrics` | Metrics that this adapter is allowed to assert as exact |
| `trusted_sources[].trusted_keys` | Public keys accepted for this adapter |
| `key_id` | Stable key identifier carried by the attestation |
| `algorithm` | Must be `Ed25519` |
| `public_key` | Reviewed public key; never put the private key in project configuration |

The complete exact-metering policy is hashed into the approved budget. Changing adapters, metrics, keys, or freshness after approval invalidates the binding and requires a new proposal; it cannot be smuggled through a budget amendment.

## CodeBurn advisory metering

CodeBurn is useful for local visibility into tokens, calls, and estimated cost. It reads local session logs, so it is **not** a provider-signed source and never becomes `exact` in this plugin.

The integration accepts CodeBurn `0.9.x`, which must be installed separately. The plugin does not install or upgrade it.

The adapter command is replaceable in `.sdlc/config.json` through `budget_policy.metering_adapters.codeburn.command.executable` and `.arguments`. Arguments are passed as a vector with `shell: false`. This lets Windows hosts bypass npm's non-executable `.cmd` shim safely by invoking `node.exe` with CodeBurn's `dist/cli.js` entrypoint, and lets CI pin a hermetic executable without changing metering logic.

### Metric mapping

The default project configuration maps CodeBurn sources as follows:

| Budget metric | CodeBurn source | Formula or value |
|---|---|---|
| `tokens` | `tokens.total` | `input + output + cache_read + cache_write` |
| `input_tokens` | `tokens.input` | Input tokens only |
| `output_tokens` | `tokens.output` | Output tokens only |
| `cache_read_tokens` | `tokens.cache_read` | Cache-read tokens only |
| `cache_write_tokens` | `tokens.cache_write` | Cache-write tokens only |
| `model_calls` | `calls` | CodeBurn call count |
| `cost` | `cost` | CodeBurn decimal estimate in the same currency as the budget |

Only metrics present in the approved budget are mapped. CodeBurn’s session count is retained in snapshot evidence but has no built-in budget mapping. A currency mismatch fails instead of converting money silently.

### 1. Capture the baseline

Run this after proposal approval and before `assessment proposal apply`, while the workflow is `authorized`:

```bash
node bin/agentic-sdlc.mjs budget meter start \
  --root /path/to/project \
  --proposal ASSESS-001 \
  --adapter codeburn \
  --id METER-ASSESS-001-CODEBURN \
  --provider codex \
  --project TravelOps \
  --from 2026-07-15 \
  --to 2026-07-15
```

| Option | What it asks CodeBurn or the plugin to do |
|---|---|
| `budget meter start` | Capture the immutable cumulative starting snapshot |
| `--root` | Run against this project and store evidence under its `.sdlc/` directory |
| `--proposal` | Bind the baseline to this exact proposal and effective budget |
| `--adapter` | Select a built-in allowlisted adapter; currently `codeburn` |
| `--id` | Name the baseline; the default is `METER-<proposal>-CODEBURN` |
| `--provider` | Filter CodeBurn’s local log source, for example `codex`; this is not a billing account ID |
| `--project` | Filter CodeBurn’s project aggregation; choose the narrowest stable project name |
| `--from` | Inclusive start date in `YYYY-MM-DD` form |
| `--to` | Inclusive end date; keep a stable full window for multi-day work |

The baseline stores the exact provider, project, and date query, adapter version, mapped metrics, cumulative counters, source-report hash, and immutable snapshot hash.

### 2. Record an incremental observation

Run this while the workflow is `running`, `verifying`, or `exception_pending`:

```bash
node bin/agentic-sdlc.mjs budget meter record \
  --root /path/to/project \
  --proposal ASSESS-001 \
  --adapter codeburn \
  --baseline METER-ASSESS-001-CODEBURN \
  --id USAGE-ASSESS-001-CODEBURN-01
```

| Option | What it does |
|---|---|
| `budget meter record` | Capture a current snapshot, subtract the last committed cursor, and append a usage receipt |
| `--root` | Select the same target project |
| `--proposal` | Select the same proposal execution |
| `--adapter` | Select the adapter used by the baseline |
| `--baseline` | Select the immutable baseline and its persisted query |
| `--id` | Give this usage receipt a stable ID; omit it for a hash-derived ID |

`record` deliberately reuses the baseline query. Record-time values cannot replace the stored provider, project, or date window for that cursor. On the first call, it subtracts the baseline. Later calls subtract the latest committed current snapshot, so usage is not counted twice. Repeating an identical observation is idempotent.

```mermaid
flowchart LR
    L["Local Codex session logs"] --> C["CodeBurn 0.9.x report"]
    C --> B["Immutable baseline snapshot"]
    C --> N["Current snapshot"]
    B --> D1["First delta"]
    N --> D1
    D1 --> U1["Append-only estimated usage receipt"]
    N --> CUR["New cursor"]
    C --> N2["Later current snapshot"]
    CUR --> D2["Next delta"]
    N2 --> D2
    D2 --> U2["Next estimated usage receipt"]
    U1 --> E["Budget evaluator"]
    U2 --> E
```

CodeBurn records are always classified as:

- metering: `estimated`;
- source assurance: `advisory_observed`;
- trusted exact: `false`.

If CodeBurn is mapped to a metric that has a hard limit, the observation is preserved, but the evaluator reports `metering_violation` and stops. This is intentional: an estimate must not masquerade as hard enforcement.

Project and date filters are aggregation filters, not task ownership. Concurrent sessions matching the same filter are included together; missing, deleted, delayed, duplicated, or imported logs can change completeness. Use the narrowest isolated project/window available and keep the result advisory. See [CodeBurn adapter reference](codeburn-metering.md) for the complete snapshot, delta, integrity, and reset rules.

## CodeBurn estimate vs provider cost truth

These sources answer different questions:

| Source | Best use | Do not treat it as |
|---|---|---|
| CodeBurn | Fast local visibility, warnings, trends, and pre-invoice estimates | Provider billing truth or a real-time hard-stop hook |
| Provider Costs API/dashboard | Provider-reported organization/project cost reconciliation | A guaranteed synchronous pre-call enforcement mechanism |
| Contract and invoice | Final financial settlement | A low-latency runtime meter |

CodeBurn derives cost from local logs and a pricing catalog. It may differ because of model aliases, cache treatment, service tiers, discounts, credits, taxes, pricing updates, missing logs, and invoice timing.

For OpenAI API usage, reconcile financial reporting with the provider’s [Organization Costs endpoint](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/costs) or the [Usage dashboard](https://platform.openai.com/usage). OpenAI’s official [Usage and Costs API example](https://developers.openai.com/cookbook/examples/completions_usage_api) shows separate usage and cost collection. The Costs endpoint uses an organization Admin API key and returns provider cost buckets; do not put that key in `.sdlc/` evidence.

A true hard cost ceiling needs an enforcement point before or around model calls—for example, a trusted gateway that reserves spend, stops new calls, emits a final cumulative receipt, and signs it. The provider Costs API is the reconciliation truth, but its bucketed reporting is not by itself a synchronous stop mechanism.

## What happens at `exception_pending`

The workflow enters `exception_pending` when a soft limit, hard limit, metering violation, or completion-reserve boundary requires a decision. The agent must explain:

1. which metric and threshold caused the pause;
2. current usage and remaining hard capacity, when measurable;
3. what work remains;
4. the effect of each choice.

The user then chooses one of three outcomes:

- **Amend:** approve a new, versioned, extension-only budget.
- **Partial delivery:** stop new work and return only the evidence or artifact portions already completed and verified, clearly marked as a non-released partial result.
- **Stop:** cancel the tranche and perform no further work.

```mermaid
stateDiagram-v2
    [*] --> running
    running --> exception_pending: soft / hard / reserve / trust boundary
    verifying --> exception_pending: final metering or reserve boundary
    exception_pending --> running: approved amendment is sufficient
    exception_pending --> cancelled: stop or non-released partial result
    running --> verifying: execution complete
    verifying --> completed: release and metering gates pass
```

### Versioned amendment example

```bash
node bin/agentic-sdlc.mjs budget amend \
  --root /path/to/project \
  --proposal ASSESS-001 \
  --id BAMEND-ASSESS-001-01 \
  --budget-json '{"limits":{"tokens":{"soft":350000}}}' \
  --reason "The approved analysis is complete, but verification needs approximately 120000 more estimated tokens" \
  --actor-type human \
  --approval-source explicit-user
```

| Option | What it asks for |
|---|---|
| `budget amend` | Create and apply one immutable budget amendment |
| `--root` | Target project |
| `--proposal` | Paused proposal whose effective budget may be extended |
| `--id` | Stable amendment ID for idempotent replay |
| `--budget-json` | Exact patch, not a replacement budget; here only token soft limit becomes `350000` |
| `--reason` | Why the approved tranche cannot finish within the old total and what the extra capacity is for |
| `--actor-type` | Root approver type; only `human` or `ci` may extend a budget |
| `--approval-source` | Direct `explicit-user` or `ci` authority; automation cannot extend itself |

When `authority_policy.mode` is `host_verified`, also provide `--host-receipt-file <path.json>`. That receipt must approve action `budget.amend`, bind the exact proposal/base/result hashes and changes, and carry a valid Ed25519 signature from a configured trusted host key.

Amendments are append-only and extension-only:

- they cannot lower an existing soft or hard limit;
- they cannot lower the completion reserve;
- they cannot change the approved exact-metering policy hash;
- they do not expand scope, writes, tools, external access, or production access;
- they can be created only from `exception_pending`;
- replaying the same ID with different content fails.

A scope, capability, authority, or metering-trust change requires a newly prepared and explicitly approved proposal.

## Practical policy recipes

### Broad repository-local autonomy

Use a proposal with a precise but broad included scope, enumerate all planned writes, allow the required local tools, keep external and production access false, and use estimated soft token/cost limits. The agent may proceed without repeated confirmations but must stop for any new boundary.

Example approval wording:

> I approve proposal ASSESS-001 exactly as displayed. Complete the entire repository-local tranche autonomously, including tests and the listed deliverable. Do not install anything, access production or secrets, use new external services, write outside the proposal, or extend the budget.

### One hour and 60 steps, enforced

Use `active_time_seconds` hard `3600` and `steps` hard `60`, both `exact`, plus a trusted runtime adapter that signs cumulative measurements. With a 15% reserve, new work stops at 3,060 seconds or 51 steps so the remaining capacity is protected for completion. The absolute hard stops remain 3,600 seconds and 60 steps.

### Tokens and cost observed with CodeBurn

Use estimated soft thresholds such as `tokens: 200000` and `cost: 5.00 USD`, capture a CodeBurn baseline before execution, and record deltas during the run. This gives useful checkpoints but not hard enforcement.

### Financially enforced cost ceiling

Put the hard cost metric behind a trusted pre-call gateway or runtime adapter that can prevent new calls and sign cumulative exact usage. Reconcile its result with provider Costs data and ultimately the invoice. CodeBurn alone is not sufficient for this policy.

## Approval checklist

Before approving a proposal, verify that it answers all of these questions:

- What exact outcome and deliverable am I approving?
- Which files may be read and which exact paths may be written?
- Which action-subject pairs will be authorized?
- Which tools and capability bindings may be used?
- Are external access, production, installs, secrets, and destructive actions explicitly allowed or denied?
- Which metrics have soft limits, hard limits, warnings, and a completion reserve?
- Which metrics are exact, estimated, or unavailable?
- For every hard metric, which trusted adapter, Ed25519 key, cumulative coverage, and enforcement point make it real?
- What happens at `exception_pending`: amendment, partial delivery, or stop?
- Is cost an estimate, provider-reported Costs data, or final invoice truth?

If any answer is unclear, revise the proposal before approval. Approval binds the proposal hash; a material revision creates a different hash and needs a new decision.
