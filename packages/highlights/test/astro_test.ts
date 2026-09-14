import assert from 'node:assert';
import t from 'node:test';

import {
  assertLineFedParity,
  checkInvariants,
  colorOf,
  distinctColor,
  distinctTheme,
  exactColor,
  lineFedTokens,
  loadLang,
  type TestLang,
  themeColor,
  tokenKinds,
} from './_util';

let astro: TestLang;
t.before(() => (astro = loadLang('astro', '$hlAstro')));

/** Highlight under the distinct theme after checking the lexer invariants. */
const hl = (src: string) =>
  checkInvariants(astro.hl, src, { theme: distinctTheme });

const TAG = themeColor('tag');
const ATTR = themeColor('attribute');
const VARIABLE = themeColor('variable');
const KEYWORD = themeColor('keyword');
const TYPE = themeColor('type.builtin');
const CSS_PROPERTY = themeColor('property');

void t.test('astro: front matter, HTML, and template expressions', () => {
  const src =
    '---\nconst title: string = "Home";\n---\n<main class="page"><h1>{pageTitle}</h1></main>';
  const out = checkInvariants(astro.hl, src);
  assert.equal(colorOf(out, 'const'), KEYWORD);
  assert.equal(colorOf(out, 'string'), TYPE);
  assert.equal(colorOf(out, 'main'), TAG);
  assert.equal(colorOf(out, 'class'), ATTR);
  assert.equal(colorOf(out, 'pageTitle'), VARIABLE);
});

void t.test('astro: script and style bodies remain embedded languages', () => {
  const src =
    '<script>const value = 1;</script><style>.box { color: red; }</style>{afterValue}';
  const out = checkInvariants(astro.hl, src);
  assert.equal(colorOf(out, 'const'), KEYWORD);
  assert.equal(colorOf(out, 'color'), CSS_PROPERTY);
  assert.equal(colorOf(out, 'afterValue'), VARIABLE);
});

void t.test(
  'astro: front matter is TypeScript and opens only at the document start',
  () => {
    const kinds = tokenKinds(
      'astro',
      '---\nconst a: number = 1;\n---\n<Card a={a} />'
    );
    assert.deepEqual(kinds.slice(0, 16), [
      ['---', 'punctuation.special'],
      ['const', 'keyword.declaration'],
      ['a', 'variable'],
      [':', 'punctuation.special'],
      ['number', 'type.builtin'],
      ['=', 'operator'],
      ['1', 'number'],
      [';', 'punctuation.delimiter'],
      ['---', 'punctuation.special'],
      ['<', 'punctuation.bracket.html'],
      ['Card', 'tag'],
      ['a', 'attribute'],
      ['=', 'punctuation.delimiter.html'],
      ['{', 'punctuation.bracket'],
      ['a', 'variable'],
      ['}', 'punctuation.bracket'],
    ]);
    // a `---` line later in the document is plain text
    assert.deepEqual(
      tokenKinds('astro', '<p>x</p>\n---\nconst y = 1\n---').slice(7),
      [
        ['---', null],
        ['const y = 1', null],
        ['---', null],
      ]
    );
    const html = hl("---\nimport Card from './card.astro';\n---");
    assert.equal(exactColor(html, 'import'), distinctColor('keyword.import'));
    assert.equal(exactColor(html, "'./card.astro'"), distinctColor('string'));
  }
);

void t.test('astro: JSX elements inside an expression stay inside it', () => {
  // the expression scanner once read `</li>` as `<` and a regexp, so the
  // closing brace was swallowed, `</ul>` lexed as JavaScript, and line-fed
  // streaming dropped the whole line
  const code =
    '<ul>\n  {items.map((item) => <li key={item}>{item}</li>)}\n</ul>\n';
  assert.deepEqual(tokenKinds('astro', code), [
    ['<', 'punctuation.bracket.html'],
    ['ul', 'tag'],
    ['>', 'punctuation.bracket.html'],
    ['{', 'punctuation.bracket'],
    ['items', 'variable'],
    ['.', 'punctuation.delimiter'],
    ['map', 'function.method'],
    ['((', 'punctuation.bracket'],
    ['item', 'variable.parameter'],
    [')', 'punctuation.bracket'],
    ['=>', 'operator'],
    ['<', 'punctuation.bracket.jsx'],
    ['li', 'tag.jsx'],
    ['key', 'attribute.jsx'],
    ['=', 'punctuation.delimiter.jsx'],
    ['{', 'punctuation.bracket'],
    ['item', 'variable'],
    ['}', 'punctuation.bracket'],
    ['>', 'punctuation.bracket.jsx'],
    ['{', 'punctuation.bracket'],
    ['item', 'variable'],
    ['}', 'punctuation.bracket'],
    ['</', 'punctuation.bracket.jsx'],
    ['li', 'tag.jsx'],
    ['>', 'punctuation.bracket.jsx'],
    [')}', 'punctuation.bracket'],
    ['</', 'punctuation.bracket.html'],
    ['ul', 'tag'],
    ['>', 'punctuation.bracket.html'],
  ]);
  for (const src of [
    code,
    '<ul>{<li>x</li>}</ul>\n<p>{cond ? <b>yes</b> : <i>no</i>}</p>\n',
    '<p>{list.map((x) => <a href={x.url}>{x.name}</a>)}</p>\n<footer>{year}</footer>\n',
    '<div>{a}{<b/>}{c}</div>\n',
  ]) {
    assertLineFedParity('astro', src);
    // line-fed streaming must keep every byte even where it cannot agree
    const rebuilt = lineFedTokens('astro', src)
      .map((line) => line.map((tok) => tok.content).join(''))
      .join('\n');
    assert.equal(rebuilt, src, JSON.stringify(src));
  }
});

