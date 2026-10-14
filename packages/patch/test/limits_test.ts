import { beforeAll, expect, test } from 'bun:test';

import { transformWat, wat2wasm } from '../scripts/build';

// Token counts whose table sizes would wrap i32 must report out of memory
// before allocating. Real inputs need GiBs (two 128 MiB diffChars strings), so
// the harness sets the counts directly.
const testWat = `(module
  (import "../src/tokenize.wat")
  (import "../src/myers.wat")
  (func (export "t_intern") (param $total i32) (result i32)
    (global.set $heap (i32.const 65536))
    (call $internInit (local.get $total)))
  (func (export "t_myers") (param $m i32) (param $n i32) (result i32)
    (global.set $heap (i32.const 65536))
    (global.set $oldN (local.get $m))
    (global.set $newN (local.get $n))
    (call $myers))
  (func (export "t_takeErr") (result i32)
    (global.get $err)
    (global.set $err (i32.const 0)))
)
`;

let wasm: {
  t_intern: (total: number) => number;
  t_myers: (m: number, n: number) => number;
  t_takeErr: () => number;
};

beforeAll(() => {
  const watUrl = new URL('./test_limits.wat', import.meta.url);
  const code = transformWat(watUrl, testWat);
  wasm = new WebAssembly.Instance(
    new WebAssembly.Module(wat2wasm(watUrl.href, code)),
    {}
  ).exports as typeof wasm;
});

test('bestPath size past i32 reports out of memory', () => {
  expect(wasm.t_myers(0x08000000, 0x08000000)).toBe(0);
  expect(wasm.t_takeErr()).toBe(1);
});

test('intern table size past i32 reports out of memory', () => {
  expect(wasm.t_intern(0x08000001)).toBe(0);
  expect(wasm.t_takeErr()).toBe(1);
});
