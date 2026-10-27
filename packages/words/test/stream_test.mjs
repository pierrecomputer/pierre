import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createHtmlSession, renderToHtml } from '../dist/node.mjs';

const decoder = new TextDecoder();
/** Render independently of the append cache, with the same source-HTML policy. */
const full = (source, options) =>
  decoder.decode(renderToHtml(source, { ...options, skipHtml: true }));
const links = (html) => [
  ...html.matchAll(/<a href="([^"]*)"[^>]*>(.*?)<\/a>/gs),
];

void test('HTML additions reconstruct output through appends, repeated inputs, and resets', () => {
  const session = createHtmlSession();
  let stable = '';
  let previous;
  const retained = [];
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
  ]) {
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
      typeof Object.getOwnPropertyDescriptor(update, 'html').get,
      'function'
    );
    assert.equal(update.html, expected);
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
      full(completed),
      JSON.stringify(source)
    );
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
      `<p>See <a href="streamdown:incomplete-link">${source.startsWith('See [link') ? 'link' : 'l'}</a></p>\n`
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
      `<p>See <a href="streamdown:incomplete-link">${expected}</a></p>\n`
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
    assert.equal(links(html)[0][1], 'streamdown:incomplete-link');
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
      html.includes(
        `${beforeLink}<a href="streamdown:incomplete-link">new</a>`
      ),
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
