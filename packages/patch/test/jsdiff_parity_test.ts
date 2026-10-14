import { expect, test } from 'bun:test';
import * as jsdiff from 'diff';

import {
  createPatch,
  createTwoFilesPatch,
  diffChars,
  diffLines,
  diffWordsWithSpace,
  mulberry32,
} from './_util';

// Every API promises byte-identical output with jsdiff@9, lone surrogates
// included, so the whole pipeline is fuzzed directly against it.

const alphabets = [
  'ab',
  'ab \n',
  'abcd \t\n',
  'abc \t\r\n_0',
  'aé×👋­  ḁX\r\n ﻿ˇˈ',
  'the quick brown fox jumps over the lazy dog \n\n..,!',
  'ab \n\uD800\uDBFF\uDC00\uDC01\uFFFD😀',
  // every JS trim() whitespace, plus U+0085 and U+180E, which trim() keeps
  'ab\t\v\f \u00A0\u1680\u2000\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF\u0085\u180E\r\n\n',
];

const rnd = mulberry32(0xd1ff);
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)];

function randStr(chars: string[], maxLen: number): string {
  const n = Math.floor(rnd() * maxLen);
  let s = '';
  for (let i = 0; i < n; i++) s += chars[Math.floor(rnd() * chars.length)];
  return s;
}

function mutate(s: string, chars: string[]): string {
  const edits = 1 + Math.floor(rnd() * 5);
  for (let i = 0; i < edits; i++) {
    const at = Math.floor(rnd() * (s.length + 1));
    const delLen = Math.floor(rnd() * 8);
    s = s.slice(0, at) + randStr(chars, 8) + s.slice(at + delLen);
  }
  return s;
}

test('fuzz against diff@9.0.0', () => {
  for (let iter = 0; iter < 1000; iter++) {
    const chars = Array.from(pick(alphabets));
    const a = randStr(chars, 200);
    const b = rnd() < 0.5 ? randStr(chars, 200) : mutate(a, chars);
    const context = Math.floor(rnd() * 7);
    const label = `iter ${iter}`;
    expect(diffChars(a, b), `diffChars ${label}`).toStrictEqual(
      jsdiff.diffChars(a, b)
    );
    expect(
      diffWordsWithSpace(a, b),
      `diffWordsWithSpace ${label}`
    ).toStrictEqual(jsdiff.diffWordsWithSpace(a, b));
    expect(diffLines(a, b), `diffLines ${label}`).toStrictEqual(
      jsdiff.diffLines(a, b)
    );
    const lineOptions = {
      ignoreWhitespace: rnd() < 0.5,
      stripTrailingCr: rnd() < 0.5,
    };
    expect(
      diffLines(a, b, lineOptions),
      `diffLines ${JSON.stringify(lineOptions)} ${label}`
    ).toStrictEqual(jsdiff.diffLines(a, b, lineOptions));
    expect(
      createTwoFilesPatch('a', 'b', a, b, '', '', { ...lineOptions, context }),
      `createTwoFilesPatch ${JSON.stringify(lineOptions)} ${label}`
    ).toBe(
      jsdiff.createTwoFilesPatch('a', 'b', a, b, '', '', {
        ...lineOptions,
        context,
      })
    );
    expect(
      createPatch('x.txt', a, b, '', 'new hdr', { context }),
      `createPatch ${label}`
    ).toBe(jsdiff.createPatch('x.txt', a, b, '', 'new hdr', { context }));
    expect(
      createTwoFilesPatch('a/x.txt', 'b/x.txt', a, b, 'old hdr', '', {
        context,
      }),
      `createTwoFilesPatch ${label}`
    ).toBe(
      jsdiff.createTwoFilesPatch('a/x.txt', 'b/x.txt', a, b, 'old hdr', '', {
        context,
      })
    );
    expect(
      createTwoFilesPatch('same.txt', 'same.txt', a, b),
      `createTwoFilesPatch same-name ${label}`
    ).toBe(jsdiff.createTwoFilesPatch('same.txt', 'same.txt', a, b));
    expect(
      createTwoFilesPatch('we"ird\nname é', 'plain.txt', a, b, '', 'hdr', {
        context,
      }),
      `createTwoFilesPatch quoted-name ${label}`
    ).toBe(
      jsdiff.createTwoFilesPatch(
        'we"ird\nname é',
        'plain.txt',
        a,
        b,
        '',
        'hdr',
        { context }
      )
    );
  }
});

