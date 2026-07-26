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
  assert.match(primary, /Talk naturally to Codex about the outcome you want\./u);
  assert.match(primary, /This CLI is for structured recovery and automation/u);
  assert.match(primary, /requirement -> story -> work brief\/output -> autonomy for this delivery -> one task start -> implement\/test -> delivery/u);
  assert.doesNotMatch(primary, FORBIDDEN_PRIMARY_JARGON);
  assert.doesNotMatch(primary, /(?:agentic-sdlc|--[a-z])/iu);
  assert.match(technical, /Usage:/u);
  assert.match(technical, /\n  status\s+Show the current outcome/u);

  const italian = renderHelp([], { locale: "it" });
  const [italianPrimary] = italian.split("Dettagli tecnici (facoltativi):");
  assert.match(italianPrimary, /Parla naturalmente con Codex del risultato che vuoi ottenere\./u);
  assert.match(italianPrimary, /Questa CLI serve per recupero strutturato e automazione/u);
  assert.match(italianPrimary, /requisito -> story -> accordo di lavoro\/output -> autonomia per questa consegna -> un solo avvio attività -> implementazione\/test -> consegna/u);
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
  const [proposePrimary, proposeTechnical] = propose.split("Technical details (optional):");
  assert.match(proposePrimary, /For this pull request, how independently should I work\?/u);
  assert.match(proposePrimary, /A local release uses its own separate question/u);
  assert.doesNotMatch(proposePrimary, /pull request or local release/u);
  assert.doesNotMatch(proposePrimary, FORBIDDEN_PRIMARY_JARGON);
  for (const flag of ["--id", "--delivery", "--kind", "--story", "--contract", "--requirement", "--level"]) {
    assert.match(proposeTechnical, new RegExp(`${flag}[^\\n]*\\(required\\)`, "u"));
  }
  assert.doesNotMatch(proposeTechnical, /--contract-id/u);
  assert.match(proposeTechnical, /--repository[^\n]*required with --kind pull_request/u);
  assert.match(proposeTechnical, /--target-root[^\n]*required with --kind local_release/u);
  assert.match(proposeTechnical, /supervised means Guided/u);
  assert.match(proposeTechnical, /checkpointed means Autonomy with checks/u);

  const italian = renderHelp(["autonomy", "delivery", "propose"], { locale: "it" });
  const [italianPrimary] = italian.split("Dettagli tecnici (facoltativi):");
  assert.match(italianPrimary, /Per questa PR, quanto vuoi che lavori in autonomia\?/u);
  assert.match(italianPrimary, /Un rilascio locale usa una domanda separata/u);
  assert.doesNotMatch(italianPrimary, /PR o rilascio locale/u);

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

test("core work commands keep human guidance plain and runtime flags in optional details", () => {
  const expectations = [
    { path: ["story", "create"], flags: ["--title", "--acceptance"] },
    { path: ["story", "claim"], flags: ["--agent", "--branch"] },
    { path: ["output", "resolve"], flags: ["--story", "--type"] },
    { path: ["contract", "approve"], flags: ["--actor-type", "--approval-source", "--approval-evidence"] },
    { path: ["task", "start"], flags: ["--intent-json", "--intent-file", "--contract-id", "--confirm-start"] },
  ];

  for (const expectation of expectations) {
    const output = renderHelp(expectation.path, { locale: "it" });
    const [primary, technical] = output.split("Dettagli tecnici (facoltativi):");
    assert.doesNotMatch(primary, FORBIDDEN_PRIMARY_JARGON, expectation.path.join(" "));
    assert.doesNotMatch(primary, /(?:agentic-sdlc|--[a-z])/iu, expectation.path.join(" "));
    for (const flag of expectation.flags) {
      assert.match(technical, new RegExp(flag, "u"), `${expectation.path.join(" ")} should expose ${flag}`);
    }
  }
});

