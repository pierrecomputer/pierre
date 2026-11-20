import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('vhdl: character literals, attributes, and qualified expressions', () => {
  expect(
    tokenKinds(
      'vhdl',
      "s <= '1' when clk'event and x'length > 2 else std_logic'('0') & ''';"
    )
  ).toEqual([
    ['s', 'variable'],
    ['<=', 'operator'],
    ["'1'", 'string'],
    ['when', 'keyword.control'],
    ['clk', 'variable'],
    ["'event", 'attribute'],
    ['and', 'keyword.operator'],
    ['x', 'variable'],
    ["'length", 'attribute'],
    ['>', 'operator'],
    ['2', 'number'],
    ['else', 'keyword.control'],
    ['std_logic', 'type.builtin'],
    ["'", 'operator'],
    ['(', 'punctuation.bracket'],
    ["'0'", 'string'],
    [')', 'punctuation.bracket'],
    ['&', 'operator'],
    ["'''", 'string'],
    [';', 'punctuation.delimiter'],
  ]);
});

test('vhdl: based literals, bit strings, and doubled quotes', () => {
  expect(
    tokenKinds(
      'vhdl',
      'x := 16#FF# + 2#1010_1010# + 16#F.F#E+2 + 2.5E-3;\nm := X"FF" & b"0101" & 12UX"F" & "a""b";'
    )
  ).toEqual([
    ['x', 'variable'],
    [':=', 'operator'],
    ['16#FF#', 'number'],
    ['+', 'operator'],
    ['2#1010_1010#', 'number'],
    ['+', 'operator'],
    ['16#F.F#E+2', 'number'],
    ['+', 'operator'],
    ['2.5E-3', 'number'],
    [';', 'punctuation.delimiter'],
    ['m', 'variable'],
    [':=', 'operator'],
    ['X"FF"', 'number'],
    ['&', 'operator'],
    ['b"0101"', 'number'],
    ['&', 'operator'],
    ['12UX"F"', 'number'],
    ['&', 'operator'],
    ['"a', 'string'],
    ['""', 'string.escape'],
    ['b"', 'string'],
    [';', 'punctuation.delimiter'],
  ]);
});

test('vhdl: case-insensitive keywords, design units, and declared types', () => {
  const tokens = tokenKinds(
    'vhdl',
    [
      'LIBRARY ieee; USE ieee.numeric_std.ALL;',
      'ENTITY Counter IS END ENTITY Counter;',
      'architecture rtl of Counter is',
      '  signal s : state_t := IDLE;',
      'begin',
      '  u1 : entity work.Sub port map (clk => clk);',
      '  if rising_edge(clk) then end if;',
      'end;',
      'function add(a : integer) return integer;',
    ].join('\n')
  );
  for (const [text, kind] of [
    ['LIBRARY', 'keyword.import'],
    ['ieee', 'namespace'],
    ['numeric_std', 'namespace'],
    ['ALL', 'keyword'],
    ['ENTITY', 'keyword.declaration'],
    ['Counter', 'type'],
    ['rtl', 'type'],
    ['signal', 'keyword.declaration'],
    ['state_t', 'type'],
    ['IDLE', 'constant'],
    ['work', 'namespace'],
    ['Sub', 'type'],
    ['port map', 'keyword.declaration'],
    ['rising_edge', 'function'],
    ['add', 'function.definition'],
    ['integer', 'type.builtin'],
  ]) {
    expect(tokens).toContainEqual([text, kind]);
  }
});

test('vhdl: comments, including block comments that stream by line', () => {
  const code = 'a <= b; -- note\n/* one\n   two */ c <= d;\n';
  expect(tokenKinds('vhdl', code)).toEqual([
    ['a', 'variable'],
    ['<=', 'operator'],
    ['b', 'variable'],
    [';', 'punctuation.delimiter'],
    ['-- note', 'comment'],
    ['/* one', 'comment'],
    ['two */', 'comment'],
    ['c', 'variable'],
    ['<=', 'operator'],
    ['d', 'variable'],
    [';', 'punctuation.delimiter'],
  ]);
  assertLineFedParity('vhdl', code);
});

test('vhdl: `on` and other reserved words', () => {
  expect(tokenKinds('vhdl', 'wait on clk;').slice(0, 3)).toEqual([
    ['wait', 'keyword.control'],
    ['on', 'keyword'],
    ['clk', 'variable'],
  ]);
  expect(
    tokenKinds('vhdl', 'unaffected force release linkage register bus guarded')
  ).toEqual([
    ['unaffected force release linkage register bus guarded', 'keyword'],
  ]);
  expect(tokenKinds('vhdl', 'protected group label disconnect')).toEqual([
    ['protected group label disconnect', 'keyword.declaration'],
  ]);
});

test('vhdl: attribute specifications name an entity, not a type', () => {
  const code =
    'attribute keep of cnt : signal is true;\nattribute w : integer;\ntype a is array (0 to 3) of bit;';
  expect(
    tokenKinds('vhdl', code).filter(([, kind]) => kind === 'type')
  ).toEqual([['a', 'type']]);
  expect(tokenKinds('vhdl', code)[3]).toEqual(['cnt', 'variable']);
  assertLineFedParity('vhdl', 'attribute keep\n  of cnt : signal is true;\n');
  expect(tokenKinds('vhdl', 'attribute x of y : entity is z;').at(-2)).toEqual([
    'z',
    'variable',
  ]);
});

test('vhdl: extended identifiers', () => {
  expect(tokenKinds('vhdl', 'signal \\bus name\\, \\a\\\\b\\ : bit;')).toEqual([
    ['signal', 'keyword.declaration'],
    ['\\bus name\\', 'variable'],
    [',', 'punctuation.delimiter'],
    ['\\a\\\\b\\', 'variable'],
    [':', 'punctuation.delimiter'],
    ['bit', 'type.builtin'],
    [';', 'punctuation.delimiter'],
  ]);
});
