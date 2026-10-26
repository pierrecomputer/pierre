import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('gnuplot: commands, set options with axis prefixes, and modifiers', () => {
  expect(
    tokenKinds(
      'gnuplot',
      'set xlabel "x" font ",12"\nunset mytics\nset cbrange [0:1]\nshow version'
    )
  ).toEqual([
    ['set', 'keyword'],
    ['xlabel', 'property'],
    ['"x"', 'string'],
    ['font', 'attribute'],
    ['",12"', 'string'],
    ['unset', 'keyword'],
    ['mytics', 'property'],
    ['set', 'keyword'],
    ['cbrange', 'property'],
    ['[', 'punctuation.bracket'],
    ['0', 'number'],
    [':', 'punctuation.delimiter'],
    ['1', 'number'],
    [']', 'punctuation.bracket'],
    ['show', 'keyword'],
    ['version', 'variable'],
  ]);
});

test('gnuplot: plot commands take one-letter modifiers and styles', () => {
  expect(
    tokenKinds('gnuplot', 'plot t, sin(t) w l, f(x) u 1:2 t \'a\' lc rgb "red"')
  ).toEqual([
    ['plot', 'keyword'],
    ['t', 'variable'],
    [',', 'punctuation.delimiter'],
    ['sin', 'function'],
    ['(', 'punctuation.bracket'],
    ['t', 'variable'],
    [')', 'punctuation.bracket'],
    ['w l', 'attribute'],
    [',', 'punctuation.delimiter'],
    ['f', 'function'],
    ['(', 'punctuation.bracket'],
    ['x', 'variable'],
    [')', 'punctuation.bracket'],
    ['u', 'attribute'],
    ['1', 'number'],
    [':', 'punctuation.delimiter'],
    ['2', 'number'],
    ['t', 'attribute'],
    ["'a'", 'string'],
    ['lc rgb', 'attribute'],
    ['"red"', 'string'],
  ]);
  expect(tokenKinds('gnuplot', 'plot $1 with linespoints')).toEqual([
    ['plot', 'keyword'],
    ['$1', 'variable.special'],
    ['with', 'attribute'],
    ['linespoints', 'constant'],
  ]);
});

test('gnuplot: function definitions, control flow, and statements', () => {
  expect(
    tokenKinds(
      'gnuplot',
      'g(x,y) = x**2 + y # sum\nif (pi > 1) {\n  b = 2; print `date`\n} else { exit }'
    )
  ).toEqual([
    ['g', 'function.definition'],
    ['(', 'punctuation.bracket'],
    ['x', 'variable.parameter'],
    [',', 'punctuation.delimiter'],
    ['y', 'variable.parameter'],
    [')', 'punctuation.bracket'],
    ['=', 'operator'],
    ['x', 'variable'],
    ['**', 'operator'],
    ['2', 'number'],
    ['+', 'operator'],
    ['y', 'variable'],
    ['# sum', 'comment'],
    ['if', 'keyword.control'],
    ['(', 'punctuation.bracket'],
    ['pi', 'constant.builtin'],
    ['>', 'operator'],
    ['1', 'number'],
    [') {', 'punctuation.bracket'],
    ['b', 'variable'],
    ['=', 'operator'],
    ['2', 'number'],
    [';', 'punctuation.delimiter'],
    ['print', 'keyword'],
    ['`date`', 'string.special'],
    ['}', 'punctuation.bracket'],
    ['else', 'keyword.control'],
    ['{', 'punctuation.bracket'],
    ['exit', 'keyword'],
    ['}', 'punctuation.bracket'],
  ]);
});

test('gnuplot: datablocks and continued lines span lines', () => {
  const code = '$d << END\nplot x\nEND\nplot $d \\\n  w l\nset title "a\\tb"\n';
  expect(tokenKinds('gnuplot', code)).toEqual([
    ['$d', 'variable.special'],
    ['<<', 'operator'],
    ['END', 'constant'],
    ['plot x', 'string'],
    ['END', 'string'],
    ['plot', 'keyword'],
    ['$d', 'variable.special'],
    ['\\', 'punctuation.special'],
    ['w l', 'attribute'],
    ['set', 'keyword'],
    ['title', 'property'],
    ['"a', 'string'],
    ['\\t', 'string.escape'],
    ['b"', 'string'],
  ]);
  assertLineFedParity('gnuplot', code);
  assertLineFedParity('gnuplot', '$d << EOD\n1 2\nplot x\n');
});
