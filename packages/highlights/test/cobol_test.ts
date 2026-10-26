import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

/** A fixed-format line: sequence area, indicator, and code padded to 72. */
const fixed = (seq: string, indicator: string, code: string, id = '') =>
  `${seq}${indicator}${code}`.padEnd(id === '' ? 0 : 72) + id;

test('cobol: fixed format sequence, indicator, and identification areas', () => {
  const code = [
    fixed('000100', ' ', 'IDENTIFICATION DIVISION.', 'HELLO001'),
    fixed('000200', '*', 'a comment line'),
    fixed('000300', '/', 'a page eject'),
    fixed('      ', 'D', '    DISPLAY X'),
    fixed('000500', '-', '    "TAIL"'),
    '',
  ].join('\n');
  expect(tokenKinds('cobol', code)).toEqual([
    ['000100', 'comment'],
    ['IDENTIFICATION DIVISION', 'keyword.declaration'],
    ['.', 'punctuation.delimiter'],
    ['HELLO001', 'comment'],
    ['000200*a comment line', 'comment'],
    ['000300/a page eject', 'comment'],
    ['D', 'preproc'],
    ['DISPLAY', 'keyword'],
    ['X', 'variable'],
    ['000500', 'comment'],
    ['-', 'operator'],
    ['"TAIL"', 'string'],
  ]);
  assertLineFedParity('cobol', code);
  // a string or name never runs into the identification area
  const long = fixed('000600', ' ', `    MOVE "${'X'.repeat(50)}`, 'PROG0001');
  expect(tokenKinds('cobol', long)).toEqual([
    ['000600', 'comment'],
    ['MOVE', 'keyword'],
    [`"${'X'.repeat(50)}`, 'string'],
    ['PROG0001', 'comment'],
  ]);
  const word = fixed('000700', ' ', `${' '.repeat(59)}WS-NAME`, 'ID');
  expect(tokenKinds('cobol', word).slice(-2)).toEqual([
    ['WS-NAM', 'variable'],
    ['EID', 'comment'],
  ]);
});

test('cobol: free format lines, floating comments, and directives', () => {
  expect(
    tokenKinds(
      'cobol',
      '>>SOURCE FORMAT FREE\nmain-para.\n    display "hi" *> greet\n    goback.\n'
    )
  ).toEqual([
    ['>>SOURCE FORMAT FREE', 'preproc'],
    ['main-para', 'function.definition'],
    ['.', 'punctuation.delimiter'],
    ['display', 'keyword'],
    ['"hi"', 'string'],
    ['*> greet', 'comment'],
    ['goback', 'keyword.control'],
    ['.', 'punctuation.delimiter'],
  ]);
  // six blanks and `DISPLAY` are not a debugging line
  expect(tokenKinds('cobol', '      DISPLAY X')).toEqual([
    ['DISPLAY', 'keyword'],
    ['X', 'variable'],
  ]);
});

test('cobol: data descriptions and picture strings', () => {
  expect(
    tokenKinds(
      'cobol',
      '       01  WS-AMT  PIC S9(5)V99 COMP-3 VALUE ZEROS.\n       05  WS-ID   PICTURE IS X(10).'
    )
  ).toEqual([
    ['01', 'number'],
    ['WS-AMT', 'variable'],
    ['PIC', 'keyword.declaration'],
    ['S9(5)V99', 'type'],
    ['COMP-3', 'type.builtin'],
    ['VALUE', 'keyword.declaration'],
    ['ZEROS', 'constant.builtin'],
    ['.', 'punctuation.delimiter'],
    ['05', 'number'],
    ['WS-ID', 'variable'],
    ['PICTURE', 'keyword.declaration'],
    ['IS', 'keyword'],
    ['X(10)', 'type'],
    ['.', 'punctuation.delimiter'],
  ]);
  expect(tokenKinds('cobol', 'PIC $$,$$9.99.')).toEqual([
    ['PIC', 'keyword.declaration'],
    ['$$,$$9.99', 'type'],
    ['.', 'punctuation.delimiter'],
  ]);
  expect(tokenKinds('cobol', `MOVE "It""s" TO X"FF" TO N'Name'`)).toEqual([
    ['MOVE', 'keyword'],
    ['"It""s"', 'string'],
    ['TO', 'keyword'],
    ['X"FF"', 'string'],
    ['TO', 'keyword'],
    ["N'Name'", 'string'],
  ]);
});

test('cobol: verbs, paragraphs, and hyphenated names', () => {
  const code = [
    '       PROCEDURE DIVISION.',
    '       MAIN-PARA.',
    '           PERFORM CALC-PARA THRU CALC-EXIT',
    '           IF WS-COUNT >= 10 AND NOT END-OF-FILE',
    '              MOVE WS-A TO',
    '                 WS-B.',
    '           END-IF',
    '           GO TO MAIN-EXIT.',
    '       CALC-PARA SECTION.',
    '           COMPUTE WS-X = WS-Y ** 2 - 1.5',
    '',
  ].join('\n');
  const tokens = tokenKinds('cobol', code);
  for (const [text, kind] of [
    ['MAIN-PARA', 'function.definition'],
    ['PERFORM', 'keyword.control'],
    ['CALC-PARA', 'function'],
    ['THRU', 'keyword.control'],
    ['CALC-EXIT', 'function'],
    ['>=', 'operator'],
    ['AND NOT', 'keyword.operator'],
    ['END-OF-FILE', 'variable'],
    ['WS-B', 'variable'],
    ['END-IF', 'keyword.control'],
    ['MAIN-EXIT', 'function'],
    ['CALC-PARA', 'function.definition'],
    ['**', 'operator'],
    ['-', 'operator'],
    ['1.5', 'number'],
  ]) {
    expect(tokens).toContainEqual([text, kind]);
  }
  expect(tokenKinds('cobol', 'Move ws-a To ws-b')).toEqual([
    ['Move', 'keyword'],
    ['ws-a', 'variable'],
    ['To', 'keyword'],
    ['ws-b', 'variable'],
  ]);
  assertLineFedParity('cobol', code);
});

test('cobol: a hyphen after a number that starts with a dot is an operator', () => {
  expect(tokenKinds('cobol', '.7-Y')).toEqual([
    ['.7', 'number'],
    ['-', 'operator'],
    ['Y', 'variable'],
  ]);
  expect(tokenKinds('cobol', '7-Y')).toEqual([['7-Y', 'variable']]);
});
