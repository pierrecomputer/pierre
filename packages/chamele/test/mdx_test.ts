import assert from 'node:assert';
import t from 'node:test';

import type { ThemedToken } from '../lib/index';
import { codeToTokens, init, StreamTokenizer } from '../lib/index';
import { transformWat, wat2wasm } from '../scripts/build';
import pierreDark from '../themes/pierre-dark.json' with { type: 'json' };
import {
  assertLineFedParity,
  checkInvariants,
  colorOf,
  distinctColor,
  distinctTheme,
  exactColor,
  loadLang,
  spansOf,
  type TestLang,
  themeColor,
  tokenKinds,
} from './util';

let mdx: TestLang;
t.before(() => {
  mdx = loadLang('mdx', '$hlMdx');
  // streaming tests go through the stream driver in chamele.wat
  const url = new URL('../src/chamele.wat', import.meta.url);
  const { code } = transformWat(url);
  init(new WebAssembly.Module(wat2wasm(url.pathname, code)));
});

const TITLE = themeColor('title');
const COMPONENT = themeColor('tag.component.jsx');
const ATTR = themeColor('attribute.jsx');
const VARIABLE = themeColor('variable');
const FUNCTION = themeColor('function');
const STRING = themeColor('string');
const LIST = themeColor('punctuation.list_marker');
const KEYWORD = themeColor('keyword.declaration');

/**
 * Assert `StreamTokenizer` fed one line per push, the boundary the live
 * tokenizer cuts at, reproduces the whole-buffer tokens exactly.
 */
function assertLineFedMatchesWhole(code: string): ThemedToken[][] {
  const stream = new StreamTokenizer({ lang: 'mdx', theme: pierreDark });
  const out: ThemedToken[][] = [];
  for (const line of code.split(/(?<=\n)/)) out.push(...stream.pushCode(line));
  out.push(...stream.end());
  const whole = codeToTokens(code, { lang: 'mdx', theme: pierreDark }).tokens;
  assert.deepEqual(out, whole, JSON.stringify(code));
  return whole;
}

void t.test('mdx: Markdown with JSX components and expressions', () => {
  const src =
    '# Hello {user}\n<Card title="Hi" count={items.length}>{render()}</Card>\n';
  const out = checkInvariants(mdx.hl, src);
  assert.equal(colorOf(out, 'Hello'), TITLE);
  assert.equal(colorOf(out, 'Card'), COMPONENT);
  assert.equal(colorOf(out, 'title'), ATTR);
  assert.equal(colorOf(out, '"Hi"'), STRING);
  assert.equal(colorOf(out, 'user'), VARIABLE);
  assert.equal(colorOf(out, 'render'), FUNCTION);
  assert.ok(
    spansOf(out).filter(
      (span) => span.text.includes('Card') && span.color === COMPONENT
    ).length >= 2
  );
});

void t.test(
  'mdx: nested object braces and braces in strings stay in one expression',
  () => {
    const out = checkInvariants(mdx.hl, '{format({ text: "}" })}\nafter');
    assert.equal(colorOf(out, 'format'), FUNCTION);
    assert.equal(colorOf(out, '"}"'), STRING);
  }
);

void t.test('mdx: malformed JSX and split ranges stay bounded', () => {
  for (const src of [
    '<',
    '<Card',
    '{',
    '{"}"',
    '</Card',
    '# h\n<X a={1>',
    'é {名}',
  ]) {
    checkInvariants(mdx.hl, src);
  }
  const split = loadLang('mdx', '$hlMdx', 10);
  checkInvariants(split.hl, '# hi\n<Card>{value}</Card>\n');
});

void t.test('mdx: fenced bodies match line-fed streaming', () => {
  // the fence resume is routed for mdx too; `{` and `<` in the body must not
  // start expressions or JSX on any chunk
  const lines = assertLineFedMatchesWhole(
    '# T\n\n```js\nconst x = {a: 1};\nlet y = <div/>;\n```\n\nafter\n'
  );
  assert.equal(
    lines[3].find((tk) => tk.content.includes('const'))?.color,
    KEYWORD
  );
  // plain text merges into one token
  assert.deepEqual(
    lines[7].map((tk) => tk.content),
    ['after']
  );
});

