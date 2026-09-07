import assert from 'node:assert/strict';
import test from 'node:test';

import { HighlightsHighlighter, langIdOf } from '../lib/highlighter';
import type { Lang } from '../lib/index';
import { optimizeWasm, transformWat, wat2wasm } from '../scripts/build';
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
      for (const method of [
        'tokenizeRecords',
        'tokenizeLineRecords',
      ] as const) {
        const output = highlighters.map((hl) =>
          hl[method](langIdOf(lang), hl.writeInput(code)).slice()
        );
        assert.deepEqual(output[1], output[0], `${lang}: ${method}`);
      }
    }
  }
);

void test('compact SIMD constants preserve all byte values, mixed lanes and data', () => {
  const stores = Array.from(
    { length: 256 },
    (_, byte) => `(v128.store offset=${byte * 16} (local.get $p)
      (v128.const i8x16 ${Array<number>(16).fill(byte).join(' ')}))`
  );
  const wasm = wat2wasm(
    'splats.wat',
    `(module
      (memory (export "memory") 1)
      (data (i32.const 5000)
        "v128.const i32x4 0x01010101 0x01010101 0x01010101 0x01010101")
      (func (export "write") (param $p i32)
        ${stores.join('\n')}
        (v128.store offset=4096 (local.get $p)
          (v128.const i32x4 0x01020304 0x01020304 0x01020304 0x01020304))
        (v128.store offset=4112 (local.get $p)
          (v128.const i32x4 0x01010101 0x02020202 0x03030303 0x04040404))))`
  );
  const output = [wasm, optimizeWasm(wasm)].map((binary) => {
    const instance = new WebAssembly.Instance(new WebAssembly.Module(binary));
    (instance.exports.write as (ptr: number) => void)(0);
    return new Uint8Array(
      (instance.exports.memory as WebAssembly.Memory).buffer
    );
  });
  assert.deepEqual(output[1], output[0]);
});
