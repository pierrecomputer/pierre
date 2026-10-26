import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('asciidoc: titles, attributes, comments, and delimited blocks', () => {
  const code =
    '= T\n== S *b*\n:k: v\n:n!:\n// c\n////\nx *y*\n////\n[source,js]\n----\na *b*\n-----\n----\nz\n';
  expect(tokenKinds('asciidoc', code)).toEqual([
    ['= T', 'title'],
    ['== S *b*', 'title'],
    [':k:', 'property'],
    ['v', null],
    [':n!:', 'property'],
    ['// c', 'comment'],
    ['////', 'punctuation.markup'],
    ['x *y*', 'comment'],
    ['////', 'punctuation.markup'],
    ['[', 'punctuation.bracket'],
    ['source,js', 'attribute'],
    [']', 'punctuation.bracket'],
    ['----', 'punctuation.markup'],
    ['a *b*', 'text.literal'],
    // only a delimiter of the same length closes the block
    ['-----', 'text.literal'],
    ['----', 'punctuation.markup'],
    ['z', null],
  ]);
  assertLineFedParity('asciidoc', code);
});

test('asciidoc: constrained and unconstrained inline markup', () => {
  expect(
    tokenKinds(
      'asciidoc',
      '*b* **u**x _i_ __j__k `m` ``n``o #h# ##g##q a*b*c snake_case_x \\*no* {at} {no <<id,t>> <<x'
    )
  ).toEqual([
    ['*b* **u**', 'emphasis.strong'],
    ['x', null],
    ['_i_ __j__', 'emphasis'],
    ['k', null],
    ['`m` ``n``', 'text.literal'],
    ['o', null],
    ['#h# ##g##', 'string.special'],
    ['q a*b*c snake_case_x', null],
    ['\\*', 'string.escape'],
    ['no*', null],
    ['{at}', 'variable.special'],
    ['{no', null],
    ['<<id,t>>', 'link_text'],
    ['<<x', null],
  ]);
  // a letter of any script before a single marker keeps it text
  expect(tokenKinds('asciidoc', 'é*x* 日本*語*です *ok*')).toEqual([
    ['é*x* 日本*語*です', null],
    ['*ok*', 'emphasis.strong'],
  ]);
});

test('asciidoc: links, macros, admonitions, lists, and tables', () => {
  expect(
    tokenKinds(
      'asciidoc',
      'see https://a.b[t] and link:p.html[P] kbd:[C]\nimage::i.png[]\nWARNING: w\nTODO: t\n.Title\n. one\n** b\n1. c\n<1> e\nTerm:: def\n|===\n|a|b\n|===\n--\n+\n'
    )
  ).toEqual([
    ['see', null],
    ['https://a.b', 'link_uri'],
    ['[', 'punctuation.bracket'],
    ['t', 'string'],
    [']', 'punctuation.bracket'],
    ['and', null],
    ['link:', 'function'],
    ['p.html', 'link_uri'],
    ['[', 'punctuation.bracket'],
    ['P', 'string'],
    [']', 'punctuation.bracket'],
    ['kbd:', 'function'],
    ['[', 'punctuation.bracket'],
    ['C', 'string'],
    [']', 'punctuation.bracket'],
    ['image::', 'function'],
    ['i.png', 'link_uri'],
    ['[]', 'punctuation.bracket'],
    ['WARNING:', 'keyword'],
    ['w', null],
    ['TODO: t', null],
    ['.Title', 'label'],
    ['.', 'punctuation.list_marker'],
    ['one', null],
    ['**', 'punctuation.list_marker'],
    ['b', null],
    ['1.', 'punctuation.list_marker'],
    ['c', null],
    ['<1>', 'punctuation.list_marker'],
    ['e', null],
    ['Term', 'property'],
    ['::', 'punctuation.special'],
    ['def', null],
    ['|===', 'punctuation.markup'],
    ['|', 'punctuation.markup'],
    ['a', null],
    ['|', 'punctuation.markup'],
    ['b', null],
    ['|===', 'punctuation.markup'],
    ['--', 'punctuation.markup'],
    ['+', 'punctuation.markup'],
  ]);
});

test('asciidoc: an indented paragraph after a blank line is literal', () => {
  const code = 'text\n  more\n\n  literal *x*\n still\n\nafter\n';
  expect(tokenKinds('asciidoc', code)).toEqual([
    ['text', null],
    ['more', null],
    ['literal *x*', 'text.literal'],
    ['still', 'text.literal'],
    ['after', null],
  ]);
  assertLineFedParity('asciidoc', code);
});
