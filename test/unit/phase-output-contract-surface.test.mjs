import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { findCommand, listOptions } from "../../lib/cli/command-catalog.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const readText = (relativePath) => readFileSync(path.join(repoRoot, relativePath), "utf8");
const readJson = (relativePath) => JSON.parse(readText(relativePath));

test("contract schema and template expose an optional output due phase", () => {
  const contractSchema = readJson("schemas/contract.schema.json");
  const outputRefSchema = contractSchema.properties.output_contract_refs.items;
  assert.deepEqual(outputRefSchema.properties.phase, { type: "string", minLength: 1 });
  assert.equal(outputRefSchema.required.includes("phase"), false);

  const contractTemplate = readJson("templates/contract-template.json");
  assert.equal(contractTemplate.output_contract_refs[0].phase, "analysis");
});

test("contract-create catalog documents the backward-compatible phased output-ref form", () => {
  const outputRef = listOptions("contract create", { includeGlobal: false })
    .find((entry) => entry.flag === "--output-ref");
  assert.equal(outputRef.value, "type:template:mode[:phase]");
  assert.match(outputRef.description.en, /legacy three-part form remains all-due/u);
  assert.match(outputRef.description.it, /formato storico a tre parti resta sempre dovuto/u);

  const contractCreate = findCommand("contract create");
  assert.match(contractCreate.usage, /type:template:mode\[:phase\]/u);
  assert.equal(
    contractCreate.examples.some((example) => example.includes("code-change:CODE-CHANGE-V1:new:implementation")),
    true,
  );
});

test("contract documentation defines cumulative intermediate and lifecycle-complete semantics", () => {
  for (const relativePath of [
    "skills/agentic-sdlc/references/contracts.md",
    "skills/agentic-sdlc/references/commands.md",
    "docs/architecture.md",
  ]) {
    const document = readText(relativePath);
    assert.match(document, /legacy|Legacy/u, relativePath);
    assert.match(document, /cumulatively/u, relativePath);
    assert.match(document, /intermediate strict gate/u, relativePath);
    assert.match(document, /lifecycle-complete/u, relativePath);
  }
});