test('lone surrogates in filenames and headers match jsdiff', () => {
  const names = ['\uD800', '\uD801', '\uFFFD', 'a\uDC00.txt', '\uD800\uDC00'];
  for (const oldName of names) {
    for (const newName of names) {
      const args = [
        oldName,
        newName,
        'x\uD800\n',
        'x\uD801\n',
        'h\uDBFF',
        '\uDFFF',
      ] as const;
      expect(createTwoFilesPatch(...args), JSON.stringify(args)).toBe(
        jsdiff.createTwoFilesPatch(...args)
      );
    }
  }
});

test('undefined filenames match jsdiff', () => {
  expect(createTwoFilesPatch(undefined, undefined, 'a\n', 'b\n')).toBe(
    jsdiff.createTwoFilesPatch(
      undefined as never,
      undefined as never,
      'a\n',
      'b\n'
    )
  );
  expect(createTwoFilesPatch('only-old.txt', undefined, 'a\n', 'b\n')).toBe(
    jsdiff.createTwoFilesPatch('only-old.txt', undefined as never, 'a\n', 'b\n')
  );
});

test('headerOptions and whole-file context match jsdiff', () => {
  const headerOptions: unknown[] = [
    undefined,
    null,
    {},
    { includeIndex: false },
    { includeFileHeaders: true },
    { includeIndex: true, includeUnderline: true, includeFileHeaders: true },
    { includeIndex: false, includeUnderline: false, includeFileHeaders: false },
  ];
  for (const [a, b] of [
    ['x\n', 'x\n'],
    ['a\nb\nc\nd\n', 'a\nB\nc\nd\n'],
  ]) {
    for (const h of headerOptions) {
      for (const context of [0, Infinity]) {
        const options = {
          headerOptions: h,
          context,
        } as jsdiff.CreatePatchOptionsNonabortable;
        expect(
          createTwoFilesPatch('f', 'f', a, b, '', '', options),
          JSON.stringify({ a, b, options })
        ).toBe(jsdiff.createTwoFilesPatch('f', 'f', a, b, '', '', options));
      }
    }
  }
});

test('larger multi-hunk line diffs match jsdiff', () => {
  const words = [
    'const',
    'let',
    'x',
    'y',
    'fn',
    'return',
    'if',
    'else',
    'for',
    'await',
  ];
  const lines: string[] = [];
  for (let i = 0; i < 800; i++) {
    lines.push(
      `${pick(words)} ${pick(words)}${pick(words)}(${i % 7}) // ${pick(words)}`
    );
  }
  const a = lines.join('\n') + '\n';
  const edited = lines.slice();
  for (let i = 0; i < 60; i++) {
    const at = Math.floor(rnd() * edited.length);
    const roll = rnd();
    if (roll < 0.4) edited[at] = edited[at] + ' changed';
    else if (roll < 0.7) edited.splice(at, 1);
    else edited.splice(at, 0, `inserted ${i}`);
  }
  const b = edited.join('\n') + '\n';
  for (const context of [0, 1, 4, 10]) {
    expect(
      createTwoFilesPatch('a.js', 'b.js', a, b, undefined, undefined, {
        context,
      }),
      `context ${context}`
    ).toBe(
      jsdiff.createTwoFilesPatch('a.js', 'b.js', a, b, undefined, undefined, {
        context,
      })
    );
  }
});
