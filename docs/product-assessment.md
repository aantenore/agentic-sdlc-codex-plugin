# Product Assessment: Guided Project Assessment Journey

## Executive Verdict

### Before The Change

**Verdict: no-go as a self-service assessment product; go as an expert-operated SDLC governance engine.**

The pre-change product has strong contract, approval, evidence, trace, and Git-first KB mechanics. It can govern an assessment correctly when an operator understands baselines, capability profiles, output templates, contracts, and start confirmation. It does not yet turn the primary natural request into a coherent product journey. A user asking to contextualize a repository and prepare an assessment can encounter several internal approvals, SDLC vocabulary, and no enforceable distinction between a Markdown document and a requested Word, Excel, PDF, or PowerPoint artifact.

That is a product gap rather than a missing low-level feature. The engine is credible; the default user experience is not complete.

### After The Complete Change Set

**Verdict: go for bounded, local project assessments.**

The completed product accepts a natural project-contextualization request, activates a dedicated assessment journey, explains the inferred context before asking for approval, and uses no more than two normal checkpoints. Output format, extension, media type, delivery mode, generator, verification evidence, and approval scope are now canonical runtime data rather than presentation advice.

This verdict is supported by the full source suite, schema and plugin validators, a clean installed-plugin doctor run, a real Italian Codex interaction stopped at the explained context checkpoint, and real DOCX/XLSX artifacts generated, rendered, linked, and accepted by strict gates. Installs, external services, secrets, production, destructive actions, and writes outside the displayed output scope remain explicit decisions by design.

## Assessment Scope

This assessment evaluates the product experience for requests equivalent to:

> Contextualize this existing project and prepare an initial technical or functional assessment in my requested format.

The bounded happy path is read-only repository and KB analysis, already-installed local capabilities, one agreed project artifact, canonical SDLC bookkeeping, format-specific verification, and a concise chat summary. Implementation work, deployment, production inspection, secret-bearing systems, and unapproved external research are outside that path.

Evidence considered includes the existing Agentic SDLC skill and interaction documentation, CLI routing and approval behavior, project configuration, output-contract schemas, package boundaries, and regression tests. Repository evidence can show implemented behavior; it cannot prove unstored historical decisions or the semantic correctness of every future assessment.

## Product Strengths Before The Change

- Contracts, approvals, hashes, output links, traces, claims, and gates provide a serious governance foundation.
- Existing-project onboarding separates inferred context from confirmed canonical context.
- Approval records distinguish direct user approval, CI, delegated automation, and provisional bootstrap state.
- Capability discovery can model installed tools, missing installs, permissions, targets, and contract bindings.
- The KB is Git-first and auditable; cache and indexes are explicitly non-canonical.
- The language-agnostic router accepts normalized intent rather than embedding English keyword rules in the CLI.
- The test suite already exercises many failure modes around stale evidence, installation approval, contract readiness, and output linking.

## Pre-Change Product Gaps

| Gap | Product impact | Required correction |
| --- | --- | --- |
| Internal artifacts become user-facing checkpoints | A normal assessment can feel like configuring the SDLC engine instead of requesting an outcome | Collapse the journey into inferred context and one combined work proposal |
| Baseline approval can be misunderstood as broader consent | A short confirmation may appear to authorize format, tools, contract, or execution | State and enforce that baseline approval applies only to baseline context |
| Template, capability, contract, and start decisions are fragmented | Users repeat approvals for one conceptual task | Display scope, sources, sections, format, tools, limits, and start in one exact proposal |
| Broader autonomy is easy to overstate or misattribute | Delegated approval may be recorded as direct human approval or silently widened | Preserve the declared scope and record covered decisions through `approval_source: automation` |
| File format is presentation advice rather than a canonical contract | A `.md` file can be delivered when the user asked for Word or Excel | Store format, extension, media type, delivery mode, and generator capability; reject mismatches |
| Format-specific creation and verification are not part of the journey | A renamed or structurally invalid artifact can appear complete | Require `documents`, `spreadsheets`, `pdf`, or `presentations` as appropriate and verify rendered output |
| No assessment-specific preset | Assessments vary by agent and can omit product, security, evidence, or decision content | Provide one adaptable semantic preset for document and workbook delivery |
| The starter prompts lead with engine operations | The primary assessment journey is difficult to discover without prior plugin knowledge | Make project contextualization plus assessment the first product prompt |
| Installed-plugin behavior is not the primary release proof | Source-tree success can hide packaging or discovery defects | Exercise the realistic journey from the installed plugin |

