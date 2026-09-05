import assert from 'node:assert';
import t from 'node:test';

import type { Lang, ThemedToken } from '../lib/index';
import { codeToTokens, init, StreamTokenizer } from '../lib/index';
import { transformWat, wat2wasm } from '../scripts/build';
import pierreDark from '../themes/pierre-dark.json' with { type: 'json' };
import {
  assertLineFedParity,
  checkInvariants,
  colorOf,
  kindOfColor,
  loadLang,
  spansOf,
  type TestLang,
  themeColor,
  tokenKinds,
} from './util';

let markdown: TestLang;
t.before(() => {
  markdown = loadLang('markdown', '$hlMarkdown');
  // streaming tests need the whole module: fence bodies delegate to every
  // other lexer and the stream driver lives in highlights.wat
  const url = new URL('../src/highlights.wat', import.meta.url);
  const { code } = transformWat(url);
  init(new WebAssembly.Module(wat2wasm(url.pathname, code)));
});

const TITLE = themeColor('title');
const LIST = themeColor('punctuation.list_marker');
const LINK_TEXT = themeColor('link_text');
const LINK_URI = themeColor('link_uri');
const LITERAL = themeColor('text.literal');
const PROPERTY = themeColor('property');
const NUMBER = themeColor('number');
const TAG = themeColor('tag');
const ATTR = themeColor('attribute');
const KEYWORD = themeColor('keyword.declaration');
const ESCAPE = themeColor('string.escape');
const DELIMITER = themeColor('punctuation.delimiter');

/**
 * Tokenize `code` through `StreamTokenizer` one line per push: the boundary
 * the live tokenizer cuts at. Returns the token lines.
 */
function lineFed(lang: Lang, code: string): ThemedToken[][] {
  const stream = new StreamTokenizer({ lang, theme: pierreDark });
  const out: ThemedToken[][] = [];
  for (const line of code.split(/(?<=\n)/)) out.push(...stream.pushCode(line));
  out.push(...stream.end());
  return out;
}

/** Assert line-fed streaming reproduces the whole-buffer tokens exactly. */
function assertLineFedMatchesWhole(lang: Lang, code: string): ThemedToken[][] {
  const whole = codeToTokens(code, { lang, theme: pierreDark }).tokens;
  assert.deepEqual(lineFed(lang, code), whole, JSON.stringify(code));
  return whole;
}

/** The color of the first streamed token on `line` whose text contains `text`. */
function streamColorOf(
  lines: ThemedToken[][],
  line: number,
  text: string
): string | undefined {
  return lines[line].find((tk) => tk.content.includes(text))?.color;
}

/**
 * The token texts of `line`. Records tile the input by token type, so an
 * emphasis span shows up as its own token even when the theme gives it no
 * color, and plain text around it merges into one token.
 */
function tokenTexts(lines: ThemedToken[][], line: number): string[] {
  return lines[line].map((tk) => tk.content);
}

void t.test(
  'markdown: headings, lists, links, emphasis, and inline code',
  () => {
    const src =
      '# Heading\n\n- **strong** and *em* with [docs](https://example.test) and `code`\n';
    const out = checkInvariants(markdown.hl, src);
    assert.equal(colorOf(out, 'Heading'), TITLE);
    assert.equal(colorOf(out, '-'), LIST);
    assert.equal(colorOf(out, 'docs'), LINK_TEXT);
    assert.equal(colorOf(out, 'https://example.test'), LINK_URI);
    assert.equal(colorOf(out, '`code`'), LITERAL);
  }
);

void t.test(
  'markdown: block quotes and table pipes use markup punctuation',
  () => {
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
  }
);

void t.test('markdown: YAML front matter is range-highlighted', () => {
  const out = checkInvariants(
    markdown.hl,
    '---\ntitle: Page\norder: 2\n---\n# Body\n'
  );
  assert.equal(colorOf(out, 'title'), PROPERTY);
  assert.equal(colorOf(out, '2'), NUMBER);
  assert.equal(colorOf(out, 'Body'), TITLE);
});

