import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('ada: context clauses, declarations, and case-insensitive keywords', () => {
  expect(tokenKinds('ada', 'WITH Ada.Text_IO, Interfaces; Use Ada;')).toEqual([
    ['WITH', 'keyword.import'],
    ['Ada', 'namespace'],
    ['.', 'punctuation.delimiter'],
    ['Text_IO', 'namespace'],
    [',', 'punctuation.delimiter'],
    ['Interfaces', 'namespace'],
    [';', 'punctuation.delimiter'],
    ['Use', 'keyword.import'],
    ['Ada', 'namespace'],
    [';', 'punctuation.delimiter'],
  ]);
  expect(
    tokenKinds('ada', 'procedure Push (S : in out Stack; X : Integer) is')
  ).toEqual([
    ['procedure', 'keyword.declaration'],
    ['Push', 'function.definition'],
    ['(', 'punctuation.bracket'],
    ['S', 'variable'],
    [':', 'punctuation.delimiter'],
    ['in out', 'keyword'],
    ['Stack', 'type'],
    [';', 'punctuation.delimiter'],
    ['X', 'variable'],
    [':', 'punctuation.delimiter'],
    ['Integer', 'type.builtin'],
    [')', 'punctuation.bracket'],
    ['is', 'keyword'],
  ]);
  expect(tokenKinds('ada', 'package body Ada.Stacks is')).toEqual([
    ['package body', 'keyword.declaration'],
    ['Ada', 'namespace'],
    ['.', 'punctuation.delimiter'],
    ['Stacks', 'namespace'],
    ['is', 'keyword'],
  ]);
  // an aspect `with` after a `)` opens no clause
  expect(tokenKinds('ada', 'F (X) with Pre => X > 0;')).toContainEqual([
    'Pre',
    'variable',
  ]);
  expect(tokenKinds('ada', 'type T is range 1 .. 10;')).toEqual([
    ['type', 'keyword.declaration'],
    ['T', 'type'],
    ['is range', 'keyword'],
    ['1', 'number'],
    ['..', 'operator'],
    ['10', 'number'],
    [';', 'punctuation.delimiter'],
  ]);
});

test('ada: attribute ticks versus character literals', () => {
  expect(
    tokenKinds('ada', "N := A'Length + T'Image (1)'Length; C := 'x';")
  ).toEqual([
    ['N', 'variable'],
    [':=', 'operator'],
    ['A', 'variable'],
    ["'Length", 'attribute'],
    ['+', 'operator'],
    ['T', 'variable'],
    ["'Image", 'attribute'],
    ['(', 'punctuation.bracket'],
    ['1', 'number'],
    [')', 'punctuation.bracket'],
    ["'Length", 'attribute'],
    [';', 'punctuation.delimiter'],
    ['C', 'variable'],
    [':=', 'operator'],
    ["'x'", 'string'],
    [';', 'punctuation.delimiter'],
  ]);
  expect(tokenKinds('ada', "Character'('a') when ''' | 'λ' =>")).toEqual([
    ['Character', 'type.builtin'],
    ["'", 'operator'],
    ['(', 'punctuation.bracket'],
    ["'a'", 'string'],
    [')', 'punctuation.bracket'],
    ['when', 'keyword.control'],
    ["'''", 'string'],
    ['|', 'operator'],
    ["'λ'", 'string'],
    ['=>', 'operator'],
  ]);
});

test('ada: numbers, strings, comments, and labels', () => {
  expect(
    tokenKinds('ada', '1_000 3.14_15 1.0E-3 16#FF# 2#1010_1010#E2 16#F.F#')
  ).toEqual([['1_000 3.14_15 1.0E-3 16#FF# 2#1010_1010#E2 16#F.F#', 'number']]);
  const code = 'S := "say ""hi""" & "x"; -- note\n<<Again>> null;\n';
  expect(tokenKinds('ada', code)).toEqual([
    ['S', 'variable'],
    [':=', 'operator'],
    ['"say ""hi"""', 'string'],
    ['&', 'operator'],
    ['"x"', 'string'],
    [';', 'punctuation.delimiter'],
    ['-- note', 'comment'],
    ['<<Again>>', 'label'],
    ['null', 'constant.builtin'],
    [';', 'punctuation.delimiter'],
  ]);
  assertLineFedParity('ada', code);
  // a comment between a name and its tick keeps the attribute context
  assertLineFedParity('ada', "X -- c\n'First;\nY := 'z';\n");
});