void t.test('astro: spread and expression attribute values', () => {
  const kinds = tokenKinds('astro', '<div {...rest} set:html={html}></div>');
  assert.deepEqual(kinds.slice(0, 6), [
    ['<', 'punctuation.bracket.html'],
    ['div', 'tag'],
    ['{', 'punctuation.bracket'],
    ['...', 'operator'],
    ['rest', 'variable'],
    ['}', 'punctuation.bracket'],
  ]);
  assert.ok(
    kinds.some(([text, kind]) => text === 'html' && kind === 'variable')
  );
  assert.deepEqual(kinds.slice(-3), [
    ['</', 'punctuation.bracket.html'],
    ['div', 'tag'],
    ['>', 'punctuation.bracket.html'],
  ]);
});

void t.test('astro: components, fragments, and dotted names are tags', () => {
  assert.deepEqual(
    tokenKinds('astro', '<Fragment slot="x"><slot /></Fragment>\n<Comp.Sub />'),
    [
      ['<', 'punctuation.bracket.html'],
      ['Fragment', 'tag'],
      ['slot', 'attribute'],
      ['=', 'punctuation.delimiter.html'],
      ['"x"', 'string'],
      ['><', 'punctuation.bracket.html'],
      ['slot', 'tag'],
      ['/></', 'punctuation.bracket.html'],
      ['Fragment', 'tag'],
      ['>', 'punctuation.bracket.html'],
      ['<', 'punctuation.bracket.html'],
      ['Comp.Sub', 'tag'],
      ['/>', 'punctuation.bracket.html'],
    ]
  );
});

void t.test(
  'astro: comments are opaque to braces; script and style embed languages',
  () => {
    const src =
      '<!-- {notExpr} <b> -->\n<script>const y = { a: 1 };</script>\n<style lang="scss">.x { color: red; }</style>';
    assert.deepEqual(tokenKinds('astro', src)[0], [
      '<!-- {notExpr} <b> -->',
      'comment',
    ]);
    const html = hl(src);
    assert.equal(
      exactColor(html, 'const'),
      distinctColor('keyword.declaration')
    );
    assert.equal(exactColor(html, 'a'), distinctColor('property'));
    assert.equal(exactColor(html, '1'), distinctColor('number'));
    assert.equal(exactColor(html, 'lang'), distinctColor('attribute'));
    assert.equal(exactColor(html, '"scss"'), distinctColor('string'));
    assert.equal(exactColor(html, '.x'), distinctColor('selector.class'));
    assert.equal(exactColor(html, 'color'), distinctColor('property'));
    assert.equal(exactColor(html, 'red'), distinctColor('constant.builtin'));
  }
);

void t.test(
  'astro: braces inside strings, templates, and comments do not end an expression',
  () => {
    assert.deepEqual(
      tokenKinds('astro', '<p>{`template ${a}`} {\'}\'} {"}"} {/* c */}</p>'),
      [
        ['<', 'punctuation.bracket.html'],
        ['p', 'tag'],
        ['>', 'punctuation.bracket.html'],
        ['{', 'punctuation.bracket'],
        ['`template', 'string'],
        ['${', 'punctuation.special'],
        ['a', 'variable'],
        ['}', 'punctuation.special'],
        ['`', 'string'],
        ['}', 'punctuation.bracket'],
        ['{', 'punctuation.bracket'],
        ["'}'", 'string'],
        ['}', 'punctuation.bracket'],
        ['{', 'punctuation.bracket'],
        ['"}"', 'string'],
        ['}', 'punctuation.bracket'],
        ['{', 'punctuation.bracket'],
        ['/* c */', 'comment'],
        ['}', 'punctuation.bracket'],
        ['</', 'punctuation.bracket.html'],
        ['p', 'tag'],
        ['>', 'punctuation.bracket.html'],
      ]
    );
  }
);

void t.test(
  'astro: front matter, tags, and expressions spanning lines stream line-fed',
  () => {
    assertLineFedParity(
      'astro',
      '---\nconst a = {\n  b: 1,\n};\n---\n<div\n  class="x"\n>\n{\n  value\n}\n</div>\n'
    );
    assertLineFedParity(
      'astro',
      '<p>{items.map((i) =>\n  <li>{i}</li>\n)}</p>\n'
    );
    assertLineFedParity(
      'astro',
      '<script>\nconst x = `a\nb`;\n</script>\n<style>\n.a {\n  color: red;\n}\n</style>\n'
    );
  }
);

void t.test('astro: malformed and split ranges remain bounded', () => {
  for (const src of [
    '---',
    '---\na: 1',
    '{',
    '{"}"',
    '{<li>',
    '{<li>}',
    '{</li>}',
    '{x => <',
    '<script>{',
    '<style>.x{',
    '<div a={x>',
    '<div {',
    '<!--',
  ]) {
    checkInvariants(astro.hl, src);
  }
  const split = loadLang('astro', '$hlAstro', 21);
  checkInvariants(split.hl, '---\nconst a = 1;\n---\n<div>{value}</div>');
});
