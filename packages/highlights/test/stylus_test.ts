import { expect, test } from 'bun:test';

import { assertLineFedParity, tokenKinds } from './_util';

test('stylus: indented selectors and properties without colons', () => {
  const code =
    'nav\n  ul li\n    display block\n    margin 0 auto\n    text-align: center\n' +
    '    a:hover\n      color:red\n';
  expect(tokenKinds('stylus', code)).toEqual([
    ['nav', 'tag'],
    // a word that names no property keeps a nested line a selector
    ['ul li', 'tag'],
    ['display', 'property'],
    ['block', 'constant.builtin'],
    ['margin', 'property'],
    ['0', 'number'],
    ['auto', 'constant.builtin'],
    ['text-align', 'property'],
    [':', 'punctuation.delimiter'],
    ['center', 'constant.builtin'],
    ['a', 'tag'],
    [':hover', 'selector.pseudo'],
    ['color', 'property'],
    [':', 'punctuation.delimiter'],
    ['red', 'constant.builtin'],
  ]);
  assertLineFedParity('stylus', code);
});

test('stylus: assignments, mixins, control flow, and interpolation', () => {
  const code =
    '$size = 10px\ngap ?= 4px\npad(n)\n  padding n (n * 2)\n.btn\n  pad(5px)\n' +
    '  unless $size is 10px\n    width 50% if true\n  else if $size\n    return\n' +
    'for i in 1..3\n  .m-{i}\n    margin-top i\n.a { color: #fff; }\n';
  expect(tokenKinds('stylus', code)).toEqual([
    ['$size', 'variable'],
    ['=', 'operator'],
    ['10px', 'number'],
    ['gap', 'variable'],
    ['?=', 'operator'],
    ['4px', 'number'],
    ['pad', 'function'],
    ['(', 'punctuation.bracket'],
    ['n', 'constant.builtin'],
    [')', 'punctuation.bracket'],
    ['padding', 'property'],
    ['n', 'constant.builtin'],
    ['(', 'punctuation.bracket'],
    ['n', 'constant.builtin'],
    ['*', 'operator'],
    ['2', 'number'],
    [')', 'punctuation.bracket'],
    ['.btn', 'selector.class'],
    ['pad', 'function'],
    ['(', 'punctuation.bracket'],
    ['5px', 'number'],
    [')', 'punctuation.bracket'],
    ['unless', 'keyword.control'],
    ['$size', 'variable'],
    ['is', 'keyword.operator'],
    ['10px', 'number'],
    ['width', 'property'],
    ['50%', 'number'],
    ['if', 'keyword.control'],
    ['true', 'boolean'],
    ['else if', 'keyword.control'],
    ['$size', 'variable'],
    ['return', 'keyword.control'],
    ['for', 'keyword.control'],
    ['i', 'constant.builtin'],
    ['in', 'keyword.operator'],
    ['1..3', 'number'],
    ['.m-', 'selector.class'],
    ['{', 'punctuation.special'],
    ['i', 'constant.builtin'],
    ['}', 'punctuation.special'],
    ['margin-top', 'property'],
    ['i', 'constant.builtin'],
    ['.a', 'selector.class'],
    ['{', 'punctuation.bracket'],
    ['color', 'property'],
    [':', 'punctuation.delimiter'],
    ['#fff', 'string.special'],
    [';', 'punctuation.delimiter'],
    ['}', 'punctuation.bracket'],
  ]);
  assertLineFedParity('stylus', code);
});

test('stylus: css braces, custom elements, and assignment operators', () => {
  const code =
    '.a{color:red}\n@media print{\n  .b{top:0}\n}\n.page\n  my-card .title\n' +
    '    color red\n  my-card > p\n  margin-top .5em\nx %= 2\ny <= 3\n';
  expect(tokenKinds('stylus', code)).toEqual([
    // `{` glued to a name opens a block; only `-{` interpolates
    ['.a', 'selector.class'],
    ['{', 'punctuation.bracket'],
    ['color', 'property'],
    [':', 'punctuation.delimiter'],
    ['red', 'constant.builtin'],
    ['}', 'punctuation.bracket'],
    ['@media', 'keyword'],
    ['print', 'constant.builtin'],
    ['{', 'punctuation.bracket'],
    ['.b', 'selector.class'],
    ['{', 'punctuation.bracket'],
    ['top', 'property'],
    [':', 'punctuation.delimiter'],
    ['0', 'number'],
    ['}', 'punctuation.bracket'],
    ['}', 'punctuation.bracket'],
    ['.page', 'selector.class'],
    // a dashed word before a selector shape is a custom element
    ['my-card', 'tag'],
    ['.title', 'selector.class'],
    ['color', 'property'],
    ['red', 'constant.builtin'],
    ['my-card', 'tag'],
    ['>', 'operator'],
    ['p', 'tag'],
    ['margin-top', 'property'],
    ['.5em', 'number'],
    ['x', 'variable'],
    ['%=', 'operator'],
    ['2', 'number'],
    // `<=` compares; it assigns nothing
    ['y', 'tag'],
    ['<', null],
    ['=', 'operator'],
    ['3', 'number'],
  ]);
  assertLineFedParity('stylus', code);
});

test('stylus: comments and strings across lines', () => {
  const code =
    '// note\n.a\n  content "x \\\n  y" /* open\n  still */\n  color red\n';
  expect(tokenKinds('stylus', code)).toEqual([
    ['// note', 'comment'],
    ['.a', 'selector.class'],
    ['content', 'property'],
    ['"x', 'string'],
    ['\\', 'string.escape'],
    ['y"', 'string'],
    ['/* open', 'comment'],
    ['still */', 'comment'],
    ['color', 'property'],
    ['red', 'constant.builtin'],
  ]);
  assertLineFedParity('stylus', code);
});

test('stylus: `<style lang="stylus">` bodies in html and vue', () => {
  const code =
    '<style lang="stylus">\n.a\n  color red\n  /* open\n  still */\n</style>\n<p>x</p>\n';
  for (const lang of ['html', 'vue'] as const) {
    expect(tokenKinds(lang, code).slice(6, 11)).toEqual([
      ['.a', 'selector.class'],
      ['color', 'property'],
      ['red', 'constant.builtin'],
      ['/* open', 'comment'],
      ['still */', 'comment'],
    ]);
    assertLineFedParity(lang, code);
  }
});
