import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  createHtmlSession,
  type HtmlSessionOptions,
  type HtmlUpdate,
  init,
  renderToHtml,
} from '../dist/index.js';

const decoder = new TextDecoder();
/** Render independently of the append cache, with the same source-HTML policy. */
const full = (source: string, options?: HtmlSessionOptions) =>
  decoder.decode(
    renderToHtml(source, {
      ...options,
      skipHtml: true,
      boundary: true,
    } as HtmlSessionOptions)
  );
const links = (html: string) => [
  ...html.matchAll(
    /<a (?:href="([^"]*)"|data-markdown-incomplete)[^>]*>(.*?)<\/a>/gs
  ),
];
/** A source that writes the completion's placeholder, rendered as a pending link. */
const fullPending = (source: string) =>
  full(source).replaceAll(
    '<a href="streamdown:incomplete-link">',
    '<a data-markdown-incomplete>'
  );

void test('HTML additions reconstruct output through appends, repeated inputs, and resets', () => {
  const session = createHtmlSession();
  let stable = '';
  let previous: HtmlUpdate | undefined;
  const retained: [HtmlUpdate, string][] = [];
  for (const [input, incomplete] of [
    ['First\n\nTail', true],
    ['First\n\nTail', true],
    ['First\n\nTail grows', true],
    ['First\n\nTail grows\n\nNext', true],
    ['First\n\nTail grows\n\nNext [later][id]', true],
    ['First\n\nTail grows\n\nNext [later][id]\n\n[id]: /target', true],
    ['Replacement\n\n*unfinished', true],
    ['Replacement\n\n*unfinished', false],
    ['', false],
  ] as const) {
    const update = session.render(input, { incomplete });
    if (update !== previous) {
      assert.equal(update.revision, (previous?.revision ?? 0) + 1);
      stable = (update.reset ? '' : stable) + update.addition;
    }
    assert.equal(stable, update.stable);
    assert.equal(stable + update.pending, full(input, { incomplete }));
    retained.push([update, stable + update.pending]);
    previous = update;
  }
  // Reading the full-output getter later must use that result's own strings.
  for (const [update, expected] of retained) {
    assert.equal(
      typeof Object.getOwnPropertyDescriptor(update, 'html')?.get,
      'function'
    );
    assert.equal(update.html, expected);
  }
});

void test('only inputs that extend the previous one reuse its prefix', () => {
  const session = createHtmlSession();
  session.render('é **a**\n\nb');
  for (const [input, reset] of [
    ['é **x**\n\nb', true],
    ['é **x**\n\n', true],
    ['é **x**\n\nb😀', false],
  ] as const) {
    const update = session.render(input);
    assert.equal(update.reset, reset, input);
    assert.equal(update.html, full(input), input);
  }
  // appends build rope strings
  let rope = 'é\n\n';
  for (const chunk of ['a', ' *b', '*\n\n', 'c']) {
    rope += chunk;
    const update = session.render(rope);
    assert.equal(update.html, full(rope), rope);
  }
});

void test('ordinary paragraph runs keep append boundaries through table conversion', () => {
  const source =
    'Alpha.\nBeta.\nGamma.\n\nBefore.\nMore.\nA | B\n' +
    '--- | ---\nx | y\n\nTail 界.\nMore tail.\n===\n\nEnd.';
  for (const newline of ['\n', '\r\n']) {
    const input = source.replaceAll('\n', newline);
    const session = createHtmlSession();
    for (let end = 0; end <= input.length; end++) {
      const prefix = input.slice(0, end);
      assert.equal(
        session.render(prefix).html,
        full(prefix),
        JSON.stringify(prefix)
      );
    }
  }
});

void test('word-by-word streaming keeps incomplete emphasis through spaces', () => {
  const phrase = 'Great tools make you want to keep going.';
  for (const [delimiter, tag] of [
    ['**', 'strong'],
    ['*', 'em'],
    ['__', 'strong'],
    ['_', 'em'],
    ['~~', 'del'],
  ]) {
    const session = createHtmlSession();
    const start = `Good tools get out of your way. ${delimiter}`;
    for (let end = 1; end <= phrase.length; end++) {
      const input = start + phrase.slice(0, end);
      const content = input.trimEnd();
      const expected = full(content + delimiter + input.slice(content.length));
      const actual = session.render(input, { incomplete: true }).html;
      assert.equal(actual, expected, JSON.stringify(input));
      assert.ok(actual.includes(`<${tag}>`), JSON.stringify(input));
    }
    const complete = start + phrase + delimiter;
    assert.equal(
      session.render(complete, { incomplete: true }).html,
      full(complete)
    );
    assert.equal(session.render(complete).html, full(complete));
  }
});

