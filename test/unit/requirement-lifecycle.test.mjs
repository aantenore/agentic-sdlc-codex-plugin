import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRequirementProposal,
  buildRequirementRef,
  buildRequirementRevision,
  buildRequirementSupersession,
  requirementContentHash,
  validateRequirementIntegrity,
} from "../../lib/requirement-lifecycle.mjs";

const CREATED_AT = "2026-07-17T08:00:00.000Z";
const REVISED_AT = "2026-07-17T09:00:00.000Z";
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function proposalInput(overrides = {}) {
  return {
    id: "REQ-TRAVEL-001-v1",
    logical_id: "REQ-TRAVEL-001",
    revision: 1,
    title: "Expose the approved itinerary",
    summary: "Return the approved itinerary through the existing API boundary.",
    acceptance_criteria: [
      "The API returns the approved itinerary.",
      "A contract test proves the response remains backward compatible.",
    ],
    non_goals: ["Do not change the booking provider."],
    constraints: ["Reuse the existing API."],
    non_functional_requirements: ["Preserve backward compatibility."],
    integrations: ["booking-api"],
    source_paths: ["docs/requirement.md", "openapi/travel.yaml"],
    source_hashes: {
      "docs/requirement.md": HASH_A,
      "openapi/travel.yaml": HASH_B,
    },
    autonomy_profile_id: "AUT-REQ-TRAVEL-001-v1",
    created_at: CREATED_AT,
    audit: { created_by: { type: "human", id: "antonio" } },
    ...overrides,
  };
}

test("builds an immutable canonical requirement:v2 proposal", () => {
  const requirement = buildRequirementProposal(proposalInput());

  assert.equal(requirement.schema_version, "requirement:v2");
  assert.equal(requirement.kind, "requirement");
  assert.equal(requirement.status, "proposed");
  assert.equal(requirement.logical_id, "REQ-TRAVEL-001");
  assert.equal(requirement.revision, 1);
  assert.equal(requirement.previous_revision_ref, null);
  assert.equal(requirement.autonomy_profile_id, "AUT-REQ-TRAVEL-001-v1");
  assert.equal(validateRequirementIntegrity(requirement).valid, true);
  assert.equal(Object.isFrozen(requirement), true);
  assert.equal(Object.isFrozen(requirement.acceptance_criteria), true);
  assert.equal(Object.isFrozen(requirement.source_hashes), true);
});

test("canonicalizes source paths and binds exactly one SHA-256 digest to each source", () => {
  const reversed = buildRequirementProposal(proposalInput({
    source_paths: ["openapi/travel.yaml", "docs/requirement.md"],
    source_hashes: {
      "openapi/travel.yaml": HASH_B,
      "docs/requirement.md": HASH_A,
    },
  }));
  const canonical = buildRequirementProposal(proposalInput());

  assert.deepEqual(reversed.source_paths, ["docs/requirement.md", "openapi/travel.yaml"]);
  assert.deepEqual(Object.keys(reversed.source_hashes), ["docs/requirement.md", "openapi/travel.yaml"]);
  assert.equal(requirementContentHash(reversed), requirementContentHash(canonical));
  assert.throws(
    () => buildRequirementProposal(proposalInput({
      source_hashes: { "docs/requirement.md": HASH_A },
    })),
    /missing a SHA-256 digest for openapi\/travel\.yaml/,
  );
  assert.throws(
    () => buildRequirementProposal(proposalInput({
      source_hashes: {
        "docs/requirement.md": HASH_A,
        "openapi/travel.yaml": HASH_B,
        "unreferenced.md": "c".repeat(64),
      },
    })),
    /contains unreferenced path unreferenced\.md/,
  );
});

test("creates an immutable next revision with an exact previous-revision reference", () => {
  const current = buildRequirementProposal(proposalInput());
  const currentHash = requirementContentHash(current);
  const next = buildRequirementRevision(current, {
    id: "REQ-TRAVEL-001-v2",
    summary: "Return the approved itinerary and its policy version through the existing API boundary.",
    integrations: ["booking-api", "policy-api"],
    previous_path: ".sdlc/requirements/REQ-TRAVEL-001-v1.json",
    autonomy_profile_id: "AUT-REQ-TRAVEL-001-v2",
    created_at: REVISED_AT,
    audit: { created_by: { type: "human", id: "antonio" } },
  });

  assert.equal(next.revision, 2);
  assert.equal(next.logical_id, current.logical_id);
  assert.equal(next.status, "proposed");
  assert.deepEqual(next.previous_revision_ref, {
    id: current.id,
    path: ".sdlc/requirements/REQ-TRAVEL-001-v1.json",
    content_hash: currentHash,
    revision: 1,
  });
  assert.equal(Object.isFrozen(next), true);
  assert.equal(Object.isFrozen(next.previous_revision_ref), true);
  assert.equal(requirementContentHash(current), currentHash);
  assert.notEqual(requirementContentHash(next), currentHash);
  assert.throws(() => {
    next.summary = "mutated";
  }, TypeError);
  assert.throws(
    () => buildRequirementRevision({ ...current, schema_version: "requirement:v1" }, {
      id: "REQ-TRAVEL-001-v2",
      previous_path: ".sdlc/requirements/REQ-TRAVEL-001-v1.json",
      autonomy_profile_id: "AUT-REQ-TRAVEL-001-v2",
      created_at: REVISED_AT,
    }),
    /Only requirement:v2 records can be revised/,
  );
});

