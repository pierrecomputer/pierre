import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('splunk: search terms, fields, and time modifiers', () => {
  expect(
    tokenKinds(
      'splunk',
      'index=web sourcetype="access" status>=500 earliest=-7d@d latest=@h host=web*'
    )
  ).toEqual([
    ['index', 'property'],
    ['=', 'operator'],
    ['web', 'variable'],
    ['sourcetype', 'property'],
    ['=', 'operator'],
    ['"access"', 'string'],
    ['status', 'variable'],
    ['>=', 'operator'],
    ['500', 'number'],
    ['earliest', 'property'],
    ['=', 'operator'],
    ['-7d@d', 'number'],
    ['latest', 'property'],
    ['=', 'operator'],
    ['@h', 'number'],
    ['host', 'property'],
    ['=', 'operator'],
    ['web', 'variable'],
    ['*', 'operator'],
  ]);
});

test('splunk: commands after pipes and subsearches, case-insensitive words', () => {
  expect(
    tokenKinds(
      'splunk',
      '| eval ms = round(t * 1000, 2), who = \'user name\'\n| where ms > 10 AND NOT status IN (404) OR x LIKE "a%"'
    )
  ).toEqual([
    ['|', 'operator'],
    ['eval', 'keyword'],
    ['ms', 'property'],
    ['=', 'operator'],
    ['round', 'function'],
    ['(', 'punctuation.bracket'],
    ['t', 'variable'],
    ['*', 'operator'],
    ['1000', 'number'],
    [',', 'punctuation.delimiter'],
    ['2', 'number'],
    [')', 'punctuation.bracket'],
    [',', 'punctuation.delimiter'],
    ['who', 'property'],
    ['=', 'operator'],
    ["'user name'", 'variable'],
    ['|', 'operator'],
    ['where', 'keyword'],
    ['ms', 'variable'],
    ['>', 'operator'],
    ['10', 'number'],
    ['AND NOT', 'keyword.operator'],
    ['status', 'variable'],
    ['IN', 'keyword.operator'],
    ['(', 'punctuation.bracket'],
    ['404', 'number'],
    [')', 'punctuation.bracket'],
    ['OR', 'keyword.operator'],
    ['x', 'variable'],
    ['LIKE', 'keyword.operator'],
    ['"a%"', 'string'],
  ]);
  expect(
    tokenKinds(
      'splunk',
      '| tstats count AS n BY host\n| search [ search index=a | fields id ] | `my_macro(1)` | table $tok$ data.user.id'
    )
  ).toEqual([
    ['|', 'operator'],
    ['tstats', 'keyword'],
    ['count', 'function'],
    ['AS', 'keyword'],
    ['n', 'variable'],
    ['BY', 'keyword'],
    ['host', 'variable'],
    ['|', 'operator'],
    ['search', 'keyword'],
    ['[', 'punctuation.bracket'],
    ['search', 'keyword'],
    ['index', 'property'],
    ['=', 'operator'],
    ['a', 'variable'],
    ['|', 'operator'],
    ['fields', 'keyword'],
    ['id', 'variable'],
    [']', 'punctuation.bracket'],
    ['|', 'operator'],
    ['`my_macro(1)`', 'preproc'],
    ['|', 'operator'],
    ['table', 'keyword'],
    ['$tok$', 'variable.special'],
    ['data.user.id', 'variable'],
  ]);
});

test('splunk: triple-backtick comments span lines; `//` is not a comment', () => {
  expect(
    tokenKinds(
      'splunk',
      '```two\nline comment``` | stats count by host // not a comment'
    )
  ).toEqual([
    ['```two', 'comment'],
    ['line comment```', 'comment'],
    ['|', 'operator'],
    ['stats', 'keyword'],
    ['count', 'function'],
    ['by', 'keyword'],
    ['host', 'variable'],
    ['//', 'operator'],
    ['not', 'keyword.operator'],
    ['a comment', 'variable'],
  ]);
  assertLineFedParity(
    'splunk',
    '```two\nline comment``` | stats count by host // not a comment'
  );
  expect(tokenKinds('splunk', '```open λ😀\n| stats count')).toEqual([
    ['```open λ😀', 'comment'],
    ['| stats count', 'comment'],
  ]);
  assertLineFedParity('splunk', '```open λ😀\n| stats count');
});

test('splunk: strings with escapes', () => {
  expect(
    tokenKinds('splunk', '| rex field=_raw "user=(?<u>\\w+) \\"q\\""')
  ).toEqual([
    ['|', 'operator'],
    ['rex', 'keyword'],
    ['field', 'property'],
    ['=', 'operator'],
    ['_raw', 'variable'],
    ['"user=(?<u>', 'string'],
    ['\\w', 'string.escape'],
    ['+)', 'string'],
    ['\\"', 'string.escape'],
    ['q', 'string'],
    ['\\"', 'string.escape'],
    ['"', 'string'],
  ]);
});
