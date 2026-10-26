import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('reg: header, keys, deleted keys, and comments', () => {
  expect(
    tokenKinds(
      'reg',
      'Windows Registry Editor Version 5.00\n; note\n[HKEY_CURRENT_USER\\Software\\λ]\n[-HKEY_LOCAL_MACHINE\\Old]\nREGEDIT4\n'
    )
  ).toEqual([
    ['Windows Registry Editor Version 5.00', 'keyword'],
    ['; note', 'comment'],
    ['[', 'punctuation.bracket'],
    ['HKEY_CURRENT_USER\\Software\\λ', 'type'],
    [']', 'punctuation.bracket'],
    ['[', 'punctuation.bracket'],
    ['-', 'operator'],
    ['HKEY_LOCAL_MACHINE\\Old', 'type'],
    [']', 'punctuation.bracket'],
    ['REGEDIT4', 'keyword'],
  ]);
});

test('reg: value names, string data, and deleted values', () => {
  expect(
    tokenKinds('reg', '"Path"="C:\\\\Apps \\"x\\""\n@="default"\n"Old"=-')
  ).toEqual([
    ['"Path"', 'property'],
    ['=', 'operator'],
    ['"C:', 'string'],
    ['\\\\', 'string.escape'],
    ['Apps', 'string'],
    ['\\"', 'string.escape'],
    ['x', 'string'],
    ['\\"', 'string.escape'],
    ['"', 'string'],
    ['@', 'variable.special'],
    ['=', 'operator'],
    ['"default"', 'string'],
    ['"Old"', 'property'],
    ['=-', 'operator'],
  ]);
});

test('reg: dword, qword, and hex data with continued byte lists', () => {
  const code =
    '"N"=dword:0000001f\n"Q"=QWORD:00000000000000ff\n"B"=hex(2):25,00,\\\n  4a,FF ; end\n';
  expect(tokenKinds('reg', code)).toEqual([
    ['"N"', 'property'],
    ['=', 'operator'],
    ['dword', 'type.builtin'],
    [':', 'punctuation.delimiter'],
    ['0000001f', 'number'],
    ['"Q"', 'property'],
    ['=', 'operator'],
    ['QWORD', 'type.builtin'],
    [':', 'punctuation.delimiter'],
    ['00000000000000ff', 'number'],
    ['"B"', 'property'],
    ['=', 'operator'],
    ['hex', 'type.builtin'],
    ['(', 'punctuation.bracket'],
    ['2', 'number'],
    [')', 'punctuation.bracket'],
    [':', 'punctuation.delimiter'],
    ['25', 'number'],
    [',', 'punctuation.delimiter'],
    ['00', 'number'],
    [',', 'punctuation.delimiter'],
    ['\\', 'punctuation.special'],
    ['4a', 'number'],
    [',', 'punctuation.delimiter'],
    ['FF', 'number'],
    ['; end', 'comment'],
  ]);
  assertLineFedParity('reg', code);
});