## Target Product Behavior

### Checkpoint 1: Project Context

The product explains what it inferred from repository and KB evidence: purpose, stack, components, constraints, important files, assumptions, contradictions, and unknowns. The user approves or corrects only those facts. No assessment finding is produced yet, and this approval does not leak into later records.

### Checkpoint 2: Combined Work Proposal

The product presents one concrete proposal containing:

- assessment outcome and audience;
- in-scope and out-of-scope areas;
- exact evidence sources and local checks;
- ordered sections and format adaptation;
- canonical format, extension, media type, path, delivery mode, generator, and verifier;
- concrete tools, permissions, and targets;
- assumptions, missing information, limits, and escalation boundaries;
- the exact records and actions that approval will authorize;
- the execution start and final delivery behavior.

One answer covers only what is shown. A material change requires a revised proposal. A separately declared autonomy level applies only inside its exact boundary and is recorded as automation.

### Execution And Delivery

After approval, the product creates only the represented canonical records, confirms start, performs the assessment, creates the artifact using the required format skill, verifies the file and rendered result, links it to the approved output contract, records evidence, and summarizes the verdict in chat. There is no mandatory third approval before delivery.

## Format Product Contract

The first-class formats are `markdown`, `docx`, `xlsx`, `pdf`, `pptx`, `html`, `json`, and `csv`. Common user language such as `word` and `excel` must normalize to `docx` and `xlsx`. Every approved output template must carry canonical format metadata, and every linked artifact must have the matching extension.

The semantic assessment model remains stable across formats. Word preserves headings and tables. Excel uses section-specific worksheets, stable row IDs, and evidence references. PowerPoint condenses the decision narrative and retains detailed evidence in an appendix. JSON preserves section keys and IDs. CSV explicitly flattens the hierarchy rather than pretending to preserve rich document layout.

## Verified Product Evidence

- The complete automated source suite passes, including happy paths, stale-state checks, scoped delegated authorization, same-claimant resume, format aliases, extension rejection, structural verification, visual-evidence requirements, and installed-plugin discovery assumptions.
- `doctor`, syntax checks, package checks, JSON Schema checks, plugin manifest validation, and both skill validators pass.
- A clean local installation reports plugin version `0.5.0` and passes its bundled doctor checks.
- A real Italian Codex request selected both the core and assessment skills, inspected the repository, ran the local test, explained facts, assumptions, missing components, unknowns, and approval scope, then stopped at Checkpoint 1 without producing the assessment.
- Real DOCX and XLSX assessments were created through their format libraries, rendered for visual inspection, linked with verification receipts, and accepted by strict SDLC gates.
- CI covers supported Node versions on Linux, macOS, and Windows; release automation packages and checksums tagged builds.

## Remaining Limits

These are product boundaries rather than incomplete happy-path behavior:

- Generator skills are runtime dependencies. If one is missing, installation remains a direct decision and the product must not fabricate the requested format.
- Static repository inspection cannot validate production topology, live security controls, data handling, or operational performance without separately approved access.
- Structural and visual validation cannot guarantee strong reasoning. The assessment preset therefore requires evidence references, confidence, contradictions, and actionable recommendations.
- PPTX and CSV are intentionally reduced views of a detailed assessment; appendices or flattened records preserve required evidence.
- The two-checkpoint promise applies to the normal bounded path. A materially changed scope or risky capability properly creates an exceptional decision.

## Release Criteria

