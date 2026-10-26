import { expect, test } from 'bun:test';

import { samples } from './_samples';
import { assertLineFedParity, tokenKinds } from './_util';

test('openscad: modules, functions, imports, and special variables', () => {
  expect(
    tokenKinds('openscad', 'use <lib/gears.scad>\nmodule gear(teeth = 12) {}\n')
  ).toEqual([
    ['use', 'keyword.import'],
    ['<lib/gears.scad>', 'string'],
    ['module', 'keyword.declaration'],
    ['gear', 'function.definition'],
    ['(', 'punctuation.bracket'],
    ['teeth', 'variable.parameter'],
    ['=', 'operator'],
    ['12', 'number'],
    [') {}', 'punctuation.bracket'],
  ]);
  expect(
    tokenKinds('openscad', 'function f(x) = x == 0 ? undef : PI;')
  ).toEqual([
    ['function', 'keyword.declaration'],
    ['f', 'function.definition'],
    ['(', 'punctuation.bracket'],
    ['x', 'variable'],
    [')', 'punctuation.bracket'],
    ['=', 'operator'],
    ['x', 'variable'],
    ['==', 'operator'],
    ['0', 'number'],
    ['?', 'operator'],
    ['undef', 'constant.builtin'],
    [':', 'punctuation.delimiter'],
    ['PI', 'constant.builtin'],
    [';', 'punctuation.delimiter'],
  ]);
  const tokens = tokenKinds('openscad', samples.openscad.code);
  for (const [text, kind] of [
    ['include', 'keyword.import'],
    ['$fn', 'variable.special'],
    ['cube', 'function'],
    ['translate', 'function'],
    ['for', 'keyword.control'],
    ['echo', 'keyword.control'],
    ['false', 'boolean'],
    ['/** Wall size in mm,', 'comment.doc'],
  ]) {
    expect(tokens).toContainEqual([text, kind]);
  }
});

test('openscad: modifiers before statements, operators in expressions', () => {
  expect(
    tokenKinds('openscad', '#cube(1); %a(); !b(); *c();\nx = y * 2 % 3;')
  ).toEqual([
    ['#', 'punctuation.special'],
    ['cube', 'function'],
    ['(', 'punctuation.bracket'],
    ['1', 'number'],
    [')', 'punctuation.bracket'],
    [';', 'punctuation.delimiter'],
    ['%', 'punctuation.special'],
    ['a', 'function'],
    ['()', 'punctuation.bracket'],
    [';', 'punctuation.delimiter'],
    ['!', 'punctuation.special'],
    ['b', 'function'],
    ['()', 'punctuation.bracket'],
    [';', 'punctuation.delimiter'],
    ['*', 'punctuation.special'],
    ['c', 'function'],
    ['()', 'punctuation.bracket'],
    [';', 'punctuation.delimiter'],
    ['x', 'variable'],
    ['=', 'operator'],
    ['y', 'variable'],
    ['*', 'operator'],
    ['2', 'number'],
    ['%', 'operator'],
    ['3', 'number'],
    [';', 'punctuation.delimiter'],
  ]);
  // `= !` is one run of operators: the `!` negates
  expect(tokenKinds('openscad', 'b = !c;')).toContainEqual(['= !', 'operator']);
  // after a transform call, a modifier applies to the child statement
  expect(tokenKinds('openscad', 'rotate([0, a * 2]) *cube();')).toContainEqual([
    '*',
    'punctuation.special',
  ]);
  expect(tokenKinds('openscad', 'rotate([0, a * 2]) *cube();')).toContainEqual([
    '*',
    'operator',
  ]);
});

test('openscad: strings and comments span lines in a stream', () => {
  expect(tokenKinds('openscad', 'echo("a\\tb \\"c\\"");')).toEqual([
    ['echo', 'keyword.control'],
    ['(', 'punctuation.bracket'],
    ['"a', 'string'],
    ['\\t', 'string.escape'],
    ['b', 'string'],
    ['\\"', 'string.escape'],
    ['c', 'string'],
    ['\\"', 'string.escape'],
    ['"', 'string'],
    [')', 'punctuation.bracket'],
    [';', 'punctuation.delimiter'],
  ]);
  for (const code of [
    'x = "one\ntwo";\n*cube();\n',
    '/* a\n b */ %cube();\n',
    'cube([1,\n  2 * 3]);\nv = [\n  1 % 2];\n#sphere();\n',
    'module m()\n  cube();\n',
    samples.openscad.code,
  ]) {
    assertLineFedParity('openscad', code);
    assertLineFedParity('openscad', code.replaceAll('\n', '\r\n'));
  }
});
