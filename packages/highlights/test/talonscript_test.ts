import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('talonscript: context header up to the `-` line', () => {
  const code =
    'app: vscode\nand not tag: user.tabs\nwin.title: /\\.py$/\n-\napp: key(a)\n';
  expect(tokenKinds('talonscript', code)).toEqual([
    ['app', 'property'],
    [':', 'punctuation.delimiter'],
    ['vscode', 'string'],
    ['and not', 'keyword.operator'],
    ['tag', 'property'],
    [':', 'punctuation.delimiter'],
    ['user.tabs', 'string'],
    ['win.title', 'property'],
    [':', 'punctuation.delimiter'],
    ['/\\.py$/', 'string.regex'],
    ['-', 'punctuation.special'],
    // after the header, the same shape is a rule
    ['app', 'string.special'],
    [':', 'punctuation.delimiter'],
    ['key', 'function'],
    ['(', 'punctuation.bracket'],
    ['a', 'constant'],
    [')', 'punctuation.bracket'],
  ]);
  assertLineFedParity('talonscript', code);
});

test('talonscript: spoken forms, captures, lists, and triggers', () => {
  expect(
    tokenKinds(
      'talonscript',
      '^go [to] (line | row) <number> {user.dir}$: edit.go(number)\nface(smile): skip()\nkey(ctrl-a shift-b): x'
    )
  ).toEqual([
    ['^', 'operator'],
    ['go', 'string.special'],
    ['[', 'punctuation.bracket'],
    ['to', 'string.special'],
    ['] (', 'punctuation.bracket'],
    ['line', 'string.special'],
    ['|', 'operator'],
    ['row', 'string.special'],
    [')', 'punctuation.bracket'],
    ['<number>', 'variable.parameter'],
    ['{user.dir}', 'variable.special'],
    ['$', 'operator'],
    [':', 'punctuation.delimiter'],
    ['edit.go', 'function'],
    ['(', 'punctuation.bracket'],
    ['number', 'variable'],
    [')', 'punctuation.bracket'],
    ['face', 'keyword'],
    ['(', 'punctuation.bracket'],
    ['smile', 'constant'],
    [')', 'punctuation.bracket'],
    [':', 'punctuation.delimiter'],
    ['skip', 'function'],
    ['()', 'punctuation.bracket'],
    ['key', 'keyword'],
    ['(', 'punctuation.bracket'],
    ['ctrl-a shift-b', 'constant'],
    [')', 'punctuation.bracket'],
    [':', 'punctuation.delimiter'],
    ['x', 'variable'],
  ]);
});

test('talonscript: settings blocks, assignments, and strings', () => {
  const code =
    'settings():\n    speech.timeout = 0.4\nsay it:\n    x = "a {b} {{c\\n"\n    insert(x + \'!\')\n    sleep(100ms)\n';
  expect(tokenKinds('talonscript', code)).toEqual([
    ['settings', 'keyword'],
    ['()', 'punctuation.bracket'],
    [':', 'punctuation.delimiter'],
    ['speech.timeout', 'property'],
    ['=', 'operator'],
    ['0.4', 'number'],
    ['say it', 'string.special'],
    [':', 'punctuation.delimiter'],
    ['x', 'variable'],
    ['=', 'operator'],
    ['"a', 'string'],
    ['{', 'punctuation.special'],
    ['b', 'variable'],
    ['}', 'punctuation.special'],
    ['{{', 'string.escape'],
    ['c', 'string'],
    ['\\n', 'string.escape'],
    ['"', 'string'],
    ['insert', 'function'],
    ['(', 'punctuation.bracket'],
    ['x', 'variable'],
    ['+', 'operator'],
    ["'!'", 'string'],
    [')', 'punctuation.bracket'],
    ['sleep', 'function'],
    ['(', 'punctuation.bracket'],
    ['100ms', 'number'],
    [')', 'punctuation.bracket'],
  ]);
  assertLineFedParity('talonscript', code);
});

test('talonscript: triple-quoted strings span lines', () => {
  const code =
    'go:\n    insert("""one {a}\n  "two" \\\n# not a comment""")\n# comment\n';
  expect(tokenKinds('talonscript', code)).toEqual([
    ['go', 'string.special'],
    [':', 'punctuation.delimiter'],
    ['insert', 'function'],
    ['(', 'punctuation.bracket'],
    ['"""one', 'string'],
    ['{', 'punctuation.special'],
    ['a', 'variable'],
    ['}', 'punctuation.special'],
    ['"two"', 'string'],
    ['\\', 'string.escape'],
    ['# not a comment"""', 'string'],
    [')', 'punctuation.bracket'],
    ['# comment', 'comment'],
  ]);
  assertLineFedParity('talonscript', code);
  // an unclosed short string stops at the line end
  expect(tokenKinds('talonscript', 'a:\n  x = "open\n  y')).toEqual([
    ['a', 'string.special'],
    [':', 'punctuation.delimiter'],
    ['x', 'variable'],
    ['=', 'operator'],
    ['"open', 'string'],
    ['y', 'variable'],
  ]);
});
