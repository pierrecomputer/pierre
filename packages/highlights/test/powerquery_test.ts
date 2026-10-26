import { expect, test } from 'bun:test';

import { samples } from './_samples';
import { assertLineFedParity, tokenKinds } from './_util';

test('powerquery: let steps, library functions, and quoted names', () => {
  expect(
    tokenKinds(
      'powerquery',
      'let #"My Step" = Text.Upper(x), y = Int64.Type in y'
    )
  ).toEqual([
    ['let', 'keyword'],
    ['#"My Step"', 'variable'],
    ['=', 'operator'],
    ['Text.Upper', 'function'],
    ['(', 'punctuation.bracket'],
    ['x', 'variable'],
    [')', 'punctuation.bracket'],
    [',', 'punctuation.delimiter'],
    ['y', 'variable'],
    ['=', 'operator'],
    ['Int64.Type', 'type.builtin'],
    ['in', 'keyword'],
    ['y', 'variable'],
  ]);
  const tokens = tokenKinds('powerquery', samples.powerquery.code);
  for (const [text, kind] of [
    ['each', 'keyword'],
    ['try', 'keyword.control'],
    ['otherwise', 'keyword.control'],
    ['null', 'constant.builtin'],
    ['number', 'type.builtin'],
    ['JoinKind.LeftOuter', 'constant'],
    ['#date', 'function'],
    ['_', 'variable.special'],
    ['true', 'boolean'],
  ]) {
    expect(tokens).toContainEqual([text, kind]);
  }
});

test('powerquery: record fields, field access, and lists', () => {
  expect(
    tokenKinds('powerquery', 'r = [a = 1, b = x], v = r[a] + {1..3}{0}')
  ).toEqual([
    ['r', 'variable'],
    ['=', 'operator'],
    ['[', 'punctuation.bracket'],
    ['a', 'property'],
    ['=', 'operator'],
    ['1', 'number'],
    [',', 'punctuation.delimiter'],
    ['b', 'property'],
    ['=', 'operator'],
    ['x', 'variable'],
    [']', 'punctuation.bracket'],
    [',', 'punctuation.delimiter'],
    ['v', 'variable'],
    ['=', 'operator'],
    ['r', 'variable'],
    ['[', 'punctuation.bracket'],
    ['a', 'property'],
    [']', 'punctuation.bracket'],
    ['+', 'operator'],
    ['{', 'punctuation.bracket'],
    ['1', 'number'],
    ['..', 'operator'],
    ['3', 'number'],
    ['}{', 'punctuation.bracket'],
    ['0', 'number'],
    ['}', 'punctuation.bracket'],
  ]);
  // keywords are case-sensitive; `=>` after a name is not a field definition
  expect(tokenKinds('powerquery', '[f = (x) => x, If = 1]')).toContainEqual([
    'If',
    'property',
  ]);
});

test('powerquery: text escapes and multiline text', () => {
  expect(
    tokenKinds('powerquery', 's = "a#(cr,lf)b""c""#(tab)#x" & "#(00E9)"')
  ).toEqual([
    ['s', 'variable'],
    ['=', 'operator'],
    ['"a', 'string'],
    ['#(cr,lf)', 'string.escape'],
    ['b', 'string'],
    ['""', 'string.escape'],
    ['c', 'string'],
    ['""#(tab)', 'string.escape'],
    ['#x"', 'string'],
    ['&', 'operator'],
    ['"', 'string'],
    ['#(00E9)', 'string.escape'],
    ['"', 'string'],
  ]);
  const code = 's = "one ""a""\ntwo #(lf)\nthree", t = 1 /* x\ny */\n';
  expect(tokenKinds('powerquery', code)).toEqual([
    ['s', 'variable'],
    ['=', 'operator'],
    ['"one', 'string'],
    ['""', 'string.escape'],
    ['a', 'string'],
    ['""', 'string.escape'],
    ['two', 'string'],
    ['#(lf)', 'string.escape'],
    ['three"', 'string'],
    [',', 'punctuation.delimiter'],
    ['t', 'variable'],
    ['=', 'operator'],
    ['1', 'number'],
    ['/* x', 'comment'],
    ['y */', 'comment'],
  ]);
  assertLineFedParity('powerquery', code);
  assertLineFedParity('powerquery', code.replaceAll('\n', '\r\n'));
  assertLineFedParity('powerquery', '[a =\n1, b = [c\n= 2]]\n');
});
