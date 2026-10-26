import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('plsql: blocks, declarations, and case-insensitive keywords', () => {
  expect(
    tokenKinds(
      'plsql',
      'create or replace procedure hr.bump(p_id in number) is\nbegin\n  null;\nend;'
    )
  ).toEqual([
    ['create', 'keyword'],
    ['or', 'keyword.operator'],
    ['replace', 'keyword'],
    ['procedure', 'keyword.declaration'],
    ['hr', 'namespace'],
    ['.', 'punctuation.delimiter'],
    ['bump', 'function.definition'],
    ['(', 'punctuation.bracket'],
    ['p_id', 'variable'],
    ['in', 'keyword.operator'],
    ['number', 'type.builtin'],
    [')', 'punctuation.bracket'],
    ['is', 'keyword'],
    ['begin', 'keyword'],
    ['null', 'constant.builtin'],
    [';', 'punctuation.delimiter'],
    ['end', 'keyword'],
    [';', 'punctuation.delimiter'],
  ]);
  expect(tokenKinds('plsql', 'PACKAGE BODY Pay AS')).toEqual([
    ['PACKAGE BODY', 'keyword.declaration'],
    ['Pay', 'namespace'],
    ['AS', 'keyword'],
  ]);
  expect(tokenKinds('plsql', 'TYPE t_ids IS TABLE OF PLS_INTEGER;')).toEqual([
    ['TYPE', 'keyword.declaration'],
    ['t_ids', 'type'],
    ['IS TABLE OF', 'keyword'],
    ['PLS_INTEGER', 'type.builtin'],
    [';', 'punctuation.delimiter'],
  ]);
  // a keyword between the declaration word and a name ends the capture
  expect(tokenKinds('plsql', 'SELECT type FROM t')).toContainEqual([
    't',
    'variable',
  ]);
});

test('plsql: assignment, attributes, binds, substitutions, and labels', () => {
  expect(tokenKinds('plsql', 'l_row emp%ROWTYPE := :new.id + &&base;')).toEqual(
    [
      ['l_row emp', 'variable'],
      ['%ROWTYPE', 'keyword'],
      [':=', 'operator'],
      [':new', 'variable.special'],
      ['.', 'punctuation.delimiter'],
      ['id', 'variable'],
      ['+', 'operator'],
      ['&&base', 'variable.special'],
      [';', 'punctuation.delimiter'],
    ]
  );
  expect(tokenKinds('plsql', '<<outer>>\nFOR i IN 1..10 LOOP')).toEqual([
    ['<<outer>>', 'label'],
    ['FOR', 'keyword.control'],
    ['i', 'variable'],
    ['IN', 'keyword.operator'],
    ['1', 'number'],
    ['..', 'operator'],
    ['10', 'number'],
    ['LOOP', 'keyword.control'],
  ]);
  // collection methods after `.` are members, not keywords
  expect(tokenKinds('plsql', 'l_tab.first; l_tab.delete(1)')).toEqual([
    ['l_tab', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['first', 'variable'],
    [';', 'punctuation.delimiter'],
    ['l_tab', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['delete', 'function'],
    ['(', 'punctuation.bracket'],
    ['1', 'number'],
    [')', 'punctuation.bracket'],
  ]);
  expect(tokenKinds('plsql', '$IF $$debug $THEN')).toEqual([
    ['$IF $$debug $THEN', 'preproc'],
  ]);
  // `#` is a name byte, never a MySQL comment
  expect(tokenKinds('plsql', 'x # y')).toEqual([
    ['x', 'variable'],
    ['#', null],
    ['y', 'variable'],
  ]);
});

test('plsql: quoted strings and q-quoting across lines', () => {
  expect(tokenKinds('plsql', "s := 'It''s';")).toEqual([
    ['s', 'variable'],
    [':=', 'operator'],
    ["'It''s'", 'string'],
    [';', 'punctuation.delimiter'],
  ]);
  for (const literal of [
    "q'[a ] b]'",
    "Q'{x}'",
    "q'(it's)'",
    "nq'<y>'",
    "q'!z!'",
  ]) {
    expect(tokenKinds('plsql', `${literal} x`)).toEqual([
      [literal, 'string'],
      ['x', 'variable'],
    ]);
  }
  // a blank or a line break is no delimiter, so `q'` stays a name and a quote
  expect(tokenKinds('plsql', "q' a' x")).toEqual([
    ['q', 'variable'],
    ["' a'", 'string'],
    ['x', 'variable'],
  ]);
  const open = "x := q'\nfoo';\nSELECT 1;\n";
  expect(tokenKinds('plsql', open).slice(-3)).toEqual([
    ['SELECT', 'keyword'],
    ['1', 'number'],
    [';', 'punctuation.delimiter'],
  ]);
  assertLineFedParity('plsql', open);
  const code = "v := q'[first\n-- not a comment\nlast]';\nx := 1;\n";
  expect(tokenKinds('plsql', code)).toEqual([
    ['v', 'variable'],
    [':=', 'operator'],
    ["q'[first", 'string'],
    ['-- not a comment', 'string'],
    ["last]'", 'string'],
    [';', 'punctuation.delimiter'],
    ['x', 'variable'],
    [':=', 'operator'],
    ['1', 'number'],
    [';', 'punctuation.delimiter'],
  ]);
  assertLineFedParity('plsql', code);
  assertLineFedParity('plsql', "/* a\nb */ s := 'multi\nline';\n");
});

test('plsql: SQL keeps its own dialect after a PL/SQL run', () => {
  expect(tokenKinds('plsql', "q'[x]'")).toEqual([["q'[x]'", 'string']]);
  expect(tokenKinds('sql', "q'[x]' # note")).toEqual([
    ['q', 'variable'],
    ["'[x]'", 'string'],
    ['# note', 'comment'],
  ]);
});
