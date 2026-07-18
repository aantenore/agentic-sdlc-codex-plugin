import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  REDACTION_LIMIT_PLACEHOLDER,
  REDACTION_PLACEHOLDER,
  createRedactionPolicy,
  createOperationalRedactionPolicy,
  isAllowedIdentifier,
  redactText,
  redactValue,
  redactValueWithMetadata,
} from "../../lib/observability/redaction.mjs";

test("recursive redaction is immutable, idempotent, and preserves approved identifiers", () => {
  const policy = createRedactionPolicy({
    secrets: ["sk_live_very-secret"],
    piiPatterns: [{ name: "email", pattern: /owner@example\.com/iu }],
  });
  const sha = "a".repeat(64);
  const uuid = "123e4567-e89b-12d3-a456-426614174000";
  const correlationId = `corr-${uuid}`;
  const actionId = "AUT-ACT-20260718112254904-6a4356";
  const source = {
    contact: "owner@example.com",
    nested: [{ password: "do-not-persist", note: "uses sk_live_very-secret" }],
    sha,
    uuid,
    correlation_id: correlationId,
    authorization_receipt: actionId,
  };

  const result = redactValue(source, policy);
  assert.deepEqual(result, {
    contact: REDACTION_PLACEHOLDER,
    nested: [{ password: REDACTION_PLACEHOLDER, note: `uses ${REDACTION_PLACEHOLDER}` }],
    sha,
    uuid,
    correlation_id: correlationId,
    authorization_receipt: actionId,
  });
  assert.equal(source.contact, "owner@example.com");
  assert.equal(source.nested[0].password, "do-not-persist");
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.nested[0]), true);
  assert.deepEqual(redactValue(result, policy), result);
  assert.equal(isAllowedIdentifier(sha, policy), true);
  assert.equal(isAllowedIdentifier(uuid, policy), true);
  assert.equal(isAllowedIdentifier(correlationId, policy), true);
  assert.equal(isAllowedIdentifier(actionId, policy), true);
});

