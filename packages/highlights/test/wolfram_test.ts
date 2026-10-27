import { expect, test } from 'bun:test';

import { samples } from './_samples';
import {
  assertLineFedParity,
  checkInvariants,
  loadLang,
  makeRand,
  tokenKinds,
} from './_util';

test('wolfram: definitions, patterns, and conditions', () => {
  expect(
    tokenKinds(
      'wolfram',
      'square[x_] := x^2\nf[x_, y_:0] /; x > 0 := x + y\ng[a_][b_] ^:= a b; h[x_] = 1\nk[x] == 2'
    )
  ).toEqual([
    ['square', 'function.definition'],
    ['[', 'punctuation.bracket'],
    ['x_', 'variable.parameter'],
    [']', 'punctuation.bracket'],
    [':=', 'operator'],
    ['x', 'variable'],
    ['^', 'operator'],
    ['2', 'number'],
    ['f', 'function.definition'],
    ['[', 'punctuation.bracket'],
    ['x_', 'variable.parameter'],
    [',', 'punctuation.delimiter'],
    ['y_', 'variable.parameter'],
    [':', 'operator'],
    ['0', 'number'],
    [']', 'punctuation.bracket'],
    ['/;', 'operator'],
    ['x', 'variable'],
    ['>', 'operator'],
    ['0', 'number'],
    [':=', 'operator'],
    ['x', 'variable'],
    ['+', 'operator'],
    ['y', 'variable'],
    ['g', 'function.definition'],
    ['[', 'punctuation.bracket'],
    ['a_', 'variable.parameter'],
    ['][', 'punctuation.bracket'],
    ['b_', 'variable.parameter'],
    [']', 'punctuation.bracket'],
    ['^:=', 'operator'],
    ['a b', 'variable'],
    [';', 'punctuation.delimiter'],
    ['h', 'function.definition'],
    ['[', 'punctuation.bracket'],
    ['x_', 'variable.parameter'],
    [']', 'punctuation.bracket'],
    ['=', 'operator'],
    ['1', 'number'],
    // a comparison is not a definition
    ['k', 'function'],
    ['[', 'punctuation.bracket'],
    ['x', 'variable'],
    [']', 'punctuation.bracket'],
    ['==', 'operator'],
    ['2', 'number'],
  ]);
  expect(tokenKinds('wolfram', 'x___; _.; x:{__Real}; x_?NumberQ')).toEqual([
    ['x___', 'variable.parameter'],
    [';', 'punctuation.delimiter'],
    ['_.', 'variable.parameter'],
    [';', 'punctuation.delimiter'],
    ['x', 'variable.parameter'],
    [':', 'operator'],
    ['{', 'punctuation.bracket'],
    ['__', 'variable.parameter'],
    ['Real', 'type'],
    ['}', 'punctuation.bracket'],
    [';', 'punctuation.delimiter'],
    ['x_', 'variable.parameter'],
    ['?', 'operator'],
    ['NumberQ', 'function'],
  ]);
});

test('wolfram: symbols by table and by shape', () => {
  expect(
    tokenKinds(
      'wolfram',
      'x // N; Length /@ xs; f @@ {1}; Select[xs, EvenQ]; xs[[1]]; PlotRange -> All'
    )
  ).toEqual([
    ['x', 'variable'],
    ['//', 'operator'],
    ['N', 'function'],
    [';', 'punctuation.delimiter'],
    ['Length', 'function'],
    ['/@', 'operator'],
    ['xs', 'variable'],
    [';', 'punctuation.delimiter'],
    ['f', 'function'],
    ['@@', 'operator'],
    ['{', 'punctuation.bracket'],
    ['1', 'number'],
    ['}', 'punctuation.bracket'],
    [';', 'punctuation.delimiter'],
    ['Select', 'function'],
    ['[', 'punctuation.bracket'],
    ['xs', 'variable'],
    [',', 'punctuation.delimiter'],
    ['EvenQ', 'function'],
    [']', 'punctuation.bracket'],
    [';', 'punctuation.delimiter'],
    ['xs', 'variable'],
    ['[[', 'punctuation.bracket'],
    ['1', 'number'],
    [']]', 'punctuation.bracket'],
    [';', 'punctuation.delimiter'],
    ['PlotRange', 'constant'],
    ['->', 'operator'],
    ['All', 'constant.builtin'],
  ]);
  expect(
    tokenKinds('wolfram', 'System`Plot; `Private`x; $Version; ##2; #name; %3')
  ).toEqual([
    ['System`', 'namespace'],
    ['Plot', 'function'],
    [';', 'punctuation.delimiter'],
    ['`Private`', 'namespace'],
    ['x', 'variable'],
    [';', 'punctuation.delimiter'],
    ['$Version', 'variable.special'],
    [';', 'punctuation.delimiter'],
    ['##2', 'variable.parameter'],
    [';', 'punctuation.delimiter'],
    ['#name', 'variable.parameter'],
    [';', 'punctuation.delimiter'],
    ['%3', 'variable.special'],
  ]);
  const tokens = tokenKinds('wolfram', samples.wolfram.code);
  for (const [text, kind] of [
    ['BeginPackage', 'keyword.import'],
    ['usage', 'property'],
    ['Module', 'keyword'],
    ['If', 'keyword.control'],
    ['True', 'boolean'],
    ['Null', 'constant.builtin'],
    ['Integer', 'type'],
    ['Total', 'function'],
  ]) {
    expect(tokens).toContainEqual([text, kind]);
  }
});

