import { findSimdCallersWithoutSimd, wasmToText } from '@pierre/wat-tools';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const text = wasmToText(
  readFileSync(new URL('../dist/md.wasm', import.meta.url))
);

// JavaScriptCore can inline SIMD code into a function compiled with the scalar
// register convention, and ARM64 calls then lose the high half of its constants.
void test('every caller of a SIMD function uses SIMD itself', () => {
  const { functions, simd, violations } = findSimdCallersWithoutSimd(text);
  assert.ok(functions > 50, 'found the module functions');
  assert.ok(simd > 10, 'found the SIMD scanners');
  assert.deepEqual(violations, []);
});

// JavaScriptCore's conditional-compare fusion miscompiles a branch that negates
// a compound condition. See wrapCompoundNegations in @pierre/wat-tools.
void test('no i32.eqz negates a compound condition', () => {
  assert.equal(text.match(/\(\s*i32\.eqz\s*\(\s*i32\.(?:and|or)\b/), null);
  assert.match(text, /\(i32\.shr_u\s*\(i32\.clz/);
});
