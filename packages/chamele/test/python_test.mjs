import assert from 'node:assert';
import t from 'node:test';

import { checkInvariants, colorOf, loadLang, themeColor } from './util.mjs';

let python;

t.before(() => {
  python = loadLang('python', '$hlPython');
});

const COMMENT = themeColor('comment');
const ATTRIBUTE = themeColor('attribute');
const STRING = themeColor('string');
const ESCAPE = themeColor('string.escape');
const NUMBER = themeColor('number');
const CONTROL = themeColor('keyword.control');
const DECLARATION = themeColor('keyword.declaration');
const IMPORT = themeColor('keyword.import');
const TYPE = themeColor('type');
const TYPE_BUILTIN = themeColor('type.builtin');
const VARIABLE = themeColor('variable');
const FUNCTION = themeColor('function');
const OPERATOR = themeColor('operator');
const BRACKET = themeColor('punctuation.bracket');

t.test('python: comments and decorators', () => {
  const src =
    '@cache.memoize\n@pkg.decorator(arg)\ndef work():\n    # implementation note\n    pass';
  const html = checkInvariants(python.hl, src);
  assert.equal(colorOf(html, '@cache.memoize'), ATTRIBUTE);
  assert.equal(colorOf(html, '@pkg.decorator'), ATTRIBUTE);
  assert.equal(colorOf(html, '# implementation note'), COMMENT);
});

t.test('python: prefixed, triple, raw, byte, and f-strings', () => {
  const src =
    "a = \"line\\n\"\nb = r'raw\\n'\nc = br\"bytes\\x41\"\nd = f\"hello {name!r}\"\ne = '''multi\nline'''";
  const html = checkInvariants(python.hl, src);
  assert.equal(colorOf(html, String.raw`\n`), ESCAPE);
  assert.equal(colorOf(html, String.raw`r'raw\n'`), STRING);
  assert.equal(colorOf(html, String.raw`br"bytes\x41"`), STRING);
  assert.equal(colorOf(html, 'f"hello '), STRING);
  assert.equal(colorOf(html, '{'), themeColor('punctuation.special'));
  assert.equal(colorOf(html, "'''multi\nline'''"), STRING);
});

t.test('python: integers, floats, exponents, bases, and imaginaries', () => {
  const src = 'values = (42, 0xff, 0b1010, 1_000, 3.14, .5, 1e-9, 2j)';
  const html = checkInvariants(python.hl, src);
  for (const n of [
    '42',
    '0xff',
    '0b1010',
    '1_000',
    '3.14',
    '.5',
    '1e-9',
    '2j',
  ]) {
    assert.equal(colorOf(html, n), NUMBER, n);
  }
});

t.test('python: keywords, imports, literals, and builtins', () => {
  const src =
    'from pathlib import Path\nif value is not None and True:\n    return print(len(list(value)))';
  const html = checkInvariants(python.hl, src);
  assert.equal(colorOf(html, 'from'), IMPORT);
  assert.equal(colorOf(html, 'import'), IMPORT);
  assert.equal(colorOf(html, 'if'), CONTROL);
  assert.equal(colorOf(html, 'return'), CONTROL);
  assert.equal(colorOf(html, 'None'), themeColor('constant.builtin'));
  assert.equal(colorOf(html, 'True'), themeColor('boolean'));
  assert.equal(colorOf(html, 'print'), FUNCTION);
  assert.equal(colorOf(html, 'len'), FUNCTION);
  assert.equal(colorOf(html, 'list'), TYPE_BUILTIN);
});

t.test(
  'python: definitions, classes, calls, members, and type-ish names',
  () => {
    const src =
      'class Widget(Base):\n    LIMIT = 3\n    async def fetch(self, item: str) -> Response:\n        return client.retrieve(item).value';
    const html = checkInvariants(python.hl, src);
    assert.equal(colorOf(html, 'class'), DECLARATION);
    assert.equal(colorOf(html, 'Widget'), themeColor('type.class'));
    assert.equal(colorOf(html, 'Base'), TYPE);
    assert.equal(colorOf(html, 'fetch'), themeColor('function.definition'));
    assert.equal(colorOf(html, 'str'), TYPE_BUILTIN);
    assert.equal(colorOf(html, 'Response'), TYPE);
    assert.equal(colorOf(html, 'client'), VARIABLE);
    assert.equal(colorOf(html, 'retrieve'), themeColor('function.method'));
    assert.equal(colorOf(html, 'value'), themeColor('property'));
    assert.equal(colorOf(html, 'LIMIT'), themeColor('constant'));
  }
);

t.test('python: operators and punctuation', () => {
  const src = 'if (n := value // 2) >= 1 and n ** 2 != 3:\n    result: int = n';
  const html = checkInvariants(python.hl, src);
  for (const op of [':=', '//', '>=', '**', '!=']) {
    assert.equal(colorOf(html, op), OPERATOR, op);
  }
  assert.equal(colorOf(html, 'and'), themeColor('keyword.operator'));
  assert.equal(colorOf(html, '('), BRACKET);
});

t.test('python: malformed and UTF-8 input remains lossless', () => {
  for (const src of [
    "'unterminated λ",
    '"trailing escape \\',
    "r'raw trailing \\",
    "f'{未关闭'",
    "'''triple 雪",
    '0x + 1e+',
    '@',
    'café = naïve(🚀)',
  ])
    checkInvariants(python.hl, src);
});

t.test('python: lookahead is bounded by split ranges', () => {
  for (const [prefix, tail] of [
    ['r', "'raw\\n'"],
    ['fr', '"value {x}"'],
    ["'", "''doc\ntext'''"],
    ['#', ' comment\nx = 1'],
    ['-', '> Result'],
    [':', '= value'],
  ]) {
    const ranged = loadLang('python', '$hlPython', prefix.length);
    checkInvariants(ranged.hl, prefix + tail);
  }
});

t.test('python: deterministic fuzz preserves lexer invariants', () => {
  const alphabet = 'abcXYZ09_ rfb\'\\"{}()[]@#.:,+-*/|&=<>\nλ雪';
  let state = 0xc0ffee42;
  for (let sample = 0; sample < 180; sample++) {
    let src = '';
    const n = state >>> 27;
    for (let i = 0; i < n; i++) {
      state = (Math.imul(state, 1103515245) + 12345) >>> 0;
      src += alphabet[state % alphabet.length];
    }
    checkInvariants(python.hl, src);
  }
});
