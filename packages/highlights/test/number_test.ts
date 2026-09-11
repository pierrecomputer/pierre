import assert from 'node:assert';
import t from 'node:test';

import {
  assertLineFedParity,
  loadSplitLang,
  spansOf,
  textOf,
  tokenKinds,
} from './_util';

for (const lang of [
  'c3',
  'csharp',
  'dart',
  'elixir',
  'fsharp',
  'gleam',
  'go',
  'groovy',
  'haskell',
  'java',
  'julia',
  'kotlin',
  'lua',
  'ocaml',
  'perl',
  'php',
  'powershell',
  'python',
  'r',
  'ruby',
  'rust',
  'scala',
  'swift',
] as const) {
  void t.test(`${lang}: hex digits do not consume arithmetic signs`, () => {
    const code = '0x1e+2\n0XFE-1\n1e-2+3';
    assert.deepEqual(tokenKinds(lang, code), [
      ['0x1e', 'number'],
      ['+', 'operator'],
      ['2', 'number'],
      ['0XFE', 'number'],
      ['-', 'operator'],
      ['1', 'number'],
      ['1e-2', 'number'],
      ['+', 'operator'],
      ['3', 'number'],
    ]);
    assertLineFedParity(lang, `${code}\n${code}\n`);
  });
}

for (const lang of [
  'c',
  'go',
  'java',
  'lua',
  'ocaml',
  'r',
  'swift',
  'wgsl',
] as const) {
  void t.test(
    `${lang}: hex fractions include letters and signed exponents`,
    () => {
      for (const literal of [
        '0x1.fp+2',
        '0X1.AP-3',
        '0x1.8p-2',
        '0x1p+2',
        '0x1.p-2',
      ]) {
        assert.deepEqual(tokenKinds(lang, `${literal};`), [
          [literal, 'number'],
          [';', 'punctuation.delimiter'],
        ]);
      }
    }
  );
}

void t.test(
  'swift: hex integers keep member access separate from fractions',
  () => {
    assert.deepEqual(tokenKinds('swift', '0xff.distance(to: 1)'), [
      ['0xff', 'number'],
      ['.', 'punctuation.delimiter'],
      ['distance', 'function.method'],
      ['(', 'punctuation.bracket'],
      ['to', 'variable'],
      [':', 'punctuation.delimiter'],
      ['1', 'number'],
      [')', 'punctuation.bracket'],
    ]);
  }
);

void t.test('numbers: hex fractions keep arithmetic signs separate', () => {
  for (const lang of ['lua', 'r', 'wgsl'] as const) {
    assert.deepEqual(tokenKinds(lang, '0x1.fe+2\n0x1.ae-3'), [
      ['0x1.fe', 'number'],
      ['+', 'operator'],
      ['2', 'number'],
      ['0x1.ae', 'number'],
      ['-', 'operator'],
      ['3', 'number'],
    ]);
  }
});

void t.test(
  'numbers: radix and exponent lookahead stay inside scan ranges',
  () => {
    for (const lang of [
      'go',
      'lua',
      'php',
      'sql',
      'proto',
      'graphql',
      'yaml',
    ] as const) {
      const split = loadSplitLang(lang);
      const code = '0x1e+2 0X1.fp-3 -0x1.fp+2 .5 1e-2';
      for (let at = 0; at <= code.length; at++) {
        const html = split(code, at);
        assert.equal(textOf(html), code, `${lang}: split ${at}`);
        spansOf(html);
      }
    }
  }
);
