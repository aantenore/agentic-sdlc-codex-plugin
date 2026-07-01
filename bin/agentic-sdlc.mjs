#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import childProcess from "node:child_process";
import { fileURLToPath } from "node:url";

const VERSION = "0.1.0";
const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_TEMPLATE_DIR = path.join(PLUGIN_ROOT, "templates");
const SDLC_DIR = ".sdlc";
const CACHE_FILE_NAME = "kb-cache.json";
const PROJECT_CONFIG_FILE_NAME = "config.json";
const OUTPUT_LINK_MODES = new Set(["reuse", "delta", "new"]);
const BOOLEAN_OPTIONS = new Set(["force", "help", "json", "preserve-status", "strict", "version"]);
const STORY_STATUSES = new Set(["draft", "ready", "analysis", "design", "implementation", "in_progress", "review", "validation", "release", "done", "blocked"]);
const CLAIM_STATUSES = new Set(["active", "released", "transferred", "cancelled"]);
const LOCK_STATUSES = new Set(["active", "released", "cancelled", "expired"]);
const HANDOFF_STATUSES = new Set(["open", "accepted", "closed", "rejected", "cancelled"]);

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
    if (command === "story" && subcommand === "handoff" && rest[0] === "close") {
      closeHandoff(context, parsed.options);
      return;
    }
    if (command === "story" && subcommand === "handoff") {
      createStoryHandoff(context, parsed.options);
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

function initProject(context, options) {
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

  output(
    options,
    {
      status: "initialized",
      root: context.root,
      sdlc_root: context.sdlcRoot,
      project,
      contracts_created: createdContracts,
    },
    [
      `Initialized Agentic SDLC at ${path.relative(context.root, context.sdlcRoot) || SDLC_DIR}`,
      `Project: ${projectName} (${projectId})`,
      `Phase contracts available: ${context.config.phase_order.join(", ")}`,
    ],
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
    model: options.model,
    reasoning: options.reasoning,
    execution_notes: normalizeRawListOption(options["execution-note"]),
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
  const approvedContentHash = approvalStatus === "approved" ? hashApprovalSubject(contract) : null;
  if (contract.human_gate === true && !["human", "ci"].includes(attribution.actor.type)) {
    fail("Human-gated contracts require --actor-type human or an approved CI actor.");
  }
  const approval = {
    id: `APR-${compactTimestamp()}-${crypto.randomBytes(3).toString("hex")}`,
    contract_id: id,
    status: approvalStatus,
    summary: options.summary ? String(options.summary) : null,
    scope: String(options.scope || "contract"),
    evidence: buildApprovalEvidence(context, options),
    approved_content_hash: approvedContentHash,
    hash_algorithm: approvedContentHash ? "sha256:stable-json:v1" : null,
    approved_by: attribution.actor,
    git: attribution.git,
    run: attribution.run,
    created_at: now(),
  };
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
  output(options, { status: "released", claim_path: claimPath, claim }, [`Released claim for story ${id}`]);
}

function createStoryHandoff(context, options) {
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
  output(options, { status: "created", handoff_path: handoffPath, handoff }, [`Created handoff ${handoffId}`]);
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
      `Approve it with: agentic-sdlc output template approve --id ${id}`,
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
  template.status = "approved";
  template.approved_at = now();
  template.approved_by = attribution.actor;
  template.approval_summary = getOptionString(options, "summary") || template.approval_summary || null;
  template.approved_content_hash = approvedContentHash;
  template.hash_algorithm = "sha256:file:v1";
  template.approval_evidence = buildApprovalEvidence(context, options);
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
      summary: getOptionString(options, "rationale") || `Approved output override for ${storyId}/${artifactType}`,
      subject: decisionSubject,
      evidence: buildApprovalEvidence(context, options),
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
  const dependencyGraph = buildStoryDependencyGraph(stories);
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
    "assumptions",
    "risks",
    "locks",
    "orchestration",
    "releases",
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
  validateLocks(context, report);

  if (storyId && scope === "story") {
    const story = readStory(context, storyId);
    if (story?.contract_id) {
      validateContracts(context, report, new Set([story.contract_id]));
    }
    validateTraces(context, report, storyId);
    validateHandoffs(context, report, storyId);
    validateStory(context, storyId, report);
    validateOutputContracts(context, report, storyId);
  } else {
    validateContracts(context, report);
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
      return {
        id: story.id || entry,
        title: story.title || entry,
        status: story.status || "unknown",
        phase: story.phase || "unknown",
        contract_id: story.contract_id || null,
        claim,
        last_trace: lastTrace,
        orchestration_state: inferStoryOrchestrationState(context, story, claim),
        blockers: inferStoryBlockers(context, story, claim),
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

function inferStoryOrchestrationState(context, story, claim) {
  if (claim && claim.status === "active") {
    return isExpired(claim.expires_at) ? "stale" : "claimed";
  }
  return inferStoryBlockers(context, story, claim).length > 0 ? "blocked" : "available";
}

function inferStoryBlockers(context, story, claim) {
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
  report.checked.push(`story ${storyId}`);
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
  agentic-sdlc contract create --phase phase [--id id] [--story ST-001]
      [--context-file path] [--context-summary text] [--question text]
      [--qa "question|answer"] [--constraint text] [--assumption text]
      [--output-ref artifact-type:template-id:mode]
      [--model model-id] [--reasoning inherit|minimal|low|medium|high]
  agentic-sdlc contract approve --id contract-id [--summary text] [--approval-evidence path]
  agentic-sdlc story create --id ST-001 --title title [--acceptance text]
  agentic-sdlc story claim --id ST-001 --agent name [--branch branch]
  agentic-sdlc story release --id ST-001 [--agent name] [--reason text]
  agentic-sdlc story handoff --id ST-001 --to-agent name [--artifact path]
  agentic-sdlc story handoff close --id handoff-id [--status closed|accepted|cancelled]
  agentic-sdlc phase lock --phase phase [--reason text] [--expires-at iso]
  agentic-sdlc phase release --id lock-id [--reason text]
  agentic-sdlc trace append --type decision --summary text [--story ST-001]
      [--actor id] [--git-event push|commit|merge|pull|rebase]
  agentic-sdlc sync record --event push [--story ST-001] [--remote origin]
  agentic-sdlc output template propose --type artifact-type [--id id]
      [--from path | --body text] [--summary text]
  agentic-sdlc output template approve --id template-id [--summary text] [--approval-evidence path]
  agentic-sdlc output resolve --story ST-001 --type artifact-type
  agentic-sdlc output link --story ST-001 --type artifact-type
      --artifact path --template template-id --mode reuse|delta|new
      [--base-artifact path] [--requirement REQ-001]
  agentic-sdlc output status --story ST-001 [--type artifact-type]
  agentic-sdlc cache rebuild
  agentic-sdlc cache status
  agentic-sdlc cache clear
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
  --approval-evidence path
                         Attach canonical approval evidence and content hash.
                         Repeatable. Must not point to cache/indexes.
  --preserve-status      Record an approval without changing contract.status.

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
