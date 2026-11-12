import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('kusto: tabular operators after pipes, string operators, and joins', () => {
  expect(
    tokenKinds(
      'kusto',
      'T\n| where a has "x" and b !has_cs \'y\' and c in~ (1, 2)\n| join kind = leftouter (U) on Id'
    )
  ).toEqual([
    ['T', 'variable'],
    ['|', 'operator'],
    ['where', 'keyword'],
    ['a', 'variable'],
    ['has', 'keyword.operator'],
    ['"x"', 'string'],
    ['and', 'keyword.operator'],
    ['b', 'variable'],
    ['!has_cs', 'keyword.operator'],
    ["'y'", 'string'],
    ['and', 'keyword.operator'],
    ['c', 'variable'],
    ['in~', 'keyword.operator'],
    ['(', 'punctuation.bracket'],
    ['1', 'number'],
    [',', 'punctuation.delimiter'],
    ['2', 'number'],
    [')', 'punctuation.bracket'],
    ['|', 'operator'],
    ['join kind', 'keyword'],
    ['=', 'operator'],
    ['leftouter', 'keyword'],
    ['(', 'punctuation.bracket'],
    ['U', 'variable'],
    [')', 'punctuation.bracket'],
    ['on', 'keyword'],
    ['Id', 'variable'],
  ]);
  expect(
    tokenKinds(
      'kusto',
      'T | mv-expand x | project-away y | order by z asc nulls first | summarize count() by bin(t, 5m)'
    )
  ).toEqual([
    ['T', 'variable'],
    ['|', 'operator'],
    ['mv-expand', 'keyword'],
    ['x', 'variable'],
    ['|', 'operator'],
    ['project-away', 'keyword'],
    ['y', 'variable'],
    ['|', 'operator'],
    ['order by', 'keyword'],
    ['z', 'variable'],
    ['asc nulls first', 'keyword'],
    ['|', 'operator'],
    ['summarize', 'keyword'],
    ['count', 'function'],
    ['()', 'punctuation.bracket'],
    ['by', 'keyword'],
    ['bin', 'function'],
    ['(', 'punctuation.bracket'],
    ['t', 'variable'],
    [',', 'punctuation.delimiter'],
    ['5m', 'number'],
    [')', 'punctuation.bracket'],
  ]);
});

test('kusto: let, assignments, calls, and negation', () => {
  expect(
    tokenKinds(
      'kusto',
      '// note\nlet limit = 10;\nEvents | where !isempty(Name) and Name != "a\\tb" and Note_cs == \'x\''
    )
  ).toEqual([
    ['// note', 'comment'],
    ['let', 'keyword.declaration'],
    ['limit', 'variable'],
    ['=', 'operator'],
    ['10', 'number'],
    [';', 'punctuation.delimiter'],
    ['Events', 'variable'],
    ['|', 'operator'],
    ['where', 'keyword'],
    ['!', 'operator'],
    ['isempty', 'function'],
    ['(', 'punctuation.bracket'],
    ['Name', 'variable'],
    [')', 'punctuation.bracket'],
    ['and', 'keyword.operator'],
    ['Name', 'variable'],
    ['!=', 'operator'],
    ['"a', 'string'],
    ['\\t', 'string.escape'],
    ['b"', 'string'],
    ['and', 'keyword.operator'],
    ['Note_cs', 'variable'],
    ['==', 'operator'],
    ["'x'", 'string'],
  ]);
  expect(
    tokenKinds('kusto', 'T | extend total = a + b | where x == 1 and y =~ "Z"')
  ).toEqual([
    ['T', 'variable'],
    ['|', 'operator'],
    ['extend', 'keyword'],
    ['total', 'property'],
    ['=', 'operator'],
    ['a', 'variable'],
    ['+', 'operator'],
    ['b', 'variable'],
    ['|', 'operator'],
    ['where', 'keyword'],
    ['x', 'variable'],
    ['==', 'operator'],
    ['1', 'number'],
    ['and', 'keyword.operator'],
    ['y', 'variable'],
    ['=~', 'operator'],
    ['"Z"', 'string'],
  ]);
});

