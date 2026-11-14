import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('apl: comments, strings, and numbers with high minus', () => {
  expect(
    tokenKinds('apl', "⍝ note\nx←1 ¯2.5E¯3 3J¯4 .5\ns←'it''s' \"dq\" 'open")
  ).toEqual([
    ['⍝ note', 'comment'],
    ['x', null],
    ['←', 'keyword'],
    ['1 ¯2.5E¯3 3J¯4 .5', 'number'],
    ['s', null],
    ['←', 'keyword'],
    ["'it''s' \"dq\" 'open", 'string'],
  ]);
  // `E` without a digit after it starts a name
  expect(tokenKinds('apl', '2E x')).toEqual([
    ['2', 'number'],
    ['E x', null],
  ]);
});

test('apl: primitive functions, operators, and special names', () => {
  expect(tokenKinds('apl', 'z←+/⍳3 ⋄ r←×⍨¨⌽⍵∘.≤⍺')).toEqual([
    ['z', null],
    ['←', 'keyword'],
    ['+', 'operator'],
    ['/', 'keyword.operator'],
    ['⍳', 'operator'],
    ['3', 'number'],
    ['⋄', 'punctuation.delimiter'],
    ['r', null],
    ['←', 'keyword'],
    ['×', 'operator'],
    ['⍨¨', 'keyword.operator'],
    ['⌽', 'operator'],
    ['⍵', 'variable.special'],
    ['∘', 'keyword.operator'],
    ['.≤', 'operator'],
    ['⍺', 'variable.special'],
  ]);
  expect(tokenKinds('apl', '⎕←⎕IO ⍬\n→done\nα∆b1←2')).toEqual([
    ['⎕', 'constant.builtin'],
    ['←', 'keyword'],
    ['⎕IO ⍬', 'constant.builtin'],
    ['→', 'keyword.control'],
    ['done', null],
    ['α∆b1', null],
    ['←', 'keyword'],
    ['2', 'number'],
  ]);
});

test('apl: dfns, control words, guards, and labels', () => {
  expect(
    tokenKinds('apl', 'fact←{⍵≤1:1 ⋄ ⍵×∇ ⍵-1}\n:For i :In x\nloop: :EndFor')
  ).toEqual([
    ['fact', 'function.definition'],
    ['←', 'keyword'],
    ['{', 'punctuation.bracket'],
    ['⍵', 'variable.special'],
    ['≤', 'operator'],
    ['1', 'number'],
    [':', 'keyword.control'],
    ['1', 'number'],
    ['⋄', 'punctuation.delimiter'],
    ['⍵', 'variable.special'],
    ['×', 'operator'],
    ['∇ ⍵', 'variable.special'],
    ['-', 'operator'],
    ['1', 'number'],
    ['}', 'punctuation.bracket'],
    [':For', 'keyword.control'],
    ['i', null],
    [':In', 'keyword.control'],
    ['x', null],
    ['loop:', 'label'],
    [':EndFor', 'keyword.control'],
  ]);
  const code = '∇ r←Foo x\n  :If x>0\n    r←x\n  :EndIf\n∇\n';
  expect(tokenKinds('apl', code)).toEqual([
    ['∇', 'variable.special'],
    ['r', null],
    ['←', 'keyword'],
    ['Foo x', null],
    [':If', 'keyword.control'],
    ['x', null],
    ['>', 'operator'],
    ['0', 'number'],
    ['r', null],
    ['←', 'keyword'],
    ['x', null],
    [':EndIf', 'keyword.control'],
    ['∇', 'variable.special'],
  ]);
  assertLineFedParity('apl', code);
});
