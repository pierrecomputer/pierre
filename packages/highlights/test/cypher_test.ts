import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('cypher: clauses, node labels, map keys, and parameters', () => {
  expect(
    tokenKinds(
      'cypher',
      'match (n:Person:Admin {name: $name, `full name`: "A"}) RETURN n.name'
    )
  ).toEqual([
    ['match', 'keyword'],
    ['(', 'punctuation.bracket'],
    ['n', 'variable'],
    [':', 'punctuation.delimiter'],
    ['Person', 'type'],
    [':', 'punctuation.delimiter'],
    ['Admin', 'type'],
    ['{', 'punctuation.bracket'],
    ['name', 'property'],
    [':', 'punctuation.delimiter'],
    ['$name', 'variable.special'],
    [',', 'punctuation.delimiter'],
    ['`full name`', 'property'],
    [':', 'punctuation.delimiter'],
    ['"A"', 'string'],
    ['})', 'punctuation.bracket'],
    ['RETURN', 'keyword'],
    ['n', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['name', 'property'],
  ]);
  // keywords used as map keys or labels keep those roles
  expect(tokenKinds('cypher', '(o:Order {limit: 1})')).toEqual([
    ['(', 'punctuation.bracket'],
    ['o', 'variable'],
    [':', 'punctuation.delimiter'],
    ['Order', 'type'],
    ['{', 'punctuation.bracket'],
    ['limit', 'property'],
    [':', 'punctuation.delimiter'],
    ['1', 'number'],
    ['})', 'punctuation.bracket'],
  ]);
});

test('cypher: relationship patterns, types, and variable lengths', () => {
  expect(
    tokenKinds('cypher', '(a)-[r:KNOWS|LIKES*1..3]->(b)<-[:OWNS]-(c)--(d)')
  ).toEqual([
    ['(', 'punctuation.bracket'],
    ['a', 'variable'],
    [')', 'punctuation.bracket'],
    ['-', 'operator'],
    ['[', 'punctuation.bracket'],
    ['r', 'variable'],
    [':', 'punctuation.delimiter'],
    ['KNOWS', 'type'],
    ['|', 'operator'],
    ['LIKES', 'type'],
    ['*', 'operator'],
    ['1', 'number'],
    ['..', 'operator'],
    ['3', 'number'],
    [']', 'punctuation.bracket'],
    ['->', 'operator'],
    ['(', 'punctuation.bracket'],
    ['b', 'variable'],
    [')', 'punctuation.bracket'],
    ['<-', 'operator'],
    ['[', 'punctuation.bracket'],
    [':', 'punctuation.delimiter'],
    ['OWNS', 'type'],
    [']', 'punctuation.bracket'],
    ['-', 'operator'],
    ['(', 'punctuation.bracket'],
    ['c', 'variable'],
    [')', 'punctuation.bracket'],
    ['--', 'operator'],
    ['(', 'punctuation.bracket'],
    ['d', 'variable'],
    [')', 'punctuation.bracket'],
  ]);
});

test('cypher: functions, operators, literals, and comments', () => {
  expect(
    tokenKinds(
      'cypher',
      "WHERE NOT n.x STARTS WITH 'a\\'b' AND size(n.tags) >= 0x1F // done\nRETURN apoc.text.join(['x'], ',') AS s, null, TRUE"
    )
  ).toEqual([
    ['WHERE', 'keyword'],
    ['NOT', 'keyword.operator'],
    ['n', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['x', 'property'],
    ['STARTS', 'keyword.operator'],
    ['WITH', 'keyword'],
    ["'a", 'string'],
    ["\\'", 'string.escape'],
    ["b'", 'string'],
    ['AND', 'keyword.operator'],
    ['size', 'function'],
    ['(', 'punctuation.bracket'],
    ['n', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['tags', 'property'],
    [')', 'punctuation.bracket'],
    ['>=', 'operator'],
    ['0x1F', 'number'],
    ['// done', 'comment'],
    ['RETURN', 'keyword'],
    ['apoc', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['text', 'property'],
    ['.', 'punctuation.delimiter'],
    ['join', 'function'],
    ['([', 'punctuation.bracket'],
    ["'x'", 'string'],
    [']', 'punctuation.bracket'],
    [',', 'punctuation.delimiter'],
    ["','", 'string'],
    [')', 'punctuation.bracket'],
    ['AS', 'keyword'],
    ['s', 'variable'],
    [',', 'punctuation.delimiter'],
    ['null', 'constant.builtin'],
    [',', 'punctuation.delimiter'],
    ['TRUE', 'boolean'],
  ]);
});

test('cypher: block comments, strings, and maps span lines', () => {
  const code =
    "/* a\n   b */ CREATE (n:Note {\n  text: 'line one\nline two',\n  tag: `x`\n})\n";
  expect(tokenKinds('cypher', code)).toEqual([
    ['/* a', 'comment'],
    ['b */', 'comment'],
    ['CREATE', 'keyword'],
    ['(', 'punctuation.bracket'],
    ['n', 'variable'],
    [':', 'punctuation.delimiter'],
    ['Note', 'type'],
    ['{', 'punctuation.bracket'],
    ['text', 'property'],
    [':', 'punctuation.delimiter'],
    ["'line one", 'string'],
    ["line two'", 'string'],
    [',', 'punctuation.delimiter'],
    ['tag', 'property'],
    [':', 'punctuation.delimiter'],
    ['`x`', 'variable'],
    ['})', 'punctuation.bracket'],
  ]);
  assertLineFedParity('cypher', code);
});
