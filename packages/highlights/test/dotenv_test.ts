import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('dotenv: keys, export, comments, and whole-value numbers and booleans', () => {
  expect(
    tokenKinds(
      'dotenv',
      '# settings\nexport PORT=8080\nDEBUG = true\nNAME=web app # note\n'
    )
  ).toEqual([
    ['# settings', 'comment'],
    ['export', 'keyword'],
    ['PORT', 'variable'],
    ['=', 'operator'],
    ['8080', 'number'],
    ['DEBUG', 'variable'],
    ['=', 'operator'],
    ['true', 'boolean'],
    ['NAME', 'variable'],
    ['=', 'operator'],
    ['web app', null],
    ['# note', 'comment'],
  ]);
  // `#` without a blank before it stays in the value, and an empty value is fine
  expect(
    tokenKinds('dotenv', 'URL=http://x/#top\nEMPTY=\napp.key-1=v')
  ).toEqual([
    ['URL', 'variable'],
    ['=', 'operator'],
    ['http://x/#top', null],
    ['EMPTY', 'variable'],
    ['=', 'operator'],
    ['app.key-1', 'variable'],
    ['=', 'operator'],
    ['v', null],
  ]);
});

test('dotenv: quotes, escapes, and expansions', () => {
  expect(
    tokenKinds(
      'dotenv',
      'A="x\\n${HOME:-/root} $USER" # c\nB=\'$RAW\\n\'\nC=$HOST:8080'
    )
  ).toEqual([
    ['A', 'variable'],
    ['=', 'operator'],
    ['"x', 'string'],
    ['\\n', 'string.escape'],
    ['${', 'punctuation.special'],
    ['HOME:-/root', 'variable'],
    ['}', 'punctuation.special'],
    ['$USER', 'variable'],
    ['"', 'string'],
    ['# c', 'comment'],
    ['B', 'variable'],
    ['=', 'operator'],
    ["'$RAW\\n'", 'string'],
    ['C', 'variable'],
    ['=', 'operator'],
    ['$HOST', 'variable'],
    [':8080', null],
  ]);
  // a `$` without a name stays string text
  expect(tokenKinds('dotenv', 'P="$ 5"')).toEqual([
    ['P', 'variable'],
    ['=', 'operator'],
    ['"$ 5"', 'string'],
  ]);
});

test('dotenv: quoted values span lines', () => {
  const code =
    'KEY="-----BEGIN-----\n# not a comment\n$PART\n-----END-----" # tail\nNEXT=1\n';
  expect(tokenKinds('dotenv', code)).toEqual([
    ['KEY', 'variable'],
    ['=', 'operator'],
    ['"-----BEGIN-----', 'string'],
    ['# not a comment', 'string'],
    ['$PART', 'variable'],
    ['-----END-----"', 'string'],
    ['# tail', 'comment'],
    ['NEXT', 'variable'],
    ['=', 'operator'],
    ['1', 'number'],
  ]);
  assertLineFedParity('dotenv', code);
  assertLineFedParity('dotenv', "A='one\ntwo'\nB=`x\ny`\nC=2\n");
});
