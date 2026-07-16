import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

import {
  computeStableHash,
  DomainValidationError,
  immutableJson,
  requireNonEmptyString,
  requirePlainRecord,
} from "./canonical.mjs";

export const RTK_ADAPTER_ID = "rtk";
export const RTK_GAIN_CONTRACT = "rtk-gain:v0.43+";
export const RTK_MINIMUM_VERSION = "0.43.0";
export const RTK_SAVINGS_CLASSIFICATION = "estimated";
export const RTK_ENFORCEMENT_CLASSIFICATION = "advisory";

const DEFAULT_EXECUTABLE = "rtk";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
const SAFE_TEXT_PATTERN = /^[^\u0000-\u001f\u007f]+$/u;
const SUPPORTED_PROFILES = new Set(["auto", "native", "test", "git", "rg"]);
const SAFE_GIT_SUBCOMMANDS = new Set(["status", "diff", "log", "show", "shortlog"]);
const SAFE_GATEWAY_EXECUTABLES = new Set(["npm", "pnpm", "yarn", "bun", "node", "pytest", "jest", "vitest", "git", "rg"]);
const execFile = promisify(execFileCallback);

export class RtkExecutionError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "RtkExecutionError";
    this.code = options.code || "rtk_execution_failed";
    this.exit_code = options.exit_code ?? null;
    this.stderr = options.stderr || "";
  }
}

export function parseRtkVersion(output, minimumVersion = RTK_MINIMUM_VERSION) {
  const raw = normalizeSafeText(output, "rtk_version_output", 512);
  const match = raw.match(/^rtk\s+v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/iu);
  if (!match) {
    throw new DomainValidationError("RTK version output does not match the expected 'rtk <semver>' identity");
  }
  const coreVersion = `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`;
  const prerelease = match[4] || null;
  const version = `${coreVersion}${prerelease ? `-${prerelease}` : ""}`;
  const minimum = effectiveMinimumVersion(minimumVersion);
  const current = parseSemanticVersion(coreVersion, "rtk_version");
  const comparison = compareSemanticVersions(current, minimum);
  const supported = comparison > 0 || (comparison === 0 && prerelease === null);
  return immutableJson({
    version,
    major: current.major,
    minor: current.minor,
    patch: current.patch,
    minimum_version: minimum.version,
    supported,
    gain_contract: supported ? RTK_GAIN_CONTRACT : null,
  });
}

export function buildRtkGainArgv() {
  return Object.freeze(["gain", "--project", "--format", "json"]);
}

export function normalizeRtkGainReport(value) {
  requirePlainRecord(value, "rtk_gain_report");
  const summary = requirePlainRecord(value.summary, "rtk_gain_report.summary");
  const totalCommands = normalizeNonNegativeInteger(summary.total_commands, "rtk_gain_report.summary.total_commands");
  const totalInput = normalizeNonNegativeInteger(summary.total_input, "rtk_gain_report.summary.total_input");
  const totalOutput = normalizeNonNegativeInteger(summary.total_output, "rtk_gain_report.summary.total_output");
  const totalSaved = normalizeNonNegativeInteger(summary.total_saved, "rtk_gain_report.summary.total_saved");
  const savingsPercent = normalizePercentage(summary.avg_savings_pct, "rtk_gain_report.summary.avg_savings_pct");
  const totalTimeMs = normalizeOptionalNonNegativeNumber(summary.total_time_ms, "rtk_gain_report.summary.total_time_ms");
  const averageTimeMs = normalizeOptionalNonNegativeNumber(summary.avg_time_ms, "rtk_gain_report.summary.avg_time_ms");
  return immutableJson({
    total_commands: totalCommands,
    estimated_input_tokens: totalInput,
    estimated_output_tokens: totalOutput,
    estimated_tokens_avoided: totalSaved,
    estimated_savings_percent: savingsPercent,
    total_time_ms: totalTimeMs,
    average_time_ms: averageTimeMs,
  });
}

