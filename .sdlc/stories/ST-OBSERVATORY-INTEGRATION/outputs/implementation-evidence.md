# Change delivery evidence

## What was asked?

Integrate Change Observatory into the Agentic SDLC plugin as an install-ready product surface: the installed plugin must include its launcher, runtime, browser UI, and Codex skill; reconstruct what was requested, changed, decided, and verified from canonical `.sdlc` evidence; and remain safe, local, testable, and understandable by non-technical readers.

Canonical request: [REQ-CHANGE-OBSERVATORY-001](../../../requirements/REQ-CHANGE-OBSERVATORY-001.json). Story: [ST-OBSERVATORY-INTEGRATION](../story.json). Approved execution boundary: [contract-ST-OBSERVATORY-INTEGRATION-implementation-v3](../../../contracts/contract-ST-OBSERVATORY-INTEGRATION-implementation-v3.json), approved content hash `a8a71781d1394c4aec24d97967d2b23affbe441aa41ad9758512385d042226c1`.

This artifact is the integration delta over the completed [UI implementation evidence](../../ST-OBSERVATORY-UI/outputs/implementation-evidence.md), which is itself a delta over the [core implementation evidence](../../ST-OBSERVATORY-CORE/outputs/implementation-evidence.md).

## Scope and non-goals

Delivered scope:

- Installed CLI command `agentic-sdlc observe --root <project>` with loopback host validation, ephemeral port support, optional browser opening, NDJSON automation output, and graceful shutdown.
- Plugin-local `change-observatory` skill and agent card that resolve the installed plugin root without relying on global `PATH` mutation.
- Complete npm/plugin packaging for runtime modules, UI assets, launcher, skill, documentation, schema changes, and version `0.7.0`.
- Per-run local API authorization, pinned filesystem boundaries, canonical source allowlisting, fail-closed parsing, and private-reasoning redaction.
- Optional trace narratives containing only shareable input/output summaries, rationale, alternatives, and explicitly labeled explanations.
- Configurable semantic ranking for the three overview answers, defensive diagnostic aggregation, bounded overview previews, neutral explanation labels, and responsive interaction QA.
- Regression fixes for output-registry-only artifact routing, story-context rehashing after automatic contract linkage, approved-baseline report synchronization, and import-safe visual preview tooling.

Explicit non-goals:

- No deployment, public package publication, release tag, telemetry, hosted service, external evidence upload, secret access, postinstall hook, frontend build, or global shell shim.
- No reconstruction of facts absent from canonical records and no exposure of private chain-of-thought.
- GitHub release publication remains a separate explicitly authorized action.

## Inputs

- [Requirement](../../../requirements/REQ-CHANGE-OBSERVATORY-001.json)
- [Story](../story.json)
- [Approved integration contract v3](../../../contracts/contract-ST-OBSERVATORY-INTEGRATION-implementation-v3.json)
- [Task-start receipt](../task-start.json)
- [Core implementation evidence](../../ST-OBSERVATORY-CORE/outputs/implementation-evidence.md)
- [UI implementation evidence](../../ST-OBSERVATORY-UI/outputs/implementation-evidence.md)
- [Accepted visual concept](../../../tests/ST-OBSERVATORY-UI-concept.png)
- Existing package manifest, plugin manifest, CLI, installer, doctor, output registry, schemas, and test harness

## What changed?

Launcher and installed-plugin surface:

- `lib/change-observatory/cli.mjs` composes the bundled server, resolves installed UI assets relative to `import.meta.url`, validates loopback/port options, opens browsers without a shell, emits ready/stopped events, and disposes signal handlers cleanly.
- `bin/agentic-sdlc.mjs` dispatches `observe` before workflow configuration is built, so malformed project configuration does not block read-only diagnosis.
- `skills/change-observatory/` adds the install-aware Codex launch workflow and agent card.

Packaging and documentation:

- `package.json` and `.codex-plugin/plugin.json` move the coordinated plugin surface to `0.7.0`, include `ui/`, advertise visual lineage, and retain a portable bin entry.
- `README.md`, `docs/change-observatory.md`, `docs/architecture.md`, `docs/how-it-works.md`, `docs/portable-install.md`, the Agentic SDLC skill, and command reference explain launch, installation, security, narrative recording, and troubleshooting.
- Doctor checks now cover the observatory core, launcher, UI, skill, and agent card.

Security and evidence boundaries:

