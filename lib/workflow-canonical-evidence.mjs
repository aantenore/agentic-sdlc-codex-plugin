import {
  DomainValidationError,
  STABLE_JSON_HASH_ALGORITHM,
  computeStableHash,
  immutableJson,
  isPlainRecord,
  requireNonEmptyString,
  requirePlainRecord,
} from "./canonical.mjs";

export const WORKFLOW_CANONICAL_EVIDENCE_SCHEMA = "workflow-canonical-evidence:v1";
export const WORKFLOW_FINAL_GATE_RECEIPT_SCHEMA = "workflow-final-gate-receipt:v1";

export const CANONICAL_WORKFLOW_GUARD_CHECKS = Object.freeze({
  "requirement-approved": "requirement_approved",
  "contract-approved": "contract_approved",
  "required-output-linked": "required_output_linked",
  "strict-gate-passed": "strict_gate_passed",
  "delivery-terminal": "delivery_terminal",
});

const SUCCESSFUL_DELIVERY_TERMINAL_STATUSES = new Set(["merged", "released"]);
const SHA256 = /^[a-f0-9]{64}$/u;

export function buildWorkflowFinalGateReceipt(report, options = {}) {
  requirePlainRecord(report, "workflow_final_gate_report");
  if (
    report.status !== "passed"
    || report.strict !== true
    || report.scope !== "story"
    || !Array.isArray(report.errors)
    || report.errors.length > 0
  ) {
    throw new DomainValidationError(
      "A final workflow gate receipt requires one passing strict story gate with no blocking errors",
    );
  }
  const storyId = requireNonEmptyString(report.story_id, "workflow_final_gate_report.story_id");
  const finalReceiptPath = requireNonEmptyString(
    options.final_receipt_path,
    "workflow_final_gate_report.final_receipt_path",
  );
  const receipt = {
    ...report,
    kind: "workflow_final_gate_receipt",
    schema_version: WORKFLOW_FINAL_GATE_RECEIPT_SCHEMA,
    story_id: storyId,
    final_receipt_path: finalReceiptPath,
    hash_algorithm: STABLE_JSON_HASH_ALGORITHM,
  };
  return immutableJson({
    ...receipt,
    receipt_hash: computeReceiptHash(receipt),
  });
}

/**
 * Build one integrity-sealed snapshot from records already loaded through the
 * host's governed project reader. This function deliberately performs no file
 * access: callers retain responsibility for path and symlink safety.
 */
export function buildWorkflowCanonicalEvidence(input) {
  requirePlainRecord(input, "workflow_canonical_evidence_input");
  const instance = requirePlainRecord(input.instance, "workflow_canonical_evidence_input.instance");
  const instanceId = requireNonEmptyString(instance.id, "workflow_canonical_evidence_input.instance.id");
  const binding = canonicalBinding(instance);
  const story = optionalRecord(input.story, "workflow_canonical_evidence_input.story");
  const requirements = normalizeRecordList(input.requirements, "workflow_canonical_evidence_input.requirements");
  const contract = optionalRecord(input.contract, "workflow_canonical_evidence_input.contract");
  const outputRegistry = optionalRecord(input.output_registry, "workflow_canonical_evidence_input.output_registry");
  const gateReport = optionalRecord(input.gate_report, "workflow_canonical_evidence_input.gate_report");
  const deliveryProfile = optionalRecord(input.delivery_profile, "workflow_canonical_evidence_input.delivery_profile");
  const deliveryCloseReceipt = optionalRecord(
    input.delivery_close_receipt,
    "workflow_canonical_evidence_input.delivery_close_receipt",
  );

  const storyCheck = storyBindingCheck(story, binding.story_id);
  const requirementCheck = requirementApprovalCheck(story, requirements, storyCheck.satisfied);
  const contractCheck = contractApprovalCheck(story, contract, binding.story_id, storyCheck.satisfied);
  const outputCheck = requiredOutputLinkCheck(contract, outputRegistry, binding.story_id, contractCheck.satisfied);
  const deliveryCheck = deliveryTerminalCheck(
    story,
    contract,
    deliveryProfile,
    deliveryCloseReceipt,
    binding.story_id,
    contractCheck.satisfied,
  );
  const gateCheck = strictGateCheck(
    gateReport,
    binding.story_id,
    outputCheck,
    deliveryCheck,
  );
  const observedAt = normalizeObservedAt(input.observed_at);
  const evidence = {
    kind: "workflow_canonical_evidence",
    schema_version: WORKFLOW_CANONICAL_EVIDENCE_SCHEMA,
    instance_id: instanceId,
    story_id: binding.story_id,
    observed_at: observedAt,
    checks: {
      requirement_approved: requirementCheck,
      contract_approved: contractCheck,
      required_output_linked: outputCheck,
      strict_gate_passed: gateCheck,
      delivery_terminal: deliveryCheck,
    },
    hash_algorithm: STABLE_JSON_HASH_ALGORITHM,
  };
  return immutableJson({
    ...evidence,
    evidence_hash: computeWorkflowCanonicalEvidenceHash(evidence),
  });
}