test("recursive redaction preserves an own __proto__ data property without prototype pollution", () => {
  const source = JSON.parse(
    '{"safe":"value","__proto__":{"polluted":true,"nested":{"kept":"yes"}}}',
  );

  const output = redactValue(source);
  const descriptor = Object.getOwnPropertyDescriptor(output, "__proto__");

  assert.equal(Object.getPrototypeOf(output), Object.prototype);
  assert.equal(Object.hasOwn(output, "__proto__"), true);
  assert.equal(descriptor?.enumerable, true);
  assert.equal(Object.hasOwn(descriptor, "value"), true);
  assert.equal(descriptor?.get, undefined);
  assert.equal(descriptor?.set, undefined);
  assert.deepEqual(descriptor?.value, {
    polluted: true,
    nested: { kept: "yes" },
  });
  assert.equal(output.polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(Object.isFrozen(output), true);
  assert.equal(Object.isFrozen(output.__proto__), true);
  assert.equal(Object.isFrozen(output.__proto__.nested), true);
});

test("explicit secrets and sensitive keys take precedence over identifier allowlisting", () => {
  const actionId = "AUT-ACT-20260718112254904-6a4356";
  const policy = createRedactionPolicy({ secrets: [actionId] });

  assert.equal(redactText(actionId, policy), REDACTION_PLACEHOLDER);
  assert.deepEqual(redactValue({ token: "a".repeat(64) }, policy), {
    token: REDACTION_PLACEHOLDER,
  });
});

test("operational credential context overrides SHA-shaped identifier allowlisting", () => {
  const shaShapedSecret = "a".repeat(64);
  const policy = createOperationalRedactionPolicy();

  assert.equal(redactText(shaShapedSecret, policy), shaShapedSecret);
  assert.equal(redactText(`token=${shaShapedSecret}`, policy), REDACTION_PLACEHOLDER);
  assert.equal(redactText(`Bearer ${shaShapedSecret}`, policy), REDACTION_PLACEHOLDER);
});

test("broad custom identifier allowlists cannot bypass credentials or configured PII", () => {
  const token = `ghp_${"A".repeat(36)}`;
  const uuid = "550e8400-e29b-41d4-a716-446655440000";
  const policy = createOperationalRedactionPolicy({
    identifierAllowPatterns: [{ name: "unsafe_broad_allow", pattern: "^.{1,256}$" }],
    piiPatterns: [{ name: "configured_uuid", pattern: "[a-f0-9-]{36}" }],
  });

  assert.equal(redactText(token, policy), REDACTION_PLACEHOLDER);
  assert.equal(redactText(uuid, policy), REDACTION_PLACEHOLDER);
});

test("operational policy preserves a realistic governed model without false positives", () => {
  const policy = createOperationalRedactionPolicy();
  const requirementId = "REQ-ENT-OBSERVABILITY-001";
  const contractId = "contract-ST-ENT-OBSERVABILITY-implementation";
  const storyId = "ST-ENT-OBSERVABILITY";
  const artifactPath = `.sdlc/stories/${storyId}/outputs/${contractId}.md`;
  const rawHref = `/api/v1/source?path=${encodeURIComponent(artifactPath)}`;
  const gitSha = "0123456789abcdef0123456789abcdef01234567";
  const sha = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const uuid = "550e8400-e29b-41d4-a716-446655440000";
  const correlationId = `corr-${uuid}`;
  const actionId = "AUT-ACT-20260718123456789-abcdef";
  const model = {
    schema_version: "change-observatory-model:v1",
    requirement: { id: requirementId, story_ids: [storyId] },
    contract: { id: contractId, requirement_id: requirementId, story_id: storyId },
    source: { file: artifactPath, rawHref },
    lineage: {
      git_sha: gitSha,
      sha256: sha,
      uuid,
      correlation_id: correlationId,
      authorization_receipt: actionId,
    },
  };

  const result = redactValueWithMetadata(model, policy);
  assert.deepEqual(result.value, model);
  assert.equal(result.redactions, 0);
  assert.equal(result.limited, false);
  for (const identifier of [
    requirementId,
    contractId,
    storyId,
    artifactPath,
    rawHref,
    gitSha,
    sha,
    uuid,
    correlationId,
    actionId,
  ]) {
    assert.equal(JSON.stringify(result.value).includes(identifier), true, `${identifier} was incorrectly redacted`);
  }
});

test("operational policy redacts known tokens, credential assignments, and Bearer credentials", () => {
  const policy = createOperationalRedactionPolicy();
  const knownTokens = [
    `github_pat_${"A".repeat(32)}`,
    `ghp_${"B".repeat(36)}`,
    `ghr_${"R".repeat(36)}`,
    `AKIA${"C".repeat(16)}`,
    `glpat-${"d".repeat(24)}`,
    `sk_live_${"e".repeat(24)}`,
    `sk-${"O".repeat(32)}`,
    `sk-proj-${"P".repeat(32)}`,
    `xoxb-${"1".repeat(20)}`,
    [`eyJ${"H".repeat(20)}`, "P".repeat(32), "S".repeat(43)].join("."),
  ];

  for (const token of knownTokens) {
    assert.equal(redactText(token, policy), REDACTION_PLACEHOLDER, token.slice(0, 8));
  }
  assert.equal(
    redactText(`client_secret=${"S".repeat(32)}`, policy),
    REDACTION_PLACEHOLDER,
  );
  assert.equal(
    redactText(`Bearer ${"a".repeat(40)}`, policy),
    REDACTION_PLACEHOLDER,
  );
  assert.equal(
    redactText(`Basic ${Buffer.from("user:password").toString("base64")}`, policy),
    REDACTION_PLACEHOLDER,
  );
  for (const assignment of [
    `AWS_SECRET_ACCESS_KEY=${"A".repeat(40)}`,
    `GOOGLE_API_KEY=${"B".repeat(39)}`,
    `AZURE_STORAGE_ACCOUNT_KEY=${"C".repeat(44)}`,
    `MY_CLIENT_SECRET=${"E".repeat(32)}`,
    'password="p@ssw0rd!"',
    'client_secret: "correct horse battery staple"',
    '"password":"p@ssw0rd!"',
    '"client_secret":"correct horse battery staple"',
    `authorization: Basic ${Buffer.from("user:password").toString("base64")}`,
    'password="escaped \\" quote"',
  ]) {
    assert.equal(redactText(assignment, policy), REDACTION_PLACEHOLDER, assignment.slice(0, 16));
  }
  assert.equal(
    redactText('password="p@ssw0rd!" status=failed', policy),
    `${REDACTION_PLACEHOLDER} status=failed`,
  );
  for (const header of [
    "Cookie: sessionid=abcdefghijklmnop",
    "Set-Cookie: sid=abcdefghijklmnop; HttpOnly; Secure",
  ]) {
    assert.equal(redactText(header, policy), REDACTION_PLACEHOLDER);
  }
  assert.equal(
    redactText('payload {"password":"p@ssw0rd!"}', policy).includes("p@ssw0rd!"),
    false,
  );
  assert.equal(
    redactText(
      `-----BEGIN ENCRYPTED PRIVATE KEY-----\n${"A".repeat(64)}\n-----END ENCRYPTED PRIVATE KEY-----`,
      policy,
    ),
    REDACTION_PLACEHOLDER,
  );
  for (const longCredential of [
    `token=${"A".repeat(250_000)}`,
    `ghp_${"A".repeat(250_000)}`,
    `Bearer ${"A".repeat(250_000)}`,
  ]) {
    assert.equal(redactText(longCredential, policy), REDACTION_PLACEHOLDER);
  }
});

test("operational policy redacts complete URL userinfo without consuming the host or resource", () => {
  const policy = createOperationalRedactionPolicy();
  const cases = [
    {
      input: "https://user:password@example.test/path",
      expected: `${REDACTION_PLACEHOLDER}example.test/path`,
    },
    {
      input: "https://user:p@ss@localhost/path@visible",
      expected: `${REDACTION_PLACEHOLDER}localhost/path@visible`,
    },
    {
      input: "ssh://us@er:p@ss@host.test/resource",
      expected: `${REDACTION_PLACEHOLDER}host.test/resource`,
    },
    {
      input: "x://:password@host.test/resource",
      expected: `${REDACTION_PLACEHOLDER}host.test/resource`,
    },
    {
      input: "https://user:@host.test/resource",
      expected: `${REDACTION_PLACEHOLDER}host.test/resource`,
    },
    {
      input: "https://user:p@ss@localhost?next=handle@localhost#fragment",
      expected: `${REDACTION_PLACEHOLDER}localhost?next=handle@localhost#fragment`,
    },
  ];

  for (const { input, expected } of cases) {
    assert.equal(redactText(input, policy), expected, input);
  }
  assert.equal(
    redactText("https://public.example:443?next=handle@localhost", policy),
    "https://public.example:443?next=handle@localhost",
  );
});

test("redacts credential and configured PII property names without collisions", () => {
  const token = `github_pat_${"A".repeat(32)}`;
  const policy = createOperationalRedactionPolicy({
    piiPatterns: [{ name: "employee", pattern: "EMP-[0-9]{6}" }],
  });
  const source = {
    [token]: "credential-key",
    "EMP-123456": "pii-key",
    "[REDACTED]": "literal-placeholder-key",
  };

  const result = redactValue(source, policy);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(token), false);
  assert.equal(serialized.includes("EMP-123456"), false);
  assert.equal(Object.keys(result).length, 3);
  assert.deepEqual(Object.values(result).sort(), [
    "credential-key",
    "literal-placeholder-key",
    "pii-key",
  ]);
  assert.equal(new Set(Object.keys(result)).size, 3);
});

