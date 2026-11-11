import { transformWat, wat2wasm } from '@pierre/wat-tools';
import { expect, test } from 'bun:test';

test('static data cannot spill into an adjacent scratch region', () => {
  const url = new URL('./memory.wat', import.meta.url);
  const source = `(module
    (import "@pierre/wat-tools/memory.wat")
    (memory-region $mem.table 16)
    (memory-region $mem.scratch 16)
    (data (i32.const $mem.table) "0123456789abcdef"))`;
  expect(
    WebAssembly.validate(wat2wasm(url.pathname, transformWat(url, source).code))
  ).toBe(true);
  expect(() =>
    transformWat(
      url,
      source.replace('0123456789abcdef', '0123456789abcdefOVERFLOW')
    )
  ).toThrow('exceeds $mem.table');
  expect(() =>
    transformWat(url, source.replace('0123456789abcdef', '0123456789abcdeé'))
  ).toThrow('exceeds $mem.table');
});

test('alignment padding does not extend a reserved region', () => {
  const url = new URL('./aligned-memory.wat', import.meta.url);
  const source = `(module
    (import "@pierre/wat-tools/memory.wat")
    (memory-region $mem.table 1)
    (memory-region $mem.scratch 16 256)
    (data (i32.const $mem.table) "ab"))`;
  expect(() => transformWat(url, source)).toThrow('exceeds $mem.table');
  expect(() =>
    transformWat(url, source.replace('$mem.table) "ab"', '$mem.table+1) "a"'))
  ).toThrow('exceeds reserved memory');
});
