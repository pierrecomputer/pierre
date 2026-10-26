import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('applescript: tell blocks, assignments, and properties', () => {
  expect(
    tokenKinds(
      'applescript',
      'tell application "Finder"\n  set n to name of window 1\nend tell'
    )
  ).toEqual([
    ['tell', 'keyword.control'],
    ['application', 'type.builtin'],
    ['"Finder"', 'string'],
    ['set', 'keyword.declaration'],
    ['n', 'variable'],
    ['to', 'keyword'],
    ['name', 'property'],
    ['of', 'keyword'],
    ['window', 'type.builtin'],
    ['1', 'number'],
    ['end tell', 'keyword.control'],
  ]);
  // keywords ignore case
  expect(tokenKinds('applescript', 'SET X TO {Name:"a"} AS Record')).toEqual([
    ['SET', 'keyword.declaration'],
    ['X', 'variable'],
    ['TO', 'keyword'],
    ['{', 'punctuation.bracket'],
    ['Name', 'property'],
    [':', 'punctuation.delimiter'],
    ['"a"', 'string'],
    ['}', 'punctuation.bracket'],
    ['AS', 'keyword.operator'],
    ['Record', 'type.builtin'],
  ]);
});

test('applescript: handlers, parameters, and loop variables', () => {
  expect(
    tokenKinds(
      'applescript',
      'on greet(who, n)\n  repeat with i from 1 to n\n    log who\n  end repeat\nend greet\non run\n  greet("x", 2)\nend run'
    )
  ).toEqual([
    ['on', 'keyword.declaration'],
    ['greet', 'function.definition'],
    ['(', 'punctuation.bracket'],
    ['who', 'variable.parameter'],
    [',', 'punctuation.delimiter'],
    ['n', 'variable.parameter'],
    [')', 'punctuation.bracket'],
    ['repeat', 'keyword.control'],
    ['with', 'keyword'],
    ['i', 'variable'],
    ['from', 'keyword'],
    ['1', 'number'],
    ['to', 'keyword'],
    ['n', null],
    ['log', 'function'],
    ['who', null],
    ['end repeat', 'keyword.control'],
    ['end', 'keyword.control'],
    ['greet', 'function.definition'],
    ['on', 'keyword.declaration'],
    ['run', 'function.definition'],
    ['greet', 'function'],
    ['(', 'punctuation.bracket'],
    ['"x"', 'string'],
    [',', 'punctuation.delimiter'],
    ['2', 'number'],
    [')', 'punctuation.bracket'],
    ['end', 'keyword.control'],
    ['run', 'function.definition'],
  ]);
  expect(
    tokenKinds(
      'applescript',
      'try\n  error "x" number 5\non error msg number num\nend try'
    )
  ).toEqual([
    ['try', 'keyword.control'],
    ['error', 'keyword.control'],
    ['"x"', 'string'],
    ['number', 'type.builtin'],
    ['5', 'number'],
    ['on', 'keyword.declaration'],
    ['error', 'keyword.control'],
    ['msg', 'variable.parameter'],
    ['number', 'type.builtin'],
    ['num', 'variable.parameter'],
    ['end try', 'keyword.control'],
  ]);
});

test('applescript: word operators, constants, and special tokens', () => {
  expect(
    tokenKinds(
      'applescript',
      "if x isn't missing value and my y ≠ 2 then return «class pnam» & |a b| & window's name"
    )
  ).toEqual([
    ['if', 'keyword.control'],
    ['x', null],
    ["isn't", 'keyword.operator'],
    ['missing value', 'constant.builtin'],
    ['and', 'keyword.operator'],
    ['my', 'variable.special'],
    ['y', null],
    ['≠', 'operator'],
    ['2', 'number'],
    ['then return', 'keyword.control'],
    ['«class pnam»', 'constant'],
    ['&', 'operator'],
    ['|a b|', 'variable'],
    ['&', 'operator'],
    ['window', 'type.builtin'],
    ["'s", 'keyword.operator'],
    ['name', null],
  ]);
  expect(
    tokenKinds('applescript', 'do shell script "ls \\"x\\"" -- list\n# done')
  ).toEqual([
    ['do shell script', 'function'],
    ['"ls', 'string'],
    ['\\"', 'string.escape'],
    ['x', 'string'],
    ['\\"', 'string.escape'],
    ['"', 'string'],
    ['-- list', 'comment'],
    ['# done', 'comment'],
  ]);
});

test('applescript: nested comments, strings, and `¬` joins span lines', () => {
  expect(tokenKinds('applescript', 'set a to ¬\n  1\nto b()')).toEqual([
    ['set', 'keyword.declaration'],
    ['a', 'variable'],
    ['to', 'keyword'],
    ['¬', 'punctuation.special'],
    ['1', 'number'],
    // a handler starts only at the start of a statement
    ['to', 'keyword.declaration'],
    ['b', 'function.definition'],
    ['()', 'punctuation.bracket'],
  ]);
  for (const code of [
    '(* a (* b *)\nc *) set x to 1\n',
    'set s to "one\ntwo" & "\\\nthree"\n',
    'set x to ¬\r\n  to\r\non foo ¬\n  (a)\n',
  ]) {
    assertLineFedParity('applescript', code);
  }
});