void test('synthetic emphasis closers preserve whitespace, nesting, and inline code', () => {
  for (const [source, completed] of [
    ['**bold *italic ', '**bold *italic*** '],
    ['__bold _italic\t', '__bold _italic___\t'],
    ['**bold _italic\r\n', '**bold _italic_**\r\n'],
    ['**word\u00a0\u2003', '**word**\u00a0\u2003'],
    ['[**bold ', '[**bold** ](streamdown:incomplete-link)'],
    ['[__bold\t', '[__bold__\t](streamdown:incomplete-link)'],
    ['**`hello ', '**`hello `**'],
    [
      '[**word' + ' '.repeat(8192),
      '[**word**' + ' '.repeat(8192) + '](streamdown:incomplete-link)',
    ],
  ])
    assert.equal(
      full(source, { incomplete: true }),
      fullPending(completed),
      JSON.stringify(source)
    );
});

/** Stream every prefix and compare each update with a fresh full render. */
const streamMatches = (source: string, incomplete: boolean) => {
  const session = createHtmlSession();
  let stable = '';
  for (let end = 0; end <= source.length; end++) {
    const input = source.slice(0, end);
    const update = session.render(input, { incomplete });
    stable = (update.reset ? '' : stable) + update.addition;
    assert.equal(update.stable, stable, JSON.stringify(input));
    assert.equal(
      update.html,
      full(input, { incomplete }),
      JSON.stringify({ input, incomplete })
    );
  }
};

void test('CR and CRLF blank lines end inline repair like LF ones', () => {
  for (const [source, expected] of [
    ['**a\r\n\r\nb', '<p>**a</p>\n<p>b</p>\n'],
    ['_a\r\n\r\nb _c_', '<p>_a</p>\n<p>b <em>c</em></p>\n'],
    ['[a\r\n\r\nb', '<p>[a</p>\n<p>b</p>\n'],
    ['*a\r\rb', '<p>*a</p>\n<p>b</p>\n'],
    [
      '```\r\nx\r\n```\r\n\r\n*b',
      '<pre><code>x\n</code></pre>\n<p><em>b</em></p>\n',
    ],
  ]) {
    assert.equal(full(source, { incomplete: true }), expected, source);
    streamMatches(source, true);
  }
});

void test('only blank lines are append boundaries for inline repair', () => {
  for (const source of [
    '`\n***\n\nmore',
    '\t*g\n---\nx',
    '*a\n#\nb\n\nc',
    '`a\n===\n\n*b',
  ]) {
    streamMatches(source, true);
    streamMatches(source, false);
  }
});

void test('emphasis around unfinished links and images closes outside them', () => {
  for (const [source, completed] of [
    ['1. **[React', '1. **[React](streamdown:incomplete-link)**'],
    ['1. **[React](https://', '1. **[React](streamdown:incomplete-link)**'],
    ['[**a](http', '[**a**](streamdown:incomplete-link)'],
    ['**bold ![alt', '**bold** '],
    ['**x ![a](http://y', '**x** '],
    ['[a](b`c) more *x', '[a](b`c) more *x*'],
    ['[a](http://x/[y', '[a](streamdown:incomplete-link)'],
    ['[a](u) *[b*', '[a](u) *[b*](streamdown:incomplete-link)'],
    ['<b [a', ''],
  ]) {
    assert.equal(
      full(source, { incomplete: true }),
      fullPending(completed),
      JSON.stringify(source)
    );
  }
});

