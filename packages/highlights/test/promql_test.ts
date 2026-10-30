import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('promql: selectors, matchers, and regex strings', () => {
  expect(
    tokenKinds(
      'promql',
      'http_requests_total{job="api", code=~"5..", path!~`/health`, env!="dev"}'
    )
  ).toEqual([
    ['http_requests_total', 'variable'],
    ['{', 'punctuation.bracket'],
    ['job', 'property'],
    ['=', 'operator'],
    ['"api"', 'string'],
    [',', 'punctuation.delimiter'],
    ['code', 'property'],
    ['=~', 'operator'],
    ['"5.."', 'string.regex'],
    [',', 'punctuation.delimiter'],
    ['path', 'property'],
    ['!~', 'operator'],
    ['`/health`', 'string.regex'],
    [',', 'punctuation.delimiter'],
    ['env', 'property'],
    ['!=', 'operator'],
    ['"dev"', 'string'],
    ['}', 'punctuation.bracket'],
  ]);
  // recording rule names keep their colons; matcher labels named like
  // keywords stay labels
  expect(tokenKinds('promql', 'job:errors:rate5m{on="a", by="b"}')).toEqual([
    ['job:errors:rate5m', 'variable'],
    ['{', 'punctuation.bracket'],
    ['on', 'property'],
    ['=', 'operator'],
    ['"a"', 'string'],
    [',', 'punctuation.delimiter'],
    ['by', 'property'],
    ['=', 'operator'],
    ['"b"', 'string'],
    ['}', 'punctuation.bracket'],
  ]);
  // a name may start with `:` except where it separates a subquery step
  expect(
    tokenKinds(
      'promql',
      'max(:node_memory_MemAvailable_bytes:sum{a="b"}[1h:]) by (c)'
    )
  ).toEqual([
    ['max', 'keyword'],
    ['(', 'punctuation.bracket'],
    [':node_memory_MemAvailable_bytes:sum', 'variable'],
    ['{', 'punctuation.bracket'],
    ['a', 'property'],
    ['=', 'operator'],
    ['"b"', 'string'],
    ['}[', 'punctuation.bracket'],
    ['1h', 'number'],
    [':', 'punctuation.delimiter'],
    ['])', 'punctuation.bracket'],
    ['by', 'keyword'],
    ['(', 'punctuation.bracket'],
    ['c', 'property'],
    [')', 'punctuation.bracket'],
  ]);
  expect(tokenKinds('promql', 'x{a="tab\\t\\"q\\""}')).toEqual([
    ['x', 'variable'],
    ['{', 'punctuation.bracket'],
    ['a', 'property'],
    ['=', 'operator'],
    ['"tab', 'string'],
    ['\\t\\"', 'string.escape'],
    ['q', 'string'],
    ['\\"', 'string.escape'],
    ['"', 'string'],
    ['}', 'punctuation.bracket'],
  ]);
});

test('promql: aggregations, label lists, and vector matching', () => {
  expect(
    tokenKinds(
      'promql',
      'sum by (job, group) (rate(x[5m])) / ignoring(code) group_left(team) up'
    )
  ).toEqual([
    ['sum by', 'keyword'],
    ['(', 'punctuation.bracket'],
    ['job', 'property'],
    [',', 'punctuation.delimiter'],
    ['group', 'property'],
    [') (', 'punctuation.bracket'],
    ['rate', 'function'],
    ['(', 'punctuation.bracket'],
    ['x', 'variable'],
    ['[', 'punctuation.bracket'],
    ['5m', 'number'],
    [']))', 'punctuation.bracket'],
    ['/', 'operator'],
    ['ignoring', 'keyword'],
    ['(', 'punctuation.bracket'],
    ['code', 'property'],
    [')', 'punctuation.bracket'],
    ['group_left', 'keyword'],
    ['(', 'punctuation.bracket'],
    ['team', 'property'],
    [')', 'punctuation.bracket'],
    ['up', 'variable'],
  ]);
  // a trailing grouping clause, case-insensitive keywords, and set operators
  expect(
    tokenKinds(
      'promql',
      'TOPK(3, x) WITHOUT (pod) > BOOL 1 AND on() y unless z'
    )
  ).toEqual([
    ['TOPK', 'keyword'],
    ['(', 'punctuation.bracket'],
    ['3', 'number'],
    [',', 'punctuation.delimiter'],
    ['x', 'variable'],
    [')', 'punctuation.bracket'],
    ['WITHOUT', 'keyword'],
    ['(', 'punctuation.bracket'],
    ['pod', 'property'],
    [')', 'punctuation.bracket'],
    ['>', 'operator'],
    ['BOOL', 'keyword'],
    ['1', 'number'],
    ['AND', 'keyword.operator'],
    ['on', 'keyword'],
    ['()', 'punctuation.bracket'],
    ['y', 'variable'],
    ['unless', 'keyword.operator'],
    ['z', 'variable'],
  ]);
  // only the parenthesis right after a grouping word opens a label list
  expect(tokenKinds('promql', 'sum(x) by # note\n(job) + count((y))')).toEqual([
    ['sum', 'keyword'],
    ['(', 'punctuation.bracket'],
    ['x', 'variable'],
    [')', 'punctuation.bracket'],
    ['by', 'keyword'],
    ['# note', 'comment'],
    ['(', 'punctuation.bracket'],
    ['job', 'property'],
    [')', 'punctuation.bracket'],
    ['+', 'operator'],
    ['count', 'keyword'],
    ['((', 'punctuation.bracket'],
    ['y', 'variable'],
    ['))', 'punctuation.bracket'],
  ]);
});

