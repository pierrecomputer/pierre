import { expect, test } from 'bun:test';

import { samples } from './_samples';
import {
  assertLineFedParity,
  checkInvariants,
  loadLang,
  makeRand,
  tokenKinds,
} from './_util';

test('luau: annotations, generics, and type aliases', () => {
  expect(tokenKinds('luau', 'local n: number? = nil')).toEqual([
    ['local', 'keyword.declaration'],
    ['n', 'variable'],
    [':', 'punctuation.delimiter'],
    ['number', 'type.builtin'],
    ['? =', 'operator'],
    ['nil', 'constant.builtin'],
  ]);
  expect(
    tokenKinds('luau', 'local function map<T>(xs: {T}, f: (T) -> U): {U}')
  ).toEqual([
    ['local function', 'keyword.declaration'],
    ['map', 'function.definition'],
    ['<', 'punctuation.bracket'],
    ['T', 'type'],
    ['>(', 'punctuation.bracket'],
    ['xs', 'variable'],
    [':', 'punctuation.delimiter'],
    ['{', 'punctuation.bracket'],
    ['T', 'type'],
    ['}', 'punctuation.bracket'],
    [',', 'punctuation.delimiter'],
    ['f', 'variable'],
    [':', 'punctuation.delimiter'],
    ['(', 'punctuation.bracket'],
    ['T', 'type'],
    [')', 'punctuation.bracket'],
    ['->', 'operator'],
    ['U', 'type'],
    [')', 'punctuation.bracket'],
    [':', 'punctuation.delimiter'],
    ['{', 'punctuation.bracket'],
    ['U', 'type'],
    ['}', 'punctuation.bracket'],
  ]);
  expect(
    tokenKinds('luau', 'export type Pair<K, V> = { key: K, value: V } | nil')
  ).toEqual([
    ['export', 'keyword'],
    ['type', 'keyword.declaration'],
    ['Pair', 'type'],
    ['<', 'punctuation.bracket'],
    ['K', 'type'],
    [',', 'punctuation.delimiter'],
    ['V', 'type'],
    ['>', 'punctuation.bracket'],
    ['=', 'operator'],
    ['{', 'punctuation.bracket'],
    ['key', 'property'],
    [':', 'punctuation.delimiter'],
    ['K', 'type'],
    [',', 'punctuation.delimiter'],
    ['value', 'property'],
    [':', 'punctuation.delimiter'],
    ['V', 'type'],
    ['}', 'punctuation.bracket'],
    ['|', 'operator'],
    ['nil', 'type.builtin'],
  ]);
});

test('luau: a type ends at a keyword, an operator, or the end of its line', () => {
  // a complete type at the end of a line ends it; `|` on the next line resumes
  expect(
    tokenKinds('luau', 'type Mode =\n  | "on"\n  | "off"\nMode = 1')
  ).toEqual([
    ['type', 'keyword.declaration'],
    ['Mode', 'type'],
    ['=', 'operator'],
    ['|', 'operator'],
    ['"on"', 'string'],
    ['|', 'operator'],
    ['"off"', 'string'],
    ['Mode', 'variable'],
    ['=', 'operator'],
    ['1', 'number'],
  ]);
  expect(tokenKinds('luau', 'local t: Foo\nt = Bar')).toContainEqual([
    'Bar',
    'variable',
  ]);
  expect(tokenKinds('luau', 'local s: string = a .. b')).toEqual([
    ['local', 'keyword.declaration'],
    ['s', 'variable'],
    [':', 'punctuation.delimiter'],
    ['string', 'type.builtin'],
    ['=', 'operator'],
    ['a', 'variable'],
    ['..', 'operator'],
    ['b', 'variable'],
  ]);
  // a multi-line table type keeps its fields
  expect(
    tokenKinds('luau', 'type P = {\n  x: number,\n  y: number,\n}\nprint(x)')
  ).toEqual([
    ['type', 'keyword.declaration'],
    ['P', 'type'],
    ['=', 'operator'],
    ['{', 'punctuation.bracket'],
    ['x', 'property'],
    [':', 'punctuation.delimiter'],
    ['number', 'type.builtin'],
    [',', 'punctuation.delimiter'],
    ['y', 'property'],
    [':', 'punctuation.delimiter'],
    ['number', 'type.builtin'],
    [',', 'punctuation.delimiter'],
    ['}', 'punctuation.bracket'],
    ['print', 'function'],
    ['(', 'punctuation.bracket'],
    ['x', 'variable'],
    [')', 'punctuation.bracket'],
  ]);
});

