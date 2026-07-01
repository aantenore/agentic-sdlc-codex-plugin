#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import childProcess from "node:child_process";
import { fileURLToPath } from "node:url";

const VERSION = "0.4.3";
const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_TEMPLATE_DIR = path.join(PLUGIN_ROOT, "templates");
const SDLC_DIR = ".sdlc";
const CACHE_FILE_NAME = "kb-cache.json";
const PROJECT_CONFIG_FILE_NAME = "config.json";
const OUTPUT_LINK_MODES = new Set(["reuse", "delta", "new"]);
const BOOLEAN_OPTIONS = new Set([
  "apply",
  "approve-install",
  "dry-run",
  "force",
  "help",
  "json",
  "preserve-status",
  "release-claim",
  "strict",
  "version",
]);
const STORY_STATUSES = new Set(["draft", "ready", "analysis", "design", "implementation", "in_progress", "review", "validation", "release", "done", "blocked"]);
const CLAIM_STATUSES = new Set(["active", "released", "transferred", "cancelled"]);
const LOCK_STATUSES = new Set(["active", "released", "cancelled", "expired"]);
const HANDOFF_STATUSES = new Set(["open", "accepted", "closed", "rejected", "cancelled"]);
const WORK_ITEM_TYPES = new Set(["requirement", "epic", "story", "task"]);
const WORK_ITEM_CREATE_TYPES = new Set(["epic", "task"]);
const CAPABILITY_TYPES = new Set(["skills", "mcp", "tools"]);
const CAPABILITY_GROUPS = new Set(["required", "allowed", "forbidden"]);
const DEPENDENCY_TYPES = new Set(["blocks", "requires_artifact", "requires_contract", "related", "same_requirement", "parent_epic"]);
const DEPENDENCY_BLOCK_SCOPES = new Set(["analysis", "design", "implementation", "validation", "release", "none"]);
const CAPABILITY_RECOMMENDATION_AVAILABILITY = new Set(["available", "missing", "unknown", "install_required"]);
const APPROVAL_SOURCES = new Set(["explicit-user", "ci", "automation", "bootstrap"]);
const STORY_STEP_NAMES = new Set([
  "discovery",
  "functional-analysis",
  "technical-analysis",
  "design",
  "implementation",
  "validation",
  "release",
]);
const ACTIVITY_REPORT_VIEWS = new Set(["business", "dev", "agent-verbose"]);
const REPORT_QUERY_SUBJECTS = new Set([
  "activity",
  "stories",
  "story_steps",
  "outputs",
  "contracts",
  "handoffs",
  "work_items",
  "approvals",
  "tests",
  "all",
]);
const ROUTE_REQUIRED_INTENT_FIELDS = [
  "requested_action",
  "confidence",
  "referenced_entities",
  "provided_artifacts",
  "missing_context",
  "proposed_phase",
  "artifact_type",
  "skip_phases",
];
const ROUTE_DEFAULT_CONFIDENCE = {
  auto_route_min: 0.85,
  confirm_min: 0.7,
  ask_below: 0.5,
  always_confirm: [
    "skip_phase",
    "create_story",
    "start_implementation",
    "create_canonical_artifact",
    "new_output_template",
    "duplicate_output",
  ],
};
const ROUTE_DEFAULT_ROUTES = new Set([
  "init_project",
  "onboard_existing_project",
  "ask_clarification",
  "intake_requirement",
  "classify_artifact",
  "decompose_stories",
  "create_contract",
  "confirm_phase_skip",
  "claim_and_implement",
  "discover_capabilities",
  "technical_decision",
  "validate_story",
  "release_story",
]);

const TRACE_TYPES = new Set([
  "assumption",
  "decision",
  "gate",
  "claim",
  "handoff",
  "implementation",
  "lock",
  "release",
  "risk",
  "sync",
  "test",
]);

function main() {
  try {
    const parsed = parseArgs(process.argv.slice(2));
    if (parsed.version) {
      console.log(VERSION);
      return;
    }
    if (parsed.help || parsed.positionals.length === 0) {
      printHelp();
      return;
    }

    const [command, subcommand, ...rest] = parsed.positionals;
    const context = buildContext(parsed.options);

    if (command === "init") {
      initProject(context, parsed.options);
      return;
    }
    if (command === "onboard" && subcommand === "existing-project") {
      onboardExistingProject(context, parsed.options);
      return;
    }
    if (command === "baseline" && subcommand === "propose") {
      proposeBaseline(context, parsed.options);
      return;
    }
    if (command === "baseline" && subcommand === "approve") {
      approveBaseline(context, parsed.options);
      return;
    }
    if (command === "baseline" && subcommand === "status") {
      showBaselineStatus(context, parsed.options);
      return;
    }
    if (command === "contract" && subcommand === "create") {
      createContract(context, parsed.options);
      return;
    }
    if (command === "contract" && subcommand === "approve") {
      approveContract(context, parsed.options);
      return;
    }
    if (command === "story" && subcommand === "create") {
      createStory(context, parsed.options);
      return;
    }
    if (command === "story" && subcommand === "claim") {
      claimStory(context, parsed.options);
      return;
    }
    if (command === "story" && subcommand === "release") {
      releaseStoryClaim(context, parsed.options);
      return;
    }
    if (command === "story" && subcommand === "complete-step") {
      completeStoryStep(context, parsed.options);
      return;
    }
    if (command === "story" && subcommand === "prepare-handoff") {
      prepareStoryHandoff(context, parsed.options);
      return;
    }
    if (command === "story" && subcommand === "handoff" && rest[0] === "close") {
      closeHandoff(context, parsed.options);
      return;
    }
    if (command === "story" && subcommand === "handoff") {
      createStoryHandoff(context, parsed.options);
      return;
    }
    if (command === "story" && subcommand === "deps") {
      showStoryDependencies(context, parsed.options);
      return;
    }
    if (command === "work" && subcommand === "item" && rest[0] === "create") {
      createWorkItem(context, parsed.options);
      return;
    }
    if (command === "breakdown" && subcommand === "policy" && rest[0] === "show") {
      showBreakdownPolicy(context, parsed.options);
      return;
    }
    if (command === "breakdown" && subcommand === "policy" && rest[0] === "set") {
      setBreakdownPolicy(context, parsed.options);
      return;
    }
    if (command === "breakdown" && subcommand === "propose") {
      proposeBreakdown(context, parsed.options);
      return;
    }
    if (command === "breakdown" && subcommand === "approve") {
      approveBreakdown(context, parsed.options);
      return;
    }
    if (command === "breakdown" && subcommand === "status") {
      showBreakdownStatus(context, parsed.options);
      return;
    }
    if (command === "dependency" && subcommand === "propose") {
      proposeDependencyGraph(context, parsed.options);
      return;
    }
    if (command === "dependency" && subcommand === "approve") {
      approveDependencyGraph(context, parsed.options);
      return;
    }
    if (command === "dependency" && subcommand === "status") {
      showDependencyStatus(context, parsed.options);
      return;
    }
    if (command === "capability" && subcommand === "profile" && rest[0] === "propose") {
      proposeCapabilityProfile(context, parsed.options);
      return;
    }
    if (command === "capability" && subcommand === "profile" && rest[0] === "approve") {
      approveCapabilityProfile(context, parsed.options);
      return;
    }
    if (command === "capability" && subcommand === "profile" && rest[0] === "status") {
      showCapabilityStatus(context, parsed.options);
      return;
    }
    if (command === "capability" && subcommand === "recommend") {
      proposeCapabilityRecommendation(context, parsed.options);
      return;
    }
    if (command === "capability" && subcommand === "approve") {
      approveCapabilityRecommendation(context, parsed.options);
      return;
    }
    if (command === "capability" && subcommand === "status") {
      showCapabilityStatus(context, parsed.options);
      return;
    }
    if (command === "handoff" && subcommand === "close") {
      closeHandoff(context, parsed.options);
      return;
    }
    if (command === "phase" && subcommand === "lock") {
      lockPhase(context, parsed.options);
      return;
    }
    if (command === "phase" && subcommand === "release") {
      releasePhaseLock(context, parsed.options);
      return;
    }
    if (command === "trace" && subcommand === "append") {
      appendTrace(context, parsed.options);
      return;
    }
    if (command === "sync" && subcommand === "record") {
      recordSyncEvent(context, parsed.options);
      return;
    }
    if (command === "output" && subcommand === "template" && rest[0] === "propose") {
      proposeOutputTemplate(context, parsed.options);
      return;
    }
    if (command === "output" && subcommand === "template" && rest[0] === "approve") {
      approveOutputTemplate(context, parsed.options);
      return;
    }
    if (command === "output" && subcommand === "resolve") {
      resolveOutput(context, parsed.options);
      return;
    }
    if (command === "output" && subcommand === "link") {
      linkOutputArtifact(context, parsed.options);
      return;
    }
    if (command === "output" && subcommand === "status") {
      showOutputStatus(context, parsed.options);
      return;
    }
    if (command === "cache" && subcommand === "rebuild") {
      rebuildCache(context, parsed.options);
      return;
    }
    if (command === "cache" && subcommand === "status") {
      showCacheStatus(context, parsed.options);
      return;
    }
    if (command === "cache" && subcommand === "clear") {
      clearCache(context, parsed.options);
      return;
    }
    if (command === "manifest" && subcommand === "rebuild") {
      rebuildManifests(context, parsed.options);
      return;
    }
    if (command === "trace" && subcommand === "compact") {
      compactTraces(context, parsed.options);
      return;
    }
    if (command === "archive" && subcommand === "closed") {
      archiveClosedArtifacts(context, parsed.options);
      return;
    }
    if (command === "report" && subcommand === "activity") {
      reportActivity(context, parsed.options);
      return;
    }
    if (command === "report" && subcommand === "query") {
      reportQuery(context, parsed.options);
      return;
    }
    if (command === "index" && subcommand === "rebuild") {
      rebuildIndex(context, parsed.options);
      return;
    }
    if (command === "kb" && subcommand === "search") {
      searchKnowledgeBase(context, parsed.options, rest);
      return;
    }
    if (command === "gate" && subcommand === "check") {
      gateCheck(context, parsed.options);
      return;
    }
    if (command === "orchestrate" && subcommand === "status") {
      showOrchestrationStatus(context, parsed.options);
      return;
    }
    if (command === "orchestrate" && subcommand === "plan") {
      showOrchestrationPlan(context, parsed.options);
      return;
    }
    if (command === "route" && (!subcommand || subcommand === "decide")) {
      decideRoute(context, parsed.options);
      return;
    }
    if (command === "status") {
      showStatus(context, parsed.options);
      return;
    }

    fail(`Unknown command: ${[command, subcommand].filter(Boolean).join(" ")}`);
  } catch (error) {
    if (error instanceof UserError) {
      console.error(`Error: ${error.message}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
}

class UserError extends Error {}

function parseArgs(argv) {
  const options = {};
  const positionals = [];
  let help = false;
  let version = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "--version" || arg === "-v") {
      version = true;
      continue;
    }
    if (arg.startsWith("--")) {
      const raw = arg.slice(2);
      const equalsIndex = raw.indexOf("=");
      const key = equalsIndex >= 0 ? raw.slice(0, equalsIndex) : raw;
      const inlineValue = equalsIndex >= 0 ? raw.slice(equalsIndex + 1) : undefined;
      let value = inlineValue;
      if (value === undefined && BOOLEAN_OPTIONS.has(key)) {
        value = true;
      } else if (value === undefined) {
        const next = argv[index + 1];
        if (next !== undefined && !next.startsWith("-")) {
          value = next;
          index += 1;
        } else {
          value = true;
        }
      }
      addOption(options, key, value);
      continue;
    }
    positionals.push(arg);
  }

  return { options, positionals, help, version };
}

function addOption(options, key, value) {
  if (options[key] === undefined) {
    options[key] = value;
    return;
  }
  if (!Array.isArray(options[key])) {
    options[key] = [options[key]];
  }
  options[key].push(value);
}

function buildContext(options) {
  const root = path.resolve(String(options.root || process.cwd()));
  const templateDir = path.resolve(String(options["template-dir"] || DEFAULT_TEMPLATE_DIR));
  const templateConfig = validateSdlcConfig(readJson(path.join(templateDir, "sdlc-config.json")));
  const projectConfigPath = path.join(root, SDLC_DIR, PROJECT_CONFIG_FILE_NAME);
  const selectedConfig = fs.existsSync(projectConfigPath)
    ? validateSdlcConfig(readJson(projectConfigPath))
    : templateConfig;
  return {
    root,
    sdlcRoot: path.join(root, SDLC_DIR),
    templateDir,
    config: selectedConfig,
    templateConfig,
  };
}

function validateSdlcConfig(config) {
  if (!config || typeof config !== "object") {
    fail("SDLC config must be a JSON object");
  }
  validateSdlcDirectoryList(config.kb_directories, "kb_directories");
  validateSdlcDirectoryList(config.cache_policy?.source_of_truth_dirs, "cache_policy.source_of_truth_dirs");
  validateSdlcDirectoryList(config.cache_policy?.derived_directories, "cache_policy.derived_directories");
  validateRoutingPolicy(config.routing_policy);
  validateWorkBreakdownPolicy(config.work_breakdown_policy);
  validateApprovalPolicy(config.approval_policy);
  return config;
}

function validateSdlcDirectoryList(values, field) {
  if (values === undefined) {
    return;
  }
  if (!Array.isArray(values)) {
    fail(`${field} must be an array`);
  }
  for (const value of values) {
    assertSafeSdlcRelativeDirectory(value, field);
  }
}

function assertSafeSdlcRelativeDirectory(value, field) {
  const raw = String(value || "").trim();
  const normalized = path.posix.normalize(raw.replaceAll("\\", "/"));
  if (!raw || raw === "." || normalized === "." || normalized.startsWith("../") || normalized === ".." || path.isAbsolute(raw)) {
    fail(`${field} contains unsafe .sdlc-relative directory '${value}'`);
  }
  if (normalized.split("/").includes("..")) {
    fail(`${field} contains unsafe .sdlc-relative directory '${value}'`);
  }
}

function validateRoutingPolicy(policy) {
  if (policy === undefined) {
    return;
  }
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    fail("routing_policy must be a JSON object");
  }
  if (policy.routes !== undefined && !Array.isArray(policy.routes)) {
    fail("routing_policy.routes must be an array");
  }
  if (policy.canonical_actions !== undefined && (!policy.canonical_actions || typeof policy.canonical_actions !== "object" || Array.isArray(policy.canonical_actions))) {
    fail("routing_policy.canonical_actions must be an object");
  }
  const confidence = policy.confidence;
  if (confidence !== undefined) {
    if (!confidence || typeof confidence !== "object" || Array.isArray(confidence)) {
      fail("routing_policy.confidence must be an object");
    }
    for (const key of ["auto_route_min", "confirm_min", "ask_below"]) {
      if (confidence[key] !== undefined) {
        const value = Number(confidence[key]);
        if (!Number.isFinite(value) || value < 0 || value > 1) {
          fail(`routing_policy.confidence.${key} must be a number between 0 and 1`);
        }
      }
    }
    if (confidence.always_confirm !== undefined && !Array.isArray(confidence.always_confirm)) {
      fail("routing_policy.confidence.always_confirm must be an array");
    }
  }
}

function validateWorkBreakdownPolicy(policy) {
  if (policy === undefined) {
    return;
  }
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    fail("work_breakdown_policy must be a JSON object");
  }
  for (const field of ["levels", "claimable_units"]) {
    if (policy[field] !== undefined) {
      if (!Array.isArray(policy[field])) {
        fail(`work_breakdown_policy.${field} must be an array`);
      }
      for (const value of policy[field]) {
        const type = normalizeWorkItemType(value, { allowStory: true });
        if (!WORK_ITEM_TYPES.has(type)) {
          fail(`work_breakdown_policy.${field} contains unknown work item type '${value}'`);
        }
      }
    }
  }
  for (const field of ["delivery_unit", "strict_gate_unit"]) {
    if (policy[field] !== undefined) {
      normalizeWorkItemType(policy[field], { allowStory: true });
    }
  }
  if (policy.task_gate !== undefined && !["light", "strict", "none"].includes(String(policy.task_gate))) {
    fail("work_breakdown_policy.task_gate must be light, strict, or none");
  }
}

function validateApprovalPolicy(policy) {
  if (policy === undefined) {
    return;
  }
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    fail("approval_policy must be an object");
  }
  if (policy.accepted_sources !== undefined) {
    if (!Array.isArray(policy.accepted_sources)) {
      fail("approval_policy.accepted_sources must be an array");
    }
    for (const source of policy.accepted_sources) {
      if (!APPROVAL_SOURCES.has(String(source))) {
        fail(`approval_policy.accepted_sources contains invalid source '${source}'`);
      }
    }
  }
  if (
    policy.legacy_approval_behavior !== undefined &&
    !["warn", "error"].includes(String(policy.legacy_approval_behavior))
  ) {
    fail("approval_policy.legacy_approval_behavior must be 'warn' or 'error'");
  }
}

function decideRoute(context, options) {
  const decision = buildRouteDecision(context, options);
  output(options, decision, formatRouteDecision(decision));
}

function buildRouteDecision(context, options) {
  const policy = getRoutingPolicy(context);
  const intentLoad = loadRouteIntent(context, options);
  const decision = createRouteDecision(context, {
    intent_source: intentLoad.source,
    confidence: intentLoad.intent?.confidence,
  });

  if (intentLoad.parse_error) {
    addRouteCheck(decision, "canonical_intent", "failed", intentLoad.parse_error);
    return finalizeAskRoute(decision, {
      status: "needs_normalization",
      blocking_reasons: ["invalid_intent_json"],
      questions: [canonicalIntentQuestion()],
      next_commands: [canonicalIntentCommand()],
    });
  }

  if (!intentLoad.intent) {
    addRouteCheck(decision, "canonical_intent", "failed", "No --intent-json or --intent-file provided");
    if (options.text !== undefined) {
      addRouteCheck(decision, "raw_text", "ignored", "Raw text is untrusted and is not classified by the router");
    }
    return finalizeAskRoute(decision, {
      status: "needs_normalization",
      blocking_reasons: ["needs_normalization"],
      questions: [canonicalIntentQuestion()],
      next_commands: [canonicalIntentCommand()],
    });
  }

  const normalized = normalizeRouteIntent(intentLoad.intent, policy, context);
  decision.intent = normalized.intent;
  decision.confidence = normalized.intent.confidence;
  addRouteCheck(
    decision,
    "canonical_intent",
    normalized.errors.length ? "failed" : "passed",
    normalized.errors.length ? normalized.errors.join("; ") : "Canonical JSON intent accepted",
  );
  if (options.text !== undefined) {
    addRouteCheck(decision, "raw_text", "ignored", "Raw text is untrusted; canonical JSON controls routing");
  }
  if (normalized.errors.length) {
    return finalizeAskRoute(decision, {
      status: "needs_normalization",
      blocking_reasons: ["invalid_canonical_intent"],
      questions: normalized.questions.length ? normalized.questions : [canonicalIntentQuestion()],
      next_commands: [canonicalIntentCommand()],
    });
  }

  const confidenceOutcome = applyRouteConfidenceGate(decision, policy);
  if (confidenceOutcome === "ask") {
    return finalizeAskRoute(decision, {
      status: "low_confidence",
      blocking_reasons: ["low_confidence"],
      questions: ["Confirm the canonical intent with higher confidence before routing."],
      next_commands: [canonicalIntentCommand()],
    });
  }

  const preInitActionConfig = routeActionConfig(policy, decision.intent.requested_action);
  const kbInitialized = isKbInitialized(context);
  addRouteCheck(
    decision,
    "kb_initialized",
    kbInitialized ? "passed" : "failed",
    kbInitialized ? `${SDLC_DIR}/project.json exists` : `${SDLC_DIR}/project.json is missing`,
  );
  if (!kbInitialized) {
    if (preInitActionConfig?.route === "onboard_existing_project") {
      decision.route = "onboard_existing_project";
      decision.next_commands.push(`agentic-sdlc onboard existing-project --root ${context.root} --project-name <name> --document <path>`);
      return finalizeConcreteRoute(decision, policy, preInitActionConfig, confidenceOutcome);
    }
    decision.route = "init_project";
    decision.next_commands.push(`agentic-sdlc init --root ${context.root}`);
    return finalizeConcreteRoute(decision, policy, preInitActionConfig?.route === "init_project" ? preInitActionConfig : routeActionConfig(policy, "init_project"), confidenceOutcome);
  }

  if (decision.intent.missing_context.length > 0) {
    return finalizeAskRoute(decision, {
      status: "needs_clarification",
      blocking_reasons: ["missing_context"],
      questions: decision.intent.missing_context.map(routeQuestionFromContext),
      next_commands: [canonicalIntentCommand()],
    });
  }

  if (decision.intent.skip_phases.length > 0) {
    decision.route = "confirm_phase_skip";
    decision.requires_confirmation = true;
    decision.next_commands.push(
      `agentic-sdlc trace append --type decision --summary "Approved phase skip: ${decision.intent.skip_phases.join(", ")}" --actor-type human`,
    );
    return finalizeConcreteRoute(decision, policy, { confirmation_key: "skip_phase" }, confidenceOutcome);
  }

  const actionConfig = routeActionConfig(policy, decision.intent.requested_action);
  if (!actionConfig) {
    return finalizeAskRoute(decision, {
      status: "needs_normalization",
      blocking_reasons: ["unknown_requested_action"],
      questions: [`Use one of the configured requested_action values: ${Object.keys(policy.canonical_actions).sort().join(", ")}.`],
      next_commands: [canonicalIntentCommand()],
    });
  }

  switch (actionConfig.route) {
    case "init_project":
      return decideInitProjectRoute(decision, policy, actionConfig, confidenceOutcome);
    case "onboard_existing_project":
      return decideOnboardExistingProjectRoute(context, decision, policy, actionConfig, confidenceOutcome);
    case "intake_requirement":
      return decideIntakeRequirementRoute(decision, policy, actionConfig, confidenceOutcome);
    case "decompose_stories":
      return decideDecomposeStoriesRoute(context, decision, policy, actionConfig, confidenceOutcome);
    case "create_contract":
      return decideCreateContractRoute(context, decision, policy, actionConfig, confidenceOutcome);
    case "claim_and_implement":
      return decideClaimAndImplementRoute(context, decision, policy, actionConfig, confidenceOutcome);
    case "classify_artifact":
      return decideClassifyArtifactRoute(context, decision, policy, actionConfig, confidenceOutcome);
    case "discover_capabilities":
      return decideCapabilityDiscoveryRoute(context, decision, policy, actionConfig, confidenceOutcome);
    case "technical_decision":
      return decideTechnicalDecisionRoute(context, decision, policy, actionConfig, confidenceOutcome);
    case "validate_story":
      return decideStoryGateRoute(context, decision, policy, actionConfig, confidenceOutcome, "validate_story");
    case "release_story":
      return decideStoryGateRoute(context, decision, policy, actionConfig, confidenceOutcome, "release_story");
    case "confirm_phase_skip":
      decision.route = "confirm_phase_skip";
      decision.requires_confirmation = true;
      decision.next_commands.push(
        `agentic-sdlc trace append --type decision --summary "Approved phase skip" --actor-type human`,
      );
      return finalizeConcreteRoute(decision, policy, actionConfig, confidenceOutcome);
    default:
      return finalizeAskRoute(decision, {
        status: "needs_normalization",
        blocking_reasons: ["unknown_route"],
        questions: [`Configured route '${actionConfig.route}' is not supported by this CLI version.`],
        next_commands: [canonicalIntentCommand()],
      });
  }
}

function getRoutingPolicy(context) {
  const template = context.templateConfig.routing_policy || {};
  const project = context.config.routing_policy || {};
  const confidence = normalizeRoutingConfidence({
    ...ROUTE_DEFAULT_CONFIDENCE,
    ...(template.confidence || {}),
    ...(project.confidence || {}),
  });
  return {
    routes: new Set([
      ...ROUTE_DEFAULT_ROUTES,
      ...normalizeStringArray(template.routes),
      ...normalizeStringArray(project.routes),
    ]),
    confidence,
    canonical_actions: {
      ...defaultRouteActions(),
      ...normalizeRouteActionMap(template.canonical_actions || template.action_routes),
      ...normalizeRouteActionMap(project.canonical_actions || project.action_routes),
    },
    entity_types: {
      story: ["story"],
      contract: ["contract"],
      requirement: ["requirement"],
      template: ["template", "output_template"],
      ...(template.entity_types || {}),
      ...(project.entity_types || {}),
    },
  };
}

function normalizeRoutingConfidence(confidence) {
  const normalized = {
    auto_route_min: Number(confidence.auto_route_min),
    confirm_min: Number(confidence.confirm_min),
    ask_below: Number(confidence.ask_below),
    always_confirm: normalizeStringArray(confidence.always_confirm).map(normalizeRouteToken),
  };
  if (!Number.isFinite(normalized.auto_route_min)) {
    normalized.auto_route_min = ROUTE_DEFAULT_CONFIDENCE.auto_route_min;
  }
  if (!Number.isFinite(normalized.confirm_min)) {
    normalized.confirm_min = ROUTE_DEFAULT_CONFIDENCE.confirm_min;
  }
  if (!Number.isFinite(normalized.ask_below)) {
    normalized.ask_below = ROUTE_DEFAULT_CONFIDENCE.ask_below;
  }
  normalized.ask_below = clamp01(normalized.ask_below);
  normalized.confirm_min = clamp01(normalized.confirm_min);
  normalized.auto_route_min = clamp01(normalized.auto_route_min);
  if (normalized.confirm_min < normalized.ask_below) {
    normalized.confirm_min = normalized.ask_below;
  }
  if (normalized.auto_route_min < normalized.confirm_min) {
    normalized.auto_route_min = normalized.confirm_min;
  }
  return normalized;
}

function defaultRouteActions() {
  return {
    initialize_project: { route: "init_project" },
    init_project: { route: "init_project" },
    onboard_existing_project: { route: "onboard_existing_project" },
    existing_project_onboarding: { route: "onboard_existing_project" },
    create_baseline: { route: "onboard_existing_project", confirmation_key: "create_canonical_artifact" },
    intake_requirement: { route: "intake_requirement" },
    classify_artifact: { route: "classify_artifact", requires_artifact_type: true },
    decompose_stories: { route: "decompose_stories", confirmation_key: "create_story" },
    create_story: { route: "decompose_stories", confirmation_key: "create_story" },
    create_contract: { route: "create_contract" },
    discover_capabilities: {
      route: "discover_capabilities",
      confirmation_key: "discover_capabilities",
    },
    capability_discovery: {
      route: "discover_capabilities",
      confirmation_key: "discover_capabilities",
    },
    technical_decision: {
      route: "technical_decision",
      confirmation_key: "create_canonical_artifact",
      default_artifact_type: "technical-decision-matrix",
    },
    implement_story: {
      route: "claim_and_implement",
      confirmation_key: "start_implementation",
      requires_story: true,
      requires_contract: true,
    },
    start_implementation: {
      route: "claim_and_implement",
      confirmation_key: "start_implementation",
      requires_story: true,
      requires_contract: true,
    },
    validate_story: { route: "validate_story", requires_story: true },
    release_story: { route: "release_story", requires_story: true },
    skip_phase: { route: "confirm_phase_skip", confirmation_key: "skip_phase" },
    functional_analysis: {
      route: "classify_artifact",
      confirmation_key: "create_canonical_artifact",
      default_artifact_type: "functional-analysis",
      requires_artifact_type: true,
    },
    technical_analysis: {
      route: "classify_artifact",
      confirmation_key: "create_canonical_artifact",
      default_artifact_type: "technical-analysis",
      requires_artifact_type: true,
    },
    create_canonical_artifact: {
      route: "classify_artifact",
      confirmation_key: "create_canonical_artifact",
      requires_artifact_type: true,
    },
    new_output_template: {
      route: "classify_artifact",
      confirmation_key: "new_output_template",
      requires_artifact_type: true,
    },
    duplicate_output: {
      route: "classify_artifact",
      confirmation_key: "duplicate_output",
      requires_artifact_type: true,
    },
  };
}

function normalizeRouteActionMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const result = {};
  for (const [rawAction, rawConfig] of Object.entries(value)) {
    const action = normalizeRouteToken(rawAction);
    if (!action) {
      continue;
    }
    if (typeof rawConfig === "string") {
      result[action] = { route: normalizeRouteToken(rawConfig) };
    } else if (rawConfig && typeof rawConfig === "object" && !Array.isArray(rawConfig)) {
      result[action] = {
        ...rawConfig,
        route: normalizeRouteToken(rawConfig.route),
        confirmation_key: rawConfig.confirmation_key ? normalizeRouteToken(rawConfig.confirmation_key) : undefined,
        default_artifact_type: rawConfig.default_artifact_type
          ? normalizeRouteArtifactTypeValue(rawConfig.default_artifact_type)
          : undefined,
      };
    }
  }
  return result;
}

function routeActionConfig(policy, action) {
  const config = policy.canonical_actions[normalizeRouteToken(action)] || null;
  if (!config || !policy.routes.has(config.route)) {
    return null;
  }
  return config;
}

function loadRouteIntent(context, options) {
  const inline = getOptionString(options, "intent-json");
  const file = getOptionString(options, "intent-file");
  if (inline && file) {
    return { source: "conflict", intent: null, parse_error: "Use only one of --intent-json or --intent-file" };
  }
  if (!inline && !file) {
    return { source: options.text !== undefined ? "raw_text" : "none", intent: null, parse_error: null };
  }
  try {
    if (file) {
      const intentPath = resolveProjectFilePath(context, file, { mustExist: true, fileOnly: true });
      assertNotDerivedArtifact(context, intentPath, "Route intent file");
      return {
        source: toProjectPath(context, intentPath),
        intent: JSON.parse(fs.readFileSync(intentPath, "utf8")),
        parse_error: null,
      };
    }
    return {
      source: "inline",
      intent: JSON.parse(inline),
      parse_error: null,
    };
  } catch (error) {
    return {
      source: file ? "file" : "inline",
      intent: null,
      parse_error: error.message,
    };
  }
}

function normalizeRouteIntent(rawIntent, policy, context) {
  const errors = [];
  const questions = [];
  const intent = rawIntent && typeof rawIntent === "object" && !Array.isArray(rawIntent) ? rawIntent : null;
  if (!intent) {
    return {
      intent: emptyRouteIntent(),
      errors: ["Canonical intent must be a JSON object"],
      questions: [canonicalIntentQuestion()],
    };
  }

  for (const field of ROUTE_REQUIRED_INTENT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(intent, field)) {
      errors.push(`Missing canonical field '${field}'`);
    }
  }

  const requestedAction = normalizeRouteToken(intent.requested_action);
  if (!requestedAction) {
    errors.push("requested_action must be a configured enum value");
  } else if (!policy.canonical_actions[requestedAction]) {
    errors.push(`requested_action '${intent.requested_action}' is not configured`);
  }

  const confidence = Number(intent.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    errors.push("confidence must be a number between 0 and 1");
  }

  const proposedPhase = nullableRoutePhase(intent.proposed_phase);
  if (proposedPhase && !context.config.phases[proposedPhase]) {
    errors.push(`proposed_phase '${intent.proposed_phase}' is not configured`);
  }

  const actionConfig = policy.canonical_actions[requestedAction] || null;
  const artifactType = normalizeIntentArtifactType(
    intent.artifact_type || actionConfig?.default_artifact_type || null,
    errors,
  );
  if (actionConfig?.requires_artifact_type && !artifactType) {
    errors.push("artifact_type is required for this requested_action");
  }

  const allowedArtifactTypes = new Set(collectOutputArtifactTypes(context, null));
  if (artifactType && allowedArtifactTypes.size > 0 && !allowedArtifactTypes.has(artifactType)) {
    errors.push(`artifact_type '${artifactType}' is not configured`);
  }

  const skipPhases = normalizeIntentArray(intent.skip_phases, "skip_phases", errors)
    .map((phase) => normalizeRoutePhase(phase))
    .filter(Boolean);
  for (const phase of skipPhases) {
    if (!context.config.phases[phase]) {
      errors.push(`skip_phases includes unknown phase '${phase}'`);
    }
  }

  const missingContext = normalizeIntentArray(intent.missing_context, "missing_context", errors);
  if (missingContext.length > 0) {
    questions.push(...missingContext.map(routeQuestionFromContext));
  }

  return {
    intent: {
      ...intent,
      requested_action: requestedAction,
      confidence: Number.isFinite(confidence) ? confidence : 0,
      referenced_entities: normalizeIntentArray(intent.referenced_entities, "referenced_entities", errors),
      provided_artifacts: normalizeIntentArray(intent.provided_artifacts, "provided_artifacts", errors),
      missing_context: missingContext,
      proposed_phase: proposedPhase,
      artifact_type: artifactType,
      skip_phases: Array.from(new Set(skipPhases)),
    },
    errors: Array.from(new Set(errors)),
    questions: Array.from(new Set(questions)),
  };
}

function emptyRouteIntent() {
  return {
    requested_action: null,
    confidence: 0,
    referenced_entities: [],
    provided_artifacts: [],
    missing_context: [],
    proposed_phase: null,
    artifact_type: null,
    skip_phases: [],
  };
}

function decideInitProjectRoute(decision, policy, actionConfig, confidenceOutcome) {
  decision.route = "init_project";
  decision.next_commands.push(`agentic-sdlc init --root ${decision.root}`);
  return finalizeConcreteRoute(decision, policy, actionConfig, confidenceOutcome);
}

function decideOnboardExistingProjectRoute(context, decision, policy, actionConfig, confidenceOutcome) {
  decision.route = "onboard_existing_project";
  const baselines = readBaselines(context);
  addRouteCheck(
    decision,
    "baseline_exists",
    baselines.length > 0 ? "passed" : "failed",
    baselines.length > 0 ? baselines.map((baseline) => `${baseline.id}:${baseline.status}`).join(", ") : "No baseline records found",
  );
  if (baselines.length === 0) {
    decision.next_commands.push(`agentic-sdlc baseline propose --id BASELINE-INITIAL --document <path> --question "Which inferred facts are canonical?"`);
  } else {
    const latest = baselines.at(-1);
    decision.next_commands.push(`agentic-sdlc baseline status --id ${latest.id}`);
    if (latest.status === "proposed") {
      decision.next_commands.push(`agentic-sdlc baseline approve --id ${latest.id} --actor-type human --approval-source explicit-user --summary "<user-confirmed baseline>"`);
    }
  }
  return finalizeConcreteRoute(decision, policy, actionConfig, confidenceOutcome);
}

function decideIntakeRequirementRoute(decision, policy, actionConfig, confidenceOutcome) {
  decision.route = "intake_requirement";
  decision.next_commands.push("agentic-sdlc contract create --phase discovery --context-summary <summary>");
  return finalizeConcreteRoute(decision, policy, actionConfig, confidenceOutcome);
}

function decideDecomposeStoriesRoute(context, decision, policy, actionConfig, confidenceOutcome) {
  decision.route = "decompose_stories";
  const storyId = routeStoryId(decision.intent, policy);
  if (storyId) {
    const story = readStory(context, storyId);
    addRouteCheck(decision, "story_exists", story ? "passed" : "failed", story ? storyId : `${storyId} not found`);
    if (story) {
      decision.next_commands.push(`agentic-sdlc story create --id <new-story-id> --title <title> --acceptance <criterion>`);
      return finalizeConcreteRoute(decision, policy, actionConfig, confidenceOutcome);
    }
  }
  decision.next_commands.push("agentic-sdlc story create --id <story-id> --title <title> --acceptance <criterion>");
  return finalizeConcreteRoute(decision, policy, actionConfig, confidenceOutcome);
}

function decideCreateContractRoute(context, decision, policy, actionConfig, confidenceOutcome) {
  decision.route = "create_contract";
  const storyId = routeStoryId(decision.intent, policy);
  const phase = decision.intent.proposed_phase || "design";
  if (phase === "analysis" || phase === "design") {
    addCapabilityDiscoveryRouteChecks(context, decision, storyId, phase);
  }
  if (storyId) {
    const story = readStory(context, storyId);
    addRouteCheck(decision, "story_exists", story ? "passed" : "failed", story ? storyId : `${storyId} not found`);
    if (!story) {
      return finalizeAskRoute(decision, {
        status: "blocked",
        blocking_reasons: ["story_not_found"],
        questions: [`Create story ${storyId} or provide an existing story reference before creating its contract.`],
        next_commands: [`agentic-sdlc story create --id ${storyId} --title <title> --acceptance <criterion>`],
      });
    }
    decision.next_commands.push(`agentic-sdlc contract create --phase ${phase} --story ${storyId} --id contract-${storyId}-${phase}`);
  } else {
    decision.next_commands.push(`agentic-sdlc contract create --phase ${phase} --context-summary <summary>`);
  }
  return finalizeConcreteRoute(decision, policy, actionConfig, confidenceOutcome);
}

function decideClaimAndImplementRoute(context, decision, policy, actionConfig, confidenceOutcome) {
  const storyId = routeStoryId(decision.intent, policy);
  if (!storyId) {
    return finalizeAskRoute(decision, {
      status: "needs_clarification",
      blocking_reasons: ["story_reference_required"],
      questions: ["Provide a referenced_entities item with type 'story' and the story id."],
      next_commands: [canonicalIntentCommand()],
    });
  }

  const story = readStory(context, storyId);
  addRouteCheck(decision, "story_exists", story ? "passed" : "failed", story ? storyId : `${storyId} not found`);
  if (!story) {
    return finalizeAskRoute(decision, {
      status: "blocked",
      blocking_reasons: ["story_not_found"],
      questions: [`Create story ${storyId} before implementation, or reference an existing story.`],
      next_commands: [`agentic-sdlc story create --id ${storyId} --title <title> --acceptance <criterion>`],
    });
  }

  const acceptanceReady = Array.isArray(story.acceptance_criteria) && story.acceptance_criteria.length > 0;
  addRouteCheck(
    decision,
    "story_acceptance_criteria",
    acceptanceReady ? "passed" : "failed",
    acceptanceReady ? `${story.acceptance_criteria.length} criteria` : "No acceptance criteria",
  );
  if (!acceptanceReady) {
    return finalizeAskRoute(decision, {
      status: "blocked",
      blocking_reasons: ["missing_acceptance_criteria"],
      questions: [`Add acceptance criteria to story ${storyId} before implementation.`],
      next_commands: [`agentic-sdlc story create --id ${storyId} --title "${story.title || "<title>"}" --acceptance <criterion> --force`],
    });
  }

  const contractState = inspectStoryContract(context, story);
  addRouteCheck(
    decision,
    "story_contract_exists",
    contractState.exists ? "passed" : "failed",
    contractState.message,
  );
  if (!contractState.exists) {
    decision.route = "create_contract";
    decision.blocking_reasons.push("story_contract_missing");
    decision.next_commands.push(
      `agentic-sdlc contract create --phase ${story.phase || "implementation"} --story ${storyId} --id contract-${storyId}-${story.phase || "implementation"}`,
    );
    return finalizeConcreteRoute(decision, policy, { confirmation_key: "create_contract" }, confidenceOutcome);
  }

  addRouteCheck(
    decision,
    "story_contract_approved",
    contractState.approved ? "passed" : "failed",
    contractState.approved ? contractState.contract.id : `${contractState.contract.id} is not freshly approved`,
  );
  if (!contractState.approved) {
    return finalizeAskRoute(decision, {
      status: "blocked",
      blocking_reasons: ["contract_needs_approval"],
      questions: [`Approve or refresh contract ${contractState.contract.id} before implementation.`],
      next_commands: [
        `agentic-sdlc contract approve --id ${contractState.contract.id} --actor-type human --approval-source explicit-user --summary "<user-approved contract>"`,
      ],
    });
  }

  addOutputRefChecks(context, decision, story, contractState.contract);

  const claim = readStoryClaim(context, storyId);
  if (claim?.status === "active" && !isExpired(claim.expires_at)) {
    addRouteCheck(decision, "active_claim", "failed", `${storyId} is already claimed by ${claim.agent || "unknown"}`);
    return finalizeAskRoute(decision, {
      status: "blocked",
      blocking_reasons: ["active_claim_exists"],
      questions: [`Coordinate with ${claim.agent || "the current claimant"} before implementation.`],
      next_commands: [`agentic-sdlc story release --id ${storyId} --agent ${claim.agent || "<agent>"} --reason <reason>`],
    });
  }
  if (claim?.status === "active" && isExpired(claim.expires_at)) {
    addRouteCheck(decision, "active_claim", "failed", `${storyId} has an expired active claim`);
    return finalizeAskRoute(decision, {
      status: "blocked",
      blocking_reasons: ["active_claim_expired"],
      questions: [`Release or renew the expired claim for story ${storyId}.`],
      next_commands: [`agentic-sdlc story release --id ${storyId} --force --reason "Expired claim cleanup"`],
    });
  }

  addRouteCheck(decision, "active_claim", "passed", "No active claim blocks implementation");
  decision.route = "claim_and_implement";
  decision.next_commands.push(`agentic-sdlc story claim --id ${storyId} --agent <agent> --branch feature/${storyId}`);
  decision.next_commands.push(`agentic-sdlc gate check --story ${storyId} --strict`);
  return finalizeConcreteRoute(decision, policy, actionConfig, confidenceOutcome);
}

function decideClassifyArtifactRoute(context, decision, policy, actionConfig, confidenceOutcome) {
  const artifactType = decision.intent.artifact_type || actionConfig.default_artifact_type || null;
  if (!artifactType) {
    return finalizeAskRoute(decision, {
      status: "needs_clarification",
      blocking_reasons: ["artifact_type_required"],
      questions: ["Provide artifact_type as a configured output artifact enum."],
      next_commands: [canonicalIntentCommand()],
    });
  }
  decision.route = "classify_artifact";
  const storyId = routeStoryId(decision.intent, policy);
  if (artifactType === "technical-analysis" || artifactType === "technical-decision-matrix") {
    addCapabilityDiscoveryRouteChecks(context, decision, storyId, decision.intent.proposed_phase || "analysis");
  }
  if (storyId) {
    const story = readStory(context, storyId);
    addRouteCheck(decision, "story_exists", story ? "passed" : "failed", story ? storyId : `${storyId} not found`);
    if (!story) {
      return finalizeAskRoute(decision, {
        status: "blocked",
        blocking_reasons: ["story_not_found"],
        questions: [`Create story ${storyId} or reference an existing story before linking ${artifactType}.`],
        next_commands: [`agentic-sdlc story create --id ${storyId} --title <title> --acceptance <criterion>`],
      });
    }
  }

  const registry = readOutputRegistry(context, { missingOk: true });
  const approvedTemplates = (registry?.templates || []).filter(
    (template) => template.type === artifactType && template.status === "approved",
  );
  addRouteCheck(
    decision,
    "approved_template",
    approvedTemplates.length > 0 ? "passed" : "failed",
    approvedTemplates.length > 0 ? approvedTemplates.map((template) => template.id).join(", ") : `No approved ${artifactType} template`,
  );

  if (decision.intent.requested_action === "new_output_template") {
    decision.next_commands.push(`agentic-sdlc output template propose --type ${artifactType} --summary <summary>`);
    decision.next_commands.push(`agentic-sdlc output template approve --id ${artifactType}-v1 --actor-type human --approval-source explicit-user --summary "<user-approved template>"`);
    return finalizeConcreteRoute(decision, policy, actionConfig, confidenceOutcome);
  }

  if (approvedTemplates.length === 0) {
    decision.blocking_reasons.push("approved_template_missing");
    decision.next_commands.push(`agentic-sdlc output template propose --type ${artifactType} --summary <summary>`);
    decision.next_commands.push(`agentic-sdlc output template approve --id ${artifactType}-v1 --actor-type human --approval-source explicit-user --summary "<user-approved template>"`);
    return finalizeConcreteRoute(decision, policy, actionConfig, confidenceOutcome);
  }

  if (storyId) {
    const links = (registry?.links || []).filter((link) => link.story_id === storyId && link.artifact_type === artifactType);
    addRouteCheck(
      decision,
      "output_link",
      links.length > 0 ? "passed" : "warning",
      links.length > 0 ? `${links.length} existing link(s)` : "No existing output link for this story/artifact type",
    );
    if (links.length > 0 && decision.intent.requested_action !== "duplicate_output") {
      decision.blocking_reasons.push("output_already_linked");
      decision.questions.push(`Confirm whether ${storyId}/${artifactType} should reuse, delta, or duplicate the existing output.`);
      decision.next_commands.push(`agentic-sdlc output status --story ${storyId} --type ${artifactType}`);
      return finalizeConcreteRoute(decision, policy, { ...actionConfig, confirmation_key: "duplicate_output" }, confidenceOutcome);
    }
    decision.next_commands.push(
      `agentic-sdlc output resolve --story ${storyId} --type ${artifactType}`,
    );
    decision.next_commands.push(
      `agentic-sdlc output link --story ${storyId} --type ${artifactType} --artifact <artifact-path> --template ${approvedTemplates[0].id} --mode new`,
    );
  } else {
    decision.next_commands.push(`agentic-sdlc output template propose --type ${artifactType} --summary <summary>`);
  }

  return finalizeConcreteRoute(decision, policy, actionConfig, confidenceOutcome);
}

function decideCapabilityDiscoveryRoute(context, decision, policy, actionConfig, confidenceOutcome) {
  decision.route = "discover_capabilities";
  const storyId = routeStoryId(decision.intent, policy);
  const phase = decision.intent.proposed_phase || "analysis";
  addCapabilityDiscoveryRouteChecks(context, decision, storyId, phase);
  const subject = storyId ? ` --story ${storyId}` : "";
  const phaseOption = phase ? ` --phase ${phase}` : "";
  decision.next_commands.push(
    `agentic-sdlc capability profile propose --id CAP-PROFILE-${storyId || "PROJECT"}${subject}${phaseOption} --context-file <path>`,
  );
  decision.next_commands.push(
    `agentic-sdlc capability recommend --id CAP-REC-${storyId || "PROJECT"} --profile CAP-PROFILE-${storyId || "PROJECT"} --available-capabilities-file <path>`,
  );
  return finalizeConcreteRoute(decision, policy, actionConfig, confidenceOutcome);
}

function decideTechnicalDecisionRoute(context, decision, policy, actionConfig, confidenceOutcome) {
  decision.route = "technical_decision";
  const storyId = routeStoryId(decision.intent, policy);
  addCapabilityDiscoveryRouteChecks(context, decision, storyId, decision.intent.proposed_phase || "analysis");
  decision.next_commands.push("agentic-sdlc capability status --json");
  decision.next_commands.push("agentic-sdlc contract create --phase analysis --capability-recommendation <id>");
  return finalizeConcreteRoute(decision, policy, actionConfig, confidenceOutcome);
}

function addCapabilityDiscoveryRouteChecks(context, decision, storyId, phase) {
  const profiles = findApprovedCapabilityProfiles(context, { storyId, phase });
  addRouteCheck(
    decision,
    "approved_capability_profile",
    profiles.length > 0 ? "passed" : "warning",
    profiles.length > 0 ? profiles.map((profile) => profile.id).join(", ") : "No approved capability profile for this subject",
  );
  if (profiles.length === 0) {
    pushAllUnique(decision.blocking_reasons, ["capability_profile_missing"]);
    const subject = storyId ? ` --story ${storyId}` : "";
    const phaseOption = phase ? ` --phase ${phase}` : "";
    decision.next_commands.push(
      `agentic-sdlc capability profile propose --id CAP-PROFILE-${storyId || "PROJECT"}${subject}${phaseOption} --context-file <path>`,
    );
  }
}

function decideStoryGateRoute(context, decision, policy, actionConfig, confidenceOutcome, route) {
  const storyId = routeStoryId(decision.intent, policy);
  if (!storyId) {
    return finalizeAskRoute(decision, {
      status: "needs_clarification",
      blocking_reasons: ["story_reference_required"],
      questions: ["Provide a referenced_entities item with type 'story' and the story id."],
      next_commands: [canonicalIntentCommand()],
    });
  }
  const story = readStory(context, storyId);
  addRouteCheck(decision, "story_exists", story ? "passed" : "failed", story ? storyId : `${storyId} not found`);
  if (!story) {
    return finalizeAskRoute(decision, {
      status: "blocked",
      blocking_reasons: ["story_not_found"],
      questions: [`Create story ${storyId}, or reference an existing story before ${route}.`],
      next_commands: [`agentic-sdlc story create --id ${storyId} --title <title> --acceptance <criterion>`],
    });
  }
  decision.route = route;
  if (route === "validate_story") {
    const hasTestTrace = readTraceEvents(context, storyId).some((event) => event.type === "test");
    addRouteCheck(decision, "test_trace", hasTestTrace ? "passed" : "warning", hasTestTrace ? "Test trace exists" : "No test trace yet");
    decision.next_commands.push(`agentic-sdlc gate check --story ${storyId} --strict`);
  } else {
    const hasReleaseTrace = readTraceEvents(context, storyId).some((event) => event.type === "release");
    addRouteCheck(
      decision,
      "release_trace",
      hasReleaseTrace ? "passed" : "warning",
      hasReleaseTrace ? "Release trace exists" : "No release trace yet",
    );
    decision.next_commands.push(`agentic-sdlc trace append --story ${storyId} --type release --summary <summary> --evidence <path>`);
    decision.next_commands.push(`agentic-sdlc gate check --story ${storyId} --strict`);
  }
  return finalizeConcreteRoute(decision, policy, actionConfig, confidenceOutcome);
}

function inspectStoryContract(context, story) {
  if (!story.contract_id) {
    return { exists: false, approved: false, contract: null, message: "Story has no contract_id" };
  }
  const contractPath = path.join(context.sdlcRoot, "contracts", `${story.contract_id}.json`);
  if (!fs.existsSync(contractPath)) {
    return { exists: false, approved: false, contract: null, message: `Missing contract ${story.contract_id}` };
  }
  const contract = readJson(contractPath);
  return {
    exists: true,
    approved: contract.status === "approved" && hasFreshApprovedContractApproval(contract),
    contract,
    message: story.contract_id,
  };
}

function addOutputRefChecks(context, decision, story, contract) {
  const refs = Array.isArray(contract.output_contract_refs) ? contract.output_contract_refs : [];
  addRouteCheck(
    decision,
    "contract_output_refs",
    refs.length > 0 ? "passed" : "warning",
    refs.length > 0 ? `${refs.length} output ref(s)` : "No output refs on the story contract",
  );
  if (refs.length === 0) {
    return;
  }
  const registry = readOutputRegistry(context, { missingOk: true });
  for (const ref of refs) {
    const template = (registry?.templates || []).find((candidate) => candidate.id === ref.template_id);
    addRouteCheck(
      decision,
      `output_ref_template:${ref.artifact_type}`,
      template?.status === "approved" ? "passed" : "failed",
      template ? `${template.id} is ${template.status}` : `Missing template ${ref.template_id}`,
    );
    const link = (registry?.links || []).find(
      (candidate) =>
        candidate.story_id === story.id &&
        candidate.artifact_type === ref.artifact_type &&
        candidate.template_id === ref.template_id &&
        candidate.mode === ref.mode,
    );
    addRouteCheck(
      decision,
      `output_ref_link:${ref.artifact_type}`,
      link ? "passed" : "warning",
      link ? link.artifact_path : `No output link satisfies ${ref.artifact_type}:${ref.template_id}:${ref.mode}`,
    );
  }
}

function readStoryClaim(context, storyId) {
  const claimPath = path.join(context.sdlcRoot, "stories", storyId, "claim.json");
  return fs.existsSync(claimPath) ? readJson(claimPath) : null;
}

function routeStoryId(intent, policy) {
  const direct = routeScalar(intent.story_id);
  if (direct) {
    return normalizeRouteId(direct);
  }
  return routeEntityId(intent, policy, "story");
}

function routeEntityId(intent, policy, type) {
  const aliases = new Set(normalizeStringArray(policy.entity_types[type] || [type]).map(normalizeRouteToken));
  for (const entity of intent.referenced_entities || []) {
    if (!entity || typeof entity !== "object" || Array.isArray(entity)) {
      continue;
    }
    const entityType = normalizeRouteToken(entity.type || entity.entity_type || entity.kind || entity.role);
    if (!aliases.has(entityType)) {
      continue;
    }
    const id = routeScalar(entity.id || entity.identifier || entity.value || entity[`${type}_id`]);
    if (id) {
      return normalizeRouteId(id);
    }
  }
  return null;
}

function normalizeRouteId(value) {
  try {
    return normalizeId(value);
  } catch {
    return null;
  }
}

function createRouteDecision(context, options = {}) {
  return {
    schema_version: context.config.schema_version || context.templateConfig.schema_version,
    sdlc_version: VERSION,
    decided_at: now(),
    root: context.root,
    intent_source: options.intent_source || "unknown",
    route: "ask_clarification",
    status: "needs_clarification",
    confidence: Number.isFinite(Number(options.confidence)) ? Number(options.confidence) : 0,
    requires_confirmation: false,
    blocking_reasons: [],
    questions: [],
    deterministic_checks: [],
    next_commands: [],
  };
}

function addRouteCheck(decision, check, status, details = null) {
  decision.deterministic_checks.push({
    check,
    status,
    details,
  });
}

function applyRouteConfidenceGate(decision, policy) {
  const confidence = Number(decision.confidence);
  addRouteCheck(
    decision,
    "confidence_policy",
    confidence >= policy.confidence.confirm_min ? "passed" : "failed",
    `confidence=${confidence.toFixed(2)}, ask_below=${policy.confidence.ask_below}, confirm_min=${policy.confidence.confirm_min}, auto_route_min=${policy.confidence.auto_route_min}`,
  );
  if (confidence < policy.confidence.ask_below || confidence < policy.confidence.confirm_min) {
    return "ask";
  }
  if (confidence < policy.confidence.auto_route_min) {
    return "confirm";
  }
  return "auto";
}

function finalizeAskRoute(decision, updates = {}) {
  decision.route = "ask_clarification";
  decision.status = updates.status || decision.status || "needs_clarification";
  pushAllUnique(decision.blocking_reasons, updates.blocking_reasons || []);
  pushAllUnique(decision.questions, updates.questions || []);
  pushAllUnique(decision.next_commands, updates.next_commands || []);
  decision.requires_confirmation = false;
  dedupeRouteDecision(decision);
  return decision;
}

function finalizeConcreteRoute(decision, policy, actionConfig = {}, confidenceOutcome = "auto") {
  const confirmationKey = normalizeRouteToken(actionConfig?.confirmation_key || decision.intent?.requested_action || decision.route);
  const alwaysConfirm = policy.confidence.always_confirm.includes(confirmationKey);
  if (confidenceOutcome === "confirm" || alwaysConfirm || decision.route === "confirm_phase_skip") {
    decision.requires_confirmation = true;
  }
  decision.status = decision.requires_confirmation ? "needs_confirmation" : "ready";
  if (decision.blocking_reasons.length > 0 && !decision.requires_confirmation) {
    decision.status = "blocked";
  }
  dedupeRouteDecision(decision);
  return decision;
}

function dedupeRouteDecision(decision) {
  decision.blocking_reasons = Array.from(new Set(decision.blocking_reasons));
  decision.questions = Array.from(new Set(decision.questions));
  decision.next_commands = Array.from(new Set(decision.next_commands));
}

function formatRouteDecision(decision) {
  const lines = [
    `Route: ${decision.route}`,
    `Status: ${decision.status}`,
    `Confidence: ${Number(decision.confidence).toFixed(2)}`,
    `Requires confirmation: ${decision.requires_confirmation ? "yes" : "no"}`,
  ];
  lines.push(
    decision.blocking_reasons.length
      ? `Blocking reasons: ${decision.blocking_reasons.join(", ")}`
      : "Blocking reasons: none",
  );
  if (decision.questions.length > 0) {
    lines.push("Questions:");
    lines.push(...decision.questions.map((question) => `- ${question}`));
  }
  if (decision.deterministic_checks.length > 0) {
    lines.push("Deterministic checks:");
    lines.push(
      ...decision.deterministic_checks.map((check) =>
        `- ${check.check}: ${check.status}${check.details ? ` (${check.details})` : ""}`,
      ),
    );
  }
  if (decision.next_commands.length > 0) {
    lines.push("Next commands:");
    lines.push(...decision.next_commands.map((command) => `- ${command}`));
  }
  return lines;
}

function canonicalIntentQuestion() {
  return `Provide canonical intent JSON with fields: ${ROUTE_REQUIRED_INTENT_FIELDS.join(", ")}.`;
}

function canonicalIntentCommand() {
  return "agentic-sdlc route decide --intent-json '<canonical-intent-json>'";
}

function isKbInitialized(context) {
  return fs.existsSync(path.join(context.sdlcRoot, "project.json"));
}

function normalizeIntentArray(value, field, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${field} must be an array`);
    return [];
  }
  return value;
}

function normalizeIntentArtifactType(value, errors) {
  const raw = routeScalar(value);
  if (!raw) {
    return null;
  }
  try {
    return normalizeArtifactType(raw);
  } catch (error) {
    errors.push(error.message);
    return null;
  }
}

function normalizeRouteArtifactTypeValue(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
}

function routeQuestionFromContext(item) {
  if (typeof item === "string") {
    return `Provide missing context: ${item}.`;
  }
  if (item && typeof item === "object") {
    return routeScalar(item.question || item.prompt || item.label || item.id) || "Provide the missing canonical context.";
  }
  return "Provide the missing canonical context.";
}

function nullableRouteToken(value) {
  const scalar = routeScalar(value);
  return scalar ? normalizeRouteToken(scalar) : null;
}

function nullableRoutePhase(value) {
  const scalar = routeScalar(value);
  return scalar ? normalizeRoutePhase(scalar) : null;
}

function normalizeRouteToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeRoutePhase(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function routeScalar(value) {
  if (value === undefined || value === null || value === true) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.length === 1 ? routeScalar(value[0]) : null;
  }
  const text = String(value).trim();
  return text || null;
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function pushAllUnique(target, values) {
  for (const value of values) {
    if (value && !target.includes(value)) {
      target.push(value);
    }
  }
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value)));
}

function initProject(context, options) {
  const result = initializeProject(context, options);
  output(options, result.payload, result.messages);
}

function initializeProject(context, options) {
  const projectName = String(options["project-name"] || path.basename(context.root));
  const projectId = String(options["project-id"] || slugify(projectName));
  const force = Boolean(options.force);
  const attribution = buildAttribution(context, options, "project.init");
  const config = context.templateConfig || context.config;
  context.config = config;

  ensureDir(context.sdlcRoot);
  for (const directory of context.config.kb_directories) {
    ensureDir(path.join(context.sdlcRoot, directory));
  }
  writeJsonFile(path.join(context.sdlcRoot, PROJECT_CONFIG_FILE_NAME), config, { force });

  const projectPath = path.join(context.sdlcRoot, "project.json");
  const project = {
    project_id: projectId,
    project_name: projectName,
    schema_version: context.config.schema_version,
    sdlc_version: VERSION,
    created_at: now(),
    knowledge_base: {
      storage: "git",
      canonical_path: SDLC_DIR,
      stateless_plugin: true,
      concurrency_model: "story-scoped workspaces with append-only traces",
      source_of_truth: "JSON and Markdown files under .sdlc",
      derived_artifacts: ["cache", "indexes"],
      output_contracts_registry: `${SDLC_DIR}/output-contracts/registry.json`,
      cache_policy_path: `${SDLC_DIR}/cache/${CACHE_FILE_NAME}`,
    },
    phase_order: context.config.phase_order,
    audit: {
      created_by: attribution.actor,
      updated_by: attribution.actor,
      git: attribution.git,
      run: attribution.run,
    },
  };
  writeJsonFile(projectPath, project, { force });

  renderTemplateFile(
    context,
    "kb-readme.md",
    path.join(context.sdlcRoot, "README.md"),
    { PROJECT_NAME: projectName },
    { force },
  );

  writeTextFile(path.join(context.sdlcRoot, ".gitignore"), ["cache/**/*", "indexes/*.json", "reports/*.tmp", ""].join("\n"), {
    force,
  });

  initializeOutputContracts(context, {
    force,
    attribution,
    project_id: projectId,
  });
  initializeDependencyGraph(context, { force, attribution });

  const createdContracts = [];
  for (const phase of context.config.phase_order) {
    const contract = buildContract(context, phase, {
      id: `contract-${phase}-v1`,
      status: "draft",
      audit_options: options,
      audit_action: "contract.bootstrap",
    });
    const contractPath = path.join(context.sdlcRoot, "contracts", `${contract.id}.json`);
    if (!fs.existsSync(contractPath) || force) {
      writeJsonFile(contractPath, contract, { force });
      createdContracts.push(contract.id);
    }
  }

  return {
    payload: {
      status: "initialized",
      root: context.root,
      sdlc_root: context.sdlcRoot,
      project,
      contracts_created: createdContracts,
    },
    messages: [
      `Initialized Agentic SDLC at ${path.relative(context.root, context.sdlcRoot) || SDLC_DIR}`,
      `Project: ${projectName} (${projectId})`,
      `Phase contracts available: ${context.config.phase_order.join(", ")}`,
    ],
  };
}

function onboardExistingProject(context, options) {
  const initializedBefore = fs.existsSync(path.join(context.sdlcRoot, "project.json"));
  let initialization = null;
  if (!initializedBefore) {
    initialization = initializeProject(context, options);
  } else {
    ensureInitialized(context);
  }

  const baseline = createBaselineProposal(context, {
    ...options,
    id: options.id || "BASELINE-INITIAL",
    kind: options.kind || "existing-project",
  });

  output(
    options,
    {
      status: "onboarded",
      initialized: !initializedBefore,
      init: initialization?.payload || null,
      baseline_path: baseline.baseline_path,
      report_path: baseline.report_path,
      baseline: baseline.baseline,
      next_commands: [
        `agentic-sdlc baseline status --id ${baseline.baseline.id}`,
        `agentic-sdlc baseline approve --id ${baseline.baseline.id} --actor-type human --approval-source explicit-user --summary "<what the user confirmed>"`,
      ],
    },
    [
      initializedBefore ? "Existing SDLC KB found." : "Initialized SDLC KB.",
      `Proposed baseline ${baseline.baseline.id}`,
      `Review: ${toProjectPath(context, baseline.report_path)}`,
      "Approve only after the user confirms what is canonical.",
    ],
  );
}

function proposeBaseline(context, options) {
  ensureInitialized(context);
  const result = createBaselineProposal(context, options);
  output(
    options,
    { status: "proposed", baseline_path: result.baseline_path, report_path: result.report_path, baseline: result.baseline },
    [
      `Proposed baseline ${result.baseline.id}`,
      `Review: ${toProjectPath(context, result.report_path)}`,
      `Approve with: agentic-sdlc baseline approve --id ${result.baseline.id} --actor-type human --approval-source explicit-user --summary "<what the user confirmed>"`,
    ],
  );
}

function createBaselineProposal(context, options) {
  ensureBaselineDirectory(context);
  const id = normalizeId(options.id || `BASELINE-${shortDate()}`);
  const attribution = buildAttribution(context, options, "baseline.propose");
  const documents = normalizeRawListOption(options.document).map((rawPath) => buildBaselineDocumentEvidence(context, rawPath));
  const extraSources = normalizeBaselineSourcePaths(context, normalizeRawListOption(options.source));
  const detectedStack = detectProjectStack(context);
  const repoSnapshot = buildRepositorySnapshot(context, detectedStack);
  const sourcePaths = Array.from(
    new Set([
      ...documents.map((item) => item.path),
      ...extraSources,
      ...detectedStack.map((item) => item.source_path).filter(Boolean),
      ...repoSnapshot.key_files.map((item) => item.path),
    ]),
  ).sort();
  const summary =
    getOptionString(options, "summary") ||
    getOptionString(options, "context-summary") ||
    `Initial baseline for existing project ${readProjectSafe(context)?.project_name || path.basename(context.root)}.`;
  const questions = normalizeRawListOption(options.question);
  const assumptions = normalizeRawListOption(options.assumption);
  const baseline = {
    id,
    schema_version: context.config.schema_version,
    sdlc_version: VERSION,
    kind: String(options.kind || "existing-project"),
    status: "proposed",
    summary,
    repository_snapshot: repoSnapshot,
    imported_documents: documents,
    inferred_context: buildInferredContext(repoSnapshot, detectedStack, documents),
    canonicality: {
      state: "inferred",
      inferred_not_approved: true,
      confirmed_sources: normalizeRawListOption(options["confirmed-source"]),
      user_confirmation_required: true,
      notes: [
        "This baseline describes the current observable project state.",
        "It does not reconstruct pre-SDLC historical decisions unless evidence is present in source files.",
      ],
    },
    open_questions: questions,
    assumptions,
    source_paths: sourcePaths,
    source_hashes: buildSourceHashes(context, sourcePaths),
    approvals: [],
    created_at: now(),
    updated_at: now(),
    audit: {
      proposed_by: attribution.actor,
      git: attribution.git,
      run: attribution.run,
    },
  };

  const baselinePath = baselinePathById(context, id);
  const reportPath = path.join(baselineRoot(context), `${id}-current-state.md`);
  writeJsonFile(baselinePath, baseline, { force: Boolean(options.force) });
  writeTextFile(reportPath, renderBaselineReport(baseline), { force: Boolean(options.force) });
  appendTraceEvent(context, null, {
    type: "decision",
    summary: `Proposed project baseline ${id}`,
    action: "baseline.propose",
    actor: attribution.actor,
    evidence: [toProjectPath(context, baselinePath), toProjectPath(context, reportPath), ...documents.map((item) => item.path)],
    related: [id],
    git: attribution.git,
    run: attribution.run,
  });
  return { baseline, baseline_path: baselinePath, report_path: reportPath };
}

function approveBaseline(context, options) {
  ensureInitialized(context);
  const id = normalizeId(requireOption(options, "id"));
  const baselinePath = baselinePathById(context, id);
  if (!fs.existsSync(baselinePath)) {
    fail(`Baseline ${id} does not exist`);
  }
  const baseline = readJson(baselinePath);
  validateBaselineSourceHashes(context, baseline, `baseline ${id}`, { failOnStale: true });
  const attribution = buildAttribution(context, options, "baseline.approve");
  requireHumanOrCiActor(attribution, "Approving a project baseline");
  const approvalSource = normalizeApprovalSource(context, options, attribution, `baseline ${id}`, "approved");
  const canonicality = {
    ...(baseline.canonicality || {}),
    state: approvalSource === "bootstrap" ? "bootstrap" : "confirmed",
    inferred_not_approved: approvalSource === "bootstrap",
    user_confirmation_required: approvalSource === "bootstrap",
  };
  baseline.canonicality = canonicality;
  const approval = buildApprovalRecord(context, options, attribution, {
    subject: baseline,
    subject_id_field: "baseline_id",
    subject_id: id,
    label: `baseline ${id}`,
  });
  baseline.status = approval.provisional ? "provisionally_approved" : "approved";
  baseline.approvals = Array.isArray(baseline.approvals) ? baseline.approvals : [];
  baseline.approvals.push(approval);
  baseline.updated_at = now();
  baseline.audit = {
    ...(baseline.audit || {}),
    approved_by: attribution.actor,
    git: attribution.git,
    run: attribution.run,
  };
  writeJsonFile(baselinePath, baseline, { force: true });
  appendTraceEvent(context, null, {
    type: "gate",
    summary: approval.summary || `Approved project baseline ${id}`,
    action: "baseline.approve",
    actor: attribution.actor,
    evidence: [toProjectPath(context, baselinePath), ...approval.evidence.map((item) => item.path)],
    related: [id],
    git: attribution.git,
    run: attribution.run,
  });
  output(options, { status: baseline.status, baseline_path: baselinePath, approval, baseline }, [`Approved baseline ${id}`]);
}

function showBaselineStatus(context, options) {
  ensureInitialized(context);
  const id = options.id ? normalizeId(String(options.id)) : null;
  const baselines = readBaselines(context).filter((baseline) => !id || baseline.id === id);
  if (id && baselines.length === 0) {
    fail(`Baseline ${id} does not exist`);
  }
  const status = baselines.map((baseline) => {
    const staleSources = validateBaselineSourceHashes(context, baseline, `baseline ${baseline.id}`, { collectOnly: true });
    return {
      id: baseline.id,
      status: baseline.status,
      kind: baseline.kind,
      source_paths: baseline.source_paths || [],
      stale: staleSources.length > 0,
      stale_sources: staleSources,
      open_questions: Array.isArray(baseline.open_questions) ? baseline.open_questions.length : 0,
      approved: baseline.status === "approved" && isApprovedRecordFresh(baseline),
    };
  });
  output(
    options,
    { baselines: status },
    status.length
      ? status.map((item) => `${item.id}: ${item.status}${item.stale ? " (stale)" : ""}, open questions ${item.open_questions}`)
      : ["No baselines found."],
  );
}

function createContract(context, options) {
  ensureInitialized(context);
  const phase = requireOption(options, "phase");
  if (!context.config.phases[phase]) {
    fail(`Unknown phase '${phase}'. Valid phases: ${Object.keys(context.config.phases).join(", ")}`);
  }
  const storyId = options.story ? normalizeId(String(options.story)) : null;
  const id = normalizeId(
    options.id || (storyId ? `contract-${storyId}-${phase}` : `contract-${phase}-${shortDate()}`),
  );
  const recommendationContext = loadCapabilityRecommendationsForContract(context, options);
  const explicitCapabilityPolicy = loadCapabilityPolicy(context, options);
  const explicitCapabilityBindings = loadCapabilityBindings(context, options);
  const executionSuggestions = recommendationContext.execution_policy_suggestions;
  const contract = buildContract(context, phase, {
    id,
    story_id: storyId,
    owner_agent: options["owner-agent"],
    status: String(options.status || "draft"),
    context_summary: options["context-summary"],
    context_files: normalizeRawListOption(options["context-file"]),
    questions: normalizeRawListOption(options.question),
    qa: normalizeRawListOption(options.qa),
    constraints: normalizeListOption(options.constraint),
    assumptions: normalizeListOption(options.assumption),
    inputs: normalizeListOption(options.input),
    outputs: normalizeListOption(options.output),
    output_refs: normalizeRawListOption(options["output-ref"]),
    validation: normalizeListOption(options.validation),
    allowed_tools: normalizeListOption(options.tool),
    kb_writes: normalizeListOption(options["kb-write"]),
    metrics: normalizeListOption(options.metric),
    model: options.model === undefined ? executionSuggestions.model : options.model,
    reasoning: options.reasoning === undefined ? executionSuggestions.reasoning : options.reasoning,
    execution_notes: mergeList(
      executionSuggestions.notes,
      normalizeRawListOption(options["execution-note"]),
    ),
    capability_policy: mergeCapabilityPolicies(recommendationContext.policy_patch, explicitCapabilityPolicy),
    capability_bindings: [
      ...recommendationContext.bindings,
      ...explicitCapabilityBindings,
    ],
    capability_recommendation_refs: recommendationContext.refs,
    questions: mergeList(normalizeRawListOption(options.question), recommendationContext.open_questions),
    audit_options: options,
    audit_action: "contract.create",
  });
  const contractPath = path.join(context.sdlcRoot, "contracts", `${id}.json`);
  writeJsonFile(contractPath, contract, { force: Boolean(options.force) });
  output(
    options,
    { status: "created", contract_path: contractPath, contract },
    [`Created contract ${id} for phase ${phase}`],
  );
}

function approveContract(context, options) {
  ensureInitialized(context);
  const id = normalizeId(requireOption(options, "id"));
  const contractPath = path.join(context.sdlcRoot, "contracts", `${id}.json`);
  if (!fs.existsSync(contractPath)) {
    fail(`Contract ${id} does not exist`);
  }
  const contract = readJson(contractPath);
  const attribution = buildAttribution(context, options, "contract.approve");
  const approvalStatus = normalizeApprovalStatus(options.status || "approved");
  if (contract.human_gate === true && !["human", "ci"].includes(attribution.actor.type)) {
    fail("Human-gated contracts require --actor-type human or an approved CI actor.");
  }
  const approval = buildApprovalRecord(context, options, attribution, {
    subject: contract,
    subject_id_field: "contract_id",
    subject_id: id,
    status: approvalStatus,
    scope: String(options.scope || "contract"),
    label: `contract ${id}`,
  });
  contract.approvals = Array.isArray(contract.approvals) ? contract.approvals : [];
  contract.approvals.push(approval);
  if (approval.status === "approved" && !options["preserve-status"]) {
    contract.status = "approved";
  } else if (["changes_requested", "rejected"].includes(approval.status) && !options["preserve-status"]) {
    contract.status = approval.status;
  }
  contract.updated_at = now();
  contract.audit = {
    ...(contract.audit || {}),
    updated_by: attribution.actor,
    git: attribution.git,
    run: attribution.run,
  };
  writeJsonFile(contractPath, contract, { force: true });
  appendTraceEvent(context, contract.story_id || null, {
    type: "gate",
    summary: approval.summary || `Contract ${id} ${approval.status}`,
    action: "contract.approve",
    actor: attribution.actor,
    evidence: [path.relative(context.root, contractPath)],
    related: [id],
    git: attribution.git,
    run: attribution.run,
  });
  output(
    options,
    { status: approval.status, contract_path: contractPath, approval, contract },
    [`Recorded ${approval.status} approval for contract ${id}`],
  );
}

function buildContract(context, phase, overrides = {}) {
  const template = context.config.phases[phase];
  if (!template) {
    fail(`Unknown phase '${phase}'`);
  }
  const project = readProjectSafe(context);
  const contextSources = buildContextSources(context, overrides.context_files || []);
  const questions = buildQuestionRecords(overrides.questions || [], overrides.qa || []);
  const attribution = buildAttribution(
    context,
    overrides.audit_options || {},
    overrides.audit_action || "contract.create",
  );
  return {
    id: overrides.id,
    schema_version: context.config.schema_version,
    sdlc_version: VERSION,
    project: project
      ? {
          project_id: project.project_id,
          project_name: project.project_name,
        }
      : null,
    phase,
    story_id: overrides.story_id || null,
    status: overrides.status || "draft",
    purpose: template.purpose,
    owner_agent: String(overrides.owner_agent || template.owner_agent),
    inputs: mergeList(template.inputs, overrides.inputs),
    outputs: mergeList(template.outputs, overrides.outputs),
    output_contract_refs: buildOutputContractRefs(overrides.output_refs || []),
    validation: mergeList(template.validation, overrides.validation),
    allowed_tools: mergeList(template.allowed_tools, overrides.allowed_tools),
    kb_writes: mergeList(template.kb_writes, overrides.kb_writes),
    human_gate: Boolean(template.human_gate),
    metrics: mergeList(template.metrics, overrides.metrics),
    execution_policy: buildExecutionPolicy(context, overrides),
    capability_policy: buildCapabilityPolicy(overrides.capability_policy),
    capability_bindings: normalizeCapabilityBindings(overrides.capability_bindings || []),
    capability_recommendation_refs: normalizeCapabilityRecommendationRefs(overrides.capability_recommendation_refs || []),
    contextualization: {
      summary: overrides.context_summary ? String(overrides.context_summary) : null,
      context_sources: contextSources,
      questions,
      constraints: [...(overrides.constraints || [])],
      assumptions: [...(overrides.assumptions || [])],
      open_questions: questions.filter((question) => question.status !== "answered").length,
    },
    approvals: [],
    created_at: now(),
    updated_at: now(),
    audit: {
      created_by: attribution.actor,
      updated_by: attribution.actor,
      git: attribution.git,
      run: attribution.run,
    },
  };
}

function buildExecutionPolicy(context, overrides = {}) {
  const config = context.config.execution_policy || {};
  const runtime = String(config.runtime || "codex");
  const allowedReasoningLevels = normalizeReasoningLevels(config.reasoning_levels);
  const rawModel = normalizeScalarOption(
    overrides.model === undefined ? config.default_model : overrides.model,
    "model",
  );
  const rawReasoning = normalizeScalarOption(
    overrides.reasoning === undefined ? config.default_reasoning : overrides.reasoning,
    "reasoning",
  );
  const model = buildExecutionPolicySelection(rawModel, "value");
  const reasoning = buildExecutionPolicySelection(rawReasoning, "level", {
    allowedValues: allowedReasoningLevels,
    optionName: "reasoning",
  });

  return {
    runtime,
    model,
    reasoning,
    notes: [...(overrides.execution_notes || [])],
  };
}

function buildExecutionPolicySelection(rawValue, valueKey, options = {}) {
  if (!rawValue || rawValue.toLowerCase() === "inherit") {
    return {
      mode: "inherit",
      [valueKey]: null,
    };
  }

  const value = valueKey === "level" ? rawValue.toLowerCase() : rawValue;
  if (options.allowedValues && !options.allowedValues.includes(value)) {
    fail(
      `Unknown --${options.optionName} '${rawValue}'. Valid values: ${options.allowedValues.join(", ")}`,
    );
  }

  return {
    mode: "override",
    [valueKey]: value,
  };
}

function loadCapabilityPolicy(context, options) {
  const inline = getOptionString(options, "capability-policy-json");
  const file = getOptionString(options, "capability-policy-file");
  if (inline && file) {
    fail("Use only one of --capability-policy-json or --capability-policy-file.");
  }
  if (!inline && !file) {
    return null;
  }
  try {
    if (file) {
      const policyPath = resolveProjectFilePath(context, file, { mustExist: true, fileOnly: true });
      assertNotDerivedArtifact(context, policyPath, "Capability policy file");
      return JSON.parse(fs.readFileSync(policyPath, "utf8"));
    }
    return JSON.parse(inline);
  } catch (error) {
    fail(`Invalid capability policy JSON: ${error.message}`);
  }
}

function loadCapabilityBindings(context, options) {
  const bindingJson = normalizeRawListOption(options["capability-binding-json"]);
  const bindingFiles = normalizeRawListOption(options["capability-binding-file"]).map((rawPath) => {
    const bindingPath = resolveProjectFilePath(context, rawPath, { mustExist: true, fileOnly: true });
    assertNotDerivedArtifact(context, bindingPath, "Capability binding file");
    return fs.readFileSync(bindingPath, "utf8");
  });
  return [...bindingJson, ...bindingFiles].map((rawValue) => {
    try {
      return JSON.parse(rawValue);
    } catch (error) {
      fail(`Invalid capability binding JSON: ${error.message}`);
    }
  });
}

function buildCapabilityPolicy(policy) {
  const empty = {
    skills: emptyCapabilitySet(),
    mcp: emptyCapabilitySet(),
    tools: emptyCapabilitySet(),
    approval_required_for: [],
  };
  if (policy === null || policy === undefined) {
    return empty;
  }
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    fail("capability_policy must be a JSON object");
  }
  const normalized = {
    skills: normalizeCapabilitySet(policy.skills),
    mcp: normalizeCapabilitySet(policy.mcp),
    tools: normalizeCapabilitySet(policy.tools),
    approval_required_for: normalizeListValue(policy.approval_required_for, []),
  };
  validateCapabilityPolicy(normalized, "capability_policy");
  return normalized;
}

function emptyCapabilitySet() {
  return {
    required: [],
    allowed: [],
    forbidden: [],
  };
}

function normalizeCapabilitySet(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    required: normalizeListValue(source.required, []),
    allowed: normalizeListValue(source.allowed, []),
    forbidden: normalizeListValue(source.forbidden, []),
  };
}

function validateCapabilityPolicy(policy, label, report = null) {
  const errors = [];
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    errors.push(`${label} must be an object`);
  } else {
    for (const type of CAPABILITY_TYPES) {
      const group = policy[type];
      if (!group || typeof group !== "object" || Array.isArray(group)) {
        errors.push(`${label}.${type} must be an object`);
        continue;
      }
      for (const key of CAPABILITY_GROUPS) {
        if (!Array.isArray(group[key])) {
          errors.push(`${label}.${type}.${key} must be an array`);
        }
      }
      const required = new Set(group.required || []);
      const allowed = new Set(group.allowed || []);
      const forbidden = new Set(group.forbidden || []);
      for (const value of required) {
        if (forbidden.has(value)) {
          errors.push(`${label}.${type} capability '${value}' cannot be both required and forbidden`);
        }
      }
      for (const value of allowed) {
        if (forbidden.has(value)) {
          errors.push(`${label}.${type} capability '${value}' cannot be both allowed and forbidden`);
        }
      }
    }
    if (!Array.isArray(policy.approval_required_for)) {
      errors.push(`${label}.approval_required_for must be an array`);
    }
  }
  if (report) {
    report.errors.push(...errors);
    return errors.length === 0;
  }
  if (errors.length > 0) {
    fail(errors.join("; "));
  }
  return true;
}

function normalizeCapabilityBindings(bindings) {
  if (!Array.isArray(bindings)) {
    fail("capability_bindings must be an array");
  }
  return bindings.map((binding, index) => normalizeCapabilityBinding(binding, index));
}

function normalizeCapabilityRecommendationRefs(refs) {
  if (!Array.isArray(refs)) {
    fail("capability_recommendation_refs must be an array");
  }
  return refs.map((ref, index) => {
    if (!ref || typeof ref !== "object" || Array.isArray(ref)) {
      fail(`capability recommendation ref ${index + 1} must be a JSON object`);
    }
    return {
      id: normalizeId(ref.id),
      profile_id: ref.profile_id ? normalizeId(ref.profile_id) : null,
      path: String(ref.path || "").trim(),
      approved_content_hash: String(ref.approved_content_hash || "").trim(),
    };
  });
}

function normalizeCapabilityBinding(binding, index = 0) {
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) {
    fail(`capability binding ${index + 1} must be a JSON object`);
  }
  const type = String(binding.type || "").trim().toLowerCase();
  if (!["skill", "mcp", "tool"].includes(type)) {
    fail(`capability binding ${index + 1} type must be skill, mcp, or tool`);
  }
  const name = String(binding.name || "").trim();
  if (!name) {
    fail(`capability binding ${index + 1} is missing name`);
  }
  const target = binding.target && typeof binding.target === "object" && !Array.isArray(binding.target) ? binding.target : null;
  if (!target) {
    fail(`capability binding ${index + 1} is missing target object`);
  }
  return {
    type,
    name,
    binding_id: normalizeId(binding.binding_id || `${type}-${name}`),
    target,
    permissions: normalizeListValue(binding.permissions, []),
    requires_approval_for: normalizeListValue(binding.requires_approval_for, []),
    environment: binding.environment ? String(binding.environment) : null,
    notes: normalizeListValue(binding.notes, []),
  };
}

function validateCapabilityBindings(context, contract, label, report) {
  const policy = contract.capability_policy || buildCapabilityPolicy(null);
  validateCapabilityPolicy(policy, `${label} capability_policy`, report);
  const bindings = Array.isArray(contract.capability_bindings) ? contract.capability_bindings : [];
  if (!Array.isArray(contract.capability_bindings)) {
    report.errors.push(`${label} capability_bindings must be an array`);
  }
  const normalizedBindings = [];
  for (const [index, binding] of bindings.entries()) {
    try {
      normalizedBindings.push(normalizeCapabilityBinding(binding, index));
    } catch (error) {
      report.errors.push(`${label} ${error.message}`);
    }
  }
  if (!report.strict) {
    return;
  }
  for (const type of ["mcp", "tools"]) {
    const required = policy[type]?.required || [];
    for (const name of required) {
      if (capabilityHasBinding(normalizedBindings, type, name)) {
        continue;
      }
      if (contractHasCapabilityOpenQuestion(contract, type, name)) {
        continue;
      }
      report.errors.push(`${label} requires ${type} capability '${name}' but has no binding or open contract question`);
    }
  }
  validateCapabilityBindingTargets(context, normalizedBindings, label, report);
}

function capabilityHasBinding(bindings, type, name) {
  const bindingType = type === "tools" ? "tool" : type === "skills" ? "skill" : type;
  return bindings.some((binding) => binding.type === bindingType && binding.name === name);
}

function contractHasCapabilityOpenQuestion(contract, type, name) {
  const questions = contract.contextualization?.questions || [];
  return questions.some((question) => {
    const text = `${question.question || ""} ${question.id || ""} ${question.label || ""}`.toLowerCase();
    return question.status !== "answered" && text.includes(type.toLowerCase()) && text.includes(String(name).toLowerCase());
  });
}

function validateCapabilityBindingTargets(context, bindings, label, report) {
  for (const binding of bindings) {
    const target = binding.target || {};
    for (const [key, value] of Object.entries(target)) {
      if (!String(key).toLowerCase().includes("path") || typeof value !== "string") {
        continue;
      }
      const resolved = resolveProjectFilePath(context, value, { mustExist: false });
      if (isDerivedArtifactPath(context, resolved)) {
        report.errors.push(`${label} capability binding ${binding.binding_id} target.${key} points to derived cache/index path ${value}`);
      }
    }
  }
}

function validateContractCapabilityRecommendations(context, report, contract, label) {
  const refs = Array.isArray(contract.capability_recommendation_refs) ? contract.capability_recommendation_refs : [];
  if (refs.length === 0) {
    return;
  }
  for (const rawRef of refs) {
    let ref;
    try {
      ref = normalizeCapabilityRecommendationRefs([rawRef])[0];
    } catch (error) {
      report.errors.push(`${label} ${error.message}`);
      continue;
    }
    const recommendationPath = capabilityRecommendationPath(context, ref.id);
    if (!fs.existsSync(recommendationPath)) {
      report.errors.push(`${label} references missing capability recommendation ${ref.id}`);
      continue;
    }
    const recommendation = readJson(recommendationPath);
    const recommendationLabel = `capability recommendation ${ref.id}`;
    if (recommendation.status !== "approved") {
      report.errors.push(`${label} references ${recommendationLabel} but it is not approved`);
    }
    const latestApproval = latestApprovedRecordApproval(recommendation);
    const recommendationSeverity = approvalIssueSeverity(context, report, latestApproval);
    if (!isApprovedRecordFresh(recommendation)) {
      report[recommendationSeverity].push(`${label} references ${recommendationLabel} but its approval is stale`);
    }
    if (ref.approved_content_hash && latestApproval?.approved_content_hash !== ref.approved_content_hash) {
      report[recommendationSeverity].push(`${label} references ${recommendationLabel} with an outdated approved_content_hash`);
    }
    for (const issue of validateCapabilityRecordSourceHashes(context, recommendation, recommendationLabel, { collectOnly: true })) {
      const severity = approvedRecordIssueSeverity(context, report, recommendation);
      report[severity].push(issue);
    }
    const profilePath = capabilityProfilePath(context, recommendation.profile_id);
    if (!recommendation.profile_id || !fs.existsSync(profilePath)) {
      report.errors.push(`${label} ${recommendationLabel} references missing profile ${recommendation.profile_id || "unknown"}`);
    } else {
      const profile = readJson(profilePath);
      if (profile.status !== "approved") {
        report.errors.push(`${label} ${recommendationLabel} profile ${profile.id} is not approved or is stale`);
      } else if (!isApprovedRecordFresh(profile)) {
        report[approvedRecordIssueSeverity(context, report, profile)].push(`${label} ${recommendationLabel} profile ${profile.id} is not approved or is stale`);
      }
      for (const issue of validateCapabilityRecordSourceHashes(context, profile, `capability profile ${profile.id}`, { collectOnly: true })) {
        const severity = approvedRecordIssueSeverity(context, report, profile);
        report[severity].push(issue);
      }
    }
    for (const item of recommendation.recommendations || []) {
      if (item.install_required && !item.install_approved) {
        const severity = report.strict ? "errors" : "warnings";
        report[severity].push(`${label} uses install-required capability ${item.type}:${item.name} without install approval`);
      }
    }
    report.checked.push(`${label} capability recommendation ${ref.id}`);
  }
}

function mergeCapabilityPolicies(...policies) {
  const merged = buildCapabilityPolicy(null);
  for (const policy of policies.filter(Boolean)) {
    const normalized = buildCapabilityPolicy(policy);
    for (const type of CAPABILITY_TYPES) {
      for (const group of CAPABILITY_GROUPS) {
        pushAllUnique(merged[type][group], normalized[type][group]);
      }
    }
    pushAllUnique(merged.approval_required_for, normalized.approval_required_for);
  }
  validateCapabilityPolicy(merged, "capability_policy");
  return merged;
}

function loadCapabilityRecommendationsForContract(context, options) {
  const ids = normalizeRawListOption(options["capability-recommendation"]).map(normalizeId);
  const result = {
    refs: [],
    policy_patch: null,
    bindings: [],
    open_questions: [],
    execution_policy_suggestions: {
      model: undefined,
      reasoning: undefined,
      notes: [],
    },
  };
  for (const id of ids) {
    const recommendationPath = capabilityRecommendationPath(context, id);
    if (!fs.existsSync(recommendationPath)) {
      fail(`Capability recommendation ${id} does not exist`);
    }
    const recommendation = readJson(recommendationPath);
    validateApprovedCapabilityRecommendationForUse(context, recommendation, `capability recommendation ${id}`);
    result.refs.push({
      id,
      profile_id: recommendation.profile_id || null,
      path: toProjectPath(context, recommendationPath),
      approved_content_hash: latestApprovedRecordApproval(recommendation)?.approved_content_hash || null,
    });
    result.policy_patch = mergeCapabilityPolicies(result.policy_patch, recommendation.policy_patch || recommendation.capability_policy || null);
    result.bindings.push(...normalizeCapabilityBindings(recommendation.bindings || recommendation.capability_bindings || []));
    pushAllUnique(result.open_questions, normalizeCapabilityOpenQuestions(recommendation.open_questions, id));
    const suggestions = normalizeExecutionPolicySuggestions(recommendation.execution_policy_suggestions || {});
    result.execution_policy_suggestions.model = result.execution_policy_suggestions.model || suggestions.model;
    result.execution_policy_suggestions.reasoning = result.execution_policy_suggestions.reasoning || suggestions.reasoning;
    pushAllUnique(result.execution_policy_suggestions.notes, suggestions.notes);
  }
  return result;
}

function normalizeCapabilityOpenQuestions(questions, recommendationId) {
  if (!Array.isArray(questions)) {
    return [];
  }
  return questions
    .map((question) => {
      if (typeof question === "string") {
        return question;
      }
      if (question && typeof question === "object") {
        return question.question || question.prompt || question.label || question.id;
      }
      return null;
    })
    .filter(Boolean)
    .map((question) => `Capability recommendation ${recommendationId}: ${question}`);
}

function normalizeExecutionPolicySuggestions(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { model: undefined, reasoning: undefined, notes: [] };
  }
  return {
    model: value.model && typeof value.model === "object" ? value.model.value || undefined : value.model || undefined,
    reasoning: value.reasoning && typeof value.reasoning === "object" ? value.reasoning.level || undefined : value.reasoning || undefined,
    notes: normalizeListValue(value.notes, []),
  };
}

function buildAttribution(context, options = {}, action = "unknown") {
  return {
    action,
    actor: buildActor(options, context.root),
    git: buildGitMetadata(context.root),
    run: buildRunMetadata(options),
    recorded_at: now(),
  };
}

function buildApprovalEvidence(context, options = {}) {
  return normalizeListOption(options["approval-evidence"]).map((rawPath) => {
    const evidencePath = resolveProjectFilePath(context, rawPath, { mustExist: true, fileOnly: true });
    assertNotDerivedArtifact(context, evidencePath, "Approval evidence");
    return {
      path: toProjectPath(context, evidencePath),
      sha256: hashFile(evidencePath),
    };
  });
}

function getApprovalPolicy(context) {
  const policy = context.config.approval_policy || {};
  return {
    principle:
      policy.principle ||
      "Implementation authorization is not formal SDLC approval. Formal approvals must record an explicit source, approver, summary or evidence, and immutable subject hash.",
    formal_approval_requires_explicit_source: policy.formal_approval_requires_explicit_source !== false,
    require_summary_or_evidence_for_explicit_user: policy.require_summary_or_evidence_for_explicit_user !== false,
    allow_bootstrap_approvals_in_strict_gate: Boolean(policy.allow_bootstrap_approvals_in_strict_gate),
    legacy_approval_behavior: policy.legacy_approval_behavior || "error",
    accepted_sources: Array.isArray(policy.accepted_sources)
      ? policy.accepted_sources
      : ["explicit-user", "ci", "automation", "bootstrap"],
  };
}

function buildApprovalRecord(context, options, attribution, settings = {}) {
  const status = normalizeApprovalStatus(settings.status || options.status || "approved");
  const evidence = buildApprovalEvidence(context, options);
  const summary = getOptionString(options, "summary") || null;
  const source = normalizeApprovalSource(context, options, attribution, settings.label || "approval", status);
  validateApprovalSourceForActor(context, {
    source,
    status,
    summary,
    evidence,
    actor: attribution.actor,
    label: settings.label || "approval",
  });
  const approvedContentHash = status === "approved" ? hashApprovalSubject(settings.subject) : null;
  return {
    id: `APR-${compactTimestamp()}-${crypto.randomBytes(3).toString("hex")}`,
    ...(settings.subject_id_field && settings.subject_id ? { [settings.subject_id_field]: settings.subject_id } : {}),
    status,
    summary,
    scope: settings.scope || undefined,
    evidence,
    approval_source: source,
    explicit_user_confirmation: source === "explicit-user",
    provisional: source === "bootstrap",
    approved_content_hash: approvedContentHash,
    hash_algorithm: approvedContentHash ? "sha256:stable-json:v1" : null,
    approved_by: attribution.actor,
    git: attribution.git,
    run: attribution.run,
    created_at: now(),
  };
}

function normalizeApprovalSource(context, options, attribution, label, status) {
  if (status !== "approved") {
    return getOptionString(options, "approval-source") || null;
  }
  const source = getOptionString(options, "approval-source");
  if (!source && attribution.actor.type === "ci") {
    return "ci";
  }
  const policy = getApprovalPolicy(context);
  if (!source) {
    if (policy.formal_approval_requires_explicit_source) {
      fail(`${label} requires --approval-source explicit-user|ci|automation|bootstrap. Implementation permission is not formal SDLC approval.`);
    }
    return null;
  }
  const normalized = String(source).trim().toLowerCase();
  if (!APPROVAL_SOURCES.has(normalized) || !policy.accepted_sources.includes(normalized)) {
    fail(`Unknown approval source '${source}'. Valid sources: ${policy.accepted_sources.join(", ")}`);
  }
  return normalized;
}

function validateApprovalSourceForActor(context, approval) {
  if (approval.status !== "approved") {
    return;
  }
  const policy = getApprovalPolicy(context);
  if (!approval.source && policy.formal_approval_requires_explicit_source) {
    fail(`${approval.label} requires --approval-source.`);
  }
  if (approval.source === "explicit-user" && approval.actor?.type !== "human") {
    fail(`${approval.label} uses approval_source explicit-user but actor type is '${approval.actor?.type || "unknown"}'.`);
  }
  if (approval.source === "ci" && approval.actor?.type !== "ci") {
    fail(`${approval.label} uses approval_source ci but actor type is '${approval.actor?.type || "unknown"}'.`);
  }
  if (
    approval.source === "explicit-user" &&
    policy.require_summary_or_evidence_for_explicit_user &&
    !approval.summary &&
    approval.evidence.length === 0
  ) {
    fail(`${approval.label} requires --summary or --approval-evidence when --approval-source explicit-user is used.`);
  }
  if (approval.source === "bootstrap" && !approval.summary && approval.evidence.length === 0) {
    fail(`${approval.label} bootstrap approval requires --summary or --approval-evidence so future readers can distinguish migration from user consent.`);
  }
}

function validateFormalApprovalRecord(context, report, approval, label, actor) {
  if (!approval || approval.status !== "approved") {
    return;
  }
  const policy = getApprovalPolicy(context);
  const source = approval.approval_source || null;
  if (report.strict && policy.formal_approval_requires_explicit_source && !source) {
    const severity = policy.legacy_approval_behavior === "warn" ? "warnings" : "errors";
    report[severity].push(`${label} is a legacy approval without approval_source; re-approve with explicit-user, ci, automation, or bootstrap source`);
  }
  if (source && (!APPROVAL_SOURCES.has(source) || !policy.accepted_sources.includes(source))) {
    report.errors.push(`${label} has invalid approval_source '${source}'`);
  }
  if (report.strict && source === "bootstrap" && !policy.allow_bootstrap_approvals_in_strict_gate) {
    report.errors.push(`${label} is bootstrap/provisional and cannot satisfy strict gate; re-approve with explicit-user or ci`);
  }
  if (source === "explicit-user" && actor?.type !== "human") {
    report.errors.push(`${label} approval_source explicit-user requires a human approver`);
  }
  if (source === "ci" && actor?.type !== "ci") {
    report.errors.push(`${label} approval_source ci requires a CI approver`);
  }
  if (
    report.strict &&
    source === "explicit-user" &&
    policy.require_summary_or_evidence_for_explicit_user &&
    !approval.summary &&
    !approval.approval_summary &&
    (!Array.isArray(approval.evidence || approval.approval_evidence) || (approval.evidence || approval.approval_evidence).length === 0)
  ) {
    report.errors.push(`${label} explicit-user approval requires summary or evidence`);
  }
}

function approvalIssueSeverity(context, report, approval) {
  if (!report.strict) {
    return "warnings";
  }
  const policy = getApprovalPolicy(context);
  if (!approval?.approval_source && policy.legacy_approval_behavior === "warn") {
    return "warnings";
  }
  return "errors";
}

function approvedRecordIssueSeverity(context, report, record) {
  if (record?.status !== "approved") {
    return "warnings";
  }
  return approvalIssueSeverity(context, report, latestApprovedRecordApproval(record));
}

function hashApprovalSubject(value) {
  return shortHashFull(stableJson(stripApprovalVolatileFields(value)));
}

function stripApprovalVolatileFields(value) {
  if (Array.isArray(value)) {
    return value.map(stripApprovalVolatileFields);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const stripped = {};
  const volatile = new Set(["approvals", "audit", "created_at", "updated_at", "approved_at", "approved_by", "status"]);
  for (const key of Object.keys(value).sort()) {
    if (!volatile.has(key)) {
      stripped[key] = stripApprovalVolatileFields(value[key]);
    }
  }
  return stripped;
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (!value || typeof value !== "object") {
    return JSON.stringify(value);
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
    .join(",")}}`;
}

function buildActor(options = {}, root = process.cwd()) {
  const explicitActor = getOptionString(options, "actor", "agent");
  const envActor =
    process.env.CODEX_AGENT_NAME ||
    process.env.GITHUB_ACTOR ||
    process.env.GIT_AUTHOR_NAME ||
    process.env.USER ||
    null;
  const id = explicitActor || envActor || "unknown";
  const actorType = normalizeActorType(getOptionString(options, "actor-type") || inferActorType(options, id));
  const name =
    getOptionString(options, "actor-name") ||
    process.env.GIT_AUTHOR_NAME ||
    gitConfigValue(root, "user.name") ||
    null;
  const email =
    getOptionString(options, "actor-email") ||
    process.env.GIT_AUTHOR_EMAIL ||
    gitConfigValue(root, "user.email") ||
    null;

  return {
    id,
    type: actorType,
    name,
    email,
    source: explicitActor ? "cli" : "environment",
  };
}

function inferActorType(options = {}, actorId = "") {
  if (options.agent || process.env.CODEX_AGENT_NAME || String(actorId).toLowerCase().includes("codex")) {
    return "agent";
  }
  if (process.env.GITHUB_ACTOR || process.env.CI) {
    return "ci";
  }
  if (process.env.USER) {
    return "human";
  }
  return "unknown";
}

function normalizeActorType(value) {
  const normalized = String(value || "unknown").trim().toLowerCase();
  const allowed = ["human", "agent", "system", "ci", "unknown"];
  if (!allowed.includes(normalized)) {
    fail(`Unknown --actor-type '${value}'. Valid values: ${allowed.join(", ")}`);
  }
  return normalized;
}

function buildGitMetadata(root) {
  const isGitRepo = execGit(root, ["rev-parse", "--is-inside-work-tree"]) === "true";
  if (!isGitRepo) {
    return {
      is_git_repo: false,
      branch: null,
      head_sha: null,
      is_dirty: null,
      user: {
        name: null,
        email: null,
      },
      remotes: [],
    };
  }

  const status = execGit(root, ["status", "--porcelain"]) || "";
  return {
    is_git_repo: true,
    branch: execGit(root, ["rev-parse", "--abbrev-ref", "HEAD"]),
    head_sha: execGit(root, ["rev-parse", "HEAD"]),
    is_dirty: status.length > 0,
    user: {
      name: gitConfigValue(root, "user.name"),
      email: gitConfigValue(root, "user.email"),
    },
    remotes: (execGit(root, ["remote"]) || "")
      .split(/\r?\n/)
      .map((remote) => remote.trim())
      .filter(Boolean),
  };
}

function buildRunMetadata(options = {}) {
  return {
    run_id: getOptionString(options, "run-id") || process.env.CODEX_RUN_ID || null,
    thread_id: getOptionString(options, "thread-id") || process.env.CODEX_THREAD_ID || null,
    session_id: getOptionString(options, "session-id") || process.env.CODEX_SESSION_ID || null,
    tool: "agentic-sdlc-cli",
    version: VERSION,
  };
}

function getOptionString(options = {}, ...keys) {
  for (const key of keys) {
    if (options[key] !== undefined) {
      return normalizeScalarOption(options[key], key);
    }
  }
  return null;
}

function gitConfigValue(root, key) {
  return execGit(root, ["config", "--get", key]);
}

function execGit(root, args) {
  try {
    return childProcess
      .execFileSync("git", ["-C", root, ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      })
      .trim() || null;
  } catch {
    return null;
  }
}

function readProjectSafe(context) {
  const projectPath = path.join(context.sdlcRoot, "project.json");
  if (!fs.existsSync(projectPath)) {
    return null;
  }
  return readJson(projectPath);
}

function buildContextSources(context, contextFiles) {
  return contextFiles.map((rawPath) => {
    const resolved = resolveProjectFilePath(context, rawPath, { mustExist: true, fileOnly: true });
    const content = fs.readFileSync(resolved);
    const text = content.toString("utf8");
    return {
      path: path.relative(context.root, resolved),
      sha256: crypto.createHash("sha256").update(content).digest("hex"),
      size_bytes: content.length,
      excerpt: normalizeText(text).slice(0, 1200),
    };
  });
}

function buildQuestionRecords(questions, qaItems) {
  const records = questions.map((question) => ({
    question,
    answer: null,
    status: "open",
  }));
  for (const item of qaItems) {
    const [question, ...answerParts] = String(item).split("|");
    const answer = answerParts.join("|").trim();
    records.push({
      question: question.trim(),
      answer: answer || null,
      status: answer ? "answered" : "open",
    });
  }
  return records.filter((record) => record.question);
}

function buildOutputContractRefs(rawRefs) {
  return rawRefs.map((rawRef) => {
    const parts = String(rawRef).split(":").map((part) => part.trim());
    if (parts.length !== 3 || parts.some((part) => !part)) {
      fail("Output refs must use --output-ref artifact-type:template-id:reuse|delta|new");
    }
    const [artifactType, templateId, mode] = parts;
    return {
      artifact_type: normalizeArtifactType(artifactType),
      template_id: normalizeId(templateId),
      mode: normalizeOutputMode(mode),
    };
  });
}

function mergeList(base, additions = []) {
  const merged = [...base];
  for (const item of additions) {
    if (!merged.includes(item)) {
      merged.push(item);
    }
  }
  return merged;
}

function createStory(context, options) {
  ensureInitialized(context);
  const id = normalizeId(requireOption(options, "id"));
  const title = requireOption(options, "title");
  const phase = String(options.phase || "design");
  if (!context.config.phases[phase]) {
    fail(`Unknown phase '${phase}'. Valid phases: ${Object.keys(context.config.phases).join(", ")}`);
  }
  const status = normalizeStoryStatus(options.status || "draft");
  const storyDir = path.join(context.sdlcRoot, "stories", id);
  ensureDir(storyDir);

  const acceptanceCriteria = normalizeListOption(options.acceptance);
  const attribution = buildAttribution(context, options, "story.create");
  const story = {
    id,
    title,
    schema_version: context.config.schema_version,
    status,
    phase,
    contract_id: options.contract ? String(options.contract) : null,
    work_breakdown_id: options.breakdown ? normalizeId(String(options.breakdown)) : null,
    acceptance_criteria: acceptanceCriteria,
    links: {
      requirements: normalizeListOption(options.requirement),
      decisions: [],
      tests: [],
    },
    created_at: now(),
    updated_at: now(),
    audit: {
      created_by: attribution.actor,
      updated_by: attribution.actor,
      git: attribution.git,
      run: attribution.run,
    },
  };

  writeJsonFile(path.join(storyDir, "story.json"), story, { force: Boolean(options.force) });
  renderTemplateFile(
    context,
    "story-plan.md",
    path.join(storyDir, "plan.md"),
    { STORY_ID: id },
    { force: Boolean(options.force) },
  );
  renderTemplateFile(
    context,
    "implementation-log.md",
    path.join(storyDir, "implementation-log.md"),
    { STORY_ID: id, CREATED_AT: now() },
    { force: Boolean(options.force) },
  );

  output(
    options,
    { status: "created", story_path: storyDir, story },
    [`Created story workspace ${id}`, `Path: ${path.relative(context.root, storyDir)}`],
  );
}

function createWorkItem(context, options) {
  ensureInitialized(context);
  ensurePlanningDirectories(context);
  const type = normalizeWorkItemType(requireOption(options, "type"));
  if (!WORK_ITEM_CREATE_TYPES.has(type)) {
    fail(`work item create supports only ${Array.from(WORK_ITEM_CREATE_TYPES).join(", ")} in this version.`);
  }
  const id = normalizeId(requireOption(options, "id"));
  const title = requireOption(options, "title");
  const attribution = buildAttribution(context, options, "work_item.create");
  const item = {
    id,
    type,
    title,
    schema_version: context.config.schema_version,
    status: String(options.status || "draft"),
    parent_id: options.parent ? normalizeId(String(options.parent)) : null,
    story_id: options.story ? normalizeId(String(options.story)) : null,
    requirement_ids: normalizeListOption(options.requirement).map(normalizeId),
    acceptance_criteria: normalizeListOption(options.acceptance),
    created_at: now(),
    updated_at: now(),
    audit: {
      created_by: attribution.actor,
      updated_by: attribution.actor,
      git: attribution.git,
      run: attribution.run,
    },
  };
  const itemPath = workItemPath(context, type, id);
  writeJsonFile(itemPath, item, { force: Boolean(options.force) });
  output(
    options,
    { status: "created", work_item_path: itemPath, work_item: item },
    [`Created ${type} ${id}`, `Path: ${toProjectPath(context, itemPath)}`],
  );
}

function showBreakdownPolicy(context, options) {
  ensureInitialized(context);
  const policy = readEffectiveBreakdownPolicy(context);
  output(options, policy, [
    `Delivery unit: ${policy.delivery_unit}`,
    `Strict gate unit: ${policy.strict_gate_unit}`,
    `Levels: ${policy.levels.join(", ")}`,
    `Claimable units: ${policy.claimable_units.join(", ")}`,
  ]);
}

function setBreakdownPolicy(context, options) {
  ensureInitialized(context);
  ensurePlanningDirectories(context);
  const current = readEffectiveBreakdownPolicy(context);
  const policy = {
    ...current,
    levels: options.levels ? normalizeListOption(options.levels).map((item) => normalizeWorkItemType(item, { allowStory: true })) : current.levels,
    default_flow: options["default-flow"] ? normalizeListOption(options["default-flow"]) : current.default_flow,
    delivery_unit: options["delivery-unit"]
      ? normalizeWorkItemType(options["delivery-unit"], { allowStory: true })
      : current.delivery_unit,
    strict_gate_unit: options["strict-gate-unit"]
      ? normalizeWorkItemType(options["strict-gate-unit"], { allowStory: true })
      : current.strict_gate_unit,
    task_gate: options["task-gate"] ? String(options["task-gate"]) : current.task_gate,
  };
  validateWorkBreakdownPolicy(policy);
  const attribution = buildAttribution(context, options, "breakdown.policy.set");
  const record = {
    schema_version: context.config.schema_version,
    policy,
    updated_at: now(),
    audit: {
      updated_by: attribution.actor,
      git: attribution.git,
      run: attribution.run,
    },
  };
  const policyPath = path.join(workBreakdownRoot(context), "project-policy.json");
  writeJsonFile(policyPath, record, { force: true });
  output(options, { status: "updated", policy_path: policyPath, policy }, [`Updated breakdown policy at ${toProjectPath(context, policyPath)}`]);
}

function proposeBreakdown(context, options) {
  ensureInitialized(context);
  ensurePlanningDirectories(context);
  const id = normalizeId(requireOption(options, "id"));
  if (id === "project-policy") {
    fail("breakdown id 'project-policy' is reserved");
  }
  const requirementId = normalizeId(requireOption(options, "requirement"));
  const items = normalizeRawListOption(options.item).map(parseBreakdownItemRef);
  if (items.length === 0) {
    fail("breakdown propose requires at least one --item type:id.");
  }
  const attribution = buildAttribution(context, options, "breakdown.propose");
  const breakdown = {
    id,
    schema_version: context.config.schema_version,
    status: "proposed",
    requirement_id: requirementId,
    items,
    rationale: getOptionString(options, "rationale") || null,
    approvals: [],
    created_at: now(),
    updated_at: now(),
    audit: {
      created_by: attribution.actor,
      updated_by: attribution.actor,
      git: attribution.git,
      run: attribution.run,
    },
  };
  const breakdownPath = breakdownPathById(context, id);
  writeJsonFile(breakdownPath, breakdown, { force: Boolean(options.force) });
  output(options, { status: "proposed", breakdown_path: breakdownPath, breakdown }, [`Proposed breakdown ${id}`]);
}

function approveBreakdown(context, options) {
  ensureInitialized(context);
  const id = normalizeId(requireOption(options, "id"));
  const breakdownPath = breakdownPathById(context, id);
  if (!fs.existsSync(breakdownPath)) {
    fail(`Breakdown ${id} does not exist`);
  }
  const breakdown = readJson(breakdownPath);
  const attribution = buildAttribution(context, options, "breakdown.approve");
  requireHumanOrCiActor(attribution, "Approving a work breakdown");
  const approval = buildApprovalRecord(context, options, attribution, {
    subject: breakdown,
    subject_id_field: "breakdown_id",
    subject_id: id,
    label: `breakdown ${id}`,
  });
  breakdown.status = "approved";
  breakdown.approvals = Array.isArray(breakdown.approvals) ? breakdown.approvals : [];
  breakdown.approvals.push(approval);
  breakdown.updated_at = now();
  breakdown.audit = {
    ...(breakdown.audit || {}),
    updated_by: attribution.actor,
    git: attribution.git,
    run: attribution.run,
  };
  writeJsonFile(breakdownPath, breakdown, { force: true });
  output(options, { status: "approved", breakdown_path: breakdownPath, approval, breakdown }, [`Approved breakdown ${id}`]);
}

function showBreakdownStatus(context, options) {
  ensureInitialized(context);
  const requirementId = options.requirement ? normalizeId(String(options.requirement)) : null;
  const breakdowns = readBreakdowns(context).filter(
    (breakdown) => !requirementId || breakdown.requirement_id === requirementId,
  );
  output(
    options,
    { breakdowns },
    breakdowns.length
      ? breakdowns.map((breakdown) => `${breakdown.id}: ${breakdown.status} (${breakdown.requirement_id})`)
      : ["No breakdown records found."],
  );
}

function proposeDependencyGraph(context, options) {
  ensureInitialized(context);
  ensurePlanningDirectories(context);
  const id = normalizeId(requireOption(options, "id"));
  if (id === "graph") {
    fail("dependency id 'graph' is reserved");
  }
  const requirementId = options.requirement ? normalizeId(String(options.requirement)) : null;
  const edges = normalizeRawListOption(options.edge).map(parseDependencyEdge);
  if (edges.length === 0) {
    fail("dependency propose requires at least one --edge from:to:type:blocks:required_state.");
  }
  const attribution = buildAttribution(context, options, "dependency.propose");
  const proposal = {
    id,
    schema_version: context.config.schema_version,
    status: "proposed",
    requirement_id: requirementId,
    edges,
    rationale: getOptionString(options, "rationale") || null,
    approvals: [],
    created_at: now(),
    updated_at: now(),
    audit: {
      created_by: attribution.actor,
      updated_by: attribution.actor,
      git: attribution.git,
      run: attribution.run,
    },
  };
  const proposalPath = dependencyProposalPath(context, id);
  writeJsonFile(proposalPath, proposal, { force: Boolean(options.force) });
  output(options, { status: "proposed", dependency_path: proposalPath, dependency: proposal }, [`Proposed dependency graph ${id}`]);
}

function approveDependencyGraph(context, options) {
  ensureInitialized(context);
  const id = normalizeId(requireOption(options, "id"));
  const proposalPath = dependencyProposalPath(context, id);
  if (!fs.existsSync(proposalPath)) {
    fail(`Dependency proposal ${id} does not exist`);
  }
  const proposal = readJson(proposalPath);
  const attribution = buildAttribution(context, options, "dependency.approve");
  requireHumanOrCiActor(attribution, "Approving dependency graph changes");
  const approval = buildApprovalRecord(context, options, attribution, {
    subject: proposal,
    subject_id_field: "dependency_id",
    subject_id: id,
    label: `dependency ${id}`,
  });
  proposal.status = "approved";
  proposal.approvals = Array.isArray(proposal.approvals) ? proposal.approvals : [];
  proposal.approvals.push(approval);
  proposal.updated_at = now();
  proposal.audit = {
    ...(proposal.audit || {}),
    updated_by: attribution.actor,
    git: attribution.git,
    run: attribution.run,
  };
  writeJsonFile(proposalPath, proposal, { force: true });

  const graph = readDependencyGraph(context, { missingOk: true });
  for (const edge of proposal.edges || []) {
    upsertDependencyEdge(graph, {
      ...edge,
      proposal_id: id,
      requirement_id: proposal.requirement_id || null,
      rationale: proposal.rationale || null,
      approved_at: now(),
      approved_by: attribution.actor,
    });
  }
  graph.updated_at = now();
  graph.audit = {
    ...(graph.audit || {}),
    updated_by: attribution.actor,
    git: attribution.git,
    run: attribution.run,
  };
  writeJsonFile(dependencyGraphPath(context), graph, { force: true });
  output(options, { status: "approved", dependency_path: proposalPath, graph_path: dependencyGraphPath(context), approval, dependency: proposal, graph }, [`Approved dependency graph ${id}`]);
}

function showDependencyStatus(context, options) {
  ensureInitialized(context);
  const storyId = options.story ? normalizeId(String(options.story)) : null;
  const status = buildDependencyStatus(context, storyId);
  output(
    options,
    status,
    storyId
      ? [`Dependencies for ${storyId}: ${status.edges.length}`, ...status.blockers.map((item) => `BLOCKER ${item}`), ...status.warnings.map((item) => `WARN ${item}`)]
      : [`Dependency edges: ${status.edges.length}`, `Blockers: ${status.blockers.length}`, `Warnings: ${status.warnings.length}`],
  );
}

function showStoryDependencies(context, options) {
  showDependencyStatus(context, { ...options, story: requireOption(options, "id") });
}

function proposeCapabilityProfile(context, options) {
  ensureInitialized(context);
  ensureCapabilityDiscoveryDirectories(context);
  const id = normalizeId(requireOption(options, "id"));
  const input = loadOptionalJsonInput(context, options, "profile-json", "profile-file", "Capability profile");
  const contextFiles = normalizeRawListOption(options["context-file"]);
  const attribution = buildAttribution(context, options, "capability.profile.propose");
  const detectedStack = Array.isArray(input.detected_stack) && input.detected_stack.length > 0
    ? input.detected_stack
    : detectProjectStack(context);
  const evidence = [
    ...normalizeCapabilityEvidence(input.evidence),
    ...buildCapabilityEvidenceFromContextFiles(context, contextFiles),
    ...detectedStack.map((item) => ({
      type: "detected_stack",
      path: item.source_path || null,
      summary: `${item.type || "technology"}:${item.name || "unknown"}`,
    })),
  ];
  const sourcePaths = normalizeCapabilitySourcePaths(context, [
    ...normalizeListValue(input.source_paths, []),
    ...evidence.map((item) => item.path).filter(Boolean),
  ]);
  const profile = {
    id,
    schema_version: context.config.schema_version,
    status: "proposed",
    subject: normalizeCapabilitySubject(options, input.subject || {}),
    application_profile: normalizeObject(input.application_profile),
    detected_stack: detectedStack,
    constraints: mergeList(normalizeListValue(input.constraints, []), normalizeListOption(options.constraint)),
    integrations: normalizeListValue(input.integrations, []),
    evidence,
    confidence: normalizeConfidence(input.confidence ?? options.confidence ?? 0.7),
    source_paths: sourcePaths,
    source_hashes: buildSourceHashes(context, sourcePaths),
    approvals: [],
    created_at: now(),
    updated_at: now(),
    audit: {
      proposed_by: attribution.actor,
      git: attribution.git,
      run: attribution.run,
    },
  };
  const profilePath = capabilityProfilePath(context, id);
  writeJsonFile(profilePath, profile, { force: Boolean(options.force) });
  appendTraceEvent(context, profile.subject.story_id || null, {
    type: "decision",
    summary: `Proposed capability profile ${id}`,
    action: "capability.profile.propose",
    actor: attribution.actor,
    evidence: [toProjectPath(context, profilePath), ...sourcePaths],
    related: [id, profile.subject.story_id, ...(profile.subject.requirement_ids || [])].filter(Boolean),
    git: attribution.git,
    run: attribution.run,
  });
  output(options, { status: "proposed", profile_path: profilePath, profile }, [`Proposed capability profile ${id}`]);
}

function approveCapabilityProfile(context, options) {
  ensureInitialized(context);
  const id = normalizeId(requireOption(options, "id"));
  const profilePath = capabilityProfilePath(context, id);
  if (!fs.existsSync(profilePath)) {
    fail(`Capability profile ${id} does not exist`);
  }
  const profile = readJson(profilePath);
  const attribution = buildAttribution(context, options, "capability.profile.approve");
  requireHumanOrCiActor(attribution, "Approving a capability profile");
  validateCapabilityRecordSourceHashes(context, profile, `capability profile ${id}`, { failOnStale: true });
  const approval = buildApprovalRecord(context, options, attribution, {
    subject: profile,
    subject_id_field: "profile_id",
    subject_id: id,
    label: `capability profile ${id}`,
  });
  profile.status = "approved";
  profile.approvals = Array.isArray(profile.approvals) ? profile.approvals : [];
  profile.approvals.push(approval);
  profile.updated_at = now();
  profile.audit = {
    ...(profile.audit || {}),
    approved_by: attribution.actor,
    git: attribution.git,
    run: attribution.run,
  };
  writeJsonFile(profilePath, profile, { force: true });
  appendTraceEvent(context, profile.subject?.story_id || null, {
    type: "gate",
    summary: `Approved capability profile ${id}`,
    action: "capability.profile.approve",
    actor: attribution.actor,
    evidence: [toProjectPath(context, profilePath)],
    related: [id, profile.subject?.story_id].filter(Boolean),
    git: attribution.git,
    run: attribution.run,
  });
  output(options, { status: "approved", profile_path: profilePath, approval, profile }, [`Approved capability profile ${id}`]);
}

function proposeCapabilityRecommendation(context, options) {
  ensureInitialized(context);
  ensureCapabilityDiscoveryDirectories(context);
  const id = normalizeId(requireOption(options, "id"));
  const profileId = normalizeId(requireOption(options, "profile"));
  const profilePath = capabilityProfilePath(context, profileId);
  if (!fs.existsSync(profilePath)) {
    fail(`Capability profile ${profileId} does not exist`);
  }
  const profile = readJson(profilePath);
  const input = loadOptionalJsonInput(context, options, "recommendation-json", "recommendation-file", "Capability recommendation");
  const availableCapabilities = loadOptionalJsonInput(
    context,
    options,
    "available-capabilities-json",
    "available-capabilities-file",
    "Available capabilities",
  );
  const attribution = buildAttribution(context, options, "capability.recommend");
  const recommendations = normalizeCapabilityRecommendations(
    input.recommendations || buildDefaultCapabilityRecommendations(profile, availableCapabilities),
  );
  const policyPatch = mergeCapabilityPolicies(
    buildDefaultCapabilityPolicyPatch(recommendations),
    input.policy_patch || input.capability_policy || null,
  );
  const bindings = normalizeCapabilityBindings(input.bindings || input.capability_bindings || []);
  const sourcePaths = normalizeCapabilitySourcePaths(context, [
    toProjectPath(context, profilePath),
    ...normalizeListValue(input.source_paths, []),
  ]);
  const recommendation = {
    id,
    schema_version: context.config.schema_version,
    status: "proposed",
    profile_id: profileId,
    profile_ref: {
      path: toProjectPath(context, profilePath),
      approved_content_hash: latestApprovedRecordApproval(profile)?.approved_content_hash || null,
    },
    recommendations,
    available_capabilities: normalizeObject(availableCapabilities),
    policy_patch: policyPatch,
    bindings,
    execution_policy_suggestions: normalizeExecutionPolicySuggestions(input.execution_policy_suggestions || {}),
    decision_matrix: Array.isArray(input.decision_matrix) ? input.decision_matrix : [],
    open_questions: Array.isArray(input.open_questions) ? input.open_questions : [],
    source_paths: sourcePaths,
    source_hashes: buildSourceHashes(context, sourcePaths),
    approvals: [],
    created_at: now(),
    updated_at: now(),
    audit: {
      proposed_by: attribution.actor,
      git: attribution.git,
      run: attribution.run,
    },
  };
  const recommendationPath = capabilityRecommendationPath(context, id);
  writeJsonFile(recommendationPath, recommendation, { force: Boolean(options.force) });
  appendTraceEvent(context, profile.subject?.story_id || null, {
    type: "decision",
    summary: `Proposed capability recommendation ${id}`,
    action: "capability.recommend",
    actor: attribution.actor,
    evidence: [toProjectPath(context, recommendationPath), toProjectPath(context, profilePath)],
    related: [id, profileId, profile.subject?.story_id].filter(Boolean),
    git: attribution.git,
    run: attribution.run,
  });
  output(options, { status: "proposed", recommendation_path: recommendationPath, recommendation }, [`Proposed capability recommendation ${id}`]);
}

function approveCapabilityRecommendation(context, options) {
  ensureInitialized(context);
  const id = normalizeId(requireOption(options, "id"));
  const recommendationPath = capabilityRecommendationPath(context, id);
  if (!fs.existsSync(recommendationPath)) {
    fail(`Capability recommendation ${id} does not exist`);
  }
  const recommendation = readJson(recommendationPath);
  const attribution = buildAttribution(context, options, "capability.approve");
  requireHumanOrCiActor(attribution, "Approving a capability recommendation");
  const profile = readCapabilityProfile(context, recommendation.profile_id);
  validateApprovedCapabilityProfileForUse(context, profile, `capability profile ${recommendation.profile_id}`);
  validateCapabilityRecordSourceHashes(context, recommendation, `capability recommendation ${id}`, { failOnStale: true });
  if (options["approve-install"]) {
    recommendation.recommendations = (recommendation.recommendations || []).map((item) =>
      item.install_required ? { ...item, install_approved: true, install_approved_at: now(), install_approved_by: attribution.actor } : item,
    );
  }
  recommendation.profile_ref = {
    path: toProjectPath(context, capabilityProfilePath(context, recommendation.profile_id)),
    approved_content_hash: latestApprovedRecordApproval(profile)?.approved_content_hash || null,
  };
  const approval = buildApprovalRecord(context, options, attribution, {
    subject: recommendation,
    subject_id_field: "recommendation_id",
    subject_id: id,
    label: `capability recommendation ${id}`,
  });
  recommendation.status = "approved";
  recommendation.approvals = Array.isArray(recommendation.approvals) ? recommendation.approvals : [];
  recommendation.approvals.push(approval);
  recommendation.updated_at = now();
  recommendation.audit = {
    ...(recommendation.audit || {}),
    approved_by: attribution.actor,
    git: attribution.git,
    run: attribution.run,
  };
  writeJsonFile(recommendationPath, recommendation, { force: true });
  appendTraceEvent(context, profile.subject?.story_id || null, {
    type: "gate",
    summary: `Approved capability recommendation ${id}`,
    action: "capability.approve",
    actor: attribution.actor,
    evidence: [toProjectPath(context, recommendationPath)],
    related: [id, recommendation.profile_id, profile.subject?.story_id].filter(Boolean),
    git: attribution.git,
    run: attribution.run,
  });
  output(options, { status: "approved", recommendation_path: recommendationPath, approval, recommendation }, [`Approved capability recommendation ${id}`]);
}

function showCapabilityStatus(context, options) {
  ensureInitialized(context);
  const storyId = options.story ? normalizeId(String(options.story)) : null;
  const profileId = options.profile ? normalizeId(String(options.profile)) : null;
  const profiles = readCapabilityProfiles(context).filter((profile) => {
    if (profileId && profile.id !== profileId) {
      return false;
    }
    return !storyId || profile.subject?.story_id === storyId;
  });
  const profileIds = new Set(profiles.map((profile) => profile.id));
  const recommendations = readCapabilityRecommendations(context).filter((recommendation) => {
    if (profileId && recommendation.profile_id !== profileId) {
      return false;
    }
    return !storyId || profileIds.has(recommendation.profile_id);
  });
  const status = {
    profiles: profiles.map((profile) => capabilityRecordStatus(context, profile, `capability profile ${profile.id}`)),
    recommendations: recommendations.map((recommendation) =>
      capabilityRecordStatus(context, recommendation, `capability recommendation ${recommendation.id}`),
    ),
  };
  output(
    options,
    status,
    [
      `Capability profiles: ${status.profiles.length}`,
      ...status.profiles.map((profile) => `${profile.id}: ${profile.status}${profile.fresh ? "" : " (stale)"}`),
      `Capability recommendations: ${status.recommendations.length}`,
      ...status.recommendations.map((recommendation) => `${recommendation.id}: ${recommendation.status}${recommendation.fresh ? "" : " (stale)"}`),
    ],
  );
}

function ensurePlanningDirectories(context) {
  ensureDir(workItemsRoot(context));
  ensureDir(path.join(workItemsRoot(context), "epics"));
  ensureDir(path.join(workItemsRoot(context), "tasks"));
  ensureDir(workBreakdownRoot(context));
  ensureDir(dependenciesRoot(context));
}

function workItemsRoot(context) {
  return path.join(context.sdlcRoot, "work-items");
}

function workBreakdownRoot(context) {
  return path.join(context.sdlcRoot, "work-breakdown");
}

function dependenciesRoot(context) {
  return path.join(context.sdlcRoot, "dependencies");
}

function capabilityDiscoveryRoot(context) {
  return path.join(context.sdlcRoot, "capability-discovery");
}

function capabilityProfilesRoot(context) {
  return path.join(capabilityDiscoveryRoot(context), "profiles");
}

function capabilityRecommendationsRoot(context) {
  return path.join(capabilityDiscoveryRoot(context), "recommendations");
}

function ensureCapabilityDiscoveryDirectories(context) {
  ensureDir(capabilityDiscoveryRoot(context));
  ensureDir(capabilityProfilesRoot(context));
  ensureDir(capabilityRecommendationsRoot(context));
}

function baselineRoot(context) {
  return path.join(context.sdlcRoot, "baseline");
}

function ensureBaselineDirectory(context) {
  ensureDir(baselineRoot(context));
}

function baselinePathById(context, id) {
  return path.join(baselineRoot(context), `${normalizeId(id)}.json`);
}

function readBaselines(context) {
  return safeReadDir(baselineRoot(context))
    .filter((name) => name.endsWith(".json"))
    .map((name) => readJson(path.join(baselineRoot(context), name)))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function buildBaselineDocumentEvidence(context, rawPath) {
  const resolved = resolveProjectFilePath(context, rawPath, { mustExist: true, fileOnly: true });
  assertNotDerivedArtifact(context, resolved, "Baseline document");
  const content = fs.readFileSync(resolved);
  return {
    type: "document",
    path: toProjectPath(context, resolved),
    sha256: hashBuffer(content),
    size_bytes: content.length,
    excerpt: normalizeText(content.toString("utf8")).slice(0, 800),
  };
}

function normalizeBaselineSourcePaths(context, rawPaths) {
  const result = [];
  for (const rawPath of rawPaths) {
    const resolved = resolveProjectFilePath(context, rawPath, { mustExist: true });
    assertNotDerivedArtifact(context, resolved, "Baseline source");
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) {
      for (const filePath of walkFiles(resolved)) {
        if (shouldIndexFile(context, filePath) && !isDerivedArtifactPath(context, filePath)) {
          result.push(toProjectPath(context, filePath));
        }
      }
    } else if (stat.isFile()) {
      result.push(toProjectPath(context, resolved));
    }
  }
  return Array.from(new Set(result)).sort();
}

function buildRepositorySnapshot(context, detectedStack = detectProjectStack(context)) {
  const keyFiles = collectProjectKeyFiles(context);
  return {
    root_name: path.basename(context.root),
    git: buildGitMetadata(context.root),
    detected_stack: detectedStack,
    key_files: keyFiles,
    package_scripts: readPackageScripts(context),
    source_roots: inferSourceRoots(context),
    test_roots: inferTestRoots(context),
    ci_files: keyFiles.filter((item) => item.path.startsWith(".github/") || item.path.includes("ci") || item.path.includes("workflow")),
  };
}

function collectProjectKeyFiles(context) {
  const candidates = [
    "README.md",
    "package.json",
    "pnpm-lock.yaml",
    "package-lock.json",
    "yarn.lock",
    "tsconfig.json",
    "jsconfig.json",
    "vite.config.js",
    "vite.config.ts",
    "next.config.js",
    "next.config.mjs",
    "pyproject.toml",
    "requirements.txt",
    "Dockerfile",
    "docker-compose.yml",
    "go.mod",
    "Cargo.toml",
    "Package.swift",
    ".github/workflows",
  ];
  const files = [];
  for (const candidate of candidates) {
    const resolved = path.join(context.root, candidate);
    if (!fs.existsSync(resolved)) {
      continue;
    }
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) {
      for (const filePath of walkFiles(resolved)) {
        if (shouldIndexFile(context, filePath)) {
          files.push(fileSummary(context, filePath));
        }
      }
    } else if (stat.isFile()) {
      files.push(fileSummary(context, resolved));
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function fileSummary(context, filePath) {
  return {
    path: toProjectPath(context, filePath),
    sha256: hashFile(filePath),
    size_bytes: fs.statSync(filePath).size,
  };
}

function readPackageScripts(context) {
  const packageJsonPath = path.join(context.root, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    return {};
  }
  try {
    const pkg = readJson(packageJsonPath);
    return normalizeObject(pkg.scripts);
  } catch {
    return {};
  }
}

function inferSourceRoots(context) {
  return ["src", "app", "pages", "lib", "bin", "server", "client"]
    .filter((entry) => fs.existsSync(path.join(context.root, entry)) && fs.statSync(path.join(context.root, entry)).isDirectory());
}

function inferTestRoots(context) {
  return ["test", "tests", "__tests__", "spec", "e2e"]
    .filter((entry) => fs.existsSync(path.join(context.root, entry)) && fs.statSync(path.join(context.root, entry)).isDirectory());
}

function buildInferredContext(repoSnapshot, detectedStack, documents) {
  return {
    stack_summary: detectedStack.map((item) => `${item.type}:${item.name}`),
    likely_entrypoints: repoSnapshot.key_files.map((item) => item.path),
    test_surface: Object.keys(repoSnapshot.package_scripts || {}).filter((script) => /test|check|lint|smoke/i.test(script)),
    imported_document_count: documents.length,
    confidence: detectedStack.length > 0 || documents.length > 0 ? 0.7 : 0.35,
    caveats: [
      "This is inferred from repository files and imported documents.",
      "Historical authorship, prior approvals, and rationale are unknown unless present in evidence files.",
    ],
  };
}

function renderBaselineReport(baseline) {
  return [
    `# ${baseline.id} Current State`,
    "",
    `Status: ${baseline.status}`,
    `Kind: ${baseline.kind}`,
    "",
    "## Summary",
    baseline.summary || "No summary provided.",
    "",
    "## Detected Stack",
    ...listOrNone((baseline.repository_snapshot?.detected_stack || []).map((item) => `${item.type}: ${item.name}${item.source_path ? ` (${item.source_path})` : ""}`)),
    "",
    "## Key Files",
    ...listOrNone((baseline.repository_snapshot?.key_files || []).map((item) => `${item.path} (${item.sha256})`)),
    "",
    "## Imported Documents",
    ...listOrNone((baseline.imported_documents || []).map((item) => `${item.path} (${item.sha256})`)),
    "",
    "## Open Questions",
    ...listOrNone(baseline.open_questions || []),
    "",
    "## Caveats",
    ...listOrNone(baseline.inferred_context?.caveats || []),
    "",
    "## Approval Guidance",
    "Approve this baseline only after the user confirms which inferred facts are canonical. Use bootstrap only for migration/provisional records.",
    "",
  ].join("\n");
}

function listOrNone(values) {
  return values.length ? values.map((value) => `- ${value}`) : ["- None"];
}

function validateBaselineSourceHashes(context, baseline, label, options = {}) {
  const issues = [];
  for (const [sourcePath, expectedHash] of Object.entries(baseline.source_hashes || {})) {
    const resolved = resolveProjectFilePath(context, sourcePath, { mustExist: false });
    if (isDerivedArtifactPath(context, resolved)) {
      issues.push(`${label} uses derived source ${sourcePath}`);
    } else if (!fs.existsSync(resolved)) {
      issues.push(`${label} source ${sourcePath} is missing`);
    } else if (fs.statSync(resolved).isFile() && hashFile(resolved) !== expectedHash) {
      issues.push(`${label} source ${sourcePath} changed after baseline proposal`);
    }
  }
  if (options.failOnStale && issues.length > 0) {
    fail(issues.join("; "));
  }
  if (options.collectOnly) {
    return issues;
  }
  return issues;
}

function capabilityProfilePath(context, id) {
  return path.join(capabilityProfilesRoot(context), `${normalizeId(id)}.json`);
}

function capabilityRecommendationPath(context, id) {
  return path.join(capabilityRecommendationsRoot(context), `${normalizeId(id)}.json`);
}

function readCapabilityProfile(context, id) {
  const profilePath = capabilityProfilePath(context, id);
  if (!fs.existsSync(profilePath)) {
    fail(`Capability profile ${id} does not exist`);
  }
  return readJson(profilePath);
}

function readCapabilityProfiles(context) {
  return safeReadDir(capabilityProfilesRoot(context))
    .filter((name) => name.endsWith(".json"))
    .map((name) => readJson(path.join(capabilityProfilesRoot(context), name)))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function readCapabilityRecommendations(context) {
  return safeReadDir(capabilityRecommendationsRoot(context))
    .filter((name) => name.endsWith(".json"))
    .map((name) => readJson(path.join(capabilityRecommendationsRoot(context), name)))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function loadOptionalJsonInput(context, options, inlineKey, fileKey, label) {
  const inline = getOptionString(options, inlineKey);
  const file = getOptionString(options, fileKey);
  if (inline && file) {
    fail(`Use only one of --${inlineKey} or --${fileKey}.`);
  }
  if (!inline && !file) {
    return {};
  }
  try {
    if (file) {
      const filePath = resolveProjectFilePath(context, file, { mustExist: true, fileOnly: true });
      assertNotDerivedArtifact(context, filePath, label);
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    }
    return JSON.parse(inline);
  } catch (error) {
    fail(`Invalid ${label} JSON: ${error.message}`);
  }
}

function normalizeCapabilitySubject(options, subject) {
  const requirementIds = mergeList(
    normalizeListValue(subject.requirement_ids || subject.requirements, []),
    normalizeListOption(options.requirement),
  ).map(normalizeId);
  return {
    story_id: options.story ? normalizeId(String(options.story)) : subject.story_id ? normalizeId(subject.story_id) : null,
    requirement_ids: requirementIds,
    phase: options.phase ? normalizeRoutePhase(options.phase) : subject.phase ? normalizeRoutePhase(subject.phase) : null,
    scope: String(options.scope || subject.scope || "project"),
  };
}

function normalizeCapabilityEvidence(evidence) {
  if (!Array.isArray(evidence)) {
    return [];
  }
  return evidence
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .map((item) => ({
      type: String(item.type || "evidence"),
      path: item.path ? String(item.path) : null,
      summary: item.summary ? String(item.summary) : null,
      sha256: item.sha256 ? String(item.sha256) : null,
    }));
}

function buildCapabilityEvidenceFromContextFiles(context, contextFiles) {
  return contextFiles.map((rawPath) => {
    const resolved = resolveProjectFilePath(context, rawPath, { mustExist: true, fileOnly: true });
    assertNotDerivedArtifact(context, resolved, "Capability context file");
    const content = fs.readFileSync(resolved);
    return {
      type: "context_file",
      path: toProjectPath(context, resolved),
      sha256: hashBuffer(content),
      size_bytes: content.length,
      excerpt: normalizeText(content.toString("utf8")).slice(0, 600),
    };
  });
}

function normalizeCapabilitySourcePaths(context, rawPaths) {
  const result = [];
  for (const rawPath of rawPaths) {
    if (!rawPath) {
      continue;
    }
    const resolved = resolveProjectFilePath(context, rawPath, { mustExist: false });
    assertNotDerivedArtifact(context, resolved, "Capability source path");
    result.push(toProjectPath(context, resolved));
  }
  return Array.from(new Set(result)).sort();
}

function buildSourceHashes(context, sourcePaths) {
  const hashes = {};
  for (const sourcePath of sourcePaths || []) {
    const resolved = resolveProjectFilePath(context, sourcePath, { mustExist: false });
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
      hashes[sourcePath] = hashFile(resolved);
    }
  }
  return hashes;
}

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeConfidence(value) {
  const confidence = Number(value);
  if (!Number.isFinite(confidence)) {
    fail("Capability confidence must be a number between 0 and 1");
  }
  return clamp01(confidence);
}

function normalizeCapabilityRecommendations(recommendations) {
  if (!Array.isArray(recommendations)) {
    fail("Capability recommendations must be an array");
  }
  return recommendations.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      fail(`Capability recommendation ${index + 1} must be a JSON object`);
    }
    const type = normalizeCapabilityItemType(item.type);
    const name = String(item.name || "").trim();
    if (!name) {
      fail(`Capability recommendation ${index + 1} is missing name`);
    }
    const availability = normalizeCapabilityAvailability(item.availability || item.status || "unknown");
    const installRequired = Boolean(item.install_required || availability === "install_required");
    return {
      type,
      name,
      availability: installRequired ? "install_required" : availability,
      purpose: item.purpose ? String(item.purpose) : null,
      rationale: item.rationale ? String(item.rationale) : null,
      risk: item.risk ? String(item.risk) : null,
      permissions: normalizeListValue(item.permissions, []),
      install_required: installRequired,
      install_approved: Boolean(item.install_approved),
      approval_required: item.approval_required !== undefined ? Boolean(item.approval_required) : installRequired,
    };
  });
}

function normalizeCapabilityItemType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!["skill", "mcp", "tool", "plugin", "connector", "model"].includes(normalized)) {
    fail(`Unknown capability recommendation type '${value}'`);
  }
  return normalized;
}

function normalizeCapabilityAvailability(value) {
  const normalized = String(value || "unknown").trim().toLowerCase();
  if (!CAPABILITY_RECOMMENDATION_AVAILABILITY.has(normalized)) {
    fail(`Unknown capability availability '${value}'`);
  }
  return normalized;
}

function buildDefaultCapabilityRecommendations(profile, availableCapabilities) {
  const availableSkills = new Set(normalizeAvailableCapabilityNames(availableCapabilities, "skills"));
  const recommendations = [
    {
      type: "skill",
      name: "agentic-sdlc",
      availability: availableSkills.has("agentic-sdlc") ? "available" : "unknown",
      purpose: "Govern the work through contracts, gates, traces, and shared project KB.",
      rationale: "Every SDLC step should be traceable and reusable across Codex chats.",
      install_required: false,
    },
  ];
  const hasNode = (profile.detected_stack || []).some((item) => ["node", "npm", "package-json"].includes(item.name) || item.type === "node");
  if (hasNode) {
    recommendations.push({
      type: "tool",
      name: "test-runner",
      availability: "available",
      purpose: "Run the repository's Node checks and tests.",
      rationale: "package.json is present and exposes the project test surface.",
      permissions: ["read", "execute"],
      install_required: false,
    });
  }
  return recommendations;
}

function normalizeAvailableCapabilityNames(availableCapabilities, key) {
  const value = availableCapabilities?.[key] || availableCapabilities?.[key.replace(/s$/, "")] || [];
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === "string" ? item : item?.name)).filter(Boolean);
  }
  if (value && typeof value === "object") {
    return normalizeListValue(value.installed || value.available || value.names, []);
  }
  return [];
}

function buildDefaultCapabilityPolicyPatch(recommendations) {
  const policy = buildCapabilityPolicy(null);
  for (const item of recommendations) {
    const group = item.install_required ? "required" : "allowed";
    if (item.type === "skill") {
      pushAllUnique(policy.skills[group], [item.name]);
    } else if (item.type === "mcp") {
      pushAllUnique(policy.mcp[group], [item.name]);
    } else if (item.type === "tool") {
      pushAllUnique(policy.tools[group], [item.name]);
    }
    if (item.approval_required) {
      pushAllUnique(policy.approval_required_for, [`${item.type}:${item.name}`]);
    }
  }
  return policy;
}

function detectProjectStack(context) {
  const detections = [];
  const add = (name, type, sourcePath, details = {}) => {
    detections.push({
      name,
      type,
      source_path: sourcePath,
      ...details,
    });
  };
  const has = (relativePath) => fs.existsSync(path.join(context.root, relativePath));
  if (has("package.json")) {
    const packageJsonPath = path.join(context.root, "package.json");
    add("package-json", "node", "package.json");
    try {
      const pkg = readJson(packageJsonPath);
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      for (const [dependency, type] of Object.entries({
        next: "web-framework",
        react: "frontend-library",
        vue: "frontend-framework",
        "@angular/core": "frontend-framework",
        svelte: "frontend-framework",
        vite: "build-tool",
        typescript: "language",
        jest: "test-runner",
        vitest: "test-runner",
        playwright: "browser-test-runner",
      })) {
        if (deps[dependency]) {
          add(dependency, type, "package.json", { version: deps[dependency] });
        }
      }
      if (pkg.scripts && Object.keys(pkg.scripts).length > 0) {
        add("npm-scripts", "automation", "package.json", { scripts: Object.keys(pkg.scripts).sort() });
      }
    } catch {
      add("package-json-unreadable", "warning", "package.json");
    }
  }
  for (const [relativePath, name, type] of [
    ["tsconfig.json", "typescript", "language"],
    ["next.config.js", "next", "web-framework"],
    ["next.config.mjs", "next", "web-framework"],
    ["vite.config.js", "vite", "build-tool"],
    ["vite.config.ts", "vite", "build-tool"],
    ["pyproject.toml", "python", "language"],
    ["requirements.txt", "python-requirements", "dependency-file"],
    ["Dockerfile", "docker", "container"],
    ["docker-compose.yml", "docker-compose", "container"],
    ["go.mod", "go", "language"],
    ["Cargo.toml", "rust", "language"],
    ["Package.swift", "swift-package", "language"],
    ["build.gradle", "gradle", "build-tool"],
    ["pom.xml", "maven", "build-tool"],
    ["terraform.tf", "terraform", "infrastructure"],
  ]) {
    if (has(relativePath)) {
      add(name, type, relativePath);
    }
  }
  return detections;
}

function findApprovedCapabilityProfiles(context, options = {}) {
  return readCapabilityProfiles(context).filter((profile) => {
    if (profile.status !== "approved" || !isApprovedRecordFresh(profile)) {
      return false;
    }
    if (options.storyId && profile.subject?.story_id && profile.subject.story_id !== options.storyId) {
      return false;
    }
    if (options.phase && profile.subject?.phase && profile.subject.phase !== options.phase) {
      return false;
    }
    return true;
  });
}

function capabilityRecordStatus(context, record, label) {
  const staleSources = validateCapabilityRecordSourceHashes(context, record, label, { collectOnly: true });
  return {
    id: record.id,
    status: record.status || "unknown",
    fresh: staleSources.length === 0 && (record.status !== "approved" || isApprovedRecordFresh(record)),
    stale_sources: staleSources,
    source_paths: record.source_paths || [],
  };
}

function validateCapabilityRecordSourceHashes(context, record, label, options = {}) {
  const issues = [];
  for (const [sourcePath, expectedHash] of Object.entries(record.source_hashes || {})) {
    const resolved = resolveProjectFilePath(context, sourcePath, { mustExist: false });
    if (isDerivedArtifactPath(context, resolved)) {
      issues.push(`${label} uses derived source ${sourcePath}`);
    } else if (!fs.existsSync(resolved)) {
      issues.push(`${label} source ${sourcePath} is missing`);
    } else if (hashFile(resolved) !== expectedHash) {
      issues.push(`${label} source ${sourcePath} changed after record creation`);
    }
  }
  if (options.failOnStale && issues.length > 0) {
    fail(issues.join("; "));
  }
  if (options.collectOnly) {
    return issues;
  }
  return issues;
}

function validateApprovedCapabilityProfileForUse(context, profile, label) {
  if (!profile || profile.status !== "approved" || !isApprovedRecordFresh(profile)) {
    fail(`${label} is not approved or its approval is stale`);
  }
  validateCapabilityRecordSourceHashes(context, profile, label, { failOnStale: true });
}

function validateApprovedCapabilityRecommendationForUse(context, recommendation, label) {
  if (!recommendation || recommendation.status !== "approved" || !isApprovedRecordFresh(recommendation)) {
    fail(`${label} is not approved or its approval is stale`);
  }
  validateCapabilityRecordSourceHashes(context, recommendation, label, { failOnStale: true });
  const profile = readCapabilityProfile(context, recommendation.profile_id);
  validateApprovedCapabilityProfileForUse(context, profile, `capability profile ${recommendation.profile_id}`);
  for (const item of recommendation.recommendations || []) {
    if (item.install_required && !item.install_approved) {
      fail(`${label} requires installation of ${item.type}:${item.name} without install approval`);
    }
  }
}

function workItemPath(context, type, id) {
  const directory = type === "epic" ? "epics" : type === "task" ? "tasks" : `${type}s`;
  return path.join(workItemsRoot(context), directory, `${id}.json`);
}

function breakdownPathById(context, id) {
  return path.join(workBreakdownRoot(context), `${id}.json`);
}

function dependencyProposalPath(context, id) {
  return path.join(dependenciesRoot(context), `${id}.json`);
}

function dependencyGraphPath(context) {
  return path.join(dependenciesRoot(context), "graph.json");
}

function normalizeWorkItemType(value, options = {}) {
  const normalized = String(value || "").trim().toLowerCase().replace(/\s+/g, "-");
  const allowed = options.allowStory ? WORK_ITEM_TYPES : WORK_ITEM_CREATE_TYPES;
  if (!allowed.has(normalized)) {
    fail(`Unknown work item type '${value}'. Valid values: ${Array.from(allowed).join(", ")}`);
  }
  return normalized;
}

function parseBreakdownItemRef(value) {
  const parts = String(value || "").split(":").map((part) => part.trim());
  if (parts.length !== 2 || parts.some((part) => !part)) {
    fail("Breakdown items must use --item type:id");
  }
  return {
    type: normalizeWorkItemType(parts[0], { allowStory: true }),
    id: normalizeId(parts[1]),
  };
}

function parseDependencyEdge(value) {
  const parts = String(value || "").split(":").map((part) => part.trim());
  if (parts.length !== 5 || parts.some((part) => !part)) {
    fail("Dependency edges must use --edge from:to:type:blocks:required_state");
  }
  const [from, to, type, blocks, requiredState] = parts;
  const normalizedType = String(type).trim().toLowerCase();
  const normalizedBlocks = String(blocks).trim().toLowerCase();
  if (!DEPENDENCY_TYPES.has(normalizedType)) {
    fail(`Unknown dependency type '${type}'. Valid values: ${Array.from(DEPENDENCY_TYPES).join(", ")}`);
  }
  if (!DEPENDENCY_BLOCK_SCOPES.has(normalizedBlocks)) {
    fail(`Unknown dependency blocking scope '${blocks}'. Valid values: ${Array.from(DEPENDENCY_BLOCK_SCOPES).join(", ")}`);
  }
  return {
    from: normalizeId(from),
    to: normalizeId(to),
    type: normalizedType,
    blocks: normalizedBlocks,
    required_state: String(requiredState).trim().toLowerCase(),
  };
}

function readEffectiveBreakdownPolicy(context) {
  const configured = context.config.work_breakdown_policy || {};
  const defaults = {
    levels: ["requirement", "epic", "story", "task"],
    default_flow: ["requirement", "story"],
    optional_levels: ["epic", "task"],
    delivery_unit: "story",
    claimable_units: ["story", "task"],
    strict_gate_unit: "story",
    task_gate: "light",
  };
  const policyPath = path.join(workBreakdownRoot(context), "project-policy.json");
  const projectPolicy = fs.existsSync(policyPath) ? readJson(policyPath).policy || {} : {};
  const policy = {
    ...defaults,
    ...configured,
    ...projectPolicy,
  };
  policy.levels = normalizeListValue(policy.levels, defaults.levels).map((item) => normalizeWorkItemType(item, { allowStory: true }));
  policy.default_flow = normalizeListValue(policy.default_flow, defaults.default_flow);
  policy.optional_levels = normalizeListValue(policy.optional_levels, defaults.optional_levels);
  policy.claimable_units = normalizeListValue(policy.claimable_units, defaults.claimable_units).map((item) => normalizeWorkItemType(item, { allowStory: true }));
  policy.delivery_unit = normalizeWorkItemType(policy.delivery_unit || defaults.delivery_unit, { allowStory: true });
  policy.strict_gate_unit = normalizeWorkItemType(policy.strict_gate_unit || defaults.strict_gate_unit, { allowStory: true });
  policy.task_gate = String(policy.task_gate || defaults.task_gate);
  return policy;
}

function normalizeListValue(value, fallback = []) {
  if (!Array.isArray(value)) {
    return [...fallback];
  }
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function readBreakdowns(context) {
  const root = workBreakdownRoot(context);
  return safeReadDir(root)
    .filter((name) => name.endsWith(".json") && name !== "project-policy.json")
    .map((name) => readJson(path.join(root, name)));
}

function latestApprovedRecordApproval(record) {
  return [...(record.approvals || [])]
    .filter((approval) => approval?.status === "approved")
    .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")))
    .at(-1);
}

function isApprovedRecordFresh(record) {
  const latest = latestApprovedRecordApproval(record);
  return Boolean(latest?.approved_content_hash && latest.approved_content_hash === hashApprovalSubject(record));
}

function requireHumanOrCiActor(attribution, action) {
  if (!["human", "ci"].includes(attribution.actor.type)) {
    fail(`${action} requires --actor-type human or an approved CI actor.`);
  }
}

function readDependencyGraph(context, options = {}) {
  const graphPath = dependencyGraphPath(context);
  if (!fs.existsSync(graphPath)) {
    if (!options.missingOk) {
      fail("Missing .sdlc/dependencies/graph.json. Run dependency approve first.");
    }
    return {
      schema_version: context.config.schema_version,
      status: "approved",
      edges: [],
      updated_at: null,
      audit: {},
    };
  }
  const graph = readJson(graphPath);
  graph.edges = Array.isArray(graph.edges) ? graph.edges : [];
  return graph;
}

function readDependencyProposals(context) {
  return safeReadDir(dependenciesRoot(context))
    .filter((name) => name.endsWith(".json") && name !== "graph.json")
    .map((name) => readJson(path.join(dependenciesRoot(context), name)))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function upsertDependencyEdge(graph, edge) {
  graph.edges = Array.isArray(graph.edges) ? graph.edges : [];
  const key = dependencyEdgeKey(edge);
  const index = graph.edges.findIndex((candidate) => dependencyEdgeKey(candidate) === key);
  if (index >= 0) {
    graph.edges[index] = edge;
  } else {
    graph.edges.push(edge);
  }
}

function dependencyEdgeKey(edge) {
  return [edge.from, edge.to, edge.type, edge.blocks].join("::");
}

function buildDependencyStatus(context, storyId = null) {
  const graph = readDependencyGraph(context, { missingOk: true });
  const edges = (graph.edges || []).filter((edge) => !storyId || edge.from === storyId || edge.to === storyId);
  const blockers = [];
  const warnings = [];
  for (const edge of edges) {
    if (storyId && edge.from !== storyId) {
      warnings.push(`${edge.from} depends on ${edge.to} via ${edge.type}`);
      continue;
    }
    const state = inspectDependencyEdge(context, edge);
    if (state.blocking && !state.satisfied) {
      blockers.push(state.message);
    } else if (!state.satisfied) {
      warnings.push(state.message);
    } else if (!isHardDependencyEdge(edge)) {
      warnings.push(state.message);
    }
  }
  const cycles = findBlockingDependencyCycles(graph.edges || []);
  for (const cycle of cycles) {
    blockers.push(`blocking dependency cycle: ${cycle.join(" -> ")}`);
  }
  return {
    graph_path: dependencyGraphPath(context),
    story_id: storyId,
    edges,
    blockers,
    warnings,
    cycles,
  };
}

function inspectDependencyEdge(context, edge, story = null) {
  const blocking = isHardDependencyEdge(edge) && shouldDependencyBlockStory(edge, story);
  const satisfied = isDependencySatisfied(context, edge);
  const message = `${edge.from} depends on ${edge.to} (${edge.type}, ${edge.blocks}, requires ${edge.required_state})`;
  if (!satisfied) {
    return { blocking, satisfied, message };
  }
  const stale = dependencyUpstreamArtifactChanged(context, edge);
  if (stale && !hasDependencyRevalidationTrace(context, edge.from, edge, stale.since)) {
    return {
      blocking: isHardDependencyEdge(edge),
      satisfied: false,
      message: `${edge.from} requires revalidation because upstream artifact ${stale.artifact_path} changed after linking`,
    };
  }
  return { blocking: false, satisfied: true, message };
}

function isHardDependencyEdge(edge) {
  return edge.blocks !== "none" && ["blocks", "requires_artifact", "requires_contract"].includes(edge.type);
}

function shouldDependencyBlockStory(edge, story) {
  if (!story || edge.blocks === "none") {
    return true;
  }
  return storyPhaseRank(story) >= phaseRank(edge.blocks);
}

function storyPhaseRank(story) {
  const value = String(story.phase || story.status || "").toLowerCase();
  return phaseRank(value);
}

function phaseRank(value) {
  const order = ["discovery", "analysis", "design", "implementation", "validation", "release"];
  if (["in_progress", "review"].includes(value)) {
    return order.indexOf("implementation");
  }
  if (value === "done") {
    return order.indexOf("release");
  }
  const index = order.indexOf(value);
  return index >= 0 ? index : order.indexOf("design");
}

function isDependencySatisfied(context, edge) {
  const upstream = readStory(context, edge.to);
  if (!upstream) {
    return false;
  }
  const state = String(edge.required_state || "").toLowerCase();
  if (edge.type === "requires_contract" || state === "contract_approved") {
    const contractState = inspectStoryContract(context, upstream);
    return contractState.exists && contractState.approved;
  }
  if (edge.type === "requires_artifact" || state === "artifact_linked") {
    return storyHasOutputLink(context, edge.to);
  }
  if (["exists", "none"].includes(state)) {
    return true;
  }
  if (state === "ready") {
    return ["ready", "implementation", "in_progress", "review", "validation", "release", "done"].includes(String(upstream.status));
  }
  if (state === "validated") {
    return ["validation", "release", "done"].includes(String(upstream.status)) || upstream.phase === "validation" || upstream.phase === "release";
  }
  if (state === "done") {
    return upstream.status === "done";
  }
  return upstream.status === state || upstream.phase === state;
}

function storyHasOutputLink(context, storyId) {
  const registry = readOutputRegistry(context, { missingOk: true });
  return (registry?.links || []).some((link) => link.story_id === storyId);
}

function dependencyUpstreamArtifactChanged(context, edge) {
  if (!["requires_artifact", "blocks"].includes(edge.type)) {
    return null;
  }
  const registry = readOutputRegistry(context, { missingOk: true });
  const links = (registry?.links || []).filter((link) => link.story_id === edge.to);
  for (const link of links) {
    if (!link.artifact_path || !link.fingerprints?.artifact_sha256) {
      continue;
    }
    const artifactPath = resolveProjectFilePath(context, link.artifact_path, { mustExist: false });
    if (fs.existsSync(artifactPath) && hashFile(artifactPath) !== link.fingerprints.artifact_sha256) {
      return {
        artifact_path: link.artifact_path,
        since: link.updated_at || link.created_at || null,
      };
    }
  }
  return null;
}

function hasDependencyRevalidationTrace(context, storyId, edge, since) {
  const sinceTime = since ? Date.parse(since) : 0;
  return readTraceEvents(context, storyId).some((event) => {
    const eventTime = Date.parse(String(event.created_at || ""));
    return (
      event.action === "dependency.revalidate" &&
      (!Number.isFinite(sinceTime) || !Number.isFinite(eventTime) || eventTime >= sinceTime) &&
      Array.isArray(event.related) &&
      event.related.includes(edge.to)
    );
  });
}

function findBlockingDependencyCycles(edges) {
  const graph = new Map();
  for (const edge of edges.filter(isHardDependencyEdge)) {
    if (!graph.has(edge.from)) {
      graph.set(edge.from, []);
    }
    graph.get(edge.from).push(edge.to);
  }
  const cycles = [];
  const visiting = new Set();
  const visited = new Set();
  const stack = [];
  function visit(node) {
    if (visiting.has(node)) {
      const start = stack.indexOf(node);
      cycles.push([...stack.slice(start), node]);
      return;
    }
    if (visited.has(node)) {
      return;
    }
    visiting.add(node);
    stack.push(node);
    for (const next of graph.get(node) || []) {
      visit(next);
    }
    stack.pop();
    visiting.delete(node);
    visited.add(node);
  }
  for (const node of graph.keys()) {
    visit(node);
  }
  return cycles;
}

function claimStory(context, options) {
  ensureInitialized(context);
  const id = normalizeId(requireOption(options, "id"));
  const agent = requireOption(options, "agent");
  const expiresAt = options["expires-at"] ? normalizeOptionalDateTime(options["expires-at"], "expires-at") : null;
  const storyDir = path.join(context.sdlcRoot, "stories", id);
  if (!fs.existsSync(path.join(storyDir, "story.json"))) {
    fail(`Story ${id} does not exist. Create it with 'story create' first.`);
  }

  const claimPath = path.join(storyDir, "claim.json");
  const releaseLock = acquireFileLock(path.join(storyDir, "claim.lock"));
  let claim;
  let attribution;
  try {
    const claimExists = fs.existsSync(claimPath);
    if (claimExists && !options.force) {
      const existing = readJson(claimPath);
      if (existing.status === "active") {
        fail(`Story ${id} already has an active claim by ${existing.agent}. Release it first or use --force after coordination.`);
      }
    }

    attribution = buildAttribution(context, options, "story.claim");
    claim = {
      story_id: id,
      agent: String(agent),
      branch: String(options.branch || `feature/${id}`),
      status: "active",
      claimed_at: now(),
      expires_at: expiresAt,
      notes: options.notes ? String(options.notes) : null,
      audit: {
        claimed_by: attribution.actor,
        git: attribution.git,
        run: attribution.run,
      },
    };
    writeJsonFile(claimPath, claim, { force: Boolean(options.force || claimExists) });
  } finally {
    releaseLock();
  }
  appendTraceEvent(context, id, {
    type: "claim",
    summary: `Story ${id} claimed by ${agent}`,
    action: "story.claim",
    actor: attribution.actor,
    evidence: [path.relative(context.root, claimPath)],
    related: [id],
    git: attribution.git,
    run: attribution.run,
  });
  output(options, { status: "claimed", claim_path: claimPath, claim }, [`Claimed story ${id} for ${agent}`]);
}

function releaseStoryClaim(context, options) {
  const result = releaseStoryClaimRecord(context, options);
  output(options, result, [`Released claim for story ${result.claim.story_id}`]);
}

function releaseStoryClaimRecord(context, options) {
  ensureInitialized(context);
  const id = normalizeId(requireOption(options, "id"));
  const storyDir = path.join(context.sdlcRoot, "stories", id);
  const claimPath = path.join(storyDir, "claim.json");
  if (!fs.existsSync(claimPath)) {
    fail(`Story ${id} has no claim to release`);
  }
  const claim = readJson(claimPath);
  const requestedAgent = options.agent ? String(options.agent) : null;
  if (requestedAgent && claim.agent !== requestedAgent && !options.force) {
    fail(`Story ${id} is claimed by ${claim.agent}, not ${requestedAgent}. Use --force only after coordination.`);
  }
  const attribution = buildAttribution(context, options, "story.release");
  claim.status = normalizeClaimStatus(options.status || "released");
  claim.released_at = now();
  claim.release_reason = options.reason ? String(options.reason) : null;
  claim.audit = {
    ...(claim.audit || {}),
    released_by: attribution.actor,
    git: attribution.git,
    run: attribution.run,
  };
  writeJsonFile(claimPath, claim, { force: true });
  appendTraceEvent(context, id, {
    type: "sync",
    summary: `Story ${id} claim ${claim.status}`,
    action: "story.release",
    actor: attribution.actor,
    evidence: [path.relative(context.root, claimPath)],
    related: [id],
    git: attribution.git,
    run: attribution.run,
  });
  return { status: "released", claim_path: claimPath, claim };
}

function createStoryHandoff(context, options) {
  const result = createStoryHandoffRecord(context, options);
  output(options, result, [`Created handoff ${result.handoff.id}`]);
}

function createStoryHandoffRecord(context, options) {
  ensureInitialized(context);
  const storyId = normalizeId(requireOption(options, "id"));
  const storyPath = path.join(context.sdlcRoot, "stories", storyId, "story.json");
  if (!fs.existsSync(storyPath)) {
    fail(`Story ${storyId} does not exist`);
  }
  const toAgent = requireOption(options, "to-agent");
  const attribution = buildAttribution(context, options, "story.handoff");
  const handoffId = normalizeId(String(options["handoff-id"] || `HND-${storyId}-${compactTimestamp()}`));
  const handoffPath = path.join(context.sdlcRoot, "handoffs", `${handoffId}.json`);
  const handoff = {
    id: handoffId,
    story_id: storyId,
    from_actor: attribution.actor,
    to_agent: String(toAgent),
    status: String(options.status || "open"),
    summary: options.summary ? String(options.summary) : null,
    required_artifacts: normalizeListOption(options.artifact),
    open_items: normalizeListOption(options["open-item"]),
    created_at: now(),
    audit: {
      created_by: attribution.actor,
      git: attribution.git,
      run: attribution.run,
    },
  };
  writeJsonFile(handoffPath, handoff, { force: Boolean(options.force) });
  appendTraceEvent(context, storyId, {
    type: "handoff",
    summary: handoff.summary || `Story ${storyId} handed off to ${toAgent}`,
    action: "story.handoff",
    actor: attribution.actor,
    evidence: [path.relative(context.root, handoffPath)],
    related: [storyId, handoffId],
    git: attribution.git,
    run: attribution.run,
  });
  return { status: "created", handoff_path: handoffPath, handoff };
}

function completeStoryStep(context, options) {
  ensureInitialized(context);
  const storyId = normalizeId(requireOption(options, "id"));
  const story = readStory(context, storyId);
  if (!story) {
    fail(`Story ${storyId} does not exist`);
  }
  assertReleaseClaimPrecondition(context, storyId, options);
  const step = normalizeStoryStep(requireOption(options, "step"));
  const summary = getOptionString(options, "summary") || null;
  const outputTypes = normalizeListOption(options.type).map(normalizeArtifactType);
  const artifactEvidence = buildCanonicalEvidence(context, normalizeListOption(options.artifact), "Story step artifact");
  const extraEvidence = buildCanonicalEvidence(context, normalizeListOption(options.evidence), "Story step evidence");
  if (!summary && outputTypes.length === 0 && artifactEvidence.length === 0 && extraEvidence.length === 0) {
    fail("Complete-step requires --summary, --type, --artifact, or --evidence.");
  }

  const registry = readOutputRegistry(context, { missingOk: true });
  const outputLinks = collectStoryOutputLinksForStep(context, registry, storyId, outputTypes);
  if (outputTypes.length > 0) {
    const linkedTypes = new Set(outputLinks.map((link) => link.artifact_type));
    for (const artifactType of outputTypes) {
      if (!linkedTypes.has(artifactType)) {
        fail(
          `Story ${storyId} has no linked ${artifactType} output. Run output resolve/link before completing this step.`,
        );
      }
    }
  }

  const attribution = buildAttribution(context, options, "story.complete-step");
  const stepDir = path.join(context.sdlcRoot, "stories", storyId, "steps");
  const stepPath = path.join(stepDir, `${step}.json`);
  const relativeStepPath = toProjectPath(context, stepPath);
  const record = {
    id: normalizeId(String(options["completion-id"] || `STEP-${storyId}-${step}-${compactTimestamp()}`)),
    story_id: storyId,
    step,
    status: "completed",
    phase: storyStepPhase(step),
    summary,
    output_types: outputTypes,
    output_links: outputLinks.map((link) => ({
      id: link.id,
      artifact_type: link.artifact_type,
      artifact_path: link.artifact_path,
      template_id: link.template_id,
      mode: link.mode,
      base_artifact: link.base_artifact || null,
      requirements: Array.isArray(link.requirements) ? link.requirements : [],
    })),
    artifacts: artifactEvidence,
    evidence: extraEvidence,
    next_step: options["next-step"] ? normalizeStoryStep(options["next-step"]) : defaultNextStoryStep(step),
    completed_at: now(),
    audit: {
      completed_by: attribution.actor,
      git: attribution.git,
      run: attribution.run,
    },
  };
  writeJsonFile(stepPath, record, { force: true });
  appendJsonLine(path.join(stepDir, "history.jsonl"), record);
  const traceEvent = appendTraceEvent(context, storyId, {
    type: "gate",
    summary: summary || `Completed ${step} for ${storyId}`,
    action: "story.complete-step",
    actor: attribution.actor,
    evidence: [
      relativeStepPath,
      ...record.artifacts.map((item) => item.path),
      ...record.evidence.map((item) => item.path),
      ...record.output_links.map((item) => item.artifact_path).filter(Boolean),
    ],
    related: [storyId, step, ...record.output_links.map((item) => item.id)],
    git: attribution.git,
    run: attribution.run,
  });

  const release = options["release-claim"]
    ? releaseStoryClaimRecord(context, {
        ...options,
        id: storyId,
        status: "released",
        reason: getOptionString(options, "reason") || `Completed ${step}; story prepared for handoff`,
      })
    : null;

  output(
    options,
    { status: "completed", step_path: stepPath, step: record, trace_event: traceEvent, release },
    [
      `Completed ${step} for story ${storyId}`,
      `Step record: ${relativeStepPath}`,
      release ? `Released claim for story ${storyId}` : null,
    ].filter(Boolean),
  );
}

function prepareStoryHandoff(context, options) {
  ensureInitialized(context);
  const storyId = normalizeId(requireOption(options, "id"));
  if (!readStory(context, storyId)) {
    fail(`Story ${storyId} does not exist`);
  }
  assertReleaseClaimPrecondition(context, storyId, options);
  requireOption(options, "to-agent");
  const handoffId = normalizeId(String(options["handoff-id"] || `HND-${storyId}-${compactTimestamp()}`));
  const packagePath = path.join(context.sdlcRoot, "stories", storyId, "handoffs", `${handoffId}-package.json`);
  const handoffPackage = buildStoryHandoffPackage(context, storyId, handoffId, options);
  writeJsonFile(packagePath, handoffPackage, { force: Boolean(options.force) });

  const existingArtifacts = normalizeListOption(options.artifact);
  const handoffOptions = {
    ...options,
    id: storyId,
    "handoff-id": handoffId,
    artifact: [...existingArtifacts, toProjectPath(context, packagePath)],
  };
  const handoff = createStoryHandoffRecord(context, handoffOptions);
  const release = options["release-claim"]
    ? releaseStoryClaimRecord(context, {
        ...options,
        id: storyId,
        status: "released",
        reason: getOptionString(options, "reason") || `Prepared handoff ${handoffId}`,
      })
    : null;

  output(
    options,
    {
      status: "prepared",
      handoff_id: handoffId,
      package_path: packagePath,
      package: handoffPackage,
      handoff: handoff.handoff,
      release,
    },
    [
      `Prepared handoff ${handoffId} for story ${storyId}`,
      `Handoff package: ${toProjectPath(context, packagePath)}`,
      release ? `Released claim for story ${storyId}` : null,
    ].filter(Boolean),
  );
}

function closeHandoff(context, options) {
  ensureInitialized(context);
  const handoffId = normalizeId(requireOption(options, "id"));
  const handoffPath = path.join(context.sdlcRoot, "handoffs", `${handoffId}.json`);
  if (!fs.existsSync(handoffPath)) {
    fail(`Handoff ${handoffId} does not exist`);
  }
  const handoff = readJson(handoffPath);
  const status = normalizeHandoffCloseStatus(options.status || "closed");
  const attribution = buildAttribution(context, options, "handoff.close");
  handoff.status = status;
  handoff.closed_at = now();
  handoff.close_summary = getOptionString(options, "summary") || null;
  handoff.open_items = normalizeListOption(options["open-item"]);
  handoff.audit = {
    ...(handoff.audit || {}),
    closed_by: attribution.actor,
    git: attribution.git,
    run: attribution.run,
  };
  writeJsonFile(handoffPath, handoff, { force: true });
  appendTraceEvent(context, handoff.story_id || null, {
    type: "handoff",
    summary: handoff.close_summary || `Handoff ${handoffId} ${status}`,
    action: "handoff.close",
    actor: attribution.actor,
    evidence: [path.relative(context.root, handoffPath)],
    related: [handoff.story_id, handoffId].filter(Boolean),
    git: attribution.git,
    run: attribution.run,
  });
  output(options, { status, handoff_path: handoffPath, handoff }, [`Handoff ${handoffId} ${status}`]);
}

function lockPhase(context, options) {
  ensureInitialized(context);
  const phase = String(requireOption(options, "phase"));
  if (!context.config.phases[phase]) {
    fail(`Unknown phase '${phase}'. Valid phases: ${Object.keys(context.config.phases).join(", ")}`);
  }
  const scope = String(options.scope || phase);
  const expiresAt = options["expires-at"] ? normalizeOptionalDateTime(options["expires-at"], "expires-at") : null;
  const lockMutexPath = path.join(context.sdlcRoot, "locks", `.phase-${shortHash(`${phase}:${scope}`)}.lock`);
  const releaseLock = acquireFileLock(lockMutexPath);
  let lock;
  let lockPath;
  let lockId;
  let attribution;
  try {
    const conflictingLock = readActiveLocks(context).find(
      (candidate) => candidate.phase === phase && String(candidate.scope || candidate.phase) === scope,
    );
    if (conflictingLock && !options.force) {
      fail(
        `Phase ${phase} scope ${scope} already has active lock ${conflictingLock.id}. Release it first or use --force after coordination.`,
      );
    }
    attribution = buildAttribution(context, options, "phase.lock");
    lockId = normalizeId(String(options.id || `LOCK-${phase}-${compactTimestamp()}`));
    lockPath = path.join(context.sdlcRoot, "locks", `${lockId}.json`);
    lock = {
      id: lockId,
      phase,
      scope,
      status: "active",
      reason: options.reason ? String(options.reason) : null,
      expires_at: expiresAt,
      created_at: now(),
      audit: {
        locked_by: attribution.actor,
        git: attribution.git,
        run: attribution.run,
      },
    };
    writeJsonFile(lockPath, lock, { force: Boolean(options.force) });
  } finally {
    releaseLock();
  }
  appendTraceEvent(context, null, {
    type: "lock",
    summary: `Phase ${phase} locked: ${lock.reason || lock.scope}`,
    action: "phase.lock",
    actor: attribution.actor,
    evidence: [path.relative(context.root, lockPath)],
    related: [phase, lockId],
    git: attribution.git,
    run: attribution.run,
  });
  output(options, { status: "locked", lock_path: lockPath, lock }, [`Locked phase ${phase} with ${lockId}`]);
}

function releasePhaseLock(context, options) {
  ensureInitialized(context);
  const id = normalizeId(requireOption(options, "id"));
  const lockPath = path.join(context.sdlcRoot, "locks", `${id}.json`);
  if (!fs.existsSync(lockPath)) {
    fail(`Phase lock ${id} does not exist`);
  }
  const lock = readJson(lockPath);
  const attribution = buildAttribution(context, options, "phase.release");
  lock.status = normalizeLockStatus(options.status || "released");
  lock.released_at = now();
  lock.release_reason = options.reason ? String(options.reason) : null;
  lock.audit = {
    ...(lock.audit || {}),
    released_by: attribution.actor,
    git: attribution.git,
    run: attribution.run,
  };
  writeJsonFile(lockPath, lock, { force: true });
  appendTraceEvent(context, null, {
    type: "lock",
    summary: `Phase lock ${id} ${lock.status}`,
    action: "phase.release",
    actor: attribution.actor,
    evidence: [path.relative(context.root, lockPath)],
    related: [lock.phase, id],
    git: attribution.git,
    run: attribution.run,
  });
  output(options, { status: lock.status, lock_path: lockPath, lock }, [`Released phase lock ${id}`]);
}

function appendTrace(context, options) {
  ensureInitialized(context);
  const type = String(requireOption(options, "type"));
  if (!TRACE_TYPES.has(type)) {
    fail(`Unknown trace type '${type}'. Valid types: ${Array.from(TRACE_TYPES).join(", ")}`);
  }
  const summary = requireOption(options, "summary");
  const storyId = options.story ? normalizeId(String(options.story)) : null;
  const traceFile = storyId ? `${storyId}.jsonl` : "project.jsonl";
  const tracePath = path.join(context.sdlcRoot, "traces", traceFile);
  const attribution = buildAttribution(context, options, `trace.${type}`);
  const gitEvent = options["git-event"] ? normalizeGitEvent(options["git-event"]) : null;
  const event = {
    id: `TR-${compactTimestamp()}-${crypto.randomBytes(3).toString("hex")}`,
    story_id: storyId,
    type,
    summary,
    actor: attribution.actor,
    action: normalizeScalarOption(options.action, "action") || type,
    evidence: normalizeListOption(options.evidence),
    related: normalizeListOption(options.related),
    git: {
      ...attribution.git,
      event: gitEvent,
    },
    run: attribution.run,
    created_at: now(),
  };
  appendJsonLine(tracePath, event);
  output(options, { status: "appended", trace_path: tracePath, event }, [`Appended ${type} trace ${event.id}`]);
}

function recordSyncEvent(context, options) {
  ensureInitialized(context);
  const event = normalizeGitEvent(requireOption(options, "event"));
  const storyId = options.story ? normalizeId(String(options.story)) : null;
  const attribution = buildAttribution(context, options, `sync.${event}`);
  const summary = options.summary ? String(options.summary) : `Recorded git ${event}`;
  const traceEvent = appendTraceEvent(context, storyId, {
    type: "sync",
    summary,
    action: `sync.${event}`,
    actor: attribution.actor,
    evidence: normalizeListOption(options.evidence),
    related: normalizeListOption(options.related),
    git: {
      ...attribution.git,
      event,
      remote: getOptionString(options, "remote") || null,
      upstream: execGit(context.root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]),
      before_sha: getOptionString(options, "before-sha") || null,
      after_sha: getOptionString(options, "after-sha") || attribution.git.head_sha,
      pr_url: getOptionString(options, "pr-url") || null,
    },
    run: attribution.run,
  });
  output(options, { status: "recorded", event: traceEvent }, [`Recorded sync ${event}`]);
}

function initializeDependencyGraph(context, options = {}) {
  ensurePlanningDirectories(context);
  const graphPath = dependencyGraphPath(context);
  if (fs.existsSync(graphPath) && !options.force) {
    return readJson(graphPath);
  }
  const attribution = options.attribution || buildAttribution(context, {}, "dependency.graph.init");
  const graph = {
    schema_version: context.config.schema_version,
    status: "approved",
    edges: [],
    updated_at: now(),
    audit: {
      created_by: attribution.actor,
      updated_by: attribution.actor,
      git: attribution.git,
      run: attribution.run,
    },
  };
  writeJsonFile(graphPath, graph, { force: true });
  return graph;
}

function initializeOutputContracts(context, options = {}) {
  const root = outputContractsRoot(context);
  ensureDir(root);
  ensureDir(path.join(root, "templates"));
  ensureDir(path.join(root, "decisions"));

  const registryPath = outputRegistryPath(context);
  if (fs.existsSync(registryPath) && !options.force) {
    return readJson(registryPath);
  }

  const project = readProjectSafe(context);
  const attribution = options.attribution || buildAttribution(context, {}, "output.registry.init");
  const registry = {
    schema_version: context.config.schema_version,
    project_id: options.project_id || project?.project_id || null,
    status: "active",
    policy: {
      template_registry_scope: "project",
      default_related_story_mode: "reuse+delta",
      approvals_required_for_new_templates: true,
      cache_is_source_of_truth: false,
    },
    templates: [],
    links: [],
    decisions: [],
    created_at: now(),
    updated_at: now(),
    audit: {
      created_by: attribution.actor,
      updated_by: attribution.actor,
      git: attribution.git,
      run: attribution.run,
    },
  };
  writeJsonFile(registryPath, registry, { force: Boolean(options.force) });
  return registry;
}

function proposeOutputTemplate(context, options) {
  ensureInitialized(context);
  return withOutputRegistryLock(context, () => {
  const artifactType = normalizeArtifactType(requireOption(options, "type"));
  const id = normalizeId(options.id || `${artifactType}-v1`);
  const registry = readOutputRegistry(context, { create: true, options, action: "output.template.propose" });
  if (findOutputTemplate(registry, id) && !options.force) {
    fail(`Output template ${id} already exists. Use --force to replace its proposal metadata.`);
  }

  const attribution = buildAttribution(context, options, "output.template.propose");
  const content = buildOutputTemplateContent(context, options, artifactType, id);
  const templatePath = path.join(outputContractsRoot(context), "templates", `${id}.md`);
  writeTextFile(templatePath, content.text, { force: Boolean(options.force) });

  const relativeTemplatePath = toProjectPath(context, templatePath);
  const templateRecord = {
    id,
    type: artifactType,
    status: "draft",
    path: relativeTemplatePath,
    summary: getOptionString(options, "summary") || null,
    source_paths: content.source_paths,
    proposed_at: now(),
    approved_at: null,
    approved_by: null,
    audit: {
      proposed_by: attribution.actor,
      git: attribution.git,
      run: attribution.run,
    },
  };

  upsertById(registry.templates, templateRecord);
  registry.updated_at = now();
  registry.audit = {
    ...(registry.audit || {}),
    updated_by: attribution.actor,
    git: attribution.git,
    run: attribution.run,
  };
  writeOutputRegistry(context, registry);
  appendTraceEvent(context, null, {
    type: "decision",
    summary: `Proposed output template ${id} for ${artifactType}`,
    action: "output.template.propose",
    actor: attribution.actor,
    evidence: [relativeTemplatePath, toProjectPath(context, outputRegistryPath(context))],
    related: [id, artifactType],
    git: attribution.git,
    run: attribution.run,
  });

  output(
    options,
    { status: "proposed", template_path: templatePath, template: templateRecord },
    [
      `Proposed output template ${id} for ${artifactType}`,
      `Approve it with: agentic-sdlc output template approve --id ${id} --actor-type human --approval-source explicit-user --summary "<user-approved template>"`,
    ],
  );
  });
}

function approveOutputTemplate(context, options) {
  ensureInitialized(context);
  return withOutputRegistryLock(context, () => {
  const id = normalizeId(requireOption(options, "id"));
  const registry = readOutputRegistry(context, { create: true, options, action: "output.template.approve" });
  const template = findOutputTemplate(registry, id);
  if (!template) {
    fail(`Output template ${id} does not exist`);
  }

  const attribution = buildAttribution(context, options, "output.template.approve");
  if (!["human", "ci"].includes(attribution.actor.type)) {
    fail("Output template approval requires --actor-type human or an approved CI actor.");
  }

  const decisionId = normalizeId(String(options["decision-id"] || `DEC-output-template-${id}-${compactTimestamp()}`));
  const templatePath = resolveProjectFilePath(context, template.path, { mustExist: true, fileOnly: true });
  assertNotDerivedArtifact(context, templatePath, "Output template");
  const approvedContentHash = hashFile(templatePath);
  const approvalEvidence = buildApprovalEvidence(context, options);
  const approvalSummary = getOptionString(options, "summary") || template.approval_summary || null;
  const approvalSource = normalizeApprovalSource(context, options, attribution, `output template ${id}`, "approved");
  validateApprovalSourceForActor(context, {
    source: approvalSource,
    status: "approved",
    summary: approvalSummary,
    evidence: approvalEvidence,
    actor: attribution.actor,
    label: `output template ${id}`,
  });
  template.status = "approved";
  template.approved_at = now();
  template.approved_by = attribution.actor;
  template.approval_summary = approvalSummary;
  template.approved_content_hash = approvedContentHash;
  template.hash_algorithm = "sha256:file:v1";
  template.approval_evidence = approvalEvidence;
  template.approval_source = approvalSource;
  template.explicit_user_confirmation = approvalSource === "explicit-user";
  template.provisional = approvalSource === "bootstrap";
  template.audit = {
    ...(template.audit || {}),
    approved_by: attribution.actor,
    git: attribution.git,
    run: attribution.run,
  };

  const decision = {
    id: decisionId,
    type: "template_approved",
    template_id: id,
    artifact_type: template.type,
    summary: template.approval_summary,
    status: "approved",
    evidence: template.approval_evidence,
    approval_source: approvalSource,
    explicit_user_confirmation: approvalSource === "explicit-user",
    provisional: approvalSource === "bootstrap",
    approved_content_hash: approvedContentHash,
    hash_algorithm: "sha256:file:v1",
    created_at: now(),
    audit: {
      decided_by: attribution.actor,
      git: attribution.git,
      run: attribution.run,
    },
  };
  upsertById(registry.decisions, decision);
  registry.updated_at = now();
  registry.audit = {
    ...(registry.audit || {}),
    updated_by: attribution.actor,
    git: attribution.git,
    run: attribution.run,
  };
  writeOutputRegistry(context, registry);
  appendTraceEvent(context, null, {
    type: "gate",
    summary: `Approved output template ${id}`,
    action: "output.template.approve",
    actor: attribution.actor,
    evidence: [template.path, toProjectPath(context, outputRegistryPath(context))],
    related: [id, decisionId],
    git: attribution.git,
    run: attribution.run,
  });

  output(options, { status: "approved", template, decision }, [`Approved output template ${id}`]);
  });
}

function resolveOutput(context, options) {
  ensureInitialized(context);
  const storyId = normalizeId(requireOption(options, "story"));
  const artifactType = normalizeArtifactType(requireOption(options, "type"));
  const explicitRequirements = normalizeListOption(options.requirement);
  const cacheStatus = getCacheStatus(context);
  const canonicalResolution = buildOutputResolution(context, storyId, artifactType, {
    requirements: explicitRequirements,
    cache_used: false,
  });
  let resolution = canonicalResolution;

  if (explicitRequirements.length === 0 && cacheStatus.valid && cacheStatus.cache?.output_resolutions) {
    const cachedResolution = cacheStatus.cache.output_resolutions[outputResolutionKey(storyId, artifactType)] || null;
    if (cachedResolution) {
      if (outputResolutionFingerprint(cachedResolution) !== outputResolutionFingerprint(canonicalResolution)) {
        fail("Local cache output resolution differs from canonical KB files. Run 'agentic-sdlc cache rebuild'.");
      }
      resolution = { ...canonicalResolution, cache_used: true };
    }
  }

  output(
    options,
    resolution,
    [
      `Output resolution for ${storyId}/${artifactType}: ${resolution.recommendation}`,
      resolution.template_id ? `Template: ${resolution.template_id}` : "Template: missing approved template",
      resolution.base_artifact ? `Base artifact: ${resolution.base_artifact}` : "Base artifact: none",
      resolution.next_action,
    ].filter(Boolean),
  );
}

function outputResolutionFingerprint(resolution) {
  const comparable = { ...resolution };
  delete comparable.cache_used;
  return stableJson(comparable);
}

function linkOutputArtifact(context, options) {
  ensureInitialized(context);
  const storyId = normalizeId(requireOption(options, "story"));
  const story = readStory(context, storyId);
  if (!story) {
    fail(`Story ${storyId} does not exist`);
  }
  return withOutputRegistryLock(context, () => {
  const artifactType = normalizeArtifactType(requireOption(options, "type"));
  const mode = normalizeOutputMode(requireOption(options, "mode"));
  const templateId = normalizeId(requireOption(options, "template"));
  const registry = readOutputRegistry(context, { create: true, options, action: "output.link" });
  const template = findOutputTemplate(registry, templateId);
  if (!template) {
    fail(`Output template ${templateId} does not exist`);
  }
  if (template.type !== artifactType) {
    fail(`Output template ${templateId} is for '${template.type}', not '${artifactType}'`);
  }
  if (template.status !== "approved") {
    fail(`Output template ${templateId} is '${template.status}'. Approve it before linking output artifacts.`);
  }

  const artifactPath = resolveProjectFilePath(context, requireOption(options, "artifact"), {
    mustExist: true,
    fileOnly: true,
  });
  assertNotDerivedArtifact(context, artifactPath, "Output artifact");

  const baseArtifact = options["base-artifact"]
    ? resolveProjectFilePath(context, options["base-artifact"], { mustExist: true, fileOnly: true })
    : null;
  if (mode === "delta" && !baseArtifact) {
    fail("Mode 'delta' requires --base-artifact.");
  }
  if (baseArtifact) {
    assertNotDerivedArtifact(context, baseArtifact, "Base artifact");
  }

  const requirements = normalizeListOption(options.requirement);
  const storyRequirements = Array.isArray(story.links?.requirements) ? story.links.requirements : [];
  const linkedRequirements = requirements.length > 0 ? requirements : storyRequirements;
  const relativeArtifactPath = toProjectPath(context, artifactPath);
  const relativeBaseArtifact = baseArtifact ? toProjectPath(context, baseArtifact) : null;
  const attribution = buildAttribution(context, options, "output.link");
  const decisionId = getOptionString(options, "decision-id");
  const existingDecision = decisionId
    ? (registry.decisions || []).find((decision) => decision.id === normalizeId(decisionId))
    : null;
  if (existingDecision && !hasApprovedOutputDecision(registry.decisions || [], decisionId)) {
    fail(`Decision ${decisionId} already exists but is not an approved output override decision.`);
  }
  if (decisionId && !hasApprovedOutputDecision(registry.decisions || [], decisionId)) {
    if (!["human", "ci"].includes(attribution.actor.type)) {
      fail("Creating an output override decision requires --actor-type human or an approved CI actor.");
    }
    const decisionEvidence = buildApprovalEvidence(context, options);
    const decisionSummary = getOptionString(options, "rationale") || `Approved output override for ${storyId}/${artifactType}`;
    const approvalSource = normalizeApprovalSource(context, options, attribution, `output override ${decisionId}`, "approved");
    validateApprovalSourceForActor(context, {
      source: approvalSource,
      status: "approved",
      summary: decisionSummary,
      evidence: decisionEvidence,
      actor: attribution.actor,
      label: `output override ${decisionId}`,
    });
    const decisionSubject = buildOutputLinkDecisionSubject({
      story_id: storyId,
      artifact_type: artifactType,
      artifact_path: relativeArtifactPath,
      template_id: templateId,
      mode,
      base_artifact: relativeBaseArtifact,
      requirements: linkedRequirements,
      rationale: getOptionString(options, "rationale") || null,
    });
    const decision = {
      id: normalizeId(decisionId),
      type: "output_link_override",
      story_id: storyId,
      artifact_type: artifactType,
      status: "approved",
      summary: decisionSummary,
      subject: decisionSubject,
      evidence: decisionEvidence,
      approval_source: approvalSource,
      explicit_user_confirmation: approvalSource === "explicit-user",
      provisional: approvalSource === "bootstrap",
      approved_content_hash: hashApprovalSubject(decisionSubject),
      hash_algorithm: "sha256:stable-json:v1",
      created_at: now(),
      audit: {
        decided_by: attribution.actor,
        git: attribution.git,
        run: attribution.run,
      },
    };
    upsertById(registry.decisions, decision);
  }
  const id = normalizeId(
    options.id || `OUT-${storyId}-${artifactType}-${shortHash(`${relativeArtifactPath}:${mode}`)}`,
  );
  const existing = registry.links.find((link) => link.id === id);
  const link = {
    id,
    story_id: storyId,
    artifact_type: artifactType,
    artifact_path: relativeArtifactPath,
    template_id: templateId,
    mode,
    base_artifact: relativeBaseArtifact,
    requirements: linkedRequirements,
    decision_id: decisionId ? normalizeId(decisionId) : null,
    rationale: getOptionString(options, "rationale") || null,
    source_paths: [relativeArtifactPath, relativeBaseArtifact, template.path].filter(Boolean),
    fingerprints: {
      artifact_sha256: hashFile(artifactPath),
      base_artifact_sha256: baseArtifact ? hashFile(baseArtifact) : null,
      template_sha256: template.path
        ? hashFile(resolveProjectFilePath(context, template.path, { mustExist: true, fileOnly: true }))
        : null,
      hash_algorithm: "sha256:file:v1",
    },
    created_at: existing?.created_at || now(),
    updated_at: now(),
    audit: {
      ...(existing?.audit || {}),
      linked_by: attribution.actor,
      git: attribution.git,
      run: attribution.run,
    },
  };

  const duplicateHints = findRelatedOutputLinks(registry, link).filter((related) => related.id !== id);
  if (mode === "new" && duplicateHints.length > 0 && !outputLinkHasMatchingApprovedDecision(registry.decisions || [], link)) {
    const related = duplicateHints.map((item) => `${item.story_id}:${item.artifact_path}`).join(", ");
    fail(
      `Output ${storyId}/${artifactType} duplicates requirements already covered by ${related}. Use --mode delta/reuse or pass an approved --decision-id.`,
    );
  }

  upsertById(registry.links, link);
  registry.updated_at = now();
  registry.audit = {
    ...(registry.audit || {}),
    updated_by: attribution.actor,
    git: attribution.git,
    run: attribution.run,
  };
  writeOutputRegistry(context, registry);
  appendTraceEvent(context, storyId, {
    type: "decision",
    summary: `Linked ${artifactType} output ${relativeArtifactPath} as ${mode}`,
    action: "output.link",
    actor: attribution.actor,
    evidence: [relativeArtifactPath, toProjectPath(context, outputRegistryPath(context))],
    related: [storyId, artifactType, templateId, id],
    git: attribution.git,
    run: attribution.run,
  });

  output(
    options,
    { status: "linked", link, related_outputs: duplicateHints },
    [
      `Linked ${artifactType} output for ${storyId} as ${mode}`,
      duplicateHints.length > 0
        ? `Related outputs found: ${duplicateHints.map((item) => `${item.story_id}:${item.artifact_path}`).join(", ")}`
        : "No related outputs found",
    ],
  );
  });
}

function showOutputStatus(context, options) {
  ensureInitialized(context);
  const storyId = normalizeId(requireOption(options, "story"));
  if (!readStory(context, storyId)) {
    fail(`Story ${storyId} does not exist`);
  }
  const registry = readOutputRegistry(context, { missingOk: true });
  const types = outputStatusTypes(context, registry, options);
  const links = registry ? registry.links.filter((link) => link.story_id === storyId) : [];
  const resolutions = types.map((type) => buildOutputResolution(context, storyId, type, { registry }));

  output(
    options,
    { story_id: storyId, links, resolutions },
    [
      `Output status for ${storyId}`,
      ...links.map((link) => `${link.artifact_type}: ${link.mode} ${link.artifact_path} (${link.template_id})`),
      ...resolutions.map((resolution) => `${resolution.artifact_type}: ${resolution.recommendation}`),
    ],
  );
}

function rebuildCache(context, options) {
  ensureInitialized(context);
  const cache = buildCache(context);
  const cachePath = path.join(context.sdlcRoot, "cache", CACHE_FILE_NAME);
  writeJsonFile(cachePath, cache, { force: true });
  output(
    options,
    { status: "rebuilt", cache_path: cachePath, entries: cache.full_text_index.length },
    [`Rebuilt local SDLC cache with ${cache.full_text_index.length} indexed entries`],
  );
}

function showCacheStatus(context, options) {
  ensureInitialized(context);
  const status = getCacheStatus(context);
  output(
    options,
    status,
    [
      status.exists ? `Cache: ${status.valid ? "valid" : "stale"}` : "Cache: missing",
      `Path: ${status.cache_path}`,
      `Changed: ${status.changed.length}`,
      `Missing: ${status.missing.length}`,
      `Added: ${status.added.length}`,
      status.valid ? "No rebuild required" : "Run: agentic-sdlc cache rebuild",
    ],
  );
}

function clearCache(context, options) {
  ensureInitialized(context);
  const cacheRoot = path.join(context.sdlcRoot, "cache");
  fs.rmSync(cacheRoot, { recursive: true, force: true });
  ensureDir(cacheRoot);
  output(options, { status: "cleared", cache_root: cacheRoot }, [`Cleared local SDLC cache at ${cacheRoot}`]);
}

function reportActivity(context, options) {
  ensureInitialized(context);
  const report = buildActivityReport(context, options);
  if (options.out) {
    writeActivityReport(context, report, options);
  }
  output(
    options,
    report,
    [
      `Activity report (${report.view})`,
      `Window: ${report.window.since} -> ${report.window.until}`,
      `Events: ${report.summary.event_count}`,
      ...report.items.map((item) => `- ${item.created_at || "unknown"} ${item.story_id || "project"} ${item.action}: ${item.summary}`),
      report.items.length === 0 ? "- No canonical trace events in this window" : null,
    ].filter(Boolean),
  );
}

function reportQuery(context, options) {
  ensureInitialized(context);
  const queryLoad = loadReportQuery(context, options);
  if (!queryLoad.query) {
    const guidance = buildReportQueryNormalizationGuidance(options, queryLoad);
    output(options, guidance, [
      "Report query needs canonical normalization.",
      "Pass --query-json or --query-file with a report query object.",
      "Raw natural language is recorded only as context and is not keyword-matched by the CLI.",
    ]);
    return;
  }
  const report = buildReportQueryResult(context, queryLoad.query, options);
  if (options.out) {
    writeReportQueryResult(context, report, options);
  }
  output(
    options,
    report,
    [
      `Report query: ${report.status}`,
      `Matched: ${report.summary.result_count}`,
      ...report.results.map((item) => `- ${item.created_at || item.updated_at || "unknown"} ${item.kind} ${item.id}: ${item.summary}`),
      report.results.length === 0 ? "- No canonical KB records matched this query" : null,
    ].filter(Boolean),
  );
}

function loadReportQuery(context, options = {}) {
  const json = getOptionString(options, "query-json");
  const file = getOptionString(options, "query-file");
  if (json && file) {
    fail("Use either --query-json or --query-file, not both.");
  }
  if (json) {
    return { source: "query-json", query: loadOptionalJsonInput(context, options, "query-json", "query-file", "Report query") };
  }
  if (file) {
    const queryPath = resolveProjectFilePath(context, file, { mustExist: true, fileOnly: true });
    assertNotDerivedArtifact(context, queryPath, "Report query file");
    return { source: toProjectPath(context, queryPath), query: readJson(queryPath) };
  }
  return { source: "missing", query: null, raw_text: getOptionString(options, "text", "query") || null };
}

function buildReportQueryNormalizationGuidance(options, queryLoad) {
  return {
    kind: "report_query_normalization",
    status: "needs_normalization",
    schema_version: "report-query:v1",
    raw_text: queryLoad.raw_text,
    rule: "Codex or another LLM must normalize natural language into canonical query JSON. The CLI never keyword-matches raw user language.",
    required_shape: {
      intent: "find_records",
      confidence: 0.0,
      subjects: ["activity"],
      time: { since: "10d", until: "now", field: "created_at" },
      filters: {
        actor: ["actor-id-or-email"],
        story_id: ["ST-001"],
        artifact_type: ["functional-analysis"],
        event_type: ["decision"],
        action: ["story.create"],
        phase: ["analysis"],
        status: ["draft"],
        requirement: ["REQ-001"],
        text: ["search term"],
      },
      sort: "created_at_desc",
      limit: 50,
    },
    examples: [
      {
        natural_language: "tutte le modifiche fatte da me",
        query: {
          intent: "find_changes",
          confidence: 0.9,
          subjects: ["activity", "stories", "outputs", "contracts", "approvals"],
          filters: { actor: ["<current-user-id-or-email>"] },
          sort: "created_at_desc",
        },
      },
      {
        natural_language: "tutte le storie funzionali nuove degli ultimi 10 giorni",
        query: {
          intent: "find_new_functional_stories",
          confidence: 0.9,
          subjects: ["stories"],
          time: { since: "10d", until: "now", field: "created_at" },
          filters: { artifact_type: ["functional-analysis"], text: ["functional"] },
          sort: "created_at_desc",
        },
      },
    ],
  };
}

function buildReportQueryResult(context, rawQuery, options = {}) {
  const query = normalizeReportQuery(rawQuery, options);
  const allRecords = collectReportQueryRecords(context);
  const filtered = allRecords
    .filter((record) => reportQuerySubjectMatches(record, query))
    .filter((record) => reportQueryTimeMatches(record, query))
    .filter((record) => reportQueryFiltersMatch(record, query))
    .sort((left, right) => compareReportQueryRecords(left, right, query.sort))
    .slice(0, query.limit)
    .map(formatReportQueryRecord);
  const sourcePaths = Array.from(
    new Set(filtered.flatMap((record) => (record.sources || []).map((source) => source.path).filter(Boolean))),
  ).sort();
  return {
    kind: "report_query_result",
    status: "matched",
    schema_version: context.config.schema_version,
    generated_at: now(),
    query,
    summary: {
      result_count: filtered.length,
      by_kind: countBy(filtered, "kind"),
      by_actor: countBy(filtered, (record) => traceActorKey(record.actor)),
      by_story: countBy(filtered, (record) => record.story_id || "project"),
    },
    results: filtered,
    source_paths: sourcePaths,
    source_hashes: buildSourceHashMap(context, sourcePaths),
    source_policy: "Query results cite canonical .sdlc files. Cache and indexes are never query evidence.",
  };
}

function normalizeReportQuery(rawQuery, options = {}) {
  if (!rawQuery || typeof rawQuery !== "object" || Array.isArray(rawQuery)) {
    fail("Report query must be a JSON object.");
  }
  const subjects = normalizeStringArray(rawQuery.subjects || rawQuery.subject || ["activity"]).map((subject) =>
    String(subject).trim().toLowerCase(),
  );
  if (subjects.length === 0) {
    fail("Report query subjects cannot be empty.");
  }
  for (const subject of subjects) {
    if (!REPORT_QUERY_SUBJECTS.has(subject)) {
      fail(`Unknown report query subject '${subject}'. Valid subjects: ${Array.from(REPORT_QUERY_SUBJECTS).join(", ")}`);
    }
  }
  const time = rawQuery.time && typeof rawQuery.time === "object" && !Array.isArray(rawQuery.time) ? rawQuery.time : {};
  const filters = rawQuery.filters && typeof rawQuery.filters === "object" && !Array.isArray(rawQuery.filters) ? rawQuery.filters : {};
  const limit = Number(rawQuery.limit || options.limit || 50);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    fail("Report query limit must be an integer between 1 and 500.");
  }
  const sort = String(rawQuery.sort || "created_at_desc");
  if (!["created_at_desc", "created_at_asc", "updated_at_desc", "updated_at_asc", "kind_asc"].includes(sort)) {
    fail("Report query sort must be created_at_desc, created_at_asc, updated_at_desc, updated_at_asc, or kind_asc.");
  }
  return {
    intent: String(rawQuery.intent || "find_records"),
    confidence: rawQuery.confidence === undefined ? null : Number(rawQuery.confidence),
    subjects,
    time: {
      since: time.since || options.since || null,
      until: time.until || options.until || null,
      field: String(time.field || "created_at"),
    },
    filters: normalizeReportQueryFilters(filters),
    sort,
    limit,
  };
}

function normalizeReportQueryFilters(filters) {
  return {
    actor: normalizeStringArray(filters.actor),
    story_id: normalizeStringArray(filters.story_id || filters.story),
    requirement: normalizeStringArray(filters.requirement || filters.requirements),
    artifact_type: normalizeStringArray(filters.artifact_type || filters.output_type),
    event_type: normalizeStringArray(filters.event_type || filters.type),
    action: normalizeStringArray(filters.action),
    phase: normalizeStringArray(filters.phase),
    status: normalizeStringArray(filters.status),
    kind: normalizeStringArray(filters.kind),
    path: normalizeStringArray(filters.path),
    text: normalizeStringArray(filters.text || filters.contains),
  };
}

function collectReportQueryRecords(context) {
  const registry = readOutputRegistry(context, { missingOk: true });
  return [
    ...collectTraceQueryRecords(context),
    ...collectStoryQueryRecords(context, registry),
    ...collectStoryStepQueryRecords(context),
    ...collectOutputQueryRecords(context, registry),
    ...collectContractQueryRecords(context),
    ...collectHandoffQueryRecords(context),
    ...collectWorkItemQueryRecords(context),
    ...collectApprovalQueryRecords(context),
    ...collectTestQueryRecords(context),
  ];
}

function collectTraceQueryRecords(context) {
  return readAllTraceEvents(context)
    .filter((event) => event.type !== "invalid")
    .map((event) => ({
      kind: "activity",
      id: event.id || `${event.source?.path}:${event.source?.line}`,
      summary: event.summary || event.action || event.type,
      created_at: event.created_at || null,
      updated_at: event.created_at || null,
      actor: event.actor || null,
      action: event.action || event.type || null,
      event_type: event.type || null,
      story_id: event.story_id || null,
      artifact_type: inferArtifactTypeFromTrace(event),
      requirements: [],
      phase: null,
      status: null,
      text: stableJson(event),
      sources: [event.source].filter(Boolean),
      raw: event,
    }));
}

function collectStoryQueryRecords(context, registry = null) {
  return readAllStories(context).map((story) => {
    const storyOutputTypes = (registry?.links || [])
      .filter((link) => link.story_id === story.id && link.artifact_type)
      .map((link) => link.artifact_type);
    return {
      kind: "stories",
      id: story.id,
      summary: story.title || story.id,
      created_at: story.created_at || null,
      updated_at: story.updated_at || story.created_at || null,
      actor: story.audit?.created_by || story.audit?.updated_by || null,
      action: "story.create",
      event_type: "story",
      story_id: story.id,
      artifact_type: storyOutputTypes[0] || inferStoryArtifactType(story),
      artifact_types: storyOutputTypes,
      requirements: Array.isArray(story.links?.requirements) ? story.links.requirements : [],
      phase: story.phase || null,
      status: story.status || null,
      text: stableJson(story),
      sources: [{ path: `.sdlc/stories/${story.id}/story.json`, line: 1 }],
      raw: story,
    };
  });
}

function collectStoryStepQueryRecords(context) {
  const records = [];
  for (const story of readAllStories(context)) {
    for (const step of readStoryStepRecords(context, story.id)) {
      records.push({
        kind: "story_steps",
        id: step.id || `${story.id}:${step.step}`,
        summary: step.summary || `${story.id} ${step.step} completed`,
        created_at: step.completed_at || null,
        updated_at: step.completed_at || null,
        actor: step.audit?.completed_by || null,
        action: "story.complete-step",
        event_type: "gate",
        story_id: story.id,
        artifact_type: Array.isArray(step.output_types) ? step.output_types[0] || null : null,
        artifact_types: Array.isArray(step.output_types) ? step.output_types : [],
        requirements: Array.isArray(story.links?.requirements) ? story.links.requirements : [],
        phase: step.phase || story.phase || null,
        status: step.status || null,
        text: stableJson(step),
        sources: [{ path: `.sdlc/stories/${story.id}/steps/${step.step}.json`, line: 1 }],
        raw: step,
      });
    }
  }
  return records;
}

function collectOutputQueryRecords(context, registry = null) {
  const registrySource = fs.existsSync(outputRegistryPath(context)) ? [{ path: toProjectPath(context, outputRegistryPath(context)), line: 1 }] : [];
  const templateRecords = (registry?.templates || []).map((template) => ({
    kind: "outputs",
    id: template.id,
    summary: `Output template ${template.id} for ${template.type}`,
    created_at: template.proposed_at || template.created_at || null,
    updated_at: template.approved_at || template.proposed_at || null,
    actor: template.audit?.approved_by || template.audit?.proposed_by || template.approved_by || null,
    action: template.status === "approved" ? "output.template.approve" : "output.template.propose",
    event_type: "decision",
    story_id: null,
    artifact_type: template.type || null,
    requirements: [],
    phase: null,
    status: template.status || null,
    text: stableJson(template),
    sources: registrySource,
    raw: template,
  }));
  const linkRecords = (registry?.links || []).map((link) => ({
    kind: "outputs",
    id: link.id,
    summary: `${link.artifact_type} output ${link.artifact_path} linked as ${link.mode}`,
    created_at: link.created_at || null,
    updated_at: link.updated_at || link.created_at || null,
    actor: link.audit?.linked_by || null,
    action: "output.link",
    event_type: "decision",
    story_id: link.story_id || null,
    artifact_type: link.artifact_type || null,
    requirements: Array.isArray(link.requirements) ? link.requirements : [],
    phase: null,
    status: link.mode || null,
    text: stableJson(link),
    sources: registrySource,
    raw: link,
  }));
  return [...templateRecords, ...linkRecords];
}

function collectContractQueryRecords(context) {
  return collectJsonFiles(context, path.join(context.sdlcRoot, "contracts")).map((contract) => ({
    kind: "contracts",
    id: contract.id || path.basename(contract.__path, ".json"),
    summary: `${contract.phase || "unknown"} contract ${contract.id || path.basename(contract.__path, ".json")}`,
    created_at: contract.created_at || null,
    updated_at: contract.updated_at || contract.created_at || null,
    actor: contract.audit?.created_by || contract.audit?.updated_by || null,
    action: "contract.create",
    event_type: "contract",
    story_id: contract.story_id || null,
    artifact_type: Array.isArray(contract.output_contract_refs) ? contract.output_contract_refs[0]?.artifact_type || null : null,
    artifact_types: Array.isArray(contract.output_contract_refs) ? contract.output_contract_refs.map((ref) => ref.artifact_type).filter(Boolean) : [],
    requirements: [],
    phase: contract.phase || null,
    status: contract.status || null,
    text: stableJson(contract),
    sources: [{ path: contract.__relative_path, line: 1 }],
    raw: contract,
  }));
}

function collectHandoffQueryRecords(context) {
  return readHandoffs(context).map((handoff) => ({
    kind: "handoffs",
    id: handoff.id,
    summary: handoff.summary || `Handoff ${handoff.id} to ${handoff.to_agent}`,
    created_at: handoff.created_at || null,
    updated_at: handoff.closed_at || handoff.created_at || null,
    actor: handoff.from_actor || handoff.audit?.created_by || null,
    action: handoff.closed_at ? "handoff.close" : "story.handoff",
    event_type: "handoff",
    story_id: handoff.story_id || null,
    artifact_type: null,
    requirements: [],
    phase: null,
    status: handoff.status || null,
    text: stableJson(handoff),
    sources: [{ path: `.sdlc/handoffs/${handoff.id}.json`, line: 1 }],
    raw: handoff,
  }));
}

function collectWorkItemQueryRecords(context) {
  const roots = [path.join(workItemsRoot(context), "epics"), path.join(workItemsRoot(context), "tasks")];
  return roots.flatMap((root) =>
    collectJsonFiles(context, root).map((item) => ({
      kind: "work_items",
      id: item.id || path.basename(item.__path, ".json"),
      summary: item.title || item.summary || item.id || path.basename(item.__path, ".json"),
      created_at: item.created_at || null,
      updated_at: item.updated_at || item.created_at || null,
      actor: item.audit?.created_by || item.audit?.updated_by || null,
      action: "work.item.create",
      event_type: "work_item",
      story_id: item.story_id || item.story || null,
      artifact_type: null,
      requirements: item.requirement_id ? [item.requirement_id] : normalizeStringArray(item.requirements),
      phase: null,
      status: item.status || null,
      text: stableJson(item),
      sources: [{ path: item.__relative_path, line: 1 }],
      raw: item,
    })),
  );
}

function collectApprovalQueryRecords(context) {
  return collectApprovalManifestEntries(context).map((approval) => ({
    kind: "approvals",
    id: approval.approval_id || `${approval.subject_id}:approval`,
    summary: `${approval.subject_id} approval ${approval.status || "unknown"}`,
    created_at: approval.created_at || null,
    updated_at: approval.created_at || null,
    actor: approval.actor || null,
    action: "approve",
    event_type: "gate",
    story_id: null,
    artifact_type: null,
    requirements: [],
    phase: null,
    status: approval.status || null,
    text: stableJson(approval),
    sources: [{ path: approval.subject_path, line: 1 }],
    raw: approval,
  }));
}

function collectTestQueryRecords(context) {
  return collectJsonFiles(context, path.join(context.sdlcRoot, "tests")).map((testRecord) => ({
    kind: "tests",
    id: testRecord.id || path.basename(testRecord.__path, ".json"),
    summary: testRecord.summary || testRecord.id || path.basename(testRecord.__path, ".json"),
    created_at: testRecord.created_at || null,
    updated_at: testRecord.updated_at || testRecord.created_at || null,
    actor: testRecord.audit?.created_by || testRecord.audit?.updated_by || null,
    action: "test.evidence",
    event_type: "test",
    story_id: testRecord.story_id || null,
    artifact_type: null,
    requirements: normalizeStringArray(testRecord.requirements),
    phase: "validation",
    status: testRecord.status || null,
    text: stableJson(testRecord),
    sources: [{ path: testRecord.__relative_path, line: 1 }],
    raw: testRecord,
  }));
}

function inferArtifactTypeFromTrace(event) {
  if (event.action === "output.link" && Array.isArray(event.related)) {
    return event.related.find((item) => String(item).includes("-analysis") || String(item).includes("summary")) || null;
  }
  return null;
}

function inferStoryArtifactType(story) {
  const text = stableJson(story).toLowerCase();
  if (text.includes("functional-analysis") || text.includes("functional")) {
    return "functional-analysis";
  }
  if (text.includes("technical-analysis") || text.includes("technical")) {
    return "technical-analysis";
  }
  return null;
}

function reportQuerySubjectMatches(record, query) {
  return query.subjects.includes("all") || query.subjects.includes(record.kind);
}

function reportQueryTimeMatches(record, query) {
  if (!query.time.since && !query.time.until) {
    return true;
  }
  const fields = query.time.field === "updated_at" ? ["updated_at"] : query.time.field === "any" ? ["created_at", "updated_at"] : ["created_at"];
  const timestamps = fields.map((field) => Date.parse(String(record[field] || ""))).filter(Number.isFinite);
  if (timestamps.length === 0) {
    return false;
  }
  const since = query.time.since ? parseDateBoundary(query.time.since, "query.time.since") : null;
  const until = query.time.until ? parseDateBoundary(query.time.until, "query.time.until", { defaultNow: true }) : null;
  return timestamps.some((timestamp) => (!since || timestamp >= since.getTime()) && (!until || timestamp <= until.getTime()));
}

function reportQueryFiltersMatch(record, query) {
  const filters = query.filters;
  return (
    listFilterMatches(filters.kind, record.kind) &&
    actorFilterMatches(filters.actor, record.actor) &&
    listFilterMatches(filters.story_id, record.story_id) &&
    listFilterOverlaps(filters.requirement, record.requirements || []) &&
    listFilterOverlaps(filters.artifact_type, [record.artifact_type, ...(record.artifact_types || [])].filter(Boolean)) &&
    listFilterMatches(filters.event_type, record.event_type) &&
    listFilterMatches(filters.action, record.action) &&
    listFilterMatches(filters.phase, record.phase) &&
    listFilterMatches(filters.status, record.status) &&
    listFilterOverlaps(filters.path, (record.sources || []).map((source) => source.path)) &&
    textFilterMatches(filters.text, record.text)
  );
}

function actorFilterMatches(filters, actor) {
  if (!filters.length) {
    return true;
  }
  return filters.some((filter) => traceActorMatches(actor, filter));
}

function listFilterMatches(filters, value) {
  if (!filters.length) {
    return true;
  }
  return filters.map(normalizeQueryToken).includes(normalizeQueryToken(value));
}

function listFilterOverlaps(filters, values) {
  if (!filters.length) {
    return true;
  }
  const normalizedValues = new Set((Array.isArray(values) ? values : [values]).map(normalizeQueryToken));
  return filters.some((filter) => normalizedValues.has(normalizeQueryToken(filter)));
}

function textFilterMatches(filters, text) {
  if (!filters.length) {
    return true;
  }
  const normalized = normalizeText(text).toLowerCase();
  return filters.every((filter) => normalizeText(filter).toLowerCase().split(" ").filter(Boolean).every((term) => normalized.includes(term)));
}

function normalizeQueryToken(value) {
  return String(value || "").trim().toLowerCase();
}

function compareReportQueryRecords(left, right, sort) {
  if (sort === "kind_asc") {
    return `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`);
  }
  const field = sort.startsWith("updated_at") ? "updated_at" : "created_at";
  const direction = sort.endsWith("_asc") ? 1 : -1;
  return direction * String(left[field] || "").localeCompare(String(right[field] || ""));
}

function formatReportQueryRecord(record) {
  return {
    kind: record.kind,
    id: record.id,
    summary: record.summary,
    created_at: record.created_at,
    updated_at: record.updated_at,
    actor: record.actor,
    action: record.action,
    event_type: record.event_type,
    story_id: record.story_id,
    artifact_type: record.artifact_type,
    artifact_types: record.artifact_types || [],
    requirements: record.requirements || [],
    phase: record.phase,
    status: record.status,
    sources: record.sources || [],
  };
}

function countBy(items, keyOrFn) {
  const result = {};
  for (const item of items) {
    const key = typeof keyOrFn === "function" ? keyOrFn(item) : item[keyOrFn];
    result[key || "unknown"] = (result[key || "unknown"] || 0) + 1;
  }
  return result;
}

function writeReportQueryResult(context, report, options) {
  const reportPath = resolveProjectFilePath(context, options.out, { mustExist: false });
  assertNotDerivedArtifact(context, reportPath, "Report query result");
  if (path.extname(reportPath).toLowerCase() === ".md") {
    writeTextFile(reportPath, renderReportQueryMarkdown(report), { force: Boolean(options.force) });
    return;
  }
  writeJsonFile(reportPath, report, { force: Boolean(options.force) });
}

function renderReportQueryMarkdown(report) {
  return [
    "# SDLC Query Report",
    "",
    `- Intent: ${report.query.intent}`,
    `- Subjects: ${report.query.subjects.join(", ")}`,
    `- Results: ${report.summary.result_count}`,
    "",
    "## Results",
    ...(report.results.length
      ? report.results.map((item) => {
          const source = item.sources?.[0] ? ` (${item.sources[0].path}:${item.sources[0].line})` : "";
          return `- ${item.created_at || item.updated_at || "unknown"} ${item.kind} ${item.id}: ${item.summary}${source}`;
        })
      : ["- No canonical KB records matched this query"]),
    "",
    "## Sources",
    ...(report.source_paths.length ? report.source_paths.map((sourcePath) => `- ${sourcePath}`) : ["- None"]),
    "",
  ].join("\n");
}

function buildActivityReport(context, options = {}) {
  const view = normalizeActivityReportView(options.view || "business");
  const untilDate = parseDateBoundary(options.until || "now", "until", { defaultNow: true });
  const sinceDate = parseDateBoundary(options.since || "3d", "since", { relativeTo: untilDate });
  if (sinceDate.getTime() > untilDate.getTime()) {
    fail("--since must be before --until");
  }
  const storyFilter = options.story ? normalizeId(options.story) : null;
  const actorFilter = getOptionString(options, "actor") || null;
  const allEvents = readAllTraceEvents(context, { story: storyFilter });
  const filteredEvents = allEvents
    .filter((event) => event.type !== "invalid")
    .filter((event) => isEventInsideWindow(event, sinceDate, untilDate))
    .filter((event) => !actorFilter || traceActorMatches(event.actor, actorFilter))
    .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
  const items = filteredEvents.map((event) => formatActivityEventForView(event, view));
  const summary = summarizeActivityEvents(filteredEvents);
  const sourcePaths = Array.from(new Set(filteredEvents.map((event) => event.source?.path).filter(Boolean))).sort();
  return {
    kind: "activity_report",
    schema_version: context.config.schema_version,
    generated_at: now(),
    view,
    window: {
      since: sinceDate.toISOString(),
      until: untilDate.toISOString(),
    },
    filters: {
      story_id: storyFilter,
      actor: actorFilter,
    },
    summary,
    items,
    parse_errors: allEvents.filter((event) => event.type === "invalid").map((event) => event.source),
    source_paths: sourcePaths,
    source_hashes: buildSourceHashMap(context, sourcePaths),
    source_policy: "Only canonical .sdlc trace files are summarized; cache and indexes are not cited as evidence.",
  };
}

function normalizeActivityReportView(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!ACTIVITY_REPORT_VIEWS.has(normalized)) {
    fail(`Unknown activity report view '${value}'. Valid values: ${Array.from(ACTIVITY_REPORT_VIEWS).join(", ")}`);
  }
  return normalized;
}

function readAllTraceEvents(context, options = {}) {
  const tracesRoot = path.join(context.sdlcRoot, "traces");
  const storyFilter = options.story ? normalizeId(options.story) : null;
  const files = walkFiles(tracesRoot)
    .filter((filePath) => filePath.endsWith(".jsonl"))
    .filter((filePath) => !storyFilter || path.basename(filePath) === `${storyFilter}.jsonl`);
  const events = [];
  for (const filePath of files) {
    const sourcePath = toProjectPath(context, filePath);
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!line.trim()) {
        return;
      }
      try {
        const event = JSON.parse(line);
        events.push({
          ...event,
          story_id: event.story_id || inferStoryIdFromTraceFile(filePath),
          source: { path: sourcePath, line: index + 1 },
        });
      } catch (error) {
        events.push({
          type: "invalid",
          summary: error.message,
          source: { path: sourcePath, line: index + 1 },
        });
      }
    });
  }
  return events;
}

function inferStoryIdFromTraceFile(filePath) {
  const base = path.basename(filePath, ".jsonl");
  return base === "project" ? null : base;
}

function isEventInsideWindow(event, sinceDate, untilDate) {
  const timestamp = Date.parse(String(event.created_at || ""));
  return Number.isFinite(timestamp) && timestamp >= sinceDate.getTime() && timestamp <= untilDate.getTime();
}

function traceActorMatches(actor, filter) {
  if (!filter) {
    return true;
  }
  if (typeof actor === "string") {
    return actor === filter;
  }
  return [actor?.id, actor?.name, actor?.email, actor?.type].filter(Boolean).some((value) => String(value) === filter);
}

function formatActivityEventForView(event, view) {
  const base = {
    created_at: event.created_at || null,
    story_id: event.story_id || null,
    type: event.type || null,
    action: event.action || event.type || null,
    summary: event.summary || null,
    actor: event.actor || null,
    sources: [event.source].filter(Boolean),
  };
  if (view === "business") {
    return {
      ...base,
      impact: businessImpactForTrace(event),
      evidence_count: Array.isArray(event.evidence) ? event.evidence.length : 0,
      related: Array.isArray(event.related) ? event.related : [],
    };
  }
  if (view === "dev") {
    return {
      ...base,
      evidence: Array.isArray(event.evidence) ? event.evidence : [],
      related: Array.isArray(event.related) ? event.related : [],
      git: {
        branch: event.git?.branch || null,
        head_sha: event.git?.head_sha || null,
        event: event.git?.event || null,
        remote: event.git?.remote || null,
        after_sha: event.git?.after_sha || null,
      },
    };
  }
  return {
    ...base,
    evidence: Array.isArray(event.evidence) ? event.evidence : [],
    related: Array.isArray(event.related) ? event.related : [],
    git: event.git || null,
    run: event.run || null,
    raw: event,
  };
}

function businessImpactForTrace(event) {
  const action = String(event.action || event.type || "");
  if (event.type === "decision" || action.includes("approve")) {
    return "decision";
  }
  if (event.type === "test" || action.includes("validation")) {
    return "validation";
  }
  if (event.type === "release") {
    return "release";
  }
  if (event.type === "risk") {
    return "risk";
  }
  if (event.type === "handoff") {
    return "handoff";
  }
  if (event.type === "implementation") {
    return "implementation";
  }
  return "activity";
}

function summarizeActivityEvents(events) {
  const byType = {};
  const byAction = {};
  const byStory = {};
  const byActor = {};
  for (const event of events) {
    incrementCounter(byType, event.type || "unknown");
    incrementCounter(byAction, event.action || event.type || "unknown");
    incrementCounter(byStory, event.story_id || "project");
    incrementCounter(byActor, traceActorKey(event.actor));
  }
  return {
    event_count: events.length,
    story_count: Object.keys(byStory).filter((storyId) => storyId !== "project").length,
    by_type: byType,
    by_action: byAction,
    by_story: byStory,
    by_actor: byActor,
    first_event_at: events[0]?.created_at || null,
    last_event_at: events.at(-1)?.created_at || null,
  };
}

function incrementCounter(target, key) {
  target[key] = (target[key] || 0) + 1;
}

function traceActorKey(actor) {
  if (typeof actor === "string") {
    return actor || "unknown";
  }
  return actor?.id || actor?.name || actor?.type || "unknown";
}

function parseDateBoundary(value, label, options = {}) {
  const raw = String(value || "").trim();
  if (raw === "now") {
    return options.defaultNow || !options.relativeTo ? new Date() : new Date(options.relativeTo);
  }
  const relative = raw.match(/^(\d+)([dhm])$/i);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2].toLowerCase();
    const millis = unit === "d" ? amount * 86400000 : unit === "h" ? amount * 3600000 : amount * 60000;
    const base = options.relativeTo ? new Date(options.relativeTo) : new Date();
    return new Date(base.getTime() - millis);
  }
  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp)) {
    fail(`Invalid --${label} '${value}'. Use ISO date/time, now, or a relative duration like 3d, 12h, 30m.`);
  }
  return new Date(timestamp);
}

function writeActivityReport(context, report, options) {
  const reportPath = resolveProjectFilePath(context, options.out, { mustExist: false });
  assertNotDerivedArtifact(context, reportPath, "Activity report");
  if (path.extname(reportPath).toLowerCase() === ".md") {
    writeTextFile(reportPath, renderActivityReportMarkdown(report), { force: Boolean(options.force) });
    return;
  }
  writeJsonFile(reportPath, report, { force: Boolean(options.force) });
}

function renderActivityReportMarkdown(report) {
  return [
    "# SDLC Activity Report",
    "",
    `- View: ${report.view}`,
    `- Window: ${report.window.since} -> ${report.window.until}`,
    `- Events: ${report.summary.event_count}`,
    `- Stories: ${report.summary.story_count}`,
    "",
    "## Summary",
    ...Object.entries(report.summary.by_type).map(([type, count]) => `- ${type}: ${count}`),
    "",
    "## Activity",
    ...(report.items.length
      ? report.items.map((item) => {
          const source = item.sources?.[0] ? ` (${item.sources[0].path}:${item.sources[0].line})` : "";
          return `- ${item.created_at || "unknown"} ${item.story_id || "project"} ${item.action}: ${item.summary}${source}`;
        })
      : ["- No canonical trace events in this window"]),
    "",
    "## Sources",
    ...(report.source_paths.length ? report.source_paths.map((sourcePath) => `- ${sourcePath}`) : ["- None"]),
    "",
  ].join("\n");
}

function rebuildManifests(context, options) {
  ensureInitialized(context);
  const manifest = buildKnowledgeManifest(context, options);
  const manifestPath = path.join(context.sdlcRoot, "manifests", "kb-manifest.json");
  writeJsonFile(manifestPath, manifest, { force: true });
  output(
    options,
    { status: "rebuilt", manifest_path: manifestPath, manifest },
    [
      `Rebuilt KB manifest: ${toProjectPath(context, manifestPath)}`,
      `Stories: ${manifest.summary.stories}`,
      `Trace events: ${manifest.summary.trace_events}`,
      `Approvals: ${manifest.summary.approvals}`,
    ],
  );
}

function buildKnowledgeManifest(context, options = {}) {
  const generatedAt = now();
  const sourceFiles = collectManifestSourceFiles(context);
  const sourcePaths = sourceFiles.map((filePath) => toProjectPath(context, filePath)).sort();
  const stories = readAllStories(context);
  const registry = readOutputRegistry(context, { missingOk: true });
  const traceEvents = readAllTraceEvents(context).filter((event) => event.type !== "invalid");
  const approvals = collectApprovalManifestEntries(context);
  const contracts = collectJsonFiles(context, path.join(context.sdlcRoot, "contracts")).map((contract) => ({
    id: contract.id || path.basename(contract.__path, ".json"),
    phase: contract.phase || null,
    story_id: contract.story_id || null,
    status: contract.status || null,
    path: contract.__relative_path,
  }));
  return {
    kind: "kb_manifest",
    schema_version: context.config.schema_version,
    generated_at: generatedAt,
    canonical_root: SDLC_DIR,
    summary: {
      stories: stories.length,
      contracts: contracts.length,
      output_templates: registry?.templates?.length || 0,
      output_links: registry?.links?.length || 0,
      trace_events: traceEvents.length,
      approvals: approvals.length,
      source_files: sourcePaths.length,
    },
    stories: stories.map((story) => {
      const claimPath = path.join(context.sdlcRoot, "stories", story.id, "claim.json");
      const claim = fs.existsSync(claimPath) ? readJson(claimPath) : null;
      return {
        id: story.id,
        title: story.title,
        status: story.status,
        phase: story.phase,
        contract_id: story.contract_id || null,
        requirements: Array.isArray(story.links?.requirements) ? story.links.requirements : [],
        active_claim: claim?.status === "active" ? { agent: claim.agent, branch: claim.branch, expires_at: claim.expires_at || null } : null,
        completed_steps: readStoryStepRecords(context, story.id).map((record) => ({
          step: record.step,
          completed_at: record.completed_at,
          output_types: record.output_types || [],
        })),
        output_links: (registry?.links || [])
          .filter((link) => link.story_id === story.id)
          .map((link) => ({
            id: link.id,
            artifact_type: link.artifact_type,
            artifact_path: link.artifact_path,
            mode: link.mode,
            template_id: link.template_id,
          })),
        last_trace: readLastTraceEvent(context, story.id),
      };
    }),
    contracts,
    output_contracts: {
      templates: (registry?.templates || []).map((template) => ({
        id: template.id,
        type: template.type,
        status: template.status,
        path: template.path,
        approved_at: template.approved_at || null,
      })),
      links: (registry?.links || []).map((link) => ({
        id: link.id,
        story_id: link.story_id,
        artifact_type: link.artifact_type,
        artifact_path: link.artifact_path,
        template_id: link.template_id,
        mode: link.mode,
        requirements: link.requirements || [],
      })),
    },
    activity: summarizeActivityEvents(traceEvents),
    approvals,
    source_paths: sourcePaths,
    source_hashes: buildSourceHashMap(context, sourcePaths),
    audit: {
      generated_by: buildAttribution(context, options, "manifest.rebuild").actor,
      git: buildGitMetadata(context.root),
      run: buildRunMetadata(options),
    },
  };
}

function collectManifestSourceFiles(context) {
  return collectKnowledgeSourceFiles(context).filter((filePath) => {
    const relative = path.relative(context.sdlcRoot, filePath);
    return !relative.startsWith(`manifests${path.sep}`);
  });
}

function collectJsonFiles(context, root) {
  return walkFiles(root)
    .filter((filePath) => filePath.endsWith(".json"))
    .map((filePath) => {
      const data = readJson(filePath);
      data.__path = filePath;
      data.__relative_path = toProjectPath(context, filePath);
      return data;
    });
}

function collectApprovalManifestEntries(context) {
  const entries = [];
  for (const filePath of collectManifestSourceFiles(context).filter((candidate) => candidate.endsWith(".json"))) {
    let data;
    try {
      data = readJson(filePath);
    } catch {
      continue;
    }
    const relativePath = toProjectPath(context, filePath);
    for (const approval of data.approvals || []) {
      entries.push({
        subject_id: data.id || data.project_id || path.basename(filePath, ".json"),
        subject_path: relativePath,
        approval_id: approval.id || null,
        status: approval.status || null,
        approval_source: approval.approval_source || null,
        actor: approval.approved_by || approval.actor || null,
        created_at: approval.created_at || approval.approved_at || null,
      });
    }
    if (data.approval_source || data.approved_by || data.approved_at) {
      entries.push({
        subject_id: data.id || path.basename(filePath, ".json"),
        subject_path: relativePath,
        approval_id: data.id || null,
        status: data.status || null,
        approval_source: data.approval_source || null,
        actor: data.approved_by || data.audit?.decided_by || null,
        created_at: data.approved_at || data.created_at || null,
      });
    }
  }
  return entries.sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
}

function compactTraces(context, options) {
  ensureInitialized(context);
  const storyId = options.story ? normalizeId(options.story) : null;
  const beforeDate = options.before ? parseDateBoundary(options.before, "before") : null;
  const events = readAllTraceEvents(context, { story: storyId })
    .filter((event) => event.type !== "invalid")
    .filter((event) => !beforeDate || Date.parse(String(event.created_at || "")) < beforeDate.getTime())
    .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")));
  const sourcePaths = Array.from(new Set(events.map((event) => event.source?.path).filter(Boolean))).sort();
  const id = normalizeId(`CMP-${storyId || "project"}-${compactTimestamp()}`);
  const compaction = {
    id,
    kind: "trace_compaction",
    schema_version: context.config.schema_version,
    story_id: storyId,
    generated_at: now(),
    cutoff_before: beforeDate ? beforeDate.toISOString() : null,
    canonical_source_retained: true,
    event_count: events.length,
    summary: summarizeActivityEvents(events),
    timeline: events.slice(-100).map((event) => ({
      id: event.id || null,
      created_at: event.created_at || null,
      story_id: event.story_id || null,
      type: event.type || null,
      action: event.action || null,
      summary: event.summary || null,
      actor: event.actor || null,
      sources: [event.source].filter(Boolean),
    })),
    source_paths: sourcePaths,
    source_hashes: buildSourceHashMap(context, sourcePaths),
    audit: {
      generated_by: buildAttribution(context, options, "trace.compact").actor,
      git: buildGitMetadata(context.root),
      run: buildRunMetadata(options),
    },
  };
  const outputPath = options.out
    ? resolveProjectFilePath(context, options.out, { mustExist: false })
    : path.join(context.sdlcRoot, "traces", "compactions", `${id}.json`);
  assertNotDerivedArtifact(context, outputPath, "Trace compaction");
  writeJsonFile(outputPath, compaction, { force: Boolean(options.force) });
  appendTraceEvent(context, storyId, {
    type: "decision",
    summary: `Compacted ${events.length} trace events into ${toProjectPath(context, outputPath)}`,
    action: "trace.compact",
    actor: compaction.audit.generated_by,
    evidence: [toProjectPath(context, outputPath)],
    related: [id, storyId].filter(Boolean),
    git: compaction.audit.git,
    run: compaction.audit.run,
  });
  output(
    options,
    { status: "compacted", compaction_path: outputPath, compaction },
    [`Compacted ${events.length} trace events into ${toProjectPath(context, outputPath)}`],
  );
}

function archiveClosedArtifacts(context, options) {
  ensureInitialized(context);
  const beforeDate = parseDateBoundary(options.before || "90d", "before");
  const candidates = collectArchiveCandidates(context, beforeDate);
  const planId = normalizeId(`ARCH-${compactTimestamp()}`);
  const plan = {
    id: planId,
    kind: "archive_plan",
    schema_version: context.config.schema_version,
    generated_at: now(),
    cutoff_before: beforeDate.toISOString(),
    apply_requested: Boolean(options.apply),
    applied: false,
    candidates,
    source_paths: candidates.map((candidate) => candidate.source_path),
    source_hashes: buildSourceHashMap(context, candidates.map((candidate) => candidate.source_path)),
    policy: "Only closed reports and trace compactions are eligible; live story, contract, trace JSONL, and approval files are not moved.",
    audit: {
      generated_by: buildAttribution(context, options, "archive.closed").actor,
      git: buildGitMetadata(context.root),
      run: buildRunMetadata(options),
    },
  };
  if (options.apply) {
    for (const candidate of candidates) {
      const sourcePath = resolveProjectFilePath(context, candidate.source_path, { mustExist: true, fileOnly: true });
      const targetPath = resolveProjectFilePath(context, candidate.target_path, { mustExist: false });
      if (fs.existsSync(targetPath) && !options.force) {
        fail(`Archive target already exists: ${candidate.target_path}. Use --force to overwrite after review.`);
      }
      ensureDir(path.dirname(targetPath));
      fs.renameSync(sourcePath, targetPath);
      candidate.applied = true;
    }
    plan.applied = true;
  }
  const planPath = options.out
    ? resolveProjectFilePath(context, options.out, { mustExist: false })
    : path.join(context.sdlcRoot, "archive", `${planId}.json`);
  assertNotDerivedArtifact(context, planPath, "Archive plan");
  writeJsonFile(planPath, plan, { force: Boolean(options.force) });
  output(
    options,
    { status: plan.applied ? "archived" : "planned", plan_path: planPath, plan },
    [
      `${plan.applied ? "Archived" : "Planned archive for"} ${candidates.length} closed artifacts`,
      `Archive plan: ${toProjectPath(context, planPath)}`,
    ],
  );
}

function collectArchiveCandidates(context, beforeDate) {
  const eligibleRoots = [
    { root: path.join(context.sdlcRoot, "reports"), reason: "closed-report" },
    { root: path.join(context.sdlcRoot, "traces", "compactions"), reason: "trace-compaction" },
  ];
  const candidates = [];
  for (const entry of eligibleRoots) {
    for (const filePath of walkFiles(entry.root)) {
      if (!shouldIndexFile(context, filePath)) {
        continue;
      }
      const stat = fs.statSync(filePath);
      if (stat.mtime.getTime() >= beforeDate.getTime()) {
        continue;
      }
      const relativeSource = toProjectPath(context, filePath);
      const archiveRelative = path.posix.join(
        SDLC_DIR,
        "archive",
        String(stat.mtime.getUTCFullYear()),
        String(stat.mtime.getUTCMonth() + 1).padStart(2, "0"),
        path.relative(context.sdlcRoot, filePath).split(path.sep).join("/"),
      );
      candidates.push({
        source_path: relativeSource,
        target_path: archiveRelative,
        reason: entry.reason,
        size_bytes: stat.size,
        mtime: stat.mtime.toISOString(),
        sha256: hashFile(filePath),
        applied: false,
      });
    }
  }
  return candidates.sort((a, b) => a.source_path.localeCompare(b.source_path));
}

function buildOutputTemplateContent(context, options, artifactType, id) {
  const from = getOptionString(options, "from");
  if (from) {
    const sourcePath = resolveProjectFilePath(context, from, { mustExist: true, fileOnly: true });
    assertNotDerivedArtifact(context, sourcePath, "Template source");
    return {
      text: fs.readFileSync(sourcePath, "utf8"),
      source_paths: [toProjectPath(context, sourcePath)],
    };
  }

  const body = getOptionString(options, "body");
  if (body) {
    return {
      text: `${body.trim()}\n`,
      source_paths: [],
    };
  }

  const summary = getOptionString(options, "summary") || `Project-approved structure for ${artifactType} outputs.`;
  return {
    text: [
      `# ${id}`,
      "",
      "## Purpose",
      summary,
      "",
      "## Context",
      "- Linked story",
      "- Linked requirement or source artifact",
      "- Reused base artifact when this output is a delta",
      "",
      "## Output",
      "- Canonical content agreed with the user",
      "- Explicit delta from the base artifact when applicable",
      "",
      "## Validation",
      "- Acceptance criteria or gate evidence",
      "- Open questions and follow-up decisions",
      "",
    ].join("\n"),
    source_paths: [],
  };
}

function buildOutputResolution(context, storyId, artifactType, options = {}) {
  const story = readStory(context, storyId);
  if (!story) {
    fail(`Story ${storyId} does not exist`);
  }
  const registry = options.registry || readOutputRegistry(context, { missingOk: true });
  const storyRequirements = Array.isArray(story.links?.requirements) ? story.links.requirements : [];
  const requirements = options.requirements?.length > 0 ? options.requirements : storyRequirements;
  const templates = registry ? registry.templates.filter((template) => template.type === artifactType) : [];
  const approvedTemplates = templates.filter((template) => template.status === "approved");
  const existingLinks = registry
    ? registry.links.filter((link) => link.story_id === storyId && link.artifact_type === artifactType)
    : [];
  const relatedLinks = registry
    ? registry.links.filter(
        (link) =>
          link.story_id !== storyId &&
          link.artifact_type === artifactType &&
          overlaps(link.requirements || [], requirements),
      )
    : [];
  const preferredRelated = relatedLinks[0] || null;
  const preferredTemplate = approvedTemplates.find((template) => template.id === preferredRelated?.template_id) || approvedTemplates[0] || null;
  let recommendation = "template_required";
  let nextAction = `Propose and approve a template: agentic-sdlc output template propose --type ${artifactType}`;
  let baseArtifact = null;

  if (existingLinks.length > 0) {
    recommendation = "linked";
    nextAction = "No new artifact is required unless the user agrees on a delta or structure change.";
    baseArtifact = existingLinks[0].base_artifact || existingLinks[0].artifact_path || null;
  } else if (preferredRelated) {
    recommendation = "reuse_delta";
    baseArtifact = preferredRelated.artifact_path;
    nextAction = [
      `Reuse ${preferredRelated.artifact_path} and create only a delta if needed.`,
      `Link it with: agentic-sdlc output link --story ${storyId} --type ${artifactType}`,
      `--artifact <delta-path> --template ${preferredRelated.template_id} --mode delta --base-artifact ${preferredRelated.artifact_path}`,
    ].join(" ");
  } else if (preferredTemplate) {
    recommendation = "new";
    nextAction = [
      "No related approved artifact was found.",
      `Create the artifact with template ${preferredTemplate.id}, then link it with mode new.`,
    ].join(" ");
  }

  return {
    story_id: storyId,
    artifact_type: artifactType,
    requirements,
    recommendation,
    template_id: preferredTemplate?.id || existingLinks[0]?.template_id || null,
    approved_templates: approvedTemplates.map((template) => template.id),
    existing_links: existingLinks,
    related_links: relatedLinks,
    base_artifact: baseArtifact,
    cache_used: Boolean(options.cache_used),
    next_action: nextAction,
  };
}

function buildCache(context) {
  const generatedAt = now();
  const sourceFiles = collectKnowledgeSourceFiles(context);
  const sourceHashes = {};
  const fullTextIndex = [];
  for (const filePath of sourceFiles) {
    const relativePath = toProjectPath(context, filePath);
    const raw = fs.readFileSync(filePath, "utf8");
    const sourceHash = hashBuffer(Buffer.from(raw, "utf8"));
    sourceHashes[relativePath] = sourceHash;
    fullTextIndex.push({
      path: relativePath,
      title: inferTitle(filePath, raw),
      extension: path.extname(filePath),
      size_bytes: Buffer.byteLength(raw),
      snippet: normalizeText(raw).slice(0, 240),
      search_text: normalizeText(raw),
      source_paths: [relativePath],
      source_hashes: {
        [relativePath]: sourceHash,
      },
      generated_at: generatedAt,
      schema_version: context.config.schema_version,
    });
  }

  const registry = readOutputRegistry(context, { missingOk: true });
  const stories = readAllStories(context);
  const templateResolution = buildTemplateResolution(registry);
  const storyRequirementGraph = buildStoryRequirementGraph(stories);
  const dependencyGraph = {
    approved: readDependencyGraph(context, { missingOk: true }),
    derived_story_links: buildStoryDependencyGraph(stories),
  };
  const artifactFingerprints = buildArtifactFingerprints(context, registry);
  const outputResolutions = {};
  const artifactTypes = collectOutputArtifactTypes(context, registry);
  for (const story of stories) {
    for (const artifactType of artifactTypes) {
      outputResolutions[outputResolutionKey(story.id, artifactType)] = buildOutputResolution(context, story.id, artifactType, {
        registry,
        cache_used: false,
      });
    }
  }

  return {
    schema_version: context.config.schema_version,
    generated_at: generatedAt,
    root: context.root,
    source_paths: Object.keys(sourceHashes).sort(),
    source_hashes: sourceHashes,
    full_text_index: fullTextIndex,
    story_requirement_graph: storyRequirementGraph,
    artifact_fingerprints: artifactFingerprints,
    template_resolution: templateResolution,
    kb_summaries: fullTextIndex.map((entry) => ({
      path: entry.path,
      title: entry.title,
      snippet: entry.snippet,
      source_paths: entry.source_paths,
      source_hashes: entry.source_hashes,
      generated_at: entry.generated_at,
      schema_version: entry.schema_version,
    })),
    dependency_graph: dependencyGraph,
    output_resolutions: outputResolutions,
  };
}

function getCacheStatus(context) {
  const cachePath = path.join(context.sdlcRoot, "cache", CACHE_FILE_NAME);
  const exists = fs.existsSync(cachePath);
  if (!exists) {
    return {
      exists: false,
      valid: false,
      stale: true,
      cache_path: cachePath,
      changed: [],
      missing: [],
      added: [],
      schema_mismatch: false,
      cache: null,
    };
  }

  let cache;
  try {
    cache = JSON.parse(fs.readFileSync(cachePath, "utf8"));
  } catch (error) {
    return {
      exists: true,
      valid: false,
      stale: true,
      cache_path: cachePath,
      changed: [],
      missing: [],
      added: [],
      schema_mismatch: false,
      parse_error: error.message,
      generated_at: null,
      cache: null,
    };
  }
  const currentSourceFiles = collectKnowledgeSourceFiles(context);
  const currentHashes = {};
  for (const filePath of currentSourceFiles) {
    currentHashes[toProjectPath(context, filePath)] = hashFile(filePath);
  }
  const cachedHashes = cache.source_hashes || {};
  const currentPaths = new Set(Object.keys(currentHashes));
  const cachedPaths = new Set(Object.keys(cachedHashes));
  const changed = [];
  const missing = [];
  const added = [];

  for (const cachedPath of cachedPaths) {
    if (!currentPaths.has(cachedPath)) {
      missing.push(cachedPath);
    } else if (cachedHashes[cachedPath] !== currentHashes[cachedPath]) {
      changed.push(cachedPath);
    }
  }
  for (const currentPath of currentPaths) {
    if (!cachedPaths.has(currentPath)) {
      added.push(currentPath);
    }
  }
  const schemaMismatch = cache.schema_version !== context.config.schema_version;
  const structureErrors = validateCacheMetadata(context, cache);
  const valid = changed.length === 0 && missing.length === 0 && added.length === 0 && !schemaMismatch && structureErrors.length === 0;
  return {
    exists: true,
    valid,
    stale: !valid,
    cache_path: cachePath,
    changed,
    missing,
    added,
    schema_mismatch: schemaMismatch,
    structure_errors: structureErrors,
    generated_at: cache.generated_at || null,
    cache,
  };
}

function validateCacheMetadata(context, cache) {
  const errors = [];
  const required = context.config.cache_policy?.required_entry_metadata || [
    "source_paths",
    "source_hashes",
    "generated_at",
    "schema_version",
  ];
  for (const [collectionName, entries] of Object.entries({
    full_text_index: cache.full_text_index,
    kb_summaries: cache.kb_summaries,
  })) {
    if (!Array.isArray(entries)) {
      errors.push(`${collectionName} must be an array`);
      continue;
    }
    entries.forEach((entry, index) => {
      for (const field of required) {
        if (entry[field] === undefined || entry[field] === null) {
          errors.push(`${collectionName}[${index}] is missing ${field}`);
        }
      }
      for (const sourcePath of entry.source_paths || []) {
        const resolved = resolveProjectFilePath(context, sourcePath, { mustExist: false });
        if (isDerivedArtifactPath(context, resolved)) {
          errors.push(`${collectionName}[${index}] uses derived source ${sourcePath}`);
        }
      }
    });
  }
  return errors;
}

function outputContractsRoot(context) {
  return path.join(context.sdlcRoot, "output-contracts");
}

function outputRegistryPath(context) {
  return path.join(outputContractsRoot(context), "registry.json");
}

function readOutputRegistry(context, options = {}) {
  const registryPath = outputRegistryPath(context);
  if (!fs.existsSync(registryPath)) {
    if (options.create) {
      return initializeOutputContracts(context, {
        force: false,
        attribution: buildAttribution(context, options.options || {}, options.action || "output.registry.init"),
      });
    }
    if (options.missingOk) {
      return null;
    }
    fail("Output registry does not exist. Run 'agentic-sdlc init' or create it with output template propose.");
  }
  const registry = readJson(registryPath);
  registry.templates = Array.isArray(registry.templates) ? registry.templates : [];
  registry.links = Array.isArray(registry.links) ? registry.links : [];
  registry.decisions = Array.isArray(registry.decisions) ? registry.decisions : [];
  return registry;
}

function writeOutputRegistry(context, registry) {
  writeJsonFile(outputRegistryPath(context), registry, { force: true });
}

function withOutputRegistryLock(context, callback) {
  const releaseLock = acquireFileLock(path.join(outputContractsRoot(context), "registry.lock"));
  try {
    return callback();
  } finally {
    releaseLock();
  }
}

function findOutputTemplate(registry, id) {
  return (registry.templates || []).find((template) => template.id === id) || null;
}

function normalizeArtifactType(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(normalized)) {
    fail(`Invalid artifact type '${value}'. Use lowercase letters, numbers, dots, underscores, and hyphens.`);
  }
  return normalized;
}

function normalizeOutputMode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!OUTPUT_LINK_MODES.has(normalized)) {
    fail(`Invalid output mode '${value}'. Valid modes: ${Array.from(OUTPUT_LINK_MODES).join(", ")}`);
  }
  return normalized;
}

function resolveProjectFilePath(context, rawPath, options = {}) {
  const value = String(rawPath || "").trim();
  if (!value) {
    fail("Path value cannot be empty");
  }
  const resolved = path.isAbsolute(value) ? path.resolve(value) : path.resolve(context.root, value);
  assertPathInsideRoot(context, resolved, value);
  if (options.mustExist && !fs.existsSync(resolved)) {
    fail(`Path does not exist: ${value}`);
  }
  if (fs.existsSync(resolved)) {
    const realRoot = fs.realpathSync.native(context.root);
    const realResolved = fs.realpathSync.native(resolved);
    if (!isInsidePath(realRoot, realResolved)) {
      fail(`Path resolves outside the target project root: ${value}`);
    }
    const stat = fs.statSync(resolved);
    if (options.fileOnly && !stat.isFile()) {
      fail(`Path is not a file: ${value}`);
    }
    if (options.directoryOnly && !stat.isDirectory()) {
      fail(`Path is not a directory: ${value}`);
    }
  } else {
    const nearestParent = nearestExistingParent(resolved);
    const realRoot = fs.realpathSync.native(context.root);
    const realParent = fs.realpathSync.native(nearestParent);
    if (!isInsidePath(realRoot, realParent)) {
      fail(`Path parent resolves outside the target project root: ${value}`);
    }
  }
  return resolved;
}

function nearestExistingParent(filePath) {
  let current = path.dirname(path.resolve(filePath));
  while (!fs.existsSync(current)) {
    const next = path.dirname(current);
    if (next === current) {
      return current;
    }
    current = next;
  }
  return current;
}

function assertPathInsideRoot(context, resolvedPath, label) {
  if (!isInsidePath(context.root, resolvedPath)) {
    fail(`Path must stay inside the target project root: ${label}`);
  }
}

function toProjectPath(context, filePath) {
  return path.relative(context.root, path.resolve(filePath)).split(path.sep).join("/");
}

function isDerivedArtifactPath(context, filePath) {
  const relative = path.relative(context.sdlcRoot, path.resolve(filePath));
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return false;
  }
  const first = relative.split(path.sep)[0];
  const derived = new Set(context.config.cache_policy?.derived_directories || ["cache", "indexes"]);
  return derived.has(first);
}

function assertNotDerivedArtifact(context, filePath, label) {
  if (isDerivedArtifactPath(context, filePath)) {
    fail(`${label} cannot be under .sdlc/cache or .sdlc/indexes because those directories are derived artifacts.`);
  }
}

function upsertById(items, item) {
  const index = items.findIndex((candidate) => candidate.id === item.id);
  if (index >= 0) {
    items[index] = item;
  } else {
    items.push(item);
  }
}

function outputStatusTypes(context, registry, options = {}) {
  const explicitTypes = normalizeListOption(options.type).map(normalizeArtifactType);
  if (explicitTypes.length > 0) {
    return explicitTypes;
  }
  return collectOutputArtifactTypes(context, registry);
}

function collectOutputArtifactTypes(context, registry) {
  const types = new Set();
  for (const type of context.config.output_consistency_policy?.artifact_types || []) {
    types.add(normalizeArtifactType(type));
  }
  if (registry) {
    for (const template of registry.templates || []) {
      if (template.type) {
        types.add(normalizeArtifactType(template.type));
      }
    }
    for (const link of registry.links || []) {
      if (link.artifact_type) {
        types.add(normalizeArtifactType(link.artifact_type));
      }
    }
  }
  return Array.from(types).sort();
}

function outputResolutionKey(storyId, artifactType) {
  return `${storyId}::${artifactType}`;
}

function collectKnowledgeSourceFiles(context) {
  const sourceDirs = context.config.cache_policy?.source_of_truth_dirs || [
    "contracts",
    "requirements",
    "stories",
    "decisions",
    "tests",
    "traces",
    "handoffs",
    "output-contracts",
    "work-items",
    "work-breakdown",
    "dependencies",
    "assumptions",
    "risks",
    "locks",
    "orchestration",
    "releases",
    "manifests",
    "archive",
    "reports",
  ];
  const files = [];
  const rootFiles = [path.join(context.sdlcRoot, "project.json")].filter((filePath) => fs.existsSync(filePath));
  files.push(...rootFiles);
  for (const directory of sourceDirs) {
    const dirPath = path.join(context.sdlcRoot, directory);
    if (!fs.existsSync(dirPath)) {
      continue;
    }
    for (const filePath of walkFiles(dirPath)) {
      if (shouldIndexFile(context, filePath)) {
        files.push(filePath);
      }
    }
  }
  return Array.from(new Set(files)).sort((a, b) => a.localeCompare(b));
}

function shouldIndexFile(context, filePath) {
  if (isDerivedArtifactPath(context, filePath)) {
    return false;
  }
  const extension = path.extname(filePath);
  return context.config.indexable_extensions.includes(extension);
}

function readAllStories(context) {
  const storiesRoot = path.join(context.sdlcRoot, "stories");
  return safeReadDir(storiesRoot)
    .map((entry) => {
      const storyPath = path.join(storiesRoot, entry, "story.json");
      return fs.existsSync(storyPath) ? readJson(storyPath) : null;
    })
    .filter(Boolean)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function buildTemplateResolution(registry) {
  const result = {};
  for (const template of registry?.templates || []) {
    const type = template.type || "unknown";
    result[type] = result[type] || {
      approved_template_ids: [],
      draft_template_ids: [],
      default_template_id: null,
    };
    if (template.status === "approved") {
      result[type].approved_template_ids.push(template.id);
      result[type].default_template_id = result[type].default_template_id || template.id;
    } else {
      result[type].draft_template_ids.push(template.id);
    }
  }
  return result;
}

function buildStoryRequirementGraph(stories) {
  return stories.map((story) => ({
    story_id: story.id,
    requirements: Array.isArray(story.links?.requirements) ? story.links.requirements : [],
  }));
}

function buildStoryDependencyGraph(stories) {
  const nodes = stories.map((story) => story.id);
  const edges = [];
  for (let left = 0; left < stories.length; left += 1) {
    for (let right = left + 1; right < stories.length; right += 1) {
      const leftReqs = stories[left].links?.requirements || [];
      const rightReqs = stories[right].links?.requirements || [];
      const shared = leftReqs.filter((requirement) => rightReqs.includes(requirement));
      if (shared.length > 0) {
        edges.push({
          from: stories[left].id,
          to: stories[right].id,
          reason: "shared_requirements",
          requirements: shared,
        });
      }
    }
  }
  return { nodes, edges };
}

function buildArtifactFingerprints(context, registry) {
  const paths = new Set();
  for (const template of registry?.templates || []) {
    if (template.path) {
      paths.add(template.path);
    }
  }
  for (const link of registry?.links || []) {
    if (link.artifact_path) {
      paths.add(link.artifact_path);
    }
    if (link.base_artifact) {
      paths.add(link.base_artifact);
    }
  }
  return Array.from(paths)
    .sort()
    .map((relativePath) => {
      const filePath = resolveProjectFilePath(context, relativePath, { mustExist: false });
      return {
        path: relativePath,
        exists: fs.existsSync(filePath),
        sha256: fs.existsSync(filePath) ? hashFile(filePath) : null,
        size_bytes: fs.existsSync(filePath) ? fs.statSync(filePath).size : null,
      };
    });
}

function findRelatedOutputLinks(registry, link) {
  const requirements = link.requirements || [];
  return (registry.links || []).filter((candidate) => {
    if (candidate.id === link.id || candidate.artifact_type !== link.artifact_type) {
      return false;
    }
    if (overlaps(candidate.requirements || [], requirements)) {
      return true;
    }
    if (link.base_artifact && candidate.artifact_path === link.base_artifact) {
      return true;
    }
    return candidate.artifact_path && candidate.artifact_path === link.artifact_path;
  });
}

function overlaps(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length === 0 || right.length === 0) {
    return false;
  }
  const rightSet = new Set(right);
  return left.some((item) => rightSet.has(item));
}

function hasApprovedOutputDecision(decisions, decisionId) {
  if (!decisionId) {
    return false;
  }
  return decisions.some(
    (decision) =>
      decision.id === decisionId &&
      decision.status === "approved" &&
      ["output_link_override", "duplicate_output_approved"].includes(decision.type),
  );
}

function findUnlinkedStoryOutputCandidates(context, storyId) {
  const storyDir = path.join(context.sdlcRoot, "stories", storyId);
  const outputsDir = path.join(storyDir, "outputs");
  if (!fs.existsSync(outputsDir)) {
    return [];
  }
  const registry = readOutputRegistry(context, { missingOk: true });
  const linked = new Set((registry?.links || []).filter((link) => link.story_id === storyId).map((link) => link.artifact_path));
  return walkFiles(outputsDir)
    .filter((filePath) => shouldIndexFile(context, filePath))
    .map((filePath) => toProjectPath(context, filePath))
    .filter((relativePath) => !linked.has(relativePath));
}

function shortHash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 8);
}

function shortHashFull(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function hashFile(filePath) {
  return hashBuffer(fs.readFileSync(filePath));
}

function hashBuffer(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function appendTraceEvent(context, storyId, event) {
  const normalizedStoryId = storyId ? normalizeId(String(storyId)) : null;
  const traceFile = normalizedStoryId ? `${normalizedStoryId}.jsonl` : "project.jsonl";
  const tracePath = path.join(context.sdlcRoot, "traces", traceFile);
  const traceEvent = {
    id: event.id || `TR-${compactTimestamp()}-${crypto.randomBytes(3).toString("hex")}`,
    story_id: normalizedStoryId,
    type: event.type,
    summary: event.summary,
    actor: event.actor,
    action: event.action || event.type,
    evidence: event.evidence || [],
    related: event.related || [],
    git: event.git || buildGitMetadata(context.root),
    run: event.run || buildRunMetadata({}),
    created_at: event.created_at || now(),
  };
  appendJsonLine(tracePath, traceEvent);
  return traceEvent;
}

function rebuildIndex(context, options) {
  ensureInitialized(context);
  const index = buildIndex(context);
  const indexPath = path.join(context.sdlcRoot, "indexes", "kb-index.json");
  writeJsonFile(indexPath, index, { force: true });
  output(
    options,
    { status: "rebuilt", index_path: indexPath, entries: index.entries.length },
    [`Rebuilt knowledge index with ${index.entries.length} entries`],
  );
}

function searchKnowledgeBase(context, options, rest) {
  ensureInitialized(context);
  const query = String(options.query || rest.join(" ")).trim();
  if (!query) {
    fail("Provide a query with 'kb search <query>' or --query.");
  }
  const limit = Number(options.limit || 10);
  const indexStatus = getIndexStatus(context);
  const index = indexStatus.valid ? indexStatus.index : buildIndex(context);
  const terms = tokenize(query);
  const results = index.entries
    .map((entry) => ({ entry, score: scoreEntry(entry, terms) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  output(
    options,
    { query, index_status: indexStatus.valid ? "valid" : "rebuilt_in_memory", results },
    results.length
      ? results.map(({ entry, score }) => `${score.toFixed(2)} ${entry.path}: ${entry.snippet}`)
      : [`No KB results for '${query}'`],
  );
}

function gateCheck(context, options) {
  ensureInitialized(context);
  const attribution = buildAttribution(context, options, "gate.check");
  const storyId = options.story ? normalizeId(String(options.story)) : null;
  const scope = String(options.scope || (storyId ? "story" : "all"));
  const report = {
    status: "passed",
    strict: Boolean(options.strict),
    scope,
    story_id: storyId,
    checked_at: now(),
    root: context.root,
    actor: attribution.actor,
    git: attribution.git,
    run: attribution.run,
    errors: [],
    warnings: [],
    checked: [],
  };

  if (!["story", "all"].includes(scope)) {
    fail("Gate scope must be 'story' or 'all'.");
  }
  if (scope === "story" && !storyId) {
    fail("Gate scope 'story' requires --story.");
  }
  validateProject(context, report);
  validateBaselines(context, report);
  validateLocks(context, report);

  if (storyId && scope === "story") {
    const story = readStory(context, storyId);
    validateDependencyProposals(context, report, storyId);
    if (story?.contract_id) {
      validateContracts(context, report, new Set([story.contract_id]));
    }
    validateCapabilityDiscovery(context, report, storyId);
    validateTraces(context, report, storyId);
    validateHandoffs(context, report, storyId);
    validateStory(context, storyId, report);
    validateOutputContracts(context, report, storyId);
  } else {
    validateDependencyProposals(context, report);
    validateContracts(context, report);
    validateCapabilityDiscovery(context, report);
    validateTraces(context, report);
    validateHandoffs(context, report);
    const storiesRoot = path.join(context.sdlcRoot, "stories");
    for (const entry of safeReadDir(storiesRoot)) {
      const storyJson = path.join(storiesRoot, entry, "story.json");
      if (fs.existsSync(storyJson)) {
        validateStory(context, entry, report);
      }
    }
    validateOutputContracts(context, report);
  }

  if (report.errors.length > 0) {
    report.status = "failed";
    process.exitCode = 1;
  }
  if (options.out) {
    writeGateReport(context, report, options);
  }

  output(
    options,
    report,
    [
      `Gate ${report.status}`,
      `Checked: ${report.checked.length}`,
      `Errors: ${report.errors.length}`,
      `Warnings: ${report.warnings.length}`,
      ...report.errors.map((item) => `ERROR ${item}`),
      ...report.warnings.map((item) => `WARN ${item}`),
    ],
  );
}

function readStory(context, storyId) {
  const storyPath = path.join(context.sdlcRoot, "stories", storyId, "story.json");
  return fs.existsSync(storyPath) ? readJson(storyPath) : null;
}

function writeGateReport(context, report, options) {
  const reportPath = resolveProjectFilePath(context, options.out, { mustExist: false });
  assertNotDerivedArtifact(context, reportPath, "Gate report");
  const extension = path.extname(reportPath).toLowerCase();
  if (extension === ".md") {
    writeTextFile(reportPath, renderGateReportMarkdown(report), { force: Boolean(options.force) });
    return;
  }
  writeJsonFile(reportPath, report, { force: Boolean(options.force) });
}

function renderGateReportMarkdown(report) {
  return [
    `# SDLC Gate Report`,
    "",
    `- Status: ${report.status}`,
    `- Strict: ${report.strict}`,
    `- Scope: ${report.scope}`,
    `- Story: ${report.story_id || "all"}`,
    `- Checked at: ${report.checked_at}`,
    `- Checked items: ${report.checked.length}`,
    "",
    "## Errors",
    ...(report.errors.length ? report.errors.map((item) => `- ${item}`) : ["- None"]),
    "",
    "## Warnings",
    ...(report.warnings.length ? report.warnings.map((item) => `- ${item}`) : ["- None"]),
    "",
    "## Checked",
    ...(report.checked.length ? report.checked.map((item) => `- ${item}`) : ["- None"]),
    "",
  ].join("\n");
}

function showStatus(context, options) {
  ensureInitialized(context);
  const counts = {};
  for (const directory of context.config.kb_directories) {
    const dirPath = path.join(context.sdlcRoot, directory);
    counts[directory] = countFiles(dirPath);
  }
  const project = readJson(path.join(context.sdlcRoot, "project.json"));
  output(
    options,
    { project, counts },
    [
      `Project: ${project.project_name} (${project.project_id})`,
      ...Object.entries(counts).map(([key, value]) => `${key}: ${value}`),
    ],
  );
}

function showOrchestrationStatus(context, options) {
  ensureInitialized(context);
  const snapshot = buildOrchestrationSnapshot(context);
  output(
    options,
    snapshot,
    [
      `Stories: ${snapshot.summary.total}`,
      `Available: ${snapshot.summary.available}`,
      `Claimed: ${snapshot.summary.claimed}`,
      `Blocked: ${snapshot.summary.blocked}`,
      `Stale: ${snapshot.summary.stale}`,
      `Active locks: ${snapshot.summary.active_locks}`,
      ...snapshot.stories.map((story) => {
        const owner = story.claim?.agent ? ` by ${story.claim.agent}` : "";
        const branch = story.claim?.branch ? ` on ${story.claim.branch}` : "";
        return `${story.id}: ${story.orchestration_state}${owner}${branch} (${story.phase})`;
      }),
    ],
  );
}

function showOrchestrationPlan(context, options) {
  ensureInitialized(context);
  const snapshot = buildOrchestrationSnapshot(context);
  const limit = Number(options.limit || 20);
  const candidates = snapshot.stories
    .filter((story) => story.orchestration_state === "available")
    .slice(0, limit)
    .map((story) => ({
      story_id: story.id,
      title: story.title,
      phase: story.phase,
      suggested_branch: `feature/${story.id}`,
      suggested_claim: `agentic-sdlc story claim --id ${story.id} --agent <agent> --branch feature/${story.id}`,
    }));
  output(
    options,
    { ...snapshot, candidates },
    candidates.length
      ? [
          `Available work lanes: ${candidates.length}`,
          ...candidates.map((item) => `${item.story_id}: ${item.title} (${item.phase}) -> ${item.suggested_branch}`),
        ]
      : ["No available story lanes. Check blocked, claimed, or stale stories with 'orchestrate status --json'."],
  );
}

function buildOrchestrationSnapshot(context) {
  const storiesRoot = path.join(context.sdlcRoot, "stories");
  const stories = safeReadDir(storiesRoot)
    .map((entry) => {
      const storyPath = path.join(storiesRoot, entry, "story.json");
      if (!fs.existsSync(storyPath)) {
        return null;
      }
      const story = readJson(storyPath);
      story.__folder_id = entry;
      const claimPath = path.join(storiesRoot, entry, "claim.json");
      const claim = fs.existsSync(claimPath) ? readJson(claimPath) : null;
      const lastTrace = readLastTraceEvent(context, entry);
      const dependencyStatus = buildDependencyStatus(context, story.id || entry);
      const blockers = inferStoryBlockers(context, story, claim, dependencyStatus);
      return {
        id: story.id || entry,
        title: story.title || entry,
        status: story.status || "unknown",
        phase: story.phase || "unknown",
        contract_id: story.contract_id || null,
        claim,
        last_trace: lastTrace,
        dependency_edges: dependencyStatus.edges,
        warnings: dependencyStatus.warnings,
        orchestration_state: inferStoryOrchestrationState(context, story, claim, blockers),
        blockers,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.id.localeCompare(b.id));

  const summary = {
    total: stories.length,
    available: stories.filter((story) => story.orchestration_state === "available").length,
    claimed: stories.filter((story) => story.orchestration_state === "claimed").length,
    blocked: stories.filter((story) => story.orchestration_state === "blocked").length,
    stale: stories.filter((story) => story.orchestration_state === "stale").length,
    active_locks: readActiveLocks(context).length,
  };

  return {
    checked_at: now(),
    root: context.root,
    summary,
    stories,
    locks: readLocks(context),
    handoffs: readHandoffs(context),
  };
}

function inferStoryOrchestrationState(context, story, claim, blockers = null) {
  if (claim && claim.status === "active") {
    return isExpired(claim.expires_at) ? "stale" : "claimed";
  }
  return (blockers || inferStoryBlockers(context, story, claim)).length > 0 ? "blocked" : "available";
}

function inferStoryBlockers(context, story, claim, dependencyStatus = null) {
  const blockers = [];
  if (story.id && story.__folder_id && story.id !== story.__folder_id) {
    blockers.push(`story id ${story.id} does not match folder ${story.__folder_id}`);
  }
  if (!Array.isArray(story.acceptance_criteria) || story.acceptance_criteria.length === 0) {
    blockers.push("missing acceptance criteria");
  }
  if (story.contract_id) {
    const contractPath = path.join(context.sdlcRoot, "contracts", `${story.contract_id}.json`);
    if (!fs.existsSync(contractPath)) {
      blockers.push(`missing contract ${story.contract_id}`);
    }
  }
  if (claim && claim.status === "active" && isExpired(claim.expires_at)) {
    blockers.push("active claim is expired");
  }
  blockers.push(...(dependencyStatus || buildDependencyStatus(context, story.id)).blockers);
  return blockers;
}

function readLastTraceEvent(context, storyId) {
  const events = readTraceEvents(context, storyId).filter((event) => event.type !== "invalid");
  return events.length ? events[events.length - 1] : null;
}

function readLocks(context) {
  const locksRoot = path.join(context.sdlcRoot, "locks");
  return safeReadDir(locksRoot)
    .filter((name) => name.endsWith(".json"))
    .map((name) => readJson(path.join(locksRoot, name)));
}

function readActiveLocks(context) {
  return readLocks(context).filter((lock) => lock.status === "active" && !isExpired(lock.expires_at));
}

function readHandoffs(context) {
  const handoffsRoot = path.join(context.sdlcRoot, "handoffs");
  return safeReadDir(handoffsRoot)
    .filter((name) => name.endsWith(".json"))
    .map((name) => readJson(path.join(handoffsRoot, name)));
}

function normalizeStoryStep(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
  if (!STORY_STEP_NAMES.has(normalized)) {
    fail(`Unknown story step '${value}'. Valid values: ${Array.from(STORY_STEP_NAMES).join(", ")}`);
  }
  return normalized;
}

function storyStepPhase(step) {
  if (["functional-analysis", "technical-analysis"].includes(step)) {
    return "analysis";
  }
  return step;
}

function defaultNextStoryStep(step) {
  const order = [
    "discovery",
    "functional-analysis",
    "technical-analysis",
    "design",
    "implementation",
    "validation",
    "release",
  ];
  const index = order.indexOf(step);
  return index >= 0 && index < order.length - 1 ? order[index + 1] : null;
}

function buildCanonicalEvidence(context, rawPaths, label) {
  return rawPaths.map((rawPath) => {
    const filePath = resolveProjectFilePath(context, rawPath, { mustExist: true, fileOnly: true });
    assertNotDerivedArtifact(context, filePath, label);
    return {
      path: toProjectPath(context, filePath),
      sha256: hashFile(filePath),
      hash_algorithm: "sha256:file:v1",
    };
  });
}

function collectStoryOutputLinksForStep(context, registry, storyId, outputTypes) {
  const typeFilter = new Set(outputTypes);
  return (registry?.links || [])
    .filter((link) => link.story_id === storyId)
    .filter((link) => typeFilter.size === 0 || typeFilter.has(link.artifact_type))
    .sort((a, b) => String(a.artifact_type || "").localeCompare(String(b.artifact_type || "")));
}

function assertReleaseClaimPrecondition(context, storyId, options) {
  if (!options["release-claim"]) {
    return;
  }
  const claimPath = path.join(context.sdlcRoot, "stories", storyId, "claim.json");
  if (!fs.existsSync(claimPath)) {
    fail(`Story ${storyId} has no claim to release`);
  }
  const claim = readJson(claimPath);
  if (claim.status !== "active") {
    fail(`Story ${storyId} claim is '${claim.status}', not active`);
  }
}

function readStoryStepRecords(context, storyId) {
  const stepsRoot = path.join(context.sdlcRoot, "stories", storyId, "steps");
  return safeReadDir(stepsRoot)
    .filter((name) => name.endsWith(".json"))
    .map((name) => readJson(path.join(stepsRoot, name)))
    .sort((a, b) => String(a.completed_at || "").localeCompare(String(b.completed_at || "")));
}

function buildStoryHandoffPackage(context, storyId, handoffId, options = {}) {
  const story = readStory(context, storyId);
  const claimPath = path.join(context.sdlcRoot, "stories", storyId, "claim.json");
  const registry = readOutputRegistry(context, { missingOk: true });
  const storyLinks = (registry?.links || []).filter((link) => link.story_id === storyId);
  const dependencyStatus = buildDependencyStatus(context, storyId);
  const traceLimit = Math.max(1, Number(options["trace-limit"] || 25));
  const traceEvents = readTraceEvents(context, storyId).filter((event) => event.type !== "invalid");
  const handoffs = readHandoffs(context).filter((handoff) => handoff.story_id === storyId);
  const sourceFiles = collectStoryHandoffSourceFiles(context, storyId);
  const sourcePaths = sourceFiles.map((filePath) => toProjectPath(context, filePath)).sort();
  return {
    id: normalizeId(`PKG-${handoffId}`),
    kind: "story_handoff_package",
    schema_version: context.config.schema_version,
    story_id: storyId,
    handoff_id: handoffId,
    generated_at: now(),
    summary: getOptionString(options, "summary") || null,
    story: {
      id: story.id,
      title: story.title,
      status: story.status,
      phase: story.phase,
      contract_id: story.contract_id || null,
      requirements: Array.isArray(story.links?.requirements) ? story.links.requirements : [],
      acceptance_criteria: Array.isArray(story.acceptance_criteria) ? story.acceptance_criteria : [],
    },
    active_claim: fs.existsSync(claimPath) ? readJson(claimPath) : null,
    completed_steps: readStoryStepRecords(context, storyId),
    output_links: storyLinks,
    dependency_status: {
      blockers: dependencyStatus.blockers,
      warnings: dependencyStatus.warnings,
      edges: dependencyStatus.edges,
    },
    handoffs: handoffs.map((handoff) => ({
      id: handoff.id,
      status: handoff.status,
      to_agent: handoff.to_agent,
      summary: handoff.summary || null,
      open_items: Array.isArray(handoff.open_items) ? handoff.open_items : [],
      created_at: handoff.created_at || null,
    })),
    recent_traces: traceEvents.slice(-traceLimit).map((event) => ({
      id: event.id || null,
      created_at: event.created_at || null,
      type: event.type || null,
      action: event.action || null,
      summary: event.summary || null,
      actor: event.actor || null,
      evidence: Array.isArray(event.evidence) ? event.evidence : [],
      related: Array.isArray(event.related) ? event.related : [],
      git: event.git || null,
      run: event.run || null,
    })),
    source_paths: sourcePaths,
    source_hashes: buildSourceHashMap(context, sourcePaths),
    audit: {
      generated_by: buildAttribution(context, options, "story.prepare-handoff").actor,
      git: buildGitMetadata(context.root),
      run: buildRunMetadata(options),
    },
  };
}

function collectStoryHandoffSourceFiles(context, storyId) {
  const storyDir = path.join(context.sdlcRoot, "stories", storyId);
  const files = [];
  for (const filePath of walkFiles(storyDir)) {
    if (shouldIndexFile(context, filePath) && !filePath.includes(`${path.sep}handoffs${path.sep}`)) {
      files.push(filePath);
    }
  }
  const tracePath = path.join(context.sdlcRoot, "traces", `${storyId}.jsonl`);
  if (fs.existsSync(tracePath)) {
    files.push(tracePath);
  }
  const registryPath = outputRegistryPath(context);
  if (fs.existsSync(registryPath)) {
    files.push(registryPath);
  }
  const graphPath = dependencyGraphPath(context);
  if (fs.existsSync(graphPath)) {
    files.push(graphPath);
  }
  return Array.from(new Set(files)).sort((a, b) => a.localeCompare(b));
}

function buildSourceHashMap(context, relativePaths) {
  const result = {};
  for (const relativePath of relativePaths) {
    const filePath = resolveProjectFilePath(context, relativePath, { mustExist: false });
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      result[relativePath] = hashFile(filePath);
    }
  }
  return result;
}

function isExpired(value) {
  if (!value) {
    return false;
  }
  const timestamp = Date.parse(String(value));
  return Number.isFinite(timestamp) && timestamp < Date.now();
}

function validateProject(context, report) {
  const projectPath = path.join(context.sdlcRoot, "project.json");
  if (!fs.existsSync(projectPath)) {
    report.errors.push("Missing .sdlc/project.json");
    return;
  }
  const project = readJson(projectPath);
  for (const field of ["project_id", "project_name", "schema_version", "sdlc_version", "knowledge_base"]) {
    if (project[field] === undefined || project[field] === null || project[field] === "") {
      report.errors.push(`Project is missing required field '${field}'`);
    }
  }
  if (project.knowledge_base && project.knowledge_base.stateless_plugin !== true) {
    report.errors.push("Project knowledge_base.stateless_plugin must be true");
  }
  report.checked.push("project");
}

function validateBaselines(context, report) {
  for (const baseline of readBaselines(context)) {
    const label = `baseline ${baseline.id || "unknown"}`;
    if (!baseline.id || !baseline.schema_version || !baseline.status || !baseline.kind) {
      report.errors.push(`${label} is missing id, schema_version, status, or kind`);
    }
    for (const issue of validateBaselineSourceHashes(context, baseline, label, { collectOnly: true })) {
      const severity = ["approved", "provisionally_approved"].includes(baseline.status) && report.strict ? "errors" : "warnings";
      report[severity].push(issue);
    }
    if (baseline.status === "approved") {
      const approval = latestApprovedRecordApproval(baseline);
      if (!approval || !["human", "ci"].includes(approval.approved_by?.type)) {
        report.errors.push(`${label} approval must be attributed to a human or CI actor`);
      }
      validateFormalApprovalRecord(context, report, approval, `${label} approval ${approval?.id || "unknown"}`, approval?.approved_by);
      if (!isApprovedRecordFresh(baseline)) {
        report.errors.push(`${label} approval is stale`);
      }
    }
    if (baseline.status === "provisionally_approved" && report.strict) {
      report.errors.push(`${label} is provisionally approved; explicit user or CI approval is required for strict gate`);
    }
    report.checked.push(label);
  }
}

function validateDependencyProposals(context, report, storyId = null) {
  for (const proposal of readDependencyProposals(context)) {
    const relevant = !storyId || (proposal.edges || []).some((edge) => edge.from === storyId || edge.to === storyId);
    if (!relevant) {
      continue;
    }
    const label = `dependency proposal ${proposal.id || "unknown"}`;
    if (!proposal.id || !proposal.status || !Array.isArray(proposal.edges)) {
      report.errors.push(`${label} is missing id, status, or edges`);
    }
    if (proposal.status === "approved") {
      const approval = latestApprovedRecordApproval(proposal);
      if (!approval || !["human", "ci"].includes(approval.approved_by?.type)) {
        report.errors.push(`${label} approval must be attributed to a human or CI actor`);
      }
      validateFormalApprovalRecord(context, report, approval, `${label} approval ${approval?.id || "unknown"}`, approval?.approved_by);
      if (!isApprovedRecordFresh(proposal)) {
        report.errors.push(`${label} approval is stale`);
      }
    }
    report.checked.push(label);
  }
}

function validateLocks(context, report) {
  const activeScopes = new Map();
  for (const lock of readLocks(context)) {
    const label = `lock ${lock.id || "unknown"}`;
    if (!lock.id || !lock.phase || !lock.status) {
      report.errors.push(`${label} is missing id, phase, or status`);
    }
    if (!LOCK_STATUSES.has(String(lock.status || "").toLowerCase())) {
      report.errors.push(`${label} has unknown status '${lock.status}'`);
    }
    if (lock.expires_at && !Number.isFinite(Date.parse(String(lock.expires_at)))) {
      report.errors.push(`${label} has invalid expires_at '${lock.expires_at}'`);
    }
    if (lock.status === "active" && isExpired(lock.expires_at)) {
      const severity = report.strict ? "errors" : "warnings";
      report[severity].push(`${label} expired at ${lock.expires_at}`);
    } else if (lock.status === "active") {
      const scopeKey = `${lock.phase}:${lock.scope || lock.phase}`;
      const existing = activeScopes.get(scopeKey);
      if (existing) {
        const severity = report.strict ? "errors" : "warnings";
        report[severity].push(`${label} conflicts with active ${existing} on ${scopeKey}`);
      } else {
        activeScopes.set(scopeKey, label);
      }
      report.warnings.push(`${label} is active for phase ${lock.phase}`);
    }
    report.checked.push(label);
  }
}

function validateHandoffs(context, report, storyId = null) {
  const handoffs = readHandoffs(context).filter((handoff) => !storyId || handoff.story_id === storyId);
  for (const handoff of handoffs) {
    const label = `handoff ${handoff.id || "unknown"}`;
    if (!handoff.id || !handoff.story_id || !handoff.status || !handoff.to_agent) {
      report.errors.push(`${label} is missing id, story_id, status, or to_agent`);
    }
    if (handoff.story_id && !readStory(context, handoff.story_id)) {
      report.errors.push(`${label} references missing story ${handoff.story_id}`);
    }
    for (const artifact of handoff.required_artifacts || []) {
      const artifactPath = resolveProjectFilePath(context, artifact, { mustExist: false });
      if (!fs.existsSync(artifactPath)) {
        report.errors.push(`${label} references missing required artifact ${artifact}`);
      } else if (isDerivedArtifactPath(context, artifactPath)) {
        report.errors.push(`${label} uses derived cache/index artifact ${artifact} as handoff evidence`);
      }
    }
    const openItems = Array.isArray(handoff.open_items) ? handoff.open_items.filter(Boolean) : [];
    if (openItems.length > 0) {
      const severity = report.strict && context.config.handoff_policy?.open_items_block_strict_gate !== false ? "errors" : "warnings";
      report[severity].push(`${label} has open items: ${openItems.join("; ")}`);
    }
    if (handoff.status === "open") {
      const severity = report.strict && context.config.handoff_policy?.open_items_block_strict_gate !== false ? "warnings" : "warnings";
      report[severity].push(`${label} is still open`);
    }
    report.checked.push(label);
  }
}

function validateOutputContracts(context, report, storyId = null) {
  const registryPath = outputRegistryPath(context);
  const cacheStatus = getCacheStatus(context);
  if (!cacheStatus.exists) {
    report.warnings.push("Local SDLC cache is missing; run 'agentic-sdlc cache rebuild' for faster output resolution");
  } else if (!cacheStatus.valid) {
    report.warnings.push("Local SDLC cache is stale; run 'agentic-sdlc cache rebuild'");
  }

  if (!fs.existsSync(registryPath)) {
    const severity = report.strict ? "errors" : "warnings";
    report[severity].push("Missing .sdlc/output-contracts/registry.json");
    return;
  }

  const registry = readOutputRegistry(context);
  const templates = Array.isArray(registry.templates) ? registry.templates : [];
  const links = Array.isArray(registry.links) ? registry.links : [];
  const decisions = Array.isArray(registry.decisions) ? registry.decisions : [];
  const linksToValidate = storyId ? links.filter((link) => link.story_id === storyId) : links;
  const templateById = new Map(templates.map((template) => [template.id, template]));

  if (!registry.schema_version) {
    report.errors.push("Output registry is missing schema_version");
  }
  if (!Array.isArray(registry.templates)) {
    report.errors.push("Output registry templates must be an array");
  }
  if (!Array.isArray(registry.links)) {
    report.errors.push("Output registry links must be an array");
  }

  for (const template of templates) {
    const label = `output template ${template.id || "unknown"}`;
    if (!template.id || !template.type || !template.status || !template.path) {
      report.errors.push(`${label} is missing id, type, status, or path`);
      continue;
    }
    const templatePath = resolveProjectFilePath(context, template.path, { mustExist: false });
    if (!fs.existsSync(templatePath)) {
      report.errors.push(`${label} references missing file ${template.path}`);
    }
    if (isDerivedArtifactPath(context, templatePath)) {
      report.errors.push(`${label} cannot live under cache or indexes`);
    }
    if (template.status === "approved") {
      if (!template.approved_by || !["human", "ci"].includes(template.approved_by.type)) {
        report.errors.push(`${label} approved template is missing human/CI approval attribution`);
      }
      validateFormalApprovalRecord(
        context,
        report,
        {
          status: "approved",
          summary: template.approval_summary,
          evidence: template.approval_evidence || [],
          approval_source: template.approval_source || null,
          explicit_user_confirmation: template.explicit_user_confirmation,
          provisional: template.provisional,
        },
        `${label} approval`,
        template.approved_by,
      );
      if (!template.approved_content_hash) {
        const severity = report.strict ? "errors" : "warnings";
        report[severity].push(`${label} is approved but has no approved_content_hash; re-approve the template`);
      } else if (fs.existsSync(templatePath) && hashFile(templatePath) !== template.approved_content_hash) {
        report.errors.push(`${label} changed after approval; re-approve the template`);
      }
    }
    if (Array.isArray(template.source_paths)) {
      for (const sourcePath of template.source_paths) {
        const resolved = resolveProjectFilePath(context, sourcePath, { mustExist: false });
        if (isDerivedArtifactPath(context, resolved)) {
          report.errors.push(`${label} uses derived cache/index source ${sourcePath}`);
        }
      }
    }
    report.checked.push(label);
  }

  for (const decision of decisions) {
    validateOutputDecision(context, report, decision);
  }

  for (const link of linksToValidate) {
    const label = `output link ${link.id || `${link.story_id || "unknown"}:${link.artifact_type || "unknown"}`}`;
    validateOutputLink(context, report, registry, templateById, decisions, link, label);
    report.checked.push(label);
  }

  if (storyId) {
    for (const candidate of findUnlinkedStoryOutputCandidates(context, storyId)) {
      const severity = report.strict ? "errors" : "warnings";
      report[severity].push(`Story ${storyId} output candidate ${candidate} is not linked in output-contracts registry`);
    }
  }
}

function validateOutputDecision(context, report, decision) {
  const label = `output decision ${decision.id || "unknown"}`;
  if (!decision.id || !decision.status) {
    report.errors.push(`${label} is missing id or status`);
  }
  if (decision.status === "approved") {
    const actor = decision.audit?.decided_by;
    if (!actor || !["human", "ci"].includes(actor.type)) {
      report.errors.push(`${label} approved decision is missing human/CI attribution`);
    }
    validateFormalApprovalRecord(context, report, decision, `${label} approval`, actor);
    for (const evidence of decision.evidence || []) {
      const evidencePath = resolveProjectFilePath(context, evidence.path || evidence, { mustExist: false });
      if (!fs.existsSync(evidencePath)) {
        report.errors.push(`${label} references missing approval evidence ${evidence.path || evidence}`);
      } else if (isDerivedArtifactPath(context, evidencePath)) {
        report.errors.push(`${label} uses derived cache/index evidence ${evidence.path || evidence}`);
      } else if (evidence.sha256 && evidence.sha256 !== hashFile(evidencePath)) {
        report.errors.push(`${label} approval evidence changed after decision: ${evidence.path || evidence}`);
      }
    }
    if (decision.subject && decision.approved_content_hash) {
      const currentHash = hashApprovalSubject(decision.subject);
      if (currentHash !== decision.approved_content_hash) {
        report.errors.push(`${label} subject changed after approval`);
      }
    } else if (report.strict && decision.type === "output_link_override") {
      report.errors.push(`${label} override approval must include subject and approved_content_hash`);
    }
  }
  report.checked.push(label);
}

function validateOutputLink(context, report, registry, templateById, decisions, link, label) {
  for (const field of ["id", "story_id", "artifact_type", "artifact_path", "template_id", "mode"]) {
    if (!link[field]) {
      report.errors.push(`${label} is missing ${field}`);
    }
  }
  if (!OUTPUT_LINK_MODES.has(link.mode)) {
    report.errors.push(`${label} has invalid mode '${link.mode}'`);
  }
  if (link.story_id && !readStory(context, link.story_id)) {
    report.errors.push(`${label} references missing story ${link.story_id}`);
  }

  const template = templateById.get(link.template_id);
  if (!template) {
    report.errors.push(`${label} references missing template ${link.template_id}`);
  } else {
    if (template.type !== link.artifact_type) {
      report.errors.push(`${label} template ${link.template_id} type '${template.type}' does not match '${link.artifact_type}'`);
    }
    if (template.status !== "approved") {
      const severity = report.strict ? "errors" : "warnings";
      report[severity].push(`${label} template ${link.template_id} is not approved`);
    }
  }

  if (link.artifact_path) {
    const artifactPath = resolveProjectFilePath(context, link.artifact_path, { mustExist: false });
    if (!fs.existsSync(artifactPath)) {
      report.errors.push(`${label} references missing artifact ${link.artifact_path}`);
    }
    if (isDerivedArtifactPath(context, artifactPath)) {
      report.errors.push(`${label} uses derived cache/index artifact ${link.artifact_path} as canonical output`);
    }
    if (fs.existsSync(artifactPath) && link.fingerprints?.artifact_sha256 && hashFile(artifactPath) !== link.fingerprints.artifact_sha256) {
      report.errors.push(`${label} artifact ${link.artifact_path} changed after it was linked`);
    } else if (report.strict && fs.existsSync(artifactPath) && !link.fingerprints?.artifact_sha256) {
      report.errors.push(`${label} is missing artifact fingerprint; re-link the output artifact`);
    }
  }

  if (link.mode === "delta") {
    if (!link.base_artifact) {
      report.errors.push(`${label} mode delta requires base_artifact`);
    } else {
      const basePath = resolveProjectFilePath(context, link.base_artifact, { mustExist: false });
      if (!fs.existsSync(basePath)) {
        report.errors.push(`${label} references missing base artifact ${link.base_artifact}`);
      }
      if (isDerivedArtifactPath(context, basePath)) {
        report.errors.push(`${label} uses derived cache/index base artifact ${link.base_artifact}`);
      }
      if (
        fs.existsSync(basePath) &&
        link.fingerprints?.base_artifact_sha256 &&
        hashFile(basePath) !== link.fingerprints.base_artifact_sha256
      ) {
        report.errors.push(`${label} base artifact ${link.base_artifact} changed after it was linked`);
      } else if (report.strict && fs.existsSync(basePath) && !link.fingerprints?.base_artifact_sha256) {
        report.errors.push(`${label} is missing base artifact fingerprint; re-link the output artifact`);
      }
    }
  }

  if (template?.path) {
    const templatePath = resolveProjectFilePath(context, template.path, { mustExist: false });
    if (
      fs.existsSync(templatePath) &&
      link.fingerprints?.template_sha256 &&
      hashFile(templatePath) !== link.fingerprints.template_sha256
    ) {
      report.errors.push(`${label} template ${link.template_id} changed after the artifact was linked`);
    }
  }

  const requirements = Array.isArray(link.requirements) ? link.requirements.filter(Boolean) : [];
  if (requirements.length === 0) {
    const severity = report.strict ? "errors" : "warnings";
    report[severity].push(`${label} has no linked requirements; duplicate detection and reuse/delta resolution are unsafe`);
  }

  const matchingDecision = validateOutputLinkDecision(context, report, decisions, link, label);
  const duplicateLinks = findRelatedOutputLinks(registry, link).filter((related) => related.id !== link.id);
  if (link.mode === "new" && duplicateLinks.length > 0 && !matchingDecision) {
    const related = duplicateLinks.map((item) => `${item.story_id}:${item.artifact_path}`).join(", ");
    const severity = report.strict ? "errors" : "warnings";
    report[severity].push(
      `${label} creates a new ${link.artifact_type} for requirements already covered by ${related}; use reuse/delta or record an approved decision`,
    );
  }
}

function validateCapabilityDiscovery(context, report, storyId = null) {
  const profiles = readCapabilityProfiles(context).filter((profile) => !storyId || profile.subject?.story_id === storyId);
  const profileIds = new Set(profiles.map((profile) => profile.id));
  const recommendations = readCapabilityRecommendations(context).filter((recommendation) => {
    if (!storyId) {
      return true;
    }
    return profileIds.has(recommendation.profile_id);
  });

  for (const profile of profiles) {
    const label = `capability profile ${profile.id || "unknown"}`;
    if (!profile.id || !profile.schema_version || !profile.status || !profile.subject) {
      report.errors.push(`${label} is missing id, schema_version, status, or subject`);
    }
    if (!Array.isArray(profile.detected_stack)) {
      report.errors.push(`${label} detected_stack must be an array`);
    }
    if (!Array.isArray(profile.evidence)) {
      report.errors.push(`${label} evidence must be an array`);
    }
    for (const sourcePath of profile.source_paths || []) {
      const resolved = resolveProjectFilePath(context, sourcePath, { mustExist: false });
      if (isDerivedArtifactPath(context, resolved)) {
        report.errors.push(`${label} uses derived source ${sourcePath}`);
      }
    }
    for (const issue of validateCapabilityRecordSourceHashes(context, profile, label, { collectOnly: true })) {
      const severity = approvedRecordIssueSeverity(context, report, profile);
      report[severity].push(issue);
    }
    if (profile.status === "approved") {
      const approval = latestApprovedRecordApproval(profile);
      if (!approval || !["human", "ci"].includes(approval.approved_by?.type)) {
        report.errors.push(`${label} approval must be attributed to a human or CI actor`);
      }
      validateFormalApprovalRecord(context, report, approval, `${label} approval ${approval?.id || "unknown"}`, approval?.approved_by);
      if (!isApprovedRecordFresh(profile)) {
        report[approvalIssueSeverity(context, report, approval)].push(`${label} approval is stale`);
      }
    }
    report.checked.push(label);
  }

  for (const recommendation of recommendations) {
    const label = `capability recommendation ${recommendation.id || "unknown"}`;
    if (!recommendation.id || !recommendation.schema_version || !recommendation.status || !recommendation.profile_id) {
      report.errors.push(`${label} is missing id, schema_version, status, or profile_id`);
    }
    if (!profileIds.has(recommendation.profile_id) && !fs.existsSync(capabilityProfilePath(context, recommendation.profile_id || "missing"))) {
      report.errors.push(`${label} references missing profile ${recommendation.profile_id || "unknown"}`);
    }
    if (!Array.isArray(recommendation.recommendations)) {
      report.errors.push(`${label} recommendations must be an array`);
    }
    for (const issue of validateCapabilityRecordSourceHashes(context, recommendation, label, { collectOnly: true })) {
      const severity = approvedRecordIssueSeverity(context, report, recommendation);
      report[severity].push(issue);
    }
    if (recommendation.status === "approved") {
      const approval = latestApprovedRecordApproval(recommendation);
      if (!approval || !["human", "ci"].includes(approval.approved_by?.type)) {
        report.errors.push(`${label} approval must be attributed to a human or CI actor`);
      }
      validateFormalApprovalRecord(context, report, approval, `${label} approval ${approval?.id || "unknown"}`, approval?.approved_by);
      if (!isApprovedRecordFresh(recommendation)) {
        report[approvalIssueSeverity(context, report, approval)].push(`${label} approval is stale`);
      }
      const profile = fs.existsSync(capabilityProfilePath(context, recommendation.profile_id))
        ? readJson(capabilityProfilePath(context, recommendation.profile_id))
        : null;
      if (!profile || profile.status !== "approved") {
        report.errors.push(`${label} approved recommendation requires an approved fresh profile`);
      } else if (!isApprovedRecordFresh(profile)) {
        report[approvedRecordIssueSeverity(context, report, profile)].push(`${label} approved recommendation requires an approved fresh profile`);
      }
    }
    report.checked.push(label);
  }
}

function validateOutputLinkDecision(context, report, decisions, link, label) {
  if (!link.decision_id) {
    return null;
  }
  const decision = decisions.find((candidate) => candidate.id === link.decision_id) || null;
  if (!decision) {
    report.errors.push(`${label} references missing decision ${link.decision_id}`);
    return null;
  }
  if (!hasApprovedOutputDecision(decisions, link.decision_id)) {
    report.errors.push(`${label} decision ${link.decision_id} is not an approved output override decision`);
    return null;
  }
  const expectedSubject = buildOutputLinkDecisionSubject(link);
  const expectedHash = hashApprovalSubject(expectedSubject);
  if (!decision.subject || !decision.approved_content_hash) {
    const severity = report.strict ? "errors" : "warnings";
    report[severity].push(`${label} decision ${link.decision_id} must include subject and approved_content_hash`);
    return null;
  }
  if (decision.approved_content_hash !== expectedHash || stableJson(decision.subject) !== stableJson(expectedSubject)) {
    report.errors.push(`${label} decision ${link.decision_id} was approved for a different output link subject`);
    return null;
  }
  return decision;
}

function outputLinkHasMatchingApprovedDecision(decisions, link) {
  if (!link.decision_id || !hasApprovedOutputDecision(decisions, link.decision_id)) {
    return false;
  }
  const decision = decisions.find((candidate) => candidate.id === link.decision_id);
  if (!decision || !decision.subject || !decision.approved_content_hash) {
    return false;
  }
  const expectedSubject = buildOutputLinkDecisionSubject(link);
  return (
    decision.approved_content_hash === hashApprovalSubject(expectedSubject) &&
    stableJson(decision.subject) === stableJson(expectedSubject)
  );
}

function buildOutputLinkDecisionSubject(link) {
  return {
    story_id: link.story_id,
    artifact_type: link.artifact_type,
    artifact_path: link.artifact_path,
    template_id: link.template_id,
    mode: link.mode,
    base_artifact: link.base_artifact || null,
    requirements: Array.isArray(link.requirements) ? link.requirements : [],
    rationale: link.rationale || null,
  };
}

function validateContracts(context, report, contractIds = null) {
  const contractsRoot = path.join(context.sdlcRoot, "contracts");
  const files = safeReadDir(contractsRoot).filter((name) => {
    if (!name.endsWith(".json")) {
      return false;
    }
    if (!contractIds) {
      return true;
    }
    return contractIds.has(path.basename(name, ".json"));
  });
  if (files.length === 0) {
    report.errors.push("No contracts found under .sdlc/contracts");
    return;
  }
  for (const file of files) {
    const contract = readJson(path.join(contractsRoot, file));
    const label = `contract ${file}`;
    for (const field of context.config.gate_policy.contract_required_fields) {
      if (contract[field] === undefined || contract[field] === null || contract[field] === "") {
        report.errors.push(`${label} is missing required field '${field}'`);
      }
    }
    for (const field of ["inputs", "outputs", "validation", "allowed_tools", "kb_writes"]) {
      if (!Array.isArray(contract[field]) || contract[field].length === 0) {
        report.errors.push(`${label} field '${field}' must be a non-empty array`);
      }
    }
    if (!context.config.phases[contract.phase]) {
      report.errors.push(`${label} has unknown phase '${contract.phase}'`);
    }
    if (!contract.project || !contract.project.project_id || !contract.project.project_name) {
      report.errors.push(`${label} must be bound to a project with project_id and project_name`);
    }
    if (!contract.contextualization || typeof contract.contextualization !== "object") {
      report.errors.push(`${label} must include contextualization metadata`);
    } else if (report.strict) {
      if (!contract.contextualization.summary) {
        report.errors.push(`${label} strict gate requires contextualization.summary`);
      }
      if (Number(contract.contextualization.open_questions || 0) > 0) {
        report.errors.push(`${label} strict gate blocks open contract questions`);
      }
    }
    validateContractApprovals(context, report, contract, label);
    if (report.strict && contract.human_gate === true && contract.status !== "approved") {
      report.errors.push(`${label} strict gate requires contract.status to be approved`);
    }
    if (report.strict && contract.human_gate === true && !hasApprovedContractApproval(contract)) {
      report.errors.push(`${label} strict gate requires an approved human gate record`);
    }
    if (report.strict && contract.human_gate === true && !hasFreshApprovedContractApproval(contract)) {
      report.errors.push(`${label} approved human gate is stale or missing approved_content_hash; re-approve the contract`);
    }
    validateContractOutputRefs(context, report, contract, label);
    validateExecutionPolicy(context, contract, label, report);
    validateCapabilityBindings(context, contract, label, report);
    validateContractCapabilityRecommendations(context, report, contract, label);
    report.checked.push(label);
  }
}

function hasApprovedContractApproval(contract) {
  if (!Array.isArray(contract.approvals) || contract.approvals.length === 0) {
    return false;
  }
  const latest = [...contract.approvals]
    .filter((approval) => approval && approval.status)
    .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")))
    .at(-1);
  return latest?.status === "approved";
}

function validateContractApprovals(context, report, contract, label) {
  for (const approval of contract.approvals || []) {
    const approvalLabel = `${label} approval ${approval.id || "unknown"}`;
    if (approval.status === "approved") {
      const actor = approval.approved_by;
      if (!actor || !["human", "ci"].includes(actor.type)) {
        report.errors.push(`${approvalLabel} is missing human/CI approval attribution`);
      }
      validateFormalApprovalRecord(context, report, approval, approvalLabel, actor);
      for (const evidence of approval.evidence || []) {
        const evidencePath = resolveProjectFilePath(context, evidence.path || evidence, { mustExist: false });
        if (!fs.existsSync(evidencePath)) {
          report.errors.push(`${approvalLabel} references missing approval evidence ${evidence.path || evidence}`);
        } else if (isDerivedArtifactPath(context, evidencePath)) {
          report.errors.push(`${approvalLabel} uses derived cache/index evidence ${evidence.path || evidence}`);
        } else if (evidence.sha256 && evidence.sha256 !== hashFile(evidencePath)) {
          report.errors.push(`${approvalLabel} approval evidence changed after approval: ${evidence.path || evidence}`);
        }
      }
    }
  }
}

function hasFreshApprovedContractApproval(contract) {
  if (!Array.isArray(contract.approvals) || contract.approvals.length === 0) {
    return false;
  }
  const latest = latestContractApproval(contract);
  if (!latest || latest.status !== "approved" || !latest.approved_content_hash) {
    return false;
  }
  return latest.approved_content_hash === hashApprovalSubject(contract);
}

function latestContractApproval(contract) {
  return [...(contract.approvals || [])]
    .filter((approval) => approval && approval.status)
    .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")))
    .at(-1);
}

function validateContractOutputRefs(context, report, contract, label) {
  const refs = Array.isArray(contract.output_contract_refs) ? contract.output_contract_refs : [];
  const requiresCoverage = context.config.gate_policy?.strict_mode?.requires_output_contract_coverage !== false;
  if (report.strict && requiresCoverage && contract.story_id && refs.length === 0) {
    report.errors.push(`${label} strict gate requires output_contract_refs for story output coverage`);
    return;
  }
  if (refs.length === 0) {
    return;
  }
  const registry = readOutputRegistry(context, { missingOk: true });
  const templates = new Map((registry?.templates || []).map((template) => [template.id, template]));
  const links = registry?.links || [];
  for (const ref of refs) {
    const refLabel = `${label} output ref ${ref.artifact_type || "unknown"}`;
    if (!ref.artifact_type || !ref.template_id || !ref.mode) {
      report.errors.push(`${refLabel} is missing artifact_type, template_id, or mode`);
      continue;
    }
    if (!OUTPUT_LINK_MODES.has(ref.mode)) {
      report.errors.push(`${refLabel} has invalid mode '${ref.mode}'`);
    }
    const template = templates.get(ref.template_id);
    if (!template) {
      report.errors.push(`${refLabel} references missing output template ${ref.template_id}`);
    } else {
      if (template.type !== ref.artifact_type) {
        report.errors.push(`${refLabel} template ${ref.template_id} type '${template.type}' does not match '${ref.artifact_type}'`);
      }
      if (report.strict && template.status !== "approved") {
        report.errors.push(`${refLabel} template ${ref.template_id} is not approved`);
      }
    }
    if (report.strict && requiresCoverage && contract.story_id) {
      const matchingLink = links.find(
        (link) =>
          link.story_id === contract.story_id &&
          link.artifact_type === ref.artifact_type &&
          link.template_id === ref.template_id &&
          link.mode === ref.mode,
      );
      if (!matchingLink) {
        report.errors.push(
          `${refLabel} is not satisfied by an output link for story ${contract.story_id}; run output link with the approved template and mode`,
        );
      }
    }
  }
}

function validateExecutionPolicy(context, contract, label, report) {
  const policy = contract.execution_policy;
  if (!policy || typeof policy !== "object") {
    return;
  }
  if (policy.runtime !== "codex") {
    report.errors.push(`${label} execution_policy.runtime must be 'codex'`);
  }
  validateExecutionPolicySelection(policy.model, "model", "value", label, report);
  validateExecutionPolicySelection(policy.reasoning, "reasoning", "level", label, report, {
    allowedValues: normalizeReasoningLevels(context.config.execution_policy?.reasoning_levels),
  });
  if (!Array.isArray(policy.notes)) {
    report.errors.push(`${label} execution_policy.notes must be an array`);
  }
}

function validateExecutionPolicySelection(selection, name, valueKey, label, report, options = {}) {
  if (!selection || typeof selection !== "object") {
    report.errors.push(`${label} execution_policy.${name} must be an object`);
    return;
  }
  if (!["inherit", "override"].includes(selection.mode)) {
    report.errors.push(`${label} execution_policy.${name}.mode must be 'inherit' or 'override'`);
  }
  const value = selection[valueKey];
  if (selection.mode === "override") {
    if (typeof value !== "string" || value.trim() === "") {
      report.errors.push(`${label} execution_policy.${name}.${valueKey} is required when mode is 'override'`);
    } else if (options.allowedValues && !options.allowedValues.includes(value)) {
      report.errors.push(
        `${label} execution_policy.${name}.${valueKey} '${value}' is not allowed. Valid values: ${options.allowedValues.join(", ")}`,
      );
    }
  }
}

function validateTraces(context, report, storyId = null) {
  const tracesRoot = path.join(context.sdlcRoot, "traces");
  const files = storyId
    ? [path.join(tracesRoot, `${storyId}.jsonl`)].filter((filePath) => fs.existsSync(filePath))
    : walkFiles(tracesRoot).filter((filePath) => filePath.endsWith(".jsonl"));
  const requireActor = context.config.trace_policy?.require_actor !== false;
  for (const filePath of files) {
    const label = `trace ${path.relative(context.sdlcRoot, filePath)}`;
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!line.trim()) {
        return;
      }
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        report.errors.push(`${label}:${index + 1} is not valid JSON`);
        return;
      }
      if (!TRACE_TYPES.has(event.type)) {
        report.errors.push(`${label}:${index + 1} has unknown type '${event.type}'`);
      }
      if (!event.summary || typeof event.summary !== "string") {
        report.errors.push(`${label}:${index + 1} is missing summary`);
      }
      if (!event.created_at || typeof event.created_at !== "string") {
        report.errors.push(`${label}:${index + 1} is missing created_at`);
      }
      if (requireActor && !hasTraceActor(event)) {
        report.errors.push(`${label}:${index + 1} is missing actor attribution`);
      }
      if (!event.action || typeof event.action !== "string") {
        report.errors.push(`${label}:${index + 1} is missing action`);
      }
      if (!event.git || typeof event.git !== "object") {
        report.errors.push(`${label}:${index + 1} is missing git metadata`);
      }
      if (!event.run || typeof event.run !== "object") {
        report.errors.push(`${label}:${index + 1} is missing run metadata`);
      }
      if (report.strict && ["test", "release"].includes(event.type)) {
        validateTraceEvidence(context, report, event, `${label}:${index + 1}`);
      }
    });
    report.checked.push(label);
  }
}

function validateTraceEvidence(context, report, event, label) {
  const evidence = Array.isArray(event.evidence) ? event.evidence.filter(Boolean) : [];
  if (evidence.length === 0) {
    report.errors.push(`${label} ${event.type} trace requires at least one evidence path`);
    return;
  }
  for (const evidencePathValue of evidence) {
    const evidencePath = resolveProjectFilePath(context, evidencePathValue, { mustExist: false });
    if (!fs.existsSync(evidencePath)) {
      report.errors.push(`${label} references missing evidence ${evidencePathValue}`);
    } else if (isDerivedArtifactPath(context, evidencePath)) {
      report.errors.push(`${label} uses derived cache/index evidence ${evidencePathValue}`);
    }
  }
}

function hasTraceActor(event) {
  if (typeof event.actor === "string") {
    return event.actor.trim().length > 0;
  }
  return Boolean(event.actor && typeof event.actor === "object" && String(event.actor.id || "").trim());
}

function validateStory(context, storyId, report) {
  const storyDir = path.join(context.sdlcRoot, "stories", storyId);
  const storyPath = path.join(storyDir, "story.json");
  if (!fs.existsSync(storyPath)) {
    report.errors.push(`Story ${storyId} is missing story.json`);
    return;
  }
  const story = readJson(storyPath);
  for (const field of context.config.gate_policy.story_required_fields) {
    if (story[field] === undefined || story[field] === null || story[field] === "") {
      report.errors.push(`Story ${storyId} is missing required field '${field}'`);
    }
  }
  if (story.id !== storyId) {
    report.errors.push(`Story ${storyId} story.json id '${story.id}' must match its folder id`);
  }
  if (!STORY_STATUSES.has(String(story.status || "").toLowerCase())) {
    report.errors.push(`Story ${storyId} has unknown status '${story.status}'`);
  }
  if (!context.config.phases[story.phase]) {
    report.errors.push(`Story ${storyId} has unknown phase '${story.phase}'`);
  }
  if (!Array.isArray(story.acceptance_criteria) || story.acceptance_criteria.length === 0) {
    const severity = story.status === "draft" ? "warnings" : "errors";
    report[severity].push(`Story ${storyId} has no acceptance criteria`);
  }
  const isImplementationLike = ["implementation", "in_progress", "review", "validation", "release", "done"].includes(
    String(story.status),
  ) || story.phase === "implementation";
  if (context.config.gate_policy.implementation_requires_claim && isImplementationLike) {
    const claimPath = path.join(storyDir, "claim.json");
    if (!fs.existsSync(claimPath)) {
      report.errors.push(`Story ${storyId} requires an active claim before implementation`);
    } else {
      const claim = readJson(claimPath);
      validateClaim(context, storyId, claim, report);
    }
  }
  if (story.contract_id) {
    const contractPath = path.join(context.sdlcRoot, "contracts", `${story.contract_id}.json`);
    if (!fs.existsSync(contractPath)) {
      report.errors.push(`Story ${storyId} references missing contract ${story.contract_id}`);
    } else {
      const contract = readJson(contractPath);
      if (contract.story_id && contract.story_id !== storyId) {
        report.errors.push(`Story ${storyId} contract ${story.contract_id} is bound to story ${contract.story_id}`);
      }
    }
  } else {
    const severity = report.strict ? "errors" : "warnings";
    report[severity].push(`Story ${storyId} has no contract_id`);
  }
  const traceEvents = readTraceEvents(context, storyId);
  if ((story.phase === "validation" || story.status === "validation") && !traceEvents.some((event) => event.type === "test")) {
    report.errors.push(`Story ${storyId} is in validation but has no test trace`);
  }
  if ((story.phase === "release" || story.status === "release") && !traceEvents.some((event) => event.type === "release")) {
    report.errors.push(`Story ${storyId} is in release but has no release trace`);
  }
  validateStoryBreakdown(context, story, report);
  validateStoryDependencies(context, story, report);
  validateStoryStepRecords(context, storyId, report);
  report.checked.push(`story ${storyId}`);
}

function validateStoryStepRecords(context, storyId, report) {
  const stepsRoot = path.join(context.sdlcRoot, "stories", storyId, "steps");
  for (const fileName of safeReadDir(stepsRoot).filter((name) => name.endsWith(".json"))) {
    const stepPath = path.join(stepsRoot, fileName);
    const record = readJson(stepPath);
    const label = `story step ${storyId}/${path.basename(fileName, ".json")}`;
    if (record.story_id !== storyId) {
      report.errors.push(`${label} story_id must match ${storyId}`);
    }
    if (!record.step || !STORY_STEP_NAMES.has(String(record.step))) {
      report.errors.push(`${label} has unknown step '${record.step}'`);
    }
    if (record.status !== "completed") {
      report.errors.push(`${label} has unsupported status '${record.status}'`);
    }
    if (!record.completed_at || !Number.isFinite(Date.parse(String(record.completed_at)))) {
      report.errors.push(`${label} is missing valid completed_at`);
    }
    const stepArtifacts = Array.isArray(record.artifacts) ? record.artifacts : [];
    const stepEvidence = Array.isArray(record.evidence) ? record.evidence : [];
    if (record.artifacts !== undefined && !Array.isArray(record.artifacts)) {
      report.errors.push(`${label} artifacts must be an array`);
    }
    if (record.evidence !== undefined && !Array.isArray(record.evidence)) {
      report.errors.push(`${label} evidence must be an array`);
    }
    for (const item of [...stepArtifacts, ...stepEvidence]) {
      const evidencePath = resolveProjectFilePath(context, item.path || item, { mustExist: false });
      const evidenceLabel = item.path || item;
      if (!fs.existsSync(evidencePath)) {
        report.errors.push(`${label} references missing evidence ${evidenceLabel}`);
      } else if (isDerivedArtifactPath(context, evidencePath)) {
        report.errors.push(`${label} uses derived cache/index evidence ${evidenceLabel}`);
      } else if (item.sha256 && hashFile(evidencePath) !== item.sha256) {
        report.errors.push(`${label} evidence changed after step completion: ${evidenceLabel}`);
      }
    }
    if (report.strict && Array.isArray(record.output_types) && record.output_types.length > 0) {
      const linkedTypes = new Set((record.output_links || []).map((link) => link.artifact_type));
      for (const artifactType of record.output_types) {
        if (!linkedTypes.has(artifactType)) {
          report.errors.push(`${label} completed ${artifactType} without a linked output`);
        }
      }
    }
    report.checked.push(label);
  }
}

function validateStoryBreakdown(context, story, report) {
  const breakdowns = readBreakdowns(context);
  const storyRefs = new Set([story.id]);
  const referenced = breakdowns.filter((breakdown) =>
    (breakdown.items || []).some((item) => item.type === "story" && storyRefs.has(item.id)) ||
    (story.work_breakdown_id && breakdown.id === story.work_breakdown_id),
  );
  if (referenced.length === 0) {
    return;
  }
  const implementationLike = ["implementation", "in_progress", "review", "validation", "release", "done"].includes(String(story.status)) ||
    ["implementation", "validation", "release"].includes(String(story.phase));
  for (const breakdown of referenced) {
    const label = `breakdown ${breakdown.id}`;
    if (breakdown.status !== "approved") {
      const severity = report.strict && implementationLike ? "errors" : "warnings";
      report[severity].push(`Story ${story.id} references ${label} but it is not approved`);
      continue;
    }
    if (!isApprovedRecordFresh(breakdown)) {
      report.errors.push(`Story ${story.id} references ${label} but its approval is stale; re-approve the breakdown`);
    }
    const approval = latestApprovedRecordApproval(breakdown);
    validateFormalApprovalRecord(context, report, approval, `${label} approval ${approval?.id || "unknown"}`, approval?.approved_by);
  }
}

function validateStoryDependencies(context, story, report) {
  const graph = readDependencyGraph(context, { missingOk: true });
  const relevant = (graph.edges || []).filter((edge) => edge.from === story.id);
  if (relevant.length === 0) {
    return;
  }
  for (const edge of relevant) {
    const state = inspectDependencyEdge(context, edge, story);
    if (!state.satisfied) {
      const severity = report.strict && state.blocking ? "errors" : "warnings";
      report[severity].push(`Story ${story.id} dependency ${state.message}`);
    }
  }
  for (const cycle of findBlockingDependencyCycles(graph.edges || [])) {
    if (cycle.includes(story.id)) {
      report.errors.push(`Story ${story.id} is part of blocking dependency cycle: ${cycle.join(" -> ")}`);
    }
  }
}

function validateClaim(context, storyId, claim, report) {
  if (claim.story_id !== storyId) {
    report.errors.push(`Story ${storyId} claim.story_id must match story id`);
  }
  if (!CLAIM_STATUSES.has(String(claim.status || "").toLowerCase())) {
    report.errors.push(`Story ${storyId} claim has unknown status '${claim.status}'`);
  }
  if (claim.status !== "active") {
    report.errors.push(`Story ${storyId} requires an active claim, found '${claim.status}'`);
  }
  if (!claim.agent) {
    report.errors.push(`Story ${storyId} active claim is missing agent`);
  }
  if (!claim.branch) {
    report.errors.push(`Story ${storyId} active claim is missing branch`);
  } else {
    const expectedBranch = String(context.config.parallel_work?.branch_pattern || "feature/<story-id>").replace("<story-id>", storyId);
    if (claim.branch !== expectedBranch) {
      const severity = report.strict && context.config.claim_policy?.require_branch_pattern !== false ? "errors" : "warnings";
      report[severity].push(`Story ${storyId} claim branch '${claim.branch}' does not match expected '${expectedBranch}'`);
    }
  }
  if (claim.expires_at && !Number.isFinite(Date.parse(String(claim.expires_at)))) {
    report.errors.push(`Story ${storyId} active claim has invalid expires_at '${claim.expires_at}'`);
  }
  if (isExpired(claim.expires_at)) {
    report.errors.push(`Story ${storyId} active claim expired at ${claim.expires_at}`);
  }
  const actor = claim.audit?.claimed_by;
  if (!actor || !actor.id) {
    report.warnings.push(`Story ${storyId} claim has no audit.claimed_by actor`);
  }
}

function readTraceEvents(context, storyId) {
  const tracePath = path.join(context.sdlcRoot, "traces", `${storyId}.jsonl`);
  if (!fs.existsSync(tracePath)) {
    return [];
  }
  return fs
    .readFileSync(tracePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { type: "invalid" };
      }
    });
}

function buildIndex(context) {
  const sourceFiles = collectKnowledgeSourceFiles(context);
  const sourceHashes = {};
  const entries = [];
  for (const filePath of sourceFiles) {
    const relativePath = toProjectPath(context, filePath);
    const extension = path.extname(filePath);
    const raw = fs.readFileSync(filePath, "utf8");
    const text = normalizeText(raw);
    sourceHashes[relativePath] = hashBuffer(Buffer.from(raw, "utf8"));
    entries.push({
      path: relativePath,
      title: inferTitle(filePath, raw),
      extension,
      size_bytes: Buffer.byteLength(raw),
      snippet: text.slice(0, 240),
      search_text: text,
    });
  }
  return {
    schema_version: context.config.schema_version,
    generated_at: now(),
    root: context.root,
    source_paths: Object.keys(sourceHashes).sort(),
    source_hashes: sourceHashes,
    entries,
  };
}

function getIndexStatus(context) {
  const indexPath = path.join(context.sdlcRoot, "indexes", "kb-index.json");
  if (!fs.existsSync(indexPath)) {
    return { exists: false, valid: false, index_path: indexPath, index: null };
  }
  let index;
  try {
    index = readJson(indexPath);
  } catch {
    return { exists: true, valid: false, index_path: indexPath, index: null };
  }
  const currentHashes = {};
  for (const filePath of collectKnowledgeSourceFiles(context)) {
    currentHashes[toProjectPath(context, filePath)] = hashFile(filePath);
  }
  const cachedHashes = index.source_hashes || {};
  const valid =
    index.schema_version === context.config.schema_version &&
    Object.keys(currentHashes).length === Object.keys(cachedHashes).length &&
    Object.entries(currentHashes).every(([sourcePath, hash]) => cachedHashes[sourcePath] === hash);
  return { exists: true, valid, index_path: indexPath, index };
}

function scoreEntry(entry, terms) {
  const text = entry.search_text.toLowerCase();
  let score = 0;
  for (const term of terms) {
    const occurrences = text.split(term).length - 1;
    score += occurrences;
    if (entry.path.toLowerCase().includes(term)) {
      score += 2;
    }
    if (String(entry.title || "").toLowerCase().includes(term)) {
      score += 3;
    }
  }
  return score;
}

function inferTitle(filePath, raw) {
  if (filePath.endsWith(".md")) {
    const header = raw.split(/\r?\n/).find((line) => line.startsWith("# "));
    return header ? header.replace(/^#\s+/, "").trim() : path.basename(filePath);
  }
  if (filePath.endsWith(".json")) {
    try {
      const data = JSON.parse(raw);
      return data.title || data.id || data.project_name || path.basename(filePath);
    } catch {
      return path.basename(filePath);
    }
  }
  return path.basename(filePath);
}

function ensureInitialized(context) {
  if (!fs.existsSync(path.join(context.sdlcRoot, "project.json"))) {
    fail(`No ${SDLC_DIR}/project.json found. Run 'agentic-sdlc init' first.`);
  }
}

function renderTemplateFile(context, templateName, destination, variables, options = {}) {
  const templatePath = path.join(context.templateDir, templateName);
  const rendered = renderTemplate(fs.readFileSync(templatePath, "utf8"), variables);
  writeTextFile(destination, rendered, options);
}

function renderTemplate(template, variables) {
  return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_, key) => {
    if (variables[key] === undefined) {
      return "";
    }
    return String(variables[key]);
  });
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    fail(`Unable to read JSON file ${filePath}: ${error.message}`);
  }
}

function writeJsonFile(filePath, value, options = {}) {
  writeTextFile(filePath, `${JSON.stringify(value, null, 2)}\n`, options);
}

function writeTextFile(filePath, content, options = {}) {
  assertNoSymlinkPathSegments(filePath);
  if (fs.existsSync(filePath) && !options.force) {
    if (fs.lstatSync(filePath).isSymbolicLink()) {
      fail(`Refusing to write through symlink: ${filePath}`);
    }
    const existing = fs.readFileSync(filePath, "utf8");
    if (existing === content) {
      return false;
    }
    fail(`File already exists: ${filePath}. Use --force to overwrite it.`);
  }
  ensureDir(path.dirname(filePath));
  try {
    fs.writeFileSync(filePath, content, { flag: options.force ? "w" : "wx" });
  } catch (error) {
    if (error && error.code === "EEXIST") {
      fail(`File already exists: ${filePath}. Use --force to overwrite it.`);
    }
    throw error;
  }
  return true;
}

function appendJsonLine(filePath, value) {
  assertNoSymlinkPathSegments(filePath);
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`);
}

function acquireFileLock(lockPath) {
  assertNoSymlinkPathSegments(lockPath);
  ensureDir(path.dirname(lockPath));
  try {
    const fd = fs.openSync(lockPath, "wx");
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, created_at: now() }));
    fs.closeSync(fd);
  } catch (error) {
    if (error && error.code === "EEXIST") {
      fail(`Resource is locked by another SDLC operation: ${lockPath}`);
    }
    throw error;
  }
  return () => {
    try {
      fs.rmSync(lockPath, { force: true });
    } catch {
      // Best effort cleanup; a remaining lock is safer than silent concurrent writes.
    }
  };
}

function assertNoSymlinkPathSegments(filePath) {
  const resolved = path.resolve(filePath);
  const root = path.parse(resolved).root;
  const parts = path.relative(root, resolved).split(path.sep).filter(Boolean);
  let current = root;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    current = path.join(current, part);
    if (index === 0) {
      continue;
    }
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) {
      fail(`Refusing to follow symlink while writing: ${current}`);
    }
  }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function safeReadDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }
  return fs.readdirSync(dirPath);
}

function walkFiles(startDir) {
  const results = [];
  for (const entry of safeReadDir(startDir)) {
    const fullPath = path.join(startDir, entry);
    const stat = fs.lstatSync(fullPath);
    if (stat.isSymbolicLink()) {
      continue;
    }
    if (stat.isDirectory()) {
      results.push(...walkFiles(fullPath));
    } else if (stat.isFile()) {
      results.push(fullPath);
    }
  }
  return results;
}

function countFiles(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return 0;
  }
  return walkFiles(dirPath).length;
}

function normalizeText(value) {
  return String(value)
    .replace(/[{}\[\]",:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(query) {
  return normalizeText(query)
    .toLowerCase()
    .split(" ")
    .filter((term) => term.length > 1);
}

function normalizeListOption(value) {
  if (value === undefined || value === null || value === true) {
    return [];
  }
  const values = Array.isArray(value) ? value : [value];
  return values
    .flatMap((item) => String(item).split("|"))
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeRawListOption(value) {
  if (value === undefined || value === null || value === true) {
    return [];
  }
  const values = Array.isArray(value) ? value : [value];
  return values.map((item) => String(item).trim()).filter(Boolean);
}

function normalizeScalarOption(value, key) {
  if (value === undefined || value === null || value === true) {
    return null;
  }
  if (Array.isArray(value)) {
    if (value.length > 1) {
      fail(`Option --${key} can be used only once`);
    }
    return normalizeScalarOption(value[0], key);
  }
  const text = String(value).trim();
  return text || null;
}

function normalizeReasoningLevels(value) {
  const fallback = ["inherit", "minimal", "low", "medium", "high"];
  const levels = Array.isArray(value) && value.length > 0 ? value : fallback;
  return levels.map((level) => String(level).trim().toLowerCase()).filter(Boolean);
}

function normalizeApprovalStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  const allowed = ["approved", "changes_requested", "rejected"];
  if (!allowed.includes(normalized)) {
    fail(`Unknown approval status '${value}'. Valid values: ${allowed.join(", ")}`);
  }
  return normalized;
}

function normalizeGitEvent(value) {
  const normalized = String(value || "").trim().toLowerCase();
  const allowed = ["push", "commit", "merge", "pull", "rebase", "branch", "handoff", "pr"];
  if (!allowed.includes(normalized)) {
    fail(`Unknown git event '${value}'. Valid values: ${allowed.join(", ")}`);
  }
  return normalized;
}

function normalizeHandoffCloseStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  const allowed = ["accepted", "closed", "cancelled"];
  if (!allowed.includes(normalized)) {
    fail(`Unknown handoff status '${value}'. Valid values: ${allowed.join(", ")}`);
  }
  return normalized;
}

function normalizeStoryStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!STORY_STATUSES.has(normalized)) {
    fail(`Unknown story status '${value}'. Valid values: ${Array.from(STORY_STATUSES).join(", ")}`);
  }
  return normalized;
}

function normalizeClaimStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!CLAIM_STATUSES.has(normalized)) {
    fail(`Unknown claim status '${value}'. Valid values: ${Array.from(CLAIM_STATUSES).join(", ")}`);
  }
  return normalized;
}

function normalizeLockStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!LOCK_STATUSES.has(normalized)) {
    fail(`Unknown lock status '${value}'. Valid values: ${Array.from(LOCK_STATUSES).join(", ")}`);
  }
  return normalized;
}

function normalizeOptionalDateTime(value, label) {
  const text = String(value || "").trim();
  const timestamp = Date.parse(text);
  if (!text || !Number.isFinite(timestamp)) {
    fail(`Invalid --${label} '${value}'. Use an ISO-8601 date-time.`);
  }
  return text;
}

function normalizeId(value) {
  const normalized = String(value).trim().replace(/\s+/g, "-");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(normalized)) {
    fail(`Invalid id '${value}'. Use only letters, numbers, dots, underscores, and hyphens; do not use path separators.`);
  }
  return normalized;
}

function isInsidePath(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-") || "project";
}

function requireOption(options, key) {
  const value = options[key];
  if (value === undefined || value === true || value === "") {
    fail(`Missing required option --${key}`);
  }
  return String(value);
}

function now() {
  return new Date().toISOString();
}

function shortDate() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

function compactTimestamp() {
  return new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
}

function output(options, jsonPayload, lines) {
  if (options.json) {
    console.log(JSON.stringify(jsonPayload, null, 2));
    return;
  }
  for (const line of lines) {
    console.log(line);
  }
}

function fail(message) {
  throw new UserError(message);
}

function printHelp() {
  console.log(`Agentic SDLC ${VERSION}

Usage:
  agentic-sdlc init [--project-name name] [--project-id id] [--root path]
  agentic-sdlc onboard existing-project [--project-name name] [--document path]
      [--source path] [--question text] [--summary text]
  agentic-sdlc baseline propose --id id [--document path] [--source path]
      [--question text] [--assumption text] [--summary text]
  agentic-sdlc baseline approve --id id --actor-type human|ci
      --approval-source explicit-user|ci|bootstrap [--summary text]
  agentic-sdlc baseline status [--id id]
  agentic-sdlc contract create --phase phase [--id id] [--story ST-001]
      [--context-file path] [--context-summary text] [--question text]
      [--qa "question|answer"] [--constraint text] [--assumption text]
      [--output-ref artifact-type:template-id:mode]
      [--model model-id] [--reasoning inherit|minimal|low|medium|high]
  agentic-sdlc contract approve --id contract-id
      --approval-source explicit-user|ci|bootstrap [--summary text] [--approval-evidence path]
  agentic-sdlc story create --id ST-001 --title title [--acceptance text]
  agentic-sdlc story claim --id ST-001 --agent name [--branch branch]
  agentic-sdlc story release --id ST-001 [--agent name] [--reason text]
  agentic-sdlc story complete-step --id ST-001 --step functional-analysis
      [--type artifact-type] [--artifact path] [--evidence path] [--release-claim]
  agentic-sdlc story prepare-handoff --id ST-001 --to-agent name
      [--artifact path] [--open-item text] [--release-claim]
  agentic-sdlc story handoff --id ST-001 --to-agent name [--artifact path]
  agentic-sdlc story handoff close --id handoff-id [--status closed|accepted|cancelled]
  agentic-sdlc story deps --id ST-001 [--json]
  agentic-sdlc work item create --type epic|task --id id --title title
      [--parent id] [--story ST-001] [--requirement REQ-001]
  agentic-sdlc breakdown policy show
  agentic-sdlc breakdown policy set [--delivery-unit story] [--strict-gate-unit story]
  agentic-sdlc breakdown propose --id id --requirement REQ-001 --item story:ST-001
  agentic-sdlc breakdown approve --id id --actor-type human|ci --approval-source explicit-user|ci|bootstrap
  agentic-sdlc breakdown status [--requirement REQ-001]
  agentic-sdlc dependency propose --id id --edge from:to:type:blocks:required_state
  agentic-sdlc dependency approve --id id --actor-type human|ci --approval-source explicit-user|ci|bootstrap
  agentic-sdlc dependency status [--story ST-001]
  agentic-sdlc capability profile propose --id id [--story ST-001] [--phase analysis]
      [--context-file path] [--profile-json json | --profile-file path]
  agentic-sdlc capability profile approve --id id --actor-type human|ci --approval-source explicit-user|ci|bootstrap
  agentic-sdlc capability recommend --id id --profile profile-id
      [--recommendation-json json | --recommendation-file path]
      [--available-capabilities-json json | --available-capabilities-file path]
  agentic-sdlc capability approve --id id --actor-type human|ci --approval-source explicit-user|ci|bootstrap [--approve-install]
  agentic-sdlc capability status [--story ST-001] [--profile profile-id] [--json]
  agentic-sdlc phase lock --phase phase [--reason text] [--expires-at iso]
  agentic-sdlc phase release --id lock-id [--reason text]
  agentic-sdlc trace append --type decision --summary text [--story ST-001]
      [--actor id] [--git-event push|commit|merge|pull|rebase]
  agentic-sdlc sync record --event push [--story ST-001] [--remote origin]
  agentic-sdlc output template propose --type artifact-type [--id id]
      [--from path | --body text] [--summary text]
  agentic-sdlc output template approve --id template-id
      --approval-source explicit-user|ci|bootstrap [--summary text] [--approval-evidence path]
  agentic-sdlc output resolve --story ST-001 --type artifact-type
  agentic-sdlc output link --story ST-001 --type artifact-type
      --artifact path --template template-id --mode reuse|delta|new
      [--base-artifact path] [--requirement REQ-001]
  agentic-sdlc output status --story ST-001 [--type artifact-type]
  agentic-sdlc route decide --intent-json json [--text raw] [--json]
  agentic-sdlc route --intent-file path [--text raw] [--json]
  agentic-sdlc cache rebuild
  agentic-sdlc cache status
  agentic-sdlc cache clear
  agentic-sdlc manifest rebuild
  agentic-sdlc trace compact [--story ST-001] [--before 90d] [--out path]
  agentic-sdlc archive closed [--before 90d] [--apply] [--out path]
  agentic-sdlc report activity [--since 3d] [--view business|dev|agent-verbose] [--out path]
  agentic-sdlc report query [--query-json json | --query-file path] [--text raw]
      [--out path] [--json]
  agentic-sdlc orchestrate status [--json]
  agentic-sdlc orchestrate plan [--limit n] [--json]
  agentic-sdlc gate check [--story ST-001] [--scope story|all] [--strict] [--out path] [--json]
  agentic-sdlc index rebuild
  agentic-sdlc kb search <query>
  agentic-sdlc status

Global options:
  --root path            Target project root. Defaults to current directory.
  --template-dir path    Template directory. Defaults to this plugin's templates.
  --json                 Print JSON output where supported.
  --force                Overwrite generated files where supported.

Attribution options:
  --actor id             Human, agent, or CI identity responsible for the action.
  --actor-type type      human, agent, system, ci, or unknown.
  --actor-name name      Display name for the actor.
  --actor-email email    Email for the actor when appropriate.
  --run-id id            External run identifier, if available.
  --thread-id id         Codex thread identifier, if available.
  --session-id id        Codex or CI session identifier, if available.

Contract context options:
  --context-file path    Attach a target-project file as contract context.
                         Repeatable. Stores relative path, hash, size, excerpt.
  --context-summary text Summarize project-specific context for this contract.
  --question text        Record an open question the agent/user must resolve.
  --qa "q|a"             Record an answered question. Repeatable.
  --constraint text      Record a project-specific constraint. Repeatable.
  --assumption text      Record a project-specific assumption. Repeatable.
  --input/--output text  Add project-specific contract inputs/outputs.
  --validation text      Add validation criteria.
  --tool text            Add an allowed tool class.
  --kb-write text        Add a required KB write target.
  --output-ref ref       Link a contract to expected output coverage.
                         Format: artifact-type:template-id:reuse|delta|new.

Contract execution policy options:
  --model model-id       Override the Codex model for agents using this contract.
                         Omit or pass "inherit" to reuse the main thread model.
  --reasoning level      Override agent reasoning level. Defaults to "inherit".
                         Built-in levels: inherit, minimal, low, medium, high.
  --execution-note text  Record a note about model or reasoning selection.
                         Repeatable.
  --capability-policy-json json
                         Attach contract capability policy JSON.
  --capability-policy-file path
                         Read capability policy JSON from a canonical file.
  --capability-binding-json json
                         Attach one capability binding JSON object. Repeatable.
  --capability-binding-file path
                         Read one capability binding from a canonical file.
                         Binding files must not point to cache/indexes.
  --capability-recommendation id
                         Apply an approved capability recommendation to the
                         contract. Repeatable. Pulls agreed policy, bindings,
                         open questions, and model/reasoning suggestions.
  --approval-evidence path
                         Attach canonical approval evidence and content hash.
                         Repeatable. Must not point to cache/indexes.
  --preserve-status      Record an approval without changing contract.status.

Approval governance options:
  --approval-source source
                         Formal approval source: explicit-user, ci,
                         automation, or bootstrap. For explicit-user,
                         provide --summary or --approval-evidence.
                         Permission to implement or push is not formal SDLC
                         approval.

Baseline onboarding options:
  --document path        Import a project or user-provided document as baseline
                         evidence. Repeatable.
  --source path          Extra project file or directory to hash into the
                         baseline source set. Repeatable.
  --confirmed-source id  Source name the user already confirmed as canonical.
                         Repeatable.

Trace options:
  --git-event event      Classify a sync trace as push, commit, merge, pull,
                         rebase, branch, or another project Git event.
  --event event          For sync record: push, commit, merge, pull, rebase,
                         branch, handoff, or pr.
  --remote name          Remote used for a sync event.
  --before-sha sha       SHA before a sync event when known.
  --after-sha sha        SHA after a sync event when known.
  --pr-url url           Pull request URL for pr/merge sync events.

Output consistency options:
  --type artifact-type   Output artifact class, for example functional-analysis.
  --from path            Use an existing project file as a proposed template body.
  --body text            Inline proposed template body.
  --artifact path        Canonical output artifact path. Must not be cache/index.
  --template id          Approved output template id.
  --mode mode            reuse, delta, or new.
  --base-artifact path   Required when --mode delta.
  --requirement id       Requirement covered by this output. Repeatable.
  --decision-id id       Approved decision justifying a duplicate/new structure.
  --rationale text       Short rationale for the link.

Route options:
  --intent-json json     Canonical normalized route intent JSON.
  --intent-file path     Read canonical route intent JSON from a project file.
  --text raw             Raw user text. The router records it as untrusted and
                         never classifies it without canonical intent JSON.

Report query options:
  --query-json json      Canonical report query JSON normalized from natural
                         language by Codex or another LLM.
  --query-file path      Read canonical report query JSON from a project file.
                         Must not point to cache/indexes.
  --text raw             Raw natural language request for audit/debug only.
                         Without --query-json/file, report query returns
                         a normalization request and examples.
  --limit n              Maximum query results, from 1 to 500.

Capability discovery options:
  --profile-json json    Canonical capability profile JSON normalized by Codex.
  --profile-file path    Read canonical capability profile JSON from a project file.
  --recommendation-json json
                         Canonical capability recommendation JSON.
  --recommendation-file path
                         Read capability recommendation JSON from a project file.
  --available-capabilities-json json
                         Snapshot of installed/available skills, MCPs, tools,
                         plugins, connectors, or models.
  --available-capabilities-file path
                         Read available capability snapshot from a project file.
  --approve-install      While approving a recommendation, also approve
                         install-required capabilities declared in it.

Gate options:
  --scope story|all      With --story, defaults to story-scoped validation.
  --strict               Enforce phase-exit/merge rules: approved human gates,
                         no blocking open questions, active claims,
                         attributed traces, approved output templates, and
                         no canonical outputs under cache/indexes.
  --out path             Persist a gate report as JSON or Markdown.

Principle:
  The plugin is stateless. Contracts, traces, and KB artifacts are written only
  to the target project's .sdlc directory.
`);
}

main();