test("redaction limits and cycles fail closed without retaining partial values", () => {
  const depthPolicy = createRedactionPolicy({ limits: { maxDepth: 2 } });
  const result = redactValueWithMetadata({ a: { b: { c: "must-not-leak" } } }, depthPolicy);
  assert.deepEqual(result, {
    value: REDACTION_LIMIT_PLACEHOLDER,
    redactions: 0,
    limited: true,
    limit: "maxDepth",
  });

  const cycle = { safe: "prefix", secret: "must-not-leak" };
  cycle.self = cycle;
  assert.equal(redactValue(cycle), REDACTION_LIMIT_PLACEHOLDER);

  const throwingGetter = {};
  Object.defineProperty(throwingGetter, "value", {
    enumerable: true,
    get() {
      throw new Error("raw getter failure");
    },
  });
  assert.deepEqual(redactValueWithMetadata(throwingGetter), {
    value: REDACTION_LIMIT_PLACEHOLDER,
    redactions: 0,
    limited: true,
    limit: "redactionFailure",
  });

  const stringPolicy = createRedactionPolicy({ limits: { maxStringLength: 4 } });
  assert.equal(redactText("12345", stringPolicy), REDACTION_LIMIT_PLACEHOLDER);
});

test("policy construction rejects unsafe or unbounded configuration", () => {
  assert.throws(
    () => createRedactionPolicy({ piiPatterns: [/(?:)/u] }),
    /must not match an empty string/u,
  );
  assert.throws(
    () => createRedactionPolicy({ limits: { unknown: 10 } }),
    /Unknown redaction limit/u,
  );
  assert.throws(
    () => createRedactionPolicy({ secrets: [REDACTION_PLACEHOLDER] }),
    /conflicts with a redaction placeholder/u,
  );
  assert.throws(
    () => createRedactionPolicy({ piiPatterns: ["(a+)+$"] }),
    /unbounded quantifier|nested or ambiguous quantified group/u,
  );
  assert.throws(
    () => createRedactionPolicy({ secretPatterns: ["(a|aa)+$"] }),
    /unbounded quantifier|nested or ambiguous quantified group/u,
  );
  assert.throws(
    () => createRedactionPolicy({ secretPatterns: ["(a)\\1"] }),
    /backreferences/u,
  );
  assert.throws(
    () => createRedactionPolicy({ piiPatterns: ["a+a+$"] }),
    /unbounded quantifier/u,
  );
  assert.throws(
    () => createRedactionPolicy({ piiPatterns: [".*.*x"] }),
    /unbounded quantifier/u,
  );
  assert.throws(
    () => createRedactionPolicy({
      piiPatterns: ["[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}"],
    }),
    /unbounded quantifier/u,
  );
  assert.throws(
    () => createRedactionPolicy({ piiPatterns: ["a+$"] }),
    /unbounded quantifier/u,
  );
  assert.throws(
    () => createRedactionPolicy({ piiPatterns: ["a{1,4096}$"] }),
    /safe maximum/u,
  );
});

