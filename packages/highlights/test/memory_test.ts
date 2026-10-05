import { expect, test } from 'bun:test';

import { HighlightsHighlighter } from '../lib/highlighter';
import type { CodeToHtmlOptions } from '../lib/index';
import { codeToHtml, codeToTokens, init } from '../lib/index';
import { transformWat, wat2wasm } from '../scripts/build';
import { cssVariables } from '../themes/index';
import pierreDarkVibrant from '../themes/pierre-dark-vibrant.json' with { type: 'json' };
import pierreDark from '../themes/pierre-dark.json' with { type: 'json' };
import pierreLight from '../themes/pierre-light.json' with { type: 'json' };
import { textOf } from './_util';

const url = new URL('../src/highlights.wat', import.meta.url);
const wasm = new WebAssembly.Module(
  wat2wasm(url.pathname, transformWat(url).code)
);
const decoder = new TextDecoder();
const options = { lang: 'plain', theme: pierreDark } as const;

test('large plain HTML reserves capacity close to input plus output', () => {
  const hl = new HighlightsHighlighter(wasm);
  const input = 'x'.repeat(5 * 1024 * 1024);
  const output = hl.codeToHtml(input, options);
  expect(textOf(decoder.decode(output))).toBe(input);
  expect(hl.memory.buffer.byteLength).toBeLessThan(
    input.length + output.length + 512 * 1024
  );
  expect(textOf(decoder.decode(hl.codeToHtml('tiny', options)))).toBe('tiny');
});

test('chunked escaping preserves entities, UTF-8, and spans in every HTML mode', () => {
  const modes: CodeToHtmlOptions[] = [
    { lang: 'json', theme: pierreDark },
    { lang: 'json', theme: cssVariables },
    { lang: 'json', themes: { light: pierreLight, dark: pierreDark } },
    { lang: 'json', theme: pierreDarkVibrant },
  ];
  for (const mode of modes) {
    const hl = new HighlightsHighlighter(wasm);
    const template = decoder.decode(hl.codeToHtml('"PLACEHOLDER"', mode));
    for (const length of [4095, 4096, 4097, 8191, 8192, 8193, 65536]) {
      for (const content of [
        '&'.repeat(length),
        ('x'.repeat(4092) + '🙂<&>').repeat(17).slice(0, length),
      ]) {
        const input = `"${content}"`;
        const output = hl.codeToHtml(input, mode);
        const escaped = decoder
          .decode(new TextEncoder().encode(content))
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;');
        expect(output.buffer).toBe(hl.memory.buffer);
        expect(decoder.decode(output)).toBe(
          template.replace('PLACEHOLDER', escaped)
        );
      }
    }
  }
});

test('shared HTML reuses large capacity and recycles it for small inputs', () => {
  for (const input of [
    'tiny',
    new TextEncoder().encode('tiny'),
    new TextEncoder().encode('tiny').buffer,
  ]) {
    init(wasm);
    const source = 'x'.repeat(5 * 1024 * 1024);
    const large = codeToHtml(source, options);
    expect(codeToHtml(source, options).buffer).toBe(large.buffer);
    const tiny = codeToHtml(input, options);
    expect(tiny.buffer).not.toBe(large.buffer);
    expect(tiny.buffer.byteLength).toBeLessThanOrEqual(1024 * 1024);
    expect(textOf(decoder.decode(tiny))).toBe('tiny');
    expect(codeToHtml('again', options).buffer).toBe(tiny.buffer);
  }
});

test('shared recycling accepts input borrowed from the oversized instance', () => {
  for (const mode of ['html', 'tokens']) {
    init(wasm);
    const large = codeToHtml('x'.repeat(5 * 1024 * 1024), options);
    const input = large.subarray(large.length - 13);
    const expected = decoder.decode(input);
    if (mode === 'html') {
      expect(textOf(decoder.decode(codeToHtml(input, options)))).toBe(expected);
    } else {
      expect(codeToTokens(input, options).tokens[0][0].content).toBe(expected);
    }
    const tiny = codeToHtml('tiny', options);
    expect(tiny.buffer).not.toBe(large.buffer);
    expect(tiny.buffer.byteLength).toBeLessThanOrEqual(1024 * 1024);
    expect(decoder.decode(input)).toBe(expected);
  }
});

test('shared HTML recycles capacity grown by tokenization', () => {
  init(wasm);
  const input = 'x'.repeat(9 * 1024 * 1024);
  expect(codeToTokens(input, options).tokens[0][0].content).toBe(input);
  const tiny = codeToHtml('tiny', options);
  expect(tiny.buffer.byteLength).toBeLessThanOrEqual(1024 * 1024);
  expect(textOf(decoder.decode(tiny))).toBe('tiny');
});