- `server.mjs`, `path-safety.mjs`, and `source-reader.mjs` add per-run bearer authorization, canonical Host validation, device/inode boundary pinning, symlink rejection, source extension allowlisting, case-insensitive derived-path exclusion, bounded reads, and fail-closed malformed structured sources.
- `normalizer.mjs` and `source-reader.mjs` detect snake/camel/kebab variants of private reasoning markers; a flagged record cannot leak explanation, rationale, inputs, outputs, alternatives, or evidence.
- The UI consumes the fragment token once, removes it from browser history, retains it only for the local session, and attaches it to same-origin evidence requests.

Explainability and overview semantics:

- `lib/trace-narrative.mjs`, CLI flags, and `schemas/trace.schema.json` support versioned shareable narratives without private reasoning fields.
- `lib/change-observatory/summary-ranking.mjs` provides injectable ranking policies so implementations outrank sync bookkeeping and approvals/rationale outrank task-start events.
- Browser model and components aggregate equivalent diagnostics defensively, collapse non-error categories, cap overview panels, label explanation authorship accurately, and group recorded changes without claiming unrecorded file intent.

Regression and test infrastructure:

- Output routing now accepts artifact types declared only by the approved registry.
- Contract creation rehashes a story context source after the automatic story-to-contract link mutates it.
- Operational approval and output-link queues ignore superseded story contracts, while historical contracts remain intact in lineage for audit and explanation.
- Baseline approval regenerates the human-readable current-state report so Markdown and JSON status cannot diverge.
- Persisted gate reports use portable project-root metadata instead of embedding a developer-machine path.
- The visual preview helper is import-safe under `node --test` and validates its port explicitly.
- Installed-package and personal-marketplace tests assert the launcher, UI, skill, and agent card are staged and runnable from installed paths.

## Why was it decided?

Chosen approach: a dependency-free Node server and browser-native ES modules shipped directly inside the plugin, with a plugin-local skill as the Codex entry point and the npm bin as the shell entry point.

Evidence-backed rationale:

- Installed asset resolution through `import.meta.url` works from checkouts, npm/git/tarball installs, and Codex plugin directories without hard-coded machine paths.
- A random fragment-delivered capability protects canonical evidence from unrelated local processes that merely discover the port, while same-origin bearer requests avoid token transmission in ordinary request URLs and referrers.
- Server-side normalization centralizes storage compatibility and security; the browser receives a stable versioned projection rather than hard-coded `.sdlc` shapes.
- Semantic ranking prevents recent lifecycle bookkeeping from becoming the user-facing explanation of actual work or decisions.
- Dependency-free browser assets preserve offline/local use and remove a frontend build/install lifecycle from plugin installation.

Alternatives rejected:

- Global `PATH` or postinstall shims: rejected because Codex plugin installation does not guarantee or require shell mutation.
- Hosted dashboard: rejected because it would add network, identity, privacy, deployment, and operating-cost boundaries outside the approved local product.
- Unauthenticated localhost API: rejected because loopback alone does not isolate one local process or user from another.
- Browser-side direct filesystem parsing: rejected because it duplicates compatibility/security logic and couples presentation to storage layout.
- Chronological-only overview selection: rejected after real-project QA showed claim-release and task-start events displacing meaningful implementation and approval evidence.

Trade-offs:

- The capability token is ephemeral local authorization, not multi-user authentication; tunneling or remote bind remains intentionally unsupported.
- Static assets and health are public to loopback, while canonical evidence APIs require the token.
- The UI uses an accessible table rather than decorative lifecycle connectors and starts the raw drawer collapsed to preserve narrow-screen and laptop workspace height.

## Outputs

- Installed launcher: `lib/change-observatory/cli.mjs` and the `observe` CLI dispatch.
- Bundled UI/runtime: `lib/change-observatory/`, `ui/change-observatory/`, and the versioned API/source models.
- Installed Codex entry point: `skills/change-observatory/SKILL.md` and `agents/openai.yaml`.
- Shareable trace narrative schema, CLI flags, validation, and documentation.
- Coordinated plugin/package version `0.7.0` with complete allowlisted contents.
- Desktop and mobile browser evidence: [desktop](../../../tests/ST-OBSERVATORY-INTEGRATION-desktop.png) and [360px mobile](../../../tests/ST-OBSERVATORY-INTEGRATION-mobile.png).
- Structured verification record: [ST-OBSERVATORY-INTEGRATION-test-evidence.json](../../../tests/ST-OBSERVATORY-INTEGRATION-test-evidence.json).

## Verification

Automated outcome: `npm test` passed 165 tests with 0 failures. `npm run check`, `npm run doctor`, official plugin validation, all three skill validators, and tarball packaging validation passed.

Acceptance mapping:

