import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('tcl: commands, arguments, and comments only where a command starts', () => {
  expect(
    tokenKinds(
      'tcl',
      'set x 1 # not a comment ;# note\nmy_cmd -opt $arr(k) $::ns::v'
    )
  ).toEqual([
    ['set', 'keyword.declaration'],
    ['x', 'variable'],
    ['1', 'number'],
    ['# not a comment', null],
    [';', 'punctuation.delimiter'],
    ['# note', 'comment'],
    ['my_cmd', 'function'],
    ['-opt', null],
    ['$arr', 'variable'],
    ['(', 'punctuation.bracket'],
    ['k', null],
    [')', 'punctuation.bracket'],
    ['$::ns::v', 'variable'],
  ]);
});

test('tcl: substitutions inside quoted words return to the string', () => {
  expect(
    tokenKinds('tcl', 'puts "a $b ${c d} [format "%d" $n] e\\n$"')
  ).toEqual([
    ['puts', 'keyword'],
    ['"a', 'string'],
    ['$b', 'variable'],
    ['${c d}', 'variable'],
    ['[', 'punctuation.bracket'],
    ['format', 'keyword'],
    ['"%d"', 'string'],
    ['$n', 'variable'],
    [']', 'punctuation.bracket'],
    ['e', 'string'],
    ['\\n', 'string.escape'],
    ['$"', 'string'],
  ]);
  // a quote inside a word is literal
  expect(tokenKinds('tcl', 'puts a"b')).toEqual([
    ['puts', 'keyword'],
    ['a"b', null],
  ]);
});

test('tcl: procedures, parameters, and script bodies', () => {
  expect(
    tokenKinds(
      'tcl',
      'proc ::app::greet {name {greeting "Hi"}} {\n  if {$name eq ""} {return} else { log $name }\n  set l {a b}\n}'
    )
  ).toEqual([
    ['proc', 'keyword.declaration'],
    ['::app::greet', 'function.definition'],
    ['{', 'punctuation.bracket'],
    ['name', 'variable.parameter'],
    ['{', 'punctuation.bracket'],
    ['greeting', 'variable.parameter'],
    ['"Hi"', 'string'],
    ['}} {', 'punctuation.bracket'],
    ['if', 'keyword.control'],
    ['{', 'punctuation.bracket'],
    ['$name', 'variable'],
    ['eq', 'keyword.operator'],
    ['""', 'string'],
    ['} {', 'punctuation.bracket'],
    ['return', 'keyword.control'],
    ['}', 'punctuation.bracket'],
    ['else', 'keyword.control'],
    ['{', 'punctuation.bracket'],
    ['log', 'function'],
    ['$name', 'variable'],
    ['}', 'punctuation.bracket'],
    ['set', 'keyword.declaration'],
    ['l', 'variable'],
    ['{', 'punctuation.bracket'],
    ['a b', null],
    ['}', 'punctuation.bracket'],
    ['}', 'punctuation.bracket'],
  ]);
});

test('tcl: multi-line strings and continued commands stream by line', () => {
  const code = 'set s "one\ntwo [incr n]\nthree"\nrun \\\n  arg\nnext\n';
  expect(tokenKinds('tcl', code)).toEqual([
    ['set', 'keyword.declaration'],
    ['s', 'variable'],
    ['"one', 'string'],
    ['two', 'string'],
    ['[', 'punctuation.bracket'],
    ['incr', 'keyword'],
    ['n', 'variable'],
    [']', 'punctuation.bracket'],
    ['three"', 'string'],
    ['run', 'function'],
    ['\\', 'string.escape'],
    ['arg', null],
    ['next', 'function'],
  ]);
  assertLineFedParity('tcl', code);
});
