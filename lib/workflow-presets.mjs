import { immutableJson } from "./canonical.mjs";
import { approveWorkflowDefinition, buildWorkflowDefinition } from "./workflow-engine.mjs";

export const SOFTWARE_PROJECT_PHASES = Object.freeze([
  "discovery", "analysis", "design", "implementation", "validation", "release",
]);

const PRESETS = Object.freeze({
  "software-project": preset(
    "software-project",
    "Software project",
    SOFTWARE_PROJECT_PHASES,
    sequential(SOFTWARE_PROJECT_PHASES),
    { compatibility: { phase_order: SOFTWARE_PROJECT_PHASES } },
    { phase_order: SOFTWARE_PROJECT_PHASES },
  ),
  "change-request": preset(
    "change-request",
    "Change request",
    ["intake", "impact-review", "approval", "implementation", "validation", "closed"],
  ),
  "technical-assessment": preset(
    "technical-assessment",
    "Technical assessment",
    [
      "context_pending", "proposal_pending", "authorized", "running", "verifying", "completed",
      "exception_pending", "failed", "cancelled",
    ],
    [
      transition("confirm-context", "context_pending", "proposal_pending", [{ id: "checkpoint-approved", parameters: { checkpoint: "context" } }]),
      transition("cancel-from-context", "context_pending", "cancelled"),
      transition("authorize-proposal", "proposal_pending", "authorized", [{ id: "checkpoint-approved", parameters: { checkpoint: "combined-proposal" } }]),
      transition("cancel-from-proposal", "proposal_pending", "cancelled"),
      transition("revise-proposal", "authorized", "proposal_pending"),
      transition("start-assessment", "authorized", "running"),
      transition("cancel-authorized", "authorized", "cancelled"),
      transition("start-verification", "running", "verifying"),
      transition("request-exception", "running", "exception_pending"),
      transition("fail-running", "running", "failed"),
      transition("cancel-running", "running", "cancelled"),
      transition("resume-verification", "verifying", "running"),
      transition("complete-assessment", "verifying", "completed"),
      transition("request-verification-exception", "verifying", "exception_pending"),
      transition("fail-verification", "verifying", "failed"),
      transition("cancel-verification", "verifying", "cancelled"),
      transition("reauthorize-exception", "exception_pending", "authorized"),
      transition("resume-exception", "exception_pending", "running"),
      transition("fail-exception", "exception_pending", "failed"),
      transition("cancel-exception", "exception_pending", "cancelled"),
      transition("retry-failed", "failed", "authorized"),
      transition("cancel-failed", "failed", "cancelled"),
    ],
    { workflow_kind: "technical_assessment", normal_checkpoint_count: 2 },
    { normal_checkpoints: ["context", "combined-proposal"], terminal_states: ["completed", "cancelled"] },
  ),
  "generic-governed-process": preset(
    "generic-governed-process",
    "Generic governed process",
    ["draft", "review", "approved", "execution", "verification", "completed"],
    [
      transition("submit-for-review", "draft", "review"),
      transition("approve", "review", "approved", [{ id: "context-equals", parameters: { key: "authorized", value: true } }]),
      transition("start-execution", "approved", "execution"),
      transition("start-verification", "execution", "verification"),
      transition("complete", "verification", "completed"),
    ],
  ),
});

/** Return stable preset identifiers suitable for CLI discovery. */
export function listWorkflowPresets() {
  return immutableJson(Object.values(PRESETS).map(({ id, label, states, metadata }) => ({
    id,
    version: "1",
    status: "included",
    label,
    state_count: states.length,
    metadata,
  })));
}

/** Return a template without lifecycle timestamps or hashes. */
export function getWorkflowPreset(id) {
  const candidate = PRESETS[id];
  if (!candidate) throw new Error(`Unknown workflow preset '${id}'`);
  return immutableJson(candidate);
}

/** Materialize an approved immutable definition from a built-in preset. */
export function buildWorkflowPreset(id, options = {}) {
  const source = getWorkflowPreset(id);
  const createdAt = options.created_at ?? "1970-01-01T00:00:00.000Z";
  const proposed = buildWorkflowDefinition({
    ...source,
    id: options.id ?? source.id,
    version: options.version ?? 1,
    created_at: createdAt,
    status: "proposed",
    approval: null,
  }, options);
  return approveWorkflowDefinition(proposed, {
    ...options,
    approved_at: options.approved_at ?? createdAt,
    actor: options.actor ?? { id: "builtin-preset", type: "system", name: "Agentic SDLC" },
    approval_source: options.approval_source ?? "bootstrap",
    summary: options.summary ?? `Built-in ${id} workflow preset`,
  });
}

function preset(id, label, stateIds, transitions = sequential(stateIds), metadata = {}, options = {}) {
  const terminalStates = new Set(options.terminal_states ?? [stateIds.at(-1)]);
  return {
    id,
    label,
    description: `${label} governed workflow preset.`,
    initial_state: stateIds[0],
    states: stateIds.map((stateId, index) => ({ id: stateId, label: words(stateId), terminal: terminalStates.has(stateId), metadata: { order: index + 1 } })),
    transitions,
    phase_order: options.phase_order ?? [],
    normal_checkpoints: options.normal_checkpoints ?? [],
    metadata,
  };
}

function sequential(states) {
  return states.slice(0, -1).map((from, index) => transition(`${from}-to-${states[index + 1]}`, from, states[index + 1]));
}

function transition(id, from, to, guards = []) { return { id, from, to, label: `${words(from)} to ${words(to)}`, guards, metadata: {} }; }
function words(value) { return value.split(/[-_]/u).map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join(" "); }