1. Launcher behavior: unit tests cover option validation, shell-free browser commands, `--no-open`, ready output, idempotent close, signal cleanup, and loopback refusal. The installed tarball test launches the installed bin on an ephemeral port and terminates it cleanly.
2. Installed completeness: the tarball and personal-marketplace staging tests assert launcher, runtime, UI, skill, and agent card files. The installed path serves authenticated health, model, source, HTML, JavaScript, and CSS without the source checkout.
3. Security and read-only behavior: server tests cover Host/method rejection, traversal, symlink/cache/index/extension/case boundaries, `.sdlc` replacement, project root swap, token authorization, malformed input, private reasoning variants, response limits, and before/after filesystem snapshots.
4. Documentation and narratives: syntax/unit tests cover the narrative builder and schema; README, plugin prompts, architecture, portable install, Change Observatory guide, Agentic SDLC skill, and command reference document the installed workflow.
5. Existing behavior: the complete 165-test suite includes historical CLI, authorization, contract, output, dependency, cache, budget, assessment, packaging, and schema coverage.
6. Real browser QA: the plugin-local loopback server was opened in the Codex in-app browser at 1280×720 and 360×800. Navigation, semantic summaries, lineage, inspector, diagnostic disclosure, authenticated raw evidence, mobile menu, and responsive width passed with no console errors.

Fidelity ledger:

| Comparison point | Result | Recorded evidence |
| --- | --- | --- |
| App bar, navigation, summary, lineage, inspector, evidence area, raw drawer | Matched | Desktop screenshot and DOM snapshot preserve the concept hierarchy. |
| “Asked / changed / decided” content | Matched after QA fix | Requirement, implementation, and approval rationale are selected by configurable semantic policy. |
| Lineage above the fold | Matched after QA fix | Eleven equivalent legacy warnings are one collapsed diagnostic category. |
| Inspector explainability hierarchy | Matched | Record, rationale, inputs, outputs, neutral plain-language explanation, alternatives, and evidence are distinct. |
| Provenance/status semantics | Matched | Recorded, inferred, missing, malformed, complete, in-progress, and blocked remain explicit. |
| 360px navigation and raw evidence | Matched | Mobile menu and scoped raw source action pass without horizontal page overflow. |
| Lifecycle connector decoration | Intentional deviation | Accessible table relationships replace decorative arrows. |
| Raw drawer initial state | Intentional deviation | Collapsed by default; remains one labeled interaction away. |

## Generated explanation

Codex-generated from the recorded requirement, approved contracts, upstream implementation evidence, package tests, security tests, and real browser QA: installing Agentic SDLC now installs Change Observatory with it. A user can ask Codex to open the app or run `agentic-sdlc observe`, see the actual request, meaningful implementation, and approval rationale, move through contracts and lifecycle evidence, and inspect canonical source records locally. The app stays read-only, labels recorded versus inferred information, does not invent missing history, and never exposes private chain-of-thought.

## Lineage

- Requirement: [REQ-CHANGE-OBSERVATORY-001](../../../requirements/REQ-CHANGE-OBSERVATORY-001.json)
- Story: [ST-OBSERVATORY-INTEGRATION](../story.json)
- Approved contract: [contract-ST-OBSERVATORY-INTEGRATION-implementation-v3](../../../contracts/contract-ST-OBSERVATORY-INTEGRATION-implementation-v3.json)
- Authorization: [AUTH-OBSERVATORY-INTEGRATION-V3](../../../authorizations/AUTH-OBSERVATORY-INTEGRATION-V3.json)
- Task start: [task-start.json](../task-start.json)
- Core evidence: [ST-OBSERVATORY-CORE](../../ST-OBSERVATORY-CORE/outputs/implementation-evidence.md)
- UI evidence: [ST-OBSERVATORY-UI](../../ST-OBSERVATORY-UI/outputs/implementation-evidence.md)
- Integration trace: [ST-OBSERVATORY-INTEGRATION.jsonl](../../../traces/ST-OBSERVATORY-INTEGRATION.jsonl)
- Structured tests and fidelity ledger: [ST-OBSERVATORY-INTEGRATION-test-evidence.json](../../../tests/ST-OBSERVATORY-INTEGRATION-test-evidence.json)
- Desktop visual evidence: [ST-OBSERVATORY-INTEGRATION-desktop.png](../../../tests/ST-OBSERVATORY-INTEGRATION-desktop.png)
- Mobile visual evidence: [ST-OBSERVATORY-INTEGRATION-mobile.png](../../../tests/ST-OBSERVATORY-INTEGRATION-mobile.png)
- Branch: `codex/ST-OBSERVATORY-INTEGRATION`; the delivery commit and remote PR are recorded in Git and trace after final governance checks.
