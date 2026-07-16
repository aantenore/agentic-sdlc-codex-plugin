# Change delivery evidence

## What was asked?

Deliver the accessible visual lineage experience for Change Observatory inside the Agentic SDLC plugin. The primary screen must explain what was requested, what changed, and why; expose iteration and phase lineage, contracts, decisions, changes, verification, explainability, and raw records; and remain useful from 360px to desktop without a framework or build step.

Canonical request: [REQ-CHANGE-OBSERVATORY-001](../../../requirements/REQ-CHANGE-OBSERVATORY-001.json). Story: [ST-OBSERVATORY-UI](../story.json). Approved contract: [contract-ST-OBSERVATORY-UI-implementation](../../../contracts/contract-ST-OBSERVATORY-UI-implementation.json).

## Scope and non-goals

Delivered scope:

- Build-free, browser-native HTML, CSS, and modular JavaScript under `ui/change-observatory/`.
- Versioned `GET /api/v1/observatory` client and same-origin canonical raw-source client.
- Overview, Timeline, Contracts, Decisions, Changes, and Verification navigation.
- Evidence summaries, lineage matrix, contextual inspector, contract evolution, changes grouped by intent, verification evidence, and raw-record drawer.
- Explicit recorded, inferred, missing, and malformed provenance; absent narrative remains visibly “not recorded”.
- Semantic landmarks, keyboard navigation, focus states, responsive behavior, and reduced-motion handling.
- Test-only visual-QA fixture and local preview helper; no fixture or demo fallback is reachable from the shipped UI.

Explicit non-goals:

- The read-only server, CLI launcher, package manifest, and installed-package smoke test belong to the CORE and INTEGRATION stories.
- No framework, build tool, package install, CDN, external font, telemetry, cloud service, or external network request was added.
- No private chain-of-thought is rendered. If a malformed source declares it present, the UI shows only that it was hidden by design.

## Inputs

- [Requirement](../../../requirements/REQ-CHANGE-OBSERVATORY-001.json)
- [Story](../story.json)
- [Approved implementation contract](../../../contracts/contract-ST-OBSERVATORY-UI-implementation.json)
- [Task-start receipt](../task-start.json)
- [Approved visual concept](change-observatory-concept.png)
- `change-observatory:view:v1` API contract coordinated with ST-OBSERVATORY-CORE
- Existing dependency-free Node.js package conventions in `package.json` and `docs/architecture.md`

## What changed?

Application shell and design system:

- `ui/change-observatory/index.html` defines the semantic full-screen shell, SVG icon sprite, navigation, summary regions, inspector, and raw drawer.
- `ui/change-observatory/styles.css` implements the concept-derived white/charcoal/cobalt palette, semantic status colors, table-driven workspace, responsive breakpoints, focus treatment, and reduced-motion policy.

Evidence boundary and state:

- `ui/change-observatory/api.js` fetches only the versioned same-origin view model and canonical raw evidence, refuses unsafe targets, disables caching, rejects redirects, and bounds raw previews.
- `ui/change-observatory/model.js` validates the API schema, normalizes optional evidence without fabricating history, maps recorded narrative fields, and keeps missing provenance explicit.

Interaction components:

- `ui/change-observatory/components.js` renders summaries, lineage, filters, contract/decision/change/verification lists, explainability sections, source links, empty states, diagnostics, and raw-evidence affordances using safe DOM APIs rather than untrusted HTML.
- `ui/change-observatory/app.js` owns refresh, navigation, selection, filtering, raw-record loading, keyboard navigation, mobile navigation, and observable error states.

Verification support:

- `test/unit/change-observatory-ui.test.mjs` covers schema normalization, missing states, narrative fidelity, grouping/filtering, canonical raw paths, API behavior, self-contained assets, accessibility signals, responsive rules, reduced motion, and absence of gradients/external dependencies.
- `test/fixtures/change-observatory/view-model.json` and `test/helpers/change-observatory-preview-server.mjs` are explicitly synthetic test-only browser-QA support and are not imported by production code.
- `change-observatory-render.png` captures the final 1536×1058 implementation render used for comparison.

## Why was it decided?

Chosen approach: browser-native ES modules backed by a strict versioned view model. This preserves the plugin’s zero-build, dependency-free installation, keeps the UI independent of physical `.sdlc` file layouts, and allows the server-side normalizer to evolve without coupling the presentation to storage details.

Evidence-backed rationale:

- A semantic HTML table preserves iteration/phase relationships for assistive technology and horizontal navigation while matching the concept’s evidence-dense matrix.
- Safe DOM construction and `textContent` prevent canonical project records from becoming executable markup.
- Same-origin, canonical `.sdlc/` raw links and a restrictive CSP keep evidence inspection local and read-only.
- Optional narrative fields expose recorded input, output, rationale, generated explanation, alternatives, and evidence. Missing fields stay missing rather than being silently synthesized.

Alternatives rejected:

