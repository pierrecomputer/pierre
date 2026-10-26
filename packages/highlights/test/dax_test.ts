import { expect, test } from 'bun:test';

import { samples } from './_samples';
import { assertLineFedParity, tokenKinds } from './_util';

test('dax: tables, columns, measures, and functions', () => {
  expect(
    tokenKinds(
      'dax',
      "Total := SUMX ( 'Sales Data', Sales[Qty] * [Unit Price] )"
    )
  ).toEqual([
    ['Total', 'variable'],
    [':=', 'operator'],
    ['SUMX', 'function'],
    ['(', 'punctuation.bracket'],
    ["'Sales Data'", 'type'],
    [',', 'punctuation.delimiter'],
    ['Sales', 'type'],
    ['[Qty]', 'property'],
    ['*', 'operator'],
    ['[Unit Price]', 'property'],
    [')', 'punctuation.bracket'],
  ]);
  // escaped quotes and brackets stay inside their names
  expect(tokenKinds('dax', "'It''s'[A]]B] + PERCENTILEX.INC(T, 1)")).toEqual([
    ["'It''s'", 'type'],
    ['[A]]B]', 'property'],
    ['+', 'operator'],
    ['PERCENTILEX.INC', 'function'],
    ['(', 'punctuation.bracket'],
    ['T', 'variable'],
    [',', 'punctuation.delimiter'],
    ['1', 'number'],
    [')', 'punctuation.bracket'],
  ]);
  const tokens = tokenKinds('dax', samples.dax.code);
  for (const [text, kind] of [
    ['DEFINE', 'keyword.declaration'],
    ['MEASURE', 'keyword.declaration'],
    ['CALCULATE', 'function'],
    ['RETURN', 'keyword.control'],
    ['NOT', 'keyword.operator'],
    ['EVALUATE', 'keyword'],
    ['TRUE', 'boolean'],
  ]) {
    expect(tokens).toContainEqual([text, kind]);
  }
});

test('dax: case-insensitive keywords, strings, and comments', () => {
  expect(
    tokenKinds('dax', 'var x = "a ""b""" -- note\nreturn x in {1} // end')
  ).toEqual([
    ['var', 'keyword.declaration'],
    ['x', 'variable'],
    ['=', 'operator'],
    ['"a ""b"""', 'string'],
    ['-- note', 'comment'],
    ['return', 'keyword.control'],
    ['x', 'variable'],
    ['in', 'keyword.operator'],
    ['{', 'punctuation.bracket'],
    ['1', 'number'],
    ['}', 'punctuation.bracket'],
    ['// end', 'comment'],
  ]);
  // an operator run stops before a comment
  expect(tokenKinds('dax', 'a =-- c\nb')).toEqual([
    ['a', 'variable'],
    ['=', 'operator'],
    ['-- c', 'comment'],
    ['b', 'variable'],
  ]);
  for (const code of ['x = "one\ntwo" & y\n', '/* a\nb */ EVALUATE T\n']) {
    assertLineFedParity('dax', code);
  }
});
