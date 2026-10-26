import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('pug: tags, shorthands, attributes, and buffered code', () => {
  expect(
    tokenKinds('pug', 'a.btn#go(href=url, data-n=i * 2 disabled)= label')
  ).toEqual([
    ['a', 'tag'],
    ['.btn', 'selector.class'],
    ['#go', 'selector.id'],
    ['(', 'punctuation.bracket'],
    ['href', 'attribute'],
    ['=', 'operator'],
    ['url', 'variable'],
    [',', 'punctuation.delimiter'],
    ['data-n', 'attribute'],
    ['=', 'operator'],
    ['i', 'variable'],
    ['*', 'operator'],
    ['2', 'number'],
    ['disabled', 'attribute'],
    [')', 'punctuation.bracket'],
    ['=', 'punctuation.special'],
    ['label', 'variable'],
  ]);
  expect(tokenKinds('pug', 'li: a(href="/") Home #{n}')).toEqual([
    ['li', 'tag'],
    [':', 'punctuation.special'],
    ['a', 'tag'],
    ['(', 'punctuation.bracket'],
    ['href', 'attribute'],
    ['=', 'operator'],
    ['"/"', 'string'],
    [')', 'punctuation.bracket'],
    ['Home', null],
    ['#{', 'punctuation.special'],
    ['n', 'variable'],
    ['}', 'punctuation.special'],
  ]);
});

test('pug: keywords, mixins, code, and text', () => {
  expect(
    tokenKinds(
      'pug',
      'extends layout\nblock content\nmixin m(a, b = 1)\n+m(x)\neach v, k in obj\n- var y = 2\n| text #[b bold] \\#{no}'
    )
  ).toEqual([
    ['extends', 'keyword.import'],
    ['layout', 'string'],
    ['block', 'keyword.declaration'],
    ['content', 'variable'],
    ['mixin', 'keyword.declaration'],
    ['m', 'function.definition'],
    ['(', 'punctuation.bracket'],
    ['a', 'variable.parameter'],
    [',', 'punctuation.delimiter'],
    ['b', 'variable.parameter'],
    ['=', 'operator'],
    ['1', 'number'],
    [')', 'punctuation.bracket'],
    ['+m', 'function'],
    ['(', 'punctuation.bracket'],
    ['x', 'variable'],
    [')', 'punctuation.bracket'],
    ['each', 'keyword.control'],
    ['v', 'variable'],
    [',', 'punctuation.delimiter'],
    ['k', 'variable'],
    ['in', 'keyword.control'],
    ['obj', 'variable'],
    ['-', 'punctuation.special'],
    ['var', 'keyword.declaration'],
    ['y', 'variable'],
    ['=', 'operator'],
    ['2', 'number'],
    ['|', 'punctuation.special'],
    ['text', null],
    ['#[', 'punctuation.special'],
    ['b', 'tag'],
    ['bold', null],
    [']', 'punctuation.special'],
    ['\\#{no}', null],
  ]);
});

test('pug: comments, doctype, and dotted blocks', () => {
  expect(
    tokenKinds(
      'pug',
      'doctype html\n//- hidden\n  still hidden\np.\n  Text #{x}\nscript.\n  let a = 1\np'
    )
  ).toEqual([
    ['doctype html', 'tag.doctype'],
    ['//- hidden', 'comment'],
    ['still hidden', 'comment'],
    ['p', 'tag'],
    ['.', 'punctuation.special'],
    ['Text', null],
    ['#{', 'punctuation.special'],
    ['x', 'variable'],
    ['}', 'punctuation.special'],
    ['script', 'tag'],
    ['.', 'punctuation.special'],
    ['let', 'keyword.declaration'],
    ['a', 'variable'],
    ['=', 'operator'],
    ['1', 'number'],
    ['p', 'tag'],
  ]);
});

test('pug: multi-line attributes and bodies stream like the whole buffer', () => {
  for (const code of [
    'a(\n  href="/x"\n  title=t\n) Link\np after\n',
    'style.\n  a { /* open\n  still */ b: c }\n\np after\n',
    'script.\n  const t = `a\n  b`;\np\n',
    '-\n  var a = 1\n  var b = 2\np= a\n',
    ':coffee\n  x = """\n  y\n  """\np\n',
    '//\n  a\n\n  b\np\n',
  ]) {
    assertLineFedParity('pug', code);
  }
});
