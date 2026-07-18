import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  CLI_PRESET_ALLOWED_OPTIONS,
  CliPresetError,
  exportCliPresets,
  listCliPresets,
  resolveCliPresets,
  showCliPreset,
} from "../../lib/cli/presets.mjs";

test("built-in presets are immutable, sorted, and presentation-only", () => {
  const presets = listCliPresets();
  assert.deepEqual(presets.map((entry) => entry.id), ["diagnostic", "human-en", "human-it", "machine", "no-browser"]);
  assert.deepEqual(CLI_PRESET_ALLOWED_OPTIONS, ["full", "json", "locale", "no-open"]);
  assert.equal(Object.isFrozen(presets), true);
  assert.equal(Object.isFrozen(presets[0].options), true);

  const italian = showCliPreset("human-it");
  assert.deepEqual(italian.options, { locale: "it" });
  assert.equal(Object.isFrozen(italian), true);
  assert.throws(() => showCliPreset("missing"), (error) => error instanceof CliPresetError && error.code === "UNKNOWN_CLI_PRESET");
});

test("later presets override earlier ones and explicit CLI options win last", () => {
  const resolved = resolveCliPresets(["human-en", "human-it", "machine", "diagnostic"], {
    explicitOptions: { json: false, view: "business", limit: 7, preset: "technical-assessment" },
  });
  assert.deepEqual(resolved.preset_options, { full: true, json: true, locale: "it" });
  assert.deepEqual(resolved.options, {
    locale: "it",
    json: false,
    full: true,
    view: "business",
    limit: 7,
    preset: "technical-assessment",
  });
  assert.equal(resolved.options.preset, "technical-assessment", "existing --preset remains an explicit unrelated option");
});

test("@JSON presets resolve relative to cwd without leaking their path", () => {
  const cwd = path.resolve("/workspace/project");
  const expectedPath = path.resolve(cwd, "presets/team.json");
  const file = JSON.stringify({
    schema_version: "agentic-sdlc-cli-preset-v1",
    name: "team",
    description: "Presentation settings only",
    options: { locale: "it", json: true, full: true },
  });
  const resolved = resolveCliPresets("@presets/team.json", {
    cwd,
    readFile(actualPath) {
      assert.equal(actualPath, expectedPath);
      return file;
    },
  });
  assert.deepEqual(resolved.preset_options, { full: true, json: true, locale: "it" });
  assert.equal(resolved.applied[0].source, "file");
  assert.match(resolved.applied[0].id, /^file:[a-f0-9]{12}$/u);
  assert.doesNotMatch(JSON.stringify(resolved), /workspace|team\.json/u);
});

test("preset export is deterministic, path-free, and directly reimportable", () => {
  const readFile = () => JSON.stringify({ options: { full: true, "no-open": true } });
  const first = exportCliPresets(["human-it", "@team.json"], { cwd: "/one", readFile });
  const second = exportCliPresets(["human-it", "@team.json"], { cwd: "/two", readFile });
  assert.equal(first, second);
  assert.doesNotMatch(first, /created|timestamp|\/one|\/two|team\.json/iu);
  assert.deepEqual(JSON.parse(first), {
    schema_version: "agentic-sdlc-cli-preset-v1",
    options: { full: true, locale: "it", "no-open": true },
  });

  const imported = resolveCliPresets("@exported.json", { readFile: () => first });
  assert.deepEqual(imported.preset_options, { full: true, locale: "it", "no-open": true });
  assert.equal(exportCliPresets("@exported.json", { readFile: () => first }), first);
});

test("file presets fail closed for protected, mutating, authority, scope, path, and command options", () => {
  const forbidden = [
    "apply",
    "force",
    "root",
    "out",
    "authorization",
    "approval-source",
    "confirm-action",
    "allow-action",
    "merge-allowed",
    "receipt",
    "actor",
    "write-path",
    "command",
    "preset",
    "view",
    "limit",
  ];
  for (const option of forbidden) {
    assert.throws(
      () => resolveCliPresets("@unsafe.json", { readFile: () => JSON.stringify({ [option]: true }) }),
      (error) => error instanceof CliPresetError && error.code === "UNSAFE_CLI_PRESET_OPTION" && error.details.option === option,
      option,
    );
  }
});

test("preset values and envelopes are strictly validated", () => {
  const cases = [
    [{ locale: "fr" }, "INVALID_CLI_PRESET_VALUE"],
    [{ json: "yes" }, "INVALID_CLI_PRESET_VALUE"],
  ];
  for (const [body, code] of cases) {
    assert.throws(
      () => resolveCliPresets("@invalid.json", { readFile: () => JSON.stringify(body) }),
      (error) => error instanceof CliPresetError && error.code === code,
    );
  }
  assert.throws(
    () => resolveCliPresets("@invalid.json", { readFile: () => JSON.stringify({ schema_version: "v0", options: {} }) }),
    (error) => error.code === "UNSUPPORTED_CLI_PRESET_SCHEMA",
  );
  assert.throws(
    () => resolveCliPresets("@invalid.json", { readFile: () => "{" }),
    (error) => error.code === "INVALID_CLI_PRESET_JSON",
  );
});

test("prototype-pollution keys and oversized files cannot enter preset options", () => {
  assert.throws(
    () => resolveCliPresets("@unsafe.json", { readFile: () => '{"__proto__":{"polluted":true}}' }),
    (error) => error.code === "UNSAFE_CLI_PRESET_OPTION",
  );
  assert.equal({}.polluted, undefined);
  assert.throws(
    () => resolveCliPresets("@large.json", { readFile: () => " ".repeat(64 * 1024 + 1) }),
    (error) => error.code === "CLI_PRESET_TOO_LARGE",
  );
});
