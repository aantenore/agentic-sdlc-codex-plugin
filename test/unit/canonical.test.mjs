import test from "node:test";
import assert from "node:assert/strict";

import {
  canonicalJson,
  computeStableHash,
  immutableJson,
} from "../../lib/canonical.mjs";

test("canonical JSON and hashes are independent of object insertion order", () => {
  const left = { z: 1, nested: { beta: true, alpha: "x" }, a: [3, 2, 1] };
  const right = { a: [3, 2, 1], nested: { alpha: "x", beta: true }, z: 1 };

  assert.equal(canonicalJson(left), canonicalJson(right));
  assert.equal(computeStableHash(left), computeStableHash(right));
  assert.notEqual(computeStableHash(left), computeStableHash({ ...right, a: [1, 2, 3] }));
});

test("canonical object ordering is locale-independent code-unit ordering", () => {
  assert.equal(canonicalJson({ ä: 3, a: 2, Z: 1 }), '{"Z":1,"a":2,"ä":3}');
});

test("canonical JSON rejects ambiguous or unsupported values", () => {
  assert.throws(() => canonicalJson([undefined]), /undefined array item/);
  assert.throws(() => canonicalJson({ value: Number.POSITIVE_INFINITY }), /non-finite number/);
  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(() => canonicalJson(cyclic), /cycles/);
});

test("immutableJson clones and recursively freezes the result", () => {
  const source = { nested: { value: 1 }, list: [{ id: "a" }] };
  const result = immutableJson(source);
  source.nested.value = 2;

  assert.equal(result.nested.value, 1);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.nested), true);
  assert.equal(Object.isFrozen(result.list[0]), true);
  assert.throws(() => {
    result.nested.value = 3;
  }, TypeError);
});
