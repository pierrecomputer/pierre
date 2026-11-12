import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('ballerina: imports, types, and closed records', () => {
  expect(
    tokenKinds(
      'ballerina',
      'import ballerina/http;\nimport ballerina/io as console;'
    )
  ).toEqual([
    ['import', 'keyword.import'],
    ['ballerina', 'namespace'],
    ['/', 'operator'],
    ['http', 'namespace'],
    [';', 'punctuation.delimiter'],
    ['import', 'keyword.import'],
    ['ballerina', 'namespace'],
    ['/', 'operator'],
    ['io', 'namespace'],
    ['as', 'keyword.operator'],
    ['console', 'variable'],
    [';', 'punctuation.delimiter'],
  ]);
  assertLineFedParity(
    'ballerina',
    'import ballerina/http;\nimport ballerina/io as console;'
  );
  expect(
    tokenKinds(
      'ballerina',
      'type Person record {|\n    string name;\n    int age = 0;\n|};'
    )
  ).toEqual([
    ['type', 'keyword.declaration'],
    ['Person', 'type'],
    ['record', 'keyword'],
    ['{|', 'punctuation.bracket'],
    ['string', 'type.builtin'],
    ['name', 'variable'],
    [';', 'punctuation.delimiter'],
    ['int', 'type.builtin'],
    ['age', 'variable'],
    ['=', 'operator'],
    ['0', 'number'],
    [';', 'punctuation.delimiter'],
    ['|}', 'punctuation.bracket'],
    [';', 'punctuation.delimiter'],
  ]);
  assertLineFedParity(
    'ballerina',
    'type Person record {|\n    string name;\n    int age = 0;\n|};'
  );
  expect(
    tokenKinds('ballerina', 'map<json> m = {"a": 1.5d, \'type: 0xFF};')
  ).toEqual([
    ['map', 'type.builtin'],
    ['<', 'operator'],
    ['json', 'type.builtin'],
    ['>', 'operator'],
    ['m', 'variable'],
    ['=', 'operator'],
    ['{', 'punctuation.bracket'],
    ['"a"', 'string'],
    [':', 'punctuation.delimiter'],
    ['1.5d', 'number'],
    [',', 'punctuation.delimiter'],
    ["'type", 'variable'],
    [':', 'punctuation.delimiter'],
    ['0xFF', 'number'],
    ['}', 'punctuation.bracket'],
    [';', 'punctuation.delimiter'],
  ]);
});

test('ballerina: services, resources, and annotations', () => {
  expect(
    tokenKinds(
      'ballerina',
      '@http:ServiceConfig {cors: {allowOrigins: ["*"]}}\nservice /hello/world on new http:Listener(9090) {'
    )
  ).toEqual([
    ['@http:ServiceConfig', 'attribute'],
    ['{', 'punctuation.bracket'],
    ['cors', 'variable'],
    [':', 'punctuation.delimiter'],
    ['{', 'punctuation.bracket'],
    ['allowOrigins', 'variable'],
    [':', 'punctuation.delimiter'],
    ['[', 'punctuation.bracket'],
    ['"*"', 'string'],
    [']}}', 'punctuation.bracket'],
    ['service', 'keyword.declaration'],
    ['/hello/world', 'string.special'],
    ['on', 'keyword.control'],
    ['new', 'keyword'],
    ['http', 'namespace'],
    [':', 'punctuation.delimiter'],
    ['Listener', 'function'],
    ['(', 'punctuation.bracket'],
    ['9090', 'number'],
    [') {', 'punctuation.bracket'],
  ]);
  assertLineFedParity(
    'ballerina',
    '@http:ServiceConfig {cors: {allowOrigins: ["*"]}}\nservice /hello/world on new http:Listener(9090) {'
  );
  expect(
    tokenKinds(
      'ballerina',
      'resource function get users/[int id]() returns User|error {'
    )
  ).toEqual([
    ['resource function', 'keyword.declaration'],
    ['get', 'keyword'],
    ['users', 'function.definition'],
    ['/', 'operator'],
    ['[', 'punctuation.bracket'],
    ['int', 'type.builtin'],
    ['id', 'variable'],
    [']()', 'punctuation.bracket'],
    ['returns', 'keyword'],
    ['User', 'type'],
    ['|', 'operator'],
    ['error', 'type.builtin'],
    ['{', 'punctuation.bracket'],
  ]);
  expect(tokenKinds('ballerina', 'service / on ep {}')).toEqual([
    ['service', 'keyword.declaration'],
    ['/', 'string.special'],
    ['on', 'keyword.control'],
    ['ep', 'variable'],
    ['{}', 'punctuation.bracket'],
  ]);
  expect(
    tokenKinds('ballerina', 'public isolated function main() returns error? {')
  ).toEqual([
    ['public isolated function', 'keyword.declaration'],
    ['main', 'function.definition'],
    ['()', 'punctuation.bracket'],
    ['returns', 'keyword'],
    ['error', 'type.builtin'],
    ['?', 'operator'],
    ['{', 'punctuation.bracket'],
  ]);
});