test("adversarial configurable patterns are rejected within a child-process deadline", () => {
  const moduleUrl = new URL("../../lib/observability/redaction.mjs", import.meta.url).href;
  for (const pattern of ["a+a+$", ".*.*x", "a+$", "a{1,4096}$"]) {
    const script = [
      `import { createRedactionPolicy, redactText } from ${JSON.stringify(moduleUrl)};`,
      "try {",
      `  const policy = createRedactionPolicy({ piiPatterns: [${JSON.stringify(pattern)}] });`,
      "  redactText(`${\"a\".repeat(50_000)}!`, policy);",
      "  process.stdout.write('accepted');",
      "} catch {",
      "  process.stdout.write('rejected');",
      "}",
    ].join("\n");
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
      encoding: "utf8",
      timeout: 2_000,
    });
    assert.equal(result.error, undefined, `${pattern} exceeded the safety deadline`);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "rejected");
  }
});

test("the default bounded email detector completes on maximum-size non-email input", () => {
  const moduleUrl = new URL("../../lib/observability/redaction.mjs", import.meta.url).href;
  const script = [
    `import { createOperationalRedactionPolicy, redactText } from ${JSON.stringify(moduleUrl)};`,
    "const policy = createOperationalRedactionPolicy();",
    "redactText('a'.repeat(262_144), policy);",
    "process.stdout.write('completed');",
  ].join("\n");
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
    encoding: "utf8",
    timeout: 2_000,
  });
  assert.equal(result.error, undefined, "default email detection exceeded the safety deadline");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "completed");
});

test("the bounded URL userinfo detector completes on maximum-size ambiguous input", () => {
  const moduleUrl = new URL("../../lib/observability/redaction.mjs", import.meta.url).href;
  const script = [
    `import { createOperationalRedactionPolicy, redactText } from ${JSON.stringify(moduleUrl)};`,
    "const policy = createOperationalRedactionPolicy();",
    "redactText(`https://user:${'a'.repeat(262_100)}/path`, policy);",
    "redactText(`https://user:${'a@'.repeat(120_000)}host.test/path`, policy);",
    "process.stdout.write('completed');",
  ].join("\n");
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
    encoding: "utf8",
    timeout: 2_000,
  });
  assert.equal(result.error, undefined, "default URL userinfo detection exceeded the safety deadline");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "completed");
});
