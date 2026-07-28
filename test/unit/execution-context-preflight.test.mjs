import assert from "node:assert/strict";
import test from "node:test";

import {
  buildExecutionContextPreflightReceipt,
  executionContextSourceEvolutionDecision,
  validateExecutionContextPreflightReceipt,
  workspaceChangeMatchesPreflight,
} from "../../lib/execution-context-preflight.mjs";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HASH_D = "d".repeat(64);

function ref(id, hash = HASH_A) {
  return { id, path: `.sdlc/${id}.json`, hash };
}

function receiptInput() {
  return {
    id: "PREFLIGHT-AUT-LOCAL-001",
    story_ref: ref("ST-001"),
    contract_ref: ref("CONTRACT-001", HASH_B),
    delivery_profile_ref: ref("AUT-LOCAL-001", HASH_C),
    requirement_scopes: [
      {
        profile_ref: ref("AUT-REQ-001", HASH_D),
        allowed_write_paths: ["docs", "src/app.mjs"],
      },
      {
        profile_ref: ref("AUT-REQ-002", HASH_C),
        allowed_write_paths: ["src"],
      },
    ],
    sources: [
      {
        path: "src/app.mjs",
        sha256: HASH_A,
        binding: {
          kind: "requirement",
          id: "REQ-001",
          record_path: ".sdlc/requirements/REQ-001.json",
          expected_sha256: HASH_A,
        },
      },
      {
        path: "src/app.mjs",
        sha256: HASH_A,
        binding: {
          kind: "contract_context",
          id: "CONTRACT-001",
          record_path: ".sdlc/contracts/CONTRACT-001.json",
          expected_sha256: HASH_A,
        },
      },
      {
        path: "README.md",
        sha256: HASH_B,
        binding: {
          kind: "baseline",
          id: "BASELINE-INITIAL",
          record_path: ".sdlc/baseline/BASELINE-INITIAL.json",
          expected_sha256: HASH_B,
        },
      },
    ],
    workspace_changes: [
      { path: "src/config.mjs", status: " M", content_sha256: HASH_D },
    ],
    git_head_sha: "1".repeat(40),
    created_by: { id: "ci", type: "ci" },
    created_at: "2026-07-28T12:00:00.000Z",
    audit: { git: {}, run: {} },
  };
}

test("preflight authorizes evolution only inside every approved requirement scope", () => {
  const receipt = buildExecutionContextPreflightReceipt(receiptInput());
  assert.equal(validateExecutionContextPreflightReceipt(receipt).valid, true);
  assert.equal(
    receipt.source_snapshots.find((source) => source.path === "src/app.mjs").disposition,
    "authorized_evolution",
  );
  assert.equal(
    receipt.source_snapshots.find((source) => source.path === "README.md").disposition,
    "immutable_context",
  );

  const allowed = executionContextSourceEvolutionDecision(receipt, {
    story_ref: receipt.story_ref,
    contract_ref: receipt.contract_ref,
    delivery_profile_ref: receipt.delivery_profile_ref,
    path: "src/app.mjs",
    expected_sha256: HASH_A,
    binding_kind: "requirement",
    binding_id: "REQ-001",
  });
  assert.equal(allowed.allowed, true);

  const wrongBinding = executionContextSourceEvolutionDecision(receipt, {
    story_ref: receipt.story_ref,
    contract_ref: receipt.contract_ref,
    delivery_profile_ref: receipt.delivery_profile_ref,
    path: "src/app.mjs",
    expected_sha256: HASH_A,
    binding_kind: "baseline",
    binding_id: "BASELINE-INITIAL",
  });
  assert.equal(wrongBinding.allowed, false);
  assert.equal(wrongBinding.reason, "source_binding_mismatch");
});

test("preflight rejects pre-start source drift and detects receipt tampering", () => {
  const input = receiptInput();
  input.sources[0].sha256 = HASH_C;
  assert.throws(
    () => buildExecutionContextPreflightReceipt(input),
    /changed before task start/u,
  );

  const receipt = buildExecutionContextPreflightReceipt(receiptInput());
  const tampered = structuredClone(receipt);
  tampered.source_snapshots[0].disposition = "authorized_evolution";
  const validation = validateExecutionContextPreflightReceipt(tampered);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.includes("receipt_hash")));
});

test("pre-existing dirty state is exempt only while its exact status and bytes remain unchanged", () => {
  const receipt = buildExecutionContextPreflightReceipt(receiptInput());
  assert.equal(workspaceChangeMatchesPreflight(receipt, {
    path: "src/config.mjs",
    status: " M",
    content_sha256: HASH_D,
  }), true);
  assert.equal(workspaceChangeMatchesPreflight(receipt, {
    path: "src/config.mjs",
    status: " M",
    content_sha256: HASH_A,
  }), false);
  assert.equal(workspaceChangeMatchesPreflight(receipt, {
    path: "src/other.mjs",
    status: "??",
    content_sha256: HASH_D,
  }), false);
});
