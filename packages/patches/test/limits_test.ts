import { beforeAll, expect, test } from 'bun:test';

import { transformWat, wat2wasm } from '../scripts/build';
import {
  createTwoFilesPatch,
  diffChars,
  init,
  loadWasm,
  setMemoryLimit,
} from './_util';

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
  // the smallest count whose bestPath plus seed room wraps to a 0-byte alloc
  expect(wasm.t_myers(0x07fffffe, 0x07ffffff)).toBe(0);
  expect(wasm.t_takeErr()).toBe(1);
});

test('intern table size past i32 reports out of memory', () => {
  expect(wasm.t_intern(0x08000001)).toBe(0);
  expect(wasm.t_takeErr()).toBe(1);
});

test('init compiles the wasm at the first call, not before', () => {
  init(() => {
    throw new Error('no wasm');
  });
  try {
    setMemoryLimit(32 << 20);
    expect(() => diffChars('ab', 'ac')).toThrow('no wasm');
  } finally {
    init(loadWasm);
  }
  expect(diffChars('ab', 'ac')).toHaveLength(3);
});

test('a call that grows memory past the limit gets a new instance after it', () => {
  // the first call creates the instance that the limit replaces
  diffChars('ab', 'ac');
  const Instance = WebAssembly.Instance;
  let instances = 0;
  WebAssembly.Instance = class extends Instance {
    constructor(module: WebAssembly.Module) {
      super(module, {});
      instances++;
    }
  };
  try {
    expect(() => setMemoryLimit(-1)).toThrow(RangeError);
    expect(() => setMemoryLimit(NaN)).toThrow(RangeError);
    // a new instance has 2 pages, so a limit of 0 replaces it after each call
    setMemoryLimit(0);
    expect(instances).toBe(1);
    expect(diffChars('ab', 'ac').map((c) => c.value)).toEqual(['a', 'b', 'c']);
    expect(instances).toBe(2);

    setMemoryLimit(1 << 20);
    expect(instances).toBe(2);
    expect(diffChars('ab', 'ac')).toHaveLength(3);
    expect(instances).toBe(2);
    const big = 'x\n'.repeat(200_000);
    expect(createTwoFilesPatch('a', 'b', big, big + 'y\n')).toEndWith(
      ' x\n+y\n'
    );
    expect(instances).toBe(3);
    expect(diffChars('ab', 'ac')).toHaveLength(3);
    expect(instances).toBe(3);
  } finally {
    WebAssembly.Instance = Instance;
    setMemoryLimit(32 << 20);
  }
});
