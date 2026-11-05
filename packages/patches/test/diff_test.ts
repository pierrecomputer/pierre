import { expect, test } from 'bun:test';

import {
  createPatch,
  createTwoFilesPatch,
  diffChars,
  diffLines,
  diffWordsWithSpace,
} from './_util';

test('diffChars basics', () => {
  expect(diffChars('', '')).toStrictEqual([]);
  expect(diffChars('abc', 'abc')).toStrictEqual([
    { count: 3, added: false, removed: false, value: 'abc' },
  ]);
  expect(diffChars('', 'ab')).toStrictEqual([
    { count: 2, added: true, removed: false, value: 'ab' },
  ]);
  expect(diffChars('ab', '')).toStrictEqual([
    { count: 2, added: false, removed: true, value: 'ab' },
  ]);
  // the canonical Myers example, byte-for-byte the jsdiff@9 result
  expect(diffChars('abcabba', 'cbabac')).toStrictEqual([
    { count: 2, added: false, removed: true, value: 'ab' },
    { count: 1, added: false, removed: false, value: 'c' },
    { count: 1, added: true, removed: false, value: 'b' },
    { count: 2, added: false, removed: false, value: 'ab' },
    { count: 1, added: false, removed: true, value: 'b' },
    { count: 1, added: false, removed: false, value: 'a' },
    { count: 1, added: true, removed: false, value: 'c' },
  ]);
});

test('diffChars counts code points, not UTF-16 units', () => {
  expect(diffChars('👋a', '👋b')).toStrictEqual([
    { count: 1, added: false, removed: false, value: '👋' },
    { count: 1, added: false, removed: true, value: 'a' },
    { count: 1, added: true, removed: false, value: 'b' },
  ]);
});

test('a leading U+FEFF survives in change values', () => {
  expect(diffChars('﻿', '')).toStrictEqual([
    { count: 1, added: false, removed: true, value: '﻿' },
  ]);
});

test('lone surrogates stay distinct, as in jsdiff', () => {
  expect(diffChars('\uD800', '�')).toStrictEqual([
    { count: 1, added: false, removed: true, value: '\uD800' },
    { count: 1, added: true, removed: false, value: '�' },
  ]);
  expect(createTwoFilesPatch('\uD800', '\uD800', '\uDC00\n', '\uDC01\n')).toBe(
    `Index: \uD800\n${'='.repeat(67)}\n--- "\\357\\277\\275"\n+++ "\\357\\277\\275"\n` +
      '@@ -1,1 +1,1 @@\n-\uDC00\n+\uDC01\n'
  );
});

test('diffWordsWithSpace basics', () => {
  expect(diffWordsWithSpace('the quick  fox', 'the  slow fox!')).toStrictEqual([
    { count: 1, added: false, removed: false, value: 'the' },
    { count: 2, added: false, removed: true, value: ' quick' },
    { count: 1, added: false, removed: false, value: '  ' },
    { count: 2, added: true, removed: false, value: 'slow ' },
    { count: 1, added: false, removed: false, value: 'fox' },
    { count: 1, added: true, removed: false, value: '!' },
  ]);
  // \r\n is one token, a lone \r is its own token
  expect(diffWordsWithSpace('a\r\nb', 'a\rb')).toStrictEqual([
    { count: 1, added: false, removed: false, value: 'a' },
    { count: 1, added: false, removed: true, value: '\r\n' },
    { count: 1, added: true, removed: false, value: '\r' },
    { count: 1, added: false, removed: false, value: 'b' },
  ]);
});

