import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('berry: classes, definitions, members, and calls', () => {
  expect(
    tokenKinds(
      'berry',
      'class Led : Driver\n  static count = 0x1F\n  def init(pin)\n    self.pin = pin\n    super(self).init()\n  end\nend'
    )
  ).toEqual([
    ['class', 'keyword.declaration'],
    ['Led', 'type'],
    [':', 'operator'],
    ['Driver', 'type'],
    ['static', 'keyword.declaration'],
    ['count', 'variable'],
    ['=', 'operator'],
    ['0x1F', 'number'],
    ['def', 'keyword.declaration'],
    ['init', 'function.definition'],
    ['(', 'punctuation.bracket'],
    ['pin', 'variable'],
    [')', 'punctuation.bracket'],
    ['self', 'variable.special'],
    ['.', 'punctuation.delimiter'],
    ['pin', 'property'],
    ['=', 'operator'],
    ['pin', 'variable'],
    ['super', 'variable.special'],
    ['(', 'punctuation.bracket'],
    ['self', 'variable.special'],
    [')', 'punctuation.bracket'],
    ['.', 'punctuation.delimiter'],
    ['init', 'function.method'],
    ['()', 'punctuation.bracket'],
    ['end', 'keyword.control'],
    ['end', 'keyword.control'],
  ]);
});

test('berry: keywords, literals, ranges, and imports', () => {
  expect(
    tokenKinds(
      'berry',
      'import json as j\nfor i : 0..3 if i == nil elif true break end end\ntry raise "e" except .. as e, m end'
    )
  ).toEqual([
    ['import', 'keyword.import'],
    ['json', 'variable'],
    ['as', 'keyword'],
    ['j', 'variable'],
    ['for', 'keyword.control'],
    ['i', 'variable'],
    [':', 'operator'],
    ['0', 'number'],
    ['..', 'operator'],
    ['3', 'number'],
    ['if', 'keyword.control'],
    ['i', 'variable'],
    ['==', 'operator'],
    ['nil', 'constant.builtin'],
    ['elif', 'keyword.control'],
    ['true', 'boolean'],
    ['break end end', 'keyword.control'],
    ['try raise', 'keyword.control'],
    ['"e"', 'string'],
    ['except', 'keyword.control'],
    ['..', 'operator'],
    ['as', 'keyword'],
    ['e', 'variable'],
    [',', 'punctuation.delimiter'],
    ['m', 'variable'],
    ['end', 'keyword.control'],
  ]);
});

test('berry: strings, escapes, and f-string fields', () => {
  expect(tokenKinds('berry', `s = "a\\x41\\n" + 'it\\'s'`)).toEqual([
    ['s', 'variable'],
    ['=', 'operator'],
    ['"a', 'string'],
    ['\\x41\\n', 'string.escape'],
    ['"', 'string'],
    ['+', 'operator'],
    ["'it", 'string'],
    ["\\'", 'string.escape'],
    ["s'", 'string'],
  ]);
  expect(tokenKinds('berry', 'f"x={x * 2} {{lit}}"')).toEqual([
    ['f"x=', 'string'],
    ['{', 'punctuation.special'],
    ['x', 'variable'],
    ['*', 'operator'],
    ['2', 'number'],
    ['}', 'punctuation.special'],
    ['{{', 'string.escape'],
    ['lit}}"', 'string'],
  ]);
  // a string ends at its line; a `\` before the break does not continue it
  const code = 'a = "open \\\nb = 1\n';
  expect(tokenKinds('berry', code)).toEqual([
    ['a', 'variable'],
    ['=', 'operator'],
    ['"open', 'string'],
    ['\\', 'string.escape'],
    ['b', 'variable'],
    ['=', 'operator'],
    ['1', 'number'],
  ]);
  assertLineFedParity('berry', code);
});

test('berry: lambdas name their parameters', () => {
  expect(tokenKinds('berry', 'f = / a, b -> a / b')).toEqual([
    ['f', 'variable'],
    ['= /', 'operator'],
    ['a', 'variable.parameter'],
    [',', 'punctuation.delimiter'],
    ['b', 'variable.parameter'],
    ['->', 'operator'],
    ['a', 'variable'],
    ['/', 'operator'],
    ['b', 'variable'],
  ]);
});

test('berry: line and block comments', () => {
  const code = '# line\n#- block\n   still -# x = 1\n#-# not closed\ny -#\n';
  expect(tokenKinds('berry', code)).toEqual([
    ['# line', 'comment'],
    ['#- block', 'comment'],
    ['still -#', 'comment'],
    ['x', 'variable'],
    ['=', 'operator'],
    ['1', 'number'],
    ['#-# not closed', 'comment'],
    ['y -#', 'comment'],
  ]);
  assertLineFedParity('berry', code);
});
