import assert from 'node:assert';
import t from 'node:test';

import {
  assertLineFedParity,
  checkInvariants,
  colorOf,
  distinctColor,
  distinctTheme,
  exactColor,
  loadLang,
  spanKinds,
  type TestLang,
  themeColor,
  tokenKinds,
  wordColor,
} from './util';

let sql: TestLang;
t.before(() => (sql = loadLang('sql', '$hlSql')));

/** Highlight under the distinct theme after checking the lexer invariants. */
const hl = (src: string) =>
  checkInvariants(sql.hl, src, { theme: distinctTheme });

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

void t.test('sql: keywords fold case', () => {
  for (const src of [
    'select * from t where x = 1;',
    'Select * From t Where x = 1;',
    'SELECT * FROM t WHERE x = 1;',
  ]) {
    assert.deepEqual(spanKinds(hl(src)), [
      [src.slice(0, 6), 'keyword'],
      ['*', 'operator'],
      [src.slice(9, 13), 'keyword'],
      ['t', 'variable'],
      [src.slice(16, 21), 'keyword'],
      ['x', 'variable'],
      ['=', 'operator'],
      ['1', 'number'],
      [';', 'punctuation.delimiter'],
    ]);
  }
});

void t.test('sql: dash, hash, and block comments', () => {
  assert.deepEqual(
    tokenKinds(
      'sql',
      '-- dash comment\n# hash comment\n/* block\n   comment */ SELECT 1;'
    ),
    [
      ['-- dash comment', 'comment'],
      ['# hash comment', 'comment'],
      ['/* block', 'comment'],
      ['comment */', 'comment'],
      ['SELECT', 'keyword'],
      ['1', 'number'],
      [';', 'punctuation.delimiter'],
    ]
  );
  // `--` and `/*` inside strings are text
  assert.deepEqual(spanKinds(hl("SELECT '-- not', '/* not */';")).slice(1, 2), [
    ["'-- not'", 'string'],
  ]);
});

void t.test(
  'sql: every string form, including doubled quotes and multi-line bodies',
  () => {
    const html = hl(
      "SELECT 'it''s', \"ident\", `ident`, $$dollar$$, $tag$tag $ x$tag$, 'multi\nline';"
    );
    for (const s of [
      "'it''s'",
      '"ident"',
      '`ident`',
      '$$dollar$$',
      '$tag$tag $ x$tag$',
      "'multi\nline'",
    ]) {
      assert.equal(exactColor(html, s), distinctColor('string'), s);
    }
  }
);

void t.test('sql: numeric literal forms', () => {
  const html = hl('SELECT 42, 3.14, .5, 1e10, 0x1F, -3;');
  for (const n of ['42', '3.14', '.5', '1e10', '0x1F', '3']) {
    assert.equal(exactColor(html, n), distinctColor('number'), n);
  }
  assert.equal(exactColor(html, '-'), distinctColor('operator'));
});

void t.test('sql: every operator, including division and JSON arrows', () => {
  const html = hl(
    'SELECT a = b, a <> b, a != b, a <= b, a >= b, a || b, a -> b, a ->> b, a % b, a + b, a - b, a * b, a / b, a << b, ~a, a & b, a | b, a ^ b, !a, a < b, a > b;'
  );
  for (const op of [
    '=',
    '<>',
    '!=',
    '<=',
    '>=',
    '||',
    '->',
    '->>',
    '%',
    '+',
    '-',
    '*',
    '/',
    '<<',
    '~',
    '&',
    '|',
    '^',
    '!',
    '<',
    '>',
  ]) {
    assert.equal(exactColor(html, op), distinctColor('operator'), op);
  }
});

void t.test('sql: placeholders and host parameters', () => {
  const html = hl('SELECT ?, :name, @var FROM t;');
  for (const p of ['?', ':name', '@var']) {
    assert.equal(exactColor(html, p), distinctColor('variable.special'), p);
  }
});

