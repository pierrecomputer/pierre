import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('smalltalk: messages, receivers, and pseudo-variables', () => {
  expect(
    tokenKinds(
      'smalltalk',
      'x := Array new: 3.\nx at: 1 put: self; yourself.\n^super foo isNil & true | thisContext'
    )
  ).toEqual([
    ['x', 'variable'],
    [':=', 'operator'],
    ['Array', 'type'],
    ['new:', 'function'],
    ['3', 'number'],
    ['.', 'punctuation.delimiter'],
    ['x', 'variable'],
    ['at:', 'function'],
    ['1', 'number'],
    ['put:', 'function'],
    ['self', 'variable.special'],
    [';', 'punctuation.delimiter'],
    ['yourself', 'function'],
    ['.', 'punctuation.delimiter'],
    ['^', 'keyword.control'],
    ['super', 'variable.special'],
    ['foo isNil', 'function'],
    ['&', 'operator'],
    ['true', 'boolean'],
    ['|', 'operator'],
    ['thisContext', 'variable.special'],
  ]);
  expect(tokenKinds('smalltalk', 'x _ nil')).toEqual([
    ['x', 'variable'],
    ['_', 'operator'],
    ['nil', 'constant.builtin'],
  ]);
});

test('smalltalk: literals', () => {
  expect(
    tokenKinds(
      'smalltalk',
      "#(1 $a foo bar: #baz (x)) , #[1 2] , #+ , #at:put: , #'a b' , 16r1F , 1.5e-3 , 1.5s2 , -2"
    )
  ).toEqual([
    ['#(', 'punctuation.bracket'],
    ['1', 'number'],
    ['$a', 'string'],
    ['foo bar: #baz', 'string.special.symbol'],
    ['(', 'punctuation.bracket'],
    ['x', 'string.special.symbol'],
    ['))', 'punctuation.bracket'],
    [',', 'operator'],
    ['#[', 'punctuation.bracket'],
    ['1 2', 'number'],
    [']', 'punctuation.bracket'],
    [',', 'operator'],
    ['#+', 'string.special.symbol'],
    [',', 'operator'],
    ['#at:put:', 'string.special.symbol'],
    [',', 'operator'],
    ["#'a b'", 'string.special.symbol'],
    [',', 'operator'],
    ['16r1F', 'number'],
    [',', 'operator'],
    ['1.5e-3', 'number'],
    [',', 'operator'],
    ['1.5s2', 'number'],
    [',', 'operator'],
    ['-2', 'number'],
  ]);
});

test('smalltalk: blocks, temporaries, pragmas, and chunks', () => {
  expect(
    tokenKinds(
      'smalltalk',
      "!Foo methodsFor: 'x'!\nbar: arg\n  | a b |\n  <primitive: 60>\n  ^[:x | x + a] value: arg\n! !"
    )
  ).toEqual([
    ['!', 'punctuation.special'],
    ['Foo', 'type'],
    ['methodsFor:', 'function'],
    ["'x'", 'string'],
    ['!', 'punctuation.special'],
    ['bar:', 'function'],
    ['arg', 'variable'],
    ['|', 'punctuation.delimiter'],
    ['a b', 'variable'],
    ['|', 'punctuation.delimiter'],
    ['<', 'punctuation.bracket'],
    ['primitive:', 'attribute'],
    ['60', 'number'],
    ['>', 'punctuation.bracket'],
    ['^', 'keyword.control'],
    ['[', 'punctuation.bracket'],
    [':x', 'variable.parameter'],
    ['|', 'punctuation.delimiter'],
    ['x', 'variable'],
    ['+', 'operator'],
    ['a', 'variable'],
    [']', 'punctuation.bracket'],
    ['value:', 'function'],
    ['arg', 'variable'],
    ['! !', 'punctuation.special'],
  ]);
});

test('smalltalk: GNU class bodies and method definitions', () => {
  expect(
    tokenKinds(
      'smalltalk',
      "Object subclass: Animal [\n  <comment: 'x'>\n  speak [ ^1 ]\n]\nAnimal >> name: aName [ ]\nAnimal class >> new [ ]"
    )
  ).toEqual([
    ['Object', 'type'],
    ['subclass:', 'function'],
    ['Animal', 'type'],
    ['[', 'punctuation.bracket'],
    ['<', 'punctuation.bracket'],
    ['comment:', 'attribute'],
    ["'x'", 'string'],
    ['>', 'punctuation.bracket'],
    ['speak', 'variable'],
    ['[', 'punctuation.bracket'],
    ['^', 'keyword.control'],
    ['1', 'number'],
    [']', 'punctuation.bracket'],
    [']', 'punctuation.bracket'],
    ['Animal', 'type'],
    ['>>', 'operator'],
    ['name:', 'function.definition'],
    ['aName', 'variable'],
    ['[ ]', 'punctuation.bracket'],
    ['Animal', 'type'],
    ['class', 'function'],
    ['>>', 'operator'],
    ['new', 'function.definition'],
    ['[ ]', 'punctuation.bracket'],
  ]);
});

test('smalltalk: comments and strings span lines', () => {
  const code = "\"a\n<&> b\" x := 'it''s\nnext'. y";
  expect(tokenKinds('smalltalk', code)).toEqual([
    ['"a', 'comment'],
    ['<&> b"', 'comment'],
    ['x', 'variable'],
    [':=', 'operator'],
    ["'it''s", 'string'],
    ["next'", 'string'],
    ['.', 'punctuation.delimiter'],
    ['y', 'variable'],
  ]);
  assertLineFedParity('smalltalk', code);
  assertLineFedParity('smalltalk', '#(a\n(b\n c) d) e.\n| t\n u |\n');
});
