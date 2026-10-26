import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('awk: a slash divides after an operand and opens a regex elsewhere', () => {
  expect(tokenKinds('awk', 'a = b / c / d')).toEqual([
    ['a', 'variable'],
    ['=', 'operator'],
    ['b', 'variable'],
    ['/', 'operator'],
    ['c', 'variable'],
    ['/', 'operator'],
    ['d', 'variable'],
  ]);
  // a slash inside a bracket expression or after a backslash stays inside
  expect(tokenKinds('awk', 'x ~ /a\\/b[/]c/ && !/skip/')).toEqual([
    ['x', 'variable'],
    ['~', 'operator'],
    ['/a\\/b[/]c/', 'string.regex'],
    ['&& !', 'operator'],
    ['/skip/', 'string.regex'],
  ]);
  // `++` ends an operand; a line break starts a new pattern
  expect(tokenKinds('awk', 'n++ / 2\n/^#/ { next }')).toEqual([
    ['n', 'variable'],
    ['++ /', 'operator'],
    ['2', 'number'],
    ['/^#/', 'string.regex'],
    ['{', 'punctuation.bracket'],
    ['next', 'keyword.control'],
    ['}', 'punctuation.bracket'],
  ]);
});

test('awk: patterns, fields, built-in variables, and keywords', () => {
  expect(
    tokenKinds(
      'awk',
      'BEGIN { FS = ":" }\n$1 > NR { print $NF, length; $(i) = 0 }'
    )
  ).toEqual([
    ['BEGIN', 'keyword'],
    ['{', 'punctuation.bracket'],
    ['FS', 'variable.special'],
    ['=', 'operator'],
    ['":"', 'string'],
    ['}', 'punctuation.bracket'],
    ['$1', 'variable.special'],
    ['>', 'operator'],
    ['NR', 'variable.special'],
    ['{', 'punctuation.bracket'],
    ['print', 'keyword'],
    ['$NF', 'variable.special'],
    [',', 'punctuation.delimiter'],
    ['length', 'function'],
    [';', 'punctuation.delimiter'],
    ['$', 'operator'],
    ['(', 'punctuation.bracket'],
    ['i', 'variable'],
    [')', 'punctuation.bracket'],
    ['=', 'operator'],
    ['0', 'number'],
    ['}', 'punctuation.bracket'],
  ]);
  expect(tokenKinds('awk', 'for (k in seen) delete seen[k] # done')).toEqual([
    ['for', 'keyword.control'],
    ['(', 'punctuation.bracket'],
    ['k', 'variable'],
    ['in', 'keyword.operator'],
    ['seen', 'variable'],
    [')', 'punctuation.bracket'],
    ['delete', 'keyword'],
    ['seen', 'variable'],
    ['[', 'punctuation.bracket'],
    ['k', 'variable'],
    [']', 'punctuation.bracket'],
    ['# done', 'comment'],
  ]);
  expect(tokenKinds('awk', '@include "lib.awk"')).toEqual([
    ['@include', 'preproc'],
    ['"lib.awk"', 'string'],
  ]);
});

test('awk: function definitions, parameters, and calls', () => {
  expect(
    tokenKinds('awk', 'function add(a, b,  tmp) { tmp = a; return add2(tmp) }')
  ).toEqual([
    ['function', 'keyword.declaration'],
    ['add', 'function.definition'],
    ['(', 'punctuation.bracket'],
    ['a', 'variable.parameter'],
    [',', 'punctuation.delimiter'],
    ['b', 'variable.parameter'],
    [',', 'punctuation.delimiter'],
    ['tmp', 'variable.parameter'],
    [') {', 'punctuation.bracket'],
    ['tmp', 'variable'],
    ['=', 'operator'],
    ['a', 'variable'],
    [';', 'punctuation.delimiter'],
    ['return', 'keyword.control'],
    ['add2', 'function'],
    ['(', 'punctuation.bracket'],
    ['tmp', 'variable'],
    [') }', 'punctuation.bracket'],
  ]);
});

test('awk: string escapes and backslash-continued strings stream by line', () => {
  const code = 'msg = "a\\tb \\\nnext" / 2\n/re/\n';
  expect(tokenKinds('awk', code)).toEqual([
    ['msg', 'variable'],
    ['=', 'operator'],
    ['"a', 'string'],
    ['\\t', 'string.escape'],
    ['b', 'string'],
    ['\\', 'string.escape'],
    ['next"', 'string'],
    ['/', 'operator'],
    ['2', 'number'],
    ['/re/', 'string.regex'],
  ]);
  assertLineFedParity('awk', code);
});
