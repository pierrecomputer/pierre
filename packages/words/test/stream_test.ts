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

void test('a missing incomplete option and false are the same mode', () => {
  const session = createHtmlSession();
  session.render('one\n\ntw');
  const update = session.render('one\n\ntwo', { incomplete: false });
  assert.equal(update.reset, false);
  assert.equal(update.stable, '<p>one</p>\n');
  assert.equal(session.render('one\n\ntwo'), update);
  assert.equal(session.render('one\n\ntwo', {}), update);
  assert.equal(session.render('one\n\ntwo!', { incomplete: true }).reset, true);
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

void test('completion pairs delimiter runs like the parser', () => {
  // Nothing is open here, so no closer may show as text.
  for (const source of [
    // one run closes two openers
    '**bold *italic***',
    '**bold *italic*** and',
    '*a **b***',
    // `*` closes inside a word
    '**bold**text',
    '**加粗**文字',
    '他说：**重要**的事',
    // a run after a word and before punctuation cannot open
    '5*(3+2)',
    'a = b*(c',
    'the foo_.',
    'x**-1',
    // a closer takes the nearest opener of its character and ends the ones between
    '*a _b* c',
    '__a *b__ c',
    '~~a **b~~ c',
    // tildes pair only at equal lengths
    '~~a ~5 b',
    '~~x ~y',
    '~~a ~~b~~',
    '~~a ~',
  ])
    assert.equal(full(source, { incomplete: true }), full(source), source);
  for (const [source, completed] of [
    // the rule of three keeps an intraword `*` out of a `**` pair
    ['**2*3', '**2*3**'],
    // after punctuation a run can open
    ['*a (*b', '*a (*b**'],
    // a lone `~` is text that closers can follow
    ['**a ~', '**a ~**'],
    // a run or an opener that cannot close waits when closers are pending
    ['**- *\r\n![_', '**-**'],
    ['*a **<b', '*a* '],
    // emphasis opened in a closed label cannot close after it
    ['[**a]', '[\\*\\*a](streamdown:incomplete-link)'],
    ['[__]', '[\\_\\_](streamdown:incomplete-link)'],
    // an escaped `!` starts no image
    ['*\\![- __[^1]', '*\\![- __[^1]__](streamdown:incomplete-link)*'],
  ]) {
    assert.equal(
      full(source, { incomplete: true }),
      fullPending(completed),
      JSON.stringify(source)
    );
    streamMatches(source, true);
  }
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
    ['<b [a', '<b [a](streamdown:incomplete-link)'],
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
    // but not after the space of a bare list marker, which they would fill
    ['a `b\n1. ', 'a `b\n1.`'],
    ['a ```\n* ', 'a ```\n*```'],
    // ticks that cannot be closed are text, and what follows them still counts
    ['__]`**__``', '__]`**__``'],
    // delimiters in an unfinished code span are code
    ['*a ``b\n1. \n*', '*a ``b\n1. \n*``*'],
    ['_~~``_x\n`\n~~', '_~~``_x\n`\n~~``~~_'],
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

void test('completion never completes a link reference definition', () => {
  // The placeholder must not balance the `(` of a definition's destination.
  for (const source of [
    '## x [a]\n[a]: /u===[](',
    '[a]: [b](',
    '[a]: x[b](http://y',
    // `[label]:` still waits for a destination, and closers would be one
    '[a *b]:',
    '[a *b]: ',
    '[\\*y*`` \\[a]:    \n',
    // `[^1][a` can still be a reference with the label `a`
    '[a]: /u\n\nx [^1][a',
    // `[^1](...)` is a link when no footnote has that label
    '[^1](titlex[)',
    // after `][` the placeholder would end a reference label
    '[a]: /u\n\n[a][![x',
    '[b]: /u\n\n[x][b ![c',
  ]) {
    const html = full(source, { incomplete: true });
    assert.ok(!html.includes('streamdown'), JSON.stringify(source));
    assert.ok(!html.includes('href="%5B'), JSON.stringify(source));
    streamMatches(source, true);
  }
  // closing ticks would be a destination too, and the placeholder a paragraph
  for (const source of [
    '[a *b]:',
    '[`x]:',
    '[`x]:\n',
    '[``]:\n',
    '[*`]:\n',
    '- [`]:\n',
  ])
    assert.equal(full(source, { incomplete: true }), full(source), source);
  // A source that writes the placeholder's URL keeps it next to a pending link.
  assert.equal(
    full('[x](streamdown:incomplete-link)\n\n[y', { incomplete: true }),
    '<p><a href="streamdown:incomplete-link">x</a></p>\n' +
      '<p><a data-markdown-incomplete>y</a></p>\n'
  );
  // also in rebuilt content, where the placeholder is known by its position
  assert.equal(
    full('> [x](streamdown:incomplete-link) y\n> [z', { incomplete: true }),
    '<blockquote>\n<p><a href="streamdown:incomplete-link">x</a> y\n' +
      '<a data-markdown-incomplete>z</a></p>\n</blockquote>\n'
  );
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

void test('a final backslash after whitespace stays behind the closers', () => {
  for (const [source, completed] of [
    ['*a\n\\    ', '*a*\n\\'],
    ['*a\n\\', '*a*\n\\'],
    ['*a \\', '*a* \\'],
    // before whitespace a `\` is text or a hard break
    ['*a\\ <b', '*a*\\ '],
    ['**a\\\n<b', '**a**\\\n'],
    // a placeholder right after it would be escaped
    ['[*a\n\\    ', '[*a*\n](streamdown:incomplete-link)'],
    ['[*a\n\\', '[*a*\n](streamdown:incomplete-link)'],
  ]) {
    assert.equal(
      full(source, { incomplete: true }),
      fullPending(completed),
      JSON.stringify(source)
    );
    streamMatches(source, true);
  }
});

void test('repair leaves code and raw HTML blocks alone', () => {
  for (const source of [
    'Para\n\n    const a = [',
    '    **bold',
    '    `tick',
    '\tb [',
    '- a\n\n      code [',
    '> a\n>\n>     code *',
    'x[^1]\n\n[^1]: ```js\n    const a = [',
    // A fence indented four columns neither opens nor closes.
    '```py\n    ```\nx = [',
    '    ```\n\n```\n[a',
  ]) {
    assert.equal(full(source, { incomplete: true }), full(source), source);
    streamMatches(source, true);
  }
  const raw = (source: string) =>
    decoder.decode(renderToHtml(source, { incomplete: true }));
  assert.equal(raw('<!-- [a'), '<!-- [a\n');
  assert.equal(raw('<div>\n[a'), '<div>\n[a\n');
  // An unfinished tag would swallow the markup after it.
  assert.equal(raw('<div class="a'), '');
  assert.equal(raw('<div>\n<b c="'), '<div>\n');
  // After an indented "fence", later blocks still repair and sessions move on.
  assert.equal(
    full('    ```\n\ntext **bold', { incomplete: true }),
    full('    ```\n\ntext **bold**')
  );
  assert.ok(
    createHtmlSession()
      .render('    ```\n\ntext\n\nmore **bold', { incomplete: true })
      .stable.includes('<p>text</p>')
  );
});

void test('bare URLs keep their bytes out of repair', () => {
  for (const [source, expected] of [
    ['See https://a.bc/[id', 'See https://a.bc/[id'],
    ['See https://a.bc/[id](x', 'See https://a.bc/[id](x'],
    ['See https://a.bc/*x', 'See https://a.bc/*x'],
    ['See www.a.bc/_x', 'See www.a.bc/_x'],
    ['**https://a.bc/x', '**https://a.bc/x**'],
    ['_https://a.bc/x', '_https://a.bc/x_'],
  ]) {
    assert.equal(
      full(source, { incomplete: true }),
      full(expected),
      JSON.stringify(source)
    );
    streamMatches(source, true);
  }
});

void test('only text that can still become a tag is hidden', () => {
  for (const [source, expected] of [
    // Bytes that cannot be in a tag show the text at once.
    ['if x <y, then more', 'if x \\<y, then more'],
    ['a <1', 'a \\<1'],
    // A `<` right after a word is a comparison or a generic type.
    ['if x<y and more', 'if x\\<y and more'],
    ['Vec<int and more', 'Vec\\<int and more'],
    // These can still become a tag.
    ['a <b', 'a '],
    ['a <b c', 'a '],
    ['a <b c="d', 'a '],
    ['a </b', 'a '],
    ['**a <b c="*', '**a** '],
    // A finished tag is whole: its attributes hold no delimiters.
    ['a <b c="*">d', 'a <b c="*">d'],
    ['a <!-- *b --> c', 'a <!-- *b --> c'],
    // An autolink shows as text until it closes, and is whole afterwards.
    ['a <mailto:b_c', 'a \\<mailto:b_c'],
    ['a <http://b.c/*d>', 'a <http://b.c/*d>'],
    // A tag on an earlier line cannot hide this line.
    ['a <b\nc', 'a \\<b\nc'],
  ]) {
    assert.equal(
      decoder.decode(renderToHtml(source, { incomplete: true })),
      decoder.decode(renderToHtml(expected)),
      JSON.stringify(source)
    );
  }
});

void test('a final backslash never creates a blank line', () => {
  for (const [source, final] of [
    ['[a\n\\\n', '[a\n\\\nb](u)'],
    ['[a\\ ', '[a\\ b](u)'],
    ['> [a\n> \\\n', '> [a\n> \\\n> b](u)'],
  ]) {
    assert.equal(links(full(source, { incomplete: true })).length, 1, source);
    assert.ok(!full(source, { incomplete: true }).includes('streamdown'));
    streamMatches(final, true);
  }
  assert.equal(
    createHtmlSession().render('[a\n\\\n', { incomplete: true }).stable,
    ''
  );
});

void test('a delimiter run at the end waits instead of breaking the closers', () => {
  for (const [source, completed] of [
    ['**bold *', '**bold**'],
    ['**bold **', '**bold**'],
    ['*foo **', '*foo*'],
    ['__a _', '__a__'],
    ['**a * ', '**a**'],
    ['~~a *', '~~a~~'],
    // Nothing to close: the run stays as it was.
    ['a *', 'a *'],
    ['[a *', '[a *](streamdown:incomplete-link)'],
  ]) {
    assert.equal(
      full(source, { incomplete: true }),
      fullPending(completed),
      JSON.stringify(source)
    );
    streamMatches(source, true);
  }
});

void test('link destinations follow the parser on parentheses and titles', () => {
  const pending = '<p><a data-markdown-incomplete>a</a></p>\n';
  for (const source of [
    '[a](http://x/y_(z)',
    '[a](http://x/y_(z) "t',
    '[a](http://x/y_(z) "t"',
    '[a](((',
    '[a](<b c',
    '[a](b\n"t',
  ])
    assert.equal(full(source, { incomplete: true }), pending, source);
  for (const source of [
    '[a](http://x/y_(z))',
    '[a](http://x/y_(z) "t")',
    '**[a](b(c)d)**',
    // A space ends a bare destination, so this is not a link.
    '[a](b c',
    '[a](b "t" x',
  ]) {
    assert.equal(full(source, { incomplete: true }), full(source), source);
    streamMatches(source, true);
  }
  assert.equal(
    full('**[a](b(c)d) *e', { incomplete: true }),
    full('**[a](b(c)d) *e***')
  );
});

void test('nested brackets pair like the parser', () => {
  const placeholder = '](streamdown:incomplete-link)';
  for (const [source, completed] of [
    // An image in a link, while the link's destination arrives.
    ['[![b](x.svg)', `[![b](x.svg)${placeholder}`],
    ['[![b](x.svg)](https://a', `[![b](x.svg)${placeholder}`],
    ['[![b](x.svg)](https://a)', '[![b](x.svg)](https://a)'],
    // Only the unfinished image goes.
    ['[a ![b', `[a ${placeholder}`],
    ['[a ![b](htt', `[a ${placeholder}`],
    ['**[a ![b', `**[a ${placeholder}**`],
    ['[**a ![b *', `[**a** ${placeholder}`],
    // A reference link waits for its label.
    ['[a][', `[a${placeholder}`],
    ['[a][b c', `[a${placeholder}`],
    // A failed inner bracket leaves the outer one open.
    ['[a [b] c', `[a [b] c${placeholder}`],
    // An escaped `!` opens no image: the bracket after it is a link.
    ['use \\![alt](ur', `use \\![alt${placeholder}`],
    ['\\![b', `\\![b${placeholder}`],
  ]) {
    assert.equal(
      full(source, { incomplete: true }),
      fullPending(completed),
      JSON.stringify(source)
    );
    streamMatches(source, true);
  }
  for (const source of [
    // A link cannot hold a link, so the outer `]` is text.
    '[a [b](c) d',
    '[a [b](c) d](e',
    // A footnote reference takes the next `]`.
    '[a [^1',
    '[^1]: n\n\n[a [^1',
    // `[^x]` with no definition is a link once its destination is whole.
    '[^1]([)',
    '[[^1]()',
    '[a [^x](b) c',
    '![^1]([)',
    '[a [^x][b] c\n\n[b]: /u',
    // A link after an escaped `!` closes the brackets around it.
    '[see \\![alt](url) x',
    // A resolved reference stops the bracket around it from being a link.
    '[1]: /u\n\n[see [1] for',
    '[1]: /u\n\n[see [1]',
    // An opener right before a dropped image gets no closers to join.
    '[\n~~![**a',
    // A closed label inside an open bracket.
    '[a [b]',
    // A closed tick run after an open one joined the last run of the content.
    '[a ``b`',
    '![a ``b`',
  ]) {
    assert.ok(
      !full(source, { incomplete: true }).includes('streamdown'),
      JSON.stringify(source)
    );
    streamMatches(source, true);
  }
  // Definitions earlier in the document resolve the finished label.
  assert.equal(
    full('[b]: /u\n\n[a][b', { incomplete: true }),
    '<p><a data-markdown-incomplete>a</a></p>\n'
  );
  assert.equal(
    full('[b]: /u\n\n[a][b]', { incomplete: true }),
    '<p><a href="/u">a</a></p>\n'
  );
  // A list marker with no content keeps the paragraph open.
  assert.ok(!full('[\n1. ', { incomplete: true }).includes('<ol'));
  assert.ok(!full('[\n- ', { incomplete: true }).includes('<ul'));
});

void test('task markers and footnote references never show as pending links', () => {
  const item = (inner: string) => `<ul>\n<li>${inner}</li>\n</ul>\n`;
  for (const source of [
    '- [',
    '- [x',
    '- [X',
    '- [x]',
    '- [ ]',
    '- [x] ',
    '1. [ ]',
  ])
    assert.ok(
      !full(source, { incomplete: true }).includes('<a'),
      JSON.stringify(source)
    );
  assert.equal(full('- [x', { incomplete: true }), item(''));
  assert.match(full('- [x] a', { incomplete: true }), /checkbox/);
  // Other labels, and later blocks of an item, are ordinary pending links.
  assert.equal(
    full('- [ab', { incomplete: true }),
    item('<a data-markdown-incomplete>ab</a>')
  );
  assert.equal(
    full('[x]', { incomplete: true }),
    '<p><a data-markdown-incomplete>x</a></p>\n'
  );
  assert.match(
    full('- a\n\n  [x]', { incomplete: true }),
    /<a data-markdown-incomplete>x<\/a>/
  );
  for (const source of ['see [^1', 'see [^1]'])
    assert.equal(full(source, { incomplete: true }), full(source), source);
});

void test('intraword delimiters follow Unicode neighbors', () => {
  for (const source of ['café_bar', 'x_y é_z', '中文_x', 'é*b', 'snake_中'])
    assert.equal(full(source, { incomplete: true }), full(source), source);
  for (const [source, completed] of [
    ['_é', '_é_'],
    ['**中', '**中**'],
    ['é **x', 'é **x**'],
  ])
    assert.equal(full(source, { incomplete: true }), full(completed), source);
});

void test('repair stays inside a table cell and before closing heading marks', () => {
  const head = '| a | b |\n|---|---|\n';
  for (const [source, completed] of [
    [`${head}| c | **d`, `${head}| c | **d**`],
    [`${head}| c | d\\|**e`, `${head}| c | d\\|**e**`],
    // Cells parse apart, so a closer in the next cell would only show as text.
    [`${head}| **c | d`, `${head}| \\*\\*c | d`],
    [`${head}| **c |`, `${head}| \\*\\*c |`],
    [`${head}| **c |\n`, `${head}| \\*\\*c |\n`],
    ['# **a', '# **a**'],
    ['# **a ##', '# **a** ##'],
    // A heading cannot continue on the next line.
    ['# **a\n', '# \\*\\*a\n'],
    ['**a\n---', '\\*\\*a\n---'],
    // Text on an indented or blank-looking last line may still continue.
    ['**a\n  ', '**a**\n  '],
    ['> **a\n  ', '> **a**\n  '],
    ['**a\n\n  ', '\\*\\*a\n\n  '],
  ]) {
    assert.equal(
      full(source, { incomplete: true }),
      full(completed),
      JSON.stringify(source)
    );
    streamMatches(source, true);
  }
});

void test('completion stays linear on long runs', () => {
  for (const source of [
    'x' + ']'.repeat(400_000),
    '['.repeat(400_000),
    '<'.repeat(400_000),
    '<a'.repeat(200_000),
    '[a]('.repeat(100_000),
    '[a](x '.repeat(70_000),
    '<a b="'.repeat(70_000),
    '- '.repeat(40_000) + '~~~ '.repeat(40_000),
    ' '.repeat(200_000) + '~~~ '.repeat(40_000),
    'a'.repeat(100_000) + '`'.repeat(100_000),
    // runs that wait, backslashes behind the closers, and a full opener stack
    '**a ' + '* '.repeat(200_000),
    '*a ' + '\\ '.repeat(200_000),
    '**a ' + '\\'.repeat(400_001) + ' ',
    '_a '.repeat(60) + 'b* '.repeat(200_000),
    '*a '.repeat(200_000),
  ]) {
    const start = performance.now();
    renderToHtml(source, { incomplete: true });
    const ms = performance.now() - start;
    assert.ok(ms < 2000, `${source.slice(0, 12)}... took ${ms} ms`);
  }
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
