import assert from "node:assert/strict";
import test from "node:test";

import {
  COMMAND_CATALOG,
  findCommand,
  getChildCommands,
  listCommandPaths,
  listOptions,
  suggestCommand,
} from "../../lib/cli/command-catalog.mjs";

test("command catalog is immutable and supports root, group, and leaf lookup", () => {
  assert.equal(Object.isFrozen(COMMAND_CATALOG), true);
  assert.equal(Object.isFrozen(COMMAND_CATALOG.children), true);
  assert.equal(findCommand([]), COMMAND_CATALOG);

  const group = findCommand(["autonomy", "delivery"]);
  assert.equal(group.kind, "group");
  assert.equal(group.description.it.includes("consegna"), true);
  assert.equal(Object.isFrozen(group), true);

  const leaf = findCommand("autonomy delivery approve");
  assert.equal(leaf.kind, "command");
  assert.deepEqual(leaf.path, ["autonomy", "delivery", "approve"]);
  assert.equal(leaf.effect, "protected");
  assert.equal(findCommand("agentic-sdlc autonomy delivery approve"), leaf);
  assert.equal(findCommand("autonomy delivery missing"), null);
});

test("catalog covers the dispatch families and the self-service commands", () => {
  const paths = new Set(listCommandPaths());
  const expected = [
    "help",
    "completion",
    "preset list",
    "preset show",
    "preset export",
    "observe",
    "config status",
    "config migrate",
    "init",
    "doctor",
    "optimization run",
    "baseline approve",
    "assessment proposal prepare",
    "budget meter record",
    "requirement propose",
    "requirement approve",
    "autonomy requirement status",
    "autonomy delivery approve",
    "contract create",
    "story handoff close",
    "work item create",
    "breakdown policy set",
    "dependency approve",
    "capability profile approve",
    "approval requests",
    "authorization grant",
    "task start",
    "phase lock",
    "trace append",
    "sync record",
    "output template propose",
    "cache rebuild",
    "manifest rebuild",
    "archive closed",
    "migration identity",
    "report activity",
    "index rebuild",
    "kb search",
    "gate check",
    "orchestrate plan",
    "route decide",
    "status",
  ];
  for (const path of expected) assert.equal(paths.has(path), true, `missing catalog path: ${path}`);
  assert.equal(paths.size >= 100, true);
});

test("child and option discovery is deterministic and does not expose mutable arrays", () => {
  const children = getChildCommands("autonomy delivery");
  assert.deepEqual(children.map((entry) => entry.name), ["action", "approve", "close", "explain", "propose", "revoke", "status"]);
  assert.equal(Object.isFrozen(children), true);

  const options = listOptions("autonomy delivery approve");
  assert.equal(options.some((entry) => entry.flag === "--locale"), true);
  assert.equal(options.some((entry) => entry.flag === "--authorization"), true);
  assert.equal(new Set(options.map((entry) => entry.name)).size, options.length);
  assert.equal(Object.isFrozen(options), true);
});

test("delivery self-service help mirrors the runtime flags and marks the main required inputs", () => {
  const describe = (command) => new Map(listOptions(command, { includeGlobal: false }).map((entry) => [entry.flag, entry]));

  const propose = describe("autonomy delivery propose");
  for (const flag of ["--id", "--delivery", "--kind", "--story", "--contract", "--requirement", "--level"]) {
    assert.equal(propose.get(flag)?.required, true, `${flag} should be marked required`);
  }
  for (const flag of ["--repository", "--base", "--head", "--write-path", "--allow-action", "--merge-allowed", "--target-root", "--smoke-test", "--rollback"]) {
    assert.equal(propose.has(flag), true, `missing runtime proposal flag: ${flag}`);
  }
  assert.equal(propose.has("--contract-id"), false);

  const approve = describe("autonomy delivery approve");
  for (const flag of ["--id", "--actor-type", "--approval-source"]) {
    assert.equal(approve.get(flag)?.required, true, `${flag} should be marked required`);
  }
  for (const flag of ["--summary", "--approval-evidence", "--authorization", "--host-receipt-file"]) {
    assert.equal(approve.has(flag), true, `missing runtime approval flag: ${flag}`);
  }

  const action = describe("autonomy delivery action");
  assert.equal(action.get("--id")?.required, true);
  assert.equal(action.get("--action")?.required, true);
  for (const flag of ["--scope-path", "--remote", "--pr-url", "--confirm-action", "--actor-type", "--approval-source", "--outcome", "--evidence", "--smoke-test", "--rollback"]) {
    assert.equal(action.has(flag), true, `missing runtime action flag: ${flag}`);
  }

  const trace = describe("trace append");
  assert.equal(trace.get("--type")?.required, true);
  assert.equal(trace.get("--summary")?.required, true);
  for (const flag of ["--evidence", "--outcome", "--action", "--related", "--actor-type"]) {
    assert.equal(trace.has(flag), true, `missing runtime trace flag: ${flag}`);
  }
});