test("recovery and automation help mirrors mandatory and conditional runtime inputs", () => {
  const describe = (command) => new Map(buildHelpModel(command.split(" ")).options.map((entry) => [entry.flag, entry]));
  const expectedFlags = {
    init: ["--project-name", "--project-id", "--force"],
    "onboard existing-project": ["--project-name", "--project-id", "--id", "--document", "--source", "--question", "--assumption", "--summary", "--confirmed-source", "--force"],
    "baseline propose": ["--id", "--document", "--source", "--question", "--assumption", "--summary", "--confirmed-source", "--force"],
    "output template propose": ["--type", "--id", "--from", "--body", "--preset", "--summary", "--format", "--delivery", "--extension", "--media-type", "--generator", "--force"],
    "capability profile propose": ["--id", "--story", "--requirement", "--phase", "--scope", "--context-file", "--constraint", "--confidence", "--profile-json", "--profile-file", "--force"],
    "capability recommend": ["--id", "--profile", "--recommendation-json", "--recommendation-file", "--available-capabilities-json", "--available-capabilities-file", "--force"],
    "task start": ["--intent-json", "--intent-file", "--text", "--story", "--phase", "--contract-id", "--delivery-profile", "--confirm-start", "--actor-type", "--authorization", "--revise-contract"],
  };

  for (const [command, flags] of Object.entries(expectedFlags)) {
    const options = describe(command);
    for (const flag of flags) assert.equal(options.has(flag), true, `${command} should expose ${flag}`);
    const model = buildHelpModel(command.split(" "));
    assert.equal(model.examples.length > 0, true, `${command} should include a copyable example`);
    assert.doesNotMatch(model.examples[0], /<[^>]+>/u, `${command} example should not contain placeholders`);
  }

  assert.equal(describe("output template propose").get("--type").required, true);
  assert.equal(describe("capability profile propose").get("--id").required, true);
  assert.equal(describe("capability recommend").get("--profile").required, true);
  assert.equal(describe("task start").get("--intent-json").required_one_of, "--intent-json or --intent-file");
  assert.match(describe("task start").get("--delivery-profile").required_when, /implementation, validation, or release/u);
});

test("approval, authorization, routing, and contract help expose governed runtime choices", () => {
  const describe = (command) => new Map(buildHelpModel(command.split(" ")).options.map((entry) => [entry.flag, entry]));
  const approvals = ["baseline approve", "output template approve", "capability profile approve", "capability approve", "contract approve"];

  for (const command of approvals) {
    const options = describe(command);
    assert.equal(options.get("--id")?.required, true, command);
    assert.equal(options.get("--actor-type")?.required, true, command);
    assert.match(options.get("--approval-source")?.required_when, /not supplied by CI/u, command);
    assert.equal(options.get("--summary")?.required_one_of, "--summary or --approval-evidence", command);
    assert.match(options.get("--authorization")?.required_when, /automation/u, command);
    assert.equal(buildHelpModel(command.split(" ")).examples.length > 0, true, command);
  }

  const authorization = describe("authorization grant");
  for (const flag of ["--id", "--scope", "--summary", "--actor-type", "--approval-source"]) {
    assert.equal(authorization.get(flag)?.required, true, flag);
  }
  assert.equal(authorization.get("--allow-action")?.required_one_of, "--allow-action or --allow-use");
  assert.equal(authorization.get("--allow-use")?.required_one_of, "--allow-action or --allow-use");
  for (const flag of ["--allow-subject", "--allow-artifact-type", "--allow-boundary", "--expires-at", "--proposal", "--proposal-hash", "--max-uses", "--authority-assurance", "--approval-evidence", "--force"]) {
    assert.equal(authorization.has(flag), true, flag);
  }

  const route = describe("route decide");
  assert.equal(route.get("--intent-json")?.required_one_of, "--intent-json or --intent-file");
  assert.equal(route.get("--intent-file")?.required_one_of, "--intent-json or --intent-file");
  assert.match(buildHelpModel(["route", "decide"]).human.result, /project routing configuration/u);
  assert.match(buildHelpModel(["route", "decide"]).examples[0], /"requested_action":"implement_story"/u);

  const contract = describe("contract create");
  assert.equal(contract.get("--phase")?.value, "discovery|analysis|design|implementation|validation|release");
  assert.equal(contract.get("--reasoning")?.value, "inherit|minimal|low|medium|high");
  assert.equal(contract.has("--force"), true);
  assert.equal(describe("contract approve").get("--status")?.value, "approved|changes_requested|rejected");
  assert.equal(describe("output template propose").get("--format")?.value, "markdown|docx|xlsx|pdf|pptx|html|json|csv|custom");
  assert.equal(describe("authorization grant").get("--authority-assurance")?.value, "audit_only|host_verified");
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
