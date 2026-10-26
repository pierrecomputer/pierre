import { expect, test } from 'bun:test';

import { samples } from './_samples';
import {
  assertLineFedParity,
  checkInvariants,
  loadLang,
  makeRand,
  tokenKinds,
} from './_util';

test('abap: column-1 star comments, quote comments, and ABAP Doc', () => {
  expect(
    tokenKinds('abap', '* note\nx = a * b. " tail\n  * 2.\n"! doc')
  ).toEqual([
    ['* note', 'comment'],
    ['x', 'variable'],
    ['=', 'operator'],
    ['a', 'variable'],
    ['*', 'operator'],
    ['b', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['" tail', 'comment'],
    ['*', 'operator'],
    ['2', 'number'],
    ['.', 'punctuation.delimiter'],
    ['"! doc', 'comment.doc'],
  ]);
});

test('abap: case-insensitive and hyphenated keywords, declarations, and types', () => {
  expect(
    tokenKinds(
      'abap',
      'Class lcl_a DEFINITION.\nmethods Run IMPORTING iv TYPE REF TO data.'
    )
  ).toEqual([
    ['Class', 'keyword.declaration'],
    ['lcl_a', 'type'],
    ['DEFINITION', 'keyword.declaration'],
    ['.', 'punctuation.delimiter'],
    ['methods', 'keyword.declaration'],
    ['Run', 'function.definition'],
    ['IMPORTING', 'keyword'],
    ['iv', 'variable'],
    ['TYPE REF TO', 'keyword'],
    ['data', 'type.builtin'],
    ['.', 'punctuation.delimiter'],
  ]);
  expect(
    tokenKinds('abap', 'TYPES: tt TYPE STANDARD TABLE OF ty WITH EMPTY KEY.')
  ).toEqual([
    ['TYPES', 'keyword.declaration'],
    [':', 'punctuation.delimiter'],
    ['tt', 'type'],
    ['TYPE STANDARD TABLE OF', 'keyword'],
    ['ty', 'type'],
    ['WITH EMPTY KEY', 'keyword'],
    ['.', 'punctuation.delimiter'],
  ]);
  expect(
    tokenKinds(
      'abap',
      'FIELD-SYMBOLS <fs> LIKE LINE OF itab.\nCLASS-METHODS make.'
    )
  ).toEqual([
    ['FIELD-SYMBOLS', 'keyword.declaration'],
    ['<fs>', 'variable.special'],
    ['LIKE LINE OF', 'keyword'],
    ['itab', 'type'],
    ['.', 'punctuation.delimiter'],
    ['CLASS-METHODS', 'keyword.declaration'],
    ['make', 'function.definition'],
    ['.', 'punctuation.delimiter'],
  ]);
  // `CALL METHOD` calls, `PERFORM` names a form
  expect(tokenKinds('abap', 'CALL METHOD lo->run. PERFORM sub.')).toEqual([
    ['CALL', 'keyword'],
    ['METHOD', 'keyword.declaration'],
    ['lo', 'variable'],
    ['->', 'operator'],
    ['run', 'property'],
    ['.', 'punctuation.delimiter'],
    ['PERFORM', 'keyword.control'],
    ['sub', 'function'],
    ['.', 'punctuation.delimiter'],
  ]);
  for (const [word, kind] of [
    ['where', 'keyword'],
    ['WHILE', 'keyword.control'],
    ['Ascending', 'keyword'],
    ['assigning', 'keyword'],
    ['abap_true', 'boolean'],
    ['space', 'constant.builtin'],
    ['me', 'variable.special'],
    ['xstring', 'type.builtin'],
    ['NE', 'keyword.operator'],
    ['move-corresponding', 'keyword'],
  ] as const) {
    expect(tokenKinds('abap', word)).toEqual([[word, kind]]);
  }
});

test('abap: component selectors, calls, field symbols, and pragmas', () => {
  expect(
    tokenKinds(
      'abap',
      'ls-a = sy-subrc. <fs>-b = zcl=>c( )->d. itab[ 1 ]-e = lif~m( ) ##NEEDED.'
    )
  ).toEqual([
    ['ls', 'variable'],
    ['-', 'punctuation.delimiter'],
    ['a', 'property'],
    ['=', 'operator'],
    ['sy', 'variable'],
    ['-', 'punctuation.delimiter'],
    ['subrc', 'property'],
    ['.', 'punctuation.delimiter'],
    ['<fs>', 'variable.special'],
    ['-', 'punctuation.delimiter'],
    ['b', 'property'],
    ['=', 'operator'],
    ['zcl', 'variable'],
    ['=>', 'operator'],
    ['c', 'function.method'],
    ['( )', 'punctuation.bracket'],
    ['->', 'operator'],
    ['d', 'property'],
    ['.', 'punctuation.delimiter'],
    ['itab', 'variable'],
    ['[', 'punctuation.bracket'],
    ['1', 'number'],
    [']', 'punctuation.bracket'],
    ['-', 'punctuation.delimiter'],
    ['e', 'property'],
    ['=', 'operator'],
    ['lif', 'variable'],
    ['~', 'operator'],
    ['m', 'function.method'],
    ['( )', 'punctuation.bracket'],
    ['##NEEDED', 'preproc'],
    ['.', 'punctuation.delimiter'],
  ]);
  // a component named like a keyword is still a component
  expect(tokenKinds('abap', 'ls-type = x - 1.')).toEqual([
    ['ls', 'variable'],
    ['-', 'punctuation.delimiter'],
    ['type', 'property'],
    ['=', 'operator'],
    ['x', 'variable'],
    ['-', 'operator'],
    ['1', 'number'],
    ['.', 'punctuation.delimiter'],
  ]);
});

test('abap: literals, doubled-quote escapes, and string templates', () => {
  expect(tokenKinds('abap', "x = 'it''s' && `a``b`.")).toEqual([
    ['x', 'variable'],
    ['=', 'operator'],
    ["'it", 'string'],
    ["''", 'string.escape'],
    ["s'", 'string'],
    ['&&', 'operator'],
    ['`a', 'string'],
    ['``', 'string.escape'],
    ['b`', 'string'],
    ['.', 'punctuation.delimiter'],
  ]);
  expect(tokenKinds('abap', 'x = |a { y } \\| { |in { z }| } b|.')).toEqual([
    ['x', 'variable'],
    ['=', 'operator'],
    ['|a', 'string'],
    ['{', 'punctuation.special'],
    ['y', 'variable'],
    ['}', 'punctuation.special'],
    ['\\|', 'string.escape'],
    ['{', 'punctuation.special'],
    ['|in', 'string'],
    ['{', 'punctuation.special'],
    ['z', 'variable'],
    ['}', 'punctuation.special'],
    ['|', 'string'],
    ['}', 'punctuation.special'],
    ['b|', 'string'],
    ['.', 'punctuation.delimiter'],
  ]);
  // template text spans lines; a quoted literal ends with its line
  expect(tokenKinds('abap', "x = |one\n* two|.\ny = 'open\nz.")).toEqual([
    ['x', 'variable'],
    ['=', 'operator'],
    ['|one', 'string'],
    ['* two|', 'string'],
    ['.', 'punctuation.delimiter'],
    ['y', 'variable'],
    ['=', 'operator'],
    ["'open", 'string'],
    ['z', 'variable'],
    ['.', 'punctuation.delimiter'],
  ]);
});

test('abap: templates, captures, and comments resume line-fed', () => {
  for (const code of [
    samples.abap.code,
    'x = |a {\n  y\n} b\n* c|.\n* d\n',
    'TYPES\n  ty TYPE\n  REF TO\n  zcl_x.\n',
    'x = |{ |a\nb| }\n|.\n',
  ]) {
    assertLineFedParity('abap', code);
  }
});

test('abap: malformed and random input remains total, balanced and lossless', () => {
  const lexer = loadLang('abap', '$hlAbap');
  const rand = makeRand(0xa0a9);
  const alphabet = Array.from('abT_09 -"\'`|{}\\\n\r\t[]()<>.,:=~#*@$λ😀');
  for (const code of [
    '',
    '|',
    '|{',
    '|{}',
    "'",
    '`',
    '<',
    '<a',
    '##',
    '-',
    'a-',
  ]) {
    checkInvariants(lexer.hl, code);
  }
  for (let n = 0; n < 160; n++) {
    const code = Array.from(
      { length: rand() & 63 },
      () => alphabet[rand() % alphabet.length]
    ).join('');
    checkInvariants(lexer.hl, code);
  }
});
