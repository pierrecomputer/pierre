import assert from 'node:assert/strict';
import test from 'node:test';

import { HighlightsHighlighter, langIdOf } from '../lib/highlighter';
import type { Lang } from '../lib/index';
import {
  listTokenTypes,
  optimizeWasm,
  transformWat,
  wasmToText,
  wat2wasm,
} from '../scripts/build';
import { cssVariables, pierreDark } from '../themes/index';
import { samples } from './_samples';

const words = Array.from({ length: 30 }, (_, i) =>
  'abcdefghijklmnopqrstuvwxyzabcde'.slice(0, i + 2)
);
const commonUrl = new URL('./common.wat', import.meta.url);
const common = transformWat(
  commonUrl,
  `(module
    (memory (export "memory") 3)
    (import "../src/common.wat")
    (keyword-table $Test $mem.cWords $mem.cppWords
      ${words.map((word) => `(group ${word.length} "${word}")`).join('\n')})
    (func (export "lookup") (param $n i32) (result i32)
      (keyword-table.value $Test (i32.const 65536)
        (i32.add (i32.const 65536) (local.get $n))))
    (func (export "lower") (param $n i32) (result i32)
      (call $lexLowerCopy (i32.const 65536)
        (i32.add (i32.const 65536) (local.get $n))
        (i32.const $mem.lexLowerScratch)))
    (global (export "scratch") i32 (i32.const $mem.lexLowerScratch)))`
);
const instance = new WebAssembly.Instance(
  new WebAssembly.Module(wat2wasm(commonUrl.pathname, common.code))
);
const { memory, lookup, lower, scratch } = instance.exports as {
  memory: WebAssembly.Memory;
  lookup: (length: number) => number;
  lower: (length: number) => number;
  scratch: WebAssembly.Global;
};
const bytes = new Uint8Array(memory.buffer);
const enc = new TextEncoder();

void test('keyword SIMD compares every byte at lengths 2 through 31', () => {
  for (const word of words) {
    const input = enc.encode(word);
    for (const padding of [0, 0xff]) {
      bytes.fill(padding, 65536, 65600);
      bytes.set(input, 65536);
      assert.equal(lookup(input.length), input.length, word);
      for (let i = 0; i < input.length; i++) {
        bytes[65536 + i] ^= 32;
        assert.equal(lookup(input.length), -1, `${word}, byte ${i}`);
        bytes[65536 + i] ^= 32;
      }
    }
  }
  for (const length of [0, 1, 32, 64]) {
    assert.equal(lookup(length), -1);
  }
});

void test('lowercase SIMD preserves non-letters and stays inside scratch', () => {
  const dst = Number(scratch.value);
  for (let length = 0; length <= 32; length++) {
    for (let first = 0; first < 256; first += 16) {
      const input = Uint8Array.from({ length }, (_, i) => (first + i) & 255);
      bytes.fill(0xa5, dst, dst + 80);
      bytes.set(input, 65536);
      assert.equal(lower(length), length > 31 ? 0 : length);
      if (length <= 31) {
        assert.deepEqual(
          bytes.slice(dst, dst + length),
          input.map((c) => (c >= 65 && c <= 90 ? c + 32 : c))
        );
      } else {
        assert.ok(bytes.subarray(dst, dst + 64).every((c) => c === 0xa5));
      }
      assert.ok(bytes.subarray(dst + 64, dst + 80).every((c) => c === 0xa5));
    }
  }
});

void test(
  'optimized Wasm preserves every language in all output modes',
  { timeout: 60_000 },
  () => {
    const url = new URL('../src/highlights.wat', import.meta.url);
    const wasm = wat2wasm(url.pathname, transformWat(url).code);
    const optimized = optimizeWasm(wasm);
    const highlighters = [wasm, optimized].map(
      (binary) => new HighlightsHighlighter(new WebAssembly.Module(binary))
    );
    for (const [lang, { code }] of Object.entries(samples)) {
      for (const theme of [pierreDark, cssVariables]) {
        const output = highlighters.map((hl) =>
          hl.codeToHtml(code, { lang: lang as Lang, theme }).slice()
        );
        assert.deepEqual(output[1], output[0], `${lang}: HTML`);
      }
      const output = highlighters.map((hl) =>
        hl.tokenizeLineRecords(langIdOf(lang), hl.writeInput(code)).slice()
      );
      assert.deepEqual(output[1], output[0], `${lang}: tokenizeLineRecords`);
    }
  }
);

