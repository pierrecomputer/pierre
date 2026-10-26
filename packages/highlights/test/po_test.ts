import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('po: comment kinds, flags, and keywords', () => {
  expect(
    tokenKinds(
      'po',
      '# note\n#. for translators\n#: src/a.c:1\n#, fuzzy, c-format\n#| msgid "old"\n#~ msgstr "gone"\n'
    )
  ).toEqual([
    ['# note', 'comment'],
    ['#. for translators', 'comment.doc'],
    ['#: src/a.c:1', 'comment'],
    ['#,', 'comment'],
    ['fuzzy', 'type'],
    [',', 'punctuation.delimiter'],
    ['c-format', 'type'],
    ['#| msgid "old"', 'comment'],
    ['#~ msgstr "gone"', 'comment'],
  ]);
  expect(
    tokenKinds(
      'po',
      'msgctxt "m"\nmsgid "a"\nmsgid_plural "b"\nmsgstr[1] "c"\nmsgidx'
    )
  ).toEqual([
    ['msgctxt', 'keyword'],
    ['"m"', 'string'],
    ['msgid', 'keyword'],
    ['"a"', 'string'],
    ['msgid_plural', 'keyword'],
    ['"b"', 'string'],
    ['msgstr', 'keyword'],
    ['[', 'punctuation.bracket'],
    ['1', 'number'],
    [']', 'punctuation.bracket'],
    ['"c"', 'string'],
    ['msgidx', null],
  ]);
});

test('po: format placeholders and escapes', () => {
  for (const placeholder of [
    '%s',
    '%d',
    '%1$s',
    '%-5.2f',
    '%lld',
    '%zu',
    '%%',
    '%(name)s',
    '%1',
    '{name}',
    '{0}',
    '{}',
  ]) {
    expect(tokenKinds('po', `msgid "a ${placeholder} b"`)).toEqual([
      ['msgid', 'keyword'],
      ['"a', 'string'],
      [placeholder, 'string.special'],
      ['b"', 'string'],
    ]);
  }
  // not placeholders: a percent sign before a blank, `{{`, an unclosed brace
  expect(tokenKinds('po', 'msgid "100% sure {{x}} {open"')).toEqual([
    ['msgid', 'keyword'],
    ['"100% sure {{x}} {open"', 'string'],
  ]);
  expect(tokenKinds('po', 'msgstr "say \\"hi\\"\\n"')).toEqual([
    ['msgstr', 'keyword'],
    ['"say', 'string'],
    ['\\"', 'string.escape'],
    ['hi', 'string'],
    ['\\"\\n', 'string.escape'],
    ['"', 'string'],
  ]);
});

test('po: strings end with their line', () => {
  // continuation strings are separate strings; an unclosed one stops at the
  // line break, and a backslash there does not join lines
  const code = 'msgid ""\n"first %s\\n"\n"open\\\nmsgstr "x"\n';
  expect(tokenKinds('po', code)).toEqual([
    ['msgid', 'keyword'],
    ['""', 'string'],
    ['"first', 'string'],
    ['%s', 'string.special'],
    ['\\n', 'string.escape'],
    ['"', 'string'],
    ['"open\\', 'string'],
    ['msgstr', 'keyword'],
    ['"x"', 'string'],
  ]);
  assertLineFedParity('po', code);
});