test("builds append-only supersession evidence without mutating either revision", () => {
  const current = buildRequirementProposal(proposalInput());
  const next = buildRequirementRevision(current, {
    id: "REQ-TRAVEL-001-v2",
    previous_path: ".sdlc/requirements/REQ-TRAVEL-001-v1.json",
    autonomy_profile_id: "AUT-REQ-TRAVEL-001-v2",
    created_at: REVISED_AT,
  });
  const currentHash = requirementContentHash(current);
  const nextHash = requirementContentHash(next);
  const event = buildRequirementSupersession({
    id: "REQ-LIFECYCLE-TRAVEL-001-v1-v2",
    requirement_ref: buildRequirementRef(current, ".sdlc/requirements/REQ-TRAVEL-001-v1.json"),
    replacement_ref: buildRequirementRef(next, ".sdlc/requirements/REQ-TRAVEL-001-v2.json"),
    reason: "The approved scope now includes the policy version.",
    approval: { id: "APR-REQ-TRAVEL-001-v2", status: "approved" },
    created_at: "2026-07-17T10:00:00.000Z",
    audit: { created_by: { type: "human", id: "antonio" } },
  });

  assert.equal(event.schema_version, "requirement-lifecycle-event:v1");
  assert.equal(event.event, "superseded");
  assert.equal(Object.isFrozen(event), true);
  assert.equal(Object.isFrozen(event.requirement_ref), true);
  assert.equal(requirementContentHash(current), currentHash);
  assert.equal(requirementContentHash(next), nextHash);
  assert.equal(current.status, "proposed");
  assert.equal(next.status, "proposed");
  assert.throws(
    () => buildRequirementSupersession({
      id: "REQ-LIFECYCLE-SELF",
      requirement_ref: buildRequirementRef(current, ".sdlc/requirements/REQ-TRAVEL-001-v1.json"),
      replacement_ref: buildRequirementRef(current, ".sdlc/requirements/REQ-TRAVEL-001-v1-copy.json"),
      reason: "Invalid self-supersession.",
      created_at: "2026-07-17T10:00:00.000Z",
    }),
    /cannot supersede itself/,
  );
});

test("content hash ignores lifecycle metadata but remains bound to agreed content", () => {
  const requirement = buildRequirementProposal(proposalInput());
  const lifecycleOnlyChange = structuredClone(requirement);
  lifecycleOnlyChange.status = "approved";
  lifecycleOnlyChange.approvals = [{ id: "APR-001", status: "approved" }];
  lifecycleOnlyChange.audit = { updated_by: { type: "system", id: "codex" } };
  lifecycleOnlyChange.created_at = "2026-07-01T00:00:00.000Z";
  lifecycleOnlyChange.updated_at = "2026-07-18T00:00:00.000Z";

  assert.equal(requirementContentHash(lifecycleOnlyChange), requirementContentHash(requirement));
  assert.equal(validateRequirementIntegrity(lifecycleOnlyChange).valid, true);
});

test("material requirement drift changes the content hash", () => {
  const requirement = buildRequirementProposal(proposalInput());
  const approvedHash = requirementContentHash(requirement);
  const materialChanges = [
    { summary: "Expand the API to include draft itineraries." },
    { acceptance_criteria: ["The API also returns draft itineraries."] },
    { non_goals: [] },
    { constraints: ["A new public endpoint may be added."] },
    { non_functional_requirements: ["Allow a breaking response change."] },
    { integrations: ["booking-api", "draft-api"] },
    {
      source_hashes: {
        "docs/requirement.md": "c".repeat(64),
        "openapi/travel.yaml": HASH_B,
      },
    },
    { autonomy_profile_id: "AUT-REQ-TRAVEL-001-expanded" },
  ];

  for (const change of materialChanges) {
    const drifted = buildRequirementProposal(proposalInput(change));
    assert.notEqual(
      requirementContentHash(drifted),
      approvedHash,
      `Expected material drift for ${Object.keys(change)[0]}`,
    );
  }
});