- React/Vite: rejected because it would add a build and dependency lifecycle to an otherwise dependency-free installed plugin.
- Hosted dashboard: rejected because it would move local project evidence across an external boundary and make offline use impossible.
- Reading `.sdlc` shapes directly in the browser: rejected because it would hard-code storage layout and duplicate normalization/security logic.
- Rendering a static concept image: rejected because navigation, filtering, selection, raw evidence, accessibility, and responsive behavior must be real interactions.

Trade-offs:

- The initial raw drawer is collapsed to protect the central workspace at laptop/mobile heights; the accepted concept showed it expanded. Raw evidence remains one labeled interaction away.
- Phase progression uses an accessible table and status cells instead of decorative connector arrows. This keeps the same information hierarchy while avoiding ambiguous lines in narrow/scrollable layouts.

## Outputs

- Installable, build-free UI asset tree: `ui/change-observatory/`.
- Reusable pure model/API modules and safe DOM component module.
- Test-only preview fixture/server and ten targeted Node tests.
- Accepted concept and final native-size render stored with the story outputs.
- This implementation evidence record and the story claim/trace lineage.

## Verification

Targeted command:

```text
node --test test/unit/change-observatory-ui.test.mjs
```

Outcome: 10 tests passed, 0 failed.

Acceptance mapping:

1. “What was asked?”, “What changed?”, and “Why was it decided?” are visible with source actions: verified by static invariants and `change-observatory-render.png`.
2. Lineage, contract evolution, changed-files-by-intent, verification, inspector, and raw drawer are implemented as interactive components: verified by module checks, model/filter tests, and browser render against the test-only API.
3. Generated explanations are labeled and missing narrative stays explicit; private chain-of-thought is never rendered: verified by narrative unit tests and the inspector render.
4. Keyboard labels/landmarks, focus states, 360px breakpoints, and reduced motion are present: verified by static invariants. Final 360px interaction replay remains part of root integration QA against the packaged launcher.

Browser verification used installed headless Google Chrome because Browser/IAB and Playwright were unavailable in this worktree. The native concept viewport `1536×1058` was rendered against the explicit test-only API fixture. Both the accepted concept and latest implementation render were inspected with `view_image` in the same QA pass.

Fidelity ledger:

| Comparison point | Concept evidence | Implementation evidence | Result |
| --- | --- | --- | --- |
| Full-screen anatomy | Header, left rail, summary strip, matrix, right inspector, lower evidence triad, raw drawer | Same regions and order in `change-observatory-render.png` | Matched |
| Primary copy/navigation | Six named navigation destinations and three plain-language questions | Exact labels and ordering preserved | Matched |
| Palette and surfaces | True white surfaces, charcoal text, cobalt selection, green/amber semantic states, no gradients | Tokenized equivalent palette; gradient-free invariant tested | Matched |
| Lineage density | Four iterations across six phases with selected implementation state and provenance legend | Four-by-six accessible table, selected implementation cell, state/provenance legend | Matched; connectors intentionally omitted |
| Inspector hierarchy | Request, decision/rationale, inputs, outputs, generated explanation, alternatives, evidence | Same hierarchy with generated-source label and explicit missing states | Matched |
| Lower evidence area | Contract evolution, changed files grouped by intent, verification evidence | Same three-panel composition and information hierarchy | Matched |
| Raw evidence | Persistent bottom drawer with formatted source preview | Persistent bottom drawer, collapsed initially and loaded on demand | Intentional default-state deviation |
| Typography/density | Compact desktop workspace with strong labels and restrained chrome | System-font equivalent, compact 10–14px chrome/content hierarchy | Matched within platform-font constraints |

No material visual mismatch remains for the delivered desktop state. Root integration QA will replay the same comparison with the real packaged API and the 360px viewport.

## Generated explanation

Codex-generated from the recorded requirement, approved contract, implementation outputs, tests, and visual evidence: Change Observatory now has a real local interface that lets a reader start with the human story—what was requested, what changed, and why—then progressively inspect contracts, decisions, implementation states, verification, and raw canonical records. The presentation does not guess missing history and does not reveal private reasoning.

## Lineage

- Requirement: [REQ-CHANGE-OBSERVATORY-001](../../../requirements/REQ-CHANGE-OBSERVATORY-001.json)
- Story: [ST-OBSERVATORY-UI](../story.json)
- Contract and approval: [contract-ST-OBSERVATORY-UI-implementation](../../../contracts/contract-ST-OBSERVATORY-UI-implementation.json)
- Capability boundary: [CAP-REC-CHANGE-OBSERVATORY](../../../capability-discovery/recommendations/CAP-REC-CHANGE-OBSERVATORY.json)
- Trace: [ST-OBSERVATORY-UI trace](../../../traces/ST-OBSERVATORY-UI.jsonl)
- Claim: [active story claim](../claim.json)
- Visual concept: [change-observatory-concept.png](change-observatory-concept.png)
- Visual verification: [change-observatory-render.png](change-observatory-render.png)
- Commit, handoff, output registry link, and packaged-launcher verification are recorded by the root integration story after this story commit is consumed.
