import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('haml: tags, shorthands, attributes, and Ruby output', () => {
  expect(
    tokenKinds('haml', '%a.btn#go{href: url}(title="t" n=i)= link "x"')
  ).toEqual([
    ['%a', 'tag'],
    ['.btn', 'selector.class'],
    ['#go', 'selector.id'],
    ['{', 'punctuation.bracket'],
    ['href:', 'string.special.symbol'],
    ['url', 'variable'],
    ['}(', 'punctuation.bracket'],
    ['title', 'attribute'],
    ['=', 'operator'],
    ['"t"', 'string'],
    ['n', 'attribute'],
    ['=', 'operator'],
    ['i', 'variable'],
    [')', 'punctuation.bracket'],
    ['=', 'punctuation.special'],
    ['link', 'function'],
    ['"x"', 'string'],
  ]);
  expect(tokenKinds('haml', '.item Hello #{name}!\n%br/')).toEqual([
    ['.item', 'selector.class'],
    ['Hello', null],
    ['#{', 'punctuation.special'],
    ['name', 'variable'],
    ['}', 'punctuation.special'],
    ['!', null],
    ['%br', 'tag'],
    ['/', 'punctuation.special'],
  ]);
});

test('haml: code lines, doctype, escapes, and comments with blocks', () => {
  expect(
    tokenKinds(
      'haml',
      '!!! 5\n- if x\n  \\= text\n-# hidden\n  still hidden\n/ shown\n%p'
    )
  ).toEqual([
    ['!!! 5', 'tag.doctype'],
    ['-', 'punctuation.special'],
    ['if', 'keyword.control'],
    ['x', 'variable'],
    ['\\', 'punctuation.special'],
    ['= text', null],
    ['-# hidden', 'comment'],
    ['still hidden', 'comment'],
    ['/ shown', 'comment'],
    ['%p', 'tag'],
  ]);
});

test('haml: filters embed their language', () => {
  expect(
    tokenKinds('haml', ':javascript\n  var a = 1;\n:plain\n  #{x}\n%p')
  ).toEqual([
    [':javascript', 'keyword'],
    ['var', 'keyword.declaration'],
    ['a', 'variable'],
    ['=', 'operator'],
    ['1', 'number'],
    [';', 'punctuation.delimiter'],
    [':plain', 'keyword'],
    ['#{x}', null],
    ['%p', 'tag'],
  ]);
  expect(
    tokenKinds('haml', ':ruby\n  x = nil\n:css\n  a { color: red }')
  ).toEqual([
    [':ruby', 'keyword'],
    ['x', 'variable'],
    ['=', 'operator'],
    ['nil', 'constant.builtin'],
    [':css', 'keyword'],
    ['a', 'tag'],
    ['{', 'punctuation.bracket'],
    ['color', 'property'],
    [':', 'punctuation.delimiter'],
    ['red', 'constant.builtin'],
    ['}', 'punctuation.bracket'],
  ]);
});

test('haml: multi-line attributes, code, and bodies stream like the whole buffer', () => {
  for (const code of [
    '%a{href: "/x",\n   title: t} Link\n%p after\n',
    '%a(href="/x"\n   title=t) Link\n%p after\n',
    '= link_to "a",\n  path\n%p\n',
    ':css\n  a { /* open\n  still */ b: c }\n\n%p after\n',
    ':ruby\n  s = <<~EOS\n    text\n  EOS\n%p\n',
    ':javascript\n  const t = `a\n  b`;\n%p\n',
    ':coffee\n  ###\n  block\n  ###\n%p\n',
    '-# a\n  b\n\n  c\n%p\n',
  ]) {
    assertLineFedParity('haml', code);
  }
  expect(tokenKinds('haml', '%a{b: 1,\n   c: 2} Link')).toEqual([
    ['%a', 'tag'],
    ['{', 'punctuation.bracket'],
    ['b:', 'string.special.symbol'],
    ['1', 'number'],
    [',', 'punctuation.delimiter'],
    ['c:', 'string.special.symbol'],
    ['2', 'number'],
    ['}', 'punctuation.bracket'],
    ['Link', null],
  ]);
});
