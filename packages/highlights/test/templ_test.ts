import { expect, test } from 'bun:test';

import { samples } from './_samples';
import { assertLineFedParity, tokenKinds } from './_util';

test('templ: Go code, components, and expressions in markup', () => {
  expect(
    tokenKinds(
      'templ',
      'package views\n\ntempl (c *Card) Title(n int) {\n\t<h2 class={ c.cls }>{ fmt.Sprint(n) }</h2>\n}\n'
    )
  ).toEqual([
    ['package', 'keyword.declaration'],
    ['views', 'namespace'],
    ['templ', 'keyword.declaration'],
    ['(', 'punctuation.bracket'],
    ['c', 'variable'],
    ['*', 'operator'],
    ['Card', 'type'],
    [')', 'punctuation.bracket'],
    ['Title', 'function.definition'],
    ['(', 'punctuation.bracket'],
    ['n', 'variable'],
    ['int', 'type.builtin'],
    [') {', 'punctuation.bracket'],
    ['<', 'punctuation.bracket.html'],
    ['h2', 'tag'],
    ['class', 'attribute'],
    ['=', 'punctuation.delimiter.html'],
    ['{', 'punctuation.special'],
    ['c', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['cls', 'property'],
    ['}', 'punctuation.special'],
    ['>', 'punctuation.bracket.html'],
    ['{', 'punctuation.special'],
    ['fmt', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['Sprint', 'function.method'],
    ['(', 'punctuation.bracket'],
    ['n', 'variable'],
    [')', 'punctuation.bracket'],
    ['}', 'punctuation.special'],
    ['</', 'punctuation.bracket.html'],
    ['h2', 'tag'],
    ['>', 'punctuation.bracket.html'],
    ['}', 'punctuation.bracket'],
  ]);
});

test('templ: statements and component calls structure the body', () => {
  expect(
    tokenKinds(
      'templ',
      'templ List(xs []string) {\n\tfor _, x := range xs {\n\t\t<li>{ x }</li>\n\t}\n\tif len(xs) == 0 {\n\t\t<p>none</p>\n\t} else if ok {\n\t\t@Empty()\n\t}\n}\n'
    )
  ).toEqual([
    ['templ', 'keyword.declaration'],
    ['List', 'function.definition'],
    ['(', 'punctuation.bracket'],
    ['xs', 'variable'],
    ['[]', 'punctuation.bracket'],
    ['string', 'type.builtin'],
    [') {', 'punctuation.bracket'],
    ['for', 'keyword.control'],
    ['_', 'variable'],
    [',', 'punctuation.delimiter'],
    ['x', 'variable'],
    [':=', 'operator'],
    ['range', 'keyword.control'],
    ['xs', 'variable'],
    ['{', 'punctuation.bracket'],
    ['<', 'punctuation.bracket.html'],
    ['li', 'tag'],
    ['>', 'punctuation.bracket.html'],
    ['{', 'punctuation.special'],
    ['x', 'variable'],
    ['}', 'punctuation.special'],
    ['</', 'punctuation.bracket.html'],
    ['li', 'tag'],
    ['>', 'punctuation.bracket.html'],
    ['}', 'punctuation.bracket'],
    ['if', 'keyword.control'],
    ['len', 'function'],
    ['(', 'punctuation.bracket'],
    ['xs', 'variable'],
    [')', 'punctuation.bracket'],
    ['==', 'operator'],
    ['0', 'number'],
    ['{', 'punctuation.bracket'],
    ['<', 'punctuation.bracket.html'],
    ['p', 'tag'],
    ['>', 'punctuation.bracket.html'],
    ['none', null],
    ['</', 'punctuation.bracket.html'],
    ['p', 'tag'],
    ['>', 'punctuation.bracket.html'],
    ['}', 'punctuation.bracket'],
    ['else if', 'keyword.control'],
    ['ok', 'variable'],
    ['{', 'punctuation.bracket'],
    ['@', 'punctuation.special'],
    ['Empty', 'function'],
    ['()', 'punctuation.bracket'],
    ['}', 'punctuation.bracket'],
    ['}', 'punctuation.bracket'],
  ]);
});

test('templ: children, conditional attributes, and quoted braces', () => {
  expect(
    tokenKinds(
      'templ',
      'templ A() {\n\t@Layout("t") {\n\t\t{ children... }\n\t}\n\t<input disabled?={ off } value="{x}"/>\n}\n'
    )
  ).toEqual([
    ['templ', 'keyword.declaration'],
    ['A', 'function.definition'],
    ['() {', 'punctuation.bracket'],
    ['@', 'punctuation.special'],
    ['Layout', 'function'],
    ['(', 'punctuation.bracket'],
    ['"t"', 'string'],
    [') {', 'punctuation.bracket'],
    ['{', 'punctuation.special'],
    ['children', 'variable'],
    ['...', 'punctuation.delimiter'],
    ['}', 'punctuation.special'],
    ['}', 'punctuation.bracket'],
    ['<', 'punctuation.bracket.html'],
    ['input', 'tag'],
    ['disabled?', 'attribute'],
    ['=', 'punctuation.delimiter.html'],
    ['{', 'punctuation.special'],
    ['off', 'variable'],
    ['}', 'punctuation.special'],
    ['value', 'attribute'],
    ['=', 'punctuation.delimiter.html'],
    ['"{x}"', 'string'],
    ['/>', 'punctuation.bracket.html'],
    ['}', 'punctuation.bracket'],
  ]);
});

test('templ: css and script components', () => {
  expect(
    tokenKinds(
      'templ',
      'css box(w int) {\n\tcolor: #fff;\n\twidth: { size(w) };\n}\nscript hi(n string) {\n\tconsole.log(n);\n}\n'
    )
  ).toEqual([
    ['css', 'keyword.declaration'],
    ['box', 'function.definition'],
    ['(', 'punctuation.bracket'],
    ['w', 'variable'],
    ['int', 'type.builtin'],
    [') {', 'punctuation.bracket'],
    ['color', 'property'],
    [':', 'punctuation.delimiter'],
    ['#fff', 'string.special'],
    [';', 'punctuation.delimiter'],
    ['width', 'property'],
    [':', 'punctuation.delimiter'],
    ['{', 'punctuation.special'],
    ['size', 'function'],
    ['(', 'punctuation.bracket'],
    ['w', 'variable'],
    [')', 'punctuation.bracket'],
    ['}', 'punctuation.special'],
    [';', 'punctuation.delimiter'],
    ['}', 'punctuation.bracket'],
    ['script', 'keyword.declaration'],
    ['hi', 'function.definition'],
    ['(', 'punctuation.bracket'],
    ['n', 'variable'],
    ['string', 'type.builtin'],
    [') {', 'punctuation.bracket'],
    ['console', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['log', 'function.method'],
    ['(', 'punctuation.bracket'],
    ['n', 'variable'],
    [')', 'punctuation.bracket'],
    [';', 'punctuation.delimiter'],
    ['}', 'punctuation.bracket'],
  ]);
});

test('templ: multi-line Go, expressions, tags, and bodies keep line-fed parity', () => {
  for (const code of [
    samples.templ.code,
    'templ A() {\n\t<script>\n\tif (a) {\n\t}\n\t</script>\n\t<div\n\t\tclass={ x(\n\t\t1) }\n\t\tid="a{b}">\n\t\t{ fmt.Sprint(\n\t\t\t"}") }\n\t</div>\n}\n',
    'var s = `a\ntempl B() {\n}\n/* c\n*/\nfunc f() {}\n',
    'css c() {\n\tcolor: red; /* x\n\t*/\n}\nscript d() {\n\tlet t = `a\n}`;\n}\n',
  ]) {
    assertLineFedParity('templ', code);
  }
  // a component header starts its line; elsewhere `templ` is a Go name
  expect(tokenKinds('templ', 'x := templ A()')[0]).toEqual(['x', 'variable']);
});

test('templ: a component line inside a Go comment or raw string stays Go', () => {
  expect(
    tokenKinds('templ', '/*\ntempl Old() {\n\t<p>old</p>\n}\n*/\nfunc f() {}\n')
  ).toEqual([
    ['/*', 'comment'],
    ['templ Old() {', 'comment'],
    ['<p>old</p>', 'comment'],
    ['}', 'comment'],
    ['*/', 'comment'],
    ['func', 'keyword.declaration'],
    ['f', 'function.definition'],
    ['() {}', 'punctuation.bracket'],
  ]);
  expect(tokenKinds('templ', 'var s = `\ntempl X() {\n`\n')).toEqual([
    ['var', 'keyword.declaration'],
    ['s', 'variable'],
    ['=', 'operator'],
    ['`', 'string'],
    ['templ X() {', 'string'],
    ['`', 'string'],
  ]);
});

test('templ: an expression skips raw strings and runes', () => {
  expect(
    tokenKinds(
      'templ',
      "templ A() {\n\t<p>{ f(`%d}`, '}', '\"') }</p>\n}\n"
    ).slice(3, 15)
  ).toEqual([
    ['<', 'punctuation.bracket.html'],
    ['p', 'tag'],
    ['>', 'punctuation.bracket.html'],
    ['{', 'punctuation.special'],
    ['f', 'function'],
    ['(', 'punctuation.bracket'],
    ['`%d}`', 'string'],
    [',', 'punctuation.delimiter'],
    ["'}'", 'string'],
    [',', 'punctuation.delimiter'],
    ["'\"'", 'string'],
    [')', 'punctuation.bracket'],
  ]);
});
