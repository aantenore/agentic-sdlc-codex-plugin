#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const VERSION = "0.1.0";
const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_TEMPLATE_DIR = path.join(PLUGIN_ROOT, "templates");
const SDLC_DIR = ".sdlc";

const TRACE_TYPES = new Set([
  "assumption",
  "decision",
  "gate",
  "implementation",
  "release",
  "risk",
  "test",
]);

function main() {
  try {
    const parsed = parseArgs(process.argv.slice(2));
    if (parsed.help || parsed.positionals.length === 0) {
      printHelp();
      return;
    }
    if (parsed.version) {
      console.log(VERSION);
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
    if (command === "story" && subcommand === "create") {
      createStory(context, parsed.options);
      return;
    }
    if (command === "story" && subcommand === "claim") {
      claimStory(context, parsed.options);
      return;
    }
    if (command === "trace" && subcommand === "append") {
      appendTrace(context, parsed.options);
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
      const [key, inlineValue] = raw.split("=", 2);
      let value = inlineValue;
      if (value === undefined) {
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
  return {
    root,
    sdlcRoot: path.join(root, SDLC_DIR),
    templateDir,
    config: readJson(path.join(templateDir, "sdlc-config.json")),
  };
}

function initProject(context, options) {
  const projectName = String(options["project-name"] || path.basename(context.root));
  const projectId = String(options["project-id"] || slugify(projectName));
  const force = Boolean(options.force);

  ensureDir(context.sdlcRoot);
  for (const directory of context.config.kb_directories) {
    ensureDir(path.join(context.sdlcRoot, directory));
  }

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
      derived_artifacts: ["indexes", "reports"],
    },
    phase_order: context.config.phase_order,
  };
  writeJsonFile(projectPath, project, { force });

  renderTemplateFile(
    context,
    "kb-readme.md",
    path.join(context.sdlcRoot, "README.md"),
    { PROJECT_NAME: projectName },
    { force },
  );

  writeTextFile(
    path.join(context.sdlcRoot, ".gitignore"),
    ["indexes/*.json", "reports/*.tmp", ""].join("\n"),
    { force: false },
  );

  const createdContracts = [];
  for (const phase of context.config.phase_order) {
    const contract = buildContract(context, phase, {
      id: `contract-${phase}-v1`,
      status: "draft",
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
  const id = String(
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
    validation: normalizeListOption(options.validation),
    allowed_tools: normalizeListOption(options.tool),
    kb_writes: normalizeListOption(options["kb-write"]),
    metrics: normalizeListOption(options.metric),
    model: options.model,
    reasoning: options.reasoning,
    execution_notes: normalizeRawListOption(options["execution-note"]),
  });
  const contractPath = path.join(context.sdlcRoot, "contracts", `${id}.json`);
  writeJsonFile(contractPath, contract, { force: Boolean(options.force) });
  output(
    options,
    { status: "created", contract_path: contractPath, contract },
    [`Created contract ${id} for phase ${phase}`],
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

function readProjectSafe(context) {
  const projectPath = path.join(context.sdlcRoot, "project.json");
  if (!fs.existsSync(projectPath)) {
    return null;
  }
  return readJson(projectPath);
}

function buildContextSources(context, contextFiles) {
  return contextFiles.map((rawPath) => {
    const resolved = path.resolve(context.root, rawPath);
    if (!fs.existsSync(resolved)) {
      fail(`Context file does not exist: ${rawPath}`);
    }
    if (!fs.statSync(resolved).isFile()) {
      fail(`Context path is not a file: ${rawPath}`);
    }
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
  const storyDir = path.join(context.sdlcRoot, "stories", id);
  ensureDir(storyDir);

  const acceptanceCriteria = normalizeListOption(options.acceptance);
  const story = {
    id,
    title,
    schema_version: context.config.schema_version,
    status: String(options.status || "draft"),
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
  const storyDir = path.join(context.sdlcRoot, "stories", id);
  if (!fs.existsSync(path.join(storyDir, "story.json"))) {
    fail(`Story ${id} does not exist. Create it with 'story create' first.`);
  }

  const claimPath = path.join(storyDir, "claim.json");
  if (fs.existsSync(claimPath) && !options.force) {
    const existing = readJson(claimPath);
    if (existing.status === "active" && existing.agent !== agent) {
      fail(`Story ${id} is already claimed by ${existing.agent}. Use --force only after coordination.`);
    }
  }

  const claim = {
    story_id: id,
    agent: String(agent),
    branch: String(options.branch || `feature/${id}`),
    status: "active",
    claimed_at: now(),
    expires_at: options["expires-at"] ? String(options["expires-at"]) : null,
    notes: options.notes ? String(options.notes) : null,
  };
  writeJsonFile(claimPath, claim, { force: true });
  output(options, { status: "claimed", claim_path: claimPath, claim }, [`Claimed story ${id} for ${agent}`]);
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
  const event = {
    id: `TR-${compactTimestamp()}-${crypto.randomBytes(3).toString("hex")}`,
    story_id: storyId,
    type,
    summary,
    actor: String(options.actor || options.agent || process.env.USER || "unknown"),
    evidence: normalizeListOption(options.evidence),
    related: normalizeListOption(options.related),
    created_at: now(),
  };
  appendJsonLine(tracePath, event);
  output(options, { status: "appended", trace_path: tracePath, event }, [`Appended ${type} trace ${event.id}`]);
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
  const indexPath = path.join(context.sdlcRoot, "indexes", "kb-index.json");
  const index = fs.existsSync(indexPath) ? readJson(indexPath) : buildIndex(context);
  const terms = tokenize(query);
  const results = index.entries
    .map((entry) => ({ entry, score: scoreEntry(entry, terms) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  output(
    options,
    { query, results },
    results.length
      ? results.map(({ entry, score }) => `${score.toFixed(2)} ${entry.path}: ${entry.snippet}`)
      : [`No KB results for '${query}'`],
  );
}

function gateCheck(context, options) {
  ensureInitialized(context);
  const report = {
    status: "passed",
    checked_at: now(),
    root: context.root,
    errors: [],
    warnings: [],
    checked: [],
  };

  validateProject(context, report);
  validateContracts(context, report);

  if (options.story) {
    validateStory(context, normalizeId(String(options.story)), report);
  } else {
    const storiesRoot = path.join(context.sdlcRoot, "stories");
    for (const entry of safeReadDir(storiesRoot)) {
      const storyJson = path.join(storiesRoot, entry, "story.json");
      if (fs.existsSync(storyJson)) {
        validateStory(context, entry, report);
      }
    }
  }

  if (report.errors.length > 0) {
    report.status = "failed";
    process.exitCode = 1;
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

function validateContracts(context, report) {
  const contractsRoot = path.join(context.sdlcRoot, "contracts");
  const files = safeReadDir(contractsRoot).filter((name) => name.endsWith(".json"));
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
    }
    validateExecutionPolicy(context, contract, label, report);
    report.checked.push(label);
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
    }
  }
  if (story.contract_id) {
    const contractPath = path.join(context.sdlcRoot, "contracts", `${story.contract_id}.json`);
    if (!fs.existsSync(contractPath)) {
      report.errors.push(`Story ${storyId} references missing contract ${story.contract_id}`);
    }
  } else {
    report.warnings.push(`Story ${storyId} has no contract_id`);
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
  const entries = [];
  for (const filePath of walkFiles(context.sdlcRoot)) {
    const relativePath = path.relative(context.root, filePath);
    const sdlcRelative = path.relative(context.sdlcRoot, filePath);
    if (sdlcRelative.startsWith(`indexes${path.sep}`)) {
      continue;
    }
    const extension = path.extname(filePath);
    if (!context.config.indexable_extensions.includes(extension)) {
      continue;
    }
    const raw = fs.readFileSync(filePath, "utf8");
    const text = normalizeText(raw);
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
    entries,
  };
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
  if (fs.existsSync(filePath) && !options.force) {
    return false;
  }
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content);
  return true;
}

function appendJsonLine(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`);
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
    const stat = fs.statSync(fullPath);
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

function normalizeId(value) {
  return String(value).trim().replace(/\s+/g, "-");
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
      [--model model-id] [--reasoning inherit|minimal|low|medium|high]
  agentic-sdlc story create --id ST-001 --title title [--acceptance text]
  agentic-sdlc story claim --id ST-001 --agent name [--branch branch]
  agentic-sdlc trace append --type decision --summary text [--story ST-001]
  agentic-sdlc gate check [--story ST-001] [--json]
  agentic-sdlc index rebuild
  agentic-sdlc kb search <query>
  agentic-sdlc status

Global options:
  --root path            Target project root. Defaults to current directory.
  --template-dir path    Template directory. Defaults to this plugin's templates.
  --json                 Print JSON output where supported.
  --force                Overwrite generated files where supported.

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

Contract execution policy options:
  --model model-id       Override the Codex model for agents using this contract.
                         Omit or pass "inherit" to reuse the main thread model.
  --reasoning level      Override agent reasoning level. Defaults to "inherit".
                         Built-in levels: inherit, minimal, low, medium, high.
  --execution-note text  Record a note about model or reasoning selection.
                         Repeatable.

Principle:
  The plugin is stateless. Contracts, traces, and KB artifacts are written only
  to the target project's .sdlc directory.
`);
}

main();
