import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('move: module heads, imports, and abilities', () => {
  expect(tokenKinds('move', 'module 0x1::coin {')).toEqual([
    ['module', 'keyword.declaration'],
    ['0x1', 'number'],
    ['::', 'punctuation.delimiter'],
    ['coin', 'namespace'],
    ['{', 'punctuation.bracket'],
  ]);
  expect(tokenKinds('move', 'use sui::coin::{Self, Coin};')).toEqual([
    ['use', 'keyword.import'],
    ['sui', 'namespace'],
    ['::', 'punctuation.delimiter'],
    ['coin', 'namespace'],
    ['::', 'punctuation.delimiter'],
    ['{', 'punctuation.bracket'],
    ['Self', 'variable.special'],
    [',', 'punctuation.delimiter'],
    ['Coin', 'type'],
    ['}', 'punctuation.bracket'],
    [';', 'punctuation.delimiter'],
  ]);
  expect(
    tokenKinds(
      'move',
      'struct Coin<phantom T> has copy, drop, store { value: u64 }'
    )
  ).toEqual([
    ['struct', 'keyword.declaration'],
    ['Coin', 'type'],
    ['<', 'operator'],
    ['phantom', 'keyword'],
    ['T', 'type'],
    ['>', 'operator'],
    ['has', 'keyword'],
    ['copy', 'type.builtin'],
    [',', 'punctuation.delimiter'],
    ['drop', 'type.builtin'],
    [',', 'punctuation.delimiter'],
    ['store', 'type.builtin'],
    ['{', 'punctuation.bracket'],
    ['value', 'variable'],
    [':', 'punctuation.delimiter'],
    ['u64', 'type.builtin'],
    ['}', 'punctuation.bracket'],
  ]);
});

test('move: functions, calls, macros, and builtins', () => {
  expect(
    tokenKinds(
      'move',
      'public entry fun mint<T: drop>(s: &signer) acquires Coin {'
    )
  ).toEqual([
    ['public entry', 'keyword'],
    ['fun', 'keyword.declaration'],
    ['mint', 'function.definition'],
    ['<', 'operator'],
    ['T', 'type'],
    [':', 'punctuation.delimiter'],
    ['drop', 'variable'],
    ['>', 'operator'],
    ['(', 'punctuation.bracket'],
    ['s', 'variable'],
    [':', 'punctuation.delimiter'],
    ['&', 'operator'],
    ['signer', 'type.builtin'],
    [')', 'punctuation.bracket'],
    ['acquires', 'keyword'],
    ['Coin', 'type'],
    ['{', 'punctuation.bracket'],
  ]);
  expect(
    tokenKinds('move', 'let v = vector::empty<u64>(); assert!(x == 1, E_BAD);')
  ).toEqual([
    ['let', 'keyword.declaration'],
    ['v', 'variable'],
    ['=', 'operator'],
    ['vector', 'type.builtin'],
    ['::', 'punctuation.delimiter'],
    ['empty', 'function'],
    ['<', 'operator'],
    ['u64', 'type.builtin'],
    ['>', 'operator'],
    ['()', 'punctuation.bracket'],
    [';', 'punctuation.delimiter'],
    ['assert', 'function'],
    ['!', 'operator'],
    ['(', 'punctuation.bracket'],
    ['x', 'variable'],
    ['==', 'operator'],
    ['1', 'number'],
    [',', 'punctuation.delimiter'],
    ['E_BAD', 'constant'],
    [')', 'punctuation.bracket'],
    [';', 'punctuation.delimiter'],
  ]);
  expect(
    tokenKinds(
      'move',
      'borrow_global_mut<Coin>(addr).value = 1; move_to(a, x);'
    )
  ).toEqual([
    ['borrow_global_mut', 'function'],
    ['<', 'operator'],
    ['Coin', 'type'],
    ['>', 'operator'],
    ['(', 'punctuation.bracket'],
    ['addr', 'variable'],
    [')', 'punctuation.bracket'],
    ['.', 'punctuation.delimiter'],
    ['value', 'property'],
    ['=', 'operator'],
    ['1', 'number'],
    [';', 'punctuation.delimiter'],
    ['move_to', 'function'],
    ['(', 'punctuation.bracket'],
    ['a', 'variable'],
    [',', 'punctuation.delimiter'],
    ['x', 'variable'],
    [')', 'punctuation.bracket'],
    [';', 'punctuation.delimiter'],
  ]);
  expect(
    tokenKinds('move', 'macro fun apply($f: |u8| -> u8) { $f(1) }')
  ).toEqual([
    ['macro', 'keyword'],
    ['fun', 'keyword.declaration'],
    ['apply', 'function.definition'],
    ['(', 'punctuation.bracket'],
    ['$f', 'variable'],
    [':', 'punctuation.delimiter'],
    ['|', 'operator'],
    ['u8', 'type.builtin'],
    ['| ->', 'operator'],
    ['u8', 'type.builtin'],
    [') {', 'punctuation.bracket'],
    ['$f', 'function'],
    ['(', 'punctuation.bracket'],
    ['1', 'number'],
    [') }', 'punctuation.bracket'],
  ]);
});

