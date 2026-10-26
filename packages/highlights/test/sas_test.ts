import { expect, test } from 'bun:test';

import { samples } from './_samples';
import { assertLineFedParity, tokenKinds } from './_util';

test('sas: steps, statements, options, and procedure names', () => {
  expect(tokenKinds('sas', 'PROC SORT data=sashelp.class OUT=sorted;')).toEqual(
    [
      ['PROC', 'keyword.declaration'],
      ['SORT', 'function'],
      ['data', 'variable.parameter'],
      ['=', 'operator'],
      ['sashelp', 'namespace'],
      ['.', 'punctuation.delimiter'],
      ['class', 'variable'],
      ['OUT', 'variable.parameter'],
      ['=', 'operator'],
      ['sorted', 'variable'],
      [';', 'punctuation.delimiter'],
    ]
  );
  // `name=` is an option only in an option statement, outside nested parens
  expect(
    tokenKinds('sas', 'set a(where=(x=1));\nif x = 1 then y = 2;')
  ).toEqual([
    ['set', 'keyword'],
    ['a', 'variable'],
    ['(', 'punctuation.bracket'],
    ['where', 'variable.parameter'],
    ['=', 'operator'],
    ['(', 'punctuation.bracket'],
    ['x', 'variable'],
    ['=', 'operator'],
    ['1', 'number'],
    ['))', 'punctuation.bracket'],
    [';', 'punctuation.delimiter'],
    ['if', 'keyword.control'],
    ['x', 'variable'],
    ['=', 'operator'],
    ['1', 'number'],
    ['then', 'keyword.control'],
    ['y', 'variable'],
    ['=', 'operator'],
    ['2', 'number'],
    [';', 'punctuation.delimiter'],
  ]);
  expect(tokenKinds('sas', 'TITLE2 "Sales"; footnote10 "x"; title9x;')).toEqual(
    [
      ['TITLE2', 'keyword'],
      ['"Sales"', 'string'],
      [';', 'punctuation.delimiter'],
      ['footnote10', 'keyword'],
      ['"x"', 'string'],
      [';', 'punctuation.delimiter'],
      ['title9x', 'variable'],
      [';', 'punctuation.delimiter'],
    ]
  );
  // a statement word before `=` at a statement start is an assigned variable
  expect(tokenKinds('sas', 'file = 1; file log;')).toEqual([
    ['file', 'variable'],
    ['=', 'operator'],
    ['1', 'number'],
    [';', 'punctuation.delimiter'],
    ['file', 'keyword'],
    ['log', 'variable'],
    [';', 'punctuation.delimiter'],
  ]);
  const tokens = tokenKinds('sas', samples.sas.code);
  for (const [text, kind] of [
    ['data', 'keyword.declaration'],
    ['run', 'keyword.declaration'],
    ['retain', 'keyword'],
    ['first', 'variable.special'],
    ['_n_', 'variable.special'],
    ['missing', 'function'],
    ['and', 'keyword.operator'],
    ['means', 'function'],
  ]) {
    expect(tokens).toContainEqual([text, kind]);
  }
});

test('sas: case-insensitive words, functions, and twins matched directly', () => {
  expect(tokenKinds('sas', 'DO WHILE(x < 3); Return; END;')).toEqual([
    ['DO WHILE', 'keyword.control'],
    ['(', 'punctuation.bracket'],
    ['x', 'variable'],
    ['<', 'operator'],
    ['3', 'number'],
    [')', 'punctuation.bracket'],
    [';', 'punctuation.delimiter'],
    ['Return', 'keyword.control'],
    [';', 'punctuation.delimiter'],
    ['END', 'keyword.control'],
    [';', 'punctuation.delimiter'],
  ]);
  // a statement word before a glued `(` is a call
  expect(tokenKinds('sas', 'x = put(d, date9.) || catx("-", a);')).toEqual([
    ['x', 'variable'],
    ['=', 'operator'],
    ['put', 'function'],
    ['(', 'punctuation.bracket'],
    ['d', 'variable'],
    [',', 'punctuation.delimiter'],
    ['date9.', 'type'],
    [')', 'punctuation.bracket'],
    ['||', 'operator'],
    ['catx', 'function'],
    ['(', 'punctuation.bracket'],
    ['"-"', 'string'],
    [',', 'punctuation.delimiter'],
    ['a', 'variable'],
    [')', 'punctuation.bracket'],
    [';', 'punctuation.delimiter'],
  ]);
});

test('sas: statement words are keywords only where a statement starts', () => {
  const code =
    'bmi = weight / height**2;\ntotal = sum + freq;\nvar weight;\nsum weight;\n' +
    'length x $10;\nn = length(name);\n';
  expect(tokenKinds('sas', code)).toEqual([
    ['bmi', 'variable'],
    ['=', 'operator'],
    ['weight', 'variable'],
    ['/', 'operator'],
    ['height', 'variable'],
    ['**', 'operator'],
    ['2', 'number'],
    [';', 'punctuation.delimiter'],
    ['total', 'variable'],
    ['=', 'operator'],
    ['sum', 'variable'],
    ['+', 'operator'],
    ['freq', 'variable'],
    [';', 'punctuation.delimiter'],
    ['var', 'keyword'],
    ['weight', 'variable'],
    [';', 'punctuation.delimiter'],
    ['sum', 'keyword'],
    ['weight', 'variable'],
    [';', 'punctuation.delimiter'],
    ['length', 'keyword'],
    ['x', 'variable'],
    ['$10', 'type'],
    [';', 'punctuation.delimiter'],
    ['n', 'variable'],
    ['=', 'operator'],
    ['length', 'function'],
    ['(', 'punctuation.bracket'],
    ['name', 'variable'],
    [')', 'punctuation.bracket'],
    [';', 'punctuation.delimiter'],
  ]);
  assertLineFedParity('sas', code);
});

