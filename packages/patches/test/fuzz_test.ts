import { expect, test } from 'bun:test';
import * as jsdiff from 'diff';

import {
  createPatch,
  type CreatePatchOptions,
  createTwoFilesPatch,
  diffChars,
  diffLines,
  type DiffLinesOptions,
  diffWordsWithSpace,
  mulberry32,
  setMemoryLimit,
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
const int = (n: number) => Math.floor(rnd() * n);
const pick = <T>(arr: readonly T[]): T => arr[int(arr.length)];

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

// The uniform strings above rarely edit whole tokens of text that shares
// structure, so these generators build inputs one token at a time. Non-ASCII
// characters are code points: oxfmt rewrites `\u` escapes as literal (often
// invisible) characters.
const fromCodes = (...codes: number[]) =>
  codes.map((c) => String.fromCharCode(c));
// JS trim() whitespace, plus U+0085, U+180E, and U+200B, which trim() keeps
const spaces = [
  ' ',
  '  ',
  '\t',
  '\v',
  '\f',
  ...fromCodes(0xa0, 0x1680, 0x2000, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f),
  ...fromCodes(0x3000, 0xfeff, 0x85, 0x180e, 0x200b),
];
const eols = ['\n', '\n', '\r\n', '\r', '\r\r\n', '\n\r'];
// word-class edges, then U+D000 and U+D7FF, whose WTF-8 lead 0xED is a lone surrogate's too
const words = [
  'a',
  'foo',
  'bar_1',
  'x9',
  'café',
  'ḁ',
  '×',
  '日本',
  ...fromCodes(0xad, 0x2c7, 0x2de, 0x300, 0x1eff, 0x1f00, 0xd000, 0xd7ff),
];
const others = [
  '.',
  '(',
  '"',
  '\\',
  '=>',
  '\0',
  '\x7F',
  '👋',
  String.fromCodePoint(0x10ffff),
  ...fromCodes(0xd800, 0xdbff, 0xdc00, 0xdfff, 0xfffd),
];
const nonAscii = [...words, ...others].filter((s) => /[^\0-\x7F]/.test(s));
const lineTexts = [
  '',
  '}',
  '  return x;',
  '\tif (a) {',
  '// é',
  'ab',
  ...fromCodes(0x3000, 0xd800).map((c) => `x${c}`),
];
const nameChars = [
  'a',
  '.',
  '/',
  ' ',
  '"',
  '\\',
  '\t',
  '\n',
  '\0',
  '\x07',
  '\x0D',
  '\x0E',
  '\x1F',
  '\x7F',
  'é',
  '😀',
  ...fromCodes(0x80, 0xd800, 0xdc00, 0xfffd),
];

const generators: [string, () => string][] = [
  [
    'tokens',
    () => {
      const r = rnd();
      return r < 0.4
        ? pick(words)
        : r < 0.6
          ? pick(spaces)
          : r < 0.85
            ? pick(others)
            : pick(eols);
    },
  ],
  // ASCII runs around the 16-byte SIMD chunks of the char tokenizer and the UTF-16 count
  [
    'ascii runs',
    () =>
      rnd() < 0.4
        ? pick(nonAscii)
        : Array.from({ length: pick([1, 7, 8, 15, 16, 17, 31, 32, 33]) }, () =>
            pick(['a', 'b', ' ', '\n'])
          ).join(''),
  ],
  ['lines', () => pick(lineTexts) + pick(eols)],
  [
    'indented lines',
    () =>
      (rnd() < 0.3 ? pick(spaces) : '') +
      pick(lineTexts) +
      (rnd() < 0.3 ? pick(spaces) : '') +
      pick(eols),
  ],
];

/** Apply 1-6 whole-token edits: insert, delete, replace, move, or copy a block. */
function editTokens(tokens: string[], gen: () => string): string[] {
  const t = tokens.slice();
  for (let e = 1 + int(6); e > 0; e--) {
    const at = int(t.length + 1);
    const len = 1 + int(8);
    const fresh = Array.from({ length: 1 + int(5) }, gen);
    const r = rnd();
    if (r < 0.3) t.splice(at, 0, ...fresh);
    else if (r < 0.55) t.splice(at, len);
    else if (r < 0.8) t.splice(at, len, ...fresh);
    else if (r < 0.9) t.splice(int(t.length + 1), 0, ...t.splice(at, len));
    else t.splice(at, 0, ...t.slice(at, at + len));
  }
  return t;
}

/**
 * Compare every API with jsdiff on one input pair, with random line options,
 * context, header options, filenames, and headers.
 */
function expectParity(a: string, b: string, label: string): void {
  const input = `${label} ${JSON.stringify([a, b])}`;
  expect(diffChars(a, b), `diffChars ${input}`).toStrictEqual(
    jsdiff.diffChars(a, b)
  );
  expect(diffWordsWithSpace(a, b), `diffWordsWithSpace ${input}`).toStrictEqual(
    jsdiff.diffWordsWithSpace(a, b)
  );
  const lineOptions: DiffLinesOptions = {};
  if (rnd() < 0.5) lineOptions.ignoreWhitespace = rnd() < 0.7;
  if (rnd() < 0.5) lineOptions.stripTrailingCr = rnd() < 0.7;
  expect(
    diffLines(a, b, lineOptions),
    `diffLines ${JSON.stringify(lineOptions)} ${input}`
  ).toStrictEqual(jsdiff.diffLines(a, b, lineOptions));

  const options: CreatePatchOptions = {
    ...lineOptions,
    context: pick([undefined, 0, 0, 1, 2, 3, 4, 7, 1000, Infinity]),
  };
  if (rnd() < 0.5) {
    options.headerOptions = {};
    for (const key of [
      'includeIndex',
      'includeUnderline',
      'includeFileHeaders',
    ] as const) {
      if (rnd() < 0.6) options.headerOptions[key] = rnd() < 0.7;
    }
  }
  const randName = () =>
    rnd() < 0.1
      ? undefined
      : rnd() < 0.4
        ? pick(['a.txt', 'b/x.txt', ''])
        : randStr(nameChars, 8);
  const oldName = randName();
  const newName = rnd() < 0.3 ? oldName : randName();
  const oldHeader = rnd() < 0.4 ? undefined : randStr(nameChars, 10);
  const newHeader = rnd() < 0.4 ? undefined : randStr(nameChars, 10);
  // copy the options: jsdiff writes the default context into them
  expect(
    createTwoFilesPatch(oldName, newName, a, b, oldHeader, newHeader, options),
    `createTwoFilesPatch ${JSON.stringify({ oldName, newName, oldHeader, newHeader, options })} ${input}`
  ).toBe(
    jsdiff.createTwoFilesPatch(
      oldName as string,
      newName as string,
      a,
      b,
      oldHeader,
      newHeader,
      { ...options } as jsdiff.CreatePatchOptionsNonabortable
    )
  );
}

// warning: CI runs this next to other tasks, up to 5x slower than its ~1.5 s alone
test('fuzz structured edits against diff@9.0.0', () => {
  try {
    for (let iter = 0; iter < 1500; iter++) {
      const [name, gen] = pick(generators);
      // ASCII-run tokens average 13 chars, and jsdiff is near-quadratic on long texts
      const size = name === 'ascii runs' ? 40 : 120;
      const tokens = Array.from({ length: int(size) }, gen);
      let a = tokens.join('');
      let b: string;
      const shape = rnd();
      if (shape < 0.6) b = editTokens(tokens, gen).join('');
      else if (shape < 0.7) {
        // whitespace-only line edits, for ignoreWhitespace
        b = a
          .split('\n')
          .map((line) => {
            const r = rnd();
            if (r < 0.2) return pick(spaces) + line;
            if (r < 0.35) return line + pick(spaces);
            if (r < 0.45) return line.trimStart();
            if (r < 0.55)
              return line.endsWith('\r') ? line.slice(0, -1) : `${line}\r`;
            return line;
          })
          .join('\n');
      } else if (shape < 0.8) {
        const extra = Array.from({ length: 1 + int(5) }, gen).join('');
        b = rnd() < 0.5 ? a + extra : extra + a;
      } else if (shape < 0.85) b = '';
      else if (shape < 0.9) b = a;
      else if (shape < 0.95) {
        // a pure ASCII side skips the UTF-16 count
        b = editTokens(tokens, gen).join('');
        a = a.replace(/[^\0-\x7F]/g, ' ');
      } else b = Array.from({ length: int(size) }, gen).join('');
      if (rnd() < 0.5) [a, b] = [b, a];
      // every 8th pair gets a new instance for each call, so wasm memory grows mid-call
      setMemoryLimit(iter % 8 === 0 ? 0 : 32 << 20);
      expectParity(a, b, `${name} iter ${iter}`);
    }
  } finally {
    setMemoryLimit(32 << 20);
  }
}, 30_000);

test('large and degenerate inputs match jsdiff', () => {
  const long = 'é'.repeat(5000) + 'abc'.repeat(3000);
  const lines = Array.from({ length: 5000 }, (_, i) => `line ${i % 97}\n`).join(
    ''
  );
  const lone = Array.from({ length: 600 }, (_, i) =>
    String.fromCharCode(0xd800 + ((i * 7919) % 0x800))
  ).join('');
  const cases: [string, string][] = [
    // one long line edited in the middle: long common runs on both sides
    [long, `${long.slice(0, 7000)}Z${long.slice(7001)}`],
    ['a'.repeat(3000), `${'a'.repeat(2990)}b${'a'.repeat(9)}`],
    ['ab'.repeat(800), 'ba'.repeat(800)],
    ['', lines],
    [lines, ''],
    [lines, lines.replace(/line 5\n/g, 'line 5 \n')],
    [lines.slice(0, 2000), lines.slice(0, 2000).replace(/\n/g, '\r\n')],
    [lone, lone.split('').reverse().join('')],
  ];
  for (const [i, [a, b]] of cases.entries()) expectParity(a, b, `case ${i}`);
});

// untyped JS callers: jsdiff tests options, header fields, and headers for truthiness
test('option values count as truthy or falsy, as in jsdiff', () => {
  const a = '  a\r\nb\n';
  const b = 'a\r\n  b \n';
  const values = [1, 'yes', {}, 0, '', NaN, null, undefined, false, true];
  for (const v of values as unknown as boolean[]) {
    const label = `${typeof v} ${JSON.stringify(v)}`;
    const lineOptions = { ignoreWhitespace: v, stripTrailingCr: v };
    expect(diffLines(a, b, lineOptions), label).toStrictEqual(
      jsdiff.diffLines(a, b, lineOptions)
    );
    const options = {
      ...lineOptions,
      headerOptions: {
        includeIndex: v,
        includeUnderline: v,
        includeFileHeaders: v,
      },
    };
    const header = v as unknown as string;
    expect(createPatch('f', a, b, header, header, options), label).toBe(
      jsdiff.createPatch('f', a, b, header, header, options)
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