void test('repair follows the parser on fences, escapes, and tildes', () => {
  for (const [source, completed] of [
    // not fences: a backtick info string, text before the run
    ['```a```\n\n*b', '```a```\n\n*b*'],
    ['2024 ```\n\n*b', '2024 ```\n\n*b*'],
    // a fence in a quote ends with the quote
    ['> ```\n> code\n\n*b', '> ```\n> code\n\n*b*'],
    ['- ```\n  code\n\n*b', '- ```\n  code\n\n*b*'],
    // a closing fence may end in CR
    ['```\r\nx\r\n```\r\n*b', '```\r\nx\r\n```\r\n*b*'],
    // `\` before a line end is a hard break, not an escape
    ['*a\\\n\nb', '*a\\\n\nb'],
    ['foo\\\n```\ncode *x', 'foo\\\n```\ncode *x'],
    ['![a\\\n\nfoo', '![a\\\n\nfoo'],
    // a lone `~` is not strikethrough
    ['It takes ~5 min to build.', 'It takes ~5 min to build.'],
    ['~~del', '~~del~~'],
    // code ticks stay on the last line, where they cannot start a fence
    ['x ```a\n', 'x ```a```\n'],
  ]) {
    assert.equal(
      full(source, { incomplete: true }),
      full(completed),
      JSON.stringify(source)
    );
    streamMatches(source, true);
  }
});

void test('sessions match full renders across BOMs, CRs, and astral text', () => {
  for (const source of [
    '﻿**a\n\nb',
    '﻿[\n\n',
    '`\n\r\na',
    '*_\n\r\n`',
    '<b>```ts\n\r\n x',
    'a\n\n﻿b *c\n\nd',
    '😀 **x\n\n𝔸 `y\r\n\r\n[z\r\r😀',
    '<v>\n```\n\n[',
  ]) {
    streamMatches(source, true);
    streamMatches(source, false);
  }
  // two-update repros: a reused prefix must equal a fresh render
  for (const [first, second] of [
    ['`\n\r\n', '`\n\r\na'],
    ['*_\n\r\n', '*_\n\r\n`'],
    ['<b>```ts\n\r\n', '<b>```ts\n\r\n '],
  ]) {
    const session = createHtmlSession();
    session.render(first, { incomplete: true });
    const update = session.render(second, { incomplete: true });
    assert.equal(update.html, full(second, { incomplete: true }), second);
    assert.ok(!update.stable.includes('<pre'), second);
  }
});

void test('unfinished HTML attributes do not repair emphasis in preceding blocks', () => {
  for (const delimiter of ['*', '**', '_', '__', '~~']) {
    const prefix = 'Completed **prefix**.\n\n';
    const source = prefix + `<div ${delimiter}?`;
    const session = createHtmlSession();
    for (let end = 0; end <= source.length; end++) {
      const input = source.slice(0, end);
      assert.equal(
        session.render(input, { incomplete: true }).html,
        full(input, { incomplete: true }),
        JSON.stringify(input)
      );
    }
    assert.equal(full(source, { incomplete: true }), full(prefix));
  }
});

void test('a delivery-ending label keeps its incomplete link across the ] boundary', () => {
  const session = createHtmlSession();
  for (const source of [
    'See [l',
    'See [link',
    'See [link]',
    'See [link](',
    'See [link](https://exam',
  ]) {
    const { html } = session.render(source, { incomplete: true });
    assert.equal(
      html,
      `<p>See <a data-markdown-incomplete>${source.startsWith('See [link') ? 'link' : 'l'}</a></p>\n`
    );
  }
  assert.equal(
    links(
      session.render('See [link](https://example.com)', { incomplete: true })
        .html
    )[0][1],
    'https://example.com'
  );
});

void test('closed streaming labels preserve references, images, and footnotes at EOF', () => {
  const references = [
    '[label]: /target\n\nSee [label]',
    '[label]: /target\n\nSee [label][]',
    '[label]: /target\n\nSee [visible][label]',
    '[É 中]: /unicode\n\nSee [é 中]',
    '[a\\*b]: /escaped\n\nSee [a\\*b]',
    '> [label]: /target\n>\n> See [label]',
    '- [label]: /target\n\n  See [label]',
    '[image]: /image.png\n\n![image]',
    '[image]: /image.png\n\n![image][]',
    '[image]: /image.png\n\n![visible][image]',
    '[^note]: A note\n\nSee[^note]',
    '[^note]: A note\n\n> See[^note]',
  ];
  for (const source of references) {
    const expected = full(source);
    assert.equal(full(source, { incomplete: true }), expected, source);
    // A following static render must not inherit the synthetic-destination flag.
    assert.equal(full(source), expected, source);
  }
});

