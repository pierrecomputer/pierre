import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('bicep: declarations name their symbol, type, and resource type', () => {
  expect(
    tokenKinds(
      'bicep',
      "param location string = resourceGroup().location\nresource stg 'Microsoft.Storage/x@2023-01-01' existing = {\n  name: 'a'\n}"
    )
  ).toEqual([
    ['param', 'keyword.declaration'],
    ['location', 'variable'],
    ['string', 'type.builtin'],
    ['=', 'operator'],
    ['resourceGroup', 'function'],
    ['()', 'punctuation.bracket'],
    ['.', 'punctuation.delimiter'],
    ['location', 'property'],
    ['resource', 'keyword.declaration'],
    ['stg', 'variable'],
    ["'Microsoft.Storage/x@2023-01-01'", 'string.special'],
    ['existing', 'keyword'],
    ['=', 'operator'],
    ['{', 'punctuation.bracket'],
    ['name', 'property'],
    [':', 'punctuation.delimiter'],
    ["'a'", 'string'],
    ['}', 'punctuation.bracket'],
  ]);
  const tokens = tokenKinds(
    'bicep',
    "func f(a int) string => 'x'\ntype pair = { a: int }\n@sys.description('d')\noutput o object = {}"
  );
  for (const [text, kind] of [
    ['f', 'function.definition'],
    ['pair', 'type'],
    ['@sys.description', 'attribute'],
    ['object', 'type.builtin'],
  ]) {
    expect(tokens).toContainEqual([text, kind]);
  }
});

test('bicep: interpolation, escapes, and nested strings', () => {
  expect(tokenKinds('bicep', "var s = 'a${b ? 'c' : d}\\'e'")).toEqual([
    ['var', 'keyword.declaration'],
    ['s', 'variable'],
    ['=', 'operator'],
    ["'a", 'string'],
    ['${', 'punctuation.special'],
    ['b', 'variable'],
    ['?', 'operator'],
    ["'c'", 'string'],
    [':', 'punctuation.delimiter'],
    ['d', 'variable'],
    ['}', 'punctuation.special'],
    ["\\'", 'string.escape'],
    ["e'", 'string'],
  ]);
  // a quote left open ends with its line
  expect(tokenKinds('bicep', "var s = 'open\nvar t = 1")).toEqual([
    ['var', 'keyword.declaration'],
    ['s', 'variable'],
    ['=', 'operator'],
    ["'open", 'string'],
    ['var', 'keyword.declaration'],
    ['t', 'variable'],
    ['=', 'operator'],
    ['1', 'number'],
  ]);
});

test('bicep: object keys, keywords as keys, and safe access', () => {
  const tokens = tokenKinds(
    'bicep',
    "var o = { type: 'x', if: true }\nvar s = stg.?properties ?? null"
  );
  for (const [text, kind] of [
    ['type', 'property'],
    ['if', 'property'],
    ['true', 'boolean'],
    ['.?', 'operator'],
    ['properties', 'property'],
    ['??', 'operator'],
    ['null', 'constant.builtin'],
  ]) {
    expect(tokens).toContainEqual([text, kind]);
  }
});

test('bicep: multi-line strings, comments, and directives span lines', () => {
  const code =
    "var m = '''\nline ${x}\n'''\n/* a\nb */\n#disable-next-line rule\nvar y = [for i in range(0, 2): i]\n";
  expect(tokenKinds('bicep', code)).toEqual([
    ['var', 'keyword.declaration'],
    ['m', 'variable'],
    ['=', 'operator'],
    ["'''", 'string'],
    ['line ${x}', 'string'],
    ["'''", 'string'],
    ['/* a', 'comment'],
    ['b */', 'comment'],
    ['#disable-next-line rule', 'preproc'],
    ['var', 'keyword.declaration'],
    ['y', 'variable'],
    ['=', 'operator'],
    ['[', 'punctuation.bracket'],
    ['for', 'keyword.control'],
    ['i', 'variable'],
    ['in', 'keyword.control'],
    ['range', 'function'],
    ['(', 'punctuation.bracket'],
    ['0', 'number'],
    [',', 'punctuation.delimiter'],
    ['2', 'number'],
    [')', 'punctuation.bracket'],
    [':', 'punctuation.delimiter'],
    ['i', 'variable'],
    [']', 'punctuation.bracket'],
  ]);
  assertLineFedParity('bicep', code);
  assertLineFedParity('bicep', "var s = '${concat(\n  'a')}'\nvar t = 1\n");
});
