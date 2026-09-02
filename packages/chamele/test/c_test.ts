import assert from 'node:assert';
import t from 'node:test';

import type { ThemedToken } from '../lib/index';
import { codeToTokens, init, StreamTokenizer } from '../lib/index';
import { transformWat, wat2wasm } from '../scripts/build';
import pierreDark from '../themes/pierre-dark.json' with { type: 'json' };
import {
  checkInvariants,
  colorOf,
  loadLang,
  spansOf,
  type TestLang,
  themeColor,
} from './util';

let c: TestLang;

t.before(() => {
  c = loadLang('c', '$hlC');
  const url = new URL('../src/chamele.wat', import.meta.url);
  init(new WebAssembly.Module(wat2wasm(url.pathname, transformWat(url).code)));
});

/**
 * Tokens from the full module for a whole-buffer run and for a stream fed
 * one line per chunk, the shape the live tokenizer uses; both must agree.
 */
function lineFed(code: string): {
  direct: ThemedToken[][];
  streamed: ThemedToken[][];
} {
  const options = { lang: 'c' as const, theme: pierreDark };
  const direct = codeToTokens(code, options).tokens;
  const stream = new StreamTokenizer(options);
  const streamed: ThemedToken[][] = [];
  for (const line of code.split(/(?<=\n)/)) {
    streamed.push(...stream.pushCode(line));
  }
  streamed.push(...stream.end());
  return { direct, streamed };
}

const COMMENT = themeColor('comment');
const PREPROC = themeColor('preproc');
const STRING = themeColor('string');
const ESCAPE = themeColor('string.escape');
const NUMBER = themeColor('number');
const KEYWORD = themeColor('keyword');
const TYPE = themeColor('type.builtin');
const VARIABLE = themeColor('variable');
const FUNCTION = themeColor('function');
const CONSTANT = themeColor('constant');
const OPERATOR = themeColor('operator');
const PUNCT = themeColor('punctuation.bracket');

void t.test('c: comments and documentation comments', () => {
  const src =
    '// plain\n/// line docs\n/* block */\n/** block docs */\n//! inner docs';
  const html = checkInvariants(c.hl, src);
  assert.equal(colorOf(html, '// plain'), COMMENT);
  assert.equal(colorOf(html, '/* block */'), COMMENT);

  const bucketTheme = {
    name: 'c-comment-buckets',
    appearance: 'dark',
    style: {
      background: '#000000',
      foreground: '#ffffff',
      syntax: {
        comment: { color: '#111111' },
        'comment.doc': { color: '#222222' },
      },
    },
  };
  const bucketed = checkInvariants(c.hl, src, { theme: bucketTheme });
  assert.equal(colorOf(bucketed, '/// line docs'), '#222222');
  assert.equal(colorOf(bucketed, '/** block docs */'), '#222222');
  assert.equal(colorOf(bucketed, '//! inner docs'), '#222222');
});

void t.test('c: preprocessor directives are bounded line tokens', () => {
  const src =
    '#include <stdio.h>\n# include "local.h"\n#define ADD(a, b) ((a) + (b))\nint x;';
  const html = checkInvariants(c.hl, src);
  assert.equal(colorOf(html, '#include'), PREPROC);
  assert.equal(colorOf(html, '<stdio.h>'), STRING);
  assert.equal(colorOf(html, '"local.h"'), STRING);
  assert.equal(colorOf(html, '#define ADD(a, b) ((a) + (b))'), PREPROC);
  assert.equal(colorOf(html, 'int'), TYPE);
});

void t.test('c: strings, character literals, prefixes, and escapes', () => {
  const src = String.raw`const char *s = u8"a\n\x41"; wchar_t q = L'\'';`;
  const html = checkInvariants(c.hl, src);
  assert.equal(colorOf(html, 'u8"a'), STRING);
  assert.equal(colorOf(html, String.raw`\n`), ESCAPE);
  assert.equal(colorOf(html, String.raw`\x`), ESCAPE);
  assert.equal(colorOf(html, String.raw`\'`), ESCAPE);
});

void t.test('c: numeric preprocessing tokens', () => {
  const src = 'int n = 42 + 0xffu + 0755 + 3.14f + 1e-3 + 0x1.fp+3 + .5;';
  const html = checkInvariants(c.hl, src);
  for (const literal of [
    '42',
    '0xffu',
    '0755',
    '3.14f',
    '1e-3',
    '0x1.fp+3',
    '.5',
  ]) {
    assert.equal(colorOf(html, literal), NUMBER, literal);
  }
});

void t.test('c: keywords, types, functions, variables, and constants', () => {
  const src =
    'static unsigned long sum(int count) { if (count > 0) return sum(count - MAX); else return 0; }';
  const html = checkInvariants(c.hl, src);
  assert.equal(colorOf(html, 'static'), KEYWORD);
  assert.equal(colorOf(html, 'unsigned'), TYPE);
  assert.equal(colorOf(html, 'long'), TYPE);
  assert.equal(colorOf(html, 'sum'), FUNCTION);
  assert.equal(colorOf(html, 'if'), KEYWORD);
  assert.equal(colorOf(html, 'return'), KEYWORD);
  assert.equal(colorOf(html, 'count'), VARIABLE);
  assert.equal(colorOf(html, 'MAX'), CONSTANT);
});

