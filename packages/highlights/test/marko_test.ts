import { expect, test } from 'bun:test';

import { codeToTokens, createHighlighter } from '../lib/core';
import { initEmitter } from '../lib/highlighter';
import languages from '../lib/languages';
import { transformLexer, transformWat, wat2wasm } from '../scripts/build';
import { samples } from './_samples';
import {
  assertLineFedParity,
  distinctTheme,
  initFullModule,
  tokenKinds,
} from './_util';

test('marko: tags with shorthands, JavaScript attribute values, and placeholders', () => {
  expect(
    tokenKinds(
      'marko',
      '<div.card#main class=["a", b] data-x=y.z key="k-${id}">Hi ${name}! $!{raw}</div>'
    )
  ).toEqual([
    ['<', 'punctuation.bracket.html'],
    ['div', 'tag'],
    ['.card', 'selector.class'],
    ['#main', 'selector.id'],
    ['class', 'attribute'],
    ['=', 'punctuation.delimiter.html'],
    ['[', 'punctuation.bracket'],
    ['"a"', 'string'],
    [',', 'punctuation.delimiter'],
    ['b', 'variable'],
    [']', 'punctuation.bracket'],
    ['data-x', 'attribute'],
    ['=', 'punctuation.delimiter.html'],
    ['y', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['z', 'property'],
    ['key', 'attribute'],
    ['=', 'punctuation.delimiter.html'],
    ['"k-', 'string'],
    ['${', 'punctuation.special'],
    ['id', 'variable'],
    ['}', 'punctuation.special'],
    ['"', 'string'],
    ['>', 'punctuation.bracket.html'],
    ['Hi', null],
    ['${', 'punctuation.special'],
    ['name', 'variable'],
    ['}', 'punctuation.special'],
    ['!', null],
    ['$!{', 'punctuation.special'],
    ['raw', 'variable'],
    ['}', 'punctuation.special'],
    ['</', 'punctuation.bracket.html'],
    ['div', 'tag'],
    ['>', 'punctuation.bracket.html'],
  ]);
});

test('marko: tag parameters, arguments, spreads, and tag variables', () => {
  expect(
    tokenKinds(
      'marko',
      '<for|item, i| of=list>\n  <li onClick("pick", i) ...attrs>${item}</li>\n</for>\n<if(a > 1)>x</if>\n<let/count=0/>'
    )
  ).toEqual([
    ['<', 'punctuation.bracket.html'],
    ['for', 'keyword.control'],
    ['|', 'punctuation.bracket'],
    ['item', 'variable.parameter'],
    [',', 'punctuation.delimiter'],
    ['i', 'variable.parameter'],
    ['|', 'punctuation.bracket'],
    ['of', 'attribute'],
    ['=', 'punctuation.delimiter.html'],
    ['list', 'variable'],
    ['>', 'punctuation.bracket.html'],
    ['<', 'punctuation.bracket.html'],
    ['li', 'tag'],
    ['onClick', 'attribute'],
    ['(', 'punctuation.bracket'],
    ['"pick"', 'string'],
    [',', 'punctuation.delimiter'],
    ['i', 'variable'],
    [')', 'punctuation.bracket'],
    ['...', 'operator'],
    ['attrs', 'variable'],
    ['>', 'punctuation.bracket.html'],
    ['${', 'punctuation.special'],
    ['item', 'variable'],
    ['}', 'punctuation.special'],
    ['</', 'punctuation.bracket.html'],
    ['li', 'tag'],
    ['>', 'punctuation.bracket.html'],
    ['</', 'punctuation.bracket.html'],
    ['for', 'keyword.control'],
    ['>', 'punctuation.bracket.html'],
    ['<', 'punctuation.bracket.html'],
    ['if', 'keyword.control'],
    ['(', 'punctuation.bracket'],
    ['a', 'variable'],
    ['>', 'operator'],
    ['1', 'number'],
    [')', 'punctuation.bracket'],
    ['>', 'punctuation.bracket.html'],
    ['x', null],
    ['</', 'punctuation.bracket.html'],
    ['if', 'keyword.control'],
    ['>', 'punctuation.bracket.html'],
    ['<', 'punctuation.bracket.html'],
    ['let', 'tag'],
    ['/', 'operator'],
    ['count', 'variable'],
    ['=', 'punctuation.delimiter.html'],
    ['0', 'number'],
    ['/>', 'punctuation.bracket.html'],
  ]);
});

test('marko: root statements, scriptlets, classes, and style blocks', () => {
  expect(
    tokenKinds(
      'marko',
      'import x from "./x";\nstatic const N = 1;\n$ const y = N * 2;\nclass {\n  onCreate() {}\n}\nstyle.scss {\n  .a { color: red; }\n}\n'
    )
  ).toEqual([
    ['import', 'keyword.import'],
    ['x', 'variable'],
    ['from', 'keyword.import'],
    ['"./x"', 'string'],
    [';', 'punctuation.delimiter'],
    ['static', 'keyword'],
    ['const', 'keyword.declaration'],
    ['N', 'constant'],
    ['=', 'operator'],
    ['1', 'number'],
    [';', 'punctuation.delimiter'],
    ['$', 'punctuation.special'],
    ['const', 'keyword.declaration'],
    ['y', 'variable'],
    ['=', 'operator'],
    ['N', 'constant'],
    ['*', 'operator'],
    ['2', 'number'],
    [';', 'punctuation.delimiter'],
    ['class', 'keyword.declaration'],
    ['{', 'punctuation.bracket'],
    ['onCreate', 'function'],
    ['() {}', 'punctuation.bracket'],
    ['}', 'punctuation.bracket'],
    ['style', 'keyword'],
    ['.scss', 'attribute'],
    ['{', 'punctuation.bracket'],
    ['.a', 'selector.class'],
    ['{', 'punctuation.bracket'],
    ['color', 'property'],
    [':', 'punctuation.delimiter'],
    ['red', 'constant.builtin'],
    [';', 'punctuation.delimiter'],
    ['}', 'punctuation.bracket'],
    ['}', 'punctuation.bracket'],
  ]);
});

test('marko: method bodies, multi-line values, dynamic tags, and raw text', () => {
  expect(
    tokenKinds(
      'marko',
      '<button onClick() {\n  count++;\n}>+</button>\n<my-tag items=[\n  1,\n  2\n]/>\n<${dyn} a=1/>\n<!-- c -->\n<script>\n  let a = 1;\n</script>'
    )
  ).toEqual([
    ['<', 'punctuation.bracket.html'],
    ['button', 'tag'],
    ['onClick', 'attribute'],
    ['() {', 'punctuation.bracket'],
    ['count', 'variable'],
    ['++', 'operator'],
    [';', 'punctuation.delimiter'],
    ['}', 'punctuation.bracket'],
    ['>', 'punctuation.bracket.html'],
    ['+', null],
    ['</', 'punctuation.bracket.html'],
    ['button', 'tag'],
    ['>', 'punctuation.bracket.html'],
    ['<', 'punctuation.bracket.html'],
    ['my-tag', 'tag'],
    ['items', 'attribute'],
    ['=', 'punctuation.delimiter.html'],
    ['[', 'punctuation.bracket'],
    ['1', 'number'],
    [',', 'punctuation.delimiter'],
    ['2', 'number'],
    [']', 'punctuation.bracket'],
    ['/>', 'punctuation.bracket.html'],
    ['<', 'punctuation.bracket.html'],
    ['${', 'punctuation.special'],
    ['dyn', 'variable'],
    ['}', 'punctuation.special'],
    ['a', 'attribute'],
    ['=', 'punctuation.delimiter.html'],
    ['1', 'number'],
    ['/>', 'punctuation.bracket.html'],
    ['<!-- c -->', 'comment'],
    ['<', 'punctuation.bracket.html'],
    ['script', 'tag'],
    ['>', 'punctuation.bracket.html'],
    ['let', 'keyword.declaration'],
    ['a', 'variable'],
    ['=', 'operator'],
    ['1', 'number'],
    [';', 'punctuation.delimiter'],
    ['</', 'punctuation.bracket.html'],
    ['script', 'tag'],
    ['>', 'punctuation.bracket.html'],
  ]);
});

test('marko: values, placeholders, statements, and blocks keep line-fed parity', () => {
  for (const code of [
    samples.marko.code,
    '<a x=`a\n${b}\nc` y=(1,\n2)>${f(\n1)}</a>\n',
    '$ {\n  const a = [\n    1];\n}\nstyle {\n  .a {\n    color: red;\n  }\n}\n<p>x</p>\n',
    '<div // note\n  /* c\n  */ a=1\n  b=2>\n</div>\n<style>\n.a {}\n</style>\n',
    'export const a = {\n  b: 1,\n};\n<p a=b + c d=e ? f : g/>\n',
  ]) {
    assertLineFedParity('marko', code);
  }
  // a value continues across an operator; a blank ends it otherwise
  expect(tokenKinds('marko', '<p a=b + c d/>').map(([t]) => t)).toEqual([
    '<',
    'p',
    'a',
    '=',
    'b',
    '+',
    'c',
    'd',
    '/>',
  ]);
});

test('marko: style.less and style.scss blocks use their dialect', () => {
  const kinds = tokenKinds(
    'marko',
    'style.less {\n  @c: red; // }\n  .x { color: @c; }\n}\n<p>x</p>\nstyle.scss {\n  $c: red;\n}\n'
  );
  expect(kinds.filter(([text]) => text === '@c' || text === '$c')).toEqual([
    ['@c', 'variable'],
    ['@c', 'variable'],
    ['$c', 'variable'],
  ]);
  expect(kinds).toContainEqual(['p', 'tag']);
});

test('marko: a standalone style block ends at its own brace', async () => {
  const lexer = (name: string) => ({
    name,
    aliases: Object.fromEntries(
      Object.entries(languages).filter(
        ([, id]) => id === languages[name as keyof typeof languages]
      )
    ),
    wasm: new WebAssembly.Module(
      wat2wasm(`${name}.wat`, transformLexer([name]).code)
    ),
  });
  const emitter = new URL('../src/emitter.wat', import.meta.url);
  initEmitter(
    new WebAssembly.Module(
      wat2wasm(emitter.pathname, transformWat(emitter).code)
    )
  );
  const highlighter = await createHighlighter({
    langs: [lexer('marko'), lexer('css'), lexer('less')],
    themes: [distinctTheme],
  });
  initFullModule();
  for (const code of [
    'style {\n  .a::after { content: "}"; }\n  /* }\n } */ .b { color: red }\n}\n<p>x</p>\n',
    'style.less {\n  @c: red; // }\n}\n<p>x</p>\n',
    'style{c\\}\n}\n<p>x</p>\n',
  ]) {
    expect(
      highlighter.codeToTokens(code, {
        lang: 'marko',
        theme: distinctTheme.name,
      }).tokens
    ).toEqual(
      codeToTokens(code, { lang: 'marko', theme: distinctTheme }).tokens
    );
  }
}, 120000);