export function computeWorkflowCanonicalEvidenceHash(evidence) {
  requirePlainRecord(evidence, "workflow_canonical_evidence");
  const {
    evidence_hash: ignoredEvidenceHash,
    hash_algorithm: ignoredHashAlgorithm,
    ...subject
  } = evidence;
  return computeStableHash(subject);
}

export function validateWorkflowCanonicalEvidence(evidence, options = {}) {
  const errors = [];
  if (!isPlainRecord(evidence)) {
    return immutableJson({
      valid: false,
      errors: ["workflow canonical evidence must be a plain object"],
      expected_hash: null,
      actual_hash: null,
    });
  }
  if (evidence.kind !== "workflow_canonical_evidence") {
    errors.push("workflow canonical evidence kind is invalid");
  }
  if (evidence.schema_version !== WORKFLOW_CANONICAL_EVIDENCE_SCHEMA) {
    errors.push(`workflow canonical evidence schema must be '${WORKFLOW_CANONICAL_EVIDENCE_SCHEMA}'`);
  }
  if (typeof evidence.instance_id !== "string" || evidence.instance_id.trim() === "") {
    errors.push("workflow canonical evidence instance_id is required");
  }
  if (typeof evidence.story_id !== "string" || evidence.story_id.trim() === "") {
    errors.push("workflow canonical evidence story_id is required");
  }
  if (options.instance_id !== undefined && evidence.instance_id !== options.instance_id) {
    errors.push("workflow canonical evidence belongs to a different workflow instance");
  }
  if (options.story_id !== undefined && evidence.story_id !== options.story_id) {
    errors.push("workflow canonical evidence belongs to a different story");
  }
  if (!isPlainRecord(evidence.checks)) {
    errors.push("workflow canonical evidence checks must be an object");
  } else {
    for (const checkId of Object.values(CANONICAL_WORKFLOW_GUARD_CHECKS)) {
      const check = evidence.checks[checkId];
      if (!isPlainRecord(check) || typeof check.satisfied !== "boolean") {
        errors.push(`workflow canonical evidence check '${checkId}' must include a boolean satisfied result`);
      }
    }
  }
  if (evidence.hash_algorithm !== STABLE_JSON_HASH_ALGORITHM) {
    errors.push(`workflow canonical evidence hash_algorithm must be '${STABLE_JSON_HASH_ALGORITHM}'`);
  }
  let expectedHash = null;
  try {
    expectedHash = computeWorkflowCanonicalEvidenceHash(evidence);
  } catch (error) {
    errors.push(`workflow canonical evidence cannot be hashed: ${error.message}`);
  }
  if (!SHA256.test(String(evidence.evidence_hash || ""))) {
    errors.push("workflow canonical evidence evidence_hash is invalid");
  } else if (expectedHash !== evidence.evidence_hash) {
    errors.push("workflow canonical evidence evidence_hash does not match its content");
  }
  return immutableJson({
    valid: errors.length === 0,
    errors,
    expected_hash: expectedHash,
    actual_hash: typeof evidence.evidence_hash === "string" ? evidence.evidence_hash : null,
  });
}

export function canonicalWorkflowGuardResult(guardId, evidence) {
  const checkId = CANONICAL_WORKFLOW_GUARD_CHECKS[guardId];
  if (!checkId) throw new DomainValidationError(`Unknown canonical workflow guard '${guardId}'`);
  if (!evidence) {
    return Object.freeze({
      allowed: false,
      reason: `${humanCheckName(checkId)} must be established from canonical project records`,
    });
  }
  const integrity = validateWorkflowCanonicalEvidence(evidence);
  if (!integrity.valid) {
    return Object.freeze({
      allowed: false,
      reason: `${humanCheckName(checkId)} cannot be trusted because the canonical evidence snapshot is invalid`,
    });
  }
  const check = evidence.checks[checkId];
  return Object.freeze({
    allowed: check.satisfied === true,
    reason: check.satisfied === true
      ? `${humanCheckName(checkId)} is established by canonical project records`
      : check.issues?.[0] || `${humanCheckName(checkId)} is not established by canonical project records`,
  });
}