void t.test('mdx: fences behind list markers and block quotes close', () => {
  const list = '1. x\n\n   ```js\n   let a = 1\n   ```\n\n2. y {z}\n';
  const out = checkInvariants(mdx.hl, list);
  assert.equal(colorOf(out, '2.'), LIST);
  assert.equal(colorOf(out, 'z'), VARIABLE);
  assert.equal(colorOf(out, 'y '), undefined);
  assertLineFedMatchesWhole(list);
  // the pre-scan and the markdown lexer agree on where a body ends
  const quoted = checkInvariants(
    mdx.hl,
    '> ```js\n> let a = {b: 1}\n> ```\n{after}\n'
  );
  assert.equal(colorOf(quoted, 'after'), VARIABLE);
  assertLineFedMatchesWhole('> ```js\n> let a = {b: 1}\n> ```\n{after}\n');
  const item = checkInvariants(mdx.hl, '- ```js\nlet a = <b/>\n```\n{after}\n');
  assert.equal(colorOf(item, 'let'), KEYWORD);
  assert.equal(colorOf(item, 'after'), VARIABLE);
  assertLineFedMatchesWhole('- ```js\nlet a = <b/>\n```\n{after}\n');
});

void t.test('mdx: a stray `<word` does not open a JSX region', () => {
  const lines = assertLineFedMatchesWhole('a <b c\nfoo\nbar\n');
  assert.deepEqual(
    lines.map((line) => line.map((tk) => tk.content)),
    [['a <b c'], ['foo'], ['bar'], []]
  );
  assertLineFedMatchesWhole('if a<b then\nfoo\n');
  // multi-line tags still continue: a component, a flow tag, or attributes
  const component = assertLineFedMatchesWhole(
    '<Card\n  title="x"\n>\nchild\n</Card>\n'
  );
  assert.equal(
    component[1].find((tk) => tk.content.includes('title'))?.color,
    ATTR
  );
  const flow = assertLineFedMatchesWhole('<div\n  class="x"\n>\n');
  assert.equal(flow[1].find((tk) => tk.content.includes('class'))?.color, ATTR);
  const inline = assertLineFedMatchesWhole('text <b c="1"\n  d>\nafter\n');
  assert.equal(inline[1].find((tk) => tk.content.includes('d'))?.color, ATTR);
});

void t.test('mdx: front matter only opens at the document start', () => {
  assertLineFedMatchesWhole('---\ntitle: x\n---\n# h\n---\n{k}\n');
  const lines = assertLineFedMatchesWhole('# h\n---\nkey: v\n');
  assert.deepEqual(
    lines[2].map((tk) => tk.content),
    ['key: v']
  );
});

void t.test('mdx: many unclosed `<` stay linear', () => {
  // every `<ident` without a `>` used to rescan to the end of the input
  for (const line of ['a <b \n', '<a', 'a <b c="x" \n']) {
    const code = line.repeat(8000);
    const start = performance.now();
    checkInvariants(mdx.hl, code);
    assert.ok(
      performance.now() - start < 250,
      `${JSON.stringify(line)} x8000 took too long`
    );
  }
  const out = checkInvariants(mdx.hl, 'a <b c\n<Card />\n');
  assert.equal(colorOf(out, 'Card'), COMPONENT);
});

/** Highlight under the distinct theme after checking the lexer invariants. */
const distinctHl = (src: string) =>
  checkInvariants(mdx.hl, src, { theme: distinctTheme });

void t.test(
  'mdx: expressions inside headings, paragraphs, and block quotes',
  () => {
    assert.deepEqual(
      tokenKinds(
        'mdx',
        '# Heading {meta.title}\n\nParagraph with {1 + 1} inline.\n\n> quote {expr}'
      ),
      [
        ['#', 'punctuation.special'],
        ['Heading', 'title'],
        ['{', 'punctuation.bracket'],
        ['meta', 'variable'],
        ['.', 'punctuation.delimiter'],
        ['title', 'property'],
        ['}', 'punctuation.bracket'],
        ['Paragraph with', null],
        ['{', 'punctuation.bracket'],
        ['1', 'number'],
        ['+', 'operator'],
        ['1', 'number'],
        ['}', 'punctuation.bracket'],
        ['inline.', null],
        ['>', 'punctuation.markup'],
        ['quote', null],
        ['{', 'punctuation.bracket'],
        ['expr', 'variable'],
        ['}', 'punctuation.bracket'],
      ]
    );
  }
);

