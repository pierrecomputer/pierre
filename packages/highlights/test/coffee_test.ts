import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('coffee: comments, keywords, and word operators', () => {
  expect(
    tokenKinds('coffee', '# note\nx = yes unless no or off # tail\n')
  ).toEqual([
    ['# note', 'comment'],
    ['x', 'variable'],
    ['=', 'operator'],
    ['yes', 'boolean'],
    ['unless', 'keyword.control'],
    ['no', 'boolean'],
    ['or', 'keyword.operator'],
    ['off', 'boolean'],
    ['# tail', 'comment'],
  ]);
  // `####` is a line comment; `###` opens a block
  expect(tokenKinds('coffee', '#### rule\n### a\nb ### c')).toEqual([
    ['#### rule', 'comment'],
    ['### a', 'comment'],
    ['b ###', 'comment'],
    ['c', 'variable'],
  ]);
});

test('coffee: functions, parameters, classes, and keys', () => {
  expect(tokenKinds('coffee', 'add = (a, b = 1) -> a + b')).toEqual([
    ['add', 'function.definition'],
    ['=', 'operator'],
    ['(', 'punctuation.bracket'],
    ['a', 'variable.parameter'],
    [',', 'punctuation.delimiter'],
    ['b', 'variable.parameter'],
    ['=', 'operator'],
    ['1', 'number'],
    [')', 'punctuation.bracket'],
    ['->', 'keyword.declaration'],
    ['a', 'variable'],
    ['+', 'operator'],
    ['b', 'variable'],
  ]);
  expect(
    tokenKinds('coffee', 'class A extends B\n  run: => @x\n  size: 2')
  ).toEqual([
    ['class', 'keyword.declaration'],
    ['A', 'type.class'],
    ['extends', 'keyword.declaration'],
    ['B', 'type'],
    ['run', 'function.definition'],
    [':', 'punctuation.delimiter'],
    ['=>', 'keyword.declaration'],
    ['@x', 'variable.special'],
    ['size', 'property'],
    [':', 'punctuation.delimiter'],
    ['2', 'number'],
  ]);
  // a call's parentheses hold arguments, not parameters
  expect(tokenKinds('coffee', 'f(a) -> b').slice(0, 3)).toEqual([
    ['f', 'function'],
    ['(', 'punctuation.bracket'],
    ['a', 'variable'],
  ]);
});

test('coffee: strings, interpolation, and escapes', () => {
  expect(
    tokenKinds('coffee', `s = "a #{b + "c #{d}"} \\n" + 'e #{f}'`)
  ).toEqual([
    ['s', 'variable'],
    ['=', 'operator'],
    ['"a', 'string'],
    ['#{', 'punctuation.special'],
    ['b', 'variable'],
    ['+', 'operator'],
    ['"c #{d}"', 'string'],
    ['}', 'punctuation.special'],
    ['\\n', 'string.escape'],
    ['"', 'string'],
    ['+', 'operator'],
    ["'e #{f}'", 'string'],
  ]);
});

test('coffee: regex versus division and heregexes', () => {
  expect(tokenKinds('coffee', 'a = b / c / d\nf /x/g\nn = (m) /2')).toEqual([
    ['a', 'variable'],
    ['=', 'operator'],
    ['b', 'variable'],
    ['/', 'operator'],
    ['c', 'variable'],
    ['/', 'operator'],
    ['d', 'variable'],
    ['f', 'variable'],
    ['/x/g', 'string.regex'],
    ['n', 'variable'],
    ['=', 'operator'],
    ['(', 'punctuation.bracket'],
    ['m', 'variable'],
    [')', 'punctuation.bracket'],
    ['/', 'operator'],
    ['2', 'number'],
  ]);
  expect(
    tokenKinds('coffee', 'r = ///\n  \\d+ # digits\n  #{x}\n///i')
  ).toEqual([
    ['r', 'variable'],
    ['=', 'operator'],
    ['///', 'string.regex'],
    ['\\d', 'string.escape'],
    ['+', 'string.regex'],
    ['# digits', 'comment'],
    ['#{', 'punctuation.special'],
    ['x', 'variable'],
    ['}', 'punctuation.special'],
    ['///i', 'string.regex'],
  ]);
});

test('coffee: embedded JavaScript in backticks', () => {
  expect(tokenKinds('coffee', 'x = `var y = 1`')).toEqual([
    ['x', 'variable'],
    ['=', 'operator'],
    ['`', 'punctuation.special'],
    ['var', 'keyword.declaration'],
    ['y', 'variable'],
    ['=', 'operator'],
    ['1', 'number'],
    ['`', 'punctuation.special'],
  ]);
});

test('coffee: multi-line literals stream like the whole buffer', () => {
  for (const code of [
    '###\nblock /* comment\n###\nx = 1\n',
    's = """\n  a #{b}\n  c\n"""\nd = 2\n',
    "t = 'one\ntwo'\nu = 3 / 4\n",
    'm = "x #{\n  y + 1\n} z"\n',
    'r = ///\n  a # c\n  #{b}\n///g\n',
    '```\nconst a = `b`;\n/* c */\n```\nf /re/\n',
  ]) {
    assertLineFedParity('coffee', code);
  }
});