export function computeGovernedApprovalSubjectHash(record) {
  requirePlainRecord(record, "governed_record");
  return computeStableHash(stripApprovalVolatileFields(record));
}

function canonicalBinding(instance) {
  const binding = instance.metadata?.governance_binding;
  requirePlainRecord(binding, "workflow_instance.metadata.governance_binding");
  return {
    story_id: requireNonEmptyString(
      binding.story_id,
      "workflow_instance.metadata.governance_binding.story_id",
    ),
  };
}

function storyBindingCheck(story, storyId) {
  const issues = [];
  if (!story) issues.push(`story ${storyId} is missing`);
  else if (story.id !== storyId) issues.push(`story ${storyId} does not match the workflow binding`);
  return checkResult(issues, {
    story_ref: story?.id === storyId ? { id: story.id, hash: computeGovernedApprovalSubjectHash(story) } : null,
  });
}

function requirementApprovalCheck(story, requirements, storySatisfied) {
  const issues = [];
  const refs = Array.isArray(story?.requirement_refs) ? story.requirement_refs : [];
  if (!storySatisfied) issues.push("the bound story is unavailable or inconsistent");
  if (refs.length === 0) issues.push("the bound story has no requirement references");
  const records = new Map(requirements.map((record) => [record.id, record]));
  const verifiedRefs = [];
  for (const ref of refs) {
    const id = typeof ref?.id === "string" ? ref.id : null;
    if (!id) {
      issues.push("a story requirement reference has no id");
      continue;
    }
    const requirement = records.get(id);
    if (!requirement) {
      issues.push(`requirement ${id} is missing`);
      continue;
    }
    const approval = freshApprovedRecord(requirement);
    if (!approval.fresh) issues.push(`requirement ${id} is not currently approved with fresh content`);
    if (ref.revision !== undefined && requirement.revision !== ref.revision) {
      issues.push(`requirement ${id} revision no longer matches the story`);
    }
    if (ref.content_hash !== approval.content_hash) {
      issues.push(`requirement ${id} content no longer matches the story`);
    }
    verifiedRefs.push({
      id,
      revision: requirement.revision ?? null,
      content_hash: approval.content_hash,
      approval_id: approval.approval?.id ?? null,
    });
  }
  return checkResult(issues, { requirement_refs: verifiedRefs });
}

function contractApprovalCheck(story, contract, storyId, storySatisfied) {
  const issues = [];
  if (!storySatisfied) issues.push("the bound story is unavailable or inconsistent");
  const expectedId = typeof story?.contract_id === "string" && story.contract_id.trim()
    ? story.contract_id
    : null;
  if (!expectedId) issues.push(`story ${storyId} has no contract binding`);
  if (!contract) issues.push(`contract ${expectedId || "for the bound story"} is missing`);
  if (contract && expectedId && contract.id !== expectedId) {
    issues.push(`contract ${contract.id || "unknown"} does not match story contract ${expectedId}`);
  }
  if (contract && contract.story_id !== storyId) {
    issues.push(`contract ${contract.id || "unknown"} belongs to a different story`);
  }
  const approval = contract ? freshApprovedRecord(contract) : { fresh: false, content_hash: null, approval: null };
  if (contract && !approval.fresh) {
    issues.push(`contract ${contract.id || "unknown"} is not currently approved with fresh content`);
  }
  return checkResult(issues, {
    contract_ref: contract
      ? {
          id: contract.id ?? null,
          content_hash: approval.content_hash,
          approval_id: approval.approval?.id ?? null,
        }
      : null,
  });
}

