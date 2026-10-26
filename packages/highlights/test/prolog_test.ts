import { expect, test } from 'bun:test';

import { samples } from './_samples';
import { assertLineFedParity, tokenKinds } from './_util';

test('prolog: clause heads, directives, calls, atoms, and variables', () => {
  expect(
    tokenKinds('prolog', ':- module(m, [p/1]).\np(X) :- q(X, foo), !.')
  ).toEqual([
    [':-', 'operator'],
    ['module', 'keyword.import'],
    ['(', 'punctuation.bracket'],
    ['m', 'string.special.symbol'],
    [',', 'punctuation.delimiter'],
    ['[', 'punctuation.bracket'],
    ['p', 'function'],
    ['/', 'operator'],
    ['1', 'number'],
    ['])', 'punctuation.bracket'],
    ['.', 'punctuation.delimiter'],
    ['p', 'function.definition'],
    ['(', 'punctuation.bracket'],
    ['X', 'variable'],
    [')', 'punctuation.bracket'],
    [':-', 'operator'],
    ['q', 'function'],
    ['(', 'punctuation.bracket'],
    ['X', 'variable'],
    [',', 'punctuation.delimiter'],
    ['foo', 'string.special.symbol'],
    [')', 'punctuation.bracket'],
    [',', 'punctuation.delimiter'],
    ['!', 'keyword.control'],
    ['.', 'punctuation.delimiter'],
  ]);
  const tokens = tokenKinds('prolog', samples.prolog.code);
  for (const [text, kind] of [
    ['dynamic', 'keyword'],
    ['parent', 'function.definition'],
    ["'Bob Lee'", 'string.special.symbol'],
    ['is', 'keyword.operator'],
    ['greeting', 'function.definition'],
    ['-->', 'operator'],
    ['true', 'keyword.control'],
    ['format', 'function'],
  ]) {
    expect(tokens).toContainEqual([text, kind]);
  }
  // a clause head may reuse a built-in name; `_` is a variable
  expect(tokenKinds('prolog', 'member(X, [X|_]).')).toContainEqual([
    'member',
    'function.definition',
  ]);
  expect(tokenKinds('prolog', 'member(X, [X|_]).')).toContainEqual([
    '_',
    'variable',
  ]);
});

test('prolog: numbers, character codes, operators, and the end token', () => {
  expect(
    tokenKinds(
      'prolog',
      "x :- A is 0x1F + 1_000 * 1.5e3, B = 0'a, C = 0'\\n, D = 0'''."
    )
  ).toEqual([
    ['x', 'function.definition'],
    [':-', 'operator'],
    ['A', 'variable'],
    ['is', 'keyword.operator'],
    ['0x1F', 'number'],
    ['+', 'operator'],
    ['1_000', 'number'],
    ['*', 'operator'],
    ['1.5e3', 'number'],
    [',', 'punctuation.delimiter'],
    ['B', 'variable'],
    ['=', 'operator'],
    ["0'a", 'number'],
    [',', 'punctuation.delimiter'],
    ['C', 'variable'],
    ['=', 'operator'],
    ["0'\\n", 'number'],
    [',', 'punctuation.delimiter'],
    ['D', 'variable'],
    ['=', 'operator'],
    ["0'''", 'number'],
    ['.', 'punctuation.delimiter'],
  ]);
  for (const op of ['=..', '\\==', '=\\=', '=:=', '@<', '\\+', '->']) {
    expect(tokenKinds('prolog', `t :- a ${op} b.`)).toContainEqual([
      op,
      'operator',
    ]);
  }
  // a `.` before a name is an operator, not the end of the clause
  expect(tokenKinds('prolog', 'a :- X = b.c.\nd.')).toEqual([
    ['a', 'function.definition'],
    [':-', 'operator'],
    ['X', 'variable'],
    ['=', 'operator'],
    ['b', 'string.special.symbol'],
    ['.', 'operator'],
    ['c', 'string.special.symbol'],
    ['.', 'punctuation.delimiter'],
    ['d', 'function.definition'],
    ['.', 'punctuation.delimiter'],
  ]);
});

test('prolog: comments, strings, and clause state cross lines', () => {
  expect(tokenKinds('prolog', 'a :- % note\n  b.\n/* c\n d */ e.')).toEqual([
    ['a', 'function.definition'],
    [':-', 'operator'],
    ['% note', 'comment'],
    ['b', 'string.special.symbol'],
    ['.', 'punctuation.delimiter'],
    ['/* c', 'comment'],
    ['d */', 'comment'],
    ['e', 'function.definition'],
    ['.', 'punctuation.delimiter'],
  ]);
  expect(tokenKinds('prolog', 'p :- X = "a\\"b", Y = `c`.')).toContainEqual([
    '\\"',
    'string.escape',
  ]);
  for (const code of [
    samples.prolog.code,
    'a :-\n  b,\n  c.\nd.\n',
    'p("one\\\ntwo").\nq.\n',
  ]) {
    assertLineFedParity('prolog', code);
  }
});