test('sas: literals, formats, and missing values', () => {
  expect(
    tokenKinds('sas', 'd = \'01JAN2020\'d; n = \'my var\'n; s = "It""s";')
  ).toEqual([
    ['d', 'variable'],
    ['=', 'operator'],
    ["'01JAN2020'", 'string'],
    ['d', 'string.special'],
    [';', 'punctuation.delimiter'],
    ['n', 'variable'],
    ['=', 'operator'],
    ["'my var'", 'string'],
    ['n', 'string.special'],
    [';', 'punctuation.delimiter'],
    ['s', 'variable'],
    ['=', 'operator'],
    ['"It""s"', 'string'],
    [';', 'punctuation.delimiter'],
  ]);
  expect(
    tokenKinds('sas', 'length s $20; input a 8. b $char10.; x = .; y = .B;')
  ).toEqual([
    ['length', 'keyword'],
    ['s', 'variable'],
    ['$20', 'type'],
    [';', 'punctuation.delimiter'],
    ['input', 'keyword'],
    ['a', 'variable'],
    ['8.', 'number'],
    ['b', 'variable'],
    ['$char10.', 'type'],
    [';', 'punctuation.delimiter'],
    ['x', 'variable'],
    ['=', 'operator'],
    ['.', 'constant.builtin'],
    [';', 'punctuation.delimiter'],
    ['y', 'variable'],
    ['=', 'operator'],
    ['.B', 'constant.builtin'],
    [';', 'punctuation.delimiter'],
  ]);
});

test('sas: comment statements only start a statement', () => {
  expect(
    tokenKinds('sas', '* note: a * b;\nx = a * b; %* macro note;')
  ).toEqual([
    ['* note: a * b;', 'comment'],
    ['x', 'variable'],
    ['=', 'operator'],
    ['a', 'variable'],
    ['*', 'operator'],
    ['b', 'variable'],
    [';', 'punctuation.delimiter'],
    ['%* macro note;', 'comment'],
  ]);
  // a block comment keeps the statement start for a following `*`
  expect(tokenKinds('sas', 'run; /* a */ * b;')).toEqual([
    ['run', 'keyword.declaration'],
    [';', 'punctuation.delimiter'],
    ['/* a */ * b;', 'comment'],
  ]);
  for (const code of [
    '* first line\n  second line;\nx = 1;\n',
    '/* open\nstill */ * after;\ny = 2;\n',
    "s = 'one\ntwo'd;\n",
  ]) {
    assertLineFedParity('sas', code);
  }
});

test('sas: macro statements, calls, and variables', () => {
  expect(
    tokenKinds('sas', '%macro m(n);\n%put &&p&n.x &n.;\n%mend m;\n%m(2)')
  ).toEqual([
    ['%macro', 'keyword.declaration'],
    ['m', 'function.definition'],
    ['(', 'punctuation.bracket'],
    ['n', 'variable'],
    [')', 'punctuation.bracket'],
    [';', 'punctuation.delimiter'],
    ['%put', 'keyword'],
    ['&&p&n.', 'variable.special'],
    ['x', 'variable'],
    ['&n.', 'variable.special'],
    [';', 'punctuation.delimiter'],
    ['%mend', 'keyword.declaration'],
    ['m', 'function'],
    [';', 'punctuation.delimiter'],
    ['%m', 'function'],
    ['(', 'punctuation.bracket'],
    ['2', 'number'],
    [')', 'punctuation.bracket'],
  ]);
  // macro statement words need their `%`
  expect(tokenKinds('sas', 'let = local + 1;')).toEqual([
    ['let', 'variable'],
    ['=', 'operator'],
    ['local', 'variable'],
    ['+', 'operator'],
    ['1', 'number'],
    [';', 'punctuation.delimiter'],
  ]);
});

test('sas: data lines run to the line that holds a semicolon', () => {
  const code =
    'data a;\n  input x $ y;\n  cards;\nfoo if 1\nbar run 2\n;\nrun;\n' +
    'data b;\n  datalines4;\nx;y\n;;;;\nrun;\n';
  expect(tokenKinds('sas', code)).toEqual([
    ['data', 'keyword.declaration'],
    ['a', 'variable'],
    [';', 'punctuation.delimiter'],
    ['input', 'keyword'],
    ['x', 'variable'],
    ['$', 'type'],
    ['y', 'variable'],
    [';', 'punctuation.delimiter'],
    ['cards', 'keyword'],
    [';', 'punctuation.delimiter'],
    ['foo if 1', 'string'],
    ['bar run 2', 'string'],
    [';', 'punctuation.delimiter'],
    ['run', 'keyword.declaration'],
    [';', 'punctuation.delimiter'],
    ['data', 'keyword.declaration'],
    ['b', 'variable'],
    [';', 'punctuation.delimiter'],
    ['datalines4', 'keyword'],
    [';', 'punctuation.delimiter'],
    ['x;y', 'string'],
    [';;;;', 'punctuation.delimiter'],
    ['run', 'keyword.declaration'],
    [';', 'punctuation.delimiter'],
  ]);
  assertLineFedParity('sas', code);
  assertLineFedParity('sas', code.replaceAll('\n', '\r\n'));
});