test('diffLines basics', () => {
  expect(diffLines('', '')).toStrictEqual([]);
  expect(diffLines('a\nb\nc\n', 'a\nx\nc\n')).toStrictEqual([
    { count: 1, added: false, removed: false, value: 'a\n' },
    { count: 1, added: false, removed: true, value: 'b\n' },
    { count: 1, added: true, removed: false, value: 'x\n' },
    { count: 1, added: false, removed: false, value: 'c\n' },
  ]);
  // a final line without "\n" is its own token, distinct from "b\n"
  expect(diffLines('a\nb', 'a\nb\n')).toStrictEqual([
    { count: 1, added: false, removed: false, value: 'a\n' },
    { count: 1, added: false, removed: true, value: 'b' },
    { count: 1, added: true, removed: false, value: 'b\n' },
  ]);
  // "\r\n" stays attached to its line; consecutive lines merge into one change
  expect(diffLines('a\r\nb\r\n', 'a\r\nB\r\nC\r\n')).toStrictEqual([
    { count: 1, added: false, removed: false, value: 'a\r\n' },
    { count: 1, added: false, removed: true, value: 'b\r\n' },
    { count: 2, added: true, removed: false, value: 'B\r\nC\r\n' },
  ]);
});

test('createPatch is createTwoFilesPatch with one name on both sides', () => {
  expect(
    createPatch('f.txt', 'a\nb\n', 'a\nx\n', 'oldh', 'newh', { context: 1 })
  ).toBe(
    createTwoFilesPatch('f.txt', 'f.txt', 'a\nb\n', 'a\nx\n', 'oldh', 'newh', {
      context: 1,
    })
  );
  // matching names produce the Index line
  expect(createPatch('f.txt', 'a\n', 'b\n')).toMatch(/^Index: f\.txt\n/);
});

test('createTwoFilesPatch', () => {
  expect(
    createTwoFilesPatch(
      'a.txt',
      'b.txt',
      'line1\nline2\nline3\n',
      'line1\nlineX\nline3',
      'oldh',
      'newh',
      {
        context: 1,
      }
    )
  ).toBe(
    '===================================================================\n' +
      '--- a.txt\toldh\n' +
      '+++ b.txt\tnewh\n' +
      '@@ -1,3 +1,3 @@\n' +
      ' line1\n' +
      '-line2\n' +
      '-line3\n' +
      '+lineX\n' +
      '+line3\n' +
      '\\ No newline at end of file\n'
  );
  // identical files: headers only, plus the Index line when the names match
  expect(createTwoFilesPatch('f', 'f', 'x', 'x')).toBe(
    'Index: f\n===================================================================\n--- f\n+++ f\n'
  );
  // pure insertion into an empty file hits the 0-count start quirk
  expect(
    createTwoFilesPatch('f', 'f', '', 'a\n', undefined, undefined, {
      context: 0,
    })
  ).toBe(
    'Index: f\n===================================================================\n--- f\n+++ f\n@@ -0,0 +1,1 @@\n+a\n'
  );
});

test('createTwoFilesPatch headerOptions', () => {
  // like jsdiff: a patch with no lines is "\n"
  expect(
    createTwoFilesPatch('f', 'f', 'x', 'x', undefined, undefined, {
      headerOptions: {
        includeIndex: false,
        includeUnderline: false,
        includeFileHeaders: false,
      },
    })
  ).toBe('\n');
  // like jsdiff: a field left out of headerOptions is false
  expect(
    createTwoFilesPatch('f', 'f', 'x', 'x', undefined, undefined, {
      headerOptions: { includeFileHeaders: true },
    })
  ).toBe('--- f\n+++ f\n');
});

test('filenames get C-style quoting like Git', () => {
  const patch = createTwoFilesPatch(
    'sp ace/"quote".txt',
    'naïve\n.txt',
    'x',
    'x'
  );
  expect(patch).toMatch(/^--- "sp ace\/\\"quote\\".txt"$/m);
  expect(patch).toMatch(/^\+\+\+ "na\\303\\257ve\\n.txt"$/m);
});