void test('trailing labels keep UTF-8, nested formatting, and synthetic outer emphasis', () => {
  for (const [source, expected] of [
    ['See [é 中]', 'é 中'],
    [
      'See [**bold** and `code`]',
      '<strong>bold</strong> and <code>code</code>',
    ],
  ]) {
    const html = full(source, { incomplete: true });
    assert.equal(
      html,
      `<p>See <a data-markdown-incomplete>${expected}</a></p>\n`
    );
  }
  for (const delimiter of ['*', '**', '_', '__', '~~']) {
    const source = `[label]: /target\n\n${delimiter}See [label]`;
    assert.equal(
      full(source, { incomplete: true }),
      full(source + delimiter),
      source
    );
    const unresolved = `${delimiter}See [new]`;
    const html = full(unresolved, { incomplete: true });
    assert.equal(links(html)[0][1], undefined);
    assert.equal(links(html)[0][2], 'new');
    assert.match(html, /^<p><(?:em|strong|del)>See /, unresolved);
  }
});

void test('completion flags never change authored sentinel URLs or static brackets', () => {
  const authored = '[label]: /real\n\n[label](streamdown:incomplete-link)';
  const expected = full(authored);
  assert.equal(links(expected)[0][1], 'streamdown:incomplete-link');
  full('See [pending]', { incomplete: true });
  assert.equal(full(authored), expected);
  assert.equal(full(authored, { incomplete: true }), expected);
  assert.equal(full('See [pending]'), '<p>See [pending]</p>\n');
});

void test('internal streaming markers stay out of other APIs', () => {
  const plain = (source: string, options?: HtmlSessionOptions) =>
    decoder.decode(renderToHtml(source, options));
  assert.equal(
    plain('```\nfoo', { skipHtml: true } as HtmlSessionOptions),
    '<pre><code>foo\n</code></pre>\n'
  );
  assert.equal(
    createHtmlSession().render('```\nfoo').html,
    '<pre data-markdown-incomplete><code>foo\n</code></pre>\n'
  );
  for (const source of ['[a', '[a]', '[a](htt'])
    for (const html of [
      plain(source, { incomplete: true }),
      createHtmlSession().render(source, { incomplete: true }).html,
    ])
      assert.equal(html, '<p><a data-markdown-incomplete>a</a></p>\n');
  // A source that writes the same URL keeps it when no link is pending.
  assert.equal(
    plain('[a](streamdown:incomplete-link)'),
    '<p><a href="streamdown:incomplete-link">a</a></p>\n'
  );
});

void test('inline state ends with its block, without a blank line', () => {
  for (const [source, expected] of [
    ['- **kwargs\n- next', '- \\*\\*kwargs\n- next'],
    ['1. `a\n2. b', '1. \\`a\n2. b'],
    ['1. *a\n2) b', '1. \\*a\n2) b'],
    ['# *a\nfoo', '# \\*a\nfoo'],
    ['- # *a\nfoo', '- # \\*a\nfoo'],
    ['> *a\n>\n> b', '> \\*a\n>\n> b'],
    ['> *a\n> > b', '> \\*a\n> > b'],
    ['*a\n> b', '\\*a\n> b'],
    ['*a\n# b', '\\*a\n# b'],
    ['*a\n---\nb', '\\*a\n---\nb'],
    ['*a\n===\nb', '\\*a\n===\nb'],
    ['*a\n--\nb', '\\*a\n--\nb'],
    ['*a\n* * *\nb', '\\*a\n* * *\nb'],
    ['[l\n- b', '\\[l\n- b'],
    ['# *a\r\nfoo', '# \\*a\r\nfoo'],
    ['| *a | b |\n|---|---|\n| c | d |', '| \\*a | b |\n|---|---|\n| c | d |'],
    ['| a |\n|---|\n| *b |\n| c |', '| a |\n|---|\n| \\*b |\n| c |'],
  ])
    assert.equal(
      full(source, { incomplete: true }),
      full(expected),
      JSON.stringify(source)
    );
  // A paragraph continues over these lines, so its closers still come last.
  for (const [source, completed] of [
    ['*a\nb', '*a\nb*'],
    ['> *a\n> b', '> *a\n> b*'],
    ['> > *a\n> b', '> > *a\n> b*'],
    ['- *a\n  b', '- *a\n  b*'],
    ['**a\n**b', '**a\n**b****'],
    ['`a\nb', '`a\nb`'],
  ])
    assert.equal(
      full(source, { incomplete: true }),
      full(completed),
      JSON.stringify(source)
    );
});

