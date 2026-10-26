import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('apex: case-insensitive keywords, sharing modifiers, and annotations', () => {
  expect(
    tokenKinds('apex', 'Public WITH Sharing Class Svc Extends Base {')
  ).toEqual([
    ['Public WITH Sharing Class', 'keyword.declaration'],
    ['Svc', 'type'],
    ['Extends', 'keyword.declaration'],
    ['Base', 'type'],
    ['{', 'punctuation.bracket'],
  ]);
  expect(tokenKinds('apex', '@IsTest static void run() {}')).toEqual([
    ['@IsTest', 'attribute'],
    ['static', 'keyword.declaration'],
    ['void', 'type.builtin'],
    ['run', 'function.definition'],
    ['() {}', 'punctuation.bracket'],
  ]);
  expect(
    tokenKinds('apex', 'trigger Acc on Account (before insert, after update)')
  ).toEqual([
    ['trigger', 'keyword.declaration'],
    ['Acc', 'type'],
    ['on', 'keyword'],
    ['Account', 'type'],
    ['(', 'punctuation.bracket'],
    ['before insert', 'keyword'],
    [',', 'punctuation.delimiter'],
    ['after update', 'keyword'],
    [')', 'punctuation.bracket'],
  ]);
});

test('apex: DML, members, accessors, and strings', () => {
  expect(
    tokenKinds('apex', 'insert accs; Database.insert(accs); x = Trigger.new;')
  ).toEqual([
    ['insert', 'keyword'],
    ['accs', 'variable'],
    [';', 'punctuation.delimiter'],
    ['Database', 'type'],
    ['.', 'punctuation.delimiter'],
    ['insert', 'function.method'],
    ['(', 'punctuation.bracket'],
    ['accs', 'variable'],
    [')', 'punctuation.bracket'],
    [';', 'punctuation.delimiter'],
    ['x', 'variable'],
    ['=', 'operator'],
    ['Trigger', 'type'],
    ['.', 'punctuation.delimiter'],
    ['new', 'property'],
    [';', 'punctuation.delimiter'],
  ]);
  expect(
    tokenKinds('apex', 'a.Name = s.get(1); Set<Id> ids { get; set; }')
  ).toEqual([
    ['a', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['Name', 'property'],
    ['=', 'operator'],
    ['s', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['get', 'function.method'],
    ['(', 'punctuation.bracket'],
    ['1', 'number'],
    [')', 'punctuation.bracket'],
    [';', 'punctuation.delimiter'],
    ['Set', 'type.builtin'],
    ['<', 'operator'],
    ['Id', 'type.builtin'],
    ['>', 'operator'],
    ['ids', 'variable'],
    ['{', 'punctuation.bracket'],
    ['get', 'keyword.declaration'],
    [';', 'punctuation.delimiter'],
    ['set', 'keyword.declaration'],
    [';', 'punctuation.delimiter'],
    ['}', 'punctuation.bracket'],
  ]);
  expect(tokenKinds('apex', "s = 'It\\'s\\n';")).toEqual([
    ['s', 'variable'],
    ['=', 'operator'],
    ["'It", 'string'],
    ["\\'", 'string.escape'],
    ['s', 'string'],
    ['\\n', 'string.escape'],
    ["'", 'string'],
    [';', 'punctuation.delimiter'],
  ]);
  // SOQL words are plain names outside a query
  expect(tokenKinds('apex', 'Integer first = last;')).toContainEqual([
    'first',
    'variable',
  ]);
});

test('apex: inline SOQL and SOSL across lines', () => {
  const code = [
    'List<Account> rows = [',
    '  SELECT Id, Owner.Name, COUNT(Id) FROM Account',
    '  WHERE Name LIKE :name AND Id IN :ids[0]',
    '  ORDER BY Name NULLS LAST LIMIT 10',
    '];',
    'Integer first = 1;',
    '',
  ].join('\n');
  expect(tokenKinds('apex', code)).toEqual([
    ['List', 'type.builtin'],
    ['<', 'operator'],
    ['Account', 'type'],
    ['>', 'operator'],
    ['rows', 'variable'],
    ['=', 'operator'],
    ['[', 'punctuation.bracket'],
    ['SELECT', 'keyword'],
    ['Id', 'variable'],
    [',', 'punctuation.delimiter'],
    ['Owner', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['Name', 'variable'],
    [',', 'punctuation.delimiter'],
    ['COUNT', 'function'],
    ['(', 'punctuation.bracket'],
    ['Id', 'variable'],
    [')', 'punctuation.bracket'],
    ['FROM', 'keyword'],
    ['Account', 'type'],
    ['WHERE', 'keyword'],
    ['Name', 'variable'],
    ['LIKE', 'keyword.operator'],
    [':name', 'variable.special'],
    ['AND', 'keyword.operator'],
    ['Id', 'variable'],
    ['IN', 'keyword.operator'],
    [':ids', 'variable.special'],
    ['[', 'punctuation.bracket'],
    ['0', 'number'],
    [']', 'punctuation.bracket'],
    ['ORDER BY', 'keyword'],
    ['Name', 'variable'],
    ['NULLS LAST LIMIT', 'keyword'],
    ['10', 'number'],
    [']', 'punctuation.bracket'],
    [';', 'punctuation.delimiter'],
    ['Integer', 'type.builtin'],
    ['first', 'variable'],
    ['=', 'operator'],
    ['1', 'number'],
    [';', 'punctuation.delimiter'],
  ]);
  assertLineFedParity('apex', code);
  // only `select` or `find` right after the `[` opens a query
  expect(tokenKinds('apex', 'x = a[first];')).toContainEqual([
    'first',
    'variable',
  ]);
  expect(
    tokenKinds('apex', "[FIND 'acme' RETURNING Account(Name)]")
  ).toContainEqual(['RETURNING', 'keyword']);
});

test('apex: a lowercase type name is a variable before an operator', () => {
  expect(
    tokenKinds('apex', 'Date date = null; for (Id id : ids) list<string> l;')
  ).toEqual([
    ['Date', 'type.builtin'],
    ['date', 'variable'],
    ['=', 'operator'],
    ['null', 'constant.builtin'],
    [';', 'punctuation.delimiter'],
    ['for', 'keyword.control'],
    ['(', 'punctuation.bracket'],
    ['Id', 'type.builtin'],
    ['id', 'variable'],
    [':', 'punctuation.delimiter'],
    ['ids', 'variable'],
    [')', 'punctuation.bracket'],
    ['list', 'type.builtin'],
    ['<', 'operator'],
    ['string', 'type.builtin'],
    ['>', 'operator'],
    ['l', 'variable'],
    [';', 'punctuation.delimiter'],
  ]);
});

test('apex: Java keeps its own dialect after an Apex run', () => {
  expect(tokenKinds('apex', 'Public Class A {}')[0]).toEqual([
    'Public Class',
    'keyword.declaration',
  ]);
  expect(tokenKinds('java', 'Public Class A {}')[0]).toEqual([
    'Public Class A',
    'type',
  ]);
});