test('wolfram: numbers, named characters, associations, and spans', () => {
  for (const number of [
    '2^^101',
    '1.5*^-10',
    '1.5`20',
    '1``3',
    '.5',
    '1.',
    '16^^FF.8',
  ]) {
    expect(tokenKinds('wolfram', number)).toEqual([[number, 'number']]);
  }
  // implicit multiplication keeps the number and the symbol apart
  expect(tokenKinds('wolfram', '2x')).toEqual([
    ['2', 'number'],
    ['x', 'variable'],
  ]);
  expect(tokenKinds('wolfram', '\\[Alpha] <|a -> 1|> xs[[1 ;; 2]]')).toEqual([
    ['\\[Alpha]', 'string.special'],
    ['<|', 'punctuation.bracket'],
    ['a', 'variable'],
    ['->', 'operator'],
    ['1', 'number'],
    ['|>', 'punctuation.bracket'],
    ['xs', 'variable'],
    ['[[', 'punctuation.bracket'],
    ['1', 'number'],
    [';;', 'operator'],
    ['2', 'number'],
    [']]', 'punctuation.bracket'],
  ]);
});

test('wolfram: nested comments, strings, and a script line resume line-fed', () => {
  expect(
    tokenKinds('wolfram', '#!/usr/bin/env wolframscript\n(* a (* b *) c *) 1')
  ).toEqual([
    ['#!/usr/bin/env wolframscript', 'comment'],
    ['(* a (* b *) c *)', 'comment'],
    ['1', 'number'],
  ]);
  expect(tokenKinds('wolfram', '"a\\"b"')).toEqual([
    ['"a', 'string'],
    ['\\"', 'string.escape'],
    ['b"', 'string'],
  ]);
  for (const code of [
    samples.wolfram.code,
    '(* open (* nested\n*) still\n*) f[x_] := x\n',
    's = "one\ntwo \\"three\\"\nfour";\nPrint[s]\n',
    'f[x_] :=\r\n  x // N\r\n',
  ]) {
    assertLineFedParity('wolfram', code);
  }
});

test('wolfram: nested calls after `;` check for a definition in linear time', () => {
  // each `f[` after `;` scanned to its closing `]`: 32k nested calls took ~1.2s
  for (const unit of ['f[0;', 'f[0/;', 'f[{0;']) {
    const n = 32000;
    const close = unit.includes('{') ? '}]' : ']';
    const code = unit.repeat(n) + 'x' + close.repeat(n);
    const start = performance.now();
    tokenKinds('wolfram', code);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(250);
  }
  // a statement `;` starts a definition, a `/;` condition does not
  const definitions = (code: string) =>
    tokenKinds('wolfram', code)
      .filter(([, kind]) => kind === 'function.definition')
      .map(([text]) => text);
  expect(definitions('a = 1; f[x_] := x')).toEqual(['f']);
  expect(definitions('f[x_ /; x > 0] := x')).toEqual(['f']);
  expect(definitions('g[x_ /; f[y_] := 1]')).toEqual([]);
  expect(definitions('f[0; g[x_] := 1]')).toEqual(['g']);
});

test('wolfram: malformed and random input remains total, balanced and lossless', () => {
  const lexer = loadLang('wolfram', '$hlWolfram');
  for (const code of [
    '',
    '(*',
    '"',
    '\\',
    '\\[',
    '\\[Alpha',
    '#',
    '%',
    '_',
    '`',
    'a`',
    '2^^',
    '1*^',
    '1`',
    'f[',
    'f[x_',
    '::',
    '<|',
  ]) {
    checkInvariants(lexer.hl, code);
  }
  const rand = makeRand(0x3a7e);
  const alphabet = Array.from(
    'abcXYZ09_$` "\n\r\t()[]{}.,:;+-*=<>|/\\#@%&^~!?\'λ😀'
  );
  for (let n = 0; n < 160; n++) {
    let src = '';
    for (let i = 0, len = rand() & 63; i < len; i++) {
      src += alphabet[rand() % alphabet.length];
    }
    checkInvariants(lexer.hl, src);
    assertLineFedParity('wolfram', src);
  }
});