// JavaScriptCore compiles a function with the SIMD register convention only
// when the function's own bytecode uses SIMD, but its optimizing tier inlines
// small callees. Without the marker the build adds (markSimdReachers in
// scripts/build.ts), a lexer that inlined a scanner kept the scanner's vector
// constants in callee-saved registers across calls and lost their upper
// halves on Bun 1.4. The invariant is local - every direct caller of a SIMD
// function uses SIMD itself, through an instruction or a v128 local - and
// covers transitive callers by induction. Binaryen drops unused locals, so
// the optimized module is checked as well; there, calls name functions by
// index.
void test(
  'every caller of a SIMD function uses SIMD itself, before and after Binaryen',
  { timeout: 60_000 },
  () => {
    const url = new URL('../src/highlights.wat', import.meta.url);
    const { code } = transformWat(url);
    const optimized = wasmToText(optimizeWasm(wat2wasm(url.pathname, code)));
    for (const [label, text] of [
      ['preprocessed source', code],
      ['optimized module', optimized],
    ] as const) {
      const usesSimd =
        /\b(?:v128|[if](?:8x16|16x8|32x4|64x2))\.|\(local\b[^()]*\bv128\b/;
      const imported = (text.match(/\(import\b[^\n]*\(func\b/g) ?? []).length;
      const funcs: { name: string; body: string }[] = [];
      const starts = [...text.matchAll(/^\s*\(func(?:\s+(\$[^\s()]+))?/gm)];
      for (const [i, m] of starts.entries()) {
        const end = starts[i + 1]?.index ?? text.length;
        funcs.push({
          name: m[1] ?? `#${i + imported}`,
          body: text.slice(m.index, end).replace(/"(?:[^"\\]|\\.)*"/g, '""'),
        });
      }
      assert.ok(funcs.length > 300, `${label}: found the module functions`);
      const simd = new Set(
        funcs.flatMap((f, i) =>
          usesSimd.test(f.body) ? [f.name, `#${i + imported}`] : []
        )
      );
      assert.ok(simd.size > 40, `${label}: found the SIMD scanners`);
      for (const f of funcs) {
        if (simd.has(f.name)) continue;
        const callees = [...f.body.matchAll(/\bcall\s+(\$[^\s()]+|\d+)/g)].map(
          (m) => (/^\d+$/.test(m[1]) ? `#${m[1]}` : m[1])
        );
        const simdCallee = callees.find((c) => simd.has(c));
        assert.equal(
          simdCallee,
          undefined,
          `${label}: ${f.name} calls ${simdCallee} without using SIMD`
        );
        assert.ok(
          !/\bcall_indirect\b/.test(f.body),
          `${label}: ${f.name} uses call_indirect without using SIMD`
        );
      }
    }
  }
);

void test('SIMD markers resolve numeric calls after imported functions', () => {
  const url = new URL('./simd-imports.wat', import.meta.url);
  for (const callee of ['$simd', '1']) {
    const { code } = transformWat(
      url,
      `(module
        (import "env" "hook" (func $hook))
        (func $simd (drop (v128.const i32x4 0 0 0 0)))
        (func $direct (call ${callee}))
        (func (export "run") (call 2))
        (func $scalar (call 0)))`
    );
    assert.match(code, /\(func \$direct\s+\(local v128\)/, callee);
    assert.match(code, /\(func \(export "run"\)\s+\(local v128\)/, callee);
    assert.match(code, /\(func \$scalar\s+\(call 0\)/, callee);
    assert.ok(WebAssembly.validate(wat2wasm(url.pathname, code)));
  }
});

// JavaScriptCore's ccmp fusion (see wrapCompoundNegations in scripts/build.ts)
// miscompiles a branch whose and/or tree negates a compound condition. The
// build rewrites every such negation in the preprocessed source and again
// after Binaryen, which can rebuild one from `and(eqz(a), eqz(b))`.
void test(
  'no i32.eqz negates a compound condition, before or after Binaryen',
  { timeout: 60_000 },
  () => {
    const url = new URL('../src/highlights.wat', import.meta.url);
    const { code } = transformWat(url);
    const compound = /\(\s*i32\.eqz\s*\(\s*i32\.(?:and|or)\b/;
    assert.equal(code.match(compound), null, 'preprocessed source');
    const optimized = wasmToText(optimizeWasm(wat2wasm(url.pathname, code)));
    assert.equal(optimized.match(compound), null, 'optimized module');
    // the rewrite must not have removed the negations themselves
    assert.ok(
      /\(i32\.shr_u\s*\(i32\.clz/.test(optimized),
      'rewritten form present'
    );
  }
);

void test('Wasm rewrites preserve all SIMD byte values, mixed lanes and quoted data', () => {
  const stores = Array.from(
    { length: 256 },
    (_, byte) => `(v128.store offset=${byte * 16} (local.get $p)
      (v128.const i8x16 ${Array<number>(16).fill(byte).join(' ')}))`
  );
  const data = [
    'v128.const i32x4 0x01010101 0x01010101 0x01010101 0x01010101',
    '(v128.const i32x4 0x01010101 0x01010101 0x01010101 0x01010101)',
    '(i32.eqz (i32.or (i32.const 0) (i32.const 1)))',
    '"escaped" \\ (i32.eqz (i32.and (i32.const 0) (i32.const 1)))',
    '(i32.eqz',
  ].join('\n');
  const source = `(module
      (memory (export "memory") 1)
      (data (i32.const 5000) ${JSON.stringify(data)})
      (func (export "write") (param $p i32)
        ${stores.join('\n')}
        (v128.store offset=4096 (local.get $p)
          (v128.const i32x4 0x01020304 0x01020304 0x01020304 0x01020304))
        (v128.store offset=4112 (local.get $p)
          (v128.const i32x4 0x01010101 0x02020202 0x03030303 0x04040404))))`;
  const url = new URL('./splats.wat', import.meta.url);
  const wasm = wat2wasm(url.pathname, source);
  const preprocessed = wat2wasm(url.pathname, transformWat(url, source).code);
  const output = [
    wasm,
    preprocessed,
    optimizeWasm(wasm),
    optimizeWasm(preprocessed),
  ].map((binary) => {
    const instance = new WebAssembly.Instance(new WebAssembly.Module(binary));
    (instance.exports.write as (ptr: number) => void)(0);
    return new Uint8Array(
      (instance.exports.memory as WebAssembly.Memory).buffer
    );
  });
  for (const actual of output.slice(1)) assert.deepEqual(actual, output[0]);
});

const preludeUrl = new URL('./preprocessor.wat', import.meta.url);
/** A synthetic module with just enough of the stream machinery for a lexer. */
const synthetic = (body: string) =>
  transformWat(
    preludeUrl,
    `(module
      (memory 2)
      (global $streaming (mut i32) (i32.const 0))
      (global $streamDepth (mut i32) (i32.const 0))
      (global $streamReset (mut i32) (i32.const 0))
      (const $mem.streamState 8864)
      (const $mem.bashWords 10144)
      (const $mem.byteSets 1424)
      (func $lexEmitLeadingContinuation)
      ${body})`
  );

void test('preprocessor: comments cannot define, import, or reference forms', () => {
  const { code, enumMap } = synthetic(`
    ;; (enum $Ghost "a" "b")
    (; (enum $Block "c") (byteset.get "ab" (local.get $x)) ;)
    (enum $Real "x" "y")
    (func $f (result i32)
      ;; (import "env" "old_hook" (func $old (param i32)))
      (drop (i32.const ";;"))
      (enum.get $Real.y))`);
  assert.equal(enumMap.has('$Ghost'), false);
  assert.equal(enumMap.has('$Block'), false);
  assert.deepEqual(enumMap.get('$Real'), { x: 0, y: 1 });
  assert.equal(code.includes('old_hook'), false);
  assert.ok(code.includes('i32.const 0x3b3b'));
  wat2wasm(preludeUrl.pathname, code);
});

void test('preprocessor: stream lexers must branch by label name', () => {
  const lexer = (labels: string) => `
    (func $hlRust
      (local $x i32) (local $i i32)
      (call $lexEmitLeadingContinuation)
      (block $outer
        (block $inner (br_table ${labels} (local.get $i)))
        (local.set $x (i32.const 0)))
      (block $done
        (loop $l
          (local.set $i (i32.add (local.get $i) (local.get $x)))
          (br_if $done (i32.gt_u (local.get $i) (i32.const 10)))
          (br $l))))`;
  const named = synthetic(lexer('$outer $inner')).code;
  assert.match(named, /i32\.load offset=\d+ \(local\.get \$streamRoot\)/);
  assert.throws(() => synthetic(lexer('1 0')), /branch by index/);
});

void test('preprocessor: a nested block may shadow an outer label', () => {
  const { code } = synthetic(`
    (func $hlRust
      (local $x i32)
      (call $lexEmitLeadingContinuation)
      (block $a
        (br_if $a (local.get $x))
        (block $a (br $a))
        (local.set $x (i32.const 1))))`);
  wat2wasm(preludeUrl.pathname, code);
});

void test('preprocessor: data segments count UTF-8 bytes', () => {
  assert.throws(
    () =>
      synthetic(`
        (data (i32.const 100) "éé")
        (data (i32.const 102) "x")`),
    /overlap/
  );
  synthetic(`
    (data (i32.const 100) "éé")
    (data (i32.const 104) "x")`);
});

void test('preprocessor: the $Token enum cannot outgrow the emitter regions', () => {
  const names = (n: number) =>
    Array.from({ length: n }, (_, i) => `"t${i}"`).join(' ');
  const { enumMap } = synthetic(`(enum $Token ${names(74)})`);
  assert.throws(() => listTokenTypes(enumMap), /span cache holds 73/);
  const { enumMap: ok } = synthetic(`(enum $Token ${names(73)})`);
  assert.equal(listTokenTypes(ok).length, 73);
});