void t.test('sql: statement keywords by bucket', () => {
  const html = hl(
    'WITH x AS (SELECT DISTINCT a FROM t LEFT OUTER JOIN u ON t.id = u.id RIGHT JOIN v USING (id) FULL JOIN w ON 1 INNER JOIN y ON 1 GROUP BY a HAVING COUNT(*) > 1 ORDER BY a ASC, b DESC LIMIT 10) ' +
      'INSERT INTO t (a) VALUES (1); UPDATE t SET a = 2; DELETE FROM t; CREATE TABLE t (id INTEGER PRIMARY KEY DEFAULT 0, FOREIGN KEY (b)); ' +
      'SELECT CASE WHEN a THEN 1 ELSE 2 END, a AND b OR NOT c, a IN (1), a BETWEEN 1 AND 2, EXISTS (SELECT 1), a LIKE b, a IS NULL, ALL;'
  );
  for (const word of [
    'WITH',
    'AS',
    'SELECT',
    'DISTINCT',
    'FROM',
    'LEFT',
    'OUTER',
    'JOIN',
    'ON',
    'RIGHT',
    'USING',
    'FULL',
    'INNER',
    'GROUP',
    'BY',
    'HAVING',
    'ORDER',
    'ASC',
    'DESC',
    'LIMIT',
    'INSERT',
    'INTO',
    'VALUES',
    'UPDATE',
    'SET',
    'DELETE',
    'CREATE',
    'TABLE',
    'PRIMARY',
    'DEFAULT',
    'FOREIGN',
    'END',
    'ALL',
  ]) {
    assert.equal(wordColor(html, word), distinctColor('keyword'), word);
  }
  for (const word of ['CASE', 'WHEN', 'THEN', 'ELSE']) {
    assert.equal(wordColor(html, word), distinctColor('keyword.control'), word);
  }
  for (const word of [
    'AND',
    'OR',
    'NOT',
    'IN',
    'BETWEEN',
    'EXISTS',
    'LIKE',
    'IS',
  ]) {
    assert.equal(
      wordColor(html, word),
      distinctColor('keyword.operator'),
      word
    );
  }
});

void t.test('sql: built-in column types', () => {
  const html = hl(
    'CREATE TABLE t (a INTEGER, b BIGINT, c TEXT, d VARCHAR(10), e BOOLEAN, f DATE, g DECIMAL, h DOUBLE, i REAL, j CHAR, k NCHAR, l BLOB, m JSON, n JSONB, o UUID);'
  );
  for (const type of [
    'INTEGER',
    'BIGINT',
    'TEXT',
    'VARCHAR',
    'BOOLEAN',
    'DATE',
    'DECIMAL',
    'DOUBLE',
    'REAL',
    'CHAR',
    'NCHAR',
    'BLOB',
    'JSON',
    'JSONB',
    'UUID',
  ]) {
    assert.equal(exactColor(html, type), distinctColor('type.builtin'), type);
  }
  assert.equal(exactColor(html, '10'), distinctColor('number'));
});

void t.test('sql: constants, calls, and qualified names', () => {
  const html = hl(
    'SELECT NULL, TRUE, FALSE, null, true, false, COUNT(x), now(), coalesce(a, b), t.col, schema.t.col;'
  );
  assert.equal(exactColor(html, 'NULL'), distinctColor('constant.builtin'));
  assert.equal(exactColor(html, 'null'), distinctColor('constant.builtin'));
  for (const b of ['TRUE', 'FALSE', 'true', 'false']) {
    assert.equal(exactColor(html, b), distinctColor('boolean'), b);
  }
  for (const f of ['COUNT', 'now', 'coalesce']) {
    assert.equal(exactColor(html, f), distinctColor('function'), f);
  }
  assert.deepEqual(spanKinds(hl('SELECT schema.t.col;')).slice(1, -1), [
    ['schema', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['t', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['col', 'variable'],
  ]);
});

void t.test('sql: brackets and delimiters', () => {
  assert.deepEqual(spanKinds(hl('SELECT (a), [b], a.b, c; -- end')), [
    ['SELECT', 'keyword'],
    ['(', 'punctuation.bracket'],
    ['a', 'variable'],
    [')', 'punctuation.bracket'],
    [',', 'punctuation.delimiter'],
    ['[', 'punctuation.bracket'],
    ['b', 'variable'],
    [']', 'punctuation.bracket'],
    [',', 'punctuation.delimiter'],
    ['a', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['b', 'variable'],
    [',', 'punctuation.delimiter'],
    ['c', 'variable'],
    [';', 'punctuation.delimiter'],
    ['-- end', 'comment'],
  ]);
});

void t.test(
  'sql: multi-line strings, comments, and dollar bodies stream line-fed',
  () => {
    assertLineFedParity(
      'sql',
      "/* header\n   comment */\nINSERT INTO t VALUES ('multi\nline', $$a\nb$$, $tag$x\ny$tag$);\nSELECT 1; -- done\n"
    );
    assertLineFedParity('sql', "SELECT 'unterminated\nstill\n");
  }
);

void t.test('sql: malformed and split ranges stay lossless', () => {
  for (const src of [
    '',
    "'",
    '"',
    '`',
    '/*',
    '--',
    '#',
    '$$unterminated',
    '$tag$unterminated',
    '$tag',
    'SELECT é FROM 日本語',
    '$',
    '1.',
    ':',
    '@',
    '?',
    '/',
  ]) {
    checkInvariants(sql.hl, src);
  }
  const split = loadLang('sql', '$hlSql', 7);
  checkInvariants(split.hl, "SELECT 'x' -- y\n");
});
