import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

import { buildExecutionUsageReceipt, normalizeExecutionBudget } from "../../lib/execution-budget.mjs";
import {
  buildMeteringAttestation,
  computeExactMeteringPolicyHash,
  validateMeteringAttestationForReceipt,
  validateMeteringAttestationIntegrity,
} from "../../lib/metering-attestations.mjs";

function fixture() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const budget = normalizeExecutionBudget({
    id: "budget-signed-metering",
    limits: { steps: { unit: "steps", metering: "exact", soft: 10, hard: 20 } },
  });
  const measurement = {
    execution_id: "ASSESS-SIGNED",
    budget_id: budget.id,
    budget_hash: budget.budget_hash,
    adapter: "signed-runtime-meter",
    usage: { steps: 7 },
    metering: { steps: "exact" },
    cumulative: true,
    started_at: "2026-07-14T09:00:00.000Z",
    ended_at: "2026-07-14T09:10:00.000Z",
    coverage_started_at: "2026-07-14T09:00:00.000Z",
    coverage_ended_at: "2026-07-14T09:10:00.000Z",
    final_observation_at: "2026-07-14T09:10:00.000Z",
    enforcement_hook_receipt_ref: null,
    pricing_ref: null,
    evidence: [{ id: "runtime-session-1" }],
  };
  const attestation = buildMeteringAttestation({
    id: "MATT-ASSESS-SIGNED-1",
    measurement,
    issued_at: "2026-07-14T09:10:01.000Z",
    valid_from: "2026-07-14T09:00:00.000Z",
    expires_at: "2026-07-15T09:10:01.000Z",
    signing: { key_id: "runtime-key-1", private_key: privateKey },
  });
  const receipt = buildExecutionUsageReceipt({
    id: "USAGE-ASSESS-SIGNED-1",
    execution_id: measurement.execution_id,
    budget,
    usage: measurement.usage,
    metering: measurement.metering,
    started_at: measurement.started_at,
    ended_at: measurement.ended_at,
    source: {
      adapter: measurement.adapter,
      assurance: "trusted_attested",
      aggregation: "cumulative",
      attestation_ref: { id: attestation.id, path: "receipts/metering.json", hash: "a".repeat(64) },
    },
    pricing_ref: measurement.pricing_ref,
    evidence: measurement.evidence,
  });
  return {
    attestation,
    receipt,
    trustedKeys: [{
      key_id: "runtime-key-1",
      algorithm: "Ed25519",
      public_key: publicKey.export({ type: "spki", format: "pem" }).toString(),
    }],
  };
}

test("metering attestation is signed, canonical, and exactly bound to its cumulative receipt", () => {
  const { attestation, receipt, trustedKeys } = fixture();
  assert.equal(validateMeteringAttestationIntegrity(attestation, { trusted_keys: trustedKeys }).valid, true);
  assert.equal(validateMeteringAttestationForReceipt(attestation, receipt, { trusted_keys: trustedKeys }).valid, true);

  const changedReceipt = structuredClone(receipt);
  changedReceipt.usage.steps = 6;
  const changed = validateMeteringAttestationForReceipt(attestation, changedReceipt, { trusted_keys: trustedKeys });
  assert.equal(changed.valid, false);
  assert.match(changed.errors.join("; "), /measurement\.usage does not exactly match/);
});

test("metering attestation rejects an untrusted key and signed-content tampering", () => {
  const { attestation, receipt } = fixture();
  const { publicKey } = generateKeyPairSync("ed25519");
  const wrongKeys = [{
    key_id: "runtime-key-1",
    algorithm: "Ed25519",
    public_key: publicKey.export({ type: "spki", format: "pem" }).toString(),
  }];
  assert.equal(validateMeteringAttestationForReceipt(attestation, receipt, { trusted_keys: wrongKeys }).valid, false);

  const tampered = structuredClone(attestation);
  tampered.measurement.usage.steps = 8;
  const integrity = validateMeteringAttestationIntegrity(tampered, { trusted_keys: wrongKeys });
  assert.equal(integrity.valid, false);
  assert.match(integrity.errors.join("; "), /measurement_hash|attestation_hash|payload_hash/);
});

test("exact-metering policy hash binds adapter keys and freshness policy", () => {
  const base = {
    default_trust: "deny",
    completion_freshness_seconds: 60,
    trusted_sources: [{
      adapter: "signed-runtime-meter",
      metrics: ["steps"],
      trusted_keys: [{ key_id: "key-1", algorithm: "Ed25519", public_key: "pem-1" }],
    }],
  };
  assert.notEqual(
    computeExactMeteringPolicyHash(base),
    computeExactMeteringPolicyHash({ ...base, completion_freshness_seconds: 30 }),
  );
});