test('luau: method calls, casts, and contextual words', () => {
  expect(tokenKinds('luau', 'obj:send("x") obj:send "y" obj:send {}')).toEqual([
    ['obj', 'variable'],
    [':', 'punctuation.delimiter'],
    ['send', 'function.method'],
    ['(', 'punctuation.bracket'],
    ['"x"', 'string'],
    [')', 'punctuation.bracket'],
    ['obj', 'variable'],
    [':', 'punctuation.delimiter'],
    ['send', 'property'],
    ['"y"', 'string'],
    ['obj', 'variable'],
    [':', 'punctuation.delimiter'],
    ['send', 'property'],
    ['{}', 'punctuation.bracket'],
  ]);
  expect(tokenKinds('luau', 'print(v :: any, typeof(v))')).toEqual([
    ['print', 'function'],
    ['(', 'punctuation.bracket'],
    ['v', 'variable'],
    ['::', 'operator'],
    ['any', 'type.builtin'],
    [',', 'punctuation.delimiter'],
    ['typeof', 'function'],
    ['(', 'punctuation.bracket'],
    ['v', 'variable'],
    ['))', 'punctuation.bracket'],
  ]);
  // `type`, `export`, and builtin type names stay names outside a type
  expect(
    tokenKinds('luau', 'local type = type(x)\nstring.format(export)')
  ).toEqual([
    ['local', 'keyword.declaration'],
    ['type', 'variable'],
    ['=', 'operator'],
    ['type', 'function'],
    ['(', 'punctuation.bracket'],
    ['x', 'variable'],
    [')', 'punctuation.bracket'],
    ['string', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['format', 'function.method'],
    ['(', 'punctuation.bracket'],
    ['export', 'variable'],
    [')', 'punctuation.bracket'],
  ]);
  expect(
    tokenKinds('luau', '@native function f() x //= 2 continue end')
  ).toEqual([
    ['@native', 'attribute'],
    ['function', 'keyword.declaration'],
    ['f', 'function.definition'],
    ['()', 'punctuation.bracket'],
    ['x', 'variable'],
    ['//=', 'operator'],
    ['2', 'number'],
    ['continue end', 'keyword.control'],
  ]);
  for (const n of ['0b1010', '1_000', '0xFF_FF', '1e-3']) {
    expect(tokenKinds('luau', n)).toEqual([[n, 'number']]);
  }
});

test('luau: interpolated strings nest expressions and escapes', () => {
  expect(tokenKinds('luau', 'local s = `a {t[1]} \\{x} {`in {y}`}!`')).toEqual([
    ['local', 'keyword.declaration'],
    ['s', 'variable'],
    ['=', 'operator'],
    ['`a', 'string'],
    ['{', 'punctuation.special'],
    ['t', 'variable'],
    ['[', 'punctuation.bracket'],
    ['1', 'number'],
    [']', 'punctuation.bracket'],
    ['}', 'punctuation.special'],
    ['\\{', 'string.escape'],
    ['x}', 'string'],
    ['{', 'punctuation.special'],
    ['`in', 'string'],
    ['{', 'punctuation.special'],
    ['y', 'variable'],
    ['}', 'punctuation.special'],
    ['`', 'string'],
    ['}', 'punctuation.special'],
    ['!`', 'string'],
  ]);
  // a table constructor inside an expression keeps its braces
  expect(tokenKinds('luau', '`{f({a = 1})}`')).toEqual([
    ['`', 'string'],
    ['{', 'punctuation.special'],
    ['f', 'function'],
    ['({', 'punctuation.bracket'],
    ['a', 'variable'],
    ['=', 'operator'],
    ['1', 'number'],
    ['})', 'punctuation.bracket'],
    ['}', 'punctuation.special'],
    ['`', 'string'],
  ]);
  // like a Lua string, an unclosed one ends with its line
  expect(tokenKinds('luau', '`open\nx = 1')).toEqual([
    ['`open', 'string'],
    ['x', 'variable'],
    ['=', 'operator'],
    ['1', 'number'],
  ]);
});

test('luau: Lua keeps its own reading of the same text', () => {
  expect(tokenKinds('lua', 'local x: number = `s`')).toEqual([
    ['local', 'keyword.declaration'],
    ['x', 'variable'],
    [':', 'punctuation.delimiter'],
    ['number', 'property'],
    ['= `', 'operator'],
    ['s', 'variable'],
    ['`', 'operator'],
  ]);
  expect(tokenKinds('lua', '::top:: continue')).toEqual([
    ['::', 'punctuation.delimiter'],
    ['top', 'variable'],
    ['::', 'punctuation.delimiter'],
    ['continue', 'variable'],
  ]);
});

test('luau: multi-line types, strings, and comments resume line-fed', () => {
  for (const code of [
    samples.luau.code,
    'type T = {\n  a: { [string]: number },\n  b: (x: number) ->\n    string,\n}\nlocal v = 1\n',
    'local s = `x {\n  f(1)\n} y`\nprint(s)\n',
    '--[==[ a\n]] b ]==] local t: T\n= 2\n',
    'function f<T>(\n  a: T\n): T end\n',
  ]) {
    assertLineFedParity('luau', code);
  }
});

test('luau: malformed and random input remains total, balanced and lossless', () => {
  const lexer = loadLang('luau', '$hlLuau');
  const rand = makeRand(0x1a0a);
  const alphabet = Array.from('abT_09 "\'`\\\n\r\t{}[]()<>.,:;?|&=-+*/@#~λ😀');
  for (const code of [
    '',
    '`',
    '`{',
    '`{}',
    '::',
    ':',
    '@',
    '->',
    '<',
    'type',
  ]) {
    checkInvariants(lexer.hl, code);
  }
  for (let n = 0; n < 160; n++) {
    const code = Array.from(
      { length: rand() & 63 },
      () => alphabet[rand() % alphabet.length]
    ).join('');
    checkInvariants(lexer.hl, code);
  }
});