test("requirement and contract help expose the runtime-required and conditional inputs", () => {
  const describe = (command) => new Map(listOptions(command, { includeGlobal: false }).map((entry) => [entry.flag, entry]));

  const requirement = describe("requirement propose");
  for (const flag of ["--id", "--title", "--acceptance", "--autonomy-ceiling"]) {
    assert.equal(requirement.get(flag)?.required, true, `${flag} should be marked required`);
  }
  assert.equal(requirement.get("--summary")?.required_one_of.en, "--summary or --scope-summary");
  assert.equal(requirement.get("--summary")?.required_one_of.it, "--summary oppure --scope-summary");
  assert.equal(requirement.get("--scope-summary")?.required_one_of.en, "--summary or --scope-summary");
  assert.match(requirement.get("--proposal")?.required_when.en, /proposal-hash/u);
  assert.match(requirement.get("--proposal")?.required_when.it, /fornito anche --proposal-hash/u);
  assert.match(requirement.get("--proposal-hash")?.required_when.en, /proposal/u);

  const approval = describe("requirement approve");
  assert.equal(approval.get("--id")?.required, true);
  assert.equal(approval.get("--actor-type")?.required, true);
  assert.match(approval.get("--approval-source")?.required_when.en, /CI/u);
  assert.match(approval.get("--approval-source")?.required_when.it, /indicato dalla CI/u);
  assert.match(approval.get("--authorization")?.required_when.en, /automation/u);
  assert.match(approval.get("--host-receipt-file")?.required_when.en, /trusted host/u);

  const contract = describe("contract create");
  assert.equal(contract.get("--phase")?.required, true);
  assert.equal(contract.has("--delivery-profile"), true);
  assert.equal(contract.has("--profile"), false);
  assert.match(contract.get("--delivery-profile")?.required_when.en, /implementation, validation, or release/u);
  assert.match(contract.get("--delivery-profile")?.required_when.it, /story di implementazione/u);
  assert.match(contract.get("--output-ref")?.required_when.en, /durable output/u);
  for (const flag of ["--context-summary", "--context-file", "--qa", "--capability-recommendation"]) {
    assert.match(contract.get(flag)?.required_one_of.en, /one of --context-summary/u, flag);
    assert.match(contract.get(flag)?.required_one_of.it, /una tra --context-summary/u, flag);
  }
});

test("capability selectors use --profile while delivery commands use --delivery-profile", () => {
  for (const command of ["capability profile status", "capability recommend", "capability status"]) {
    const flags = new Set(listOptions(command, { includeGlobal: false }).map((entry) => entry.flag));
    assert.equal(flags.has("--profile"), true, command);
    assert.equal(flags.has("--delivery-profile"), false, command);
  }
  const contractFlags = new Set(listOptions("contract create", { includeGlobal: false }).map((entry) => entry.flag));
  assert.equal(contractFlags.has("--delivery-profile"), true);
  assert.equal(contractFlags.has("--profile"), false);
});

test("nearest command suggestions favor the same hierarchy", () => {
  assert.deepEqual(
    suggestCommand("autonomy delivry aproove"),
    ["autonomy delivery approve", "autonomy delivery propose", "autonomy delivery action"],
  );
  assert.throws(() => suggestCommand("status", { limit: 0 }), /between 1 and 10/u);
});