export async function detectRtk(options = {}) {
  const execution = normalizeExecutionOptions(options);
  const minimumVersion = normalizeMinimumVersion(options.minimum_version);
  try {
    const result = await execution.executor(
      execution.executable,
      [...execution.prefix_args, "--version"],
      execution.process_options,
    );
    const parsed = parseRtkVersion(normalizeProcessOutput(result?.stdout), minimumVersion);
    return immutableJson({
      available: true,
      executable: execution.executable,
      ...parsed,
      reason: parsed.supported ? null : "version_below_minimum",
    });
  } catch (error) {
    if (error instanceof DomainValidationError) {
      return immutableJson({
        available: true,
        supported: false,
        executable: execution.executable,
        version: null,
        minimum_version: minimumVersion,
        gain_contract: null,
        reason: "unrecognized_version",
      });
    }
    return immutableJson({
      available: false,
      supported: false,
      executable: execution.executable,
      version: null,
      minimum_version: minimumVersion,
      gain_contract: null,
      reason: error?.code === "ENOENT" ? "not_found" : "execution_failed",
    });
  }
}

export async function collectRtkOptimizationTelemetry(options = {}) {
  const execution = normalizeExecutionOptions(options);
  const sourceCommand = Object.freeze([
    execution.executable,
    ...execution.prefix_args,
    ...buildRtkGainArgv(),
  ]);
  const unavailableSource = immutableJson({
    command: sourceCommand,
    shell: false,
    report_hash: null,
  });
  const detection = await detectRtk({
    ...options,
    executable: execution.executable,
    prefix_args: execution.prefix_args,
    executor: execution.executor,
  });
  if (!detection.available || !detection.supported) {
    return immutableJson({
      provider: RTK_ADAPTER_ID,
      status: detection.available ? "unsupported" : "unavailable",
      detection,
      classification: RTK_SAVINGS_CLASSIFICATION,
      enforcement: RTK_ENFORCEMENT_CLASSIFICATION,
      trusted_exact: false,
      scope: "project_cumulative",
      usage_credit_tokens: 0,
      source: unavailableSource,
      savings: null,
    });
  }
  let result;
  try {
    result = await execution.executor(
      execution.executable,
      [...execution.prefix_args, ...buildRtkGainArgv()],
      execution.process_options,
    );
  } catch (error) {
    throw new RtkExecutionError(`RTK gain collection failed for '${execution.executable}'`, {
      cause: error,
      code: error?.code === "ENOENT" ? "rtk_not_found" : "rtk_gain_failed",
      exit_code: error?.code ?? null,
      stderr: normalizeProcessOutput(error?.stderr),
    });
  }
  const stdout = normalizeProcessOutput(result?.stdout);
  let report;
  try {
    report = JSON.parse(stdout);
  } catch (error) {
    throw new RtkExecutionError("RTK gain output is not valid JSON", {
      cause: error,
      code: "invalid_rtk_gain_json",
      stderr: normalizeProcessOutput(result?.stderr),
    });
  }
  const savings = normalizeRtkGainReport(report);
  const source = immutableJson({
    command: sourceCommand,
    shell: false,
    report_hash: computeStableHash(report),
  });
  return immutableJson({
    provider: RTK_ADAPTER_ID,
    status: "operational",
    detection,
    classification: RTK_SAVINGS_CLASSIFICATION,
    enforcement: RTK_ENFORCEMENT_CLASSIFICATION,
    trusted_exact: false,
    scope: "project_cumulative",
    usage_credit_tokens: 0,
    source,
    savings,
  });
}

