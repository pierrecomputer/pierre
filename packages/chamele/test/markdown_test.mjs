import assert from 'node:assert';
import t from 'node:test';

import {
  checkInvariants,
  colorOf,
  loadLang,
  spansOf,
  themeColor,
} from './util.mjs';

let markdown;
t.before(() => (markdown = loadLang('markdown', '$hlMarkdown')));

const TITLE = themeColor('title');
const LIST = themeColor('punctuation.list_marker');
const LINK_TEXT = themeColor('link_text');
const LINK_URI = themeColor('link_uri');
const LITERAL = themeColor('text.literal');
const PROPERTY = themeColor('property');
const NUMBER = themeColor('number');
const TAG = themeColor('tag');
const ATTR = themeColor('attribute');

t.test('markdown: headings, lists, links, emphasis, and inline code', () => {
  const src =
    '# Heading\n\n- **strong** and *em* with [docs](https://example.test) and `code`\n';
  const out = checkInvariants(markdown.hl, src);
  assert.equal(colorOf(out, 'Heading'), TITLE);
  assert.equal(colorOf(out, '-'), LIST);
  assert.equal(colorOf(out, 'docs'), LINK_TEXT);
  assert.equal(colorOf(out, 'https://example.test'), LINK_URI);
  assert.equal(colorOf(out, '`code`'), LITERAL);
});

t.test('markdown: block quotes and table pipes use markup punctuation', () => {
  const out = checkInvariants(markdown.hl, '> Quote\n| A | B |\n', {
    theme: {
      name: 'css-variables',
      appearance: 'dark',
      cssVariables: true,
      style: {},
    },
  });
  assert.equal(colorOf(out, '>'), 'var(--cha-punctuation-markup)');
  assert.equal(colorOf(out, '|'), 'var(--cha-punctuation-markup)');
});

t.test('markdown: YAML front matter is range-highlighted', () => {
  const out = checkInvariants(
    markdown.hl,
    '---\ntitle: Page\norder: 2\n---\n# Body\n'
  );
  assert.equal(colorOf(out, 'title'), PROPERTY);
  assert.equal(colorOf(out, '2'), NUMBER);
  assert.equal(colorOf(out, 'Body'), TITLE);
});

t.test('markdown: fenced blocks and bounded inline HTML', () => {
  const src =
    '```js\nconst x = "</div>";\n```\nText <span class="x">here</span>.\n';
  const out = checkInvariants(markdown.hl, src);
  assert.equal(colorOf(out, '```js'), themeColor('punctuation.delimiter'));
  assert.equal(colorOf(out, 'const'), themeColor('keyword.declaration'));
  assert.equal(colorOf(out, '"</div>"'), themeColor('string'));
  assert.equal(colorOf(out, 'span'), TAG);
  assert.equal(colorOf(out, 'class'), ATTR);
});

t.test('markdown: every public language alias highlights fenced code', () => {
  const cases = [
    [
      [
        'tsx',
        'ts',
        'typescript',
        'javascript',
        'js',
        'jsx',
        'cjs',
        'mjs',
        'cts',
        'mts',
      ],
      'const value = 1;',
      'const',
      'keyword.declaration',
    ],
    [['html', 'htm'], '<section id="x">x</section>', 'section', 'tag'],
    [['css'], '.card { color: red; }', '.card', 'selector.class'],
    [['json', 'jsonc'], '{"field": 1}', '"field"', 'property.json_key'],
    [
      ['bash', 'sh', 'shell', 'zsh'],
      'if true; then echo ok; fi',
      'if',
      'keyword.control',
    ],
    [['c', 'h'], 'int value;', 'int', 'type.builtin'],
    [
      ['cpp', 'c++', 'cc', 'cxx', 'hh', 'hpp', 'hxx'],
      'class Widget {};',
      'class',
      'keyword.declaration',
    ],
    [['go', 'golang'], 'func main() {}', 'func', 'keyword.declaration'],
    [['python', 'py'], 'def greet(): pass', 'def', 'keyword.declaration'],
    [['rust', 'rs'], 'fn main() {}', 'fn', 'keyword.declaration'],
    [['yaml', 'yml'], 'field: value', 'field', 'property'],
    [['php'], '<?php function greet() {}', 'function', 'keyword.declaration'],
    [['sql'], 'SELECT value FROM table', 'SELECT', 'keyword'],
    [['swift'], 'func main() {}', 'func', 'keyword.declaration'],
    [['haskell', 'hs'], 'data Value = Value', 'data', 'keyword.declaration'],
    [['kotlin', 'kt', 'kts'], 'fun main() {}', 'fun', 'keyword.declaration'],
    [['astro'], '<section>x</section>', 'section', 'tag'],
    [['vue'], '<section>x</section>', 'section', 'tag'],
    [['svelte'], '<section>x</section>', 'section', 'tag'],
    [['xml', 'svg', 'xsd'], '<section>x</section>', 'section', 'tag'],
    [['markdown', 'md'], '# Nested', 'Nested', 'title'],
    [['mdx'], '<Card />', 'Card', 'tag.component.jsx'],
    [['asm', 'assembly', 's'], 'mov eax, 1', 'mov', 'keyword'],
    [['wat', 'wasm'], '(module)', 'module', 'keyword'],
    [['diff', 'patch'], '+added', 'added', 'diff.plus'],
    [
      ['glsl', 'comp', 'frag', 'geom', 'vert'],
      'vec3 color;',
      'vec3',
      'type.builtin',
    ],
    [['lua'], 'function greet() end', 'function', 'keyword.declaration'],
  ];
  for (const [aliases, code, token, capture] of cases) {
    for (const alias of aliases) {
      const out = checkInvariants(
        markdown.hl,
        `\`\`\`${alias}\n${code}\n\`\`\``
      );
      assert.equal(colorOf(out, token), themeColor(capture), alias);
    }
  }
  assert.equal(
    colorOf(markdown.hl('```RUST\nfn main() {}\n```'), 'fn'),
    themeColor('keyword.declaration')
  );
  assert.equal(
    colorOf(markdown.hl('~~~ rust no_run\nfn main() {}\n~~~'), 'fn'),
    themeColor('keyword.declaration')
  );
});

t.test('markdown: unknown fence languages remain literal', () => {
  const out = checkInvariants(markdown.hl, '```unknown\nconst x = 1;\n```');
  assert.ok(
    spansOf(out).some(
      (span) => span.color === LITERAL && span.text.includes('const x')
    )
  );
});

t.test(
  'markdown: malformed constructs and split ranges remain lossless',
  () => {
    for (const src of [
      '',
      '#',
      '---\na: 1',
      '`open',
      '[x](open',
      '**open',
      '<tag',
      '```\nopen',
      'é *日*',
    ]) {
      checkInvariants(markdown.hl, src);
    }
    const split = loadLang('markdown', '$hlMarkdown', 12);
    checkInvariants(split.hl, '# title\nText **strong** and <b>x</b>\n');
    const fenced = '```rust\nfn main() { println!("é"); }\n```';
    const size = new TextEncoder().encode(fenced).length;
    for (const end of [1, 3, 7, 8, 17, size - 3, size]) {
      checkInvariants(loadLang('markdown', '$hlMarkdown', end).hl, fenced);
    }
  }
);