test('kusto: literal types, timespans, and management commands', () => {
  expect(
    tokenKinds(
      'kusto',
      '.create-or-alter function F() { T | take 5 }\nprint t = datetime(2024-01-01 10:30), s = timespan(1.02:03:04), n = 1.5e3, d = 30m, b = true, j = dynamic({"a": [1]})'
    )
  ).toEqual([
    ['.create-or-alter', 'keyword'],
    ['function', 'variable'],
    ['F', 'function'],
    ['() {', 'punctuation.bracket'],
    ['T', 'variable'],
    ['|', 'operator'],
    ['take', 'keyword'],
    ['5', 'number'],
    ['}', 'punctuation.bracket'],
    ['print', 'keyword'],
    ['t', 'property'],
    ['=', 'operator'],
    ['datetime', 'type.builtin'],
    ['(', 'punctuation.bracket'],
    ['2024-01-01 10:30', 'number'],
    [')', 'punctuation.bracket'],
    [',', 'punctuation.delimiter'],
    ['s', 'property'],
    ['=', 'operator'],
    ['timespan', 'type.builtin'],
    ['(', 'punctuation.bracket'],
    ['1.02:03:04', 'number'],
    [')', 'punctuation.bracket'],
    [',', 'punctuation.delimiter'],
    ['n', 'property'],
    ['=', 'operator'],
    ['1.5e3', 'number'],
    [',', 'punctuation.delimiter'],
    ['d', 'property'],
    ['=', 'operator'],
    ['30m', 'number'],
    [',', 'punctuation.delimiter'],
    ['b', 'property'],
    ['=', 'operator'],
    ['true', 'boolean'],
    [',', 'punctuation.delimiter'],
    ['j', 'property'],
    ['=', 'operator'],
    ['dynamic', 'type.builtin'],
    ['({', 'punctuation.bracket'],
    ['"a"', 'string'],
    [':', 'punctuation.delimiter'],
    ['[', 'punctuation.bracket'],
    ['1', 'number'],
    [']})', 'punctuation.bracket'],
  ]);
});

test('kusto: verbatim, obfuscated, and multi-line strings', () => {
  expect(
    tokenKinds('kusto', 'print a = @"C:\\path", b = h\'secret\', c = H@"raw"')
  ).toEqual([
    ['print', 'keyword'],
    ['a', 'property'],
    ['=', 'operator'],
    ['@"C:\\path"', 'string'],
    [',', 'punctuation.delimiter'],
    ['b', 'property'],
    ['=', 'operator'],
    ["h'secret'", 'string'],
    [',', 'punctuation.delimiter'],
    ['c', 'property'],
    ['=', 'operator'],
    ['H@"raw"', 'string'],
  ]);
  assertLineFedParity(
    'kusto',
    'print a = @"C:\\path", b = h\'secret\', c = H@"raw"'
  );
  expect(
    tokenKinds('kusto', 'let q = ```one\ntwo λ😀 <&>```;\nT | take 1')
  ).toEqual([
    ['let', 'keyword.declaration'],
    ['q', 'variable'],
    ['=', 'operator'],
    ['```one', 'string'],
    ['two λ😀 <&>```', 'string'],
    [';', 'punctuation.delimiter'],
    ['T', 'variable'],
    ['|', 'operator'],
    ['take', 'keyword'],
    ['1', 'number'],
  ]);
  assertLineFedParity('kusto', 'let q = ```one\ntwo λ😀 <&>```;\nT | take 1');
  expect(
    tokenKinds('kusto', 'let q = ```open\n// still text\n| where x')
  ).toEqual([
    ['let', 'keyword.declaration'],
    ['q', 'variable'],
    ['=', 'operator'],
    ['```open', 'string'],
    ['// still text', 'string'],
    ['| where x', 'string'],
  ]);
  assertLineFedParity('kusto', 'let q = ```open\n// still text\n| where x');
});

test('kusto: $left and $right in join conditions', () => {
  expect(tokenKinds('kusto', 'A | join (B) on $left.Id == $right.Id')).toEqual([
    ['A', 'variable'],
    ['|', 'operator'],
    ['join', 'keyword'],
    ['(', 'punctuation.bracket'],
    ['B', 'variable'],
    [')', 'punctuation.bracket'],
    ['on', 'keyword'],
    ['$left', 'variable.special'],
    ['.', 'punctuation.delimiter'],
    ['Id', 'variable'],
    ['==', 'operator'],
    ['$right', 'variable.special'],
    ['.', 'punctuation.delimiter'],
    ['Id', 'variable'],
  ]);
});