export function routeRtkCommand(command, options = {}) {
  const normalizedCommand = normalizeCommandVector(command);
  const profile = normalizeProfile(options.profile);
  const executableToken = normalizedCommand[0];
  const executableName = normalizeGatewayExecutable(executableToken);
  const allowedProfile = inferAllowedProfile(executableName, normalizedCommand);
  if (!allowedProfile) {
    throw new DomainValidationError(
      "The optimization gateway accepts only fixed test commands, read-only Git status/diff/log/show/shortlog, and rg searches without external preprocessors",
    );
  }
  const executionCommand = buildExecutionCommand(executableName, normalizedCommand);
  if (options.exact === true || profile === "native") {
    return immutableJson({
      mode: "native",
      profile: "native",
      command: normalizedCommand,
      execution_command: executionCommand,
      rtk_arguments: null,
      reason: options.exact === true ? "exact_output_requested" : "native_profile_requested",
    });
  }
  const selected = profile === "auto" ? inferProfile(executableName, normalizedCommand.slice(1)) : profile;
  if (selected === "native") {
    return immutableJson({
      mode: "native",
      profile: "native",
      command: normalizedCommand,
      execution_command: executionCommand,
      rtk_arguments: null,
      reason: "no_safe_filter_route",
    });
  }
  const rtkArguments = buildProfileArguments(selected, executableName, normalizedCommand);
  return immutableJson({
    mode: "rtk",
    profile: selected,
    command: normalizedCommand,
    execution_command: executionCommand,
    rtk_arguments: rtkArguments,
    reason: profile === "auto" ? "automatic_supported_route" : "explicit_profile",
  });
}

function buildExecutionCommand(executableName, command) {
  if (executableName === "rg") {
    return Object.freeze([command[0], "--no-config", ...command.slice(1)]);
  }
  if (executableName === "git" && ["diff", "log", "show"].includes(command[1])) {
    return Object.freeze([
      command[0],
      command[1],
      "--no-ext-diff",
      "--no-textconv",
      ...command.slice(2),
    ]);
  }
  return Object.freeze([...command]);
}

function inferProfile(executableName, args) {
  if (executableName === "git") return isSafeGitCommand([executableName, ...args]) ? "git" : "native";
  if (executableName === "rg") return isSafeRgCommand([executableName, ...args]) ? "rg" : "native";
  if (isSafeFixedTestCommand(executableName, [executableName, ...args])) return "test";
  return "native";
}

function inferAllowedProfile(executableName, command) {
  if (executableName === "git") return isExecutionSafeGitCommand(command) ? "git" : null;
  if (executableName === "rg") return isExecutionSafeRgCommand(command) ? "rg" : null;
  return isSafeFixedTestCommand(executableName, command) ? "test" : null;
}

function buildProfileArguments(profile, executableName, command) {
  if (profile === "git" || profile === "rg") {
    if (executableName !== profile) {
      throw new DomainValidationError(`RTK profile '${profile}' requires a ${profile} command`);
    }
    if (profile === "git" && !isSafeGitCommand(command)) {
      throw new DomainValidationError("RTK git routing accepts only read-only status, diff, log, show, and shortlog commands");
    }
    if (profile === "rg" && !isSafeRgCommand(command)) {
      throw new DomainValidationError("RTK rg routing does not accept machine-readable JSON or NUL-delimited output");
    }
    if (profile === "rg") {
      // RIPGREP_CONFIG_PATH can add --pre or --search-zip without those flags
      // appearing in the caller's argv. The CLI override keeps the route closed.
      return Object.freeze([profile, ...buildExecutionCommand(executableName, command).slice(1)]);
    }
    return Object.freeze([profile, ...buildExecutionCommand(executableName, command).slice(1)]);
  }
  assertSafeFixedTestCommand(executableName, command);
  return Object.freeze([profile, command[0], ...command.slice(1)]);
}

function isSafeGitCommand(command) {
  if (!isExecutionSafeGitCommand(command)) return false;
  const args = command.slice(2);
  const machineOutputFlags = [
    "-z", "--porcelain", "--raw", "--patch-with-raw", "--numstat", "--name-only",
    "--name-status", "--binary", "--format", "--pretty",
  ];
  return !args.some((arg) => (
    machineOutputFlags.some((flag) => arg === flag || arg.startsWith(`${flag}=`))
    || isCombinedShortFlag(arg, "z")
  ));
}

