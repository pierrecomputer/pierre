import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('ini: sections, keys, separators, and full-line comments', () => {
  expect(
    tokenKinds('ini', '; top\n[Unit]\nDescription = Web server\n# end\n')
  ).toEqual([
    ['; top', 'comment'],
    ['[', 'punctuation.bracket'],
    ['Unit', 'type'],
    [']', 'punctuation.bracket'],
    ['Description', 'property'],
    ['=', 'operator'],
    ['Web server', null],
    ['# end', 'comment'],
  ]);
  expect(tokenKinds('ini', 'host: example.com:8080')).toEqual([
    ['host', 'property'],
    [':', 'operator'],
    ['example.com:8080', null],
  ]);
  // a separator or comment marker inside a value is plain text
  expect(tokenKinds('ini', 'a = b = c ; not a comment')).toEqual([
    ['a', 'property'],
    ['=', 'operator'],
    ['b = c ; not a comment', null],
  ]);
});

test('ini: whole-value numbers and booleans, quoted strings, and escapes', () => {
  for (const [value, kind] of [
    ['8080', 'number'],
    ['-1.5', 'number'],
    ['.5', null],
    ['5.', null],
    ['true', 'boolean'],
    ['No', 'boolean'],
    ['OFF', 'boolean'],
    ['8080s', null],
    ['1.2.3', null],
    ['+', null],
    ['yesterday', null],
  ] as const) {
    expect(tokenKinds('ini', `key=${value}`)).toEqual([
      ['key', 'property'],
      ['=', 'operator'],
      [value, kind],
    ]);
  }
  expect(tokenKinds('ini', 'msg = say "hi\\tthere" now')).toEqual([
    ['msg', 'property'],
    ['=', 'operator'],
    ['say', null],
    ['"hi', 'string'],
    ['\\t', 'string.escape'],
    ['there"', 'string'],
    ['now', null],
  ]);
  // an apostrophe opens a string only at the start of a value
  expect(tokenKinds('ini', "a='quoted'\nb=don't")).toEqual([
    ['a', 'property'],
    ['=', 'operator'],
    ["'quoted'", 'string'],
    ['b', 'property'],
    ['=', 'operator'],
    ["don't", null],
  ]);
});

test('ini: section headers with quoted names and trailing comments', () => {
  expect(tokenKinds('ini', '[remote "origin"] ; git\n[Desktop Entry]')).toEqual(
    [
      ['[', 'punctuation.bracket'],
      ['remote', 'type'],
      ['"origin"', 'string'],
      [']', 'punctuation.bracket'],
      ['; git', 'comment'],
      ['[', 'punctuation.bracket'],
      ['Desktop Entry', 'type'],
      [']', 'punctuation.bracket'],
    ]
  );
  // an unclosed header stops at the line break
  expect(tokenKinds('ini', '[open\nkey=1')).toEqual([
    ['[', 'punctuation.bracket'],
    ['open', 'type'],
    ['key', 'property'],
    ['=', 'operator'],
    ['1', 'number'],
  ]);
});

test('ini: properties-style comments, bare keys, and continued values', () => {
  expect(tokenKinds('ini', '! note\nkey value here\nflag')).toEqual([
    ['! note', 'comment'],
    ['key', 'property'],
    ['value here', null],
    ['flag', 'property'],
  ]);
  const code = 'list = one, \\\n  two, \\\\\nnext=1\n';
  expect(tokenKinds('ini', code)).toEqual([
    ['list', 'property'],
    ['=', 'operator'],
    ['one, \\', null],
    ['two, \\\\', null],
    ['next', 'property'],
    ['=', 'operator'],
    ['1', 'number'],
  ]);
  assertLineFedParity('ini', code);
});

test('ini: a blank line ends a continued value', () => {
  const code = 'a=first \\\n\nPort = 8080\n';
  expect(tokenKinds('ini', code)).toEqual([
    ['a', 'property'],
    ['=', 'operator'],
    ['first \\', null],
    ['Port', 'property'],
    ['=', 'operator'],
    ['8080', 'number'],
  ]);
  assertLineFedParity('ini', code);
  assertLineFedParity('ini', 'a=first \\\r\n  \r\nPort = 8080\r\n');
});