test('promql: durations, subqueries, modifiers, and numbers', () => {
  expect(
    tokenKinds(
      'promql',
      'max_over_time(x[1h30m:1m] offset -5m @ end()) > -Inf * 1.5e-3 + 0x1F % NaN ^ .5'
    )
  ).toEqual([
    ['max_over_time', 'function'],
    ['(', 'punctuation.bracket'],
    ['x', 'variable'],
    ['[', 'punctuation.bracket'],
    ['1h30m', 'number'],
    [':', 'punctuation.delimiter'],
    ['1m', 'number'],
    [']', 'punctuation.bracket'],
    ['offset', 'keyword'],
    ['-', 'operator'],
    ['5m', 'number'],
    ['@', 'operator'],
    ['end', 'function'],
    ['())', 'punctuation.bracket'],
    ['> -', 'operator'],
    ['Inf', 'number'],
    ['*', 'operator'],
    ['1.5e-3', 'number'],
    ['+', 'operator'],
    ['0x1F', 'number'],
    ['%', 'operator'],
    ['NaN', 'number'],
    ['^', 'operator'],
    ['.5', 'number'],
  ]);
  // keywords name metrics before a selector or range
  expect(tokenKinds('promql', 'count{a="b"} + offset[5m] == sum')).toEqual([
    ['count', 'variable'],
    ['{', 'punctuation.bracket'],
    ['a', 'property'],
    ['=', 'operator'],
    ['"b"', 'string'],
    ['}', 'punctuation.bracket'],
    ['+', 'operator'],
    ['offset', 'variable'],
    ['[', 'punctuation.bracket'],
    ['5m', 'number'],
    [']', 'punctuation.bracket'],
    ['==', 'operator'],
    ['sum', 'keyword'],
  ]);
});

test('promql: Grafana template variables and comments', () => {
  expect(
    tokenKinds(
      'promql',
      'rate(x{job=~"$job"}[$__rate_interval]) > ${threshold:raw} # alert'
    )
  ).toEqual([
    ['rate', 'function'],
    ['(', 'punctuation.bracket'],
    ['x', 'variable'],
    ['{', 'punctuation.bracket'],
    ['job', 'property'],
    ['=~', 'operator'],
    ['"$job"', 'string.regex'],
    ['}[', 'punctuation.bracket'],
    ['$__rate_interval', 'variable.special'],
    ['])', 'punctuation.bracket'],
    ['>', 'operator'],
    ['${threshold:raw}', 'variable.special'],
    ['# alert', 'comment'],
  ]);
});

test('promql: multiline constructs stream like the whole buffer', () => {
  expect(tokenKinds('promql', 'x{a=~`one\ntwo`}')).toEqual([
    ['x', 'variable'],
    ['{', 'punctuation.bracket'],
    ['a', 'property'],
    ['=~', 'operator'],
    ['`one', 'string.regex'],
    ['two`', 'string.regex'],
    ['}', 'punctuation.bracket'],
  ]);
  for (const code of [
    'x{a=~`one\ntwo`, b="c"}\n',
    'sum by (\n  job,\n  instance\n) (up)\n',
    'x{\n  a="b",\n  c!="d"\n}\n',
    'x{a="unterminated\nb="c"}\n',
    'x[1h\n:5m] / :a:b\n',
  ]) {
    assertLineFedParity('promql', code);
  }
});
