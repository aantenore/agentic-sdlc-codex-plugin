# ST-OBSERVATORY-LINEAGE Plan

## Objective

Make each recorded SDLC iteration readable as one proof-bound causal dossier:
what was asked, what was decided and why, which contract governed the work,
what changed, and how it was verified or released.

## Scope

- In scope:
  - additive story dossiers in `change-observatory:view:v1`;
  - linkage derived only from canonical `story_id`, `requirement_id`, `related`,
    contract IDs, and evidence paths;
  - separate recorded rationale and labeled generated explanation;
  - responsive, accessible Asked / Decided / Contract / Done / Verified UI;
  - explicit missing, malformed, and unlinked states;
  - backend, UI, server, installed-plugin, and browser QA.
- Out of scope:
  - LLM calls from the app or reconstruction of unstored history;
  - timestamp, filename, or free-text similarity joins;
  - new dependencies, hosted services, external access, or project writes;
  - retroactively inventing stories for older project-level records.

## Assignment

- Claim: active
- Agent or owner: `codex-lineage`
- Branch: `codex/ST-OBSERVATORY-LINEAGE`
- Dependencies: delivered Observatory core, UI, and installed integration lanes

## Implementation Approach

1. Preserve canonical linkage and `trace-narrative:v1` rationale in normalized
   records without weakening raw-source safety.
2. Build deterministic per-story dossiers and lane coverage from explicit links.
3. Render one selected iteration as five non-technical causal lanes with source
   drill-down and honest missing states.
4. Prove cross-story isolation, deterministic ordering, malformed-input handling,
   package inclusion, and installed-plugin behavior.

## Sync And Handoff

- Sync events to record: commit, push, main consolidation
- Handoff target: project owner through `main`
- Handoff artifacts: implementation evidence, test receipt, desktop/mobile renders
- Open items: none at start

## Validation

- Targeted normalizer, server, and UI tests.
- Full `npm run check` and package/install smoke tests.
- Browser QA on the loopback app at desktop and mobile viewports.
- Strict story gate with canonical test and output evidence.
- Identity and forbidden-string audit before push and after main consolidation.

## Open Questions

- None.
