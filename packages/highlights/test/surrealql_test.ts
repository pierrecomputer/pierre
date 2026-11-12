import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('surrealql: statements, clauses, and case-insensitive keywords', () => {
  expect(
    tokenKinds(
      'surrealql',
      'DEFINE TABLE user SCHEMAFULL PERMISSIONS FOR select WHERE id = $auth.id;\ndefine field email on table user type string;'
    )
  ).toEqual([
    ['DEFINE TABLE', 'keyword'],
    ['user', 'type'],
    ['SCHEMAFULL PERMISSIONS', 'keyword'],
    ['FOR', 'keyword.control'],
    ['select WHERE', 'keyword'],
    ['id', 'variable'],
    ['=', 'operator'],
    ['$auth', 'variable.special'],
    ['.', 'punctuation.delimiter'],
    ['id', 'property'],
    [';', 'punctuation.delimiter'],
    ['define field', 'keyword'],
    ['email', 'property'],
    ['on table', 'keyword'],
    ['user', 'type'],
    ['type', 'keyword'],
    ['string', 'type.builtin'],
    [';', 'punctuation.delimiter'],
  ]);
  expect(
    tokenKinds(
      'surrealql',
      'SELECT * FROM user WHERE age >= 18 AND name != NONE ORDER BY age DESC LIMIT 10 FETCH friends TIMEOUT 1h30m;'
    )
  ).toEqual([
    ['SELECT', 'keyword'],
    ['*', 'operator'],
    ['FROM', 'keyword'],
    ['user', 'type'],
    ['WHERE', 'keyword'],
    ['age', 'variable'],
    ['>=', 'operator'],
    ['18', 'number'],
    ['AND', 'keyword.operator'],
    ['name', 'variable'],
    ['!=', 'operator'],
    ['NONE', 'constant.builtin'],
    ['ORDER BY', 'keyword'],
    ['age', 'variable'],
    ['DESC LIMIT', 'keyword'],
    ['10', 'number'],
    ['FETCH', 'keyword'],
    ['friends', 'variable'],
    ['TIMEOUT', 'keyword'],
    ['1h30m', 'number'],
    [';', 'punctuation.delimiter'],
  ]);
});

test('surrealql: record ids, graph edges, and function paths', () => {
  expect(
    tokenKinds(
      'surrealql',
      'RELATE person:tobie->wrote->article:⟨surreal db⟩ SET time = time::now();'
    )
  ).toEqual([
    ['RELATE', 'keyword'],
    ['person', 'type'],
    [':', 'punctuation.delimiter'],
    ['tobie', 'constant'],
    ['->', 'operator'],
    ['wrote', 'type'],
    ['->', 'operator'],
    ['article', 'type'],
    [':', 'punctuation.delimiter'],
    ['⟨surreal db⟩', 'constant'],
    ['SET', 'keyword'],
    ['time', 'variable'],
    ['=', 'operator'],
    ['time::now', 'function'],
    ['()', 'punctuation.bracket'],
    [';', 'punctuation.delimiter'],
  ]);
  expect(
    tokenKinds(
      'surrealql',
      'SELECT ->knows->person.name AS friends FROM person:`tobie`, person:100, person:uuid() WHERE fn::ok(string::len(name));'
    )
  ).toEqual([
    ['SELECT', 'keyword'],
    ['->', 'operator'],
    ['knows', 'type'],
    ['->', 'operator'],
    ['person', 'type'],
    ['.', 'punctuation.delimiter'],
    ['name', 'property'],
    ['AS', 'keyword'],
    ['friends', 'variable'],
    ['FROM', 'keyword'],
    ['person', 'type'],
    [':', 'punctuation.delimiter'],
    ['`tobie`', 'constant'],
    [',', 'punctuation.delimiter'],
    ['person', 'type'],
    [':', 'punctuation.delimiter'],
    ['100', 'constant'],
    [',', 'punctuation.delimiter'],
    ['person', 'type'],
    [':', 'punctuation.delimiter'],
    ['uuid', 'function'],
    ['()', 'punctuation.bracket'],
    ['WHERE', 'keyword'],
    ['fn::ok', 'function'],
    ['(', 'punctuation.bracket'],
    ['string::len', 'function'],
    ['(', 'punctuation.bracket'],
    ['name', 'variable'],
    ['))', 'punctuation.bracket'],
    [';', 'punctuation.delimiter'],
  ]);
});