void t.test('markdown: fenced blocks and bounded inline HTML', () => {
  const src =
    '```js\nconst x = "</div>";\n```\nText <span class="x">here</span>.\n';
  const out = checkInvariants(markdown.hl, src);
  assert.equal(colorOf(out, '```js'), themeColor('punctuation.delimiter'));
  assert.equal(colorOf(out, 'const'), themeColor('keyword.declaration'));
  assert.equal(colorOf(out, '"</div>"'), themeColor('string'));
  assert.equal(colorOf(out, 'span'), TAG);
  assert.equal(colorOf(out, 'class'), ATTR);
});

void t.test(
  'markdown: every public language alias highlights fenced code',
  () => {
    const cases: [string[], string, string, string][] = [
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
  }
);

void t.test('markdown: unknown fence languages remain literal', () => {
  const out = checkInvariants(markdown.hl, '```unknown\nconst x = 1;\n```');
  assert.ok(
    spansOf(out).some(
      (span) => span.color === LITERAL && span.text.includes('const x')
    )
  );
});

void t.test(
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

void t.test(
  'markdown: a thematic break mid-document never opens front matter',
  () => {
    // every stream chunk starts at the source base, so the front-matter gate
    // must also demand the first chunk
    const code = '# Title\n\nintro\n\n---\n\nkey: value\nmore *text*\n';
    const lines = assertLineFedMatchesWhole('markdown', code);
    assert.notEqual(streamColorOf(lines, 6, 'key'), PROPERTY);
    assert.notEqual(
      streamColorOf(lines, 4, '---'),
      themeColor('punctuation.special')
    );
    const out = checkInvariants(
      markdown.hl,
      '---\ntitle: x\n---\n# h\n---\nk: v\n'
    );
    assert.equal(colorOf(out, 'title'), PROPERTY);
    assert.equal(colorOf(out, 'k: v'), null);
  }
);

void t.test(
  'markdown: inline script/style tags do not flip the stream, blocks do',
  () => {
    for (const code of [
      'Use <script src="a.js"></script> here\n\n# Next heading\nplain *em*\n',
      'Use <style>b</style> here\n\n# Next heading\nplain *em*\n',
    ]) {
      const lines = assertLineFedMatchesWhole('markdown', code);
      assert.equal(streamColorOf(lines, 2, 'Next heading'), TITLE);
    }
    // a script body that starts on the next line is JavaScript both ways
    const block = '<script>\nlet x = 1\n</script>\n# h\n';
    const lines = assertLineFedMatchesWhole('markdown', block);
    assert.equal(streamColorOf(lines, 1, 'let'), KEYWORD);
    assert.equal(streamColorOf(lines, 3, 'h'), TITLE);
    const out = checkInvariants(markdown.hl, block);
    assert.equal(colorOf(out, 'let'), KEYWORD);
    assert.equal(colorOf(out, 'script'), TAG);
    // unterminated raw text runs to the end, as the HTML lexer treats it
    checkInvariants(markdown.hl, '<script>\nlet x = 1\n');
    assertLineFedMatchesWhole('markdown', '<script>\nlet x = 1\n');
  }
);

void t.test(
  'markdown: an open comment in a fence body does not eat the closing fence',
  () => {
    const code = '```css\n/* open\n```\n# heading\n*em*\n';
    const lines = assertLineFedMatchesWhole('markdown', code);
    assert.equal(streamColorOf(lines, 2, '```'), DELIMITER);
    assert.equal(streamColorOf(lines, 3, 'heading'), TITLE);
  }
);

void t.test(
  'markdown: fences close behind list and block-quote prefixes',
  () => {
    const list =
      '1. Install:\n\n   ```sh\n   npm i\n   ```\n\n2. Next *step*\n';
    let out = checkInvariants(markdown.hl, list);
    assert.equal(colorOf(out, '2.'), LIST);
    assert.equal(colorOf(out, '   ```'), DELIMITER);
    assert.deepEqual(
      tokenTexts(assertLineFedMatchesWhole('markdown', list), 6),
      ['2. ', 'Next ', '*step*']
    );

    const quote = '> ```js\n> let a = 1\n> ```\n\nafter *em*\n';
    out = checkInvariants(markdown.hl, quote);
    assert.equal(colorOf(out, 'let'), KEYWORD);
    assert.equal(colorOf(out, '> ```'), DELIMITER);
    assert.deepEqual(
      tokenTexts(assertLineFedMatchesWhole('markdown', quote), 4),
      ['after ', '*em*']
    );
    assertLineFedMatchesWhole(
      'markdown',
      '> > ```js\n> > let a = 1\n> > ```\n> *em*\n'
    );

    // four spaces is indented code, not a closer: the body runs on
    out = checkInvariants(markdown.hl, '```js\nlet a = 1\n    ```\nx\n');
    assert.notEqual(colorOf(out, 'x'), undefined);
    assert.ok(
      !spansOf(out).some(
        (s) => s.color === DELIMITER && s.text.includes('    ')
      )
    );
  }
);

void t.test('markdown: list items keep line-start meaning', () => {
  const code = '- ```js\nlet a = 1\n```\nafter *em*\n';
  const out = checkInvariants(markdown.hl, code);
  assert.equal(colorOf(out, '```js'), DELIMITER);
  assert.equal(colorOf(out, 'let'), KEYWORD);
  assert.equal(colorOf(out, 'after '), undefined);
  assert.deepEqual(tokenTexts(assertLineFedMatchesWhole('markdown', code), 3), [
    'after ',
    '*em*',
  ]);
  const nested = checkInvariants(
    markdown.hl,
    '- # title\n- > quote\n1. 2. x\n'
  );
  assert.equal(colorOf(nested, 'title'), TITLE);
  assert.equal(colorOf(nested, '>'), themeColor('punctuation.markup'));
  assert.equal(colorOf(nested, '1. 2.'), LIST);
});

void t.test('markdown: backslash escapes only ASCII punctuation', () => {
  const code = 'a\\\n# heading\n';
  const out = checkInvariants(markdown.hl, code);
  assert.equal(colorOf(out, 'heading'), TITLE);
  assert.equal(colorOf(out, 'a\\'), null);
  assertLineFedMatchesWhole('markdown', code);
  assertLineFedMatchesWhole('markdown', 'a\\\r\n# heading\r\n');
  const escapes = checkInvariants(markdown.hl, '\\* x \\é \\\\ \\');
  assert.equal(colorOf(escapes, '\\*'), ESCAPE);
  assert.equal(colorOf(escapes, '\\\\'), ESCAPE);
  assert.equal(colorOf(escapes, '\\é'), undefined);
});

void t.test(
  'markdown: underscore emphasis needs a left-flanking opener',
  () => {
    const code = 'use snake_case_name and _em_ and _ no_ and 日_本_ here\n';
    checkInvariants(markdown.hl, code);
    // only `_em_` is an emphasis token; every other `_` stays in plain text
    assert.deepEqual(
      tokenTexts(assertLineFedMatchesWhole('markdown', code), 0),
      ['use snake_case_name and ', '_em_', ' and _ no_ and 日_本_ here']
    );
    assert.deepEqual(
      tokenTexts(
        assertLineFedMatchesWhole('markdown', '__init__ and a__b__\n'),
        0
      ),
      ['__init__', ' and a__b__']
    );
  }
);

void t.test('markdown: lines of many `<` or `[` stay linear', () => {
  // each `<` used to rescan to the line end: 80k of them took ~760ms
  for (const line of ['<a', '[', '[a](', '[a] ', '<a "x>" ']) {
    const code = line.repeat(80000) + '\n';
    const start = performance.now();
    const out = checkInvariants(markdown.hl, code);
    assert.ok(
      performance.now() - start < 250,
      `${JSON.stringify(line)} x80000 took too long`
    );
    assert.ok(out.length > 0);
  }
  // a memoised `<` still leaves later constructs alone
  const out = checkInvariants(markdown.hl, 'a <b c <i>x</i> [d [e](f)\n');
  assert.equal(colorOf(out, 'i'), TAG);
  assert.equal(colorOf(out, 'e'), LINK_TEXT);
  assert.equal(colorOf(out, 'f'), LINK_URI);
});

void t.test(
  'markdown: ATX headings at every level, with inline code and closing hashes',
  () => {
    assert.deepEqual(
      tokenKinds(
        'markdown',
        '# H1\n## H2 with `code`\n### H3\n#  spaced heading  #'
      ),
      [
        ['#', 'punctuation.special'],
        ['H1', 'title'],
        ['##', 'punctuation.special'],
        ['H2 with `code`', 'title'],
        ['###', 'punctuation.special'],
        ['H3', 'title'],
        ['#', 'punctuation.special'],
        ['spaced heading  #', 'title'],
      ]
    );
    // a hash glued to a word is a tag, not a heading
    assert.deepEqual(tokenKinds('markdown', '#hashtag not heading'), [
      ['#hashtag not heading', null],
    ]);
  }
);

void t.test(
  'markdown: emphasis, strong, inline code, inline HTML, and escapes',
  () => {
    assert.deepEqual(
      tokenKinds(
        'markdown',
        '*em* _em_ **strong** __strong__ `inline` ``double `tick` `` <span>html</span> \\*escaped\\*'
      ),
      [
        ['*em*', 'emphasis'],
        ['_em_', 'emphasis'],
        ['**strong**', 'emphasis.strong'],
        ['__strong__', 'emphasis.strong'],
        ['`inline`', 'text.literal'],
        ['``double `tick` ``', 'text.literal'],
        ['<', 'punctuation.bracket.html'],
        ['span', 'tag'],
        ['>', 'punctuation.bracket.html'],
        ['html', null],
        ['</', 'punctuation.bracket.html'],
        ['span', 'tag'],
        ['>', 'punctuation.bracket.html'],
        ['\\*', 'string.escape'],
        ['escaped', null],
        ['\\*', 'string.escape'],
      ]
    );
  }
);

void t.test(
  'markdown: inline links and images split into text, uri, and brackets',
  () => {
    assert.deepEqual(
      tokenKinds('markdown', '[link](https://x.com "title") ![img](a.png)'),
      [
        ['[', 'punctuation.bracket'],
        ['link', 'link_text'],
        ['](', 'punctuation.bracket'],
        ['https://x.com "title"', 'link_uri'],
        [')', 'punctuation.bracket'],
        ['!', null],
        ['[', 'punctuation.bracket'],
        ['img', 'link_text'],
        ['](', 'punctuation.bracket'],
        ['a.png', 'link_uri'],
        [')', 'punctuation.bracket'],
      ]
    );
  }
);

void t.test(
  'markdown: every list marker, nested quotes, and table rows',
  () => {
    assert.deepEqual(
      tokenKinds(
        'markdown',
        '- a\n* star\n+ plus\n1. one\n2) two\n  - nested\n- [x] done\n> quote\n> > nested quote\n| a | b |\n|:--|--:|'
      ),
      [
        ['-', 'punctuation.list_marker'],
        ['a', null],
        ['*', 'punctuation.list_marker'],
        ['star', null],
        ['+', 'punctuation.list_marker'],
        ['plus', null],
        ['1.', 'punctuation.list_marker'],
        ['one', null],
        ['2)', 'punctuation.list_marker'],
        ['two', null],
        ['-', 'punctuation.list_marker'],
        ['nested', null],
        ['-', 'punctuation.list_marker'],
        ['[x] done', null],
        ['>', 'punctuation.markup'],
        ['quote', null],
        ['> >', 'punctuation.markup'],
        ['nested quote', null],
        ['|', 'punctuation.markup'],
        ['a', null],
        ['|', 'punctuation.markup'],
        ['b', null],
        ['|', 'punctuation.markup'],
        ['|', 'punctuation.markup'],
        [':--', null],
        ['|', 'punctuation.markup'],
        ['--:', null],
        ['|', 'punctuation.markup'],
      ]
    );
  }
);

void t.test(
  'markdown: backtick and tilde fences by language, bare, unknown, and nested',
  () => {
    assert.deepEqual(
      tokenKinds(
        'markdown',
        '```js\nconst x = 1;\n```\n~~~python\ndef f(): pass\n~~~\n```\nplain fence\n```\n```unknownlang\nx = 1\n```'
      ),
      [
        ['```js', 'punctuation.delimiter'],
        ['const', 'keyword.declaration'],
        ['x', 'variable'],
        ['=', 'operator'],
        ['1', 'number'],
        [';', 'punctuation.delimiter'],
        ['```', 'punctuation.delimiter'],
        ['~~~python', 'punctuation.delimiter'],
        ['def', 'keyword.declaration'],
        ['f', 'function.definition'],
        ['()', 'punctuation.bracket'],
        [':', 'punctuation.delimiter'],
        ['pass', 'keyword.control'],
        ['~~~', 'punctuation.delimiter'],
        ['```', 'punctuation.delimiter'],
        ['plain fence', 'text.literal'],
        ['```', 'punctuation.delimiter'],
        ['```unknownlang', 'punctuation.delimiter'],
        ['x = 1', 'text.literal'],
        ['```', 'punctuation.delimiter'],
      ]
    );
    // a four-backtick markdown fence highlights the inner three-backtick fence
    assert.deepEqual(tokenKinds('markdown', '````md\n```\ninner\n```\n````'), [
      ['````md', 'punctuation.delimiter'],
      ['```', 'punctuation.delimiter'],
      ['inner', 'text.literal'],
      ['```', 'punctuation.delimiter'],
      ['````', 'punctuation.delimiter'],
    ]);
  }
);

void t.test('markdown: HTML blocks, comments, and hard breaks', () => {
  assert.deepEqual(
    tokenKinds(
      'markdown',
      '<div class="a">\n<p>html block</p>\n</div>\n<!-- comment -->\nText with trailing spaces  \nhard break\\\nnext'
    ),
    [
      ['<', 'punctuation.bracket.html'],
      ['div', 'tag'],
      ['class', 'attribute'],
      ['=', 'punctuation.delimiter.html'],
      ['"a"', 'string'],
      ['>', 'punctuation.bracket.html'],
      ['<', 'punctuation.bracket.html'],
      ['p', 'tag'],
      ['>', 'punctuation.bracket.html'],
      ['html block', null],
      ['</', 'punctuation.bracket.html'],
      ['p', 'tag'],
      ['>', 'punctuation.bracket.html'],
      ['</', 'punctuation.bracket.html'],
      ['div', 'tag'],
      ['>', 'punctuation.bracket.html'],
      ['<!-- comment -->', 'comment'],
      ['Text with trailing spaces', null],
      ['hard break\\', null],
      ['next', null],
    ]
  );
});

void t.test(
  'markdown: headings, lists, fences, tables, and HTML blocks stream line-fed',
  () => {
    assertLineFedParity(
      'markdown',
      '# H1\n\nSetext\n======\n\n- a\n  - nested\n1. one\n> quote\n\n| a | b |\n|:--|--:|\n\n```js\nconst x = 1;\n```\n~~~python\ndef f(): pass\n~~~\n````md\n```\ninner\n```\n````\n\n<div class="a">\n<p>html block</p>\n</div>\n<!-- multi\nline -->\nhard break\\\nnext\n'
    );
  }
);

void t.test(
  'markdown: fences nested inside markdown fences resume line-fed at every depth',
  () => {
    // an inner fence must survive the chunk boundary alongside the outer one
    assert.deepEqual(
      tokenKinds('markdown', '````md\n```\ninner\n```\n````'),
      assertLineFedParity('markdown', '````md\n```\ninner\n```\n````')
        .flat()
        .map(
          (tok) =>
            [tok.content.trim(), kindOfColor(tok.color)] as [
              string,
              string | null,
            ]
        )
        .filter(([text]) => text !== '')
    );
    for (const code of [
      '`````md\n````md\n```\ninner\n```\n````\n`````\nafter\n',
      '````md\n```\ninner\n````\nafter\n```\nnot literal\n',
      '````md\n```js\nconst a = 1;\n```\ntext *em*\n```py\nx = 1\n```\n````\n',
      '> ````md\n> ```\n> inner\n> ```\n> ````\n',
      '- ````md\n  ```\n  inner\n  ```\n  ````\n',
      '````md\n```\ninner\n```\n````\n````md\n```\nsecond\n```\n````\n',
      '````mdx\n<Card>\n```\ninner\n```\n</Card>\n````\n',
      '````md\n~~~\n```\nstill tilde\n```\n~~~\n````\n',
      '````md\n```\nnever closed\n',
      '```md\n````\ninner\n````\n```\nafter\n',
      '````md\n```md\n```\ndeep\n```\n```\n````\n',
    ]) {
      assertLineFedParity('markdown', code);
    }
  }
);
