import test from "node:test";
import assert from "node:assert/strict";

import {
  RTK_GAIN_CONTRACT,
  RTK_MINIMUM_VERSION,
  buildRtkGainArgv,
  collectRtkOptimizationTelemetry,
  detectRtk,
  normalizeRtkGainReport,
  parseRtkVersion,
  routeRtkCommand,
} from "../../lib/rtk-optimization-adapter.mjs";

function gainReport(overrides = {}) {
  return {
    summary: {
      total_commands: 17,
      total_input: 15_052,
      total_output: 4_094,
      total_saved: 10_977,
      avg_savings_pct: 72.9271857560457,
      total_time_ms: 256_724,
      avg_time_ms: 15_101,
      ...overrides,
    },
  };
}

test("RTK identity is strict and the adapter floor cannot be configured below 0.43.0", async () => {
  const supported = parseRtkVersion("rtk 0.43.0");
  assert.equal(supported.version, "0.43.0");
  assert.equal(supported.minimum_version, RTK_MINIMUM_VERSION);
  assert.equal(supported.supported, true);
  assert.equal(supported.gain_contract, RTK_GAIN_CONTRACT);

  assert.equal(parseRtkVersion("rtk v0.44.1+build.7").supported, true);
  assert.throws(
    () => parseRtkVersion("other-tool 0.43.0"),
    /expected 'rtk <semver>' identity/u,
  );
  assert.throws(
    () => parseRtkVersion("RTK ready: 0.43.0"),
    /expected 'rtk <semver>' identity/u,
  );

  const belowHardFloor = parseRtkVersion("rtk 0.42.99", "0.1.0");
  assert.equal(belowHardFloor.supported, false);
  assert.equal(belowHardFloor.gain_contract, null);
  assert.equal(parseRtkVersion("rtk 0.43.0-rc.1").supported, false);

  const detected = await detectRtk({
    minimum_version: "0.1.0",
    executor: async () => ({ stdout: "rtk 0.42.99\n", stderr: "" }),
  });
  assert.equal(detected.available, true);
  assert.equal(detected.supported, false);
});

test("gain counters are independent estimates rather than an input minus output identity", () => {
  const normalized = normalizeRtkGainReport(gainReport());
  assert.deepEqual(normalized, {
    total_commands: 17,
    estimated_input_tokens: 15_052,
    estimated_output_tokens: 4_094,
    estimated_tokens_avoided: 10_977,
    estimated_savings_percent: 72.9271857560457,
    total_time_ms: 256_724,
    average_time_ms: 15_101,
  });
  assert.notEqual(
    normalized.estimated_tokens_avoided,
    normalized.estimated_input_tokens - normalized.estimated_output_tokens,
  );

  const expandedFailureOutput = normalizeRtkGainReport(gainReport({
    total_commands: 1,
    total_input: 3,
    total_output: 10,
    total_saved: 0,
    avg_savings_pct: 0,
  }));
  assert.equal(expandedFailureOutput.estimated_input_tokens, 3);
  assert.equal(expandedFailureOutput.estimated_output_tokens, 10);
  assert.equal(expandedFailureOutput.estimated_tokens_avoided, 0);
});

test("telemetry collection uses a shell-free configured command and preserves source provenance", async () => {
  const calls = [];
  const report = gainReport();
  const executable = process.execPath;
  const prefixArgs = ["/opt/rtk/rtk-entry.mjs"];
  const executor = async (actualExecutable, argv, options) => {
    calls.push({ executable: actualExecutable, argv: [...argv], options });
    assert.equal(options.shell, false);
    assert.equal(options.cwd, "/workspace/travelops");
    if (argv.at(-1) === "--version") {
      return { stdout: "rtk 0.43.0\n", stderr: "" };
    }
    return { stdout: JSON.stringify(report), stderr: "" };
  };

  assert.deepEqual(buildRtkGainArgv(), ["gain", "--project", "--format", "json"]);
  const telemetry = await collectRtkOptimizationTelemetry({
    executable,
    prefix_args: prefixArgs,
    executor,
    cwd: "/workspace/travelops",
  });

  assert.equal(telemetry.status, "operational");
  assert.equal(telemetry.classification, "estimated");
  assert.equal(telemetry.enforcement, "advisory");
  assert.equal(telemetry.trusted_exact, false);
  assert.equal(telemetry.usage_credit_tokens, 0);
  assert.deepEqual(telemetry.source.command, [executable, ...prefixArgs, ...buildRtkGainArgv()]);
  assert.equal(telemetry.source.shell, false);
  assert.deepEqual(calls.map(({ argv }) => argv), [
    [...prefixArgs, "--version"],
    [...prefixArgs, ...buildRtkGainArgv()],
  ]);

  assert.match(telemetry.source.report_hash, /^[a-f0-9]{64}$/u);
});