test('ballerina: string templates and escapes', () => {
  expect(
    tokenKinds('ballerina', 'string s = string `Hello ${name}, ${f("x")}`;')
  ).toEqual([
    ['string', 'type.builtin'],
    ['s', 'variable'],
    ['=', 'operator'],
    ['string', 'type.builtin'],
    ['`Hello', 'string'],
    ['${', 'punctuation.special'],
    ['name', 'variable'],
    ['}', 'punctuation.special'],
    [',', 'string'],
    ['${', 'punctuation.special'],
    ['f', 'function'],
    ['(', 'punctuation.bracket'],
    ['"x"', 'string'],
    [')', 'punctuation.bracket'],
    ['}', 'punctuation.special'],
    ['`', 'string'],
    [';', 'punctuation.delimiter'],
  ]);
  expect(tokenKinds('ballerina', 'xml x = xml `<a>${v}</a>\n<b/>`;')).toEqual([
    ['xml', 'type.builtin'],
    ['x', 'variable'],
    ['=', 'operator'],
    ['xml', 'type.builtin'],
    ['`<a>', 'string'],
    ['${', 'punctuation.special'],
    ['v', 'variable'],
    ['}', 'punctuation.special'],
    ['</a>', 'string'],
    ['<b/>`', 'string'],
    [';', 'punctuation.delimiter'],
  ]);
  assertLineFedParity('ballerina', 'xml x = xml `<a>${v}</a>\n<b/>`;');
  expect(tokenKinds('ballerina', 'check io:println("tab\\there");')).toEqual([
    ['check', 'keyword.control'],
    ['io', 'namespace'],
    [':', 'punctuation.delimiter'],
    ['println', 'function'],
    ['(', 'punctuation.bracket'],
    ['"tab', 'string'],
    ['\\t', 'string.escape'],
    ['here"', 'string'],
    [')', 'punctuation.bracket'],
    [';', 'punctuation.delimiter'],
  ]);
});

test('ballerina: documentation, comments, and queries', () => {
  expect(
    tokenKinds(
      'ballerina',
      '# Adds numbers.\n# + a - first\n// note\nint x = a / b * 2;'
    )
  ).toEqual([
    ['# Adds numbers.', 'comment.doc'],
    ['# + a - first', 'comment.doc'],
    ['// note', 'comment'],
    ['int', 'type.builtin'],
    ['x', 'variable'],
    ['=', 'operator'],
    ['a', 'variable'],
    ['/', 'operator'],
    ['b', 'variable'],
    ['*', 'operator'],
    ['2', 'number'],
    [';', 'punctuation.delimiter'],
  ]);
  assertLineFedParity(
    'ballerina',
    '# Adds numbers.\n# + a - first\n// note\nint x = a / b * 2;'
  );
  expect(
    tokenKinds(
      'ballerina',
      'var r = from var p in people where p.age > 18 select p.name;'
    )
  ).toEqual([
    ['var', 'keyword.declaration'],
    ['r', 'variable'],
    ['=', 'operator'],
    ['from', 'keyword.control'],
    ['var', 'keyword.declaration'],
    ['p', 'variable'],
    ['in', 'keyword.operator'],
    ['people', 'variable'],
    ['where', 'keyword.control'],
    ['p', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['age', 'property'],
    ['>', 'operator'],
    ['18', 'number'],
    ['select', 'keyword.control'],
    ['p', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['name', 'property'],
    [';', 'punctuation.delimiter'],
  ]);
  expect(
    tokenKinds('ballerina', 'foreach int i in 0 ..< 10 { if i > 3 { break; } }')
  ).toEqual([
    ['foreach', 'keyword.control'],
    ['int', 'type.builtin'],
    ['i', 'variable'],
    ['in', 'keyword.operator'],
    ['0', 'number'],
    ['..<', 'operator'],
    ['10', 'number'],
    ['{', 'punctuation.bracket'],
    ['if', 'keyword.control'],
    ['i', 'variable'],
    ['>', 'operator'],
    ['3', 'number'],
    ['{', 'punctuation.bracket'],
    ['break', 'keyword.control'],
    [';', 'punctuation.delimiter'],
    ['} }', 'punctuation.bracket'],
  ]);
});