| Priority | Criterion | Pass condition | Required evidence |
| --- | --- | --- | --- |
| Blocking | Natural trigger | Technical, functional, architecture, and project-assessment requests in more than one language activate the dedicated journey | Installed-plugin scenario tests |
| Blocking | Product entry point | The first starter prompt asks the plugin to contextualize the project and prepare an assessment | Installed-plugin manifest/UI assertion |
| Blocking | Context boundary | Checkpoint 1 presents evidence and inference clearly; its approval is stored only against the baseline | Approval-record assertions |
| Blocking | Two-checkpoint journey | A low-risk local assessment completes with at most context plus combined proposal decisions | End-to-end interaction transcript/assertions |
| Blocking | Combined proposal completeness | Scope, sources, sections, artifact metadata, tools, limits, missing information, approval meaning, and start are all displayed | Proposal snapshot or structured assertion |
| Blocking | Exact approval scope | A short approval covers only displayed proposal elements; unseen or changed artifacts remain unapproved | Negative approval tests |
| Blocking | Delegated autonomy | Broader autonomy is preserved exactly and later covered approvals use `actor_type: agent` with `approval_source: automation` | Approval provenance tests |
| Blocking | Local capability bookkeeping | Already-installed local read-only tools do not add a separate checkpoint when policy permits; installs/external/secrets/production/out-of-scope writes do | Happy-path and escalation tests |
| Blocking | Canonical formats | All eight formats store format, extension, media type, delivery mode, and generator; aliases normalize deterministically | Schema and CLI tests |
| Blocking | Extension enforcement | Linking an artifact whose extension contradicts the approved format fails consistently | Negative CLI test for every format family |
| Blocking | Generator verification | DOCX, XLSX/CSV, PDF, and PPTX are generated and verified with `documents`, `spreadsheets`, `pdf`, and `presentations` respectively | Artifact and render evidence |
| Blocking | Assessment coverage | The preset includes product/context, architecture/component inventory, quality/tests, privacy/security, risks, recommendations, roadmap, evidence, and open decisions | Template structure test |
| Blocking | Word and Excel adaptation | The same semantic assessment renders as a readable Word document and a usable workbook without dropping required sections or evidence IDs | Rendered DOCX review and workbook inspection |
| Blocking | Installed package | The installed plugin discovers the skill and preset and completes the realistic journey | Clean-install smoke/e2e evidence |
| Blocking | Regression safety | Existing strict gates, approval governance, template reuse/delta behavior, and legacy template compatibility still pass | Full automated test suite |
| Advisory | Assessment usefulness | Findings cite evidence, confidence, impact, and actionable recommendations; unknowns are explicit | Content rubric on representative repositories |

## Representative Acceptance Scenarios

1. An Italian request for a Markdown technical assessment uses two checkpoints and returns a verified `.md` artifact plus chat summary.
2. A request for a "Word assessment" normalizes to DOCX, uses `documents`, renders the result, and links only `.docx`.
3. A request for an "Excel architecture assessment" normalizes to XLSX and produces the prescribed worksheets with stable IDs and evidence references.
4. A proposed Markdown template cannot link an `.xlsx` artifact, and a DOCX template cannot link a `.md` artifact.
5. An approved baseline followed by "ok" does not approve capabilities, format, contract, or start.
6. Already-installed local read-only capability records are handled as policy-backed automation without a third checkpoint.
7. A missing generator skill, external evidence source, secret-bearing endpoint, production target, or new write location produces an explicit decision before use.
8. A user-declared autonomy scope is copied into automation approval evidence without adding installs or unrelated work.
9. The same assessment preset produces coherent Markdown, Word, and Excel outputs with all mandatory sections represented.
10. A clean plugin install shows the contextualization-and-assessment starter before low-level initialization, contract, or gate prompts.

## Product Decision

Ship `0.5.0` as a complete bounded project-assessment product. Describe its scope precisely: repository and local-tool assessments are autonomous after the displayed decisions; external systems, installations, secrets, production access, destructive operations, and new out-of-scope writes require a new explicit decision.