function requiredOutputLinkCheck(contract, registry, storyId, contractSatisfied) {
  const issues = [];
  if (!contractSatisfied) issues.push("the approved contract is unavailable or inconsistent");
  const refs = Array.isArray(contract?.output_contract_refs) ? contract.output_contract_refs : [];
  if (refs.length === 0) issues.push("the approved contract declares no required outputs");
  const links = Array.isArray(registry?.links) ? registry.links : [];
  const matched = [];
  for (const ref of refs) {
    const matches = links.filter((link) =>
      link?.story_id === storyId
      && link?.artifact_type === ref?.artifact_type
      && link?.template_id === ref?.template_id
      && link?.mode === ref?.mode);
    if (matches.length !== 1) {
      issues.push(
        matches.length === 0
          ? `required output ${ref?.artifact_type || "unknown"} is not linked`
          : `required output ${ref?.artifact_type || "unknown"} has ambiguous canonical links`,
      );
      continue;
    }
    const link = matches[0];
    const verification = link.verification_receipt;
    if (
      verification?.passed !== true
      || verification?.status !== "passed"
      || verification?.subject_ref?.id !== link.id
    ) {
      issues.push(`required output ${ref?.artifact_type || "unknown"} has no passing bound verification`);
    }
    if (verification && !validReceiptHash(verification)) {
      issues.push(`required output ${ref?.artifact_type || "unknown"} verification failed integrity validation`);
    }
    if (
      verification
      && (
        link.verification_receipt_ref?.id !== verification.id
        || link.verification_receipt_ref?.hash !== verification.receipt_hash
      )
    ) {
      issues.push(`required output ${ref?.artifact_type || "unknown"} verification reference is stale`);
    }
    matched.push({
      id: link.id,
      artifact_type: link.artifact_type,
      template_id: link.template_id,
      mode: link.mode,
      artifact_hash: link.fingerprints?.artifact_sha256 ?? null,
      verification_receipt_id: verification?.id ?? null,
      updated_at: link.updated_at ?? link.created_at ?? null,
    });
  }
  return checkResult(issues, {
    required_count: refs.length,
    linked_count: matched.length,
    link_refs: matched,
  });
}

function strictGateCheck(gate, storyId, outputCheck, deliveryCheck) {
  const issues = [];
  if (!gate) issues.push(`strict gate result for story ${storyId} is missing`);
  if (gate && (
    gate.kind !== "workflow_final_gate_receipt"
    || gate.schema_version !== WORKFLOW_FINAL_GATE_RECEIPT_SCHEMA
  )) {
    issues.push("strict gate result is not a governed final lifecycle receipt");
  }
  if (gate && !validReceiptHash(gate)) {
    issues.push("strict gate final receipt failed integrity validation");
  }
  if (gate && gate.story_id !== storyId) issues.push("strict gate result belongs to a different story");
  if (gate && gate.scope !== "story") issues.push("strict gate result is not story-scoped");
  if (gate && gate.strict !== true) issues.push("gate result was not produced in strict mode");
  if (gate && gate.status !== "passed") issues.push("strict gate did not pass");
  if (gate && Array.isArray(gate.errors) && gate.errors.length > 0) {
    issues.push("strict gate contains blocking errors");
  }
  const checkedAt = validInstant(gate?.checked_at);
  if (gate && !checkedAt) issues.push("strict gate has no valid checked_at timestamp");
  const latestDependency = latestInstant([
    ...((outputCheck.link_refs || []).map((ref) => ref.updated_at)),
    deliveryCheck.closed_at,
  ]);
  if (checkedAt && latestDependency && checkedAt < latestDependency) {
    issues.push("strict gate result predates required output or delivery evidence");
  }
  return checkResult(issues, {
    checked_at: checkedAt,
    status: gate?.status ?? null,
    receipt_hash: gate?.receipt_hash ?? null,
  });
}

