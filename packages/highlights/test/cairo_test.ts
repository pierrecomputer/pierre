import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('cairo: short strings are strings, not lifetimes', () => {
  expect(tokenKinds('cairo', "assert(x > 0, 'bad value');")).toEqual([
    ['assert', 'function'],
    ['(', 'punctuation.bracket'],
    ['x', 'variable'],
    ['>', 'operator'],
    ['0', 'number'],
    [',', 'punctuation.delimiter'],
    ["'bad value'", 'string'],
    [')', 'punctuation.bracket'],
    [';', 'punctuation.delimiter'],
  ]);
  expect(tokenKinds('cairo', "let c = 'a'; let e = 'it\\'s';")).toEqual([
    ['let', 'keyword.declaration'],
    ['c', 'variable'],
    ['=', 'operator'],
    ["'a'", 'string'],
    [';', 'punctuation.delimiter'],
    ['let', 'keyword.declaration'],
    ['e', 'variable'],
    ['=', 'operator'],
    ["'it", 'string'],
    ["\\'", 'string.escape'],
    ["s'", 'string'],
    [';', 'punctuation.delimiter'],
  ]);
  expect(tokenKinds('cairo', "let open = 'unclosed\nlet next = 1;")).toEqual([
    ['let', 'keyword.declaration'],
    ['open', 'variable'],
    ['=', 'operator'],
    ["'unclosed", 'string'],
    ['let', 'keyword.declaration'],
    ['next', 'variable'],
    ['=', 'operator'],
    ['1', 'number'],
    [';', 'punctuation.delimiter'],
  ]);
  assertLineFedParity('cairo', "let open = 'unclosed\nlet next = 1;");
});

test('cairo: Cairo builtin types and keywords', () => {
  expect(
    tokenKinds(
      'cairo',
      'fn add(ref self: ContractState, x: u256) -> felt252 nopanic {'
    )
  ).toEqual([
    ['fn', 'keyword.declaration'],
    ['add', 'function.definition'],
    ['(', 'punctuation.bracket'],
    ['ref', 'keyword'],
    ['self', 'variable.special'],
    [':', 'punctuation.delimiter'],
    ['ContractState', 'type'],
    [',', 'punctuation.delimiter'],
    ['x', 'variable.parameter'],
    [':', 'punctuation.delimiter'],
    ['u256', 'type.builtin'],
    [')', 'punctuation.bracket'],
    ['->', 'operator'],
    ['felt252', 'type.builtin'],
    ['nopanic', 'keyword'],
    ['{', 'punctuation.bracket'],
  ]);
  expect(
    tokenKinds(
      'cairo',
      'let a: ContractAddress = b; let s: ByteArray = "hi\\n";'
    )
  ).toEqual([
    ['let', 'keyword.declaration'],
    ['a', 'variable'],
    [':', 'punctuation.delimiter'],
    ['ContractAddress', 'type.builtin'],
    ['=', 'operator'],
    ['b', 'variable'],
    [';', 'punctuation.delimiter'],
    ['let', 'keyword.declaration'],
    ['s', 'variable'],
    [':', 'punctuation.delimiter'],
    ['ByteArray', 'type.builtin'],
    ['=', 'operator'],
    ['"hi', 'string'],
    ['\\n', 'string.escape'],
    ['"', 'string'],
    [';', 'punctuation.delimiter'],
  ]);
  expect(
    tokenKinds('cairo', 'impl CounterImpl of ICounter<ContractState> {}')
  ).toEqual([
    ['impl', 'keyword.declaration'],
    ['CounterImpl', 'type'],
    ['of', 'keyword'],
    ['ICounter', 'type'],
    ['<', 'operator'],
    ['ContractState', 'type'],
    ['>', 'operator'],
    ['{}', 'punctuation.bracket'],
  ]);
  expect(
    tokenKinds('cairo', 'fn get(self: @ContractState) -> u128 { *self.value }')
  ).toEqual([
    ['fn', 'keyword.declaration'],
    ['get', 'function.definition'],
    ['(', 'punctuation.bracket'],
    ['self', 'variable.special'],
    [':', 'punctuation.delimiter'],
    ['@', 'operator'],
    ['ContractState', 'type'],
    [')', 'punctuation.bracket'],
    ['->', 'operator'],
    ['u128', 'type.builtin'],
    ['{', 'punctuation.bracket'],
    ['*', 'operator'],
    ['self', 'variable.special'],
    ['.', 'punctuation.delimiter'],
    ['value', 'property'],
    ['}', 'punctuation.bracket'],
  ]);
});

test('cairo: attributes, modules, and comments', () => {
  expect(
    tokenKinds(
      'cairo',
      '#[starknet::contract]\nmod counter {\n    use starknet::ClassHash;\n}'
    )
  ).toEqual([
    ['#', 'attribute'],
    ['[', 'punctuation.bracket'],
    ['starknet', 'attribute'],
    ['::', 'punctuation.delimiter'],
    ['contract', 'attribute'],
    [']', 'punctuation.bracket'],
    ['mod', 'keyword.declaration'],
    ['counter', 'type'],
    ['{', 'punctuation.bracket'],
    ['use', 'keyword.import'],
    ['starknet', 'namespace'],
    ['::', 'punctuation.delimiter'],
    ['ClassHash', 'type.builtin'],
    [';', 'punctuation.delimiter'],
    ['}', 'punctuation.bracket'],
  ]);
  assertLineFedParity(
    'cairo',
    '#[starknet::contract]\nmod counter {\n    use starknet::ClassHash;\n}'
  );
  expect(
    tokenKinds('cairo', '/// doc\n/* a /* b */\nc */ let n = 0x2a_u128;')
  ).toEqual([
    ['/// doc', 'comment.doc'],
    ['/* a /* b */', 'comment'],
    ['c */', 'comment'],
    ['let', 'keyword.declaration'],
    ['n', 'variable'],
    ['=', 'operator'],
    ['0x2a_u128', 'number'],
    [';', 'punctuation.delimiter'],
  ]);
  assertLineFedParity(
    'cairo',
    '/// doc\n/* a /* b */\nc */ let n = 0x2a_u128;'
  );
});
