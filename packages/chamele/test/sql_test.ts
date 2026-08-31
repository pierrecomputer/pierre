import assert from 'node:assert';
import t from 'node:test';

import {
  checkInvariants,
  colorOf,
  loadLang,
  type TestLang,
  themeColor,
} from './util';

let sql: TestLang;
t.before(() => (sql = loadLang('sql', '$hlSql')));

const KEYWORD = themeColor('keyword');
const KEYOP = themeColor('keyword.operator');
const STRING = themeColor('string');
const NUMBER = themeColor('number');
const COMMENT = themeColor('comment');
const FUNCTION = themeColor('function');
const TYPE = themeColor('type.builtin');
const CONST = themeColor('constant.builtin');
const OPERATOR = themeColor('operator');

void t.test('sql: queries, operators, functions, and literals', () => {
  const src =
    "SELECT count(*) FROM users WHERE id = 42 AND name LIKE 'A%'; -- tail";
  const html = checkInvariants(sql.hl, src);
  assert.equal(colorOf(html, 'SELECT'), KEYWORD);
  assert.equal(colorOf(html, 'count'), FUNCTION);
  assert.equal(colorOf(html, 'AND'), KEYOP);
  assert.equal(colorOf(html, "'A%'"), STRING);
  assert.equal(colorOf(html, '42'), NUMBER);
  assert.equal(colorOf(html, '-- tail'), COMMENT);
});

void t.test('sql: DDL, built-in types, null, and parameters', () => {
  const src =
    'CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT DEFAULT null); SELECT * FROM t WHERE id = $1;';
  const html = checkInvariants(sql.hl, src);
  assert.equal(colorOf(html, 'CREATE'), KEYWORD);
  assert.equal(colorOf(html, 'INTEGER'), TYPE);
  assert.equal(colorOf(html, 'TEXT'), TYPE);
  assert.equal(colorOf(html, 'null'), CONST);
});

void t.test('sql: quoted and dollar strings', () => {
  const html = checkInvariants(
    sql.hl,
    "SELECT \"name\", `other`, $$line\ntext$$, $body$a $ b$body$, 'it''s';"
  );
  assert.equal(colorOf(html, '$$line'), STRING);
  assert.equal(colorOf(html, '$body$a $ b$body$'), STRING);
});

void t.test('sql: operators and leading-dot numbers', () => {
  const html = checkInvariants(sql.hl, 'SELECT a * b & c ^ d | e, .5;');
  for (const op of ['*', '&', '^', '|'])
    assert.equal(colorOf(html, op), OPERATOR);
  assert.equal(colorOf(html, '.5'), NUMBER);
});

void t.test('sql: malformed and split ranges stay lossless', () => {
  for (const src of [
    '',
    "'",
    '/*',
    '--',
    '$$unterminated',
    'SELECT é FROM 日本語',
    '$',
    '1.',
  ]) {
    checkInvariants(sql.hl, src);
  }
  const split = loadLang('sql', '$hlSql', 7);
  checkInvariants(split.hl, "SELECT 'x' -- y\n");
});