void t.test('c: enum word table preserves every keyword category', () => {
  const theme = {
    name: 'c-word-categories',
    appearance: 'dark',
    style: {
      background: '#000000',
      foreground: '#ffffff',
      syntax: {
        'keyword.control': { color: '#110001' },
        'keyword.declaration': { color: '#220002' },
        'type.builtin': { color: '#330003' },
        keyword: { color: '#440004' },
        boolean: { color: '#550005' },
        'constant.builtin': { color: '#660006' },
        variable: { color: '#770007' },
      },
    },
  };
  const categories = [
    [
      '#110001',
      [
        'do',
        'if',
        'for',
        'case',
        'else',
        'goto',
        'break',
        'while',
        'return',
        'switch',
        'default',
        'continue',
      ],
    ],
    ['#220002', ['auto', 'extern', 'inline', 'static', 'typedef', 'register']],
    [
      '#330003',
      [
        'int',
        'bool',
        'char',
        'enum',
        'long',
        'void',
        'float',
        'short',
        'union',
        '_Bool',
        'double',
        'signed',
        'struct',
        'unsigned',
        '_Complex',
      ],
    ],
    [
      '#440004',
      [
        'const',
        'sizeof',
        'restrict',
        'volatile',
        '_Atomic',
        '_Alignas',
        '_Alignof',
        '_Generic',
      ],
    ],
    ['#550005', ['true', 'false']],
    ['#660006', ['nullptr']],
    ['#770007', ['ordinary']],
  ];
  for (const [color, words] of categories) {
    for (const word of words) {
      assert.equal(
        colorOf(checkInvariants(c.hl, word, { theme }), word),
        color,
        word
      );
    }
  }
});

void t.test('c: operators and punctuation', () => {
  const src = 'a <<= 2; b = (a && c) ? x->y : z[i];';
  const html = checkInvariants(c.hl, src);
  for (const operator of ['<<=', '=', '&&', '?', '->']) {
    assert.equal(colorOf(html, operator), OPERATOR, operator);
  }
  for (const bracket of ['(', ')', '[', ']']) {
    assert.equal(colorOf(html, bracket), PUNCT, bracket);
  }
});

void t.test('c: malformed constructs stay lossless and total', () => {
  for (const src of [
    '"unterminated',
    "'x",
    '/* unterminated',
    '/',
    '0x + 1e+',
    '#define X \\',
    '#include <unterminated',
    '<tag>& raw',
    'éclair(à);',
  ]) {
    checkInvariants(c.hl, src);
  }
});

void t.test('c: lookahead and token scans never cross a split range', () => {
  for (const [prefix, tail] of [
    ['/', '/ comment\nint x;'],
    ['/', '* comment */ int x;'],
    ['u8"a', '\\n"; int x;'],
    ['1e', '+3 + 4'],
    ['<', '<= x'],
  ]) {
    const ranged = loadLang('c', '$hlC', prefix.length);
    checkInvariants(ranged.hl, prefix + tail);
  }
  const include = '# include <é/path.h>';
  const size = new TextEncoder().encode(include).length;
  for (let split = 0; split <= size; split++)
    checkInvariants(loadLang('c', '$hlC', split).hl, include);
});

void t.test('c: same-style runs remain balanced', () => {
  const html = checkInvariants(c.hl, 'int long x; foo(bar); // tail');
  assert.ok(spansOf(html).length > 0);
});

void t.test('c: modern keywords beyond the eight-byte word table', () => {
  const theme = {
    name: 'c-long-words',
    appearance: 'dark',
    style: {
      background: '#000000',
      foreground: '#ffffff',
      syntax: {
        'keyword.declaration': { color: '#220002' },
        'type.builtin': { color: '#330003' },
        keyword: { color: '#440004' },
        variable: { color: '#770007' },
      },
    },
  };
  const expected: [string, string[]][] = [
    ['#220002', ['_Noreturn', '_Thread_local', 'thread_local']],
    ['#330003', ['_Imaginary']],
    [
      '#440004',
      [
        '_Static_assert',
        'static_assert',
        'constexpr',
        'typeof',
        'typeof_unqual',
        'alignas',
        'alignof',
      ],
    ],
    // near misses of every gated length stay ordinary names
    ['#770007', ['_Noreturnx', 'typeofx', 'alignat', '_Thread_locaL', 'x']],
  ];
  for (const [color, words] of expected) {
    for (const word of words) {
      const html = checkInvariants(c.hl, `${word};`, { theme });
      assert.equal(colorOf(html, word), color, word);
    }
  }
});

void t.test('c: a lone capital letter is a type, not a constant', () => {
  const html = checkInvariants(c.hl, 'T max(T a, T b);');
  const exact = (text: string) =>
    spansOf(html).find((span) => span.text.trim() === text)?.color;
  assert.equal(exact('T'), themeColor('type'));
  assert.equal(exact('a'), VARIABLE);
});

void t.test('c: escaped line breaks inside literals resume line-fed', () => {
  const html = checkInvariants(c.hl, 's = "abc\\\r\ndef";');
  assert.equal(colorOf(html, 'def"'), STRING);
  for (const code of [
    's = "abc\\\ndef";\nint z = 1;\n',
    's = "abc\\\r\ndef";\r\nint z = 1;\r\n',
    "c = 'a\\\n';\nint z = 1;\n",
  ]) {
    const { direct, streamed } = lineFed(code);
    assert.deepEqual(streamed, direct, JSON.stringify(code));
  }
});
