import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('nsis: instructions, blocks, labels, and comments', () => {
  expect(
    tokenKinds(
      'nsis',
      '; note\nSection "Install" SecMain\n  SetOutPath $INSTDIR\ndone:\nSectionEnd\n# end'
    )
  ).toEqual([
    ['; note', 'comment'],
    ['Section', 'keyword.declaration'],
    ['"Install"', 'string'],
    ['SecMain', null],
    ['SetOutPath', 'function'],
    ['$INSTDIR', 'variable'],
    ['done:', 'label'],
    ['SectionEnd', 'keyword.declaration'],
    ['# end', 'comment'],
  ]);
  // keywords ignore case; only the first word of a statement is a command
  expect(tokenKinds('nsis', 'GOTO done\nCall MyFunc\nFile File')).toEqual([
    ['GOTO', 'keyword.control'],
    ['done', 'label'],
    ['Call', 'keyword.control'],
    ['MyFunc', 'function'],
    ['File', 'function'],
    ['File', null],
  ]);
  expect(
    tokenKinds('nsis', 'Function un.onInit\nnsExec::Exec "x"\nVar /GLOBAL n')
  ).toEqual([
    ['Function', 'keyword.declaration'],
    ['un.onInit', 'function.definition'],
    ['nsExec::Exec', 'function'],
    ['"x"', 'string'],
    ['Var', 'keyword.declaration'],
    ['/GLOBAL', 'variable.parameter'],
    ['n', 'variable'],
  ]);
});

test('nsis: compile-time commands and LogicLib', () => {
  expect(
    tokenKinds(
      'nsis',
      '!define APP "x"\n!macro Greet who\n!macroend\n!insertmacro Greet\n${If} $0 == 1\n${GetTime} $1\n${EndIf}'
    )
  ).toEqual([
    ['!define', 'preproc'],
    ['APP', 'constant'],
    ['"x"', 'string'],
    ['!macro', 'preproc'],
    ['Greet', 'function.definition'],
    ['who', null],
    ['!macroend', 'preproc'],
    ['!insertmacro', 'preproc'],
    ['Greet', 'function'],
    ['${If}', 'keyword.control'],
    ['$0', 'variable'],
    ['==', 'operator'],
    ['1', 'number'],
    ['${GetTime}', 'function'],
    ['$1', 'variable'],
    ['${EndIf}', 'keyword.control'],
  ]);
});

test('nsis: strings, escapes, variables, flags, and constants', () => {
  expect(
    tokenKinds(
      'nsis',
      'MessageBox MB_OK|MB_ICONSTOP "a$\\"b$\\n ${APP} $(MSG) $$5 $R0" /SD IDOK'
    )
  ).toEqual([
    ['MessageBox', 'function'],
    ['MB_OK', 'constant'],
    ['|', 'operator'],
    ['MB_ICONSTOP', 'constant'],
    ['"a', 'string'],
    ['$\\"', 'string.escape'],
    ['b', 'string'],
    ['$\\n', 'string.escape'],
    ['${APP}', 'constant'],
    ['$(MSG)', 'constant'],
    ['$$', 'string.escape'],
    ['5', 'string'],
    ['$R0', 'variable'],
    ['"', 'string'],
    ['/SD', 'variable.parameter'],
    ['IDOK', 'constant'],
  ]);
  expect(tokenKinds('nsis', "Exec `cmd /c` 'it' \"open\nNext")).toEqual([
    ['Exec', 'function'],
    ["`cmd /c` 'it' \"open", 'string'],
    ['Next', 'function'],
  ]);
});

test('nsis: block comments and line continuations span lines', () => {
  const code = '/* a\n   b */\nDetailPrint "a" \\\n  "b"\nNext\n';
  expect(tokenKinds('nsis', code)).toEqual([
    ['/* a', 'comment'],
    ['b */', 'comment'],
    ['DetailPrint', 'function'],
    ['"a"', 'string'],
    ['\\', 'operator'],
    ['"b"', 'string'],
    ['Next', 'function'],
  ]);
  assertLineFedParity('nsis', code);
  assertLineFedParity('nsis', code.replaceAll('\n', '\r\n'));
  assertLineFedParity('nsis', 'Push \\\n\nDetailPrint x\n');
});