void t.test(
  'mdx: inline components with expression and string attributes',
  () => {
    assert.deepEqual(
      tokenKinds(
        'mdx',
        'Paragraph with <Chart data={[1, 2]} label="sales" /> inline.'
      ),
      [
        ['Paragraph with', null],
        ['<', 'punctuation.bracket.jsx'],
        ['Chart', 'tag.component.jsx'],
        ['data', 'attribute.jsx'],
        ['=', 'punctuation.delimiter.jsx'],
        ['{[', 'punctuation.bracket'],
        ['1', 'number'],
        [',', 'punctuation.delimiter'],
        ['2', 'number'],
        [']}', 'punctuation.bracket'],
        ['label', 'attribute.jsx'],
        ['=', 'punctuation.delimiter.jsx'],
        ['"sales"', 'string'],
        ['/>', 'punctuation.bracket.jsx'],
        ['inline.', null],
      ]
    );
  }
);

void t.test('mdx: nested elements and JSX returned from an expression', () => {
  assert.deepEqual(
    tokenKinds(
      'mdx',
      '<Chart>\n  <strong>child</strong>\n  {items.map((i) => <li key={i}>{i}</li>)}\n</Chart>'
    ),
    [
      ['<', 'punctuation.bracket.jsx'],
      ['Chart', 'tag.component.jsx'],
      ['>', 'punctuation.bracket.jsx'],
      ['<', 'punctuation.bracket.jsx'],
      ['strong', 'tag.jsx'],
      ['>', 'punctuation.bracket.jsx'],
      ['child', null],
      ['</', 'punctuation.bracket.jsx'],
      ['strong', 'tag.jsx'],
      ['>', 'punctuation.bracket.jsx'],
      ['{', 'punctuation.bracket'],
      ['items', 'variable'],
      ['.', 'punctuation.delimiter'],
      ['map', 'function.method'],
      ['((', 'punctuation.bracket'],
      ['i', 'variable.parameter'],
      [')', 'punctuation.bracket'],
      ['=>', 'operator'],
      ['<', 'punctuation.bracket.jsx'],
      ['li', 'tag.jsx'],
      ['key', 'attribute.jsx'],
      ['=', 'punctuation.delimiter.jsx'],
      ['{', 'punctuation.bracket'],
      ['i', 'variable'],
      ['}', 'punctuation.bracket'],
      ['>', 'punctuation.bracket.jsx'],
      ['{', 'punctuation.bracket'],
      ['i', 'variable'],
      ['}', 'punctuation.bracket'],
      ['</', 'punctuation.bracket.jsx'],
      ['li', 'tag.jsx'],
      ['>', 'punctuation.bracket.jsx'],
      [')}', 'punctuation.bracket'],
      ['</', 'punctuation.bracket.jsx'],
      ['Chart', 'tag.component.jsx'],
      ['>', 'punctuation.bracket.jsx'],
    ]
  );
});

void t.test(
  'mdx: multi-line start tags, markdown inside JSX, lists, and fenced TypeScript',
  () => {
    assert.deepEqual(
      tokenKinds(
        'mdx',
        '<Card\n  title="x"\n  count={1}\n>\n  **bold** in jsx\n</Card>\n\n- list\n- `code` and *em*\n\n```ts\nconst a: number = 1;\n```'
      ),
      [
        ['<', 'punctuation.bracket.jsx'],
        ['Card', 'tag.component.jsx'],
        ['title', 'attribute.jsx'],
        ['=', 'punctuation.delimiter.jsx'],
        ['"x"', 'string'],
        ['count', 'attribute.jsx'],
        ['=', 'punctuation.delimiter.jsx'],
        ['{', 'punctuation.bracket'],
        ['1', 'number'],
        ['}', 'punctuation.bracket'],
        ['>', 'punctuation.bracket.jsx'],
        ['**bold**', 'emphasis.strong'],
        ['in jsx', null],
        ['</', 'punctuation.bracket.jsx'],
        ['Card', 'tag.component.jsx'],
        ['>', 'punctuation.bracket.jsx'],
        ['-', 'punctuation.list_marker'],
        ['list', null],
        ['-', 'punctuation.list_marker'],
        ['`code`', 'text.literal'],
        ['and', null],
        ['*em*', 'emphasis'],
        ['```ts', 'punctuation.delimiter'],
        ['const', 'keyword.declaration'],
        ['a', 'variable'],
        [':', 'punctuation.special'],
        ['number', 'type.builtin'],
        ['=', 'operator'],
        ['1', 'number'],
        [';', 'punctuation.delimiter'],
        ['```', 'punctuation.delimiter'],
      ]
    );
  }
);

