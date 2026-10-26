import { expect, test } from 'bun:test';

import { samples } from './_samples';
import { assertLineFedParity, tokenKinds } from './_util';

test('stata: commands start lines and prefixes; arguments stay names', () => {
  expect(
    tokenKinds('stata', 'by id, sort: gen count = _n\nesttab m1 using t.tex')
  ).toEqual([
    ['by', 'keyword'],
    ['id', 'variable'],
    [',', 'punctuation.delimiter'],
    ['sort', 'variable.parameter'],
    [':', 'punctuation.delimiter'],
    ['gen', 'keyword'],
    ['count', 'variable'],
    ['=', 'operator'],
    ['_n', 'variable.special'],
    ['esttab', 'keyword'],
    ['m1', 'variable'],
    ['using', 'keyword'],
    ['t', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['tex', 'variable'],
  ]);
  // an unknown command is a user program; `if` and `in` qualify it
  expect(tokenKinds('stata', 'cap noi mycmd x if y > 1 in 1/5')).toEqual([
    ['cap noi', 'keyword'],
    ['mycmd', 'function'],
    ['x', 'variable'],
    ['if', 'keyword.control'],
    ['y', 'variable'],
    ['>', 'operator'],
    ['1', 'number'],
    ['in', 'keyword'],
    ['1', 'number'],
    ['/', 'operator'],
    ['5', 'number'],
  ]);
  const tokens = tokenKinds('stata', samples.stata.code);
  for (const [text, kind] of [
    ['sysuse', 'keyword'],
    ['clear', 'variable.parameter'],
    ['log', 'function'],
    ['bysort', 'keyword'],
    ['egen', 'keyword'],
    ['foreach', 'keyword.control'],
    ['tabby', 'function.definition'],
    ['rclass', 'variable.parameter'],
  ]) {
    expect(tokens).toContainEqual([text, kind]);
  }
});

test('stata: macros, factor variables, and missing values', () => {
  expect(
    tokenKinds(
      'stata',
      "reg y `x' ${g} $h i.a ib2.b L2.c, robust\nreplace z = .b"
    )
  ).toEqual([
    ['reg', 'keyword'],
    ['y', 'variable'],
    ["`x' ${g} $h", 'variable.special'],
    ['i.', 'keyword.operator'],
    ['a', 'variable'],
    ['ib2.', 'keyword.operator'],
    ['b', 'variable'],
    ['L2.', 'keyword.operator'],
    ['c', 'variable'],
    [',', 'punctuation.delimiter'],
    ['robust', 'variable.parameter'],
    ['replace', 'keyword'],
    ['z', 'variable'],
    ['=', 'operator'],
    ['.b', 'constant.builtin'],
  ]);
  expect(tokenKinds('stata', "di `n`i''")).toEqual([
    ['di', 'keyword'],
    ["`n`i''", 'variable.special'],
  ]);
});

test('stata: strings expand macros and compound strings nest', () => {
  expect(tokenKinds('stata', 'di "a `b\' \\$c $d"')).toEqual([
    ['di', 'keyword'],
    ['"a', 'string'],
    ["`b'", 'variable.special'],
    ['\\$', 'string.escape'],
    ['c', 'string'],
    ['$d', 'variable.special'],
    ['"', 'string'],
  ]);
  expect(tokenKinds('stata', 'di `"x "y" `"z"\' w"\' + 1')).toEqual([
    ['di', 'keyword'],
    ['`"x "y" `"z"\' w"\'', 'string'],
    ['+', 'operator'],
    ['1', 'number'],
  ]);
  // an unclosed string or macro ends at its line
  expect(tokenKinds('stata', 'di "open `m\ngen x = 1')).toEqual([
    ['di', 'keyword'],
    ['"open', 'string'],
    ['`m', 'variable.special'],
    ['gen', 'keyword'],
    ['x', 'variable'],
    ['=', 'operator'],
    ['1', 'number'],
  ]);
});

test('stata: comments, continuations, and programs', () => {
  const code =
    '* note\nsum x // tail\nreg y x, ///\n  robust\n\n  gen\n/* a\n/* b */ c */ list\n' +
    'program define p\nprogram drop q\n';
  expect(tokenKinds('stata', code)).toEqual([
    ['* note', 'comment'],
    ['sum', 'keyword'],
    ['x', 'variable'],
    ['// tail', 'comment'],
    ['reg', 'keyword'],
    ['y x', 'variable'],
    [',', 'punctuation.delimiter'],
    ['///', 'comment'],
    ['robust', 'variable.parameter'],
    ['gen', 'keyword'],
    ['/* a', 'comment'],
    ['/* b */ c */', 'comment'],
    ['list', 'keyword'],
    ['program define', 'keyword.declaration'],
    ['p', 'function.definition'],
    ['program', 'keyword.declaration'],
    ['drop', 'keyword'],
    ['q', 'variable'],
  ]);
  // `//` needs a blank before it; `*` is a comment only at a command start
  expect(tokenKinds('stata', 'gen y = a*b')).toEqual([
    ['gen', 'keyword'],
    ['y', 'variable'],
    ['=', 'operator'],
    ['a', 'variable'],
    ['*', 'operator'],
    ['b', 'variable'],
  ]);
  assertLineFedParity('stata', code);
  assertLineFedParity('stata', code.replaceAll('\n', '\r\n'));
  assertLineFedParity('stata', 'reg y ///\n\n x\n');
});
