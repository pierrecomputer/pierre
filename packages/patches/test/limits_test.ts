import { beforeAll, expect, spyOn, test } from 'bun:test';
import * as jsdiff from 'diff';

import { transformWat, wat2wasm } from '../scripts/build';
import {
  createPatch,
  createTwoFilesPatch,
  diffChars,
  diffLines,
  diffWordsWithSpace,
  init,
  loadWasm,
  mulberry32,
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

test('compaction at every chance keeps results identical to jsdiff', () => {
  let code = transformWat(new URL('../src/patch.wat', import.meta.url));
  for (const bar of ['$compactFirst', '$compactMin']) {
    const zeroed = code.replace(
      new RegExp(`\\(global \\${bar} +i32 +\\(i32\\.const \\w+\\)\\)`),
      `(global ${bar} i32 (i32.const 0))`
    );
    expect(zeroed).not.toBe(code);
    code = zeroed;
  }
  const forced = new WebAssembly.Module(wat2wasm('patch.wat', code));
  const rnd = mulberry32(0xc0de);
  const int = (n: number) => Math.floor(rnd() * n);
  init(() => forced);
  // a new instance per call keeps memory small, so the node room runs out often
  setMemoryLimit(0);
  try {
    for (let i = 0; i < 60; i++) {
      const vocab = 1 + int(60);
      const line = () => `line ${int(vocab)}\n`;
      const oldLines = Array.from({ length: 300 + int(300) }, line);
      const newLines =
        i % 3 === 0
          ? oldLines.map((l, n) => `other ${n} ${l}`)
          : oldLines.flatMap((l) => {
              const r = rnd();
              return r < 0.2 ? [] : r < 0.4 ? [line(), l] : [l];
            });
      const a = oldLines.join('');
      const b = newLines.join('');
      expect(createTwoFilesPatch('a', 'b', a, b)).toBe(
        jsdiff.createTwoFilesPatch('a', 'b', a, b)
      );
      expect(diffLines(a, b).map((c) => c.count)).toEqual(
        jsdiff.diffLines(a, b).map((c) => c.count)
      );
    }
  } finally {
    init(loadWasm);
    setMemoryLimit(32 << 20);
  }
});

test('compaction bounds memory on unrelated inputs', () => {
  const Instance = WebAssembly.Instance;
  let memory: WebAssembly.Memory | undefined;
  WebAssembly.Instance = class extends Instance {
    constructor(module: WebAssembly.Module) {
      super(module, {});
      memory = this.exports.memory as WebAssembly.Memory;
    }
  };
  const lines = (tag: string) =>
    Array.from({ length: 12_000 }, (_, i) => `${tag} ${i}\n`).join('');
  init(loadWasm);
  setMemoryLimit(Infinity);
  try {
    const patch = createTwoFilesPatch('a', 'b', lines('old'), lines('new'));
    expect(patch.match(/^-old /gm)).toHaveLength(12_000);
    expect(patch.match(/^\+new /gm)).toHaveLength(12_000);
    // without compaction the path nodes alone take 4 * 12,000^2 bytes (536 MiB)
    expect(memory?.buffer.byteLength).toBeLessThan(400 << 20);
  } finally {
    WebAssembly.Instance = Instance;
    init(loadWasm);
    setMemoryLimit(32 << 20);
  }
});

test('a refused wasm instance loses no result and breaks no later call', () => {
  const Instance = WebAssembly.Instance;
  let refuse = true;
  let instances = 0;
  WebAssembly.Instance = class extends Instance {
    constructor(module: WebAssembly.Module) {
      if (refuse) throw new RangeError('refused');
      super(module, {});
      instances++;
    }
  };
  // reports an error at byte 2048, as wasm does when it runs out of memory
  const failing = `(module
    (memory (export "memory") 2)
    (data (i32.const 2048) "out of memory")
    (func (export "diff")
      (i32.store (i32.const 12) (i32.const 13))
      (i32.store (i32.const 16) (i32.const 2048))))`;
  init(loadWasm);
  setMemoryLimit(Infinity);
  try {
    // the first instance: this call fails, and the next call creates it
    expect(() => diffChars('ab', 'ac')).toThrow('refused');
    refuse = false;
    expect(diffChars('ab', 'ac')).toHaveLength(3);
    expect(instances).toBe(1);
    // a replacement: the result stays, and the next call tries again
    refuse = true;
    setMemoryLimit(0);
    expect(diffChars('ab', 'ac')).toHaveLength(3);
    refuse = false;
    expect(diffChars('ab', 'ac')).toHaveLength(3);
    expect(instances).toBe(2);
    // a replacement after a wasm error: the message stays
    init(() => new WebAssembly.Module(wat2wasm('failing.wat', failing)));
    expect(() => diffChars('ab', 'ac')).toThrow('out of memory');
    refuse = true;
    expect(() => diffChars('ab', 'ac')).toThrow('out of memory');
  } finally {
    WebAssembly.Instance = Instance;
    init(loadWasm);
    setMemoryLimit(32 << 20);
  }
});

test('oversized inputs and refused memory growth throw out of memory', () => {
  const text = 'x'.repeat(0x10000000);
  const grow = spyOn(WebAssembly.Memory.prototype, 'grow');
  try {
    expect(() => diffChars(text, '')).toThrow('out of memory');
    expect(grow).not.toHaveBeenCalled();
    grow.mockImplementation(() => {
      throw new RangeError('refused');
    });
    expect(() => diffChars('y'.repeat(1 << 26), '')).toThrow('out of memory');
  } finally {
    grow.mockRestore();
  }
  expect(diffChars('ab', 'ac')).toHaveLength(3);
});

test('falsy context and headerOptions match jsdiff', () => {
  const a = 'a\nb\nc\nd\n';
  const b = 'a\nb\nX\nd\n';
  for (const falsy of [
    { context: null },
    { context: false },
    { context: 0 },
    { context: undefined },
    { headerOptions: false },
    { headerOptions: 0 },
    { headerOptions: null },
    { headerOptions: {} },
  ]) {
    const options = falsy as unknown as { context?: number };
    expect(createPatch('f', a, b, '', '', options)).toBe(
      jsdiff.createPatch('f', a, b, '', '', options)
    );
  }
});

test('runtimes without isWellFormed or crypto still diff correctly', () => {
  const a = 'é'.repeat(300) + '\ud800';
  const b = 'é'.repeat(300) + 'x';
  const expected = jsdiff.diffWordsWithSpace(a, b).map((c) => c.value);
  const isWellFormed = Object.getOwnPropertyDescriptor(
    String.prototype,
    'isWellFormed'
  )!;
  const random = spyOn(crypto, 'getRandomValues').mockImplementation(() => {
    throw new Error('Disallowed operation called within global scope');
  });
  Reflect.deleteProperty(String.prototype, 'isWellFormed');
  setMemoryLimit(0);
  try {
    expect(diffWordsWithSpace(a, b).map((c) => c.value)).toEqual(expected);
    expect(random).toHaveBeenCalled();
  } finally {
    Object.defineProperty(String.prototype, 'isWellFormed', isWellFormed);
    random.mockRestore();
    setMemoryLimit(32 << 20);
  }
});

test('string constants keep leading zero digits', () => {
  const url = new URL('./test_const.wat', import.meta.url);
  expect(transformWat(url, '(module (i32.const "\\n@"))')).toContain('0x400a');
});