function deliveryTerminalCheck(story, contract, profile, close, storyId, contractSatisfied) {
  const issues = [];
  if (!contractSatisfied) issues.push("the approved contract is unavailable or inconsistent");
  const expectedProfileId = contract?.delivery_execution_profile_id || null;
  if (!expectedProfileId) issues.push("the approved contract has no exact delivery profile");
  if (!profile) issues.push(`delivery profile ${expectedProfileId || "for the bound story"} is missing`);
  if (profile && profile.id !== expectedProfileId) {
    issues.push(`delivery profile ${profile.id || "unknown"} does not match the approved contract`);
  }
  const storyRefs = Array.isArray(profile?.story_refs) ? profile.story_refs : [];
  const storyRef = storyRefs.find((ref) => ref?.id === storyId);
  const currentStoryHash = story ? computeGovernedApprovalSubjectHash(story) : null;
  if (profile && (!storyRef || storyRef.hash !== currentStoryHash)) {
    issues.push("delivery profile does not bind the current story content");
  }
  const contractRefs = Array.isArray(profile?.contract_refs) ? profile.contract_refs : [];
  const contractRef = contractRefs.find((ref) => ref?.id === contract?.id);
  const currentContractHash = contract ? computeGovernedApprovalSubjectHash(contract) : null;
  if (profile && (!contractRef || contractRef.hash !== currentContractHash)) {
    issues.push("delivery profile does not bind the current approved contract content");
  }
  if (!close) issues.push(`delivery ${profile?.delivery_id || "for the bound story"} has no terminal receipt`);
  if (close && close.profile_ref?.id !== profile?.id) {
    issues.push("delivery terminal receipt belongs to a different profile");
  }
  if (close && close.profile_ref?.hash !== profile?.profile_hash) {
    issues.push("delivery terminal receipt does not bind the current delivery profile");
  }
  if (
    close
    && (
      close.delivery?.id !== profile?.delivery_id
      || close.delivery?.kind !== profile?.delivery_kind
    )
  ) {
    issues.push("delivery terminal receipt belongs to a different delivery");
  }
  if (close && !SUCCESSFUL_DELIVERY_TERMINAL_STATUSES.has(close.terminal_status)) {
    issues.push(`delivery terminal outcome '${close.terminal_status || "unknown"}' is not successful`);
  }
  if (close && !validReceiptHash(close)) {
    issues.push("delivery terminal receipt failed integrity validation");
  }
  const closedAt = validInstant(close?.closed_at);
  if (close && !closedAt) issues.push("delivery terminal receipt has no valid closed_at timestamp");
  return checkResult(issues, {
    profile_id: profile?.id ?? null,
    delivery_id: profile?.delivery_id ?? null,
    delivery_kind: profile?.delivery_kind ?? null,
    close_receipt_id: close?.id ?? null,
    terminal_status: close?.terminal_status ?? null,
    closed_at: closedAt,
  });
}

function freshApprovedRecord(record) {
  const approvals = Array.isArray(record?.approvals) ? [...record.approvals] : [];
  const latest = approvals
    .sort((left, right) => String(left?.created_at || "").localeCompare(String(right?.created_at || "")))
    .at(-1) ?? null;
  const contentHash = computeGovernedApprovalSubjectHash(record);
  return {
    fresh: record.status === "approved"
      && latest?.status === "approved"
      && latest?.approved_content_hash === contentHash,
    content_hash: contentHash,
    approval: latest,
  };
}

function validReceiptHash(receipt) {
  if (!SHA256.test(String(receipt?.receipt_hash || ""))) return false;
  return receipt.hash_algorithm === STABLE_JSON_HASH_ALGORITHM
    && computeReceiptHash(receipt) === receipt.receipt_hash;
}

function computeReceiptHash(receipt) {
  const {
    receipt_hash: ignoredReceiptHash,
    hash_algorithm: ignoredHashAlgorithm,
    ...subject
  } = receipt;
  return computeStableHash(subject);
}

function stripApprovalVolatileFields(value, depth = 0) {
  if (Array.isArray(value)) return value.map((item) => stripApprovalVolatileFields(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  const volatile = depth === 0
    ? new Set([
        "__path",
        "__relative_path",
        "approvals",
        "audit",
        "created_at",
        "updated_at",
        "approved_at",
        "approved_by",
        "status",
      ])
    : new Set();
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter((key) => !volatile.has(key))
      .map((key) => [key, stripApprovalVolatileFields(value[key], depth + 1)]),
  );
}

function checkResult(issues, details = {}) {
  return {
    satisfied: issues.length === 0,
    issues,
    ...details,
  };
}

function optionalRecord(value, label) {
  if (value === undefined || value === null) return null;
  return requirePlainRecord(value, label);
}

function normalizeRecordList(value, label) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new DomainValidationError(`${label} must be an array`);
  return value.map((record, index) => requirePlainRecord(record, `${label}[${index}]`));
}

function normalizeObservedAt(value) {
  const normalized = value ?? new Date().toISOString();
  const parsed = validInstant(normalized);
  if (!parsed) throw new DomainValidationError("workflow_canonical_evidence_input.observed_at must be an ISO instant");
  return parsed;
}

function validInstant(value) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function latestInstant(values) {
  return values
    .map(validInstant)
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;
}

function humanCheckName(checkId) {
  return {
    requirement_approved: "The approved requirement",
    contract_approved: "The approved work contract",
    required_output_linked: "The required canonical output",
    strict_gate_passed: "The strict story gate",
    delivery_terminal: "The exact delivery terminal receipt",
  }[checkId] ?? checkId;
}
