import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('bibtex: entries, keys, fields, and values', () => {
  const code =
    '@Article{knuth84,\n  author = {D. Knuth},\n  title  = "The {\\TeX}book",\n' +
    '  year   = 1984, month = jan,\n  note   = acm # " Press",\n}';
  expect(tokenKinds('bibtex', code)).toEqual([
    ['@Article', 'keyword'],
    ['{', 'punctuation.bracket'],
    ['knuth84', 'constant'],
    [',', 'punctuation.delimiter'],
    ['author', 'property'],
    ['=', 'operator'],
    ['{D. Knuth}', 'string'],
    [',', 'punctuation.delimiter'],
    ['title', 'property'],
    ['=', 'operator'],
    ['"The {', 'string'],
    ['\\TeX', 'string.escape'],
    ['}book"', 'string'],
    [',', 'punctuation.delimiter'],
    ['year', 'property'],
    ['=', 'operator'],
    ['1984', 'number'],
    [',', 'punctuation.delimiter'],
    ['month', 'property'],
    ['=', 'operator'],
    ['jan', 'variable'],
    [',', 'punctuation.delimiter'],
    ['note', 'property'],
    ['=', 'operator'],
    ['acm', 'variable'],
    ['#', 'operator'],
    ['" Press"', 'string'],
    [',', 'punctuation.delimiter'],
    ['}', 'punctuation.bracket'],
  ]);
});

test('bibtex: comments, special entries, and parenthesized entries', () => {
  const code =
    '% note\nFree text @ here.\n@COMMENT{skip this}\n@preamble{ "\\newcommand" }\n' +
    '@String(acm = {ACM})\n@misc(key, title = {A (paren) title})';
  expect(tokenKinds('bibtex', code)).toEqual([
    ['% note', 'comment'],
    ['Free text @ here.', 'comment'],
    ['@COMMENT{skip this}', 'comment'],
    ['@preamble', 'keyword'],
    ['{', 'punctuation.bracket'],
    ['"', 'string'],
    ['\\newcommand', 'string.escape'],
    ['"', 'string'],
    ['}', 'punctuation.bracket'],
    ['@String', 'keyword'],
    ['(', 'punctuation.bracket'],
    ['acm', 'variable'],
    ['=', 'operator'],
    ['{ACM}', 'string'],
    [')', 'punctuation.bracket'],
    ['@misc', 'keyword'],
    ['(', 'punctuation.bracket'],
    ['key', 'constant'],
    [',', 'punctuation.delimiter'],
    ['title', 'property'],
    ['=', 'operator'],
    ['{A (paren) title}', 'string'],
    [')', 'punctuation.bracket'],
  ]);
});

test('bibtex: accents keep quotes inside braces', () => {
  // `\"` is an accent inside braces, where a quote cannot close the value
  expect(
    tokenKinds('bibtex', '@a{k, x = {{\\"o}}, y = "a {\\"o} b", z = 5}')
  ).toEqual([
    ['@a', 'keyword'],
    ['{', 'punctuation.bracket'],
    ['k', 'constant'],
    [',', 'punctuation.delimiter'],
    ['x', 'property'],
    ['=', 'operator'],
    ['{{', 'string'],
    ['\\"', 'string.escape'],
    ['o}}', 'string'],
    [',', 'punctuation.delimiter'],
    ['y', 'property'],
    ['=', 'operator'],
    ['"a {', 'string'],
    ['\\"', 'string.escape'],
    ['o} b"', 'string'],
    [',', 'punctuation.delimiter'],
    ['z', 'property'],
    ['=', 'operator'],
    ['5', 'number'],
    ['}', 'punctuation.bracket'],
  ]);
});

test('bibtex: multi-line values and truncated entries stream line by line', () => {
  const code =
    '@book{k,\n  abstract = {First {line\n    still} open\n  here},\n  % biber comment\n' +
    '  title = "two\n  lines"\n@article{next, year = 2024}\n';
  expect(tokenKinds('bibtex', code)).toEqual([
    ['@book', 'keyword'],
    ['{', 'punctuation.bracket'],
    ['k', 'constant'],
    [',', 'punctuation.delimiter'],
    ['abstract', 'property'],
    ['=', 'operator'],
    ['{First {line', 'string'],
    ['still} open', 'string'],
    ['here}', 'string'],
    [',', 'punctuation.delimiter'],
    ['% biber comment', 'comment'],
    ['title', 'property'],
    ['=', 'operator'],
    ['"two', 'string'],
    ['lines"', 'string'],
    ['@article', 'keyword'],
    ['{', 'punctuation.bracket'],
    ['next', 'constant'],
    [',', 'punctuation.delimiter'],
    ['year', 'property'],
    ['=', 'operator'],
    ['2024', 'number'],
    ['}', 'punctuation.bracket'],
  ]);
  assertLineFedParity('bibtex', code);
  assertLineFedParity('bibtex', code.replaceAll('\n', '\r\n'));
});
