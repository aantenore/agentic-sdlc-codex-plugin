#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import childProcess from "node:child_process";
import os from "node:os";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const VERSION = "0.5.0";
const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_TEMPLATE_DIR = path.join(PLUGIN_ROOT, "templates");
const SDLC_DIR = ".sdlc";
const CACHE_FILE_NAME = "kb-cache.json";
const PROJECT_CONFIG_FILE_NAME = "config.json";
const INTERNAL_LOCK_WAIT_MS = 5000;
const INTERNAL_LOCK_STALE_MS = 30000;
const INTERNAL_LOCK_REMOTE_STALE_MS = 300000;
const NO_FOLLOW_FLAG = fs.constants.O_NOFOLLOW || 0;
const OUTPUT_LINK_MODES = new Set(["reuse", "delta", "new"]);
const OUTPUT_DELIVERY_MODES = new Set(["artifact", "artifact-plus-chat-summary"]);
const OUTPUT_VISUAL_FORMATS = new Set(["docx", "xlsx", "pdf", "pptx", "html"]);
const OUTPUT_FORMATS = Object.freeze({
  markdown: Object.freeze({
    label: "Markdown document",
    extension: ".md",
    media_type: "text/markdown",
    generator: null,
  }),
  docx: Object.freeze({
    label: "Word document",
    extension: ".docx",
    media_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    generator: "documents",
  }),
  xlsx: Object.freeze({
    label: "Excel workbook",
    extension: ".xlsx",
    media_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    generator: "spreadsheets",
  }),
  pdf: Object.freeze({
    label: "PDF document",
    extension: ".pdf",
    media_type: "application/pdf",
    generator: "pdf",
  }),
  pptx: Object.freeze({
    label: "PowerPoint presentation",
    extension: ".pptx",
    media_type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    generator: "presentations",
  }),
  html: Object.freeze({
    label: "HTML document",
    extension: ".html",
    media_type: "text/html",
    generator: null,
  }),
  json: Object.freeze({
    label: "JSON document",
    extension: ".json",
    media_type: "application/json",
    generator: null,
  }),
  csv: Object.freeze({
    label: "CSV table",
    extension: ".csv",
    media_type: "text/csv",
    generator: "spreadsheets",
  }),
  custom: Object.freeze({
    label: "Custom artifact",
    extension: null,
    media_type: "application/octet-stream",
    generator: null,
  }),
});
const OUTPUT_FORMAT_ALIASES = Object.freeze({
  md: "markdown",
  markdown: "markdown",
  word: "docx",
  doc: "docx",
  docx: "docx",
  excel: "xlsx",
  spreadsheet: "xlsx",
  workbook: "xlsx",
  xlsx: "xlsx",
  pdf: "pdf",
  powerpoint: "pptx",
  slides: "pptx",
  pptx: "pptx",
  html: "html",
  json: "json",
  csv: "csv",
  custom: "custom",
});
const BOOLEAN_OPTIONS = new Set([
  "allow-incomplete-contract",
  "allow-unapproved-contract-output",
  "allow-unapproved-output-ref",
  "apply",
  "approve-install",
  "confirm-start",
  "force",
  "help",
  "json",
  "preserve-status",
  "release-claim",
  "replace-story-contract",
  "revise-contract",
  "strict",
  "version",
]);
const KNOWN_OPTIONS = new Set([
  ...BOOLEAN_OPTIONS,
  "acceptance",
  "action",
  "actor",
  "actor-email",
  "actor-name",
  "actor-type",
  "after-sha",
  "agent",
  "approval-evidence",
  "approval-source",
  "authorization",
  "artifact",
  "assumption",
  "authorized-by",
  "authorized-by-email",
  "authorized-by-name",
  "authorized-by-source",
  "authorized-by-type",
  "available-capabilities-file",
  "available-capabilities-json",
  "base-artifact",
  "before",
  "before-sha",
  "body",
  "branch",
  "breakdown",
  "capability-binding-file",
  "capability-binding-json",
  "capability-policy-file",
  "capability-policy-json",
  "capability-recommendation",
  "completion-id",
  "confidence",
  "confirmed-source",
  "constraint",
  "context-file",
  "context-summary",
  "contract",
  "contract-id",
  "decision-id",
  "default-flow",
  "delivery-unit",
  "document",
  "delivery",
  "edge",
  "event",
  "evidence",
  "execution-note",
  "expires-at",
  "from",
  "format",
  "git-event",
  "handoff-id",
  "id",
  "input",
  "intent-file",
  "intent-json",
  "item",
  "kb-write",
  "kind",
  "limit",
  "levels",
  "metric",
  "media-type",
  "mode",
  "model",
  "next-step",
  "notes",
  "open-item",
  "out",
  "outcome",
  "output",
  "output-ref",
  "owner-agent",
  "parent",
  "phase",
  "pr-url",
  "preset",
  "profile",
  "profile-file",
  "profile-json",
  "project-id",
  "project-name",
  "qa",
  "query",
  "query-file",
  "query-json",
  "question",
  "rationale",
  "reason",
  "reasoning",
  "recommendation-file",
  "recommendation-json",
  "related",
  "remote",
  "request-id",
  "request-run-id",
  "request-session-id",
  "request-source",
  "request-summary",
  "request-thread-id",
  "requested-by",
  "requested-by-email",
  "requested-by-name",
  "requested-by-source",
  "requested-by-type",
  "requirement",
  "root",
  "run-id",
  "scope",
  "session-id",
  "since",
  "source",
  "status",
  "step",
  "story",
  "strict-gate-unit",
  "summary",
  "task-gate",
  "template",
  "template-dir",
  "text",
  "thread-id",
  "title",
  "to-agent",
  "tool",
  "generator",
  "extension",
  "allow-action",
  "allow-artifact-type",
  "allow-boundary",
  "allow-subject",
  "trace-limit",
  "type",
  "until",
  "validation",
  "view",
]);
const REPEATABLE_OPTIONS = new Set([
  "acceptance",
  "approval-evidence",
  "allow-action",
  "allow-artifact-type",
  "allow-boundary",
  "allow-subject",
  "artifact",
  "assumption",
  "capability-binding-file",
  "capability-binding-json",
  "capability-recommendation",
  "confirmed-source",
  "constraint",
  "context-file",
  "document",
  "edge",
  "evidence",
  "execution-note",
  "input",
  "item",
  "kb-write",
  "levels",
  "metric",
  "open-item",
  "output",
  "output-ref",
  "qa",
  "question",
  "related",
  "requirement",
  "source",
  "tool",
  "validation",
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
const TRACE_OUTCOMES = new Set(["passed", "failed", "blocked", "skipped", "ready"]);

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
    if (command === "doctor") {
      runDoctor(context, parsed.options);
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
    if (command === "approval" && subcommand === "requests") {
      showApprovalRequests(context, parsed.options);
      return;
    }
    if (command === "authorization" && subcommand === "grant") {
      grantAuthorization(context, parsed.options);
      return;
    }
    if (command === "authorization" && subcommand === "status") {
      showAuthorizations(context, parsed.options);
      return;
    }
    if (command === "authorization" && subcommand === "revoke") {
      revokeAuthorization(context, parsed.options);
      return;
    }
    if (command === "task" && subcommand === "start") {
      startTask(context, parsed.options);
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
      if (!key || !KNOWN_OPTIONS.has(key)) {
        fail(`Unknown option --${key || raw}`);
      }
      const inlineValue = equalsIndex >= 0 ? raw.slice(equalsIndex + 1) : undefined;
      let value = inlineValue;
      if (BOOLEAN_OPTIONS.has(key)) {
        const next = argv[index + 1];
        if (value === undefined && next !== undefined && /^(?:true|false)$/i.test(next)) {
          value = parseBooleanOption(key, next);
          index += 1;
        } else {
          value = value === undefined ? true : parseBooleanOption(key, value);
        }
      } else if (value === undefined) {
        const next = argv[index + 1];
        if (next === undefined || next.startsWith("-")) {
          fail(`Missing value for option --${key}`);
        }
        value = next;
        index += 1;
      }
      addOption(options, key, value);
      continue;
    }
    positionals.push(arg);
  }

  return { options, positionals, help, version };
}

function parseBooleanOption(key, value) {
  if (value === true || value === false) {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  fail(`Option --${key} expects true or false, received '${value}'`);
}

function addOption(options, key, value) {
  if (options[key] === undefined) {
    options[key] = value;
    return;
  }
  if (!REPEATABLE_OPTIONS.has(key)) {
    fail(`Option --${key} may only be provided once`);
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
  if (fs.existsSync(projectConfigPath)) {
    resolveProjectFilePath({ root }, projectConfigPath, { mustExist: true, fileOnly: true });
    assertNoSymlinkPathSegments(projectConfigPath);
  }
  const selectedConfig = fs.existsSync(projectConfigPath)
    ? validateSdlcConfig(readProjectJson({ root }, projectConfigPath))
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
  validateBranchPolicy(config.parallel_work);
  return config;
}

function validateBranchPolicy(policy = {}) {
  const configured = policy?.branch_patterns ?? (policy?.branch_pattern ? [policy.branch_pattern] : []);
  if (!Array.isArray(configured)) {
    fail("parallel_work.branch_patterns must be an array");
  }
  for (const pattern of configured) {
    const value = String(pattern || "");
    const invalid =
      !value.includes("<story-id>") ||
      /[\\\s~^:?*\[]/.test(value) ||
      value.includes("..") ||
      value.includes("//") ||
      value.startsWith("/") ||
      value.endsWith("/") ||
      value.endsWith(".");
    if (invalid) {
      fail(`Invalid parallel_work branch pattern '${value}'`);
    }
  }
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

function startTask(context, options) {
  const decision = buildTaskStartDecision(context, options);
  if (decision.execution_allowed && options["confirm-start"]) {
    const attribution = buildAttribution(context, options, "task.start.confirm");
    const taskContract = decision.contract_id
      ? readContractById(context, decision.contract_id, { missingOk: true })
      : null;
    const authorization = attribution.actor.type === "human"
      ? null
      : requireAutomationAuthorization(context, options, attribution.action, {
          label: `task start${decision.story_id ? ` for ${decision.story_id}` : ""}`,
          subject_id: decision.story_id || "PROJECT",
          artifact_types: contractArtifactTypes(taskContract || {}),
        });
    const trace = appendTraceEvent(context, decision.story_id || null, {
      type: "decision",
      summary: `Confirmed start for ${decision.route}${decision.contract_id ? ` under ${decision.contract_id}` : ""}`,
      action: "task.start.confirm",
      actor: attribution.actor,
      ...buildTraceAuthorityMetadata(context, options, attribution),
      evidence: decision.contract?.path ? [decision.contract.path] : [],
      related: [decision.story_id, decision.contract_id].filter(Boolean),
      authorization_ref: authorization?.id || null,
      git: attribution.git,
      run: attribution.run,
    });
    decision.confirmation_trace_id = trace.id;
    decision.authorization_ref = authorization?.id || null;
    decision.task_start_receipt = writeTaskStartReceipt(context, decision, attribution, authorization);
  }
  output(options, decision, formatTaskStartDecision(decision));
}

function writeTaskStartReceipt(context, decision, attribution, authorization = null) {
  const receipt = {
    id: `START-${decision.story_id || "PROJECT"}-${uniqueRecordSuffix()}`,
    story_id: decision.story_id || null,
    phase: decision.phase || null,
    route: decision.route,
    contract_id: decision.contract_id || null,
    contract_approval_hash: decision.contract_id
      ? latestContractApproval(readContractById(context, decision.contract_id, { missingOk: true }) || {})?.approved_content_hash || null
      : null,
    status: "confirmed",
    authorization_ref: authorization?.id || null,
    confirmed_by: attribution.actor,
    confirmed_at: now(),
    audit: { git: attribution.git, run: attribution.run },
  };
  const receiptPath = decision.story_id
    ? path.join(context.sdlcRoot, "stories", decision.story_id, "task-start.json")
    : path.join(context.sdlcRoot, "reports", "project-task-start.json");
  writeJsonFile(receiptPath, receipt, { force: true });
  return toProjectPath(context, receiptPath);
}

function buildTaskStartDecision(context, options) {
  const routeDecision = buildRouteDecision(context, options);
  const policy = getRoutingPolicy(context);
  const intentStoryId = routeDecision.intent ? routeStoryId(routeDecision.intent, policy) : null;
  const explicitStoryId = getOptionString(options, "story")
    ? normalizeId(getOptionString(options, "story"))
    : null;
  const storyId = explicitStoryId || intentStoryId;
  const phase = inferTaskPhase(routeDecision, options);
  const explicitContractId = getOptionString(options, "contract-id") ||
    (routeDecision.intent ? routeEntityId(routeDecision.intent, policy, "contract") : null);
  const result = {
    kind: "task_start",
    schema_version: context.config.schema_version || context.templateConfig.schema_version,
    sdlc_version: VERSION,
    generated_at: now(),
    root: context.root,
    status: "needs_user_input",
    execution_allowed: false,
    route: routeDecision.route,
    phase,
    story_id: storyId,
    contract_id: explicitContractId || null,
    contract_action: null,
    requires_confirmation: routeDecision.requires_confirmation && !options["confirm-start"],
    blocking_reasons: [],
    questions: [],
    deterministic_checks: [],
    next_commands: [],
    approval_requests: [],
    route_decision: routeDecision,
  };
  pushAllUnique(result.blocking_reasons, routeDecision.blocking_reasons);
  pushAllUnique(result.questions, routeDecision.questions);
  pushAllUnique(result.next_commands, routeDecision.next_commands);

  if (explicitStoryId && intentStoryId && explicitStoryId !== intentStoryId) {
    result.status = "needs_user_input";
    result.contract_action = "normalize_request";
    pushAllUnique(result.blocking_reasons, ["story_reference_mismatch"]);
    pushAllUnique(result.questions, [
      `The command names story ${explicitStoryId}, but the normalized request names ${intentStoryId}. Confirm the one story this task should use.`,
    ]);
    result.deterministic_checks.push({
      check: "story_reference_consistency",
      status: "failed",
      details: `${explicitStoryId} != ${intentStoryId}`,
    });
    return dedupeTaskStartDecision(result);
  }

  if (routeDecision.route === "ask_clarification" || routeDecision.status === "needs_normalization") {
    result.status = routeDecision.status === "needs_normalization" ? "needs_normalization" : "needs_user_input";
    result.contract_action = "normalize_request";
    return dedupeTaskStartDecision(result);
  }

  if (!isKbInitialized(context)) {
    result.status = "needs_user_input";
    result.contract_action = "initialize_sdlc";
    pushAllUnique(result.blocking_reasons, ["kb_not_initialized"]);
    pushAllUnique(result.questions, ["Initialize or onboard the project SDLC before starting task work."]);
    return dedupeTaskStartDecision(result);
  }

  if (routeDecision.route === "init_project" || routeDecision.route === "onboard_existing_project") {
    result.status = "needs_user_input";
    result.contract_action = routeDecision.route;
    pushAllUnique(result.blocking_reasons, [`${routeDecision.route}_required`]);
    pushAllUnique(result.questions, ["Complete the project baseline step before starting phase work."]);
    return dedupeTaskStartDecision(result);
  }

  if (explicitContractId && storyId) {
    const explicitContract = readContractById(context, explicitContractId, { missingOk: true });
    if (explicitContract && explicitContract.story_id !== storyId) {
      result.status = "contract_revision_required";
      result.contract_action = "revise_contract";
      result.contract_id = explicitContract.id;
      result.contract = summarizeTaskContract(context, explicitContract);
      pushAllUnique(result.blocking_reasons, ["contract_story_mismatch"]);
      pushAllUnique(result.questions, [
        `Contract ${explicitContract.id} belongs to ${explicitContract.story_id || "the project"}, not story ${storyId}. Select or create a contract bound to the requested story.`,
      ]);
      result.deterministic_checks.push({
        check: "contract_story_consistency",
        status: "failed",
        details: `${explicitContract.story_id || "PROJECT"} != ${storyId}`,
      });
      pushAllUnique(result.next_commands, contractNegotiationCommands(phase, storyId, null));
      return dedupeTaskStartDecision(result);
    }
  }

  if (routeDecision.route === "confirm_phase_skip") {
    result.status = "needs_user_input";
    result.contract_action = "confirm_phase_skip";
    pushAllUnique(result.blocking_reasons, ["phase_skip_requires_confirmation"]);
    pushAllUnique(result.questions, ["Confirm the requested phase skip explicitly before continuing."]);
    return dedupeTaskStartDecision(result);
  }

  if (routeDecision.route === "create_contract") {
    result.status = "needs_user_input";
    result.contract_action = "create_or_revise_contract";
    pushAllUnique(result.blocking_reasons, ["contract_negotiation_required"]);
    pushAllUnique(result.questions, [contractNegotiationQuestion(phase, storyId)]);
    pushAllUnique(result.next_commands, contractNegotiationCommands(phase, storyId, explicitContractId));
    result.approval_requests = collectApprovalRequests(context, { storyId });
    return dedupeTaskStartDecision(result);
  }

  const activeBaselines = selectActiveBaselines(context, storyId);
  const unreadyBaselines = activeBaselines.filter(
    (baseline) =>
      baseline.status !== "approved" ||
      !isApprovedRecordFresh(baseline) ||
      validateBaselineSourceHashes(context, baseline, `baseline ${baseline.id}`, { collectOnly: true }).length > 0,
  );
  if (unreadyBaselines.length > 0) {
    result.status = "needs_user_input";
    result.contract_action = "approve_or_refresh_project_context";
    pushAllUnique(result.blocking_reasons, ["baseline_not_ready"]);
    pushAllUnique(result.questions, ["Refresh or approve the active project context before phase work starts."]);
    result.approval_requests = collectApprovalRequests(context, { storyId });
    return dedupeTaskStartDecision(result);
  }

  if (!phase || !taskRouteRequiresContract(routeDecision.route)) {
    return finalizeTaskStartExecution(context, result, routeDecision, options);
  }

  const contractState = findApplicableTaskContract(context, {
    phase,
    storyId,
    contractId: explicitContractId,
  });
  result.contract_id = contractState.contract?.id || explicitContractId || null;
  result.contract = contractState.contract
    ? summarizeTaskContract(context, contractState.contract)
    : null;
  for (const check of contractState.checks) {
    result.deterministic_checks.push(check);
  }

  if (!contractState.contract) {
    result.status = "needs_user_input";
    result.contract_action = "create_contract";
    pushAllUnique(result.blocking_reasons, ["missing_contract"]);
    pushAllUnique(result.questions, [contractNegotiationQuestion(phase, storyId)]);
    pushAllUnique(result.next_commands, contractNegotiationCommands(phase, storyId, explicitContractId));
    result.approval_requests = collectApprovalRequests(context, { storyId });
    return dedupeTaskStartDecision(result);
  }

  if (storyId && contractState.contract.story_id !== storyId) {
    result.status = "contract_revision_required";
    result.contract_action = "revise_contract";
    pushAllUnique(result.blocking_reasons, ["contract_story_mismatch"]);
    pushAllUnique(result.questions, [
      `Contract ${contractState.contract.id} belongs to ${contractState.contract.story_id || "the project"}, not story ${storyId}. Select or create a contract bound to the requested story.`,
    ]);
    result.deterministic_checks.push({
      check: "contract_story_consistency",
      status: "failed",
      details: `${contractState.contract.story_id || "PROJECT"} != ${storyId}`,
    });
    pushAllUnique(result.next_commands, contractNegotiationCommands(phase, storyId, null));
    return dedupeTaskStartDecision(result);
  }

  if (options["revise-contract"]) {
    result.status = "contract_revision_required";
    result.contract_action = "revise_contract";
    pushAllUnique(result.blocking_reasons, ["contract_revision_requested"]);
    pushAllUnique(result.questions, [`What should change in contract ${contractState.contract.id} before this task starts?`]);
    pushAllUnique(result.next_commands, contractNegotiationCommands(phase, storyId, contractState.contract.id, { force: true }));
    result.approval_requests = collectApprovalRequests(context, { storyId });
    return dedupeTaskStartDecision(result);
  }

  if (contractState.phaseMismatch) {
    result.status = "contract_revision_required";
    result.contract_action = "revise_contract";
    pushAllUnique(result.blocking_reasons, ["contract_phase_mismatch"]);
    pushAllUnique(result.questions, [
      `Contract ${contractState.contract.id} is for ${contractState.contract.phase}; confirm whether to revise it or create a ${phase} contract.`,
    ]);
    pushAllUnique(result.next_commands, contractNegotiationCommands(phase, storyId, contractState.contract.id, { force: true }));
    return dedupeTaskStartDecision(result);
  }

  const gaps = collectContractReadinessGaps(context, contractState.contract);
  if (gaps.length > 0) {
    result.status = "needs_user_input";
    result.contract_action = "clarify_contract";
    pushAllUnique(result.blocking_reasons, ["contract_incomplete"]);
    pushAllUnique(result.questions, gaps.map((gap) => gap.question));
    result.approval_requests = collectApprovalRequests(context, { storyId });
    return dedupeTaskStartDecision(result);
  }

  const freshnessGaps = collectContractDependencyFreshnessGaps(context, contractState.contract);
  if (freshnessGaps.length > 0) {
    result.status = "contract_revision_required";
    result.contract_action = "refresh_contract_dependencies";
    pushAllUnique(result.blocking_reasons, ["contract_dependencies_stale"]);
    pushAllUnique(result.questions, freshnessGaps.map((gap) => gap.question));
    pushAllUnique(result.next_commands, contractNegotiationCommands(phase, storyId, contractState.contract.id, { force: true }));
    result.approval_requests = collectApprovalRequests(context, { storyId });
    return dedupeTaskStartDecision(result);
  }

  if (!isTaskContractApproved(context, contractState.contract)) {
    result.status = "needs_user_input";
    result.contract_action = "approve_contract";
    pushAllUnique(result.blocking_reasons, ["contract_not_approved"]);
    pushAllUnique(result.questions, [
      `Review contract ${contractState.contract.id}. Do you approve it for this ${phase} task, or should it be changed?`,
    ]);
    pushAllUnique(result.next_commands, [
      `agentic-sdlc approval requests${storyId ? ` --story ${storyId}` : ""}`,
    ]);
    result.approval_requests = collectApprovalRequests(context, { storyId });
    return dedupeTaskStartDecision(result);
  }

  return finalizeTaskStartExecution(context, result, routeDecision, options);
}

function finalizeTaskStartExecution(context, result, routeDecision, options) {
  if (result.blocking_reasons.length > 0) {
    result.status = "needs_user_input";
    result.execution_allowed = false;
    result.contract_action = "resolve_route_blockers";
    result.approval_requests = result.approval_requests.length
      ? result.approval_requests
      : collectApprovalRequests(context, { storyId: result.story_id || null });
    return dedupeTaskStartDecision(result);
  }
  if (routeDecision.requires_confirmation && !options["confirm-start"]) {
    result.status = "needs_user_input";
    result.execution_allowed = false;
    result.contract_action = "confirm_start";
    pushAllUnique(result.blocking_reasons, ["route_requires_confirmation"]);
    pushAllUnique(result.questions, [
      `Confirm task start for route ${routeDecision.route}${result.contract_id ? ` under contract ${result.contract_id}` : ""}.`,
    ]);
    return dedupeTaskStartDecision(result);
  }
  result.status = "ready_to_execute";
  result.execution_allowed = true;
  result.contract_action = "use_contract";
  return dedupeTaskStartDecision(result);
}

function inferTaskPhase(routeDecision, options = {}) {
  const explicitPhase = options.phase ? normalizeRoutePhase(options.phase) : null;
  if (explicitPhase) {
    return explicitPhase;
  }
  const intentPhase = routeDecision.intent?.proposed_phase || null;
  if (intentPhase) {
    return intentPhase;
  }
  switch (routeDecision.route) {
    case "intake_requirement":
      return "discovery";
    case "decompose_stories":
      return "design";
    case "classify_artifact":
    case "discover_capabilities":
    case "technical_decision":
      return "analysis";
    case "claim_and_implement":
      return "implementation";
    case "validate_story":
      return "validation";
    case "release_story":
      return "release";
    default:
      return null;
  }
}

function taskRouteRequiresContract(route) {
  return [
    "intake_requirement",
    "classify_artifact",
    "decompose_stories",
    "discover_capabilities",
    "technical_decision",
    "claim_and_implement",
    "validate_story",
    "release_story",
  ].includes(route);
}

function findApplicableTaskContract(context, options = {}) {
  const checks = [];
  const phase = options.phase || null;
  const storyId = options.storyId || null;
  const contractId = options.contractId ? normalizeId(options.contractId) : null;
  if (contractId) {
    const explicit = readContractById(context, contractId);
    checks.push({
      check: "explicit_contract",
      status: explicit ? "passed" : "failed",
      details: explicit ? contractId : `Missing contract ${contractId}`,
    });
    return {
      contract: explicit,
      phaseMismatch: Boolean(explicit && phase && explicit.phase !== phase),
      checks,
    };
  }

  const contracts = collectJsonFiles(context, path.join(context.sdlcRoot, "contracts"));
  const storyContracts = storyId
    ? contracts.filter((contract) => contract.story_id === storyId)
    : [];
  const storyPhaseContracts = storyContracts.filter((contract) => !phase || contract.phase === phase);
  if (storyId) {
    checks.push({
      check: "story_phase_contract",
      status: storyPhaseContracts.length > 0 ? "passed" : "failed",
      details: storyPhaseContracts.length > 0 ? storyPhaseContracts.map((contract) => contract.id).join(", ") : `No ${phase || "phase"} contract bound to ${storyId}`,
    });
    if (storyPhaseContracts.length > 0) {
      return {
        contract: newestContract(storyPhaseContracts),
        phaseMismatch: false,
        checks,
      };
    }
    const story = readStory(context, storyId);
    const linkedContract = story?.contract_id ? readContractById(context, story.contract_id) : null;
    checks.push({
      check: "story_linked_contract",
      status: linkedContract ? "passed" : "failed",
      details: linkedContract ? story.contract_id : `Story ${storyId} has no existing contract for this task`,
    });
    return {
      contract: linkedContract,
      phaseMismatch: Boolean(linkedContract && phase && linkedContract.phase !== phase),
      checks,
    };
  }

  const phaseContracts = contracts.filter((contract) => !contract.story_id && (!phase || contract.phase === phase));
  checks.push({
    check: "phase_contract",
    status: phaseContracts.length > 0 ? "passed" : "failed",
    details: phaseContracts.length > 0 ? phaseContracts.map((contract) => contract.id).join(", ") : `No project-level ${phase || "phase"} contract`,
  });
  return {
    contract: phaseContracts.length > 0 ? newestContract(phaseContracts) : null,
    phaseMismatch: false,
    checks,
  };
}

function readContractById(context, contractId, options = {}) {
  const id = normalizeId(contractId);
  const contractPath = path.join(context.sdlcRoot, "contracts", `${id}.json`);
  if (!fs.existsSync(contractPath)) {
    if (options.missingOk) {
      return null;
    }
    return null;
  }
  resolveProjectFilePath(context, toProjectPath(context, contractPath), { mustExist: true, fileOnly: true });
  assertNoSymlinkPathSegments(contractPath);
  const contract = readProjectJson(context, contractPath);
  contract.__path = contractPath;
  contract.__relative_path = toProjectPath(context, contractPath);
  return contract;
}

function newestContract(contracts) {
  return [...contracts].sort((left, right) => String(right.updated_at || right.created_at || "").localeCompare(String(left.updated_at || left.created_at || "")))[0] || null;
}

function summarizeTaskContract(context, contract) {
  const gaps = collectContractReadinessGaps(context, contract);
  const freshnessGaps = collectContractDependencyFreshnessGaps(context, contract);
  return {
    id: contract.id,
    phase: contract.phase || null,
    story_id: contract.story_id || null,
    status: contract.status || null,
    approved: isTaskContractApproved(context, contract),
    readiness_gaps: gaps.map((gap) => gap.code),
    freshness_gaps: freshnessGaps.map((gap) => gap.code),
    path: contract.__relative_path || (contract.__path ? toProjectPath(context, contract.__path) : null),
  };
}

function isTaskContractApproved(context, contract) {
  return (
    contract.status === "approved" &&
    hasFreshApprovedContractApproval(contract) &&
    contractApprovalGovernanceErrors(context, contract).length === 0 &&
    collectContractDependencyFreshnessGaps(context, contract).length === 0
  );
}

function contractApprovalGovernanceErrors(context, contract) {
  const approval = latestContractApproval(contract);
  if (!approval) {
    return ["Contract has no approval record"];
  }
  const report = { strict: true, errors: [], warnings: [] };
  validateFormalApprovalRecord(
    context,
    report,
    approval,
    `contract ${contract.id || "unknown"} approval ${approval.id || "unknown"}`,
    approval.approved_by,
    {
      subject_id: contract.id || null,
      artifact_types: contractArtifactTypes(contract),
    },
  );
  return report.errors;
}

function contractNegotiationQuestion(phase, storyId) {
  const subject = storyId ? `story ${storyId}` : "this project";
  const phaseLabel = phase || "the requested phase";
  return `No approved ${phaseLabel} contract is ready for ${subject}. Confirm the expected output, delivery/presentation format, boundaries, constraints, and approval rules before work starts.`;
}

function contractNegotiationCommands(phase, storyId, contractId = null, options = {}) {
  const normalizedPhase = phase || "<phase>";
  const id = contractId || (storyId ? `contract-${storyId}-${normalizedPhase}` : `contract-${normalizedPhase}-<id>`);
  return [
    `agentic-sdlc contract create --phase ${normalizedPhase}${storyId ? ` --story ${storyId}` : ""} --id ${id} --context-summary <summary> --qa "<question>|<answer>"${options.force ? " --force" : ""}`,
    `agentic-sdlc approval requests${storyId ? ` --story ${storyId}` : ""}`,
  ];
}

function dedupeTaskStartDecision(decision) {
  decision.blocking_reasons = Array.from(new Set(decision.blocking_reasons));
  decision.questions = Array.from(new Set(decision.questions));
  decision.next_commands = Array.from(new Set(decision.next_commands));
  decision.assistant_message = renderTaskStartAssistantMessage(decision);
  attachAssistantMessagePresentation(decision);
  return decision;
}

function renderTaskStartAssistantMessage(decision) {
  if (decision.approval_requests?.length > 0) {
    return renderApprovalRequestsAssistantMessage(decision.approval_requests);
  }
  if (decision.status === "ready_to_execute") {
    return [
      "The work is ready to start.",
      decision.phase ? `Work type: ${decision.phase}.` : null,
      decision.story_id ? `Work item: ${decision.story_id}.` : null,
      decision.contract_id ? `Work brief: ${decision.contract_id}.` : null,
    ].filter(Boolean).join("\n");
  }
  const explanations = Array.from(new Set((decision.blocking_reasons || []).map(userFriendlyBlockingReason))).filter(Boolean);
  const lines = [
    "I need one quick decision before I continue.",
    userFriendlyTaskStartIntro(decision),
    "",
    explanations.length ? "In plain language:" : null,
    ...explanations.map((explanation) => `- ${explanation}`),
    decision.questions?.length ? "What I need from you:" : null,
    ...(decision.questions || []).map((question) => `- ${question}`),
    decision.next_commands?.length ? "Agent command hints, not something you need to run:" : null,
    ...(decision.next_commands || []).map((command) => `- ${command}`),
    "",
    'You can answer naturally, for example "use README.md and src/ as context", "the proposed format is fine", or "change the scope to include X".',
  ];
  return lines.filter(Boolean).join("\n");
}

function userFriendlyTaskStartIntro(decision) {
  switch (decision.contract_action) {
    case "normalize_request":
      return "I need to translate the request into a precise action before using the project workflow.";
    case "initialize_sdlc":
      return "This project has not been prepared yet, so I need to create or confirm its starting context first.";
    case "create_or_revise_contract":
    case "create_contract":
      return "There is no agreed work brief for this step yet, so I need to confirm what I am allowed to do and what I should produce.";
    case "clarify_contract":
      return "The work brief is incomplete, so I need the project context or files that should guide the work before I produce an output.";
    case "approve_contract":
      return "I found a work brief, but you have not confirmed that it matches what you want me to do.";
    case "confirm_start":
      return "The work is defined, but I need your explicit go-ahead before starting it.";
    case "revise_contract":
      return "The work brief needs to be changed before this task can start.";
    default:
      return "I am pausing so I do not invent context, choose an output format, or start work without your decision.";
  }
}

function userFriendlyBlockingReason(code) {
  const explanations = {
    active_claim_exists: "Someone or another agent is already working on the same story, so I should not edit over them.",
    active_claim_expired: "A previous work claim is still recorded but expired; it needs cleanup before new work starts.",
    approved_template_missing: "The structure of the output is not agreed yet. For an assessment, this means confirming the sections and level of detail before I write it.",
    artifact_type_required: "I need to know what kind of output I should create, for example a technical assessment, test plan, or release note.",
    capability_profile_missing: "I have not confirmed which project files, tools, skills, and external access are appropriate for this work.",
    baseline_not_ready: "The active project context is not approved from current evidence yet.",
    contract_incomplete: "The work brief is missing project-specific context, such as which files are trusted inputs or what boundaries I must respect.",
    contract_needs_approval: "The work brief exists, but it has not been approved for execution.",
    contract_negotiation_required: "I need an agreed work brief before producing durable work.",
    contract_not_approved: "The work brief exists, but you still need to confirm it or ask for changes.",
    contract_phase_mismatch: "The selected work brief is for a different kind of work, so it needs to be revised or replaced.",
    contract_revision_requested: "You asked to revise the work brief before starting.",
    invalid_canonical_intent: "The request was not normalized into a supported action.",
    invalid_intent_json: "The structured request could not be read safely.",
    kb_not_initialized: "The project context store has not been initialized yet.",
    low_confidence: "The request is ambiguous enough that I should ask instead of guessing.",
    missing_acceptance_criteria: "The story does not yet define observable success criteria.",
    missing_context: "Important context is missing, so I need your answer before continuing.",
    missing_contract: "There is no work brief for this step yet.",
    needs_normalization: "The request is still raw natural language and needs to be normalized before the workflow can route it.",
    output_already_linked: "An output already exists for this story and type; I need to know whether to reuse it, update it, or create a separate one.",
    phase_skip_requires_confirmation: "Skipping a phase is a deliberate choice and needs explicit confirmation.",
    route_requires_confirmation: "The requested action is clear, but starting it still needs your go-ahead.",
    story_contract_missing: "The story does not yet have an agreed work brief.",
    story_not_found: "The referenced story does not exist yet.",
    story_reference_required: "I need to know which story this work belongs to.",
    unknown_requested_action: "The normalized action is not one of the supported workflow actions.",
    unknown_route: "The workflow could not map this request to a supported route.",
  };
  if (explanations[code]) {
    return explanations[code];
  }
  return String(code || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatTaskStartDecision(decision) {
  const lines = [
    decision.assistant_message || null,
    "",
    `Task start: ${decision.status}`,
    `Execution allowed: ${decision.execution_allowed ? "yes" : "no"}`,
    `Route: ${decision.route}`,
    `Phase: ${decision.phase || "n/a"}`,
    `Story: ${decision.story_id || "n/a"}`,
    `Contract: ${decision.contract_id || "n/a"}`,
    `Contract action: ${decision.contract_action || "n/a"}`,
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
  if (decision.approval_requests.length > 0) {
    lines.push("Human input requests:");
    lines.push(...decision.approval_requests.map((request) => `- ${request.title || request.summary}: ${request.user_prompt || request.summary}`));
  }
  if (decision.next_commands.length > 0) {
    lines.push("Next commands:");
    lines.push(...decision.next_commands.map((command) => `- ${command}`));
  }
  return lines.filter((line) => line !== null && line !== undefined);
}

function buildRouteDecision(context, options) {
  const policy = getRoutingPolicy(context);
  const intentLoad = loadRouteIntent(context, options);
  const decision = createRouteDecision(context, {
    intent_source: intentLoad.source,
    confidence: intentLoad.intent?.confidence,
  });
  decision.requesting_actor = buildActor(options, context.root);

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
  const technicalAnalysisAction = () => ({
    route: "classify_artifact",
    confirmation_key: "create_canonical_artifact",
    default_artifact_type: "technical-analysis",
    requires_artifact_type: true,
  });
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
    technical_analysis: technicalAnalysisAction(),
    technical_assessment: technicalAnalysisAction(),
    initial_technical_assessment: technicalAnalysisAction(),
    project_technical_assessment: technicalAnalysisAction(),
    project_assessment: technicalAnalysisAction(),
    architecture_assessment: technicalAnalysisAction(),
    technical_review: technicalAnalysisAction(),
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
    decision.next_commands.push(`agentic-sdlc approval requests --story ${storyId}`);
  } else {
    decision.next_commands.push(`agentic-sdlc contract create --phase ${phase} --context-summary <summary>`);
    decision.next_commands.push("agentic-sdlc approval requests");
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

  const acceptanceReady = storyAcceptanceCriteria(story).length > 0;
  addRouteCheck(
    decision,
    "story_acceptance_criteria",
    acceptanceReady ? "passed" : "failed",
    acceptanceReady ? `${storyAcceptanceCriteria(story).length} criteria` : "No acceptance criteria",
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
    decision.next_commands.push(`agentic-sdlc approval requests --story ${storyId}`);
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
    if (claim.agent && claim.agent === decision.requesting_actor?.id) {
      addRouteCheck(decision, "active_claim", "passed", `${storyId} is already claimed by the requesting actor ${claim.agent}`);
      decision.route = "claim_and_implement";
      decision.next_commands.push(`agentic-sdlc gate check --story ${storyId} --strict`);
      return finalizeConcreteRoute(decision, policy, actionConfig, confidenceOutcome);
    }
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
  decision.next_commands.push(`agentic-sdlc story claim --id ${storyId} --agent <agent> --branch ${defaultStoryBranch(context, storyId)}`);
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
  const contract = readContractById(context, story.contract_id, { missingOk: true });
  if (!contract) {
    return { exists: false, approved: false, contract: null, message: `Missing contract ${story.contract_id}` };
  }
  if (contract.story_id !== story.id) {
    return {
      exists: false,
      approved: false,
      contract,
      message: `Contract ${story.contract_id} is bound to ${contract.story_id || "the project"}, not story ${story.id}`,
    };
  }
  return {
    exists: true,
    approved: isTaskContractApproved(context, contract),
    contract,
    message: collectContractDependencyFreshnessGaps(context, contract).length > 0
      ? `Contract ${story.contract_id} has stale context, output-format, or capability dependencies`
      : story.contract_id,
  };
}

function validateApprovedStoryContractForPhaseOutput(context, story, action, expectations = [], options = {}) {
  if (options["allow-unapproved-contract-output"]) {
    return null;
  }
  const storyId = normalizeId(story.id || options.story || options.id || "unknown");
  const contractState = inspectStoryContract(context, story);
  if (!contractState.exists) {
    fail(
      [
        `${action} requires an approved story contract before producing or linking phase output for ${storyId}.`,
        contractState.message,
        `Run contract create/approve for story ${storyId}, then retry.`,
        "Use --allow-unapproved-contract-output only for explicit migration or recovery of pre-existing artifacts.",
      ].join("\n"),
    );
  }
  const contract = contractState.contract;
  const errors = [];
  if (contract.story_id !== storyId) {
    errors.push(`contract.story_id is '${contract.story_id || "project"}', expected '${storyId}'`);
  }
  if (contract.status !== "approved") {
    errors.push(`contract.status is '${contract.status || "unknown"}'`);
  }
  if (!hasFreshApprovedContractApproval(contract)) {
    errors.push("contract approval is missing, stale, or lacks approved_content_hash");
  }
  for (const gap of collectContractDependencyFreshnessGaps(context, contract)) {
    errors.push(`contract dependency freshness gap: ${gap.summary}`);
  }
  for (const gap of collectContractReadinessGaps(context, contract)) {
    errors.push(`contract readiness gap: ${gap.summary}`);
  }

  const refs = Array.isArray(contract.output_contract_refs) ? contract.output_contract_refs : [];
  const registry = readOutputRegistry(context, { missingOk: true });
  const requiresStartReceipt = refs.some((ref) =>
    (registry?.templates || []).some((template) => template.id === ref.template_id && template.preset === "technical-assessment"),
  );
  const taskStartReceiptPath = path.join(context.sdlcRoot, "stories", storyId, "task-start.json");
  if (requiresStartReceipt || fs.existsSync(taskStartReceiptPath)) {
    for (const issue of validateTaskStartReceipt(context, storyId, contract)) {
      errors.push(issue);
    }
  }
  for (const expectation of expectations) {
    if (!expectation.artifact_type) {
      continue;
    }
    const matchingRef = refs.find(
      (ref) =>
        ref.artifact_type === expectation.artifact_type &&
        (!expectation.template_id || ref.template_id === expectation.template_id) &&
        (!expectation.mode || ref.mode === expectation.mode),
    );
    if (!matchingRef) {
      const expected = [
        expectation.artifact_type,
        expectation.template_id || "<any-template>",
        expectation.mode || "<any-mode>",
      ].join(":");
      errors.push(`output ${expected} is not covered by approved contract output refs`);
    }
  }

  if (errors.length > 0) {
    fail(
      [
        `${action} is blocked because story ${storyId} contract ${story.contract_id} is not ready for phase output.`,
        ...errors.map((error) => `- ${error}`),
        "Ask the user to approve or revise the contract before producing, linking, or completing phase output.",
        "Use --allow-unapproved-contract-output only for explicit migration or recovery of pre-existing artifacts.",
      ].join("\n"),
    );
  }
  return contract;
}

function validateTaskStartReceipt(context, storyId, contract) {
  const receiptPath = path.join(context.sdlcRoot, "stories", storyId, "task-start.json");
  if (!fs.existsSync(receiptPath)) {
    return [`assessment journey has no task-start receipt; run task start --confirm-start for ${storyId}`];
  }
  const receipt = readProjectJson(context, receiptPath);
  const issues = [];
  const latestApprovalHash = latestContractApproval(contract)?.approved_content_hash || null;
  if (receipt.status !== "confirmed") {
    issues.push(`task-start receipt status is '${receipt.status || "unknown"}'`);
  }
  if (receipt.contract_id !== contract.id || receipt.contract_approval_hash !== latestApprovalHash) {
    issues.push("task-start receipt does not match the current approved contract");
  }
  if (receipt.authorization_ref) {
    const authorization = readAuthorization(context, receipt.authorization_ref, { missingOk: true });
    if (!authorization) {
      issues.push(`task-start receipt authorization ${receipt.authorization_ref} is missing`);
    } else {
      issues.push(...authorizationUseErrors(authorization, "task.start.confirm", {
        subject_id: storyId,
        artifact_types: contractArtifactTypes(contract),
      }).map((error) => `task-start receipt: ${error}`));
    }
  } else if (receipt.confirmed_by?.type !== "human") {
    issues.push("task-start receipt is neither directly human-confirmed nor backed by delegated authorization");
  }
  return issues;
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
  return fs.existsSync(claimPath) ? readProjectJson(context, claimPath) : null;
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

function runDoctor(context, options) {
  const checks = [];
  const add = (id, status, details) => checks.push({ id, status, details });
  const nodeVersion = process.versions.node;
  const [major, minor] = nodeVersion.split(".").map(Number);
  add("node-runtime", major > 18 || (major === 18 && minor >= 18) ? "passed" : "failed", `Node ${nodeVersion}; requires >=18.18`);

  const packagePath = path.join(PLUGIN_ROOT, "package.json");
  const manifestPath = path.join(PLUGIN_ROOT, ".codex-plugin", "plugin.json");
  try {
    const pkg = readJson(packagePath);
    const manifest = readJson(manifestPath);
    add("version-consistency", pkg.version === VERSION && manifest.version === VERSION ? "passed" : "failed", `CLI ${VERSION}, package ${pkg.version}, manifest ${manifest.version}`);
    const firstPrompt = Array.isArray(manifest.interface?.defaultPrompt) ? manifest.interface.defaultPrompt[0] : manifest.interface?.defaultPrompt;
    add(
      "assessment-entry-point",
      firstPrompt === "Contextualize this project and prepare an initial technical assessment." ? "passed" : "failed",
      firstPrompt || "missing first starter prompt",
    );
  } catch (error) {
    add("plugin-metadata", "failed", error.message);
  }

  for (const [id, relativePath] of [
    ["core-skill", "skills/agentic-sdlc/SKILL.md"],
    ["assessment-skill", "skills/agentic-sdlc-assessment/SKILL.md"],
    ["assessment-agent-card", "skills/agentic-sdlc-assessment/agents/openai.yaml"],
    ["assessment-preset", "templates/technical-assessment.md"],
  ]) {
    const filePath = path.join(PLUGIN_ROOT, relativePath);
    add(id, fs.existsSync(filePath) && fs.statSync(filePath).isFile() ? "passed" : "failed", relativePath);
  }

  if (fs.existsSync(context.sdlcRoot)) {
    add("project-kb", isKbInitialized(context) ? "passed" : "failed", isKbInitialized(context) ? `${SDLC_DIR}/project.json` : `${SDLC_DIR} exists without project.json`);
    const registry = readOutputRegistry(context, { missingOk: true });
    add("output-registry", registry ? "passed" : "failed", registry ? `${SDLC_DIR}/output-contracts/registry.json` : "missing output registry");
  } else {
    add("project-kb", "not_applicable", `No ${SDLC_DIR} directory at ${context.root}`);
  }

  const failed = checks.filter((check) => check.status === "failed");
  const payload = {
    status: failed.length === 0 ? "passed" : "failed",
    plugin_root: PLUGIN_ROOT,
    project_root: context.root,
    version: VERSION,
    checks,
  };
  if (failed.length > 0) {
    process.exitCode = 1;
  }
  output(options, payload, [
    `Agentic SDLC doctor: ${payload.status}`,
    ...checks.map((check) => `${check.status === "passed" ? "PASS" : check.status === "not_applicable" ? "N/A" : "FAIL"} ${check.id}: ${check.details}`),
  ]);
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
  const baselineApprovalRequest = buildBaselineApprovalRequest(context, baseline.baseline);
  const assistantMessage = renderApprovalRequestsAssistantMessage([baselineApprovalRequest]);

  output(
    options,
    {
      status: "onboarded",
      initialized: !initializedBefore,
      init: initialization?.payload || null,
      baseline_path: baseline.baseline_path,
      report_path: baseline.report_path,
      baseline: baseline.baseline,
      assistant_message: assistantMessage,
      ...assistantMessagePresentationFields(),
      approval_request: baselineApprovalRequest,
      next_commands: [
        `agentic-sdlc baseline status --id ${baseline.baseline.id}`,
        `agentic-sdlc baseline approve --id ${baseline.baseline.id} --actor-type human --approval-source explicit-user --summary "<what the user confirmed>"`,
      ],
    },
    [
      initializedBefore ? "Existing SDLC KB found." : "Initialized SDLC KB.",
      `Proposed baseline ${baseline.baseline.id}`,
      "",
      ...assistantMessage.split("\n"),
    ],
  );
}

function proposeBaseline(context, options) {
  ensureInitialized(context);
  const result = createBaselineProposal(context, options);
  const baselineApprovalRequest = buildBaselineApprovalRequest(context, result.baseline);
  const assistantMessage = renderApprovalRequestsAssistantMessage([baselineApprovalRequest]);
  output(
    options,
    {
      status: "proposed",
      baseline_path: result.baseline_path,
      report_path: result.report_path,
      baseline: result.baseline,
      assistant_message: assistantMessage,
      ...assistantMessagePresentationFields(),
      approval_request: baselineApprovalRequest,
    },
    [
      `Proposed baseline ${result.baseline.id}`,
      "",
      ...assistantMessage.split("\n"),
    ],
  );
}

function createBaselineProposal(context, options) {
  ensureBaselineDirectory(context);
  const id = normalizeId(options.id || `BASELINE-${shortDate()}`);
  const attribution = buildAttribution(context, options, "baseline.propose");
  const requestedDocuments = normalizeRawListOption(options.document);
  const documentPaths = requestedDocuments.length > 0 ? requestedDocuments : discoverExistingProjectDocuments(context);
  const documents = documentPaths.map((rawPath) => buildBaselineDocumentEvidence(context, rawPath));
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
  const releaseLock = acquireFileLock(`${baselinePath}.lock`);
  try {
    writeJsonFile(baselinePath, baseline, { force: Boolean(options.force) });
    writeTextFile(reportPath, renderBaselineReport(baseline), { force: Boolean(options.force) });
  } finally {
    releaseLock();
  }
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

function discoverExistingProjectDocuments(context) {
  const candidates = [];
  for (const name of ["README.md", "README.mdx", "readme.md", "ARCHITECTURE.md", "REQUIREMENTS.md"]) {
    const filePath = path.join(context.root, name);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      candidates.push(toProjectPath(context, filePath));
    }
  }
  const docsRoot = path.join(context.root, "docs");
  if (fs.existsSync(docsRoot) && fs.statSync(docsRoot).isDirectory()) {
    const ranked = walkFiles(docsRoot)
      .filter((filePath) => shouldIndexFile(context, filePath) && /\.(?:md|mdx|txt)$/i.test(filePath))
      .sort((left, right) => {
        const score = (filePath) => /architecture|requirement|product|strategy|api|test|security|privacy|adr/i.test(path.basename(filePath)) ? 0 : 1;
        return score(left) - score(right) || left.localeCompare(right);
      })
      .slice(0, 12)
      .map((filePath) => toProjectPath(context, filePath));
    candidates.push(...ranked);
  }
  const seenFiles = new Set();
  return candidates
    .filter((projectPath) => {
      const filePath = resolveProjectFilePath(context, projectPath, { mustExist: true, fileOnly: true });
      const stat = fs.statSync(filePath);
      const identity = stat.ino
        ? `inode:${stat.dev}:${stat.ino}`
        : `realpath:${fs.realpathSync.native(filePath)}`;
      if (seenFiles.has(identity)) {
        return false;
      }
      seenFiles.add(identity);
      return true;
    })
    .slice(0, 12);
}

function approveBaseline(context, options) {
  ensureInitialized(context);
  const id = normalizeId(requireOption(options, "id"));
  const baselinePath = baselinePathById(context, id);
  if (!fs.existsSync(baselinePath)) {
    fail(`Baseline ${id} does not exist`);
  }
  const attribution = buildAttribution(context, options, "baseline.approve");
  requireFormalApprovalActor(context, options, attribution, "Approving a project baseline");
  let baseline;
  let approval;
  const releaseLock = acquireFileLock(`${baselinePath}.lock`);
  try {
    baseline = readProjectJson(context, baselinePath);
    validateBaselineSourceHashes(context, baseline, `baseline ${id}`, { failOnStale: true });
    const approvalSource = normalizeApprovalSource(context, options, attribution, `baseline ${id}`, "approved");
    baseline.canonicality = {
      ...(baseline.canonicality || {}),
      state: approvalSource === "bootstrap" ? "bootstrap" : "confirmed",
      inferred_not_approved: approvalSource === "bootstrap",
      user_confirmation_required: approvalSource === "bootstrap",
    };
    approval = buildApprovalRecord(context, options, attribution, {
      subject: baseline,
      subject_id_field: "baseline_id",
      subject_id: id,
      scope: options.scope || "project-baseline",
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
  } finally {
    releaseLock();
  }
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

function authorizationRoot(context) {
  return path.join(context.sdlcRoot, "authorizations");
}

function authorizationPath(context, id) {
  return path.join(authorizationRoot(context), `${normalizeId(id)}.json`);
}

function normalizeAuthorizedActions(value) {
  const actions = normalizeListOption(value).map((action) => action.toLowerCase());
  for (const action of actions) {
    if (action !== "*" && !/^[a-z0-9][a-z0-9._-]*(?:\.\*)?$/.test(action)) {
      fail(`Invalid authorized action '${action}'. Use an exact CLI action such as contract.approve, a prefix such as capability.*, or *.`);
    }
  }
  return Array.from(new Set(actions));
}

function grantAuthorization(context, options) {
  ensureInitialized(context);
  const id = normalizeId(requireOption(options, "id"));
  const scope = getOptionString(options, "scope");
  const summary = getOptionString(options, "summary");
  const allowedActions = normalizeAuthorizedActions(options["allow-action"]);
  if (!scope || !summary || allowedActions.length === 0) {
    fail("Authorization grant requires --scope, --summary, and at least one --allow-action.");
  }
  const attribution = buildAttribution(context, options, "authorization.grant");
  requireFormalApprovalActor(context, options, attribution, "Granting delegated automation authorization");
  if (!['human', 'ci'].includes(attribution.actor.type)) {
    fail("Granting delegated automation authorization requires --actor-type human or ci.");
  }
  const source = normalizeApprovalSource(context, options, attribution, `authorization ${id}`, "approved");
  if (!['explicit-user', 'ci'].includes(source)) {
    fail("Authorization grants must come from explicit-user or ci approval, not automation or bootstrap.");
  }
  if (source === "explicit-user" && attribution.actor.type !== "human") {
    fail("Authorization grants with approval_source explicit-user require --actor-type human.");
  }
  if (source === "ci" && attribution.actor.type !== "ci") {
    fail("Authorization grants with approval_source ci require --actor-type ci.");
  }
  const expiresAt = options["expires-at"] ? normalizeOptionalDateTime(options["expires-at"], "expires-at") : null;
  const record = {
    id,
    status: "active",
    scope,
    summary,
    allowed_actions: allowedActions,
    allowed_artifact_types: normalizeListOption(options["allow-artifact-type"]).map(normalizeArtifactType),
    allowed_approval_boundaries: normalizeListOption(options["allow-boundary"]),
    allowed_subjects: normalizeListOption(options["allow-subject"]).map((subject) => subject === "*" ? "*" : normalizeId(subject)),
    expires_at: expiresAt,
    approval_source: source,
    approval_evidence: buildApprovalEvidence(context, options),
    granted_by: attribution.actor,
    created_at: now(),
    updated_at: now(),
    audit: {
      git: attribution.git,
      run: attribution.run,
    },
  };
  record.approved_content_hash = hashAuthorizationRecord(record);
  record.hash_algorithm = "sha256:stable-json:v1";
  ensureDir(authorizationRoot(context));
  writeJsonFile(authorizationPath(context, id), record, { force: Boolean(options.force) });
  appendTraceEvent(context, null, {
    type: "decision",
    summary: `Granted delegated authorization ${id}: ${summary}`,
    action: "authorization.grant",
    actor: attribution.actor,
    evidence: [toProjectPath(context, authorizationPath(context, id)), ...record.approval_evidence.map((item) => item.path)],
    related: [id, ...allowedActions],
    git: attribution.git,
    run: attribution.run,
  });
  output(options, { status: "active", authorization: record }, [
    `Granted authorization ${id}`,
    `Scope: ${scope}`,
    `Allowed actions: ${allowedActions.join(", ")}`,
  ]);
}

function readAuthorization(context, id, options = {}) {
  const filePath = authorizationPath(context, id);
  if (!fs.existsSync(filePath)) {
    if (options.missingOk) {
      return null;
    }
    fail(`Authorization ${id} does not exist.`);
  }
  return readProjectJson(context, filePath);
}

function showAuthorizations(context, options) {
  ensureInitialized(context);
  const id = getOptionString(options, "id");
  const records = id
    ? [readAuthorization(context, normalizeId(id))]
    : collectJsonFiles(context, authorizationRoot(context));
  output(options, { authorizations: records }, records.length
    ? records.map((record) => `${record.id}: ${record.status}, scope ${record.scope}, actions ${(record.allowed_actions || []).join(", ")}`)
    : ["No delegated automation authorizations found."]);
}

function revokeAuthorization(context, options) {
  ensureInitialized(context);
  const id = normalizeId(requireOption(options, "id"));
  const attribution = buildAttribution(context, options, "authorization.revoke");
  if (!['human', 'ci'].includes(attribution.actor.type)) {
    fail("Revoking delegated automation authorization requires --actor-type human or ci.");
  }
  const filePath = authorizationPath(context, id);
  const record = readAuthorization(context, id);
  record.status = "revoked";
  record.revoked_at = now();
  record.revocation_reason = getOptionString(options, "reason") || null;
  record.updated_at = now();
  record.audit = { ...(record.audit || {}), revoked_by: attribution.actor, git: attribution.git, run: attribution.run };
  writeJsonFile(filePath, record, { force: true });
  output(options, { status: "revoked", authorization: record }, [`Revoked authorization ${id}`]);
}

function authorizationAllowsAction(record, action) {
  const normalized = String(action || "").trim().toLowerCase();
  const allowedActions = Array.isArray(record.allowed_actions) ? record.allowed_actions : [];
  return allowedActions.some((allowed) =>
    allowed === "*" || allowed === normalized || (allowed.endsWith(".*") && normalized.startsWith(allowed.slice(0, -1))),
  );
}

function authorizationArtifactTypes(settings = {}) {
  const values = [
    settings.artifact_type,
    ...(Array.isArray(settings.artifact_types) ? settings.artifact_types : []),
  ];
  return Array.from(new Set(values.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean)));
}

function contractArtifactTypes(contract = {}) {
  return authorizationArtifactTypes({
    artifact_types: (Array.isArray(contract.output_contract_refs) ? contract.output_contract_refs : [])
      .map((reference) => reference?.artifact_type),
  });
}

function contractDirectApprovalRequirements(contract = {}) {
  const policyRequirements = Array.isArray(contract.capability_policy?.approval_required_for)
    ? contract.capability_policy.approval_required_for
    : [];
  const bindingRequirements = (Array.isArray(contract.capability_bindings) ? contract.capability_bindings : [])
    .flatMap((binding) => Array.isArray(binding?.requires_approval_for) ? binding.requires_approval_for : []);
  return Array.from(new Set([...policyRequirements, ...bindingRequirements].map((value) => String(value).trim()).filter(Boolean)));
}

function authorizationAllowsSubject(record, subjectId) {
  const allowedSubjects = Array.isArray(record.allowed_subjects) ? record.allowed_subjects : [];
  return !subjectId || allowedSubjects.length === 0 || allowedSubjects.includes("*") || allowedSubjects.includes(subjectId);
}

function authorizationAllowsArtifactType(record, artifactType) {
  const allowedArtifactTypes = Array.isArray(record.allowed_artifact_types) ? record.allowed_artifact_types : [];
  return allowedArtifactTypes.length === 0 || allowedArtifactTypes.includes(artifactType);
}

function authorizationApprovalBoundaries(settings = {}) {
  return Array.from(new Set(
    (Array.isArray(settings.approval_boundaries) ? settings.approval_boundaries : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean),
  ));
}

function authorizationAllowsApprovalBoundary(record, boundary) {
  const allowedBoundaries = Array.isArray(record.allowed_approval_boundaries)
    ? record.allowed_approval_boundaries
    : [];
  return allowedBoundaries.includes("*") || allowedBoundaries.includes(boundary);
}

function hashAuthorizationRecord(record) {
  const { approved_content_hash, hash_algorithm, revoked_at, revocation_reason, ...subject } = record || {};
  return hashApprovalSubject(subject);
}

function authorizationUseErrors(record, action, settings = {}) {
  const errors = [];
  if (record.status !== "active") {
    errors.push(`Authorization ${record.id} is ${record.status || "inactive"}.`);
  }
  if (record.expires_at && Date.parse(record.expires_at) <= Date.now()) {
    errors.push(`Authorization ${record.id} expired at ${record.expires_at}.`);
  }
  if (record.approved_content_hash !== hashAuthorizationRecord(record)) {
    errors.push(`Authorization ${record.id} changed after it was granted.`);
  }
  if (!authorizationAllowsAction(record, action)) {
    const allowedActions = Array.isArray(record.allowed_actions) ? record.allowed_actions : [];
    errors.push(`Authorization ${record.id} does not allow action ${action}. Allowed actions: ${allowedActions.join(", ")}`);
  }
  for (const artifactType of authorizationArtifactTypes(settings)) {
    if (!authorizationAllowsArtifactType(record, artifactType)) {
      errors.push(`Authorization ${record.id} does not allow artifact type ${artifactType}.`);
    }
  }
  for (const boundary of authorizationApprovalBoundaries(settings)) {
    if (!authorizationAllowsApprovalBoundary(record, boundary)) {
      errors.push(`Authorization ${record.id} does not allow approval boundary ${boundary}.`);
    }
  }
  if (!authorizationAllowsSubject(record, settings.subject_id)) {
    errors.push(`Authorization ${record.id} does not allow subject ${settings.subject_id}.`);
  }
  return errors;
}

function requireAutomationAuthorization(context, options, action, settings = {}) {
  const id = getOptionString(options, "authorization");
  if (!id) {
    fail(`${settings.label || action} uses delegated automation approval and requires --authorization <id>. Free-text --scope is not sufficient.`);
  }
  const record = readAuthorization(context, normalizeId(id));
  const errors = authorizationUseErrors(record, action, settings);
  if (errors.length > 0) {
    fail(errors[0]);
  }
  const requestedScope = getOptionString(options, "scope");
  if (requestedScope && requestedScope !== record.scope) {
    fail(`--scope '${requestedScope}' does not match authorization ${record.id} scope '${record.scope}'.`);
  }
  return record;
}

function showApprovalRequests(context, options) {
  ensureInitialized(context);
  const storyId = options.story ? normalizeId(String(options.story)) : null;
  const requests = collectApprovalRequests(context, { storyId });
  const assistantMessage = renderApprovalRequestsAssistantMessage(requests);
  output(
    options,
    {
      kind: "approval_requests",
      story_id: storyId,
      status: requests.length ? "needs_user_input" : "clear",
      generated_at: now(),
      assistant_message: assistantMessage,
      ...assistantMessagePresentationFields(),
      requests,
      source_paths: Array.from(new Set(requests.flatMap((request) => request.sources || []))).sort(),
    },
    assistantMessage.split("\n"),
  );
}

function collectApprovalRequests(context, options = {}) {
  const storyId = options.storyId || null;
  const baselineRequests = collectBaselineApprovalRequests(context, storyId);
  if (baselineRequests.length > 0) {
    return baselineRequests;
  }
  return [
    ...collectCapabilityProfileApprovalRequests(context, storyId),
    ...collectCapabilityRecommendationApprovalRequests(context, storyId),
    ...collectOutputTemplateApprovalRequests(context, storyId),
    ...collectContractClarificationRequests(context, storyId),
    ...collectContractApprovalRequests(context, storyId),
    ...collectOutputLinkActionRequests(context, storyId),
  ];
}

function renderApprovalRequestsAssistantMessage(requests) {
  if (!requests.length) {
    return [
      "There are no pending SDLC approvals or clarifications.",
      "I can continue with the next operational step when needed.",
    ].join("\n");
  }
  const internalRefreshOnly = requests.every((request) => request.status === "needs_internal_refresh");
  return [
    internalRefreshOnly
      ? "I need to refresh internal project references before I continue; this does not ask you to approve a changed scope."
      : "I need your decision before I continue.",
    "Plainly: I am checking that I use the right project context, produce the output in the right format, and stay inside the work you actually want. You do not need to know the workflow terms; answer the questions in normal language.",
    "I will summarize the relevant file contents here. Links and file paths are supporting evidence, not homework for you.",
    "Important: your approval applies only to the item or items shown in this message. If I create a new format, evidence/boundary set, tool choice, work brief, or start confirmation later, I must show what is inside it and ask again unless you already gave a broader scope.",
    "",
    ...requests.flatMap((request, index) => formatHumanApprovalRequest(request, index + 1)),
    internalRefreshOnly ? null : "You can answer in natural language, for example:",
    internalRefreshOnly ? null : '- "Use README.md, package.json, and src/ as the trusted context; the proposed assessment format is fine."',
    internalRefreshOnly ? null : '- "The sections are fine, but also include deployment risks."',
    internalRefreshOnly ? null : '- "Do not start yet; first explain item 2 in simpler terms."',
  ].filter(Boolean).join("\n");
}

function assistantMessagePresentationFields() {
  return {
    assistant_message_source_language: "en",
    assistant_message_presentation: {
      translate_to_chat_language: true,
      contextualize_for_user: true,
      presenter: "codex",
      preserve_literals: [
        "artifact IDs",
        "story IDs",
        "contract IDs",
        "template IDs",
        "file paths",
        "CLI commands",
        "status codes",
        "schema keys",
      ],
      instruction:
        "Before showing assistant_message to a human, Codex should translate and contextualize it in the active chat language while preserving technical literals exactly. Explain the decision in plain product/work terms first. Do not expose blocking_reasons, status codes, stale/hash wording, or schema keys as the primary message; keep them only as technical detail if needed. If an internal freshness check needs a refresh but the user-approved scope has not changed, say that you are refreshing the internal reference and continuing inside the approved scope. Do not send the user to inspect files manually as the main path: summarize the relevant contents of baseline reports, templates, contracts, and source lists directly in chat, then provide file paths only as supporting evidence. The summary must be substantial enough for approval: explain what artifact was produced, what is inside it, what decision is needed, and what approval does not cover; avoid one-line or ID-only summaries. Do not collapse the message into a bare approval question: show what will be used as context, what output format is being agreed, what work is being authorized, how the result will be delivered, and what the user can answer naturally. By default, a user's yes, ok, or approval applies only to the artifact or decision that was just shown and summarized. If the user explicitly specifies a broader approval level or autonomy scope, carry it only inside that scope and record later formal approvals as delegated automation, not as direct explicit-user approvals.",
    },
  };
}

function attachAssistantMessagePresentation(payload) {
  Object.assign(payload, assistantMessagePresentationFields());
  return payload;
}

function collectBaselineApprovalRequests(context, storyId = null) {
  return selectActiveBaselines(context, storyId)
    .filter((baseline) => {
      const approved = String(baseline.status || "").toLowerCase() === "approved";
      const stale =
        validateBaselineSourceHashes(context, baseline, `baseline ${baseline.id}`, { collectOnly: true }).length > 0 ||
        (approved && !isApprovedRecordFresh(baseline));
      return !approved || stale;
    })
    .map((baseline) => buildBaselineApprovalRequest(context, baseline));
}

function selectActiveBaselines(context, storyId = null) {
  const baselines = readBaselines(context);
  if (baselines.length === 0) {
    return [];
  }
  const referencedIds = storyId ? baselineIdsReferencedByStoryContract(context, storyId) : new Set();
  if (referencedIds.size > 0) {
    return baselines.filter((baseline) => referencedIds.has(baseline.id));
  }
  return [baselines.at(-1)];
}

function baselineIdsReferencedByStoryContract(context, storyId) {
  const story = readStory(context, storyId);
  if (!story?.contract_id) {
    return new Set();
  }
  const contract = readContractById(context, story.contract_id, { missingOk: true });
  if (!contract) {
    return new Set();
  }
  const result = new Set();
  for (const source of contract.contextualization?.context_sources || []) {
    const sourcePath = String(source?.path || source || "").replace(/\\/g, "/");
    const match = sourcePath.match(/^\.sdlc\/baseline\/([^/]+)\.json$/);
    if (match) {
      result.add(match[1]);
    }
  }
  return result;
}

function baselineIdsReferencedByAllContracts(context) {
  const result = new Set();
  const contractsRoot = path.join(context.sdlcRoot, "contracts");
  for (const contract of collectJsonFiles(context, contractsRoot)) {
    for (const source of contract.contextualization?.context_sources || []) {
      const sourcePath = String(source?.path || source || "").replace(/\\/g, "/");
      const match = sourcePath.match(/^\.sdlc\/baseline\/([^/]+)\.json$/);
      if (match) {
        result.add(match[1]);
      }
    }
  }
  return result;
}

function collectCapabilityProfileApprovalRequests(context, storyId = null) {
  return readCapabilityProfiles(context)
    .filter(
      (profile) =>
        profile.status !== "approved" ||
        !isApprovedRecordFresh(profile) ||
        validateCapabilityRecordSourceHashes(context, profile, `capability profile ${profile.id}`, { collectOnly: true }).length > 0,
    )
    .filter((profile) => capabilityRecordMatchesStory(context, profile, storyId))
    .map((profile) => buildCapabilityProfileApprovalRequest(context, profile));
}

function buildCapabilityProfileApprovalRequest(context, profile) {
  const profilePath = toProjectPath(context, capabilityProfilePath(context, profile.id));
  const staleSources = validateCapabilityRecordSourceHashes(context, profile, `capability profile ${profile.id}`, { collectOnly: true });
  if (profile.status === "approved" && (!isApprovedRecordFresh(profile) || staleSources.length > 0)) {
    return {
      id: `refresh-capability-profile-${profile.id}`,
      type: "capability_profile_refresh_required",
      status: "needs_internal_refresh",
      summary: `Refresh capability evidence ${profile.id}; its sources or approved snapshot changed.`,
      subject_id: profile.id,
      story_id: profile.subject?.story_id || null,
      sources: [profilePath, ...(profile.source_paths || [])].filter(Boolean),
      ...humanApprovalFields({
        title: `Refresh project evidence and boundaries (${profile.id})`,
        why_needed: "The evidence behind this internal capability record changed. I must rebuild it before relying on it; refreshing does not broaden permissions.",
        review_items: [
          `Previous scope: ${formatCapabilitySubject(profile.subject)}`,
          staleSources.length ? `Changed evidence: ${formatLimitedList(staleSources, 8)}` : "The approved record content changed after approval.",
          `Current source files: ${formatLimitedList(profile.source_paths || [], 10)}`,
        ],
        approval_meaning: "No new approval is created by this refresh. A material boundary change still requires a decision.",
        after_approval: "After refresh, the current policy or combined proposal determines whether a fresh approval is needed.",
      }),
      suggested_command: `agentic-sdlc capability profile propose --id ${profile.id}${profile.subject?.story_id ? ` --story ${profile.subject.story_id}` : ""}${profile.subject?.phase ? ` --phase ${profile.subject.phase}` : ""}${profile.source_paths?.[0] ? ` --context-file ${profile.source_paths[0]}` : ""} --force`,
    };
  }
  return {
    id: `approve-capability-profile-${profile.id}`,
    type: "capability_profile_approval",
    status: "needs_explicit_user_approval",
    summary: "Confirm or revise the evidence and boundaries I may use before choosing tools for the work.",
    subject_id: profile.id,
    subject_status: profile.status || null,
    story_id: profile.subject?.story_id || null,
    phase: profile.subject?.phase || null,
    sources: [profilePath, ...(profile.source_paths || [])].filter(Boolean),
    ...humanApprovalFields({
      title: `Project evidence and boundaries (${profile.id})`,
      why_needed: "Before I choose tools for the assessment, I need you to confirm the boundaries: which project evidence I can rely on and what kind of local checks are acceptable.",
      review_items: [
        "What this is: the list of project evidence, local checks, and tool boundaries I may use. It is not the assessment content and it does not approve the final work brief.",
        `Work scope: ${formatCapabilitySubject(profile.subject)}`,
        profile.detected_stack?.length ? `Project signals found: ${formatDetectedStackForUser(profile.detected_stack)}` : null,
        profile.evidence?.length ? `Evidence I used to build this profile: ${formatCapabilityEvidenceForUser(profile.evidence)}` : null,
        profile.constraints?.length ? `Boundaries already recorded: ${profile.constraints.join("; ")}` : null,
        profile.source_paths?.length ? `Source files behind this proposal: ${formatLimitedList(profile.source_paths, 10)}` : null,
        profile.confidence !== undefined ? `Confidence: ${profile.confidence}` : null,
      ],
      approval_meaning: "If you approve it, I can use these boundaries to choose the concrete tools for the work. I still need approval for the final work brief unless your broader scope already covers it.",
      approve_if: "Approve if local repo/document reading and the detected project signals are accurate enough for this assessment.",
      change_if: "Ask for changes if I should not run tests, should not use certain files, should include a Word/document skill, or should avoid any tool category.",
      after_approval: "Then I can choose the allowed tools based on these boundaries.",
      user_prompt: "Can I use this evidence and boundary set, or should I change the allowed files, checks, or tool limits first?",
      approval_phrase: "Use this evidence and boundary set.",
    }),
    suggested_question: "After reading the explanation above, do you approve this evidence and boundary set, or should it be revised?",
    suggested_command: `agentic-sdlc capability profile approve --id ${profile.id} --actor-type human --approval-source explicit-user --summary "<user-approved capability profile>"`,
  };
}

function collectCapabilityRecommendationApprovalRequests(context, storyId = null) {
  return readCapabilityRecommendations(context)
    .filter(
      (recommendation) =>
        recommendation.status !== "approved" ||
        !isApprovedRecordFresh(recommendation) ||
        validateCapabilityRecordSourceHashes(context, recommendation, `capability recommendation ${recommendation.id}`, { collectOnly: true }).length > 0 ||
        capabilityRecommendationNeedsInstallApproval(recommendation),
    )
    .filter((recommendation) => capabilityRecommendationMatchesStory(context, recommendation, storyId))
    .map((recommendation) => buildCapabilityRecommendationApprovalRequest(context, recommendation));
}

function buildCapabilityRecommendationApprovalRequest(context, recommendation) {
  const recommendationPath = toProjectPath(context, capabilityRecommendationPath(context, recommendation.id));
  const needsInstallApproval = capabilityRecommendationNeedsInstallApproval(recommendation);
  const staleSources = validateCapabilityRecordSourceHashes(context, recommendation, `capability recommendation ${recommendation.id}`, { collectOnly: true });
  if (
    recommendation.status === "approved" &&
    !needsInstallApproval &&
    (!isApprovedRecordFresh(recommendation) || staleSources.length > 0)
  ) {
    return {
      id: `refresh-capability-recommendation-${recommendation.id}`,
      type: "capability_recommendation_refresh_required",
      status: "needs_internal_refresh",
      summary: `Refresh tool recommendation ${recommendation.id}; its approved evidence is stale.`,
      subject_id: recommendation.id,
      sources: [recommendationPath, ...(recommendation.source_paths || [])].filter(Boolean),
      ...humanApprovalFields({
        title: `Refresh allowed-tool recommendation (${recommendation.id})`,
        why_needed: "The approved tool recommendation or its evidence changed. I must rebuild it before use; this refresh cannot add installs, external access, secrets, or new permissions.",
        review_items: [
          `Profile: ${recommendation.profile_id || "unknown"}`,
          staleSources.length ? `Changed evidence: ${formatLimitedList(staleSources, 8)}` : "The approved recommendation content changed after approval.",
          `Previous tools: ${formatCapabilityRecommendationsForUser(recommendation.recommendations || [])}`,
        ],
        approval_meaning: "No new permission is granted by refreshing the internal record.",
        after_approval: "A materially different tool or permission set must return to the combined proposal.",
      }),
      suggested_command: `agentic-sdlc capability recommend --id ${recommendation.id} --profile ${recommendation.profile_id} --force`,
    };
  }
  return {
    id: `approve-capability-recommendation-${recommendation.id}`,
    type: "capability_recommendation_approval",
    status: needsInstallApproval ? "needs_install_approval" : "needs_explicit_user_approval",
    summary: "Confirm or revise the concrete tools and permissions I may use for the work.",
    subject_id: recommendation.id,
    subject_status: recommendation.status || null,
    sources: [recommendationPath, ...(recommendation.source_paths || [])].filter(Boolean),
    ...humanApprovalFields({
      title: `Allowed tools for this work (${recommendation.id})`,
      why_needed: "This is the concrete list of skills, tools, connectors, models, permissions, and installs I would be allowed to use for the work.",
      review_items: [
        "What this is: the concrete list of tools, permissions, targets, and install choices I may use. It does not approve the final document.",
        recommendation.profile_id ? `Based on approved evidence and boundaries: ${recommendation.profile_id}` : null,
        recommendation.recommendations?.length ? `Recommended capabilities: ${formatCapabilityRecommendationsForUser(recommendation.recommendations)}` : null,
        formatCapabilityPolicyPatchForUser(recommendation.policy_patch),
        recommendation.bindings?.length ? `Specific bindings or targets: ${formatCapabilityBindingsForUser(recommendation.bindings)}` : null,
        recommendation.open_questions?.length ? `Questions I still need answered: ${recommendation.open_questions.join(" ")}` : "Missing information: none listed; this is waiting for approval or requested changes.",
        needsInstallApproval ? `Install decision needed: ${formatCapabilityInstallNeeds(recommendation.recommendations)}` : "Install decision: no new installation approval is needed.",
      ],
      approval_meaning: "If you approve it, I can use these tools and permissions in the work brief. I still need approval for the brief itself unless your broader scope already covers it.",
      approve_if: "Approve if the listed tools, permissions, targets, and install choices are acceptable for this work.",
      change_if: "Ask for changes if you want to remove a tool, forbid installs, avoid running tests, add Word document generation, or restrict local filesystem access.",
      after_approval: "Then I can use these tool choices when creating or updating the work brief.",
      user_prompt: "Can I use these tools and permissions, or should I change tools, installs, external access, or targets first?",
      approval_phrase: "Use these tool choices.",
    }),
    suggested_question: "After reading the explanation above, do you approve these tool choices, or should they be revised?",
    suggested_command: `agentic-sdlc capability approve --id ${recommendation.id} --actor-type human --approval-source explicit-user --summary "<user-approved capability recommendation>"${needsInstallApproval ? " --approve-install" : ""}`,
  };
}

function capabilityRecordMatchesStory(context, record, storyId = null) {
  if (!storyId) {
    return true;
  }
  const subjectStoryId = record.subject?.story_id || null;
  return !subjectStoryId || subjectStoryId === storyId;
}

function capabilityRecommendationMatchesStory(context, recommendation, storyId = null) {
  if (!storyId) {
    return true;
  }
  try {
    const profile = readCapabilityProfile(context, recommendation.profile_id);
    return capabilityRecordMatchesStory(context, profile, storyId);
  } catch {
    return true;
  }
}

function capabilityRecommendationNeedsInstallApproval(recommendation) {
  return (recommendation.recommendations || []).some((item) => item.install_required && !item.install_approved);
}

function buildBaselineApprovalRequest(context, baseline) {
  const baselinePath = `.sdlc/baseline/${baseline.id}.json`;
  const reportPath = `.sdlc/baseline/${baseline.id}-current-state.md`;
  const staleSources = validateBaselineSourceHashes(context, baseline, `baseline ${baseline.id}`, { collectOnly: true });
  if (staleSources.length > 0) {
    return buildBaselineRefreshRequest(context, baseline, baselinePath, reportPath, staleSources);
  }
  const reportHeadings = readProjectMarkdownHeadings(context, reportPath, 8);
  const reportExcerpt = readProjectFileExcerpt(context, reportPath, 900);
  const currentStateSummary = formatBaselineCurrentStateSummary(baseline, reportExcerpt);
  const sources = [baselinePath, reportPath].filter((source) => fs.existsSync(path.join(context.root, source)));
  return {
    id: `approve-baseline-${baseline.id}`,
    type: "baseline_approval",
    status: "needs_explicit_user_approval",
    summary: `Approve or revise baseline ${baseline.id} before treating inferred project facts as canonical.`,
    subject_id: baseline.id,
    subject_status: baseline.status || null,
    sources,
    ...humanApprovalFields({
      title: `Project context (${baseline.id})`,
      why_needed: "I inspected the project and inferred some facts. Before I rely on them, you should confirm they are accurate enough for this work.",
      review_items: [
        baseline.summary ? `Project summary I inferred: ${baseline.summary}` : null,
        formatBaselineDetectedStack(baseline),
        formatBaselineImportedDocuments(baseline),
        formatBaselineKeyFiles(baseline),
        reportHeadings.length ? `Current-state report covers: ${reportHeadings.join(", ")}` : null,
        currentStateSummary ? `Current-state summary to approve: ${currentStateSummary}` : null,
        baseline.source_paths?.length ? `Evidence files used: ${formatLimitedList(baseline.source_paths, 12)}` : null,
        baseline.assumptions?.length ? `Assumptions I recorded: ${baseline.assumptions.join(" ")}` : null,
        baseline.open_questions?.length ? `Open questions before approval: ${baseline.open_questions.join(" ")}` : null,
      ],
      approval_meaning: "If you approve it, I can use these project facts as trusted context instead of asking again or guessing.",
      approve_if: "Approve if the project summary, stack, documents, important files, assumptions, and open questions are accurate enough for the work you requested.",
      change_if: "Ask for changes if sources are missing, the inferred stack is wrong, the project description is misleading, or you want to add or remove canonical facts.",
      after_approval: `Then I can treat ${baseline.id} as trusted project context.`,
      user_prompt: `Can I use the inferred project context ${baseline.id}, or should I correct it first?`,
      approval_phrase: `Use project context ${baseline.id}.`,
    }),
    suggested_question: `After reading the summary above, do you approve baseline ${baseline.id} as canonical, or should it be revised?`,
    suggested_command: `agentic-sdlc baseline approve --id ${baseline.id} --actor-type human --approval-source explicit-user --summary "<user-confirmed baseline>"`,
  };
}

function buildBaselineRefreshRequest(context, baseline, baselinePath, reportPath, staleSources) {
  const sources = [baselinePath, reportPath].filter((source) => fs.existsSync(path.join(context.root, source)));
  return {
    id: `refresh-baseline-${baseline.id}`,
    type: "baseline_refresh_required",
    status: "needs_refresh",
    summary: `Refresh project context ${baseline.id} before asking for approval or using it as current evidence.`,
    subject_id: baseline.id,
    subject_status: baseline.status || null,
    sources,
    ...humanApprovalFields({
      title: `Refresh project context (${baseline.id})`,
      why_needed: "The project files used for this context changed after it was prepared, so approving the old snapshot would not approve the current project.",
      review_items: [
        baseline.summary ? `Previous project summary: ${baseline.summary}` : null,
        `Changed or missing evidence: ${formatLimitedList(staleSources, 8)}`,
        baseline.source_paths?.length ? `Files that must be read again: ${formatLimitedList(baseline.source_paths, 12)}` : null,
        "What this means: refresh the inferred snapshot, explain the updated contents, and only then request approval if the active approval scope does not already cover it.",
      ],
      approval_meaning: "Refreshing does not approve the project context. It only replaces the outdated snapshot with evidence from the current files.",
      approve_if: "Refresh if these files are still the intended project evidence.",
      change_if: "Change the source list first if files should be added, removed, or treated as non-canonical.",
      after_approval: `After refresh, ${baseline.id} can be summarized from current evidence and approved within the applicable approval scope.`,
      user_prompt: `May I refresh project context ${baseline.id} from its current source files?`,
      approval_phrase: `Refresh project context ${baseline.id}.`,
    }),
    suggested_question: `The evidence behind ${baseline.id} changed. Should I refresh that project context before continuing?`,
    suggested_command: `agentic-sdlc baseline propose --id ${baseline.id} --source <current-path> --force --summary "<updated observable context>"`,
  };
}

function formatBaselineCurrentStateSummary(baseline, fallback = null) {
  const stack = (baseline.repository_snapshot?.detected_stack || [])
    .slice(0, 6)
    .map((item) => item.name || item.type)
    .filter(Boolean);
  const keyFiles = (baseline.repository_snapshot?.key_files || [])
    .slice(0, 8)
    .map((item) => item.path)
    .filter(Boolean);
  const documents = (baseline.imported_documents || [])
    .slice(0, 5)
    .map((item) => item.path)
    .filter(Boolean);
  const caveats = normalizeListValue(baseline.inferred_context?.caveats || [], []).slice(0, 2);
  const questions = normalizeListValue(baseline.open_questions || [], []).slice(0, 3);
  const parts = [
    baseline.summary ? `summary: ${baseline.summary}` : null,
    baseline.inferred_context?.product_signal ? `product signal: ${compactText(baseline.inferred_context.product_signal, 260)}` : null,
    baseline.inferred_context?.component_roots?.length ? `component roots: ${baseline.inferred_context.component_roots.join(", ")}` : null,
    stack.length ? `detected stack: ${stack.join(", ")}` : null,
    keyFiles.length ? `key files: ${keyFiles.join(", ")}` : null,
    documents.length ? `documents: ${documents.join(", ")}` : null,
    questions.length ? `open questions: ${questions.join(" ")}` : null,
    caveats.length ? `caveats: ${caveats.join(" ")}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" | ") : fallback;
}

function formatBaselineDetectedStack(baseline) {
  const stack = baseline.repository_snapshot?.detected_stack || [];
  if (!stack.length) {
    return null;
  }
  const entries = stack
    .slice(0, 8)
    .map((item) => [item.name || item.type, item.source_path ? `from ${item.source_path}` : null].filter(Boolean).join(" "))
    .filter(Boolean);
  return entries.length ? `Technology signals I found: ${formatLimitedList(entries, 8)}` : null;
}

function formatBaselineImportedDocuments(baseline) {
  const documents = Array.isArray(baseline.imported_documents) ? baseline.imported_documents : [];
  if (!documents.length) {
    return null;
  }
  const entries = documents
    .slice(0, 5)
    .map((document) => document.excerpt ? `${document.path}: ${compactText(document.excerpt, 180)}` : document.path)
    .filter(Boolean);
  return entries.length ? `Documents I read: ${formatLimitedList(entries, 5)}` : null;
}

function formatBaselineKeyFiles(baseline) {
  const keyFiles = baseline.repository_snapshot?.key_files || [];
  if (!keyFiles.length) {
    return null;
  }
  const entries = keyFiles.slice(0, 10).map((item) => item.path).filter(Boolean);
  return entries.length ? `Important project files or folders detected: ${formatLimitedList(entries, 10)}` : null;
}

function formatLimitedList(values, maxItems = 8) {
  const items = normalizeListValue(values, []).filter(Boolean);
  const visible = items.slice(0, maxItems);
  const hidden = Math.max(0, items.length - visible.length);
  return `${visible.join(", ")}${hidden ? `, plus ${hidden} more` : ""}`;
}

function formatCapabilitySubject(subject = {}) {
  const parts = [
    subject.scope ? `scope ${subject.scope}` : null,
    subject.phase ? `phase ${subject.phase}` : null,
    subject.story_id ? `work item ${subject.story_id}` : null,
    subject.requirement_ids?.length ? `requirements ${subject.requirement_ids.join(", ")}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "project-level work";
}

function formatDetectedStackForUser(stack = []) {
  const entries = stack
    .slice(0, 10)
    .map((item) => [item.name || item.type, item.source_path ? `from ${item.source_path}` : null].filter(Boolean).join(" "))
    .filter(Boolean);
  return entries.length ? formatLimitedList(entries, 10) : "none detected";
}

function formatCapabilityEvidenceForUser(evidence = []) {
  const entries = evidence
    .slice(0, 10)
    .map((item) => {
      const label = [item.type || "evidence", item.path ? `from ${item.path}` : null].filter(Boolean).join(" ");
      return item.summary ? `${label}: ${compactText(item.summary, 140)}` : label;
    })
    .filter(Boolean);
  return entries.length ? formatLimitedList(entries, 10) : "no evidence listed";
}

function formatCapabilityRecommendationsForUser(recommendations = []) {
  const entries = recommendations
    .slice(0, 10)
    .map((item) => {
      const permissionText = item.permissions?.length ? ` permissions ${item.permissions.join("/")}` : "";
      const installText = item.install_required ? " requires install approval" : " no install";
      const purposeText = item.purpose ? ` - ${compactText(item.purpose, 120)}` : "";
      return `${item.type}:${item.name} (${item.availability || "unknown"};${permissionText}${installText})${purposeText}`;
    })
    .filter(Boolean);
  return entries.length ? formatLimitedList(entries, 10) : "no concrete capabilities listed";
}

function formatCapabilityPolicyPatchForUser(policy = null) {
  const normalized = buildCapabilityPolicy(policy);
  const group = (name) => normalized[name] || emptyCapabilitySet();
  const required = [
    ...group("skills").required.map((name) => `skill:${name}`),
    ...group("mcp").required.map((name) => `mcp:${name}`),
    ...group("tools").required.map((name) => `tool:${name}`),
    ...group("plugins").required.map((name) => `plugin:${name}`),
    ...group("connectors").required.map((name) => `connector:${name}`),
    ...group("models").required.map((name) => `model:${name}`),
  ];
  const allowed = [
    ...group("skills").allowed.map((name) => `skill:${name}`),
    ...group("mcp").allowed.map((name) => `mcp:${name}`),
    ...group("tools").allowed.map((name) => `tool:${name}`),
    ...group("plugins").allowed.map((name) => `plugin:${name}`),
    ...group("connectors").allowed.map((name) => `connector:${name}`),
    ...group("models").allowed.map((name) => `model:${name}`),
  ];
  const forbidden = [
    ...group("skills").forbidden.map((name) => `skill:${name}`),
    ...group("mcp").forbidden.map((name) => `mcp:${name}`),
    ...group("tools").forbidden.map((name) => `tool:${name}`),
    ...group("plugins").forbidden.map((name) => `plugin:${name}`),
    ...group("connectors").forbidden.map((name) => `connector:${name}`),
    ...group("models").forbidden.map((name) => `model:${name}`),
  ];
  return [
    required.length ? `Required tools/capabilities: ${formatLimitedList(required, 8)}` : null,
    allowed.length ? `Allowed tools/capabilities: ${formatLimitedList(allowed, 8)}` : null,
    forbidden.length ? `Forbidden tools/capabilities: ${formatLimitedList(forbidden, 8)}` : null,
    normalized.approval_required_for.length ? `Extra approval required for: ${formatLimitedList(normalized.approval_required_for, 8)}` : null,
  ].filter(Boolean).join(" | ") || null;
}

function formatCapabilityBindingsForUser(bindings = []) {
  const entries = bindings
    .slice(0, 8)
    .map((binding) => {
      const permissions = binding.permissions?.length ? ` permissions ${binding.permissions.join("/")}` : "";
      const target = binding.target && Object.keys(binding.target).length ? ` target ${compactText(JSON.stringify(binding.target), 120)}` : "";
      return `${binding.type}:${binding.name}${binding.binding_id ? ` (${binding.binding_id})` : ""}${permissions}${target}`;
    })
    .filter(Boolean);
  return entries.length ? formatLimitedList(entries, 8) : "no specific bindings";
}

function formatCapabilityInstallNeeds(recommendations = []) {
  const installs = (recommendations || [])
    .filter((item) => item.install_required && !item.install_approved)
    .map((item) => `${item.type}:${item.name}`)
    .filter(Boolean);
  return installs.length ? formatLimitedList(installs, 8) : "no pending installs";
}

function collectOutputTemplateApprovalRequests(context, storyId = null) {
  const registry = readOutputRegistry(context, { missingOk: true });
  if (!registry) {
    return [];
  }
  const relevantTemplateIds = storyId ? collectStoryTemplateIds(context, storyId, registry) : null;
  return (registry.templates || [])
    .filter((template) => !relevantTemplateIds || relevantTemplateIds.has(template.id) || outputTemplateNeedsApproval(context, template))
    .filter((template) => outputTemplateNeedsApproval(context, template))
    .map((template) => buildOutputTemplateApprovalRequest(context, template));
}

function outputTemplateNeedsApproval(context, template) {
  if (template.status !== "approved" || !template.path || !template.approved_content_hash) {
    return true;
  }
  const templatePath = resolveProjectFilePath(context, template.path, { mustExist: false });
  return (
    !fs.existsSync(templatePath) ||
    !fs.statSync(templatePath).isFile() ||
    hashFile(templatePath) !== template.approved_content_hash ||
    !outputDeliveryIsFresh(template)
  );
}

function buildOutputTemplateApprovalRequest(context, template) {
  const templateExcerpt = template.path ? readProjectFileExcerpt(context, template.path, 1200) : null;
  const templateHeadings = template.path ? readProjectMarkdownHeadings(context, template.path, 10) : [];
  const delivery = effectiveOutputDelivery(template);
  return {
    id: `approve-output-template-${template.id}`,
    type: "output_template_approval",
    status: "needs_explicit_user_approval",
    summary: `Agree output format ${template.id} for ${template.type} before using it as a contract output.`,
    subject_id: template.id,
    subject_status: template.status || null,
    artifact_type: template.type || null,
    sources: [template.path, ".sdlc/output-contracts/registry.json"].filter(Boolean),
    ...humanApprovalFields({
      title: `Assessment format (${template.id})`,
      why_needed: "Before I write the assessment, I need to confirm its sections, level of detail, and canonical file format.",
      review_items: [
        "What this is: the proposed structure and delivery style for the assessment. It does not approve the final assessment content or the work brief.",
        `Decision scope: this only approves the document structure for ${template.type || "this"} outputs. It does not approve the final assessment content.`,
        `Output type: ${template.type || "unknown"}`,
        `Canonical result: ${formatOutputDeliveryForHuman(delivery)}. This choice is enforced when the output file is linked.`,
        template.summary ? `Summary: ${template.summary}` : null,
        templateHeadings.length ? `Assessment sections: ${templateHeadings.join(" > ")}` : null,
        template.path ? `Template file: ${template.path}` : null,
        `Template content to review: ${templateExcerpt || "unavailable"}`,
      ],
      delivery_format_options: [
        ...canonicalOutputFormatOptions(),
        ...deliveryFormatOptionsForOutput(template.type),
      ],
      recommended_delivery_format: formatOutputDeliveryForHuman(delivery),
      delivery_question: `Should the canonical result remain ${delivery.label} (${delivery.extension}) with delivery mode ${delivery.mode}, or should I change it before approval?`,
      approval_meaning: "If you approve it, I can write the assessment using this structure and must deliver the canonical file in the selected format. You will still review the actual content afterwards.",
      approve_if: "Approve if these sections match the assessment you expect.",
      change_if: "Ask for changes if you want different sections, more detail, less detail, or a different presentation.",
      after_approval: `Then I can use ${template.id} as the assessment format.`,
      user_prompt: `Is this assessment format OK, or should I change the sections before writing it?`,
      approval_phrase: `The assessment format ${template.id} is OK.`,
    }),
    suggested_question: `After reviewing the template structure, do you approve output format ${template.id} for ${template.type}?`,
    suggested_command: `agentic-sdlc output template approve --id ${template.id} --actor-type human --approval-source explicit-user --summary "<user-approved output format>"`,
  };
}

function collectContractApprovalRequests(context, storyId = null) {
  return collectJsonFiles(context, path.join(context.sdlcRoot, "contracts"))
    .filter((contract) => !storyId || contract.story_id === storyId)
    .filter((contract) => collectContractReadinessGaps(context, contract).length === 0)
    .filter((contract) => collectContractDependencyFreshnessGaps(context, contract).length === 0)
    .filter((contract) => contract.human_gate === true && (contract.status !== "approved" || !hasFreshApprovedContractApproval(contract)))
    .map((contract) => ({
      id: `approve-contract-${contract.id}`,
      type: "contract_approval",
      status: "needs_explicit_user_approval",
      summary: `Approve or revise ${contract.phase} contract ${contract.id} before phase work proceeds.`,
      subject_id: contract.id,
      subject_status: contract.status || null,
      story_id: contract.story_id || null,
      phase: contract.phase || null,
      sources: [contract.__relative_path],
      ...humanApprovalFields({
        title: `Work brief (${contract.id})`,
        why_needed: "This is the short operating brief for the work: what I should do, what context to use, what output to produce, and what boundaries to respect.",
        review_items: describeContractForHuman(context, contract),
        delivery_format_options: deliveryFormatOptionsForContract(contract),
        recommended_delivery_format: recommendedDeliveryFormatForContract(contract),
        delivery_question: deliveryQuestionForContract(contract),
        approval_meaning: "If you approve it, I can start the work under this brief. You are not approving the final result yet.",
        approve_if: "Approve if the objective, context, boundaries, tools, and expected output match what you want.",
        change_if: "Ask for changes if the scope is unclear, important files are missing, or the output is not what you want.",
        after_approval: `Then the step can start, and outputs must still follow the approved template.`,
        user_prompt: `Can I use this work brief, or should I change scope, context, output, or criteria first?`,
        approval_phrase: `Use work brief ${contract.id}.`,
      }),
      suggested_question: `Review contract ${contract.id}. Do you approve this phase contract, or should it be changed?`,
      suggested_command: `agentic-sdlc contract approve --id ${contract.id} --actor-type human --approval-source explicit-user --summary "<user-approved contract>"`,
    }));
}

function collectContractClarificationRequests(context, storyId = null) {
  return collectJsonFiles(context, path.join(context.sdlcRoot, "contracts"))
    .filter((contract) => !storyId || contract.story_id === storyId)
    .map((contract) => ({
      contract,
      gaps: [
        ...collectContractReadinessGaps(context, contract),
        ...collectContractDependencyFreshnessGaps(context, contract),
      ],
    }))
    .filter((item) => item.gaps.length > 0)
    .map(({ contract, gaps }) => ({
      id: `clarify-contract-${contract.id}`,
      type: "contract_clarification",
      status: "needs_user_input",
      summary: `Clarify contract ${contract.id} before approval: ${gaps.map((gap) => gap.summary).join("; ")}.`,
      subject_id: contract.id,
      subject_status: contract.status || null,
      story_id: contract.story_id || null,
      phase: contract.phase || null,
      gaps: gaps.map((gap) => gap.code),
      sources: [contract.__relative_path],
      ...humanApprovalFields({
        title: `Work brief needs clarification or refresh (${contract.id})`,
        why_needed: "The brief is incomplete or one of its project, output-format, or tool references changed. I need to refresh it before asking you to approve the current work.",
        review_items: [
          ...describeContractForHuman(context, contract),
          ...gaps.map((gap) => `Missing: ${gap.summary}`),
        ],
        approval_meaning: "This is not an approval yet. It is a request for missing context.",
        approve_if: null,
        change_if: "Answer with the files or facts I should use, or ask me to rewrite the brief with different context.",
        after_approval: "After clarification, the contract can be proposed again for explicit approval.",
        user_prompt: `Which files, facts, constraints, or decisions should guide this work? ${gaps.map((gap) => gap.question).join(" ")}`,
      }),
      suggested_question: `Before approving ${contract.id}, please provide: ${gaps.map((gap) => gap.question).join(" ")}`,
    }));
}

function collectOutputLinkActionRequests(context, storyId = null) {
  const registry = readOutputRegistry(context, { missingOk: true });
  const links = registry?.links || [];
  const requests = [];
  for (const contract of collectJsonFiles(context, path.join(context.sdlcRoot, "contracts"))) {
    if (storyId && contract.story_id !== storyId) {
      continue;
    }
    if (!isTaskContractApproved(context, contract) || collectContractReadinessGaps(context, contract).length > 0) {
      continue;
    }
    const candidates = contract.story_id ? findUnlinkedStoryOutputCandidates(context, contract.story_id) : [];
    if (candidates.length === 0) {
      continue;
    }
    for (const ref of contract.output_contract_refs || []) {
      if (!ref.artifact_type || !ref.template_id || !ref.mode || !contract.story_id) {
        continue;
      }
      const matchingLink = links.find(
        (link) =>
          link.story_id === contract.story_id &&
          link.artifact_type === ref.artifact_type &&
          link.template_id === ref.template_id &&
          link.mode === ref.mode,
      );
      if (!matchingLink) {
        requests.push({
          id: `link-output-${contract.story_id}-${ref.artifact_type}`,
          type: "output_link_required",
          status: "needs_canonical_output_link",
          summary: `Link the ${ref.artifact_type} artifact for ${contract.story_id} after the user has agreed the output and it exists.`,
          subject_id: contract.id,
          story_id: contract.story_id,
          artifact_type: ref.artifact_type,
          template_id: ref.template_id,
          mode: ref.mode,
          sources: [contract.__relative_path],
          ...humanApprovalFields({
            title: `Canonical ${ref.artifact_type} output for ${contract.story_id}`,
            why_needed: "The contract requires a durable output, but the canonical file representing the phase result is not linked yet.",
            review_items: [
              `Story: ${contract.story_id}`,
              `Output type: ${ref.artifact_type}`,
              `Required template: ${ref.template_id}`,
              `Mode: ${ref.mode}`,
              `Contract: ${contract.id}`,
              `Available unlinked result files: ${formatLimitedList(candidates, 8)}`,
            ],
            approval_meaning: "Choosing the canonical file makes that artifact verifiable by later gates.",
            approve_if: "Provide the file only when the output exists and is the official source you want to use.",
            change_if: "Ask for changes if the output does not exist yet, does not follow the template, or does not represent the correct result.",
            after_approval: "After the link, the gate can verify hashes, template, mode, and covered requirements.",
            user_prompt: `Which file should be the canonical ${ref.artifact_type} output for ${contract.story_id}?`,
          }),
          suggested_question: `Which ${ref.artifact_type} artifact should be canonical for ${contract.story_id}?`,
          suggested_command: `agentic-sdlc output link --story ${contract.story_id} --type ${ref.artifact_type} --artifact ${candidates[0]} --template ${ref.template_id} --mode ${ref.mode} --requirement <REQ-ID>`,
        });
      }
    }
  }
  return requests;
}

function humanApprovalFields(fields = {}) {
  const reviewItems = normalizeListValue(fields.review_items, [])
    .map((item) => (item === null || item === undefined ? null : String(item).trim()))
    .filter(Boolean);
  return {
    title: fields.title || null,
    why_needed: fields.why_needed || null,
    review_items: reviewItems,
    delivery_format_options: normalizeDeliveryFormatOptions(fields.delivery_format_options || []),
    recommended_delivery_format: fields.recommended_delivery_format || null,
    delivery_question: fields.delivery_question || null,
    approval_meaning: fields.approval_meaning || null,
    approval_scope: normalizeApprovalRequestScope(fields.approval_scope),
    approve_if: fields.approve_if || null,
    change_if: fields.change_if || null,
    after_approval: fields.after_approval || null,
    user_prompt: fields.user_prompt || null,
    approval_phrase: fields.approval_phrase || null,
  };
}

function normalizeApprovalRequestScope(scope = null) {
  return {
    applies_only_to_presented_item: true,
    cannot_approve_future_artifacts: true,
    requires_fresh_confirmation_for_new_artifacts: true,
    ...(scope && typeof scope === "object" ? scope : {}),
  };
}

function normalizeDeliveryFormatOptions(options = []) {
  const rawOptions = Array.isArray(options) ? options : [];
  return rawOptions
    .map((option) => {
      if (typeof option === "string") {
        const label = option.trim();
        return label ? { id: slugify(label), label, description: null } : null;
      }
      if (!option || typeof option !== "object") {
        return null;
      }
      const label = String(option.label || option.id || "").trim();
      const id = slugify(option.id || label);
      if (!id || !label) {
        return null;
      }
      return {
        id,
        label,
        description: option.description ? String(option.description).trim() : null,
        when_to_use: option.when_to_use ? String(option.when_to_use).trim() : null,
      };
    })
    .filter(Boolean);
}

function formatDeliveryFormatOption(option) {
  return [
    option.label,
    option.description ? ` - ${option.description}` : null,
    option.when_to_use ? ` Use when: ${option.when_to_use}` : null,
  ].filter(Boolean).join("");
}

function canonicalOutputFormatOptions() {
  return Object.entries(OUTPUT_FORMATS)
    .filter(([format]) => format !== "custom")
    .map(([format, descriptor]) => ({
      id: format,
      label: `${descriptor.label} (${descriptor.extension})`,
      description: descriptor.generator
        ? `Canonical file generated and verified with the ${descriptor.generator} artifact capability.`
        : "Canonical file stored in the project and verified by the SDLC gate.",
    }));
}

function deliveryFormatOptionsForOutput(artifactType = "", phase = null) {
  const normalized = String(artifactType || phase || "").toLowerCase();
  const options = [
    {
      id: "chat-summary",
      label: "Chat summary",
      description: "A concise answer in chat with key points, decisions, risks, and next steps.",
    },
    {
      id: "canonical-document",
      label: "Project document",
      description: "A saved Markdown document that can be reviewed and reused later.",
    },
    {
      id: "document-plus-chat-summary",
      label: "Project document plus chat summary",
      description: "Create the saved document and also explain the outcome briefly in chat.",
    },
    {
      id: "decision-risk-action-list",
      label: "Decision, risk, and action list",
      description: "A compact list of decisions made, risks found, owners or follow-up actions, and open questions.",
    },
  ];

  if (matchesAny(normalized, ["analysis", "assessment", "discovery", "research", "requirement"])) {
    options.push(
      {
        id: "executive-summary",
        label: "Executive summary",
        description: "A short stakeholder-friendly summary before the detailed analysis.",
      },
      {
        id: "detailed-findings",
        label: "Detailed findings",
        description: "Findings with evidence, impact, recommendation, confidence, and affected areas.",
      },
      {
        id: "comparison-table",
        label: "Comparison table",
        description: "Options or alternatives compared by criteria, tradeoffs, risks, and recommendation.",
      },
      {
        id: "architecture-or-flow-view",
        label: "Architecture or flow view",
        description: "A diagram-ready architecture, flow, or component view when the output benefits from structure.",
      },
    );
  }

  if (matchesAny(normalized, ["design", "architecture", "api", "ux", "ui"])) {
    options.push(
      {
        id: "design-rationale",
        label: "Design rationale",
        description: "Design decisions, rejected alternatives, constraints, and tradeoffs.",
      },
      {
        id: "interface-contracts",
        label: "Interface contracts",
        description: "API, component, data, event, or integration contracts that implementation should follow.",
      },
      {
        id: "diagram-ready-summary",
        label: "Diagram-ready summary",
        description: "A concise structure suitable for Mermaid, architecture diagrams, or sequence flows.",
      },
    );
  }

  if (matchesAny(normalized, ["implementation", "code", "patch", "change", "class", "component"])) {
    options.push(
      {
        id: "changed-files-summary",
        label: "Changed files summary",
        description: "List changed files with why each changed and what behavior changed.",
      },
      {
        id: "modified-classes-components",
        label: "Modified classes or components",
        description: "List the important classes, modules, functions, components, routes, or screens touched.",
      },
      {
        id: "diff-review",
        label: "Diff or patch review",
        description: "Show a focused diff-style explanation for review instead of pasting full files.",
      },
      {
        id: "key-code-snippets",
        label: "Key code snippets",
        description: "Show only the most relevant snippets needed to understand the change.",
      },
      {
        id: "tests-and-verification",
        label: "Tests and verification",
        description: "Report commands run, evidence, failures, skipped checks, and residual risk.",
      },
      {
        id: "no-code-summary",
        label: "No-code summary",
        description: "Summarize behavior and changed areas without showing code unless requested.",
      },
    );
  }

  if (matchesAny(normalized, ["validation", "test", "qa", "verification"])) {
    options.push(
      {
        id: "test-evidence",
        label: "Test evidence",
        description: "Commands, results, evidence paths, failing cases, and logs or reports.",
      },
      {
        id: "regression-risk-summary",
        label: "Regression risk summary",
        description: "What was covered, what was not covered, likely regressions, and manual checks.",
      },
      {
        id: "failure-triage",
        label: "Failure triage",
        description: "Failures grouped by root cause, severity, owner, and next action.",
      },
    );
  }

  if (matchesAny(normalized, ["release", "deploy", "deployment", "handoff"])) {
    options.push(
      {
        id: "release-notes",
        label: "Release notes",
        description: "User-visible changes, technical changes, migrations, and known issues.",
      },
      {
        id: "deployment-checklist",
        label: "Deployment checklist",
        description: "Pre-release checks, deploy steps, post-release verification, and rollback criteria.",
      },
      {
        id: "handoff-summary",
        label: "Handoff summary",
        description: "What is done, what is pending, evidence links, risks, and next owner.",
      },
    );
  }

  return dedupeDeliveryFormatOptions(options);
}

function matchesAny(value, terms) {
  return terms.some((term) => value.includes(term));
}

function dedupeDeliveryFormatOptions(options) {
  const seen = new Set();
  const result = [];
  for (const option of normalizeDeliveryFormatOptions(options)) {
    if (seen.has(option.id)) {
      continue;
    }
    seen.add(option.id);
    result.push(option);
  }
  return result;
}

function recommendedDeliveryFormatForOutput(artifactType = "", phase = null) {
  const normalized = String(artifactType || phase || "").toLowerCase();
  if (matchesAny(normalized, ["implementation", "code", "patch", "change"])) {
    return "changed-files-summary + modified-classes-components + tests-and-verification; include diff-review or key-code-snippets only when the user asks for code-level review.";
  }
  if (matchesAny(normalized, ["validation", "test", "qa", "verification"])) {
    return "test-evidence + regression-risk-summary, with failure-triage when checks fail.";
  }
  if (matchesAny(normalized, ["release", "deploy", "deployment", "handoff"])) {
    return "release-notes + deployment-checklist + handoff-summary.";
  }
  if (matchesAny(normalized, ["design", "architecture", "api", "ux", "ui"])) {
    return "Project document plus chat summary, with design rationale and interface contracts when implementation will follow.";
  }
  return "Project document plus chat summary: save the assessment and provide a concise chat summary.";
}

function deliveryQuestionForOutput(artifactType = "", phase = null) {
  const label = humanOutputLabel(artifactType || phase || "this output");
  const optionLabels = deliveryFormatOptionsForOutput(artifactType, phase).map((option) => option.label).join(", ");
  return `How should I present ${label} results to you? Choose one option or combine several: ${optionLabels}. You can also ask for a custom delivery format.`;
}

function contractDeliveryDescriptor(contract) {
  const outputTypes = Array.isArray(contract.output_contract_refs)
    ? contract.output_contract_refs.map((ref) => ref.artifact_type).filter(Boolean)
    : [];
  return [contract.phase, ...outputTypes].filter(Boolean).join(" ");
}

function deliveryFormatOptionsForContract(contract) {
  return deliveryFormatOptionsForOutput(contractDeliveryDescriptor(contract), contract.phase);
}

function recommendedDeliveryFormatForContract(contract) {
  return recommendedDeliveryFormatForOutput(contractDeliveryDescriptor(contract), contract.phase);
}

function deliveryQuestionForContract(contract) {
  const subject = contract.story_id || "this project";
  const optionLabels = deliveryFormatOptionsForContract(contract).map((option) => option.label).join(", ");
  return `How should I present the ${contract.phase} result for ${subject}? Choose one option or combine several: ${optionLabels}. You can also ask for a custom delivery format.`;
}

function humanOutputLabel(value) {
  const normalized = String(value || "").trim().toLowerCase();
  const labels = {
    "functional-analysis": "functional analysis",
    "technical-analysis": "technical assessment",
    "technical-decision-matrix": "technical decision matrix",
    "test-strategy": "test strategy",
    "test-plan": "test plan",
    "implementation-summary": "implementation summary",
    "release-evidence": "release evidence",
  };
  return labels[normalized] || String(value || "this output").replace(/[-_]+/g, " ");
}

function formatHumanApprovalRequest(request, index = null) {
  const prefix = index === null ? "-" : `${index}.`;
  const plain = plainApprovalRequestCopy(request);
  const reviewItems = userVisibleReviewItems(request);
  const reviewLimit = request.type === "baseline_approval" ? 10 : 8;
  const lines = [
    `${prefix} ${plain.title}`,
    plain.explanation ? `   In plain language: ${plain.explanation}` : null,
    request.why_needed ? `   Why it matters: ${request.why_needed}` : null,
    reviewItems.length ? "   What is inside this item:" : null,
    ...reviewItems.slice(0, reviewLimit).map((item) => `   - ${item}`),
    request.delivery_format_options?.length ? "   How I can present the result:" : null,
    ...(request.delivery_format_options || []).slice(0, 10).map((option) => `   - ${formatDeliveryFormatOption(option)}`),
    request.recommended_delivery_format ? `   Suggested presentation: ${request.recommended_delivery_format}` : null,
    request.delivery_question ? `   Presentation question: ${request.delivery_question}` : null,
    request.approval_meaning ? `   If you say yes: ${request.approval_meaning}` : null,
    `   Scope of your answer: it applies only to ${plain.title}. It does not approve later format, tool, brief, or start decisions unless I show them or you already gave a broader scope.`,
    request.approve_if ? `   Say yes if: ${request.approve_if}` : null,
    request.change_if ? `   Ask for changes if: ${request.change_if}` : null,
    request.after_approval ? `   After that: ${request.after_approval}` : null,
    request.user_prompt ? "   What I need from you: approve this item, ask me to change it, or provide missing information." : null,
    request.user_prompt ? `   Decision needed: ${request.user_prompt}` : null,
    request.approval_phrase ? `   Example answer: "${plain.example || request.approval_phrase}"` : null,
    "",
  ];
  return lines.filter((line) => line !== null && line !== undefined);
}

function userVisibleReviewItems(request) {
  return (request.review_items || [])
    .map((item) => simplifyReviewItemForUser(request, item))
    .filter(Boolean);
}

function simplifyReviewItemForUser(request, item) {
  const text = String(item || "").trim();
  if (!text) {
    return null;
  }
  if (/^Allowed tools:/.test(text)) {
    return `Tools and access being approved: ${text.replace(/^Allowed tools:\s*/, "")}`;
  }
  if (/^Template file:/.test(text)) {
    return `Template source: ${text.replace(/^Template file:\s*/, "")}`;
  }
  if (/^Template content to review:/.test(text)) {
    return `Proposed document structure: ${text.replace(/^Template content to review:\s*/, "")}`;
  }
  if (/^Decision scope:/.test(text)) {
    return `Decision scope: this only approves the document structure for ${humanOutputLabel(request.artifact_type || "this output")} work. It does not approve the final content.`;
  }
  if (/^Assessment sections:/.test(text)) {
    const sections = text
      .replace(/^Assessment sections:\s*/, "")
      .split(/\s*>\s*/)
      .filter((section) => section && !/-v\d+$/i.test(section));
    return `Assessment sections: ${sections.join(", ")}`;
  }
  if (/^Output type:/.test(text)) {
    return `Output: ${humanOutputLabel(text.replace(/^Output type:\s*/, ""))}`;
  }
  if (/^Story:/.test(text)) {
    return `Work item: ${text.replace(/^Story:\s*/, "")}`;
  }
  if (/^Purpose: Translate approved discovery output/.test(text)) {
    return "Goal: produce a clear technical assessment with architecture, boundaries, risks, and recommendations.";
  }
  if (/^Expected outputs:/.test(text)) {
    const outputs = text
      .replace(/^Expected outputs:\s*/, "")
      .split(/\s*,\s*/)
      .map((item) => humanOutputLabel(item.split(":")[0]))
      .filter(Boolean);
    return `Expected output: ${outputs.join(", ")}`;
  }
  if (/^Missing: missing project-specific context/.test(text)) {
    return "Missing: I need to know which project files, facts, constraints, or decisions should guide the work.";
  }
  if (/^Missing: missing agreed output format/.test(text)) {
    return "Missing: I need to know what output this work should produce.";
  }
  return text
    .replace(/--[A-Za-z0-9-]+(?:\s+[A-Za-z0-9:|<>\-]+)?/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function plainApprovalRequestCopy(request) {
  switch (request.type) {
    case "baseline_approval":
      return {
        title: `Project context (${request.subject_id})`,
        explanation: "I inferred facts about the project. Confirming them lets me use those facts as trusted context instead of guessing.",
        example: `Use project context ${request.subject_id}.`,
      };
    case "output_template_approval":
      return {
        title: `Assessment format (${request.subject_id})`,
        explanation: "This is the structure of the assessment I will write: sections, level of detail, and presentation style.",
        example: `The assessment format ${request.subject_id} is OK.`,
      };
    case "capability_profile_approval":
      return {
        title: `Project evidence and boundaries (${request.subject_id})`,
        explanation: "This defines which project evidence, local checks, and tool boundaries I may use. It is not approval of the final assessment or work brief.",
        example: "Use this evidence and boundary set.",
      };
    case "capability_recommendation_approval":
      return {
        title: `Allowed tools for this work (${request.subject_id})`,
        explanation: "This is the concrete list of skills, tools, connectors, permissions, and installs I would be allowed to use.",
        example: "Use these tool choices.",
      };
    case "contract_clarification":
      return {
        title: `Missing work context (${request.subject_id})`,
        explanation: "I need to know which files, facts, constraints, or decisions should guide the work before I start.",
        example: "Use the listed files as context and include current architecture, risks, and recommendations.",
      };
    case "contract_approval":
      return {
        title: `Work brief (${request.subject_id})`,
        explanation: "This confirms what I am allowed to do and what output I should produce. It is not approval of the final result.",
        example: `Use work brief ${request.subject_id}.`,
      };
    case "output_link_required":
      return {
        title: `Official output file (${request.artifact_type || request.subject_id})`,
        explanation: "I need to know which generated file should be treated as the official result for later checks.",
      };
    default:
      return {
        title: request.title || request.summary,
        explanation: null,
      };
  }
}

function describeContractForHuman(context, contract) {
  const contextualization = contract.contextualization || {};
  const contextSources = Array.isArray(contextualization.context_sources)
    ? contextualization.context_sources.map((source) => source.path).filter(Boolean)
    : [];
  const answeredQuestions = Array.isArray(contextualization.questions)
    ? contextualization.questions
        .filter((question) => question.status === "answered")
        .map((question) => `${question.question}: ${question.answer}`)
    : [];
  const openQuestions = Array.isArray(contextualization.questions)
    ? contextualization.questions
        .filter((question) => question.status !== "answered")
        .map((question) => question.question)
    : [];
  const registry = readOutputRegistry(context, { missingOk: true });
  const outputRefs = Array.isArray(contract.output_contract_refs)
    ? contract.output_contract_refs.map((ref) => {
        const template = (registry?.templates || []).find((item) => item.id === ref.template_id);
        const delivery = template ? effectiveOutputDelivery(template) : null;
        return `${ref.artifact_type}:${ref.template_id}:${ref.mode}${delivery ? ` -> ${delivery.label} ${delivery.extension}, ${delivery.mode}` : ""}`;
      })
    : [];
  const sourceEvidence = contextSources
    .slice(0, 8)
    .map((sourcePath) => {
      const excerpt = readProjectFileExcerpt(context, sourcePath, 220);
      return excerpt ? `${sourcePath}: ${excerpt}` : `${sourcePath}: unavailable or non-text evidence`;
    });
  return [
    contract.story_id ? `Story: ${contract.story_id}` : "Scope: project",
    contract.purpose ? `Purpose: ${contract.purpose}` : null,
    contextualization.summary ? `Context: ${contextualization.summary}` : null,
    contextSources.length ? `Context sources: ${contextSources.join(", ")}` : null,
    sourceEvidence.length ? `What those sources say: ${sourceEvidence.join(" | ")}` : null,
    answeredQuestions.length ? `Recorded answers: ${answeredQuestions.join("; ")}` : null,
    openQuestions.length ? `Open questions: ${openQuestions.join("; ")}` : null,
    outputRefs.length ? `Expected outputs: ${outputRefs.join(", ")}` : null,
    contract.validation?.length ? `Validation: ${contract.validation.slice(0, 4).join("; ")}` : null,
    contract.allowed_tools?.length ? `Allowed tools: ${contract.allowed_tools.slice(0, 6).join(", ")}` : null,
  ].filter(Boolean);
}

function readProjectFileExcerpt(context, relativePath, maxLength = 220) {
  try {
    const filePath = resolveProjectFilePath(context, relativePath, { mustExist: true, fileOnly: true });
    return compactText(readProjectText(context, filePath), maxLength);
  } catch {
    return null;
  }
}

function readProjectMarkdownHeadings(context, relativePath, maxHeadings = 8) {
  try {
    const filePath = resolveProjectFilePath(context, relativePath, { mustExist: true, fileOnly: true });
    return readProjectText(context, filePath)
      .split(/\r?\n/)
      .map((line) => line.match(/^(#{1,3})\s+(.+?)\s*$/))
      .filter(Boolean)
      .map((match) => match[2].replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, maxHeadings);
  } catch {
    return [];
  }
}

function compactText(value, maxLength = 220) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function capitalizeLabel(value) {
  const text = String(value || "phase");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function collectStoryTemplateIds(context, storyId, registry = null) {
  const ids = new Set();
  for (const contract of collectJsonFiles(context, path.join(context.sdlcRoot, "contracts"))) {
    if (contract.story_id === storyId) {
      for (const ref of contract.output_contract_refs || []) {
        if (ref.template_id) {
          ids.add(ref.template_id);
        }
      }
    }
  }
  for (const link of registry?.links || []) {
    if (link.story_id === storyId && link.template_id) {
      ids.add(link.template_id);
    }
  }
  return ids;
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
  validateContractReadinessForCreate(context, contract, options);
  validateContractOutputRefsForCreate(context, normalizeRawListOption(options["output-ref"]), options);
  const contractPath = path.join(context.sdlcRoot, "contracts", `${id}.json`);
  let linkedStory;
  const releaseLock = acquireFileLock(`${contractPath}.lock`);
  try {
    const storyLink = validateStoryContractLinkForCreate(context, storyId, id, options);
    writeJsonFile(contractPath, contract, { force: Boolean(options.force) });
    linkedStory = linkStoryToContractAfterCreate(context, storyLink, contract, contractPath);
  } finally {
    releaseLock();
  }
  output(
    options,
    { status: "created", contract_path: contractPath, contract, story_link: linkedStory },
    [`Created contract ${id} for phase ${phase}`],
  );
}

function validateStoryContractLinkForCreate(context, storyId, contractId, options = {}) {
  if (!storyId) {
    return null;
  }
  const story = readStory(context, storyId);
  if (!story) {
    fail(`Story ${storyId} does not exist; create the story before creating story contract ${contractId}.`);
  }
  const currentContractId = story.contract_id ? normalizeId(String(story.contract_id)) : null;
  if (currentContractId && currentContractId !== contractId && !options["replace-story-contract"]) {
    fail(
      [
        `Story ${storyId} already references contract ${currentContractId}.`,
        `Refusing to create story contract ${contractId} without updating the story link.`,
        "Use --replace-story-contract only for explicit contract renegotiation or recovery.",
      ].join("\n"),
    );
  }
  return {
    story_id: storyId,
    current_contract_id: currentContractId,
    should_link: currentContractId !== contractId,
  };
}

function linkStoryToContractAfterCreate(context, storyLink, contract, contractPath) {
  if (!storyLink || !storyLink.should_link) {
    return storyLink ? { status: "already_linked", story_id: storyLink.story_id, contract_id: contract.id } : null;
  }
  const storyPath = path.join(context.sdlcRoot, "stories", storyLink.story_id, "story.json");
  const story = readProjectJson(context, storyPath);
  story.contract_id = contract.id;
  story.updated_at = now();
  story.audit = {
    ...(story.audit || {}),
    updated_by: contract.audit?.updated_by || contract.audit?.created_by || null,
    git: contract.audit?.git || buildGitMetadata(context.root),
    run: contract.audit?.run || buildRunMetadata({}),
  };
  writeJsonFile(storyPath, story, { force: true });
  appendTraceEvent(context, storyLink.story_id, {
    type: "decision",
    summary: `Linked story ${storyLink.story_id} to contract ${contract.id}`,
    action: "contract.story-link",
    actor: contract.audit?.updated_by || contract.audit?.created_by || null,
    evidence: [toProjectPath(context, storyPath), toProjectPath(context, contractPath)],
    related: [storyLink.story_id, contract.id],
    git: contract.audit?.git,
    run: contract.audit?.run,
  });
  return {
    status: storyLink.current_contract_id ? "replaced" : "linked",
    story_id: storyLink.story_id,
    previous_contract_id: storyLink.current_contract_id,
    contract_id: contract.id,
    story_path: storyPath,
  };
}

function validateContractReadinessForCreate(context, contract, options = {}) {
  if (options["allow-incomplete-contract"]) {
    return;
  }
  const gaps = collectContractReadinessGaps(context, contract);
  if (gaps.length === 0) {
    return;
  }
  const askTopics = normalizeListValue(context.config.contract_generation?.ask_when_missing, []);
  fail(
    [
      "Contract creation requires enough agreed input to guide the phase.",
      ...gaps.map((gap) => `- ${gap.summary}`),
      "Ask the user for the missing information before creating the contract.",
      storyOutputResolveHint(contract),
      askTopics.length > 0 ? `Configured ask-when-missing topics: ${askTopics.join(", ")}.` : null,
      "Use --allow-incomplete-contract only to persist an explicit clarification, migration, or recovery draft; do not use it to start phase work.",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

function collectContractReadinessGaps(context, contract) {
  const contextualization = contract.contextualization || {};
  const questions = Array.isArray(contextualization.questions) ? contextualization.questions : [];
  const openQuestions = questions.filter((question) => question.status !== "answered");
  const answeredQuestions = questions.filter((question) => question.status === "answered");
  const contextSources = Array.isArray(contextualization.context_sources) ? contextualization.context_sources : [];
  const refs = Array.isArray(contract.output_contract_refs) ? contract.output_contract_refs : [];
  const capabilityRefs = Array.isArray(contract.capability_recommendation_refs) ? contract.capability_recommendation_refs : [];
  const hasContextAnchor =
    Boolean(String(contextualization.summary || "").trim()) ||
    contextSources.length > 0 ||
    answeredQuestions.length > 0 ||
    capabilityRefs.length > 0;
  const gaps = [];
  if (!hasContextAnchor) {
    gaps.push({
      code: "missing_context",
      summary: "missing project-specific context",
      question: "Which project files, facts, constraints, or prior decisions should guide this work?",
    });
  }
  if (openQuestions.length > 0) {
    gaps.push({
      code: "open_questions",
      summary: `${openQuestions.length} open question${openQuestions.length === 1 ? "" : "s"} must be answered or explicitly moved into a clarification draft`,
      question: `Please answer or revise: ${openQuestions.map((item) => item.question).join(" ")}`,
    });
  }
  const template = context.config.phases[contract.phase] || {};
  const phaseHasOutputs = Array.isArray(template.outputs) && template.outputs.length > 0;
  const requiresOutputCoverage = context.config.gate_policy?.strict_mode?.requires_output_contract_coverage !== false;
  if (contract.story_id && phaseHasOutputs && requiresOutputCoverage && refs.length === 0) {
    gaps.push({
      code: "missing_output_ref",
      summary: "missing agreed output format for this story",
      question: "What output should this work produce, and should it be a new document or an update to an existing one?",
    });
  }
  return gaps;
}

function collectContractDependencyFreshnessGaps(context, contract) {
  const gaps = [];
  const addGap = (code, summary, question) => {
    if (!gaps.some((gap) => gap.code === code && gap.summary === summary)) {
      gaps.push({ code, summary, question });
    }
  };

  for (const source of contract.contextualization?.context_sources || []) {
    const sourcePath = source?.path || source;
    if (!sourcePath) {
      addGap("invalid_context_source", "a context source has no path", "Refresh the work brief because one of its context sources is invalid.");
      continue;
    }
    try {
      const resolved = resolveProjectFilePath(context, sourcePath, { mustExist: false });
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
        addGap("missing_context_source", `context source ${sourcePath} is missing`, `Refresh the work brief after choosing a current replacement for ${sourcePath}.`);
      } else if (!source.sha256 || hashFile(resolved) !== source.sha256) {
        addGap("stale_context_source", `context source ${sourcePath} changed`, `Refresh the work brief from the current contents of ${sourcePath}; do not reuse its old approval.`);
      }
    } catch (error) {
      addGap("invalid_context_source", `context source ${sourcePath} is invalid`, `Refresh the work brief after correcting context source ${sourcePath}: ${error.message}`);
    }
  }

  const registry = readOutputRegistry(context, { missingOk: true });
  const templates = new Map((registry?.templates || []).map((template) => [template.id, template]));
  for (const ref of contract.output_contract_refs || []) {
    const template = templates.get(ref.template_id);
    if (!template) {
      addGap("missing_output_template", `output template ${ref.template_id} is missing`, `Create and review the required ${ref.artifact_type || "output"} format before refreshing the work brief.`);
      continue;
    }
    if (template.type !== ref.artifact_type || outputTemplateNeedsApproval(context, template)) {
      addGap("stale_output_template", `output template ${ref.template_id} is not approved for its current structure and delivery format`, `Review the current structure and canonical file format of ${ref.template_id}, then refresh the work brief.`);
    }
  }

  if ((contract.capability_recommendation_refs || []).length > 0) {
    const report = { strict: true, errors: [], warnings: [], checked: [] };
    validateContractCapabilityRecommendations(context, report, contract, `contract ${contract.id || "unknown"}`);
    for (const issue of [...report.errors, ...report.warnings]) {
      addGap("stale_capability_context", issue, "Refresh the capability evidence or tool recommendation, then refresh the work brief inside the approved scope.");
    }
  }

  return gaps;
}

function storyOutputResolveHint(contract) {
  if (!contract.story_id) {
    return null;
  }
  return `Resolve output first with: agentic-sdlc output resolve --story ${contract.story_id} --type <artifact-type>`;
}

function validateContractOutputRefsForCreate(context, rawRefs, options = {}) {
  if (rawRefs.length === 0 || options["allow-unapproved-output-ref"]) {
    return;
  }
  const refs = buildOutputContractRefs(rawRefs);
  const registry = readOutputRegistry(context, { missingOk: true });
  const templates = new Map((registry?.templates || []).map((template) => [template.id, template]));
  const errors = [];
  for (const ref of refs) {
    const template = templates.get(ref.template_id);
    if (!template) {
      errors.push(`${ref.artifact_type}:${ref.template_id}:${ref.mode} references missing output template ${ref.template_id}`);
      continue;
    }
    if (template.type !== ref.artifact_type) {
      errors.push(`${ref.artifact_type}:${ref.template_id}:${ref.mode} uses template type '${template.type}'`);
    }
    if (template.status !== "approved") {
      errors.push(`${ref.artifact_type}:${ref.template_id}:${ref.mode} uses ${template.status || "unknown"} template ${ref.template_id}`);
    } else if (outputTemplateNeedsApproval(context, template)) {
      errors.push(`${ref.artifact_type}:${ref.template_id}:${ref.mode} uses stale structure or delivery metadata for template ${ref.template_id}`);
    }
  }
  if (errors.length > 0) {
    fail(
      [
        "Contract output refs require approved output templates before contract creation.",
        ...errors.map((error) => `- ${error}`),
        "First agree the output format with the user, then run output template approve with --approval-source explicit-user.",
        "Use --allow-unapproved-output-ref only for explicit migration or recovery work.",
      ].join("\n"),
    );
  }
}

function approveContract(context, options) {
  ensureInitialized(context);
  const id = normalizeId(requireOption(options, "id"));
  const contractPath = path.join(context.sdlcRoot, "contracts", `${id}.json`);
  if (!fs.existsSync(contractPath)) {
    fail(`Contract ${id} does not exist`);
  }
  const attribution = buildAttribution(context, options, "contract.approve");
  const approvalStatus = normalizeApprovalStatus(options.status || "approved");
  let contract;
  let approval;
  const releaseLock = acquireFileLock(`${contractPath}.lock`);
  try {
    contract = readProjectJson(context, contractPath);
    if (contract.human_gate === true) {
      requireFormalApprovalActor(context, options, attribution, "Approving a human-gated contract");
    }
    const directApprovalRequirements = contractDirectApprovalRequirements(contract);
    approval = buildApprovalRecord(context, options, attribution, {
      subject: contract,
      subject_id_field: "contract_id",
      subject_id: id,
      artifact_types: contractArtifactTypes(contract),
      approval_boundaries: directApprovalRequirements,
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
  } finally {
    releaseLock();
  }
  appendTraceEvent(context, contract.story_id || null, {
    type: "gate",
    summary: approval.summary || `Contract ${id} ${approval.status}`,
    action: "contract.approve",
    actor: attribution.actor,
    evidence: [toProjectPath(context, contractPath)],
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
      const candidate = path.isAbsolute(value) ? path.resolve(value) : path.resolve(context.root, value);
      if (!isInsidePath(context.root, candidate)) {
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
    const recommendation = readProjectJson(context, recommendationPath);
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
      const profile = readProjectJson(context, profilePath);
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
    const recommendation = readProjectJson(context, recommendationPath);
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
    require_summary_or_evidence_for_automation: policy.require_summary_or_evidence_for_automation !== false,
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
  const authorization = source === "automation"
    ? requireAutomationAuthorization(context, options, attribution.action, settings)
    : null;
  const scope = buildApprovalRecordScope(source, { ...settings, authorization });
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
    scope,
    evidence,
    approval_source: source,
    authorization_ref: authorization?.id || null,
    authorization_action: authorization ? attribution.action : null,
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

function buildApprovalRecordScope(source, settings = {}) {
  const baseScope = defaultApprovalRecordScope(source, settings);
  const explicitScope = settings.scope;
  if (source === "automation" && settings.authorization) {
    return {
      ...baseScope,
      subject_scope: explicitScope ? String(explicitScope) : null,
    };
  }
  if (!explicitScope) {
    return baseScope;
  }
  if (source === "explicit-user" || source === "automation") {
    if (explicitScope && typeof explicitScope === "object" && !Array.isArray(explicitScope)) {
      return { ...baseScope, ...explicitScope };
    }
    return {
      ...baseScope,
      approval_level: String(explicitScope),
    };
  }
  return explicitScope || baseScope;
}

function defaultApprovalRecordScope(source, settings = {}) {
  const artifactTypes = authorizationArtifactTypes(settings);
  const approvalBoundaries = authorizationApprovalBoundaries(settings);
  if (source === "explicit-user") {
    return {
      principle: "A human approval applies only to the specific artifact or decision shown to the user before the approval.",
      subject_id: settings.subject_id || null,
      subject_label: settings.label || "approval",
      applies_only_to_presented_subject: true,
      does_not_approve_future_artifacts: true,
      requires_fresh_user_confirmation_for_new_artifacts: true,
    };
  }
  if (source === "automation") {
    return {
      principle:
        "An automation approval is valid only under an explicit delegated approval level or configured automation policy recorded in the summary or evidence.",
      subject_id: settings.subject_id || null,
      subject_label: settings.label || "approval",
      delegated_approval: true,
      applies_to_declared_approval_level: true,
      must_stay_within_declared_scope: true,
      requires_summary_or_evidence_of_delegation: true,
      does_not_expand_to_installs_deploys_secrets_external_access_or_destructive_actions: true,
      ask_user_if_scope_changes: true,
      authorization_ref: settings.authorization?.id || null,
      approval_level: settings.authorization?.scope || null,
      allowed_actions: settings.authorization?.allowed_actions || [],
      ...(artifactTypes.length > 0 ? { artifact_types: artifactTypes } : {}),
      ...(approvalBoundaries.length > 0 ? { approval_boundaries: approvalBoundaries } : {}),
    };
  }
  return settings.scope || undefined;
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
  if (normalized === "automation") {
    requireAutomationAuthorization(context, options, attribution.action, { label });
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
  if (approval.source === "automation" && !["agent", "system", "ci"].includes(approval.actor?.type)) {
    fail(`${approval.label} uses approval_source automation but actor type is '${approval.actor?.type || "unknown"}'.`);
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
  if (
    approval.source === "automation" &&
    policy.require_summary_or_evidence_for_automation &&
    !approval.summary &&
    approval.evidence.length === 0
  ) {
    fail(`${approval.label} requires --summary or --approval-evidence when --approval-source automation is used, including the delegated approval level and scope.`);
  }
}

function approvalAuthorizationSettings(approval = {}, settings = {}) {
  const scope = approval.scope && typeof approval.scope === "object"
    ? approval.scope
    : approval.approval_scope && typeof approval.approval_scope === "object"
      ? approval.approval_scope
      : {};
  const subjectId = settings.subject_id || scope.subject_id || [
    "baseline_id",
    "contract_id",
    "breakdown_id",
    "dependency_id",
    "profile_id",
    "recommendation_id",
    "template_id",
    "story_id",
  ].map((field) => approval[field]).find(Boolean) || null;
  return {
    scope,
    subject_id: subjectId,
    artifact_types: authorizationArtifactTypes({
      artifact_type: settings.artifact_type || approval.artifact_type,
      artifact_types: [
        ...(Array.isArray(settings.artifact_types) ? settings.artifact_types : []),
        ...(Array.isArray(scope.artifact_types) ? scope.artifact_types : []),
      ],
    }),
    approval_boundaries: authorizationApprovalBoundaries({
      approval_boundaries: [
        ...(Array.isArray(settings.approval_boundaries) ? settings.approval_boundaries : []),
        ...(Array.isArray(scope.approval_boundaries) ? scope.approval_boundaries : []),
      ],
    }),
  };
}

function validateFormalApprovalRecord(context, report, approval, label, actor, settings = {}) {
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
  if (source === "automation" && !["agent", "system", "ci"].includes(actor?.type)) {
    report.errors.push(`${label} approval_source automation requires an agent, system, or CI approver`);
  }
  if (source === "automation" && report.strict) {
    const authorizationSettings = approvalAuthorizationSettings(approval, settings);
    const scopedAuthorizationId = authorizationSettings.scope.authorization_ref || null;
    const authorizationId = approval.authorization_ref || scopedAuthorizationId || null;
    if (!authorizationId) {
      report.errors.push(`${label} automation approval has no persistent authorization_ref`);
    } else {
      const authorization = readAuthorization(context, authorizationId, { missingOk: true });
      const action = approval.authorization_action || null;
      if (approval.authorization_ref && scopedAuthorizationId && approval.authorization_ref !== scopedAuthorizationId) {
        report.errors.push(`${label} authorization_ref does not match its approved scope authorization ${scopedAuthorizationId}`);
      }
      if (!authorization) {
        report.errors.push(`${label} references missing authorization ${authorizationId}`);
      } else {
        if (!action) {
          report.errors.push(`${label} is missing an authorized action`);
        } else {
          for (const error of authorizationUseErrors(authorization, action, authorizationSettings)) {
            report.errors.push(`${label}: ${error}`);
          }
        }
        if (
          authorizationSettings.scope.approval_level &&
          authorizationSettings.scope.approval_level !== authorization.scope
        ) {
          report.errors.push(`${label} approval level does not match authorization ${authorizationId} scope`);
        }
      }
    }
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
  if (
    report.strict &&
    source === "automation" &&
    policy.require_summary_or_evidence_for_automation &&
    !approval.summary &&
    !approval.approval_summary &&
    (!Array.isArray(approval.evidence || approval.approval_evidence) || (approval.evidence || approval.approval_evidence).length === 0)
  ) {
    report.errors.push(`${label} automation approval requires summary or evidence describing the delegated approval level and scope`);
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

function stripApprovalVolatileFields(value, depth = 0) {
  if (Array.isArray(value)) {
    return value.map((item) => stripApprovalVolatileFields(item, depth + 1));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const stripped = {};
  const volatile = depth === 0
    ? new Set([
        "__path",
        "__relative_path",
        "approvals",
        "audit",
        "created_at",
        "updated_at",
        "approved_at",
        "approved_by",
        "status",
      ])
    : new Set();
  for (const key of Object.keys(value).sort()) {
    if (!volatile.has(key)) {
      stripped[key] = stripApprovalVolatileFields(value[key], depth + 1);
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
  const explicitActor = getOptionString(options, "actor");
  const commandAgent = getOptionString(options, "agent");
  const requestedActorType = getOptionString(options, "actor-type");
  const explicitActorType = requestedActorType ? normalizeActorType(requestedActorType) : null;
  const envAgent = process.env.CODEX_AGENT_NAME || null;
  const envCiActor = process.env.CI ? process.env.GITHUB_ACTOR || "ci" : null;
  const actorType = explicitActorType || inferActorType(options, explicitActor || commandAgent || envAgent || envCiActor || "codex");
  const id =
    explicitActor ||
    commandAgent ||
    (actorType === "human" ? defaultHumanActorId(root) : null) ||
    (actorType === "ci" ? envCiActor : null) ||
    envAgent ||
    envCiActor ||
    "codex";
  const useHumanIdentity = ["human", "ci"].includes(actorType);
  const name =
    getOptionString(options, "actor-name") ||
    (actorType === "agent" && id === "codex" ? "Codex" : null) ||
    (useHumanIdentity ? process.env.GIT_AUTHOR_NAME || gitConfigValue(root, "user.name") : null) ||
    null;
  const email =
    getOptionString(options, "actor-email") ||
    (useHumanIdentity ? process.env.GIT_AUTHOR_EMAIL || gitConfigValue(root, "user.email") : null) ||
    null;

  return {
    id,
    type: actorType,
    name,
    email,
    source: explicitActor || commandAgent ? "cli" : envAgent || envCiActor || useHumanIdentity ? "environment" : "default",
  };
}

function defaultHumanActorId(root) {
  return process.env.CODEX_USER_ID || process.env.USER || process.env.GIT_AUTHOR_NAME || gitConfigValue(root, "user.name") || "human";
}

function buildActorFromPrefixedOptions(options = {}, prefix, root = process.cwd(), defaults = {}) {
  const id = getOptionString(options, prefix);
  if (!id) {
    return null;
  }
  return {
    id,
    type: normalizeActorType(getOptionString(options, `${prefix}-type`) || defaults.type || "unknown"),
    name: getOptionString(options, `${prefix}-name`) || null,
    email: getOptionString(options, `${prefix}-email`) || null,
    source: getOptionString(options, `${prefix}-source`) || defaults.source || "cli",
  };
}

function buildTraceAuthorityMetadata(context, options = {}, attribution = null) {
  const activeAttribution = attribution || buildAttribution(context, options, "trace.attribution");
  const requestedBy = buildActorFromPrefixedOptions(options, "requested-by", context.root, {
    type: "human",
    source: "cli",
  });
  const authorizedBy = buildActorFromPrefixedOptions(options, "authorized-by", context.root, {
    type: "human",
    source: "cli",
  });
  const request = buildTraceRequestMetadata(options, activeAttribution);
  return {
    ...(requestedBy ? { requested_by: requestedBy } : {}),
    ...(authorizedBy ? { authorized_by: authorizedBy } : {}),
    ...(request ? { request } : {}),
  };
}

function buildTraceRequestMetadata(options = {}, attribution = null) {
  const request = {
    id: getOptionString(options, "request-id") || null,
    summary: getOptionString(options, "request-summary") || null,
    source: getOptionString(options, "request-source") || null,
    thread_id: getOptionString(options, "request-thread-id") || attribution?.run?.thread_id || null,
    run_id: getOptionString(options, "request-run-id") || attribution?.run?.run_id || null,
    session_id: getOptionString(options, "request-session-id") || attribution?.run?.session_id || null,
  };
  return Object.values(request).some((value) => value !== null && value !== "") ? request : null;
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
  return readProjectJson(context, projectPath);
}

function buildContextSources(context, contextFiles) {
  return contextFiles.map((rawPath) => {
    const resolved = resolveProjectFilePath(context, rawPath, { mustExist: true, fileOnly: true });
    const content = fs.readFileSync(resolved);
    const text = content.toString("utf8");
    return {
      path: toProjectPath(context, resolved),
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
    contract_id: options.contract ? normalizeId(String(options.contract)) : null,
    work_breakdown_id: options.breakdown ? normalizeId(String(options.breakdown)) : null,
    acceptance: acceptanceCriteria,
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
    acceptance: normalizeListOption(options.acceptance),
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
  const releaseLock = acquireFileLock(`${breakdownPath}.lock`);
  try {
    writeJsonFile(breakdownPath, breakdown, { force: Boolean(options.force) });
  } finally {
    releaseLock();
  }
  output(options, { status: "proposed", breakdown_path: breakdownPath, breakdown }, [`Proposed breakdown ${id}`]);
}

function approveBreakdown(context, options) {
  ensureInitialized(context);
  const id = normalizeId(requireOption(options, "id"));
  const breakdownPath = breakdownPathById(context, id);
  if (!fs.existsSync(breakdownPath)) {
    fail(`Breakdown ${id} does not exist`);
  }
  const attribution = buildAttribution(context, options, "breakdown.approve");
  requireFormalApprovalActor(context, options, attribution, "Approving a work breakdown");
  let breakdown;
  let approval;
  const releaseLock = acquireFileLock(`${breakdownPath}.lock`);
  try {
    breakdown = readProjectJson(context, breakdownPath);
    approval = buildApprovalRecord(context, options, attribution, {
      subject: breakdown,
      subject_id_field: "breakdown_id",
      subject_id: id,
      scope: options.scope || "work-breakdown",
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
  } finally {
    releaseLock();
  }
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
  const releaseLock = acquireFileLock(path.join(dependenciesRoot(context), "graph.lock"));
  try {
    writeJsonFile(proposalPath, proposal, { force: Boolean(options.force) });
  } finally {
    releaseLock();
  }
  output(options, { status: "proposed", dependency_path: proposalPath, dependency: proposal }, [`Proposed dependency graph ${id}`]);
}

function approveDependencyGraph(context, options) {
  ensureInitialized(context);
  const id = normalizeId(requireOption(options, "id"));
  const proposalPath = dependencyProposalPath(context, id);
  if (!fs.existsSync(proposalPath)) {
    fail(`Dependency proposal ${id} does not exist`);
  }
  const attribution = buildAttribution(context, options, "dependency.approve");
  requireFormalApprovalActor(context, options, attribution, "Approving dependency graph changes");
  let proposal;
  let graph;
  let approval;
  const releaseLock = acquireFileLock(path.join(dependenciesRoot(context), "graph.lock"));
  try {
    proposal = readProjectJson(context, proposalPath);
    approval = buildApprovalRecord(context, options, attribution, {
      subject: proposal,
      subject_id_field: "dependency_id",
      subject_id: id,
      scope: options.scope || "dependency-graph",
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

    graph = readDependencyGraph(context, { missingOk: true });
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
    // Write the canonical graph first. A retry is idempotent because edges are upserted.
    writeJsonFile(dependencyGraphPath(context), graph, { force: true });
    writeJsonFile(proposalPath, proposal, { force: true });
  } finally {
    releaseLock();
  }
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
  const releaseLock = acquireFileLock(`${profilePath}.lock`);
  try {
    writeJsonFile(profilePath, profile, { force: Boolean(options.force) });
  } finally {
    releaseLock();
  }
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
  const approvalRequest = buildCapabilityProfileApprovalRequest(context, profile);
  const assistantMessage = renderApprovalRequestsAssistantMessage([approvalRequest]);
  output(
    options,
    {
      status: "proposed",
      profile_path: profilePath,
      profile,
      assistant_message: assistantMessage,
      ...assistantMessagePresentationFields(),
      approval_request: approvalRequest,
    },
    [`Proposed capability profile ${id}`, "", ...assistantMessage.split("\n")],
  );
}

function approveCapabilityProfile(context, options) {
  ensureInitialized(context);
  const id = normalizeId(requireOption(options, "id"));
  const profilePath = capabilityProfilePath(context, id);
  if (!fs.existsSync(profilePath)) {
    fail(`Capability profile ${id} does not exist`);
  }
  const attribution = buildAttribution(context, options, "capability.profile.approve");
  requireFormalApprovalActor(context, options, attribution, "Approving a capability profile");
  let profile;
  let approval;
  const releaseLock = acquireFileLock(`${profilePath}.lock`);
  try {
    profile = readProjectJson(context, profilePath);
    validateCapabilityRecordSourceHashes(context, profile, `capability profile ${id}`, { failOnStale: true });
    approval = buildApprovalRecord(context, options, attribution, {
      subject: profile,
      subject_id_field: "profile_id",
      subject_id: id,
      scope: options.scope || "capability-profile",
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
  } finally {
    releaseLock();
  }
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
  const profile = readProjectJson(context, profilePath);
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
  const profileProjectPath = toProjectPath(context, profilePath);
  const sourcePaths = normalizeCapabilitySourcePaths(context, normalizeListValue(input.source_paths, []));
  const recommendation = {
    id,
    schema_version: context.config.schema_version,
    status: "proposed",
    profile_id: profileId,
    profile_ref: {
      path: profileProjectPath,
      approved_content_hash: latestApprovedRecordApproval(profile)?.approved_content_hash || null,
      current_content_hash: hashApprovalSubject(profile),
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
  const releaseLock = acquireFileLock(`${recommendationPath}.lock`);
  try {
    writeJsonFile(recommendationPath, recommendation, { force: Boolean(options.force) });
  } finally {
    releaseLock();
  }
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
  const approvalRequest = buildCapabilityRecommendationApprovalRequest(context, recommendation);
  const assistantMessage = renderApprovalRequestsAssistantMessage([approvalRequest]);
  output(
    options,
    {
      status: "proposed",
      recommendation_path: recommendationPath,
      recommendation,
      assistant_message: assistantMessage,
      ...assistantMessagePresentationFields(),
      approval_request: approvalRequest,
    },
    [`Proposed capability recommendation ${id}`, "", ...assistantMessage.split("\n")],
  );
}

function approveCapabilityRecommendation(context, options) {
  ensureInitialized(context);
  const id = normalizeId(requireOption(options, "id"));
  const recommendationPath = capabilityRecommendationPath(context, id);
  if (!fs.existsSync(recommendationPath)) {
    fail(`Capability recommendation ${id} does not exist`);
  }
  const attribution = buildAttribution(context, options, "capability.approve");
  requireFormalApprovalActor(context, options, attribution, "Approving a capability recommendation");
  const requestedApprovalSource = String(getOptionString(options, "approval-source") || "").trim().toLowerCase();
  const directInstallApproval =
    (requestedApprovalSource === "explicit-user" && attribution.actor.type === "human") ||
    ((requestedApprovalSource === "ci" || (!requestedApprovalSource && attribution.actor.type === "ci")) && attribution.actor.type === "ci");
  if (options["approve-install"] && !directInstallApproval) {
    fail("Approving capability installation requires direct explicit-user or CI approval; delegated automation cannot expand into installs.");
  }
  let recommendation;
  let profile;
  let approval;
  const releaseLock = acquireFileLock(`${recommendationPath}.lock`);
  try {
    recommendation = readProjectJson(context, recommendationPath);
    profile = readCapabilityProfile(context, recommendation.profile_id);
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
      current_content_hash: hashApprovalSubject(profile),
    };
    approval = buildApprovalRecord(context, options, attribution, {
      subject: recommendation,
      subject_id_field: "recommendation_id",
      subject_id: id,
      scope: options.scope || "capability-recommendation",
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
  } finally {
    releaseLock();
  }
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
    .map((name) => readProjectJson(context, path.join(baselineRoot(context), name)))
    .sort((a, b) => {
      const createdComparison = String(a.created_at || "").localeCompare(String(b.created_at || ""));
      return createdComparison || String(a.id).localeCompare(String(b.id));
    });
}

function buildBaselineDocumentEvidence(context, rawPath) {
  const resolved = resolveProjectFilePath(context, rawPath, { mustExist: true, fileOnly: true });
  assertNotDerivedArtifact(context, resolved, "Baseline document");
  const content = fs.readFileSync(resolved);
  const text = content.toString("utf8");
  return {
    type: "document",
    path: toProjectPath(context, resolved),
    sha256: hashBuffer(content),
    size_bytes: content.length,
    title: inferTitle(resolved, text),
    headings: text
      .split(/\r?\n/)
      .map((line) => line.match(/^#{1,4}\s+(.+)$/)?.[1]?.trim())
      .filter(Boolean)
      .slice(0, 12),
    excerpt: normalizeText(text).slice(0, 800),
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
    package_summary: readPackageSummary(context),
    source_roots: inferSourceRoots(context),
    test_roots: inferTestRoots(context),
    ci_files: keyFiles.filter((item) => item.path.startsWith(".github/") || item.path.includes("ci") || item.path.includes("workflow")),
  };
}

function readPackageSummary(context) {
  const packageJsonPath = path.join(context.root, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    return null;
  }
  try {
    const pkg = readProjectJson(context, packageJsonPath);
    return {
      name: pkg.name || null,
      description: pkg.description || null,
      version: pkg.version || null,
      private: Boolean(pkg.private),
      runtime_dependencies: Object.keys(pkg.dependencies || {}).sort(),
      development_dependencies: Object.keys(pkg.devDependencies || {}).sort(),
    };
  } catch {
    return null;
  }
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
    const pkg = readProjectJson(context, packageJsonPath);
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
  const primaryDocument = documents.find((document) => /(^|\/)readme\./i.test(document.path)) || documents[0] || null;
  return {
    product_signal: repoSnapshot.package_summary?.description || primaryDocument?.excerpt || null,
    document_map: documents.map((document) => ({
      path: document.path,
      title: document.title || null,
      headings: document.headings || [],
      summary: document.excerpt || null,
    })),
    architecture_signals: documents
      .filter((document) => /architecture|design|adr|api|requirement/i.test(`${document.path} ${(document.headings || []).join(" ")}`))
      .map((document) => ({ path: document.path, headings: document.headings || [], summary: document.excerpt || null })),
    component_roots: repoSnapshot.source_roots || [],
    runtime_and_validation_scripts: repoSnapshot.package_scripts || {},
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
    "## Product Signal",
    baseline.inferred_context?.product_signal || "Not evidenced.",
    "",
    "## Architecture And Component Signals",
    ...listOrNone([
      ...(baseline.inferred_context?.component_roots || []).map((root) => `Source root: ${root}`),
      ...(baseline.inferred_context?.architecture_signals || []).map((item) => `${item.path}: ${(item.headings || []).join(" > ") || item.summary || "architecture evidence"}`),
    ]),
    "",
    "## Detected Stack",
    ...listOrNone((baseline.repository_snapshot?.detected_stack || []).map((item) => `${item.type}: ${item.name}${item.source_path ? ` (${item.source_path})` : ""}`)),
    "",
    "## Key Files",
    ...listOrNone((baseline.repository_snapshot?.key_files || []).map((item) => `${item.path} (${item.sha256})`)),
    "",
    "## Imported Documents",
    ...listOrNone((baseline.imported_documents || []).map((item) => `${item.path}: ${item.title || "Untitled"}; sections ${(item.headings || []).join(" > ") || "not detected"}; evidence ${item.sha256}`)),
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
  const sourceHashes = baseline.source_hashes || {};
  const sourcePaths = new Set([...(baseline.source_paths || []), ...Object.keys(sourceHashes)]);
  for (const sourcePath of sourcePaths) {
    const expectedHash = sourceHashes[sourcePath];
    const resolved = resolveProjectFilePath(context, sourcePath, { mustExist: false });
    if (isDerivedArtifactPath(context, resolved)) {
      issues.push(`${label} uses derived source ${sourcePath}`);
    } else if (!fs.existsSync(resolved)) {
      issues.push(`${label} source ${sourcePath} is missing`);
    } else if (!expectedHash) {
      issues.push(`${label} source ${sourcePath} has no recorded hash`);
    } else if (!fs.statSync(resolved).isFile()) {
      issues.push(`${label} source ${sourcePath} is not a file`);
    } else if (hashFile(resolved) !== expectedHash) {
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
  return readProjectJson(context, profilePath);
}

function readCapabilityProfiles(context) {
  return safeReadDir(capabilityProfilesRoot(context))
    .filter((name) => name.endsWith(".json"))
    .map((name) => readProjectJson(context, path.join(capabilityProfilesRoot(context), name)))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

function readCapabilityRecommendations(context) {
  return safeReadDir(capabilityRecommendationsRoot(context))
    .filter((name) => name.endsWith(".json"))
    .map((name) => readProjectJson(context, path.join(capabilityRecommendationsRoot(context), name)))
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
      return JSON.parse(readProjectText(context, filePath));
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
    const resolved = resolveProjectFilePath(context, rawPath, { mustExist: true, fileOnly: true });
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
      const pkg = readProjectJson(context, packageJsonPath);
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
    if (validateCapabilityRecordSourceHashes(context, profile, `capability profile ${profile.id}`, { collectOnly: true }).length > 0) {
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
  const sourceHashes = record.source_hashes || {};
  const sourcePaths = new Set([...(record.source_paths || []), ...Object.keys(sourceHashes)]);
  for (const sourcePath of sourcePaths) {
    const expectedHash = sourceHashes[sourcePath];
    const resolved = resolveProjectFilePath(context, sourcePath, { mustExist: false });
    if (isDerivedArtifactPath(context, resolved)) {
      issues.push(`${label} uses derived source ${sourcePath}`);
    } else if (!fs.existsSync(resolved)) {
      issues.push(`${label} source ${sourcePath} is missing`);
    } else if (!expectedHash) {
      issues.push(`${label} source ${sourcePath} has no recorded hash`);
    } else if (!fs.statSync(resolved).isFile()) {
      issues.push(`${label} source ${sourcePath} is not a file`);
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
  const projectPolicy = fs.existsSync(policyPath) ? readProjectJson(context, policyPath).policy || {} : {};
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
    .map((name) => readProjectJson(context, path.join(root, name)));
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

function requireFormalApprovalActor(context, options, attribution, action) {
  const source = getOptionString(options, "approval-source");
  if (String(source || "").trim().toLowerCase() === "automation") {
    if (!isAutomationApprovalActor(attribution.actor)) {
      fail(`${action} with --approval-source automation requires --actor-type agent, system, or ci.`);
    }
    return;
  }
  if (!["human", "ci"].includes(attribution.actor.type)) {
    fail(`${action} requires --actor-type human or an approved CI actor.`);
  }
}

function isAutomationApprovalActor(actor) {
  return ["agent", "system", "ci"].includes(actor?.type);
}

function hasFormalApprovalAttribution(actor, source = null) {
  if (source === "automation") {
    return isAutomationApprovalActor(actor);
  }
  return ["human", "ci"].includes(actor?.type);
}

function formalApprovalActorDescription(source = null) {
  return source === "automation" ? "agent/system/CI delegated automation" : "human/CI";
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
  const graph = readProjectJson(context, graphPath);
  graph.edges = Array.isArray(graph.edges) ? graph.edges : [];
  return graph;
}

function readDependencyProposals(context) {
  return safeReadDir(dependenciesRoot(context))
    .filter((name) => name.endsWith(".json") && name !== "graph.json")
    .map((name) => readProjectJson(context, path.join(dependenciesRoot(context), name)))
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
    // Status and orchestration expose blockers for upcoming phases. Phase-aware
    // enforcement is applied by the story gate, which passes the current story.
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
      blocking,
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
  const attribution = buildAttribution(context, options, "story.claim");
  try {
    const claimExists = fs.existsSync(claimPath);
    if (claimExists && !options.force) {
      const existing = readProjectJson(context, claimPath);
      if (existing.status === "active") {
        fail(`Story ${id} already has an active claim by ${existing.agent}. Release it first or use --force after coordination.`);
      }
    }
    if (claimExists && options.force) {
      const existing = readProjectJson(context, claimPath);
      if (existing.status === "active") {
        requireCoordinationOverrideActor(attribution, `Force-claiming active story ${id}`);
      }
    }
    claim = {
      story_id: id,
      agent: String(agent),
      branch: String(options.branch || defaultStoryBranch(context, id)),
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
    evidence: [toProjectPath(context, claimPath)],
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
  const attribution = buildAttribution(context, options, "story.release");
  const requestedAgent = options.agent ? String(options.agent) : null;
  let claim;
  const releaseLock = acquireFileLock(path.join(storyDir, "claim.lock"));
  try {
    if (!fs.existsSync(claimPath)) {
      fail(`Story ${id} has no claim to release`);
    }
    claim = readProjectJson(context, claimPath);
    if (requestedAgent && claim.agent !== requestedAgent && !options.force) {
      fail(`Story ${id} is claimed by ${claim.agent}, not ${requestedAgent}. Use --force only after coordination.`);
    }
    if (requestedAgent && claim.agent !== requestedAgent && options.force) {
      requireCoordinationOverrideActor(attribution, `Force-releasing story ${id} claimed by another agent`);
    }
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
  } finally {
    releaseLock();
  }
  appendTraceEvent(context, id, {
    type: "sync",
    summary: `Story ${id} claim ${claim.status}`,
    action: "story.release",
    actor: attribution.actor,
    evidence: [toProjectPath(context, claimPath)],
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
  const handoffId = normalizeId(String(options["handoff-id"] || `HND-${storyId}-${uniqueRecordSuffix()}`));
  const handoffPath = path.join(context.sdlcRoot, "handoffs", `${handoffId}.json`);
  const handoff = {
    id: handoffId,
    story_id: storyId,
    from_actor: attribution.actor,
    to_agent: String(toAgent),
    status: normalizeHandoffStatus(options.status || "open"),
    summary: options.summary ? String(options.summary) : null,
    required_artifacts: normalizeListOption(options.artifact).map(normalizeProjectPathInput),
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
    evidence: [toProjectPath(context, handoffPath)],
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
  validateApprovedStoryContractForPhaseOutput(
    context,
    story,
    "story.complete-step",
    outputTypes.map((artifactType) => ({ artifact_type: artifactType })),
    options,
  );
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
  if (["validation", "release"].includes(step)) {
    if (artifactEvidence.length === 0 && extraEvidence.length === 0 && outputLinks.length === 0) {
      fail(`${step} completion requires --artifact, --evidence, or a linked output; a summary alone is not release evidence.`);
    }
    const requiredTraceType = step === "validation" ? "test" : "release";
    const acceptableOutcomes = step === "validation" ? ["passed"] : ["ready", "passed"];
    const supportingTrace = readTraceEvents(context, storyId).find(
      (event) => event.type === requiredTraceType && acceptableOutcomes.includes(event.outcome),
    );
    if (!supportingTrace) {
      fail(`${step} completion requires a ${requiredTraceType} trace with outcome ${acceptableOutcomes.join(" or ")}.`);
    }
  }

  const attribution = buildAttribution(context, options, "story.complete-step");
  const stepDir = path.join(context.sdlcRoot, "stories", storyId, "steps");
  const stepPath = path.join(stepDir, `${step}.json`);
  const relativeStepPath = toProjectPath(context, stepPath);
  const record = {
    id: normalizeId(String(options["completion-id"] || `STEP-${storyId}-${step}-${uniqueRecordSuffix()}`)),
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
  const handoffId = normalizeId(String(options["handoff-id"] || `HND-${storyId}-${uniqueRecordSuffix()}`));
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
  const handoff = readProjectJson(context, handoffPath);
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
    evidence: [toProjectPath(context, handoffPath)],
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
  const attribution = buildAttribution(context, options, "phase.lock");
  try {
    const conflictingLock = readActiveLocks(context).find(
      (candidate) => candidate.phase === phase && String(candidate.scope || candidate.phase) === scope,
    );
    if (conflictingLock && !options.force) {
      fail(
        `Phase ${phase} scope ${scope} already has active lock ${conflictingLock.id}. Release it first or use --force after coordination.`,
      );
    }
    if (conflictingLock && options.force) {
      requireCoordinationOverrideActor(attribution, `Overriding phase lock ${conflictingLock.id}`);
      const conflictingPath = path.join(context.sdlcRoot, "locks", `${normalizeId(conflictingLock.id)}.json`);
      conflictingLock.status = "cancelled";
      conflictingLock.released_at = now();
      conflictingLock.release_reason = `Replaced by coordinated override from ${attribution.actor.id}`;
      conflictingLock.audit = {
        ...(conflictingLock.audit || {}),
        released_by: attribution.actor,
        git: attribution.git,
        run: attribution.run,
      };
      writeJsonFile(conflictingPath, conflictingLock, { force: true });
    }
    lockId = normalizeId(String(options.id || `LOCK-${phase}-${uniqueRecordSuffix()}`));
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
    evidence: [toProjectPath(context, lockPath)],
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
  const lock = readProjectJson(context, lockPath);
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
    evidence: [toProjectPath(context, lockPath)],
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
  if (storyId && !readStory(context, storyId)) {
    fail(`Story ${storyId} does not exist`);
  }
  const traceFile = storyId ? `${storyId}.jsonl` : "project.jsonl";
  const tracePath = path.join(context.sdlcRoot, "traces", traceFile);
  const attribution = buildAttribution(context, options, `trace.${type}`);
  const gitEvent = options["git-event"] ? normalizeGitEvent(options["git-event"]) : null;
  const event = {
    id: `TR-${compactTimestamp()}-${crypto.randomBytes(3).toString("hex")}`,
    story_id: storyId,
    type,
    summary,
    outcome: options.outcome ? normalizeTraceOutcome(options.outcome) : null,
    actor: attribution.actor,
    ...buildTraceAuthorityMetadata(context, options, attribution),
    action: normalizeScalarOption(options.action, "action") || type,
    evidence: normalizeListOption(options.evidence).map(normalizeProjectPathInput),
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
  if (storyId && !readStory(context, storyId)) {
    fail(`Story ${storyId} does not exist`);
  }
  const attribution = buildAttribution(context, options, `sync.${event}`);
  const summary = options.summary ? String(options.summary) : `Recorded git ${event}`;
  const traceEvent = appendTraceEvent(context, storyId, {
    type: "sync",
    summary,
    action: `sync.${event}`,
    actor: attribution.actor,
    ...buildTraceAuthorityMetadata(context, options, attribution),
    evidence: normalizeListOption(options.evidence).map(normalizeProjectPathInput),
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
    return readProjectJson(context, graphPath);
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
    return readProjectJson(context, registryPath);
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
  const delivery = buildOutputDelivery(options);
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
    preset: content.preset || null,
    delivery,
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
  const approvalRequest = buildOutputTemplateApprovalRequest(context, templateRecord);
  const assistantMessage = renderApprovalRequestsAssistantMessage([approvalRequest]);

  output(
    options,
    {
      status: "proposed",
      template_path: templatePath,
      template: templateRecord,
      assistant_message: assistantMessage,
      ...assistantMessagePresentationFields(),
      approval_request: approvalRequest,
    },
    [`Proposed output template ${id} for ${artifactType}`, "", ...assistantMessage.split("\n")],
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
  requireFormalApprovalActor(context, options, attribution, "Approving an output template");

  const decisionId = normalizeId(String(options["decision-id"] || `DEC-output-template-${id}-${uniqueRecordSuffix()}`));
  const templatePath = resolveProjectFilePath(context, template.path, { mustExist: true, fileOnly: true });
  assertNotDerivedArtifact(context, templatePath, "Output template");
  const approvedContentHash = hashFile(templatePath);
  const delivery = effectiveOutputDelivery(template);
  const approvedDeliveryHash = hashApprovalSubject(delivery);
  const approvalEvidence = buildApprovalEvidence(context, options);
  const approvalSummaryOption = getOptionString(options, "summary") || null;
  const approvalSummary = approvalSummaryOption || template.approval_summary || null;
  const approvalSource = normalizeApprovalSource(context, options, attribution, `output template ${id}`, "approved");
  const authorization = approvalSource === "automation"
    ? requireAutomationAuthorization(context, options, attribution.action, { label: `output template ${id}`, subject_id: id, artifact_type: template.type })
    : null;
  const approvalScope = buildApprovalRecordScope(approvalSource, {
    subject_id: id,
    artifact_type: template.type,
    label: `output template ${id}`,
    scope: String(options.scope || "output_template"),
    authorization,
  });
  validateApprovalSourceForActor(context, {
    source: approvalSource,
    status: "approved",
    summary: approvalSummaryOption,
    evidence: approvalEvidence,
    actor: attribution.actor,
    label: `output template ${id}`,
  });
  template.status = "approved";
  template.approved_at = now();
  template.approved_by = attribution.actor;
  template.approval_summary = approvalSummary;
  template.approved_content_hash = approvedContentHash;
  template.approved_delivery_hash = approvedDeliveryHash;
  template.hash_algorithm = "sha256:file:v1";
  template.approval_evidence = approvalEvidence;
  template.approval_source = approvalSource;
  template.authorization_ref = authorization?.id || null;
  template.authorization_action = authorization ? attribution.action : null;
  template.approval_scope = approvalScope;
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
    authorization_ref: authorization?.id || null,
    authorization_action: authorization ? attribution.action : null,
    approval_scope: approvalScope,
    explicit_user_confirmation: approvalSource === "explicit-user",
    provisional: approvalSource === "bootstrap",
    approved_content_hash: approvedContentHash,
    approved_delivery_hash: approvedDeliveryHash,
    delivery,
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
      resolution.delivery ? `Canonical delivery: ${formatOutputDeliveryForHuman(resolution.delivery)}` : null,
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
  validateApprovedStoryContractForPhaseOutput(
    context,
    story,
    "output.link",
    [{ artifact_type: artifactType, template_id: templateId, mode }],
    options,
  );
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

  const delivery = effectiveOutputDelivery(template);

  const artifactPath = resolveProjectFilePath(context, requireOption(options, "artifact"), {
    mustExist: true,
    fileOnly: true,
  });
  assertNotDerivedArtifact(context, artifactPath, "Output artifact");
  validateArtifactDeliveryPath(artifactPath, delivery, `Output template ${templateId}`);
  const verificationReceipt = verifyOutputArtifact(context, artifactPath, delivery, {
    evidence: normalizeListOption(options.evidence),
    requireVisualEvidence: true,
  });

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
    const decisionSummary = getOptionString(options, "rationale");
    if (!decisionSummary && decisionEvidence.length === 0) {
      fail("Creating an output override decision requires --rationale or --approval-evidence describing the approved exception.");
    }
    const approvalSource = normalizeApprovalSource(context, options, attribution, `output override ${decisionId}`, "approved");
    const authorization = approvalSource === "automation"
      ? requireAutomationAuthorization(context, options, attribution.action, { label: `output override ${decisionId}`, subject_id: normalizeId(decisionId), artifact_type: artifactType })
      : null;
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
      authorization_ref: authorization?.id || null,
      authorization_action: authorization ? attribution.action : null,
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
    delivery_format: delivery.format,
    delivery_extension: delivery.extension,
    media_type: delivery.media_type,
    generator: delivery.generator,
    delivery_mode: delivery.mode,
    verification_receipt: verificationReceipt,
    source_paths: [
      relativeArtifactPath,
      relativeBaseArtifact,
      template.path,
      ...verificationReceipt.evidence.map((item) => item.path),
    ].filter(Boolean),
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
  const cacheRoot = resolveProjectFilePath(context, path.join(SDLC_DIR, "cache"), { mustExist: false });
  assertNoSymlinkPathSegments(cacheRoot);
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
    return { source: toProjectPath(context, queryPath), query: readProjectJson(context, queryPath) };
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
        executor: ["agent-or-human-who-ran-the-action"],
        requester: ["human-or-system-who-requested-the-action"],
        authorizer: ["human-or-ci-who-authorized-the-action"],
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
        natural_language: "all changes made by me",
        query: {
          intent: "find_changes",
          confidence: 0.9,
          subjects: ["activity", "stories", "outputs", "contracts", "approvals"],
          filters: { requester: ["<current-user-id-or-email>"] },
          sort: "created_at_desc",
        },
      },
      {
        natural_language: "all new functional stories from the last 10 days",
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
      by_requester: countBy(
        filtered.filter((record) => record.requested_by),
        (record) => traceActorKey(record.requested_by),
      ),
      by_authorizer: countBy(
        filtered.filter((record) => record.authorized_by),
        (record) => traceActorKey(record.authorized_by),
      ),
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
    executor: normalizeStringArray(filters.executor || filters.executed_by),
    requester: normalizeStringArray(filters.requester || filters.requested_by || filters.requestedBy),
    authorizer: normalizeStringArray(filters.authorizer || filters.authorized_by || filters.authorizedBy),
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
      requested_by: event.requested_by || null,
      authorized_by: event.authorized_by || null,
      request: event.request || null,
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
      requested_by: null,
      authorized_by: null,
      request: null,
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
        requested_by: null,
        authorized_by: null,
        request: null,
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
    requested_by: null,
    authorized_by: null,
    request: null,
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
    requested_by: null,
    authorized_by: null,
    request: null,
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
    requested_by: null,
    authorized_by: null,
    request: null,
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
    requested_by: null,
    authorized_by: null,
    request: null,
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
      requested_by: null,
      authorized_by: null,
      request: null,
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
    requested_by: null,
    authorized_by: null,
    request: null,
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
    requested_by: null,
    authorized_by: null,
    request: null,
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
    actorFilterMatches(filters.executor, record.actor) &&
    actorFilterMatches(filters.requester, record.requested_by) &&
    actorFilterMatches(filters.authorizer, record.authorized_by) &&
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
    requested_by: record.requested_by || null,
    authorized_by: record.authorized_by || null,
    request: record.request || null,
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
      const claim = fs.existsSync(claimPath) ? readProjectJson(context, claimPath) : null;
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
      const data = readProjectJson(context, filePath);
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
      data = readProjectJson(context, filePath);
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
  const id = normalizeId(`CMP-${storyId || "project"}-${uniqueRecordSuffix()}`);
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
  const planId = normalizeId(`ARCH-${uniqueRecordSuffix()}`);
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
  const planPath = options.out
    ? resolveProjectFilePath(context, options.out, { mustExist: false })
    : path.join(context.sdlcRoot, "archive", `${planId}.json`);
  assertNotDerivedArtifact(context, planPath, "Archive plan");
  if (fs.existsSync(planPath) && !options.force) {
    fail(`Archive plan already exists: ${toProjectPath(context, planPath)}. Use --force to overwrite it.`);
  }
  const reservedPaths = new Set(
    candidates.flatMap((candidate) => [candidate.source_path, candidate.target_path]).map((entry) =>
      resolveProjectFilePath(context, entry, { mustExist: false }),
    ),
  );
  if (reservedPaths.has(planPath)) {
    fail("Archive plan path must be separate from every archive source and target.");
  }
  if (options.apply) {
    plan.applied = true;
    applyArchiveCandidates(context, candidates, { force: Boolean(options.force) }, () => {
      writeJsonFile(planPath, plan, { force: Boolean(options.force) });
    });
  } else {
    writeJsonFile(planPath, plan, { force: Boolean(options.force) });
  }
  output(
    options,
    { status: plan.applied ? "archived" : "planned", plan_path: planPath, plan },
    [
      `${plan.applied ? "Archived" : "Planned archive for"} ${candidates.length} closed artifacts`,
      `Archive plan: ${toProjectPath(context, planPath)}`,
    ],
  );
}

function applyArchiveCandidates(context, candidates, options = {}, commit = () => {}) {
  const releaseLock = acquireFileLock(path.join(context.sdlcRoot, "archive", "archive.lock"));
  const operations = [];
  const completed = [];
  const backups = [];
  try {
    for (const candidate of candidates) {
      const sourcePath = resolveProjectFilePath(context, candidate.source_path, { mustExist: true, fileOnly: true });
      const targetPath = resolveProjectFilePath(context, candidate.target_path, { mustExist: false });
      assertNoSymlinkPathSegments(sourcePath);
      assertNoSymlinkPathSegments(targetPath);
      if (hashFile(sourcePath) !== candidate.sha256) {
        fail(`Archive source changed after planning: ${candidate.source_path}`);
      }
      if (fs.existsSync(targetPath)) {
        if (!options.force) {
          fail(`Archive target already exists: ${candidate.target_path}. Use --force to overwrite after review.`);
        }
        if (!fs.lstatSync(targetPath).isFile()) {
          fail(`Archive target is not a regular file: ${candidate.target_path}`);
        }
      }
      operations.push({ candidate, sourcePath, targetPath });
    }

    for (const operation of operations) {
      ensureDir(path.dirname(operation.targetPath));
      if (fs.existsSync(operation.targetPath)) {
        const backupPath = `${operation.targetPath}.backup-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
        fs.renameSync(operation.targetPath, backupPath);
        backups.push({ targetPath: operation.targetPath, backupPath });
      }
      fs.renameSync(operation.sourcePath, operation.targetPath);
      completed.push(operation);
    }
    for (const operation of completed) {
      operation.candidate.applied = true;
    }
    commit();
    for (const backup of backups) {
      try {
        fs.rmSync(backup.backupPath, { force: true });
      } catch {
        // The archive is committed; an orphaned backup is safer than rolling it back incompletely.
      }
    }
  } catch (error) {
    for (const operation of completed) {
      operation.candidate.applied = false;
    }
    for (const operation of [...completed].reverse()) {
      try {
        if (fs.existsSync(operation.targetPath) && !fs.existsSync(operation.sourcePath)) {
          ensureDir(path.dirname(operation.sourcePath));
          fs.renameSync(operation.targetPath, operation.sourcePath);
        }
      } catch {
        // Continue restoring the remaining files; the final error reports the failed transaction.
      }
    }
    for (const backup of [...backups].reverse()) {
      try {
        if (fs.existsSync(backup.backupPath)) {
          fs.renameSync(backup.backupPath, backup.targetPath);
        }
      } catch {
        // Best effort rollback for a filesystem-level failure.
      }
    }
    if (error instanceof UserError) {
      throw error;
    }
    fail(`Archive transaction failed and was rolled back: ${error.message}`);
  } finally {
    releaseLock();
  }
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
  const body = getOptionString(options, "body");
  const preset = getOptionString(options, "preset");
  const contentSources = [from, body, preset].filter(Boolean);
  if (contentSources.length > 1) {
    fail("Use only one of --from, --body, or --preset when proposing an output template.");
  }
  if (from) {
    const sourcePath = resolveProjectFilePath(context, from, { mustExist: true, fileOnly: true });
    assertNotDerivedArtifact(context, sourcePath, "Template source");
    return {
      text: fs.readFileSync(sourcePath, "utf8"),
      source_paths: [toProjectPath(context, sourcePath)],
      preset: null,
    };
  }

  if (body) {
    return {
      text: `${body.trim()}\n`,
      source_paths: [],
      preset: null,
    };
  }

  if (preset) {
    const normalizedPreset = String(preset).trim().toLowerCase();
    if (normalizedPreset !== "technical-assessment") {
      fail(`Unknown output template preset '${preset}'. Valid presets: technical-assessment`);
    }
    const presetPath = path.join(context.templateDir, "technical-assessment.md");
    if (!fs.existsSync(presetPath) || !fs.statSync(presetPath).isFile()) {
      fail(`Bundled output template preset is missing: ${presetPath}`);
    }
    return {
      text: fs.readFileSync(presetPath, "utf8"),
      source_paths: [],
      preset: normalizedPreset,
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
    preset: null,
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
  const delivery = preferredTemplate ? effectiveOutputDelivery(preferredTemplate) : null;
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
      `Create the ${delivery.label} artifact (${delivery.extension}) with template ${preferredTemplate.id}${delivery.generator ? ` using ${delivery.generator}` : ""}, then link it with mode new.`,
    ].join(" ");
  }

  return {
    story_id: storyId,
    artifact_type: artifactType,
    requirements,
    recommendation,
    template_id: preferredTemplate?.id || existingLinks[0]?.template_id || null,
    delivery,
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
  const registry = readProjectJson(context, registryPath);
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

function buildOutputDelivery(options = {}, fallback = null) {
  const requestedFormat = getOptionString(options, "format");
  const formatAlias = String(requestedFormat || fallback?.format || "markdown").trim().toLowerCase();
  const format = OUTPUT_FORMAT_ALIASES[formatAlias];
  if (!format || !OUTPUT_FORMATS[format]) {
    fail(`Invalid output format '${requestedFormat || formatAlias}'. Valid formats: ${Object.keys(OUTPUT_FORMATS).join(", ")}`);
  }

  const descriptor = OUTPUT_FORMATS[format];
  const requestedMode = getOptionString(options, "delivery") || fallback?.mode || "artifact-plus-chat-summary";
  const mode = String(requestedMode).trim().toLowerCase();
  if (!OUTPUT_DELIVERY_MODES.has(mode)) {
    fail(`Invalid delivery mode '${requestedMode}'. Valid modes: ${Array.from(OUTPUT_DELIVERY_MODES).join(", ")}`);
  }

  const requestedExtension = normalizeOutputExtension(getOptionString(options, "extension") || fallback?.extension || descriptor.extension);
  const requestedMediaType = getOptionString(options, "media-type") || fallback?.media_type || descriptor.media_type;
  const requestedGenerator = getOptionString(options, "generator") || fallback?.generator || descriptor.generator;

  if (format !== "custom") {
    if (getOptionString(options, "extension") && requestedExtension !== descriptor.extension) {
      fail(`Output format ${format} requires extension ${descriptor.extension}; received ${requestedExtension}.`);
    }
    if (getOptionString(options, "media-type") && requestedMediaType !== descriptor.media_type) {
      fail(`Output format ${format} requires media type ${descriptor.media_type}; received ${requestedMediaType}.`);
    }
    if (getOptionString(options, "generator") && requestedGenerator !== descriptor.generator) {
      fail(`Output format ${format} uses generator ${descriptor.generator || "none"}; received ${requestedGenerator}.`);
    }
  } else if (!requestedExtension) {
    fail("Custom output format requires --extension (for example --extension .drawio). ");
  }

  return {
    format,
    label: descriptor.label,
    extension: format === "custom" ? requestedExtension : descriptor.extension,
    media_type: format === "custom" ? requestedMediaType : descriptor.media_type,
    generator: format === "custom" ? requestedGenerator : descriptor.generator,
    mode,
  };
}

function normalizeOutputExtension(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const extension = String(value).trim().toLowerCase();
  if (!/^\.[a-z0-9][a-z0-9._-]*$/.test(extension)) {
    fail(`Invalid output extension '${value}'. Use a value such as .md, .xlsx, or .drawio.`);
  }
  return extension;
}

function effectiveOutputDelivery(template = {}) {
  return buildOutputDelivery({}, template.delivery || null);
}

function outputDeliveryIsFresh(template = {}) {
  if (!template.delivery) {
    return true;
  }
  return Boolean(
    template.approved_delivery_hash &&
    template.approved_delivery_hash === hashApprovalSubject(effectiveOutputDelivery(template)),
  );
}

function formatOutputDeliveryForHuman(delivery) {
  return [
    `${delivery.label} (${delivery.extension})`,
    delivery.generator ? `created with the ${delivery.generator} artifact capability` : "created directly",
    delivery.mode === "artifact-plus-chat-summary" ? "plus a concise chat summary" : "as the canonical file",
  ].join(", ");
}

function validateArtifactDeliveryPath(artifactPath, delivery, label = "Output") {
  if (!delivery.extension) {
    return;
  }
  if (!String(artifactPath).toLowerCase().endsWith(delivery.extension.toLowerCase())) {
    fail(`${label} requires a ${delivery.extension} canonical artifact, but received ${path.basename(artifactPath)}.`);
  }
}

function verifyOutputArtifact(context, artifactPath, delivery, options = {}) {
  const stat = fs.statSync(artifactPath);
  if (!stat.isFile() || stat.size === 0) {
    fail(`Output artifact ${path.basename(artifactPath)} is empty or is not a file.`);
  }
  const checks = [`non-empty file (${stat.size} bytes)`, `extension ${delivery.extension}`];
  let verifier = "file-structure-v1";

  if (["docx", "xlsx", "pptx"].includes(delivery.format)) {
    verifier = "ooxml-container-v1";
    const requiredEntries = {
      docx: ["[Content_Types].xml", "word/document.xml"],
      xlsx: ["[Content_Types].xml", "xl/workbook.xml"],
      pptx: ["[Content_Types].xml", "ppt/presentation.xml"],
    }[delivery.format];
    const entries = inspectZipContainer(artifactPath, requiredEntries);
    checks.push(`valid OOXML ZIP container with ${entries.size} entries`);
    checks.push(...requiredEntries.map((entry) => `contains ${entry}`));
    const rootEntry = requiredEntries[1];
    const xml = readZipEntry(artifactPath, entries.get(rootEntry)).toString("utf8");
    const rootPatterns = {
      docx: /<(?:\w+:)?document\b/i,
      xlsx: /<(?:\w+:)?workbook\b/i,
      pptx: /<(?:\w+:)?presentation\b/i,
    };
    if (!rootPatterns[delivery.format].test(xml)) {
      fail(`${delivery.label} artifact has ${rootEntry}, but it does not contain the expected XML root.`);
    }
    checks.push(`valid ${rootEntry} root`);
  } else if (delivery.format === "pdf") {
    verifier = "pdf-container-v1";
    const bytes = fs.readFileSync(artifactPath);
    if (!bytes.subarray(0, 8).toString("latin1").startsWith("%PDF-")) {
      fail("PDF artifact is missing a valid %PDF header.");
    }
    if (!bytes.subarray(Math.max(0, bytes.length - 2048)).toString("latin1").includes("%%EOF")) {
      fail("PDF artifact is missing its %%EOF marker.");
    }
    checks.push("valid PDF header and EOF marker");
  } else if (delivery.format === "json") {
    verifier = "json-parse-v1";
    try {
      JSON.parse(fs.readFileSync(artifactPath, "utf8"));
    } catch (error) {
      fail(`JSON output is not valid: ${error.message}`);
    }
    checks.push("valid JSON syntax");
  } else if (delivery.format === "html") {
    verifier = "html-structure-v1";
    const html = fs.readFileSync(artifactPath, "utf8");
    if (!/<(?:!doctype\s+html|html|body|main)\b/i.test(html)) {
      fail("HTML output does not contain an HTML document structure.");
    }
    checks.push("recognizable HTML document structure");
  } else if (delivery.format === "csv") {
    verifier = "csv-structure-v1";
    const csv = fs.readFileSync(artifactPath, "utf8");
    if (csv.includes("\u0000") || !/[;,\t]/.test(csv.split(/\r?\n/, 1)[0] || "")) {
      fail("CSV output does not contain a valid text header with a delimiter.");
    }
    checks.push("text CSV header with delimiter");
  } else if (["markdown", "custom"].includes(delivery.format)) {
    const bytes = fs.readFileSync(artifactPath);
    if (bytes.includes(0)) {
      fail(`${delivery.label} output contains binary NUL bytes.`);
    }
    checks.push("non-binary text content");
  }

  const evidence = normalizeListValue(options.evidence, []).map((rawPath) => {
    const evidencePath = resolveProjectFilePath(context, rawPath, { mustExist: true, fileOnly: true });
    assertNotDerivedArtifact(context, evidencePath, "Output verification evidence");
    if (fs.realpathSync.native(evidencePath) === fs.realpathSync.native(artifactPath)) {
      fail("Output verification evidence must be a separate render or inspection record, not the output artifact itself.");
    }
    return {
      path: toProjectPath(context, evidencePath),
      sha256: hashFile(evidencePath),
    };
  });
  if (options.requireVisualEvidence && OUTPUT_VISUAL_FORMATS.has(delivery.format) && evidence.length === 0) {
    fail(`${delivery.label} output requires --evidence <render-or-visual-check-file> before it can be linked as canonical.`);
  }
  if (evidence.length > 0) {
    checks.push(`${evidence.length} render or visual verification evidence file(s)`);
  }

  return {
    status: "passed",
    verifier,
    format: delivery.format,
    checks,
    evidence,
    artifact_sha256: hashFile(artifactPath),
    verified_at: now(),
  };
}

function inspectZipContainer(filePath, requiredEntries = []) {
  const buffer = fs.readFileSync(filePath);
  const minimumEocdSize = 22;
  let eocdOffset = -1;
  for (let offset = buffer.length - minimumEocdSize; offset >= Math.max(0, buffer.length - 65_557); offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) {
    fail(`${path.basename(filePath)} is not a valid ZIP container.`);
  }
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralSize = buffer.readUInt32LE(eocdOffset + 12);
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  if (centralOffset + centralSize > buffer.length) {
    fail(`${path.basename(filePath)} has an invalid ZIP central directory.`);
  }
  const entries = new Map();
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
      fail(`${path.basename(filePath)} has a malformed ZIP directory entry.`);
    }
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > buffer.length) {
      fail(`${path.basename(filePath)} has a truncated ZIP directory entry.`);
    }
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    entries.set(name, { name, flags, method, compressedSize, uncompressedSize, localOffset });
    offset = end;
  }
  for (const required of requiredEntries) {
    const entry = entries.get(required);
    if (!entry) {
      fail(`${path.basename(filePath)} is missing required OOXML entry ${required}.`);
    }
    if ((entry.flags & 0x1) !== 0) {
      fail(`${path.basename(filePath)} encrypts required OOXML entry ${required}; it cannot be verified.`);
    }
    readZipEntry(filePath, entry);
  }
  return entries;
}

function readZipEntry(filePath, entry) {
  const buffer = fs.readFileSync(filePath);
  const offset = entry.localOffset;
  if (offset + 30 > buffer.length || buffer.readUInt32LE(offset) !== 0x04034b50) {
    fail(`${path.basename(filePath)} has an invalid local ZIP header for ${entry.name}.`);
  }
  const nameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > buffer.length) {
    fail(`${path.basename(filePath)} has truncated ZIP data for ${entry.name}.`);
  }
  const compressed = buffer.subarray(dataStart, dataEnd);
  let value;
  if (entry.method === 0) {
    value = Buffer.from(compressed);
  } else if (entry.method === 8) {
    try {
      value = zlib.inflateRawSync(compressed);
    } catch (error) {
      fail(`${path.basename(filePath)} cannot decompress ${entry.name}: ${error.message}`);
    }
  } else {
    fail(`${path.basename(filePath)} uses unsupported ZIP compression ${entry.method} for ${entry.name}.`);
  }
  if (value.length !== entry.uncompressedSize) {
    fail(`${path.basename(filePath)} has an invalid uncompressed size for ${entry.name}.`);
  }
  return value;
}

function resolveProjectFilePath(context, rawPath, options = {}) {
  const value = normalizeProjectPathInput(rawPath);
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

function normalizeProjectPathInput(rawPath) {
  return String(rawPath || "").trim().replace(/\\/g, "/");
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
  if (!isInsidePath(context.sdlcRoot, filePath)) {
    return false;
  }
  const relative = path.relative(context.sdlcRoot, path.resolve(filePath));
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
      return fs.existsSync(storyPath) ? readProjectJson(context, storyPath) : null;
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
    outcome: event.outcome || null,
    actor: event.actor,
    requested_by: event.requested_by || null,
    authorized_by: event.authorized_by || null,
    request: event.request || null,
    authorization_ref: event.authorization_ref || null,
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
  validateAuthorizations(context, report);
  validateBaselines(context, report, storyId && scope === "story" ? storyId : null);
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

  report.approval_requests = collectApprovalRequests(context, {
    storyId: scope === "story" ? storyId : null,
  });
  report.assistant_message = renderApprovalRequestsAssistantMessage(report.approval_requests);
  attachAssistantMessagePresentation(report);

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
      report.assistant_message || null,
      "",
      `Gate ${report.status}`,
      `Checked: ${report.checked.length}`,
      `Errors: ${report.errors.length}`,
      `Warnings: ${report.warnings.length}`,
      `Human input requests: ${report.approval_requests.length}`,
      ...report.errors.map((item) => `ERROR ${item}`),
      ...report.warnings.map((item) => `WARN ${item}`),
      ...report.approval_requests.flatMap((item, index) => formatHumanApprovalRequest(item, index + 1).map((line) => `ASK ${line}`)),
    ].filter((line) => line !== null && line !== undefined),
  );
}

function readStory(context, storyId) {
  const id = normalizeId(storyId);
  const storyPath = path.join(context.sdlcRoot, "stories", id, "story.json");
  return fs.existsSync(storyPath) ? normalizeStoryRecord(readProjectJson(context, storyPath)) : null;
}

function normalizeStoryRecord(story) {
  if (!story || typeof story !== "object") {
    return story;
  }
  const acceptanceCriteria = storyAcceptanceCriteria(story);
  return {
    ...story,
    acceptance: Array.isArray(story.acceptance) ? story.acceptance : acceptanceCriteria,
    acceptance_criteria: acceptanceCriteria,
  };
}

function storyAcceptanceCriteria(story) {
  const canonical = Array.isArray(story?.acceptance_criteria) ? story.acceptance_criteria : [];
  if (canonical.length > 0) {
    return canonical;
  }
  return normalizeListValue(story?.acceptance, []);
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
    "## Human Input Requests",
    ...(report.approval_requests?.length
      ? report.approval_requests.flatMap((item, index) => formatMarkdownApprovalRequest(item, index + 1))
      : ["- None"]),
    "",
    "## Checked",
    ...(report.checked.length ? report.checked.map((item) => `- ${item}`) : ["- None"]),
    "",
  ].join("\n");
}

function formatMarkdownApprovalRequest(request, index = null) {
  const prefix = index === null ? "-" : `${index}.`;
  const lines = [
    `${prefix} ${request.title || request.summary}`,
    request.why_needed ? `   - Why: ${request.why_needed}` : null,
    request.review_items?.length ? "   - What to review:" : null,
    ...(request.review_items || []).slice(0, 6).map((item) => `     - ${item}`),
    request.delivery_format_options?.length ? "   - Delivery / presentation options:" : null,
    ...(request.delivery_format_options || []).slice(0, 10).map((option) => `     - ${formatDeliveryFormatOption(option)}`),
    request.recommended_delivery_format ? `   - Recommended delivery: ${request.recommended_delivery_format}` : null,
    request.delivery_question ? `   - Delivery question: ${request.delivery_question}` : null,
    request.approval_meaning ? `   - What approval means: ${request.approval_meaning}` : null,
    request.user_prompt ? `   - Question: ${request.user_prompt}` : null,
    request.suggested_command ? `   - Command: \`${request.suggested_command}\`` : null,
  ];
  return lines.filter(Boolean);
}

function showStatus(context, options) {
  ensureInitialized(context);
  const counts = {};
  for (const directory of context.config.kb_directories) {
    const dirPath = path.join(context.sdlcRoot, directory);
    counts[directory] = countFiles(dirPath);
  }
  const project = readProjectJson(context, path.join(context.sdlcRoot, "project.json"));
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
      suggested_branch: defaultStoryBranch(context, story.id),
      suggested_claim: `agentic-sdlc story claim --id ${story.id} --agent <agent> --branch ${defaultStoryBranch(context, story.id)}`,
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
      const story = readProjectJson(context, storyPath);
      story.__folder_id = entry;
      const claimPath = path.join(storiesRoot, entry, "claim.json");
      const claim = fs.existsSync(claimPath) ? readProjectJson(context, claimPath) : null;
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
  if (storyAcceptanceCriteria(story).length === 0) {
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
    .map((name) => readProjectJson(context, path.join(locksRoot, name)));
}

function readActiveLocks(context) {
  return readLocks(context).filter((lock) => lock.status === "active" && !isExpired(lock.expires_at));
}

function readHandoffs(context) {
  const handoffsRoot = path.join(context.sdlcRoot, "handoffs");
  return safeReadDir(handoffsRoot)
    .filter((name) => name.endsWith(".json"))
    .map((name) => readProjectJson(context, path.join(handoffsRoot, name)));
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
  const claim = readProjectJson(context, claimPath);
  if (claim.status !== "active") {
    fail(`Story ${storyId} claim is '${claim.status}', not active`);
  }
}

function readStoryStepRecords(context, storyId) {
  const stepsRoot = path.join(context.sdlcRoot, "stories", storyId, "steps");
  return safeReadDir(stepsRoot)
    .filter((name) => name.endsWith(".json"))
    .map((name) => readProjectJson(context, path.join(stepsRoot, name)))
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
      acceptance: storyAcceptanceCriteria(story),
      acceptance_criteria: storyAcceptanceCriteria(story),
    },
    active_claim: fs.existsSync(claimPath) ? readProjectJson(context, claimPath) : null,
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
  const project = readProjectJson(context, projectPath);
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

function validateAuthorizations(context, report) {
  for (const authorization of collectJsonFiles(context, authorizationRoot(context))) {
    const label = `authorization ${authorization.id || "unknown"}`;
    for (const field of ["id", "status", "scope", "summary", "allowed_actions", "approval_source", "granted_by", "approved_content_hash"]) {
      if (authorization[field] === undefined || authorization[field] === null || authorization[field] === "") {
        report.errors.push(`${label} is missing ${field}`);
      }
    }
    if (!Array.isArray(authorization.allowed_actions) || authorization.allowed_actions.length === 0) {
      report.errors.push(`${label} must allow at least one explicit action`);
    }
    if (!Array.isArray(authorization.allowed_subjects)) {
      report.errors.push(`${label} allowed_subjects must be an array`);
    }
    if (!Array.isArray(authorization.allowed_artifact_types)) {
      report.errors.push(`${label} allowed_artifact_types must be an array`);
    }
    if (
      authorization.allowed_approval_boundaries !== undefined &&
      !Array.isArray(authorization.allowed_approval_boundaries)
    ) {
      report.errors.push(`${label} allowed_approval_boundaries must be an array`);
    }
    if (!['explicit-user', 'ci'].includes(authorization.approval_source)) {
      report.errors.push(`${label} must be granted by explicit-user or ci approval`);
    }
    if (authorization.approval_source === "explicit-user" && authorization.granted_by?.type !== "human") {
      report.errors.push(`${label} explicit-user grant requires a human actor`);
    }
    if (authorization.approval_source === "ci" && authorization.granted_by?.type !== "ci") {
      report.errors.push(`${label} CI grant requires a CI actor`);
    }
    if (authorization.approved_content_hash && authorization.approved_content_hash !== hashAuthorizationRecord(authorization)) {
      report.errors.push(`${label} changed after grant`);
    }
    if (authorization.status === "active" && authorization.expires_at && Date.parse(authorization.expires_at) <= Date.now()) {
      report.warnings.push(`${label} expired at ${authorization.expires_at}`);
    }
    report.checked.push(label);
  }
}

function validateBaselines(context, report, storyId = null) {
  const allBaselines = readBaselines(context);
  const referencedIds = storyId
    ? baselineIdsReferencedByStoryContract(context, storyId)
    : baselineIdsReferencedByAllContracts(context);
  const activeIds = new Set([
    ...selectActiveBaselines(context, storyId).map((baseline) => baseline.id),
    ...referencedIds,
  ]);
  const availableIds = new Set(allBaselines.map((baseline) => baseline.id));
  for (const baselineId of referencedIds) {
    if (!availableIds.has(baselineId)) {
      report.errors.push(`Referenced baseline ${baselineId} is missing from .sdlc/baseline`);
    }
  }
  const baselines = report.scope === "story"
    ? allBaselines.filter((baseline) => activeIds.has(baseline.id))
    : allBaselines;
  for (const baseline of baselines) {
    const label = `baseline ${baseline.id || "unknown"}`;
    const baselineStatus = String(baseline.status || "").toLowerCase();
    const active = activeIds.has(baseline.id);
    if (!baseline.id || !baseline.schema_version || !baseline.status || !baseline.kind) {
      report.errors.push(`${label} is missing id, schema_version, status, or kind`);
    }
    for (const issue of validateBaselineSourceHashes(context, baseline, label, { collectOnly: true })) {
      const severity = active && ["approved", "provisionally_approved"].includes(baselineStatus) && report.strict ? "errors" : "warnings";
      report[severity].push(issue);
    }
    if (report.strict && active && baselineStatus && baselineStatus !== "approved") {
      report.errors.push(
        `${label} is '${baseline.status}'; strict gate requires explicit baseline approval before phase work treats inferred project facts as canonical`,
      );
    }
    if (active && baselineStatus === "approved") {
      const approval = latestApprovedRecordApproval(baseline);
      if (!approval || !hasFormalApprovalAttribution(approval.approved_by, approval.approval_source)) {
        report.errors.push(`${label} approval must be attributed to ${formalApprovalActorDescription(approval?.approval_source)}`);
      }
      validateFormalApprovalRecord(context, report, approval, `${label} approval ${approval?.id || "unknown"}`, approval?.approved_by);
      if (!isApprovedRecordFresh(baseline)) {
        report.errors.push(`${label} approval is stale`);
      }
    }
    if (active && baselineStatus === "provisionally_approved" && report.strict) {
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
      if (!approval || !hasFormalApprovalAttribution(approval.approved_by, approval.approval_source)) {
        report.errors.push(`${label} approval must be attributed to ${formalApprovalActorDescription(approval?.approval_source)}`);
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
    if (!HANDOFF_STATUSES.has(String(handoff.status || "").toLowerCase())) {
      report.errors.push(`${label} has unknown status '${handoff.status}'`);
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
    let delivery = null;
    try {
      delivery = effectiveOutputDelivery(template);
    } catch (error) {
      report.errors.push(`${label} has invalid delivery metadata: ${error.message}`);
    }
    if (template.status === "approved") {
      if (!hasFormalApprovalAttribution(template.approved_by, template.approval_source)) {
        report.errors.push(`${label} approved template is missing ${formalApprovalActorDescription(template.approval_source)} approval attribution`);
      }
      validateFormalApprovalRecord(
        context,
        report,
        {
          status: "approved",
          summary: template.approval_summary,
          evidence: template.approval_evidence || [],
          approval_source: template.approval_source || null,
          authorization_ref: template.authorization_ref || null,
          authorization_action: template.authorization_action || null,
          scope: template.approval_scope || null,
          artifact_type: template.type,
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
      if (template.delivery && (!template.approved_delivery_hash || !delivery || template.approved_delivery_hash !== hashApprovalSubject(delivery))) {
        report.errors.push(`${label} delivery format changed after approval; re-approve the template`);
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

  for (const decision of effectiveOutputDecisions(decisions)) {
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

function effectiveOutputDecisions(decisions) {
  const result = [];
  const latestTemplateDecision = new Map();
  for (const decision of decisions) {
    if (decision.type !== "template_approved" || !decision.template_id) {
      result.push(decision);
      continue;
    }
    const current = latestTemplateDecision.get(decision.template_id);
    const currentKey = `${current?.created_at || ""}\u0000${current?.id || ""}`;
    const candidateKey = `${decision.created_at || ""}\u0000${decision.id || ""}`;
    if (!current || candidateKey > currentKey) {
      latestTemplateDecision.set(decision.template_id, decision);
    }
  }
  result.push(...latestTemplateDecision.values());
  return result;
}

function validateOutputDecision(context, report, decision) {
  const label = `output decision ${decision.id || "unknown"}`;
  if (!decision.id || !decision.status) {
    report.errors.push(`${label} is missing id or status`);
  }
  if (decision.status === "approved") {
    const actor = decision.audit?.decided_by;
    if (!hasFormalApprovalAttribution(actor, decision.approval_source)) {
      report.errors.push(`${label} approved decision is missing ${formalApprovalActorDescription(decision.approval_source)} attribution`);
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
    try {
      const delivery = effectiveOutputDelivery(template);
      if (link.artifact_path) {
        const artifactPath = resolveProjectFilePath(context, link.artifact_path, { mustExist: false });
        if (delivery.extension && !String(artifactPath).toLowerCase().endsWith(delivery.extension.toLowerCase())) {
          report.errors.push(`${label} artifact must use approved ${delivery.extension} delivery format`);
        }
      }
      for (const [field, expected] of [
        ["delivery_format", delivery.format],
        ["delivery_extension", delivery.extension],
        ["media_type", delivery.media_type],
        ["generator", delivery.generator],
        ["delivery_mode", delivery.mode],
      ]) {
        if (link[field] !== undefined && link[field] !== expected) {
          report.errors.push(`${label} ${field} does not match approved template ${link.template_id}`);
        }
      }
    } catch (error) {
      report.errors.push(`${label} cannot validate delivery metadata: ${error.message}`);
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
    if (template?.delivery && fs.existsSync(artifactPath)) {
      const receipt = link.verification_receipt;
      if (!receipt || receipt.status !== "passed") {
        report.errors.push(`${label} is missing a passed format verification receipt; re-link the output artifact`);
      } else {
        try {
          const currentReceipt = verifyOutputArtifact(context, artifactPath, effectiveOutputDelivery(template), {
            evidence: [],
            requireVisualEvidence: false,
          });
          if (receipt.format !== currentReceipt.format || receipt.verifier !== currentReceipt.verifier) {
            report.errors.push(`${label} verification receipt does not match the approved artifact format`);
          }
          if (receipt.artifact_sha256 !== hashFile(artifactPath)) {
            report.errors.push(`${label} verification receipt is stale for ${link.artifact_path}`);
          }
        } catch (error) {
          report.errors.push(`${label} artifact format verification failed: ${error.message}`);
        }
        if (OUTPUT_VISUAL_FORMATS.has(effectiveOutputDelivery(template).format) && !(receipt.evidence || []).length) {
          report.errors.push(`${label} is missing render or visual verification evidence`);
        }
        for (const evidence of receipt.evidence || []) {
          const evidencePath = resolveProjectFilePath(context, evidence.path, { mustExist: false });
          if (!fs.existsSync(evidencePath) || (evidence.sha256 && hashFile(evidencePath) !== evidence.sha256)) {
            report.errors.push(`${label} verification evidence ${evidence.path} is missing or changed`);
          } else if (fs.realpathSync.native(evidencePath) === fs.realpathSync.native(artifactPath)) {
            report.errors.push(`${label} verification evidence must be separate from the output artifact`);
          }
        }
      }
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
      if (!approval || !hasFormalApprovalAttribution(approval.approved_by, approval.approval_source)) {
        report.errors.push(`${label} approval must be attributed to ${formalApprovalActorDescription(approval?.approval_source)}`);
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
      if (!approval || !hasFormalApprovalAttribution(approval.approved_by, approval.approval_source)) {
        report.errors.push(`${label} approval must be attributed to ${formalApprovalActorDescription(approval?.approval_source)}`);
      }
      validateFormalApprovalRecord(context, report, approval, `${label} approval ${approval?.id || "unknown"}`, approval?.approved_by);
      if (!isApprovedRecordFresh(recommendation)) {
        report[approvalIssueSeverity(context, report, approval)].push(`${label} approval is stale`);
      }
      const profile = fs.existsSync(capabilityProfilePath(context, recommendation.profile_id))
        ? readProjectJson(context, capabilityProfilePath(context, recommendation.profile_id))
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
    const contract = readProjectJson(context, path.join(contractsRoot, file));
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
      const openQuestionCount = (contract.contextualization.questions || []).filter(
        (question) => question?.status !== "answered",
      ).length;
      if (Number(contract.contextualization.open_questions || 0) !== openQuestionCount) {
        report.errors.push(
          `${label} contextualization.open_questions does not match the ${openQuestionCount} open question record(s)`,
        );
      }
      if (openQuestionCount > 0) {
        report.errors.push(`${label} strict gate blocks open contract questions`);
      }
    }
    validateContractApprovals(context, report, contract, label);
    validateContractContextSources(context, report, contract, label);
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

function validateContractContextSources(context, report, contract, label) {
  for (const source of contract.contextualization?.context_sources || []) {
    const sourcePath = source?.path || source;
    if (!sourcePath) {
      report.errors.push(`${label} has a context source without path`);
      continue;
    }
    let resolved;
    try {
      resolved = resolveProjectFilePath(context, sourcePath, { mustExist: false });
      assertNoSymlinkPathSegments(resolved);
    } catch (error) {
      report.errors.push(`${label} context source ${sourcePath} is invalid: ${error.message}`);
      continue;
    }
    if (!fs.existsSync(resolved)) {
      report.errors.push(`${label} context source ${sourcePath} is missing`);
      continue;
    }
    if (!fs.statSync(resolved).isFile()) {
      report.errors.push(`${label} context source ${sourcePath} is not a file`);
      continue;
    }
    if (!source.sha256) {
      report.errors.push(`${label} context source ${sourcePath} has no recorded hash`);
    } else if (hashFile(resolved) !== source.sha256) {
      report.errors.push(`${label} context source ${sourcePath} changed after contract creation`);
    }
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
      if (!hasFormalApprovalAttribution(actor, approval.approval_source)) {
        report.errors.push(`${approvalLabel} is missing ${formalApprovalActorDescription(approval.approval_source)} approval attribution`);
      }
      validateFormalApprovalRecord(context, report, approval, approvalLabel, actor, {
        subject_id: contract.id,
        artifact_types: contractArtifactTypes(contract),
        approval_boundaries: contractDirectApprovalRequirements(contract),
      });
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
  const requiresStartReceipt = refs.some((ref) => templates.get(ref.template_id)?.preset === "technical-assessment");
  const taskStartReceiptPath = contract.story_id
    ? path.join(context.sdlcRoot, "stories", contract.story_id, "task-start.json")
    : null;
  if (report.strict && contract.story_id && (requiresStartReceipt || fs.existsSync(taskStartReceiptPath))) {
    for (const issue of validateTaskStartReceipt(context, contract.story_id, contract)) {
      report.errors.push(`${label} ${issue}`);
    }
  }
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
      } else if (report.strict && outputTemplateNeedsApproval(context, template)) {
        report.errors.push(`${refLabel} template ${ref.template_id} structure or delivery approval is stale`);
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
    const fileName = path.basename(filePath, ".jsonl");
    const expectedStoryId = fileName === "project" ? null : fileName;
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    const latestOutcomeEvents = new Map();
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
      if ((event.story_id || null) !== expectedStoryId) {
        report.errors.push(`${label}:${index + 1} story_id must match ${expectedStoryId || "project trace"}`);
      }
      if (event.story_id && !readStory(context, event.story_id)) {
        report.errors.push(`${label}:${index + 1} references missing story ${event.story_id}`);
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
      if (event.requested_by !== undefined && event.requested_by !== null && !hasActorAttribution(event.requested_by)) {
        report.errors.push(`${label}:${index + 1} has invalid requested_by attribution`);
      }
      if (event.authorized_by !== undefined && event.authorized_by !== null && !hasActorAttribution(event.authorized_by)) {
        report.errors.push(`${label}:${index + 1} has invalid authorized_by attribution`);
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
        latestOutcomeEvents.set(event.type, { event, line: index + 1 });
      }
    });
    for (const [type, latest] of latestOutcomeEvents) {
      const acceptableOutcomes = type === "test" ? ["passed"] : ["ready", "passed"];
      if (!acceptableOutcomes.includes(latest.event.outcome)) {
        report.errors.push(
          `${label}:${latest.line} latest ${type} trace outcome must be ${acceptableOutcomes.join(" or ")}, found '${latest.event.outcome || "missing"}'`,
        );
      }
    }
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
  return hasActorAttribution(event.actor);
}

function hasActorAttribution(actor) {
  if (typeof actor === "string") {
    return actor.trim().length > 0;
  }
  return Boolean(actor && typeof actor === "object" && String(actor.id || "").trim());
}

function validateStory(context, storyId, report) {
  const storyDir = path.join(context.sdlcRoot, "stories", storyId);
  const storyPath = path.join(storyDir, "story.json");
  if (!fs.existsSync(storyPath)) {
    report.errors.push(`Story ${storyId} is missing story.json`);
    return;
  }
  const story = normalizeStoryRecord(readProjectJson(context, storyPath));
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
  if (storyAcceptanceCriteria(story).length === 0) {
    const severity = story.status === "draft" ? "warnings" : "errors";
    report[severity].push(`Story ${storyId} has no acceptance criteria`);
  }
  const isImplementationLike = ["implementation", "in_progress", "review", "validation", "release", "done"].includes(
    String(story.status),
  ) || story.phase === "implementation";
  const currentPhaseCompleted = readStoryStepRecords(context, storyId).some(
    (record) => record.status === "completed" && record.phase === story.phase,
  );
  const requiresActiveClaim = isImplementationLike && story.status !== "done" && !currentPhaseCompleted;
  if (context.config.gate_policy.implementation_requires_claim && isImplementationLike) {
    const claimPath = path.join(storyDir, "claim.json");
    if (!fs.existsSync(claimPath)) {
      if (requiresActiveClaim) {
        report.errors.push(`Story ${storyId} requires an active claim before implementation`);
      }
    } else {
      const claim = readProjectJson(context, claimPath);
      validateClaim(context, storyId, claim, report, { requireActive: requiresActiveClaim });
    }
  }
  if (story.contract_id) {
    let contract = null;
    try {
      contract = readContractById(context, story.contract_id, { missingOk: true });
    } catch (error) {
      report.errors.push(`Story ${storyId} has invalid contract_id '${story.contract_id}': ${error.message}`);
    }
    if (!contract) {
      report.errors.push(`Story ${storyId} references missing contract ${story.contract_id}`);
    } else {
      if (contract.story_id !== storyId) {
        report.errors.push(`Story ${storyId} contract ${story.contract_id} is bound to ${contract.story_id || "the project"}`);
      }
    }
  } else {
    const severity = report.strict ? "errors" : "warnings";
    report[severity].push(`Story ${storyId} has no contract_id`);
  }
  const traceEvents = readTraceEvents(context, storyId);
  const latestTestTrace = latestTraceEvent(traceEvents, "test");
  if (
    (story.phase === "validation" || story.status === "validation") &&
    latestTestTrace?.outcome !== "passed"
  ) {
    report.errors.push(`Story ${storyId} is in validation but has no passing test trace`);
  }
  const latestReleaseTrace = latestTraceEvent(traceEvents, "release");
  if (
    (story.phase === "release" || story.status === "release") &&
    !["ready", "passed"].includes(latestReleaseTrace?.outcome)
  ) {
    report.errors.push(`Story ${storyId} is in release but has no ready release trace`);
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
    const record = readProjectJson(context, stepPath);
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
    if (report.strict && ["validation", "release"].includes(record.step)) {
      const substantiveEvidence = stepArtifacts.length + stepEvidence.length + (record.output_links || []).length;
      if (substantiveEvidence === 0) {
        report.errors.push(`${label} has no artifact, evidence, or linked output`);
      }
      const requiredTraceType = record.step === "validation" ? "test" : "release";
      const acceptableOutcomes = record.step === "validation" ? ["passed"] : ["ready", "passed"];
      const supportingTrace = latestTraceEvent(readTraceEvents(context, storyId), requiredTraceType);
      if (!supportingTrace || !acceptableOutcomes.includes(supportingTrace.outcome)) {
        report.errors.push(`${label} has no ${requiredTraceType} trace with outcome ${acceptableOutcomes.join(" or ")}`);
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

function validateClaim(context, storyId, claim, report, options = {}) {
  if (claim.story_id !== storyId) {
    report.errors.push(`Story ${storyId} claim.story_id must match story id`);
  }
  if (!CLAIM_STATUSES.has(String(claim.status || "").toLowerCase())) {
    report.errors.push(`Story ${storyId} claim has unknown status '${claim.status}'`);
  }
  if (options.requireActive !== false && claim.status !== "active") {
    report.errors.push(`Story ${storyId} requires an active claim, found '${claim.status}'`);
  } else if (options.requireActive === false && !["active", "released", "transferred"].includes(claim.status)) {
    report.errors.push(`Story ${storyId} completed work has unsupported claim status '${claim.status}'`);
  }
  if (!claim.agent) {
    report.errors.push(`Story ${storyId} active claim is missing agent`);
  }
  if (!claim.branch) {
    report.errors.push(`Story ${storyId} active claim is missing branch`);
  } else {
    const expectedBranches = storyBranchPatterns(context, storyId);
    if (!expectedBranches.includes(claim.branch)) {
      const severity = report.strict && context.config.claim_policy?.require_branch_pattern !== false ? "errors" : "warnings";
      report[severity].push(`Story ${storyId} claim branch '${claim.branch}' does not match expected ${expectedBranches.join(" or ")}`);
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

function storyBranchPatterns(context, storyId) {
  const configured = context.config.parallel_work?.branch_patterns;
  const patterns = Array.isArray(configured) && configured.length > 0
    ? configured
    : [context.config.parallel_work?.branch_pattern || "codex/<story-id>"];
  return Array.from(new Set(patterns.map((pattern) => String(pattern).replaceAll("<story-id>", storyId))));
}

function defaultStoryBranch(context, storyId) {
  return storyBranchPatterns(context, storyId)[0];
}

function readTraceEvents(context, storyId) {
  const tracePath = path.join(context.sdlcRoot, "traces", `${storyId}.jsonl`);
  if (!fs.existsSync(tracePath)) {
    return [];
  }
  return readProjectText(context, tracePath)
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

function latestTraceEvent(events, type) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]?.type === type) {
      return events[index];
    }
  }
  return null;
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
    index = readProjectJson(context, indexPath);
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
  const projectPath = path.join(context.sdlcRoot, "project.json");
  if (!fs.existsSync(projectPath)) {
    fail(`No ${SDLC_DIR}/project.json found. Run 'agentic-sdlc init' first.`);
  }
  resolveProjectFilePath(context, path.join(SDLC_DIR, "project.json"), { mustExist: true, fileOnly: true });
  assertNoSymlinkPathSegments(projectPath);
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

function readProjectJson(context, filePath) {
  try {
    return JSON.parse(readProjectText(context, filePath));
  } catch (error) {
    if (error instanceof UserError) {
      throw error;
    }
    fail(`Unable to read JSON file ${filePath}: ${error.message}`);
  }
}

function readProjectText(context, filePath) {
  resolveProjectFilePath(context, filePath, { mustExist: true, fileOnly: true });
  assertNoSymlinkPathSegments(filePath);
  const parentIdentity = captureDirectoryIdentity(path.dirname(filePath));
  const realRoot = fs.realpathSync.native(context.root);
  if (!isInsidePath(realRoot, parentIdentity.realpath)) {
    fail(`Project file parent resolves outside the target project root: ${filePath}`);
  }
  let descriptor;
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | NO_FOLLOW_FLAG);
    verifyOpenFileMatchesPath(descriptor, filePath, parentIdentity);
    return fs.readFileSync(descriptor, "utf8");
  } catch (error) {
    if (error instanceof UserError) {
      throw error;
    }
    fail(`Unable to read project file ${filePath}: ${error.message}`);
  } finally {
    if (descriptor !== undefined) {
      fs.closeSync(descriptor);
    }
  }
}

function writeJsonFile(filePath, value, options = {}) {
  writeTextFile(filePath, `${JSON.stringify(value, null, 2)}\n`, options);
}

function writeTextFile(filePath, content, options = {}) {
  assertNoSymlinkPathSegments(filePath);
  const parentPath = path.dirname(filePath);
  ensureDir(parentPath);
  const parentIdentity = captureDirectoryIdentity(parentPath);
  if (fs.existsSync(filePath) && !options.force) {
    if (fs.lstatSync(filePath).isSymbolicLink()) {
      fail(`Refusing to write through symlink: ${filePath}`);
    }
    const existing = readFileFromStableParent(filePath, parentIdentity);
    if (existing === content) {
      return false;
    }
    fail(`File already exists: ${filePath}. Use --force to overwrite it.`);
  }
  if (options.force) {
    const tempPath = path.join(
      parentPath,
      `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`,
    );
    try {
      writeFileToStableParent(tempPath, content, parentIdentity);
      assertDirectoryIdentity(parentPath, parentIdentity);
      fs.renameSync(tempPath, filePath);
    } finally {
      if (directoryIdentityMatches(parentPath, parentIdentity)) {
        fs.rmSync(tempPath, { force: true });
      }
    }
    return true;
  }
  try {
    writeFileToStableParent(filePath, content, parentIdentity);
  } catch (error) {
    if (error && error.code === "EEXIST") {
      fail(`File already exists: ${filePath}. Use --force to overwrite it.`);
    }
    throw error;
  }
  return true;
}

function captureDirectoryIdentity(directoryPath) {
  const entry = fs.lstatSync(directoryPath);
  if (entry.isSymbolicLink() || !entry.isDirectory()) {
    fail(`Refusing unstable write directory: ${directoryPath}`);
  }
  const stat = fs.statSync(directoryPath);
  return {
    dev: stat.dev,
    ino: stat.ino,
    realpath: fs.realpathSync.native(directoryPath),
  };
}

function directoryIdentityMatches(directoryPath, expected) {
  try {
    const current = captureDirectoryIdentity(directoryPath);
    return current.dev === expected.dev && current.ino === expected.ino && current.realpath === expected.realpath;
  } catch {
    return false;
  }
}

function assertDirectoryIdentity(directoryPath, expected) {
  if (!directoryIdentityMatches(directoryPath, expected)) {
    fail(`Directory changed during filesystem operation: ${directoryPath}`);
  }
}

function verifyOpenFileMatchesPath(descriptor, filePath, parentIdentity) {
  const descriptorStat = fs.fstatSync(descriptor);
  if (!descriptorStat.isFile()) {
    fail(`Refusing non-regular file: ${filePath}`);
  }
  assertDirectoryIdentity(path.dirname(filePath), parentIdentity);
  const pathStat = fs.lstatSync(filePath);
  if (pathStat.isSymbolicLink() || pathStat.dev !== descriptorStat.dev || pathStat.ino !== descriptorStat.ino) {
    fail(`File changed while opening it: ${filePath}`);
  }
}

function readFileFromStableParent(filePath, parentIdentity) {
  let descriptor;
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | NO_FOLLOW_FLAG);
    verifyOpenFileMatchesPath(descriptor, filePath, parentIdentity);
    return fs.readFileSync(descriptor, "utf8");
  } finally {
    if (descriptor !== undefined) {
      fs.closeSync(descriptor);
    }
  }
}

function writeFileToStableParent(filePath, content, parentIdentity) {
  assertDirectoryIdentity(path.dirname(filePath), parentIdentity);
  let descriptor;
  let created = false;
  let complete = false;
  try {
    descriptor = fs.openSync(
      filePath,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | NO_FOLLOW_FLAG,
      0o666,
    );
    created = true;
    verifyOpenFileMatchesPath(descriptor, filePath, parentIdentity);
    fs.writeFileSync(descriptor, content);
    complete = true;
  } finally {
    if (descriptor !== undefined) {
      fs.closeSync(descriptor);
    }
    if (created && !complete && directoryIdentityMatches(path.dirname(filePath), parentIdentity)) {
      fs.rmSync(filePath, { force: true });
    }
  }
}

function appendJsonLine(filePath, value) {
  assertNoSymlinkPathSegments(filePath);
  ensureDir(path.dirname(filePath));
  const releaseLock = acquireFileLock(`${filePath}.lock`);
  try {
    fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`);
  } finally {
    releaseLock();
  }
}

function acquireFileLock(lockPath) {
  assertNoSymlinkPathSegments(lockPath);
  ensureDir(path.dirname(lockPath));
  const nonce = crypto.randomBytes(12).toString("hex");
  const metadata = {
    pid: process.pid,
    host: os.hostname(),
    nonce,
    created_at: now(),
  };
  const deadline = Date.now() + INTERNAL_LOCK_WAIT_MS;
  while (true) {
    try {
      const fd = fs.openSync(lockPath, "wx");
      fs.writeFileSync(fd, JSON.stringify(metadata));
      fs.closeSync(fd);
      break;
    } catch (error) {
      if (!error || error.code !== "EEXIST") {
        throw error;
      }
      if (reclaimStaleInternalLock(lockPath)) {
        continue;
      }
      if (Date.now() >= deadline) {
        fail(`Resource is locked by another SDLC operation: ${lockPath}`);
      }
      sleepSync(25);
    }
  }
  return () => {
    try {
      const current = fs.existsSync(lockPath) ? JSON.parse(fs.readFileSync(lockPath, "utf8")) : null;
      if (current?.nonce === nonce) {
        fs.rmSync(lockPath, { force: true });
      }
    } catch {
      // Best effort cleanup; a remaining lock is safer than silent concurrent writes.
    }
  };
}

function reclaimStaleInternalLock(lockPath) {
  let metadata = null;
  let ageMs = 0;
  try {
    metadata = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    const createdAt = Date.parse(String(metadata.created_at || ""));
    ageMs = Number.isFinite(createdAt) ? Date.now() - createdAt : Date.now() - fs.statSync(lockPath).mtimeMs;
  } catch {
    try {
      ageMs = Date.now() - fs.statSync(lockPath).mtimeMs;
    } catch {
      return true;
    }
  }
  if (ageMs < INTERNAL_LOCK_STALE_MS) {
    return false;
  }
  if (metadata?.host && metadata.host !== os.hostname() && ageMs < INTERNAL_LOCK_REMOTE_STALE_MS) {
    return false;
  }
  if ((!metadata?.host || metadata.host === os.hostname()) && Number.isInteger(metadata?.pid) && processIsAlive(metadata.pid)) {
    return false;
  }
  const stalePath = `${lockPath}.stale-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  try {
    fs.renameSync(lockPath, stalePath);
    fs.rmSync(stalePath, { force: true });
    return true;
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return true;
    }
    return false;
  }
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function sleepSync(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
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
  if (fs.lstatSync(dirPath).isSymbolicLink()) {
    fail(`Refusing to read through symlinked directory: ${dirPath}`);
  }
  if (!fs.statSync(dirPath).isDirectory()) {
    fail(`Expected directory but found another file type: ${dirPath}`);
  }
  const entries = fs.readdirSync(dirPath);
  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry);
    if (fs.lstatSync(entryPath).isSymbolicLink()) {
      fail(`Refusing symlinked canonical entry: ${entryPath}`);
    }
  }
  return entries;
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

function normalizeTraceOutcome(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!TRACE_OUTCOMES.has(normalized)) {
    fail(`Unknown trace outcome '${value}'. Valid values: ${Array.from(TRACE_OUTCOMES).join(", ")}`);
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

function normalizeHandoffStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!HANDOFF_STATUSES.has(normalized)) {
    fail(`Unknown handoff status '${value}'. Valid values: ${Array.from(HANDOFF_STATUSES).join(", ")}`);
  }
  return normalized;
}

function requireCoordinationOverrideActor(attribution, action) {
  if (!["human", "ci"].includes(attribution.actor?.type)) {
    fail(`${action} requires --actor-type human or an approved CI actor after coordination.`);
  }
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
  if (normalized.endsWith(".")) {
    fail(`Invalid id '${value}'. IDs cannot end with a period because they must remain portable across supported filesystems.`);
  }
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(normalized)) {
    fail(`Invalid id '${value}'. This name is reserved by Windows and cannot be used for a portable project artifact.`);
  }
  return normalized;
}

function isInsidePath(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
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

function uniqueRecordSuffix() {
  return `${new Date().toISOString().replace(/[-:.TZ]/g, "")}-${crypto.randomBytes(3).toString("hex")}`;
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
  agentic-sdlc doctor [--root path] [--json]
  agentic-sdlc init [--project-name name] [--project-id id] [--root path]
  agentic-sdlc onboard existing-project [--project-name name] [--document path]
      [--source path] [--question text] [--summary text]
  agentic-sdlc baseline propose --id id [--document path] [--source path]
      [--question text] [--assumption text] [--summary text]
  agentic-sdlc baseline approve --id id --actor-type human|ci|agent|system
      --approval-source explicit-user|ci|automation|bootstrap [--summary text]
  agentic-sdlc baseline status [--id id]
  agentic-sdlc contract create --phase phase [--id id] [--story ST-001]
      [--context-file path] [--context-summary text] [--question text]
      [--qa "question|answer"] [--constraint text] [--assumption text]
      [--output-ref artifact-type:template-id:mode]
      [--allow-incomplete-contract] [--replace-story-contract]
      [--model model-id] [--reasoning inherit|minimal|low|medium|high]
  agentic-sdlc contract approve --id contract-id
      --approval-source explicit-user|ci|automation|bootstrap [--summary text] [--approval-evidence path]
  agentic-sdlc story create --id ST-001 --title title [--acceptance text]
  agentic-sdlc story claim --id ST-001 --agent name [--branch branch]
  agentic-sdlc story release --id ST-001 [--agent name] [--reason text]
  agentic-sdlc story complete-step --id ST-001 --step functional-analysis
      [--type artifact-type] [--artifact path] [--evidence path] [--release-claim]
      [--allow-unapproved-contract-output]
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
  agentic-sdlc breakdown approve --id id --actor-type human|ci|agent|system --approval-source explicit-user|ci|automation|bootstrap
  agentic-sdlc breakdown status [--requirement REQ-001]
  agentic-sdlc dependency propose --id id --edge from:to:type:blocks:required_state
  agentic-sdlc dependency approve --id id --actor-type human|ci|agent|system --approval-source explicit-user|ci|automation|bootstrap
  agentic-sdlc dependency status [--story ST-001]
  agentic-sdlc capability profile propose --id id [--story ST-001] [--phase analysis]
      [--context-file path] [--profile-json json | --profile-file path]
  agentic-sdlc capability profile approve --id id --actor-type human|ci|agent|system --approval-source explicit-user|ci|automation|bootstrap
  agentic-sdlc capability recommend --id id --profile profile-id
      [--recommendation-json json | --recommendation-file path]
      [--available-capabilities-json json | --available-capabilities-file path]
  agentic-sdlc capability approve --id id --actor-type human|ci|agent|system --approval-source explicit-user|ci|automation|bootstrap [--approve-install]
  agentic-sdlc capability status [--story ST-001] [--profile profile-id] [--json]
  agentic-sdlc approval requests [--story ST-001] [--json]
  agentic-sdlc authorization grant --id id --scope "exact delegated scope"
      --allow-action contract.approve [--allow-action task.start.confirm]
      --actor-type human|ci --approval-source explicit-user|ci --summary text
      [--allow-artifact-type technical-analysis] [--allow-boundary production:write]
      [--expires-at iso]
      [--allow-subject exact-artifact-or-story-id]
  agentic-sdlc authorization status [--id id] [--json]
  agentic-sdlc authorization revoke --id id --actor-type human|ci [--reason text]
  agentic-sdlc task start [--intent-json json | --intent-file path] [--text raw]
      [--story ST-001] [--phase phase] [--contract-id id]
      [--confirm-start] [--authorization id] [--revise-contract] [--json]
  agentic-sdlc phase lock --phase phase [--reason text] [--expires-at iso]
  agentic-sdlc phase release --id lock-id [--reason text]
  agentic-sdlc trace append --type decision --summary text [--story ST-001]
      [--outcome passed|failed|blocked|skipped|ready]
      [--actor id] [--requested-by id] [--authorized-by id]
      [--request-summary text] [--git-event push|commit|merge|pull|rebase]
  agentic-sdlc sync record --event push [--story ST-001] [--remote origin]
  agentic-sdlc output template propose --type artifact-type [--id id]
      [--from path | --body text | --preset technical-assessment] [--summary text]
      [--format markdown|docx|xlsx|pdf|pptx|html|json|csv|custom]
      [--delivery artifact|artifact-plus-chat-summary]
      [--extension .ext --media-type type --generator capability]
  agentic-sdlc output template approve --id template-id
      --approval-source explicit-user|ci|automation|bootstrap [--summary text] [--approval-evidence path]
  agentic-sdlc output resolve --story ST-001 --type artifact-type
  agentic-sdlc output link --story ST-001 --type artifact-type
      --artifact path --template template-id --mode reuse|delta|new
      [--base-artifact path] [--requirement REQ-001] [--evidence render-or-verification-file]
      [--allow-unapproved-contract-output]
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
  --requested-by id      Human, system, CI, or agent that requested the action.
  --requested-by-type type
                         Type for --requested-by. Defaults to human.
  --requested-by-name name
                         Display name for the requester.
  --requested-by-email email
                         Email for the requester when appropriate.
  --requested-by-source source
                         Source for requester attribution. Defaults to cli.
  --authorized-by id     Human, CI, system, or agent that authorized the action.
  --authorized-by-type type
                         Type for --authorized-by. Defaults to human.
  --authorized-by-name name
                         Display name for the authorizer.
  --authorized-by-email email
                         Email for the authorizer when appropriate.
  --authorized-by-source source
                         Source for authorizer attribution. Defaults to cli.
  --request-id id        External request, ticket, or conversation identifier.
  --request-summary text Human-readable summary of the originating request.
  --request-source source
                         Source channel for the originating request.
  --request-thread-id id Codex or external thread that carried the request.
  --request-run-id id    External run identifier for the originating request.
  --request-session-id id
                         Session identifier for the originating request.
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
                         Referenced templates must be approved by default.
  --allow-incomplete-contract
                         Migration/recovery override for contracts that still
                         need user clarification. Do not use to start phase work.
  --allow-unapproved-output-ref
                         Migration/recovery override for draft or missing
                         output templates. Do not use for normal task work.
  --replace-story-contract
                         Explicit renegotiation/recovery override when a story
                         already references a different contract.

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
                         automation, or bootstrap. For explicit-user and
                         automation, provide --summary or --approval-evidence.
                         Use automation only for a recorded delegated approval
                         level or configured automation policy.
                         Permission to implement or push is not formal SDLC
                         approval.

Task front-door options:
  --contract-id id       Force task start to evaluate a specific contract.
  --confirm-start        Record that the human already confirmed this concrete
                         task start. This is operational authorization only;
                         it is not formal contract approval.
  --revise-contract      Stop for contract revision even if an applicable
                         contract exists.

Baseline onboarding options:
  --document path        Import a project or user-provided document as baseline
                         evidence. Repeatable.
  --source path          Extra project file or directory to hash into the
                         baseline source set. Repeatable.
  --confirmed-source id  Source name the user already confirmed as canonical.
                         Repeatable.

Trace options:
  --outcome outcome     Explicit trace result: passed, failed, blocked, skipped,
                        or ready. Strict validation/release gates require a
                        successful outcome in addition to canonical evidence.
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
  --allow-unapproved-contract-output
                         Migration/recovery override for linking or completing
                         pre-existing artifacts before contract approval.

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
                         Query filters support actor/executor, requester,
                         authorizer, story, requirement, artifact, action,
                         event type, phase, status, path, and text.

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
