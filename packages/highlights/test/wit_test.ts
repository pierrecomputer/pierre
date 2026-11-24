import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('wit: package paths, versions, and use lists', () => {
  expect(tokenKinds('wit', 'package wasi:http@0.2.0;')).toEqual([
    ['package', 'keyword.declaration'],
    ['wasi', 'namespace'],
    [':', 'punctuation.delimiter'],
    ['http', 'namespace'],
    ['@', 'punctuation.delimiter'],
    ['0.2.0', 'number'],
    [';', 'punctuation.delimiter'],
  ]);
  expect(
    tokenKinds(
      'wit',
      'use wasi:io/streams@0.2.0.{input-stream, output-stream as os};'
    )
  ).toEqual([
    ['use', 'keyword.import'],
    ['wasi', 'namespace'],
    [':', 'punctuation.delimiter'],
    ['io', 'namespace'],
    ['/', 'operator'],
    ['streams', 'namespace'],
    ['@', 'punctuation.delimiter'],
    ['0.2.0', 'number'],
    ['.', 'punctuation.delimiter'],
    ['{', 'punctuation.bracket'],
    ['input-stream', 'type'],
    [',', 'punctuation.delimiter'],
    ['output-stream', 'type'],
    ['as', 'keyword'],
    ['os', 'type'],
    ['}', 'punctuation.bracket'],
    [';', 'punctuation.delimiter'],
  ]);
});

test('wit: records, generic types, and kebab-case names', () => {
  expect(
    tokenKinds(
      'wit',
      'record req {\n  headers: list<tuple<string, u8>>,\n  body: my-body,\n}'
    )
  ).toEqual([
    ['record', 'keyword.declaration'],
    ['req', 'type'],
    ['{', 'punctuation.bracket'],
    ['headers', 'property'],
    [':', 'punctuation.delimiter'],
    ['list', 'type.builtin'],
    ['<', 'punctuation.bracket'],
    ['tuple', 'type.builtin'],
    ['<', 'punctuation.bracket'],
    ['string', 'type.builtin'],
    [',', 'punctuation.delimiter'],
    ['u8', 'type.builtin'],
    ['>>', 'punctuation.bracket'],
    [',', 'punctuation.delimiter'],
    ['body', 'property'],
    [':', 'punctuation.delimiter'],
    ['my-body', 'type'],
    [',', 'punctuation.delimiter'],
    ['}', 'punctuation.bracket'],
  ]);
  // a trailing `-` is not part of a name: `x->y`
  expect(tokenKinds('wit', 'type t = func()->s64;')).toEqual([
    ['type', 'keyword.declaration'],
    ['t', 'type'],
    ['=', 'operator'],
    ['func', 'keyword.declaration'],
    ['()', 'punctuation.bracket'],
    ['->', 'operator'],
    ['s64', 'type.builtin'],
    [';', 'punctuation.delimiter'],
  ]);
});

test('wit: cases, functions, resources, gates, and escaped names', () => {
  expect(
    tokenKinds(
      'wit',
      'variant err { timeout(u64), other(my-type), closed }\nenum m { get, %type }'
    )
  ).toEqual([
    ['variant', 'keyword.declaration'],
    ['err', 'type'],
    ['{', 'punctuation.bracket'],
    ['timeout', 'constant'],
    ['(', 'punctuation.bracket'],
    ['u64', 'type.builtin'],
    [')', 'punctuation.bracket'],
    [',', 'punctuation.delimiter'],
    ['other', 'constant'],
    ['(', 'punctuation.bracket'],
    ['my-type', 'type'],
    [')', 'punctuation.bracket'],
    [',', 'punctuation.delimiter'],
    ['closed', 'constant'],
    ['}', 'punctuation.bracket'],
    ['enum', 'keyword.declaration'],
    ['m', 'type'],
    ['{', 'punctuation.bracket'],
    ['get', 'constant'],
    [',', 'punctuation.delimiter'],
    ['%type', 'constant'],
    ['}', 'punctuation.bracket'],
  ]);
  expect(
    tokenKinds(
      'wit',
      '@since(version = 0.2.0)\nread: func(len: u64) -> result<_, e>;\nopen: static func();'
    )
  ).toEqual([
    ['@since', 'attribute'],
    ['(', 'punctuation.bracket'],
    ['version', 'variable'],
    ['=', 'operator'],
    ['0.2.0', 'number'],
    [')', 'punctuation.bracket'],
    ['read', 'function.definition'],
    [':', 'punctuation.delimiter'],
    ['func', 'keyword.declaration'],
    ['(', 'punctuation.bracket'],
    ['len', 'variable.parameter'],
    [':', 'punctuation.delimiter'],
    ['u64', 'type.builtin'],
    [')', 'punctuation.bracket'],
    ['->', 'operator'],
    ['result', 'type.builtin'],
    ['<', 'punctuation.bracket'],
    ['_', 'type'],
    [',', 'punctuation.delimiter'],
    ['e', 'type'],
    ['>', 'punctuation.bracket'],
    [';', 'punctuation.delimiter'],
    ['open', 'function.definition'],
    [':', 'punctuation.delimiter'],
    ['static', 'keyword'],
    ['func', 'keyword.declaration'],
    ['()', 'punctuation.bracket'],
    [';', 'punctuation.delimiter'],
  ]);
});

test('wit: doc, line, and block comments', () => {
  const code = '/// docs\n// note\n/* one\n   two */ world w {}\n';
  expect(tokenKinds('wit', code)).toEqual([
    ['/// docs', 'comment.doc'],
    ['// note', 'comment'],
    ['/* one', 'comment'],
    ['two */', 'comment'],
    ['world', 'keyword.declaration'],
    ['w', 'type'],
    ['{}', 'punctuation.bracket'],
  ]);
  assertLineFedParity('wit', code);
});
