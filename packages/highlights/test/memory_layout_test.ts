import { flattenWat, transformWat, wat2wasm } from '@pierre/wat-tools';
import { expect, test } from 'bun:test';

test('the standalone emitter uses one page without lexer memory', () => {
  const url = new URL('../src/emitter.wat', import.meta.url);
  const compiledModule = new WebAssembly.Module(
    wat2wasm(url.pathname, transformWat(url).code)
  );
  const { memory, inputPtr, themePtr } = new WebAssembly.Instance(
    compiledModule
  ).exports as {
    memory: WebAssembly.Memory;
    inputPtr: WebAssembly.Global;
    themePtr: WebAssembly.Global;
  };
  expect(memory.buffer.byteLength).toBe(65536);
  expect(Number(inputPtr.value)).toBeLessThan(8192);
  expect(Number(themePtr.value)).toBe(64);
  expect(
    WebAssembly.Module.exports(compiledModule)
      .map(({ name }) => name)
      .sort()
  ).toEqual(['emit', 'inputPtr', 'memory', 'themePtr']);
});

test('lexer input follows its own reserved memory without emitter tables', () => {
  const url = new URL('./memory-layout.wat', import.meta.url);
  const overrides = new Map([
    [
      new URL('../src/emitter.wat', import.meta.url).href,
      new URL(import.meta.resolve('@pierre/wat-tools/records.wat')),
    ],
    [
      new URL('../src/token.wat', import.meta.url).href,
      new URL(import.meta.resolve('@pierre/wat-tools/token.wat')),
    ],
  ]);
  const input = new TextEncoder().encode('["🙂",1,true]');
  let previousInputPtr = 0;
  for (const size of [0, 131072]) {
    const flattened = flattenWat(
      url,
      `(module
      (import "@pierre/wat-tools/lexer.wat")
      (import "../src/langs/json.wat")
      (memory-region $mem.customScratch ${size})
      (func $highlight (call $hlJson)))`,
      { overrides }
    );
    const code = transformWat(url, flattened.code).code;
    const instance = new WebAssembly.Instance(
      new WebAssembly.Module(wat2wasm(url.pathname, code))
    );
    const { memory, inputPtr, lex } = instance.exports as {
      memory: WebAssembly.Memory;
      inputPtr: WebAssembly.Global;
      lex: () => void;
    };
    const ptr = Number(inputPtr.value);
    expect(instance.exports.themePtr).toBeUndefined();
    if (size === 0) {
      expect(memory.buffer.byteLength).toBe(65536);
      expect(ptr).toBeLessThan(32768);
    } else {
      expect(ptr - previousInputPtr).toBe(size);
    }
    previousInputPtr = ptr;
    new Uint8Array(memory.buffer).set(input, ptr);
    let view = new DataView(memory.buffer);
    view.setUint32(2, input.length, true);
    lex();
    view = new DataView(memory.buffer);
    const start = view.getUint32(6, true);
    const length = view.getUint32(10, true);
    expect(start).toBeGreaterThan(ptr + input.length);
    expect(length).toBeGreaterThan(0);
    expect(length % 8).toBe(0);
    expect(view.getUint32(start + length - 8, true)).toBe(input.length);
  }
});
