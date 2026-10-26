import { expect, test } from 'bun:test';

import { samples } from './_samples';
import {
  assertLineFedParity,
  checkInvariants,
  loadLang,
  makeRand,
  tokenKinds,
} from './_util';

test('jsonnet: fields, visibility marks, methods, and computed names', () => {
  expect(
    tokenKinds(
      'jsonnet',
      '{ a: 1, b:: 2, c::: 3, d+: 4, "e": 5, f(x, y=1):: x, [k]: 6 }'
    )
  ).toEqual([
    ['{', 'punctuation.bracket'],
    ['a', 'property'],
    [':', 'punctuation.delimiter'],
    ['1', 'number'],
    [',', 'punctuation.delimiter'],
    ['b', 'property'],
    ['::', 'punctuation.delimiter'],
    ['2', 'number'],
    [',', 'punctuation.delimiter'],
    ['c', 'property'],
    [':::', 'punctuation.delimiter'],
    ['3', 'number'],
    [',', 'punctuation.delimiter'],
    ['d', 'property'],
    ['+', 'operator'],
    [':', 'punctuation.delimiter'],
    ['4', 'number'],
    [',', 'punctuation.delimiter'],
    ['"e"', 'property'],
    [':', 'punctuation.delimiter'],
    ['5', 'number'],
    [',', 'punctuation.delimiter'],
    ['f', 'function.definition'],
    ['(', 'punctuation.bracket'],
    ['x', 'variable.parameter'],
    [',', 'punctuation.delimiter'],
    ['y', 'variable.parameter'],
    ['=', 'operator'],
    ['1', 'number'],
    [')', 'punctuation.bracket'],
    ['::', 'punctuation.delimiter'],
    ['x', 'variable'],
    [',', 'punctuation.delimiter'],
    ['[', 'punctuation.bracket'],
    ['k', 'variable'],
    [']', 'punctuation.bracket'],
    [':', 'punctuation.delimiter'],
    ['6', 'number'],
    ['}', 'punctuation.bracket'],
  ]);
  // array elements and call arguments are not field names
  expect(tokenKinds('jsonnet', '{ a: [b, c], d: f(e, g) }')).toEqual([
    ['{', 'punctuation.bracket'],
    ['a', 'property'],
    [':', 'punctuation.delimiter'],
    ['[', 'punctuation.bracket'],
    ['b', 'variable'],
    [',', 'punctuation.delimiter'],
    ['c', 'variable'],
    [']', 'punctuation.bracket'],
    [',', 'punctuation.delimiter'],
    ['d', 'property'],
    [':', 'punctuation.delimiter'],
    ['f', 'function'],
    ['(', 'punctuation.bracket'],
    ['e', 'variable'],
    [',', 'punctuation.delimiter'],
    ['g', 'variable'],
    [') }', 'punctuation.bracket'],
  ]);
});

test('jsonnet: locals, functions, members, and the std library', () => {
  expect(
    tokenKinds(
      'jsonnet',
      'local f(a) = a, g = function(b) b; std.length(self.x) + $.y + super.z'
    )
  ).toEqual([
    ['local', 'keyword.declaration'],
    ['f', 'function.definition'],
    ['(', 'punctuation.bracket'],
    ['a', 'variable.parameter'],
    [')', 'punctuation.bracket'],
    ['=', 'operator'],
    ['a', 'variable'],
    [',', 'punctuation.delimiter'],
    ['g', 'variable'],
    ['=', 'operator'],
    ['function', 'keyword.declaration'],
    ['(', 'punctuation.bracket'],
    ['b', 'variable.parameter'],
    [')', 'punctuation.bracket'],
    ['b', 'variable'],
    [';', 'punctuation.delimiter'],
    ['std', 'namespace'],
    ['.', 'punctuation.delimiter'],
    ['length', 'function'],
    ['(', 'punctuation.bracket'],
    ['self', 'variable.special'],
    ['.', 'punctuation.delimiter'],
    ['x', 'property'],
    [')', 'punctuation.bracket'],
    ['+', 'operator'],
    ['$', 'variable.special'],
    ['.', 'punctuation.delimiter'],
    ['y', 'property'],
    ['+', 'operator'],
    ['super', 'variable.special'],
    ['.', 'punctuation.delimiter'],
    ['z', 'property'],
  ]);
  const tokens = tokenKinds('jsonnet', samples.jsonnet.code);
  for (const [text, kind] of [
    ['import', 'keyword.import'],
    ['greet', 'function.definition'],
    ['punct', 'variable.parameter'],
    ['method', 'function.definition'],
    ['null', 'constant.builtin'],
    ['for', 'keyword.control'],
    ['true', 'boolean'],
  ]) {
    expect(tokens).toContainEqual([text, kind]);
  }
});

test('jsonnet: strings, verbatim strings, text blocks, and comments', () => {
  expect(
    tokenKinds(
      'jsonnet',
      `"a\\tb" 'c' @"d""e" @'f''g' # hash\n// line\n/* block */`
    )
  ).toEqual([
    ['"a', 'string'],
    ['\\t', 'string.escape'],
    [`b" 'c' @"d""e" @'f''g'`, 'string'],
    ['# hash', 'comment'],
    ['// line', 'comment'],
    ['/* block */', 'comment'],
  ]);
  // a text block ends only at a line that starts with `|||`
  expect(tokenKinds('jsonnet', '{ x: |||-\n  a ||| b\n  |||, y: 1 }')).toEqual([
    ['{', 'punctuation.bracket'],
    ['x', 'property'],
    [':', 'punctuation.delimiter'],
    ['|||-', 'string'],
    ['a ||| b', 'string'],
    ['|||', 'string'],
    [',', 'punctuation.delimiter'],
    ['y', 'property'],
    [':', 'punctuation.delimiter'],
    ['1', 'number'],
    ['}', 'punctuation.bracket'],
  ]);
  for (const code of [
    samples.jsonnet.code,
    'x: |||\n  one\n\n  two ||| not yet\n|||\n',
    '{\r\n  s: |||\r\n    one\r\n  |||,\r\n  t: 1,\r\n}\r\n',
    '{ a: \'one\ntwo\', b: @"x\n""y", /* c\nd */ e: 1 }\n',
    '{\n  f(a,\n    b):: a,\n  g: 1,\n}\n',
  ]) {
    assertLineFedParity('jsonnet', code);
  }
});

test('jsonnet: malformed and random input remains total, balanced and lossless', () => {
  const lexer = loadLang('jsonnet', '$hlJsonnet');
  for (const code of [
    '',
    '|||',
    '|||\n',
    '||',
    '@',
    '@"',
    "'",
    '"\\',
    '/*',
    '#',
    '}}}',
    '((((',
    'local',
    'function(',
  ]) {
    checkInvariants(lexer.hl, code);
  }
  const rand = makeRand(0x150);
  const alphabet = Array.from(
    'abcXYZ09_$ "\'\n\r\t()[]{}.,:;+-*=<>|/\\#@%&^~!λ😀'
  );
  for (let n = 0; n < 160; n++) {
    let src = '';
    for (let i = 0, len = rand() & 63; i < len; i++) {
      src += alphabet[rand() % alphabet.length];
    }
    checkInvariants(lexer.hl, src);
    assertLineFedParity('jsonnet', src);
  }
});