function isExecutionSafeGitCommand(command) {
  const subcommand = command[1];
  if (!SAFE_GIT_SUBCOMMANDS.has(subcommand)) return false;
  const args = command.slice(2);
  const sideEffectFlags = ["--output"];
  return !args.some((arg) => (
    sideEffectFlags.some((flag) => arg === flag || arg.startsWith(`${flag}=`))
    // Git's parse-options accepts unambiguous long-option abbreviations. Reject
    // every prefix it can expand to an external diff or text-conversion hook.
    || arg.startsWith("--ext")
    || arg.startsWith("--textc")
    // Signature display and %G pretty placeholders invoke the configured GPG
    // verifier, which is outside this fixed read-only command boundary.
    || arg.startsWith("--show-s")
    || ((arg.startsWith("--for") || arg.startsWith("--prett")) && arg.includes("%G"))
  )) && !args.some((arg, index) => (
    arg.includes("%G")
    && index > 0
    && ["--format", "--pretty"].includes(args[index - 1])
  ));
}

function isSafeRgCommand(command) {
  if (!isExecutionSafeRgCommand(command)) return false;
  const args = command.slice(1);
  const machineOutputFlags = ["--json", "--null", "--null-data", "--vimgrep"];
  return !args.some((arg) => machineOutputFlags.includes(arg) || isCombinedShortFlag(arg, "0"));
}

function isExecutionSafeRgCommand(command) {
  const args = command.slice(1);
  const externalProcessFlags = ["--pre", "--hostname-bin", "--search-zip"];
  return !args.some((arg) => (
    externalProcessFlags.some((flag) => arg === flag || arg.startsWith(`${flag}=`))
    || isCombinedShortFlag(arg, "z")
  ));
}

function isCombinedShortFlag(argument, flag) {
  return /^-[^-]/u.test(argument) && argument.slice(1).includes(flag);
}

function assertSafeFixedTestCommand(executableName, command) {
  if (isSafeFixedTestCommand(executableName, command)) return;
  throw new DomainValidationError(
    "RTK test routing accepts only fixed test commands (npm test, npm run test, pnpm/yarn/bun test, node --test, pytest, jest, or vitest)",
  );
}

function isSafeFixedTestCommand(executableName, command) {
  const args = command.slice(1);
  return (
    executableName === "npm" && (args.length === 1 && args[0] === "test" || args.length === 2 && args[0] === "run" && args[1] === "test")
  ) || (
    ["pnpm", "yarn", "bun"].includes(executableName) && args.length === 1 && args[0] === "test"
  ) || (
    executableName === "node" && args.length === 1 && args[0] === "--test"
  ) || (
    ["pytest", "jest", "vitest"].includes(executableName) && args.length === 0
  );
}

function normalizeCommandVector(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new DomainValidationError("optimization command must be a non-empty JSON array");
  }
  if (value.length > 128) {
    throw new DomainValidationError("optimization command cannot contain more than 128 arguments");
  }
  return Object.freeze(value.map((item, index) => normalizeCommandArgument(item, index)));
}

function normalizeCommandArgument(value, index) {
  if (typeof value !== "string") {
    throw new DomainValidationError(`optimization_command[${index}] must be a string`);
  }
  if (value.length > 4096 || (value !== "" && !SAFE_TEXT_PATTERN.test(value))) {
    throw new DomainValidationError(`optimization_command[${index}] contains unsupported characters or exceeds 4096 characters`);
  }
  if (index === 0 && value.length === 0) {
    throw new DomainValidationError("optimization_command[0] must be a non-empty executable name");
  }
  return value;
}

function normalizeGatewayExecutable(value) {
  const token = value.toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]*(?:\.(?:exe|cmd|bat))?$/u.test(token)) {
    throw new DomainValidationError("optimization command executable must be a bare command name without a path or shell metacharacters");
  }
  const executableName = token.replace(/\.(?:exe|cmd|bat)$/u, "");
  if (!SAFE_GATEWAY_EXECUTABLES.has(executableName)) {
    throw new DomainValidationError(`Unsupported optimization command executable '${value}'`);
  }
  return executableName;
}