test('surrealql: casts, params, objects, and typed literals', () => {
  expect(
    tokenKinds(
      'surrealql',
      'LET $x = <int> "1"; RETURN <array<string>> $y, <future> { time::now() };'
    )
  ).toEqual([
    ['LET', 'keyword'],
    ['$x', 'variable.special'],
    ['=', 'operator'],
    ['<', 'punctuation.bracket'],
    ['int', 'type.builtin'],
    ['>', 'punctuation.bracket'],
    ['"1"', 'string'],
    [';', 'punctuation.delimiter'],
    ['RETURN', 'keyword.control'],
    ['<', 'punctuation.bracket'],
    ['array', 'type.builtin'],
    ['<', 'punctuation.bracket'],
    ['string', 'type.builtin'],
    ['>>', 'punctuation.bracket'],
    ['$y', 'variable.special'],
    [',', 'punctuation.delimiter'],
    ['<', 'punctuation.bracket'],
    ['future', 'type.builtin'],
    ['> {', 'punctuation.bracket'],
    ['time::now', 'function'],
    ['() }', 'punctuation.bracket'],
    [';', 'punctuation.delimiter'],
  ]);
  expect(
    tokenKinds(
      'surrealql',
      'CREATE user CONTENT { name: \'Tobie \\\'T\\\'\', since: d"2024-01-01", id: u"0190c4b6-0000-7000-8000-000000000000", n: 1.5, ok: true, none: NULL };'
    )
  ).toEqual([
    ['CREATE', 'keyword'],
    ['user', 'type'],
    ['CONTENT', 'keyword'],
    ['{', 'punctuation.bracket'],
    ['name', 'property'],
    [':', 'punctuation.delimiter'],
    ["'Tobie", 'string'],
    ["\\'", 'string.escape'],
    ['T', 'string'],
    ["\\'", 'string.escape'],
    ["'", 'string'],
    [',', 'punctuation.delimiter'],
    ['since', 'property'],
    [':', 'punctuation.delimiter'],
    ['d"2024-01-01"', 'string.special'],
    [',', 'punctuation.delimiter'],
    ['id', 'property'],
    [':', 'punctuation.delimiter'],
    ['u"0190c4b6-0000-7000-8000-000000000000"', 'string.special'],
    [',', 'punctuation.delimiter'],
    ['n', 'property'],
    [':', 'punctuation.delimiter'],
    ['1.5', 'number'],
    [',', 'punctuation.delimiter'],
    ['ok', 'property'],
    [':', 'punctuation.delimiter'],
    ['true', 'boolean'],
    [',', 'punctuation.delimiter'],
    ['none', 'property'],
    [':', 'punctuation.delimiter'],
    ['NULL', 'constant.builtin'],
    ['}', 'punctuation.bracket'],
    [';', 'punctuation.delimiter'],
  ]);
});

test('surrealql: comments and strings that span lines', () => {
  expect(
    tokenKinds(
      'surrealql',
      '-- dash\n// slash\n# hash\n/* block\nλ😀 */ SELECT 1;'
    )
  ).toEqual([
    ['-- dash', 'comment'],
    ['// slash', 'comment'],
    ['# hash', 'comment'],
    ['/* block', 'comment'],
    ['λ😀 */', 'comment'],
    ['SELECT', 'keyword'],
    ['1', 'number'],
    [';', 'punctuation.delimiter'],
  ]);
  assertLineFedParity(
    'surrealql',
    '-- dash\n// slash\n# hash\n/* block\nλ😀 */ SELECT 1;'
  );
  expect(tokenKinds('surrealql', 'LET $s = "one\ntwo";\nRETURN $s;')).toEqual([
    ['LET', 'keyword'],
    ['$s', 'variable.special'],
    ['=', 'operator'],
    ['"one', 'string'],
    ['two"', 'string'],
    [';', 'punctuation.delimiter'],
    ['RETURN', 'keyword.control'],
    ['$s', 'variable.special'],
    [';', 'punctuation.delimiter'],
  ]);
  assertLineFedParity('surrealql', 'LET $s = "one\ntwo";\nRETURN $s;');
});

test('surrealql: a table may share a keyword name after FROM and arrows', () => {
  expect(
    tokenKinds(
      'surrealql',
      'SELECT * FROM user, event; SELECT ->value->index FROM ONLY comment;'
    )
  ).toEqual([
    ['SELECT', 'keyword'],
    ['*', 'operator'],
    ['FROM', 'keyword'],
    ['user', 'type'],
    [',', 'punctuation.delimiter'],
    ['event', 'type'],
    [';', 'punctuation.delimiter'],
    ['SELECT', 'keyword'],
    ['->', 'operator'],
    ['value', 'type'],
    ['->', 'operator'],
    ['index', 'type'],
    ['FROM ONLY', 'keyword'],
    ['comment', 'type'],
    [';', 'punctuation.delimiter'],
  ]);
});