test('ignoreWhitespace compares trimmed lines and keeps the new text', () => {
  expect(
    diffLines(' a\n\tb \nc\n', 'a\nb\r\nC\n', { ignoreWhitespace: true })
  ).toStrictEqual([
    { count: 2, added: false, removed: false, value: 'a\nb\r\n' },
    { count: 1, added: false, removed: true, value: 'c\n' },
    { count: 1, added: true, removed: false, value: 'C\n' },
  ]);
  // whitespace-only lines are all equal, Unicode spaces included
  expect(
    diffLines('\u3000\n', ' \u00A0\n', { ignoreWhitespace: true })
  ).toStrictEqual([
    { count: 1, added: false, removed: false, value: ' \u00A0\n' },
  ]);
  // the old side keeps its own UTF-16 offsets when common lines differ in length
  expect(
    diffLines('  é\nx\n', 'é\ny\n', { ignoreWhitespace: true })
  ).toStrictEqual([
    { count: 1, added: false, removed: false, value: 'é\n' },
    { count: 1, added: false, removed: true, value: 'x\n' },
    { count: 1, added: true, removed: false, value: 'y\n' },
  ]);
  expect(
    createTwoFilesPatch('f', 'f', 'a\n b\n', 'a\nb \n', '', '', {
      ignoreWhitespace: true,
    })
  ).toBe(
    'Index: f\n===================================================================\n--- f\n+++ f\n'
  );
});

test('stripTrailingCr drops the \\r of each \\r\\n before the diff', () => {
  expect(
    diffLines('a\r\nb\r\n', 'a\nb\n', { stripTrailingCr: true })
  ).toStrictEqual([
    { count: 2, added: false, removed: false, value: 'a\nb\n' },
  ]);
  expect(
    createPatch('f', 'a\r\n', 'b\r\n', '', '', {
      stripTrailingCr: true,
      context: 0,
    })
  ).toBe(
    'Index: f\n===================================================================\n--- f\n+++ f\n@@ -1,1 +1,1 @@\n-a\n+b\n'
  );
});

test('unsupported jsdiff options fail loudly', () => {
  expect(() => diffChars('a', 'b', { ignoreCase: true } as never)).toThrow(
    /not supported/
  );
  expect(() =>
    diffWordsWithSpace('a', 'b', { oneChangePerToken: true } as never)
  ).toThrow(/not supported/);
  expect(() => diffLines('a', 'b', { newlineIsToken: true } as never)).toThrow(
    /not supported/
  );
  expect(() => diffLines('a', 'b', (() => {}) as never)).toThrow(
    /callbacks are not supported/
  );
  expect(() =>
    createPatch('f', 'x', 'y', '', '', { maxEditLength: 1 } as never)
  ).toThrow(/not supported/);
  expect(() =>
    createTwoFilesPatch('a', 'b', 'x', 'y', '', '', { timeout: 0 } as never)
  ).toThrow(/not supported/);
  expect(() =>
    createTwoFilesPatch('a', 'b', 'x', 'y', '', '', {
      newlineIsToken: true,
    } as never)
  ).toThrow(/newlineIsToken may not be used with patch-generation functions/);
  expect(() => diffChars(null as never, 'b')).toThrow(TypeError);
  // jsdiff prints odd hunk headers for these ("@@ -2,3.5 ...")
  expect(() => createPatch('f', 'x', 'y', '', '', { context: 1.5 })).toThrow(
    /context must be a non-negative integer/
  );
  expect(() => createPatch('f', 'x', 'y', '', '', { context: -1 })).toThrow(
    /context must be a non-negative integer/
  );
});

test('options that are off are accepted, as in jsdiff', () => {
  expect(
    diffChars('a', 'b', { ignoreCase: false, callback: undefined } as never)
  ).toStrictEqual(diffChars('a', 'b'));
  expect(
    createPatch('f', 'x', 'y', '', '', {
      newlineIsToken: false,
      maxEditLength: null,
    } as never)
  ).toBe(createPatch('f', 'x', 'y'));
});
