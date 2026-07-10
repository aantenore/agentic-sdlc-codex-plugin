# REQ-PRODUCT-JOURNEY-001

## Product Goal

Turn Agentic SDLC from a robust low-level governance engine into a complete Codex product experience for the original use case: a user asks the plugin to contextualize an existing project and prepare an initial assessment without needing to understand SDLC artifact names or manually inspect JSON files.

## Expected Journey

1. Codex inspects the existing project and presents the inferred project context in plain language.
2. The user approves or corrects only that presented context.
3. Codex prepares one understandable work proposal containing assessment scope, evidence sources, output structure, real file format, local tools, boundaries, missing information, and the meaning of approval.
4. One approval covers exactly the items shown in that work proposal. A broader autonomy level is honored only inside the scope explicitly declared by the user.
5. Codex performs the assessment, creates the requested artifact, verifies it, links it to the project KB, and summarizes the result in chat.

## Acceptance Criteria

- The plugin exposes a dedicated assessment skill whose trigger matches natural requests to contextualize a project and prepare an initial functional or technical assessment.
- A normal low-risk assessment requires at most two understandable user checkpoints: project context and a combined work proposal.
- Capability profile/recommendation bookkeeping for already-installed local read-only tools does not become a separate user-facing approval unless it adds installs, external access, secrets, production access, or writes outside the agreed project output.
- Output templates store a canonical file format, extension, media type, delivery mode, and generator capability.
- Markdown, Word, Excel, PDF, PowerPoint, HTML, JSON, and CSV formats are represented explicitly; common aliases such as `word` and `excel` normalize correctly.
- Linking an output with an extension that contradicts the approved format fails deterministically.
- The assessment starter prompt is the first product prompt shown in the plugin.
- The complete journey and format enforcement have automated regression coverage and work from the installed plugin.