void test('closers that could not close are not appended', () => {
  for (const [source, completed] of [
    // A closing tick run would join the run that ends the content.
    ['foo `', 'foo `'],
    ['foo ``', 'foo ``'],
    ['a ```', 'a ```'],
    ['``', '``'],
    ['foo ` ', 'foo ` '],
    ['``a`', '``a`'],
    ['*`', '*`*'],
    // A final backslash would escape the closer, and has nothing to escape yet.
    ['*a\\', '*a*'],
    ['**a\\', '**a**'],
    ['~~a\\', '~~a~~'],
    ['*a\\\n', '*a*\n'],
    ['*a\\\\', '*a\\\\*'],
    ['`a\\', '`a\\`'],
    // Closers right after their opener would double it as text.
    ['_\\', '_\\'],
    ['**\\', '**\\'],
    ['*\\ ', '*\\ '],
    ['*\u00a0', '*\u00a0'],
    // A lone `~` that ends the content joins the closing `~`.
    ['~~a~', '~~a~~'],
  ])
    assert.equal(
      full(source, { incomplete: true }),
      full(completed),
      JSON.stringify(source)
    );
  assert.equal(
    full('[a\\', { incomplete: true }),
    '<p><a data-markdown-incomplete>a</a></p>\n'
  );
});

void test('a render that throws leaves the session unchanged', () => {
  const renderer = init(
    new WebAssembly.Module(
      readFileSync(new URL('../dist/md.wasm', import.meta.url))
    )
  );
  const session = createHtmlSession();
  const first = session.render('one\n\ntwo\n\nth');
  assert.equal(first.stable, '<p>one</p>\n<p>two</p>\n');
  const render = renderer.render;
  renderer.render = () => {
    throw new RangeError('too large');
  };
  assert.throws(() => session.render('replacement'), RangeError);
  renderer.render = render;
  const next = session.render('one\n\ntwo\n\nthree\n\n');
  assert.equal(next.reset, false);
  assert.equal(next.addition, '<p>three</p>\n');
  assert.equal(next.html, '<p>one</p>\n<p>two</p>\n<p>three</p>\n');
});

void test('closed-label repair never changes code, raw blocks, or reference destinations', () => {
  for (const source of [
    '    [code]',
    '```text\n[code]',
    '<pre>\n[code]',
    '<div>\n[raw]',
    'See [guide]\n\n[guide]: https://example.com/[doc]',
    'See [guide]\n\n[guide]: https://example.com/doc "[title]"',
  ]) {
    assert.equal(full(source, { incomplete: true }), full(source), source);
  }
});

void test('only the final source label is repaired in rebuilt blocks and table cells', () => {
  for (const [source, beforeLink] of [
    ['[old]\n\n[new]', '<p>[old]</p>\n<p>'],
    ['> Earlier\n> See [new]', '<blockquote>\n<p>Earlier\nSee '],
    ['- Earlier\n  See [new]', '<ul>\n<li>Earlier\nSee '],
    ['| A | B |\n|---|---|\n| [old] | [new]', '<td>[old]</td>\n<td>'],
    ['| A | B |\n|---|---|\n| [old] | a\\|b [new]', '<td>[old]</td>\n<td>a|b '],
  ]) {
    const html = full(source, { incomplete: true });
    assert.ok(
      html.includes(`${beforeLink}<a data-markdown-incomplete>new</a>`),
      source
    );
    assert.equal(links(html).length, 1, source);
  }
});

void test('every conformance-example prefix matches full parsing in both completion modes', () => {
  for (const name of ['commonmark', 'gfm']) {
    const examples = JSON.parse(
      readFileSync(new URL(`./spec/${name}-spec.json`, import.meta.url), 'utf8')
    );
    for (const { markdown, example } of examples) {
      const source = `Completed **prefix**.\n\n${markdown}\n\nTail`;
      for (const incomplete of [false, true]) {
        const session = createHtmlSession();
        for (let end = 0; end <= source.length; end++) {
          const input = source.slice(0, end);
          assert.equal(
            session.render(input, { incomplete }).html,
            full(input, { incomplete }),
            JSON.stringify({ name, example, input, incomplete })
          );
        }
      }
    }
  }
});
