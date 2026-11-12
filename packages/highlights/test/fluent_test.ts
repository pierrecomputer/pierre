import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('fluent: comments, messages, terms, and attributes', () => {
  const code =
    '### File\n## Group\n# Note\nhello = Hello, λ😀 <&>!\n-brand = Firefox\n    .gender = masculine\nlogin =\n    .placeholder = a@b.c\n';
  expect(tokenKinds('fluent', code)).toEqual([
    ['### File', 'comment.doc'],
    ['## Group', 'comment.doc'],
    ['# Note', 'comment'],
    ['hello', 'property'],
    ['=', 'operator'],
    ['Hello, λ😀 <&>!', 'string'],
    ['-brand', 'constant'],
    ['=', 'operator'],
    ['Firefox', 'string'],
    ['.gender', 'attribute'],
    ['=', 'operator'],
    ['masculine', 'string'],
    ['login', 'property'],
    ['=', 'operator'],
    ['.placeholder', 'attribute'],
    ['=', 'operator'],
    ['a@b.c', 'string'],
  ]);
  // a `.` or `#` inside a value line is text
  expect(tokenKinds('fluent', 'a = x\n  .y is text # too\n')).toEqual([
    ['a', 'property'],
    ['=', 'operator'],
    ['x', 'string'],
    ['.y', 'attribute'],
    ['is text # too', 'string'],
  ]);
});

test('fluent: placeables with variables, references, calls, and literals', () => {
  expect(
    tokenKinds(
      'fluent',
      'a = { $user }, { -brand }, { msg.attr }, { NUMBER($n, style: "percent") }, { "\\u00A0" }, { -1.5 }'
    )
  ).toEqual([
    ['a', 'property'],
    ['=', 'operator'],
    ['{', 'punctuation.special'],
    ['$user', 'variable'],
    ['}', 'punctuation.special'],
    [',', 'string'],
    ['{', 'punctuation.special'],
    ['-brand', 'constant'],
    ['}', 'punctuation.special'],
    [',', 'string'],
    ['{', 'punctuation.special'],
    ['msg', 'property'],
    ['.attr', 'attribute'],
    ['}', 'punctuation.special'],
    [',', 'string'],
    ['{', 'punctuation.special'],
    ['NUMBER', 'function'],
    ['(', 'punctuation.bracket'],
    ['$n', 'variable'],
    [',', 'punctuation.delimiter'],
    ['style', 'variable.parameter'],
    [':', 'punctuation.delimiter'],
    ['"percent"', 'string'],
    [')', 'punctuation.bracket'],
    ['}', 'punctuation.special'],
    [',', 'string'],
    ['{', 'punctuation.special'],
    ['"', 'string'],
    ['\\u', 'string.escape'],
    ['00A0"', 'string'],
    ['}', 'punctuation.special'],
    [',', 'string'],
    ['{', 'punctuation.special'],
    ['-1.5', 'number'],
    ['}', 'punctuation.special'],
  ]);
});

test('fluent: selectors span lines and hold text variants', () => {
  const code =
    'emails =\n    { $n ->\n        [one] One { $n } email.\n       *[other] Many emails.\n    }\nnext = x\n';
  expect(tokenKinds('fluent', code)).toEqual([
    ['emails', 'property'],
    ['=', 'operator'],
    ['{', 'punctuation.special'],
    ['$n', 'variable'],
    ['->', 'operator'],
    ['[', 'punctuation.bracket'],
    ['one', 'label'],
    [']', 'punctuation.bracket'],
    ['One', 'string'],
    ['{', 'punctuation.special'],
    ['$n', 'variable'],
    ['}', 'punctuation.special'],
    ['email.', 'string'],
    ['*', 'operator'],
    ['[', 'punctuation.bracket'],
    ['other', 'label'],
    [']', 'punctuation.bracket'],
    ['Many emails.', 'string'],
    ['}', 'punctuation.special'],
    ['next', 'property'],
    ['=', 'operator'],
    ['x', 'string'],
  ]);
  assertLineFedParity('fluent', code);
  // variants on the selector line; a new entry ends an unclosed placeable
  const inline = 'a = { $n -> [0] none *[other] { $n } x }\nb = { $x\nc = y\n';
  expect(tokenKinds('fluent', inline)).toEqual([
    ['a', 'property'],
    ['=', 'operator'],
    ['{', 'punctuation.special'],
    ['$n', 'variable'],
    ['->', 'operator'],
    ['[', 'punctuation.bracket'],
    ['0', 'number'],
    [']', 'punctuation.bracket'],
    ['none', 'string'],
    ['*', 'operator'],
    ['[', 'punctuation.bracket'],
    ['other', 'label'],
    [']', 'punctuation.bracket'],
    ['{', 'punctuation.special'],
    ['$n', 'variable'],
    ['}', 'punctuation.special'],
    ['x', 'string'],
    ['}', 'punctuation.special'],
    ['b', 'property'],
    ['=', 'operator'],
    ['{', 'punctuation.special'],
    ['$x', 'variable'],
    ['c', 'property'],
    ['=', 'operator'],
    ['y', 'string'],
  ]);
  assertLineFedParity('fluent', inline);
});
