import assert from "node:assert/strict";
import test from "node:test";

import { buildHelpModel, renderHelp, UnknownCommandError } from "../../lib/cli/help.mjs";

const FORBIDDEN_PRIMARY_JARGON = /\b(?:bounded-autonomous|checkpointed|checkpoint|audit_only|host_verified|profile|receipt|ceiling|schema|hash)\b/iu;

test("root help explains practical behavior before technical details", () => {
  const output = renderHelp([], { locale: "en", version: "0.11.0" });
  const [primary, technical] = output.split("Technical details (optional):");
  assert.match(output, /^Outcome:/u);
  assert.match(primary, /Outcome:/u);
  assert.match(primary, /What this changes in practice:/u);
  assert.match(primary, /What you need to decide:/u);
  assert.match(primary, /What remains protected:/u);
  assert.match(primary, /Next step:/u);
  assert.doesNotMatch(primary, FORBIDDEN_PRIMARY_JARGON);
  assert.doesNotMatch(primary, /(?:agentic-sdlc|--[a-z])/iu);
  assert.match(technical, /Usage:/u);
  assert.match(technical, /\n  status\s+Show the current outcome/u);
});

test("Italian leaf help is understandable without plugin terminology", () => {
  const output = renderHelp(["autonomy", "delivery", "approve"], { locale: "it" });
  const [primary, technical] = output.split("Dettagli tecnici (facoltativi):");
  assert.match(output, /^Risultato:/u);
  assert.match(primary, /Risultato: Approva i limiti soltanto per questa consegna\./u);
  assert.match(primary, /Cosa cambia in pratica:/u);
  assert.match(primary, /Cosa devi decidere:/u);
  assert.match(primary, /Cosa resta protetto:/u);
  assert.match(primary, /Prossimo passo:/u);
  assert.doesNotMatch(primary, FORBIDDEN_PRIMARY_JARGON);
  assert.doesNotMatch(primary, /(?:agentic-sdlc|--[a-z])/iu);
  assert.match(technical, /agentic-sdlc autonomy delivery approve/u);
  assert.match(technical, /--authorization/u);
  assert.match(technical, /serve --summary oppure --approval-evidence/u);
  assert.doesNotMatch(technical, /requires --summary|required with|--summary or --approval-evidence/u);
});

test("delivery help exposes required runtime inputs rather than internal aliases", () => {
  const propose = renderHelp(["autonomy", "delivery", "propose"]);
  const proposeTechnical = propose.split("Technical details (optional):")[1];
  for (const flag of ["--id", "--delivery", "--kind", "--story", "--contract", "--requirement", "--level"]) {
    assert.match(proposeTechnical, new RegExp(`${flag}[^\\n]*\\(required\\)`, "u"));
  }
  assert.doesNotMatch(proposeTechnical, /--contract-id/u);
  assert.match(proposeTechnical, /--repository[^\n]*required with --kind pull_request/u);
  assert.match(proposeTechnical, /--target-root[^\n]*required with --kind local_release/u);

  const action = buildHelpModel(["autonomy", "delivery", "action"]);
  const flags = new Map(action.options.map((entry) => [entry.flag, entry]));
  assert.equal(flags.get("--id").required, true);
  assert.equal(flags.get("--action").required, true);
  assert.equal(flags.has("--outcome"), true);
  assert.equal(flags.has("--evidence"), true);
});

test("trace append help includes a runnable example and its operational flags", () => {
  const model = buildHelpModel(["trace", "append"]);
  const flags = new Map(model.options.map((entry) => [entry.flag, entry]));
  assert.equal(flags.get("--type")?.required, true);
  assert.equal(flags.get("--summary")?.required, true);
  for (const flag of ["--evidence", "--outcome", "--action", "--related", "--actor-type"]) {
    assert.equal(flags.has(flag), true, flag);
  }
  assert.equal(model.examples.length, 1);
  assert.match(model.examples[0], /^agentic-sdlc trace append --type decision --summary/u);
});

test("requirement and contract help include safe runnable examples and exact runtime flags", () => {
  const requirement = buildHelpModel(["requirement", "propose"]);
  const requirementFlags = new Map(requirement.options.map((entry) => [entry.flag, entry]));
  for (const flag of ["--id", "--title", "--acceptance", "--autonomy-ceiling"]) {
    assert.equal(requirementFlags.get(flag)?.required, true, flag);
  }
  assert.equal(requirement.examples.length, 1);
  assert.match(requirement.examples[0], /--title .*--summary .*--acceptance .*--autonomy-ceiling/u);

  const approve = buildHelpModel(["requirement", "approve"]);
  assert.match(approve.examples[0], /--actor-type human --approval-source explicit-user --summary/u);

  const contract = buildHelpModel(["contract", "create"]);
  const contractFlags = new Map(contract.options.map((entry) => [entry.flag, entry]));
  assert.equal(contractFlags.get("--phase")?.required, true);
  assert.equal(contractFlags.has("--delivery-profile"), true);
  assert.equal(contractFlags.has("--profile"), false);
  assert.match(contract.examples[0], /--phase design --context-summary .*--validation/u);

  const italianContract = buildHelpModel(["contract", "create"], { locale: "it" });
  const italianFlags = new Map(italianContract.options.map((entry) => [entry.flag, entry]));
  assert.match(italianFlags.get("--delivery-profile").required_when, /una story di implementazione/u);
  assert.match(italianFlags.get("--context-summary").required_one_of, /una tra --context-summary/u);
  assert.match(italianFlags.get("--output-ref").required_when, /risultato persistente/u);
  assert.doesNotMatch(italianFlags.get("--delivery-profile").required_when, /implementation|approved|enforcement/u);
});

test("hierarchical help shows only the selected group's immediate children", () => {
  const model = buildHelpModel(["autonomy", "delivery"], { locale: "en" });
  assert.equal(Object.isFrozen(model), true);
  assert.equal(Object.isFrozen(model.commands[0]), true);
  assert.equal(model.command.kind, "group");
  assert.deepEqual(model.commands.map((entry) => entry.name), ["action", "approve", "close", "explain", "propose", "revoke", "status"]);
  assert.equal(model.commands.some((entry) => entry.path === "requirement approve"), false);
});

test("JSON help is stable and keeps human guidance structured", () => {
  const first = renderHelp(["status"], { locale: "it", json: true, version: "0.11.0" });
  const second = renderHelp("help status", { locale: "it", json: true, version: "0.11.0" });
  assert.equal(first, second);
  const parsed = JSON.parse(first);
  assert.equal(parsed.schema_version, "agentic-sdlc-help-v1");
  assert.equal(parsed.locale, "it");
  assert.equal(parsed.command.path, "status");
  assert.match(parsed.human.next_action, /Controlla/u);
});

test("unknown help path returns bounded nearest suggestions", () => {
  assert.throws(
    () => renderHelp(["autonomy", "delivry", "aproove"]),
    (error) => {
      assert.equal(error instanceof UnknownCommandError, true);
      assert.equal(error.code, "UNKNOWN_COMMAND");
      assert.equal(error.suggestions[0], "autonomy delivery approve");
      assert.equal(error.suggestions.length, 3);
      const [primary, technical] = error.message.split("Technical details (optional):");
      assert.match(primary, /Outcome: I could not find the requested action\./u);
      assert.doesNotMatch(primary, /autonomy|delivry|aproove/u);
      assert.match(technical, /unknown_path: autonomy delivry aproove/u);
      return true;
    },
  );
});

test("unsupported locale fails before rendering", () => {
  assert.throws(() => renderHelp([], { locale: "fr" }), /Use en or it/u);
});