test('move: attributes, addresses, byte strings, and labels', () => {
  expect(tokenKinds('move', '#[test(a = @0xA, b = @std)]\nfun t() {}')).toEqual(
    [
      ['#[test', 'attribute'],
      ['(', 'punctuation.bracket'],
      ['a', 'variable'],
      ['=', 'operator'],
      ['@0xA', 'constant'],
      [',', 'punctuation.delimiter'],
      ['b', 'variable'],
      ['=', 'operator'],
      ['@std', 'constant'],
      [')]', 'punctuation.bracket'],
      ['fun', 'keyword.declaration'],
      ['t', 'function.definition'],
      ['() {}', 'punctuation.bracket'],
    ]
  );
  assertLineFedParity('move', '#[test(a = @0xA, b = @std)]\nfun t() {}');
  expect(
    tokenKinds(
      'move',
      'let b = b"a\\n"; let h = x"ff"; \'outer: loop { break \'outer }'
    )
  ).toEqual([
    ['let', 'keyword.declaration'],
    ['b', 'variable'],
    ['=', 'operator'],
    ['b"a', 'string'],
    ['\\n', 'string.escape'],
    ['"', 'string'],
    [';', 'punctuation.delimiter'],
    ['let', 'keyword.declaration'],
    ['h', 'variable'],
    ['=', 'operator'],
    ['x"ff"', 'string'],
    [';', 'punctuation.delimiter'],
    ["'outer", 'label'],
    [':', 'punctuation.delimiter'],
    ['loop', 'keyword.control'],
    ['{', 'punctuation.bracket'],
    ['break', 'keyword.control'],
    ["'outer", 'label'],
    ['}', 'punctuation.bracket'],
  ]);
});

test('move: numbers, comments, and specs', () => {
  expect(
    tokenKinds(
      'move',
      'let n = 1u8 + 0x10u64 + 1_000;\n/* a /* b */ c */ // d\n/// doc'
    )
  ).toEqual([
    ['let', 'keyword.declaration'],
    ['n', 'variable'],
    ['=', 'operator'],
    ['1u8', 'number'],
    ['+', 'operator'],
    ['0x10u64', 'number'],
    ['+', 'operator'],
    ['1_000', 'number'],
    [';', 'punctuation.delimiter'],
    ['/* a /* b */ c */ // d', 'comment'],
    ['/// doc', 'comment.doc'],
  ]);
  assertLineFedParity(
    'move',
    'let n = 1u8 + 0x10u64 + 1_000;\n/* a /* b */ c */ // d\n/// doc'
  );
  expect(
    tokenKinds(
      'move',
      'spec mint { aborts_if amount == 0; ensures result > 0; }'
    )
  ).toEqual([
    ['spec', 'keyword.declaration'],
    ['mint', 'variable'],
    ['{', 'punctuation.bracket'],
    ['aborts_if', 'keyword'],
    ['amount', 'variable'],
    ['==', 'operator'],
    ['0', 'number'],
    [';', 'punctuation.delimiter'],
    ['ensures', 'keyword'],
    ['result', 'variable'],
    ['>', 'operator'],
    ['0', 'number'],
    [';', 'punctuation.delimiter'],
    ['}', 'punctuation.bracket'],
  ]);
});