void t.test(
  'mdx: expression comments, plain HTML elements, and brace strings',
  () => {
    assert.deepEqual(
      tokenKinds(
        'mdx',
        "{/* comment */}\n\n{\n  /* multi\n  line */\n}\n\n<div>\n  plain html\n</div>\n\nText & <b>bold</b> and {'{'} braces"
      ),
      [
        ['{', 'punctuation.bracket'],
        ['/* comment */', 'comment'],
        ['}', 'punctuation.bracket'],
        ['{', 'punctuation.bracket'],
        ['/* multi', 'comment'],
        ['line */', 'comment'],
        ['}', 'punctuation.bracket'],
        ['<', 'punctuation.bracket.jsx'],
        ['div', 'tag.jsx'],
        ['>', 'punctuation.bracket.jsx'],
        ['plain html', null],
        ['</', 'punctuation.bracket.jsx'],
        ['div', 'tag.jsx'],
        ['>', 'punctuation.bracket.jsx'],
        ['Text &', null],
        ['<', 'punctuation.bracket.jsx'],
        ['b', 'tag.jsx'],
        ['>', 'punctuation.bracket.jsx'],
        ['bold', null],
        ['</', 'punctuation.bracket.jsx'],
        ['b', 'tag.jsx'],
        ['>', 'punctuation.bracket.jsx'],
        ['and', null],
        ['{', 'punctuation.bracket'],
        ["'{'", 'string'],
        ['}', 'punctuation.bracket'],
        ['braces', null],
      ]
    );
  }
);

void t.test('mdx: braces on ESM lines still open expressions', () => {
  const html = distinctHl(
    "export const meta = { title: 'x' };\nexport function Foo() { return 1; }"
  );
  assert.equal(exactColor(html, 'title'), distinctColor('property'));
  assert.equal(exactColor(html, "'x'"), distinctColor('string'));
  assert.equal(exactColor(html, 'return'), distinctColor('keyword.control'));
  assert.equal(exactColor(html, '1'), distinctColor('number'));
});

void t.test(
  'mdx: expressions, components, and comments spanning lines stream line-fed',
  () => {
    assertLineFedParity(
      'mdx',
      '# Heading {meta.title}\n\nParagraph with {1 + 1} and <Chart data={[1, 2]} label="sales" /> inline.\n\n<Chart>\n  <strong>child</strong>\n  {items.map((i) => <li key={i}>{i}</li>)}\n</Chart>\n\n{/* comment */}\n\n{\n  /* multi\n  line */\n}\n'
    );
    assertLineFedParity(
      'mdx',
      '<Card\n  title="x"\n  count={1}\n>\n  **bold** in jsx\n</Card>\n\n- list\n- `code` and *em*\n\n```ts\nconst a: number = 1;\n```\n\n> quote {expr}\n'
    );
    assertLineFedParity(
      'mdx',
      "<div>\n  plain html\n</div>\n\nText & <b>bold</b> and {'{'} braces\n"
    );
  }
);

void t.test(
  'mdx: markdown fences nested inside a markdown fence stream line-fed',
  () => {
    for (const code of [
      '````md\n```\ninner\n```\n````\n',
      '<Card>\n````md\n```\ninner\n```\n````\n</Card>\n',
      '````mdx\n<Card>\n```\ninner\n```\n</Card>\n````\n',
    ]) {
      assertLineFedParity('mdx', code);
    }
  }
);