function normalizeProfile(value) {
  const profile = value === undefined || value === null ? "auto" : requireNonEmptyString(String(value), "optimization_profile").toLowerCase();
  if (!SUPPORTED_PROFILES.has(profile)) {
    throw new DomainValidationError(`Unsupported optimization profile '${profile}'`);
  }
  return profile;
}

function normalizeExecutionOptions(options) {
  requirePlainRecord(options, "rtk_execution_options");
  const executable = normalizeSafeText(options.executable ?? DEFAULT_EXECUTABLE, "rtk_execution_options.executable", 4096);
  const prefixArgs = options.prefix_args ?? [];
  if (!Array.isArray(prefixArgs)) {
    throw new DomainValidationError("rtk_execution_options.prefix_args must be an array");
  }
  const normalizedPrefixArgs = prefixArgs.map((value, index) => normalizeSafeText(value, `rtk_execution_options.prefix_args[${index}]`, 4096));
  const timeout = normalizeBoundedInteger(options.timeout_ms ?? DEFAULT_TIMEOUT_MS, "rtk_execution_options.timeout_ms", 1, MAX_TIMEOUT_MS);
  const maxBuffer = normalizeBoundedInteger(options.max_output_bytes ?? DEFAULT_MAX_OUTPUT_BYTES, "rtk_execution_options.max_output_bytes", 1024, MAX_OUTPUT_BYTES);
  const cwd = options.cwd === undefined ? process.cwd() : normalizeSafeText(options.cwd, "rtk_execution_options.cwd", 4096);
  const executor = options.executor ?? execFile;
  if (typeof executor !== "function") {
    throw new DomainValidationError("rtk_execution_options.executor must be a function");
  }
  return {
    executable,
    prefix_args: Object.freeze(normalizedPrefixArgs),
    executor,
    process_options: Object.freeze({ cwd, encoding: "utf8", timeout, maxBuffer, shell: false, windowsHide: true }),
  };
}

function normalizeMinimumVersion(value) {
  return effectiveMinimumVersion(value ?? RTK_MINIMUM_VERSION).version;
}

function effectiveMinimumVersion(value) {
  const configured = parseSemanticVersion(value ?? RTK_MINIMUM_VERSION, "rtk_minimum_version");
  const floor = parseSemanticVersion(RTK_MINIMUM_VERSION, "rtk_contract_minimum_version");
  return compareSemanticVersions(configured, floor) >= 0 ? configured : floor;
}

function parseSemanticVersion(value, label) {
  const raw = requireNonEmptyString(String(value), label);
  const match = raw.match(/^(\d+)\.(\d+)\.(\d+)$/u);
  if (!match) throw new DomainValidationError(`${label} must be a semantic version such as 0.43.0`);
  return { version: `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`, major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function compareSemanticVersions(left, right) {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

function normalizeNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new DomainValidationError(`${label} must be a non-negative safe integer`);
  return value;
}

function normalizePercentage(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new DomainValidationError(`${label} must be a finite percentage from 0 to 100`);
  }
  return value;
}

function normalizeOptionalNonNegativeNumber(value, label) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new DomainValidationError(`${label} must be a finite non-negative number when provided`);
  }
  return value;
}

function normalizeBoundedInteger(value, label, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new DomainValidationError(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function normalizeSafeText(value, label, maximumLength) {
  const normalized = requireNonEmptyString(String(value ?? ""), label);
  if (normalized.length > maximumLength || !SAFE_TEXT_PATTERN.test(normalized)) {
    throw new DomainValidationError(`${label} contains unsupported characters or exceeds ${maximumLength} characters`);
  }
  return normalized;
}

function normalizeProcessOutput(value) {
  if (value === undefined || value === null) return "";
  return Buffer.isBuffer(value) ? value.toString("utf8") : String(value);
}
