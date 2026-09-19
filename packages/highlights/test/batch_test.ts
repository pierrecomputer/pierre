import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('batch: case-insensitive commands and control flow', () => {
  const kinds = tokenKinds(
    'batch',
    '@EcHo off\nSET count=2\nIF EXIST out GOTO done\n:done\nEXIT /b 0'
  );
  for (const expected of [
    ['EcHo', 'function'],
    ['SET', 'keyword.declaration'],
    ['done', 'label'],
    [':done', 'label'],
    ['0', 'number'],
  ] satisfies [string, string][]) {
    expect(kinds).toContainEqual(expected);
  }
});

test('batch: arguments, FOR variables, and delayed expansion', () => {
  const kinds = tokenKinds(
    'batch',
    'echo "%PATH% %1 %* %~dp0 %%F %%~fF !COUNT!"'
  );
  for (const expected of [
    ['%PATH%', 'variable.special'],
    ['%1', 'variable.special'],
    ['%*', 'variable.special'],
    ['%~dp0', 'variable.special'],
    ['%%F', 'variable.special'],
    ['%%~fF', 'variable.special'],
    ['!COUNT!', 'variable.special'],
  ] satisfies [string, string][]) {
    expect(kinds).toContainEqual(expected);
  }
});

test('batch: labels, comments, and caret escapes', () => {
  const kinds = tokenKinds(
    'batch',
    ':: note\nREM comment\n:again\necho ^& ^| ^< ^> ^^'
  );
  for (const expected of [
    [':: note', 'comment'],
    ['REM comment', 'comment'],
    [':again', 'label'],
  ] satisfies [string, string][]) {
    expect(kinds).toContainEqual(expected);
  }
});

test('batch: multiline constructs match line-fed streaming', () => {
  for (const code of [
    '@echo off\necho first ^\nsecond ^& third\nREM comment\n',
    'set "x=%PATH%"\nfor %%F in (*) do (\n echo "%%~fF !x!"\n)\n',
  ]) {
    assertLineFedParity('batch', code);
  }
});

test('batch: CALL labels do not consume their arguments', () => {
  expect(tokenKinds('batch', 'call :build %1 42')).toEqual([
    ['call', 'keyword.control'],
    [':build', 'label'],
    ['%1', 'variable.special'],
    ['42', 'number'],
  ]);
  expect(tokenKinds('batch', 'goto :eof')).toEqual([
    ['goto', 'keyword.control'],
    [':eof', 'label'],
  ]);
});

test('batch: parameter modifiers and substitutions keep their delimiters', () => {
  for (const value of [
    '%0',
    '%9',
    '%*',
    '%~1',
    '%~dp0',
    '%~nx2',
    '%~$PATH:1',
    '%~dp$PATH:1',
    '%%A',
    '%%~fA',
    '%%~$PATH:A',
    '%PATH:~0,3%',
    '%name:old=new%',
    '!name:~1!',
  ]) {
    expect(tokenKinds('batch', value)).toEqual([[value, 'variable.special']]);
  }
});

test('batch: modified FOR expansions leave literal suffixes outside the variable', () => {
  for (const variable of ['%%~fA', '%%~NXA', '%%~$PATH:A', '%%~dp$PATH_1:A']) {
    for (const suffix of ['_suffix', 'text', '42']) {
      const code = `for %%A in (*) do echo "${variable}${suffix}"\n`;
      const kinds = tokenKinds('batch', code);
      expect(kinds).toContainEqual([variable, 'variable.special']);
      expect(kinds).toContainEqual([`${suffix}"`, 'string']);
      assertLineFedParity('batch', code);
    }
  }
  for (const variable of ['f', 'F', 'n', 'A']) {
    const expansion = `%%~f${variable}`;
    const code = `for %%${variable} in (*) do echo "${expansion}_suffix"\n`;
    expect(tokenKinds('batch', code)).toContainEqual([
      expansion,
      'variable.special',
    ]);
    assertLineFedParity('batch', code);
  }
});

test('batch: REM is a comment only in command position', () => {
  expect(tokenKinds('batch', 'echo REM')).toEqual([
    ['echo', 'function'],
    ['REM', 'variable'],
  ]);
  expect(tokenKinds('batch', 'echo ^& rem & REM <tail>')).toEqual([
    ['echo', 'function'],
    ['^&', 'string.escape'],
    ['rem', 'variable'],
    ['&', 'operator'],
    ['REM <tail>', 'comment'],
  ]);
  expect(tokenKinds('batch', 'for %%F in (*) do REM tail')).toContainEqual([
    'REM tail',
    'comment',
  ]);
});

test('batch: escaped metacharacters and quoted comment markers stay literal', () => {
  for (const escape of ['^&', '^|', '^<', '^>', '^^', '^"', '^%', '^!']) {
    expect(tokenKinds('batch', escape)).toEqual([[escape, 'string.escape']]);
  }
  expect(tokenKinds('batch', '"REM :: & | < >"')).toEqual([
    ['"REM :: & | < >"', 'string'],
  ]);
});

test('batch: keyword lookalikes stay identifiers', () => {
  for (const word of [
    'remark',
    'echoes',
    'setlocality',
    'gotoLabel',
    'if_exists',
  ]) {
    expect(tokenKinds('batch', word)).toEqual([[word, 'variable']]);
  }
});