test("automatic routing optimizes safe vectors, preserves machine output natively, and rejects other commands", () => {
  assert.deepEqual(routeRtkCommand(["npm", "test"]), {
    mode: "rtk",
    profile: "test",
    command: ["npm", "test"],
    execution_command: ["npm", "test"],
    rtk_arguments: ["test", "npm", "test"],
    reason: "automatic_supported_route",
  });
  assert.deepEqual(routeRtkCommand(["git", "status", "--short"]), {
    mode: "rtk",
    profile: "git",
    command: ["git", "status", "--short"],
    execution_command: ["git", "status", "--short"],
    rtk_arguments: ["git", "status", "--short"],
    reason: "automatic_supported_route",
  });
  const rg = routeRtkCommand(["rg", "needle", "lib"]);
  assert.equal(rg.profile, "rg");
  assert.deepEqual(rg.rtk_arguments, ["rg", "--no-config", "needle", "lib"]);

  const gitDiff = routeRtkCommand(["git", "diff", "README.md"]);
  assert.deepEqual(gitDiff.rtk_arguments, [
    "git", "diff", "--no-ext-diff", "--no-textconv", "README.md",
  ]);
  const gitLog = routeRtkCommand(["git", "log", "--oneline"]);
  assert.deepEqual(gitLog.rtk_arguments, [
    "git", "log", "--no-ext-diff", "--no-textconv", "--oneline",
  ]);

  for (const command of [
    ["git", "log", "--format=%H"],
    ["rg", "needle", "--json"],
    ["rg", "needle", "-0l"],
    ["rg", "needle", "--vimgrep"],
  ]) {
    const route = routeRtkCommand(command);
    assert.equal(route.mode, "native", JSON.stringify(command));
    assert.equal(route.profile, "native", JSON.stringify(command));
    assert.deepEqual(route.command, command);
    if (command[0] === "rg") assert.equal(route.execution_command[1], "--no-config");
    if (command[0] === "git") {
      assert.deepEqual(route.execution_command.slice(2, 4), ["--no-ext-diff", "--no-textconv"]);
    }
    assert.equal(route.rtk_arguments, null);
  }

  for (const command of [
    ["node", "--test", "test/unit/example.test.mjs"],
    ["pytest", "-q"],
    ["npm", "run", "test", "--", "--watch"],
    ["node", "--version"],
    ["git", "push", "origin", "main"],
    ["git", "diff", "--output=/tmp/unsafe.patch"],
    ["git", "diff", "--no-index", "--ext", "/dev/null", "README.md"],
    ["git", "diff", "--no-index", "--ext-d", "/dev/null", "README.md"],
    ["git", "diff", "--no-index", "--textc", "/dev/null", "README.md"],
    ["git", "show", "--show-signature"],
    ["git", "log", "--format=%G?"],
    ["git", "log", "--pretty", "%GS"],
    ["rg", "needle", "--pre", "printf unsafe"],
    ["rg", "needle", "--hostname-bin=printf"],
    ["rg", "needle", "--search-zip"],
    ["rg", "needle", "-zi"],
  ]) {
    assert.throws(() => routeRtkCommand(command), /accepts only|gateway/iu, JSON.stringify(command));
  }

  assert.equal(routeRtkCommand(["git", "diff", "--no-ext-diff", "--no-textconv"]).profile, "git");
  assert.equal(routeRtkCommand(["rg", "needle", "--no-search-zip", "--no-pre"]).profile, "rg");

  const exact = routeRtkCommand(["git", "show", "--format=raw"], { exact: true });
  assert.equal(exact.mode, "native");
  assert.equal(exact.reason, "exact_output_requested");
  assert.deepEqual(exact.execution_command, [
    "git", "show", "--no-ext-diff", "--no-textconv", "--format=raw",
  ]);

  const preserved = routeRtkCommand(["rg", "  padded  ", ""], { exact: true });
  assert.deepEqual(preserved.command, ["rg", "  padded  ", ""]);
  assert.deepEqual(preserved.execution_command, ["rg", "--no-config", "  padded  ", ""]);
});

test("an explicitly requested unsafe test profile is rejected instead of invoking a shell-like wrapper", () => {
  assert.throws(
    () => routeRtkCommand(["node", "--test", "test/unit/example.test.mjs"], { profile: "test" }),
    /accepts only fixed test commands/u,
  );
  assert.throws(
    () => routeRtkCommand(["pytest", "-q"], { profile: "test" }),
    /accepts only fixed test commands/u,
  );
  assert.throws(
    () => routeRtkCommand(["git", "commit", "-m", "message"], { profile: "git" }),
    /read-only/u,
  );
  assert.throws(
    () => routeRtkCommand(["rg", "needle", "--json"], { profile: "rg" }),
    /machine-readable/u,
  );
  assert.throws(
    () => routeRtkCommand(["/missing; printf INJECT >&2; /tmp/npm", "test"]),
    /bare command name/u,
  );
});

test("Windows command shims normalize to the same safe RTK routes", () => {
  const npm = routeRtkCommand(["npm.cmd", "test"]);
  assert.equal(npm.mode, "rtk");
  assert.equal(npm.profile, "test");
  assert.deepEqual(npm.rtk_arguments, ["test", "npm.cmd", "test"]);

  const git = routeRtkCommand(["git.exe", "status", "--short"]);
  assert.equal(git.mode, "rtk");
  assert.equal(git.profile, "git");
  assert.deepEqual(git.rtk_arguments, ["git", "status", "--short"]);
});
