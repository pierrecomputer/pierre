import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('smithy: control statements, namespaces, and shape ids', () => {
  expect(
    tokenKinds(
      'smithy',
      '$version: "2"\nnamespace com.example\nuse smithy.api#String'
    )
  ).toEqual([
    ['$version', 'preproc'],
    [':', 'punctuation.delimiter'],
    ['"2"', 'string'],
    ['namespace', 'keyword.declaration'],
    ['com.example', 'namespace'],
    ['use', 'keyword.import'],
    ['smithy.api', 'namespace'],
    ['#', 'punctuation.delimiter'],
    ['String', 'type'],
  ]);
});

test('smithy: shapes, members, traits, and node values', () => {
  expect(
    tokenKinds(
      'smithy',
      '@http(method: "GET", code: 200)\n@smithy.api#readonly\noperation GetCity {\n  input := for City {\n    $cityId\n    name: smithy.api#String = null\n  }\n}'
    )
  ).toEqual([
    ['@http', 'attribute'],
    ['(', 'punctuation.bracket'],
    ['method', 'variable.parameter'],
    [':', 'punctuation.delimiter'],
    ['"GET"', 'string'],
    [',', 'punctuation.delimiter'],
    ['code', 'variable.parameter'],
    [':', 'punctuation.delimiter'],
    ['200', 'number'],
    [')', 'punctuation.bracket'],
    ['@smithy.api#readonly', 'attribute'],
    ['operation', 'keyword.declaration'],
    ['GetCity', 'type'],
    ['{', 'punctuation.bracket'],
    ['input', 'property'],
    [':=', 'operator'],
    ['for', 'keyword'],
    ['City', 'type'],
    ['{', 'punctuation.bracket'],
    ['$cityId', 'property'],
    ['name', 'property'],
    [':', 'punctuation.delimiter'],
    ['smithy.api', 'namespace'],
    ['#', 'punctuation.delimiter'],
    ['String', 'type'],
    ['=', 'operator'],
    ['null', 'constant.builtin'],
    ['}', 'punctuation.bracket'],
    ['}', 'punctuation.bracket'],
  ]);
  expect(
    tokenKinds('smithy', 'enum Suit {\n  DIAMOND = "d"\n  Club\n}\nstring Id')
  ).toEqual([
    ['enum', 'keyword.declaration'],
    ['Suit', 'type'],
    ['{', 'punctuation.bracket'],
    ['DIAMOND', 'constant'],
    ['=', 'operator'],
    ['"d"', 'string'],
    ['Club', 'constant'],
    ['}', 'punctuation.bracket'],
    ['string', 'keyword.declaration'],
    ['Id', 'type'],
  ]);
});

test('smithy: doc comments, escapes, and text blocks', () => {
  const code =
    '/// Docs\n// note\n@doc("a \\"b\\"")\n@documentation("""\n  The "name".\n  """)\n';
  expect(tokenKinds('smithy', code)).toEqual([
    ['/// Docs', 'comment.doc'],
    ['// note', 'comment'],
    ['@doc', 'attribute'],
    ['(', 'punctuation.bracket'],
    ['"a', 'string'],
    ['\\"', 'string.escape'],
    ['b', 'string'],
    ['\\"', 'string.escape'],
    ['"', 'string'],
    [')', 'punctuation.bracket'],
    ['@documentation', 'attribute'],
    ['(', 'punctuation.bracket'],
    ['"""', 'string'],
    ['The "name".', 'string'],
    ['"""', 'string'],
    [')', 'punctuation.bracket'],
  ]);
  assertLineFedParity('smithy', code);
  // Smithy has no block comments
  expect(tokenKinds('smithy', 'a /* b')).toEqual([
    ['a', 'variable'],
    ['/*', 'operator'],
    ['b', 'variable'],
  ]);
});
