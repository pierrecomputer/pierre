import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('ahk: hotkeys, hotstrings, directives, and labels', () => {
  expect(
    tokenKinds(
      'ahk',
      '#Requires AutoHotkey v2.0\n^!s::Send "x"\n~LButton & RButton::\nF1 Up::Reload\n::btw::by the way\n:*:]d::\nmylabel:\nGosub mylabel'
    )
  ).toEqual([
    ['#Requires', 'preproc'],
    ['AutoHotkey v2.0', null],
    ['^!s', 'function.definition'],
    ['::', 'punctuation.delimiter'],
    ['Send', 'function'],
    ['"x"', 'string'],
    ['~LButton & RButton', 'function.definition'],
    ['::', 'punctuation.delimiter'],
    ['F1 Up', 'function.definition'],
    ['::', 'punctuation.delimiter'],
    ['Reload', 'function'],
    ['::btw', 'string.special'],
    ['::', 'punctuation.delimiter'],
    ['by the way', 'string'],
    [':*:]d', 'string.special'],
    ['::', 'punctuation.delimiter'],
    ['mylabel:', 'label'],
    ['Gosub', 'keyword.control'],
    ['mylabel', null],
  ]);
  // `#If` takes an expression, other directives take text
  expect(tokenKinds('ahk', '#HotIf WinActive("x")\n#Include <Lib>')).toEqual([
    ['#HotIf', 'preproc'],
    ['WinActive', 'function'],
    ['(', 'punctuation.bracket'],
    ['"x"', 'string'],
    [')', 'punctuation.bracket'],
    ['#Include', 'preproc'],
    ['<Lib>', null],
  ]);
});

test('ahk: comments need a blank before `;`', () => {
  expect(tokenKinds('ahk', '; top\nx := a;b ; note\n/* a\nb */')).toEqual([
    ['; top', 'comment'],
    ['x', null],
    [':=', 'operator'],
    ['a;b', null],
    ['; note', 'comment'],
    ['/* a', 'comment'],
    ['b */', 'comment'],
  ]);
});

test('ahk: v1 commands take text, v2 calls take expressions', () => {
  expect(
    tokenKinds(
      'ahk',
      'MsgBox, Hi %name%, `, done\nSend, {Ctrl down}c\nMsgBox % "v" x'
    )
  ).toEqual([
    ['MsgBox', 'function'],
    [',', 'punctuation.delimiter'],
    ['Hi', null],
    ['%name%', 'variable'],
    [',', 'punctuation.delimiter'],
    ['`,', 'string.escape'],
    ['done', null],
    ['Send', 'function'],
    [',', 'punctuation.delimiter'],
    ['{Ctrl down}', 'string.special'],
    ['c', null],
    ['MsgBox', 'function'],
    ['%', 'operator'],
    ['"v"', 'string'],
    ['x', null],
  ]);
  // an assignment or expression after the first word is not a command
  expect(
    tokenKinds('ahk', 'count += 1\nobj.prop := A_Index\nelse MsgBox')
  ).toEqual([
    ['count', null],
    ['+=', 'operator'],
    ['1', 'number'],
    ['obj', null],
    ['.', 'punctuation.delimiter'],
    ['prop', 'property'],
    [':=', 'operator'],
    ['A_Index', 'variable.special'],
    ['else', 'keyword.control'],
    ['MsgBox', 'function'],
  ]);
});

test('ahk: classes, functions, keywords, strings, and numbers', () => {
  expect(
    tokenKinds(
      'ahk',
      'class Foo extends Bar {\n  Get(a) {\n    return this.x ? true : 0x1F\n  }\n}\nSq(x) => x * x\nFn(1)'
    )
  ).toEqual([
    ['class', 'keyword.declaration'],
    ['Foo', 'type'],
    ['extends', 'keyword.declaration'],
    ['Bar', 'type'],
    ['{', 'punctuation.bracket'],
    ['Get', 'function.definition'],
    ['(', 'punctuation.bracket'],
    ['a', null],
    [') {', 'punctuation.bracket'],
    ['return', 'keyword.control'],
    ['this', 'variable.special'],
    ['.', 'punctuation.delimiter'],
    ['x', 'property'],
    ['?', 'operator'],
    ['true', 'boolean'],
    [':', 'operator'],
    ['0x1F', 'number'],
    ['}', 'punctuation.bracket'],
    ['}', 'punctuation.bracket'],
    ['Sq', 'function.definition'],
    ['(', 'punctuation.bracket'],
    ['x', null],
    [')', 'punctuation.bracket'],
    ['=>', 'operator'],
    ['x', null],
    ['*', 'operator'],
    ['x', null],
    ['Fn', 'function'],
    ['(', 'punctuation.bracket'],
    ['1', 'number'],
    [')', 'punctuation.bracket'],
  ]);
  expect(tokenKinds('ahk', 's := "a""b`n" \'c`\'d\' "open')).toEqual([
    ['s', null],
    [':=', 'operator'],
    ['"a', 'string'],
    ['""', 'string.escape'],
    ['b', 'string'],
    ['`n', 'string.escape'],
    ['" \'c', 'string'],
    ["`'", 'string.escape'],
    ['d\' "open', 'string'],
  ]);
});

test('ahk: continuation sections span lines', () => {
  const code =
    'text := "\n(Join`n\n  one ; not a comment\n  two\n)"\nMsgBox text\n';
  expect(tokenKinds('ahk', code)).toEqual([
    ['text', null],
    [':=', 'operator'],
    ['"', 'string'],
    ['(', 'punctuation.bracket'],
    ['Join`n', 'attribute'],
    ['one ; not a comment', 'string'],
    ['two', 'string'],
    [')', 'punctuation.bracket'],
    ['"', 'string'],
    ['MsgBox', 'function'],
    ['text', null],
  ]);
  assertLineFedParity('ahk', code);
  assertLineFedParity('ahk', code.replaceAll('\n', '\r\n'));
  // `(` with a `)` on its line is an expression
  expect(tokenKinds('ahk', '(a + b)')).toEqual([
    ['(', 'punctuation.bracket'],
    ['a', null],
    ['+', 'operator'],
    ['b', null],
    [')', 'punctuation.bracket'],
  ]);
});

test('ahk: v2 static methods, properties, and catch as', () => {
  expect(
    tokenKinds(
      'ahk',
      'class A {\n  static Create(n) {\n  }\n  Name {\n  }\n  static x := 1\n}\ntry {\n} catch Error as e {\n}'
    )
  ).toEqual([
    ['class', 'keyword.declaration'],
    ['A', 'type'],
    ['{', 'punctuation.bracket'],
    ['static', 'keyword.declaration'],
    ['Create', 'function.definition'],
    ['(', 'punctuation.bracket'],
    ['n', null],
    [') {', 'punctuation.bracket'],
    ['}', 'punctuation.bracket'],
    ['Name', 'property'],
    ['{', 'punctuation.bracket'],
    ['}', 'punctuation.bracket'],
    ['static', 'keyword.declaration'],
    ['x', null],
    [':=', 'operator'],
    ['1', 'number'],
    ['}', 'punctuation.bracket'],
    ['try', 'keyword.control'],
    ['{', 'punctuation.bracket'],
    ['}', 'punctuation.bracket'],
    ['catch', 'keyword.control'],
    ['Error', null],
    ['as', 'keyword.control'],
    ['e', null],
    ['{', 'punctuation.bracket'],
    ['}', 'punctuation.bracket'],
  ]);
});
