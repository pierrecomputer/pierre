import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createHtmlRenderer } from '../dist/html.js';
import { createHtmlSession, renderToHtml } from '../dist/index.js';

const dec = new TextDecoder();
const allowedHtml = {
  details: ['open'],
  summary: [],
  ref: ['id'],
  'x-widget': ['data-id'],
  a: ['href', 'title', 'onclick', 'srcdoc', 'data-markdown'],
  br: [],
  script: [],
};
const html = (source: string, options: object = { allowedHtml }): string =>
  dec.decode(renderToHtml(source, options));
const details =
  '<details>\n<summary>Title</summary>\n\nBody **bold**\n\n</details>\n\nAfter\n';

void test('allowed tags pass with only their allowed attributes', () => {
  assert.equal(
    html(
      '<details open class="x" onclick="bad()">\n<summary>T</summary>\n</details>'
    ),
    '<details open>\n<summary>T</summary>\n</details>\n'
  );
  assert.equal(
    html('See <REF id="1" class="x">one</ref> and <Ref ID=2>two</REF>.'),
    '<p>See <ref id="1">one</ref> and <ref id="2">two</ref>.</p>\n'
  );
  assert.equal(
    html('<a title="a &amp; &quot;b&quot; >" href=\'/x?a=1&b=2\'>x</a>'),
    '<p><a title="a &amp; &quot;b&quot; &gt;" href="/x?a=1&amp;b=2">x</a></p>\n'
  );
  // Void elements take no closer; `/>` closes other elements at once.
  assert.equal(
    html('a<br>b<BR/>c</br> <x-widget data-id="5"/> d'),
    '<p>a<br />b<br />c <x-widget data-id="5"></x-widget> d</p>\n'
  );
});

void test('unsafe attributes, values, and tags never pass', () => {
  for (const value of [
    'javascript:alert(1)',
    ' JaVaScRiPt:alert(1)',
    'java&#x09;script&colon;alert(1)',
    'java\nscript:alert(1)',
    '&#106;avascript:alert(1)',
    'vbscript:msgbox(1)',
  ])
    assert.equal(
      html(`<a href="${value}" title="t">x</a>`),
      '<p><a title="t">x</a></p>\n',
      value
    );
  assert.equal(
    html('<a onclick="bad()" srcdoc="x" data-markdown="a" href="/ok">x</a>'),
    '<p><a href="/ok">x</a></p>\n'
  );
  assert.equal(html('<script>alert(1)</script>'), '');
  assert.equal(html('x <script>alert(1)</script>'), '<p>x alert(1)</p>\n');
  // Text shows only inside an allowed element, without dropped raw text content.
  assert.equal(
    html(
      '<details>\n<div>shown</div>\n<style>p{}</style>\n<script>bad()</script>\n<!-- c --></details>'
    ),
    '<details>\nshown\n\n\n</details>\n'
  );
});

void test('unlisted tags are dropped as skipHtml drops them', () => {
  const spec = [
    ...JSON.parse(
      readFileSync(
        new URL('spec/commonmark-spec.json', import.meta.url),
        'utf8'
      )
    ),
    ...JSON.parse(
      readFileSync(new URL('spec/gfm-spec.json', import.meta.url), 'utf8')
    ),
  ] as { markdown: string }[];
  for (const { markdown } of spec)
    for (const incomplete of [false, true])
      assert.equal(
        html(markdown, { allowedHtml: { 'x-none': [] }, incomplete }),
        html(markdown, { skipHtml: true, incomplete }),
        markdown
      );
  assert.equal(html('<b>x</b>', { allowedHtml: {} }), '<p>x</p>\n');
  assert.equal(html('<b>x</b>', { skipHtml: true, allowedHtml }), '<p>x</p>\n');
});

void test('open elements close with their paragraph, container, or document', () => {
  assert.equal(
    html('<ref id=1>a\n\nb</ref>'),
    '<p><ref id="1">a</ref></p>\n<p>b</p>\n'
  );
  assert.equal(
    html('- <details>\n\n  body\n- next </details>'),
    '<ul>\n<li>\n<details>\n<p>body</p>\n</details>\n</li>\n<li>\n<p>next </p>\n</li>\n</ul>\n'
  );
  assert.equal(
    html('<details>\n<summary>a\n\nb'),
    '<details>\n<summary>a\n<p>b</p>\n</summary>\n</details>\n'
  );
  // A closer for an element of another leaf or container is dropped.
  assert.equal(
    html('<details>\n\nx </details>'),
    '<details>\n<p>x </p>\n</details>\n'
  );
});

void test('a session keeps an open allowed element pending across blank lines', () => {
  for (const incomplete of [false, true]) {
    const session = createHtmlSession();
    for (let end = 1; end <= details.length; end++) {
      const source = details.slice(0, end);
      const update = session.render(source, { allowedHtml, incomplete });
      assert.equal(
        update.html,
        html(source, { allowedHtml, incomplete }),
        source
      );
      // Completed output never freezes an element that is still open.
      if (end < details.indexOf('</details>\n\n') + 12)
        assert.equal(update.stable, '', source);
    }
    const last = session.render(details, { allowedHtml, incomplete });
    assert.equal(
      last.stable,
      '<details>\n<summary>Title</summary>\n<p>Body <strong>bold</strong></p>\n</details>\n'
    );
    assert.equal(last.pending, '<p>After</p>\n');
    // A changed list renders again from the start.
    assert.equal(
      session.render(details, { allowedHtml: { summary: [] }, incomplete })
        .html,
      '<summary>Title</summary>\n<p>Body <strong>bold</strong></p>\n<p>After</p>\n'
    );
  }
  const pending = createHtmlSession().render(details.slice(0, 50), {
    allowedHtml,
  });
  assert.equal(
    pending.pending,
    '<details>\n<summary>Title</summary>\n<p>Body <strong>bold</strong></p>\n</details>\n'
  );
});

void test('the HTML renderer streams allowed elements like a fresh render', () => {
  const source =
    details + '<details><summary>x</summary>\n\n```js\ncode\n```\n';
  const streaming = createHtmlRenderer({ allowedHtml });
  for (let end = 1; end <= source.length; end++) {
    const fresh = createHtmlRenderer({ allowedHtml });
    assert.equal(
      streaming.render(source.slice(0, end), true, true).html,
      fresh.render(source.slice(0, end), true, true).html
    );
    fresh.dispose();
  }
  assert.match(
    streaming.render(source, false).html,
    /^<details>\n<summary>Title/
  );
  streaming.dispose();
});

void test('invalid or oversized lists throw', () => {
  assert.throws(
    () => renderToHtml('x', { allowedHtml: { 'a b': [] } }),
    TypeError
  );
  assert.throws(
    () => renderToHtml('x', { allowedHtml: { a: ['x y'] } }),
    TypeError
  );
  assert.throws(
    () =>
      renderToHtml('x', {
        allowedHtml: {
          a: ['x'.repeat(200)].concat(
            Array.from({ length: 30 }, (_, i) => 'y'.repeat(150) + i)
          ),
        },
      }),
    RangeError
  );
  assert.equal(html('<a href="/">x</a>'), '<p><a href="/">x</a></p>\n');
});

void test('lists share memory with the id prefix of formatted output', () => {
  const big = Object.fromEntries(
    Array.from({ length: 250 }, (_, at) => [`x-tag${at}`, ['a']])
  );
  const options = { idPrefix: 'p'.repeat(1000), allowedHtml };
  const source = (text: string) =>
    `<details>\n\n${text}[^1]\n\n[^1]: <ref id=1>n</ref>\n`;
  const renderer = createHtmlRenderer(options);
  for (const text of ['a', 'b', 'c']) {
    const got = renderer.render(source(text), false).html;
    assert.equal(
      got,
      createHtmlRenderer(options).render(source(text), false).html
    );
    assert.match(got, /id="p{1000}fn-1"/);
    assert.match(got, /<ref id="1">n<\/ref>/);
    assert.equal(
      html('<x-tag249 a=1>y', { allowedHtml: big }),
      '<p><x-tag249 a="1">y</x-tag249></p>\n'
    );
  }
  renderer.dispose();
});

void test('formatted output checks kept URL attributes like Markdown URLs', () => {
  const list = { a: ['href', 'title'], img: ['src'], form: ['action'] };
  for (const urlTransform of [undefined, (url: string) => url]) {
    const renderer = createHtmlRenderer({ allowedHtml: list, urlTransform });
    const render = (url: string): string =>
      renderer.render(
        `<a href="${url}" title="t: x">a</a><img src="${url}"><form action="${url}"></form>`,
        false
      ).html;
    for (const url of [
      'https://x.y/a?b',
      '/rel',
      'mailto:a@b',
      '&#x68;ttp://x',
    ])
      assert.doesNotMatch(render(url), /<a title|<img \/>|<form>/, url);
    for (const url of [
      'data:text/html,x',
      ' DATA:x',
      '//evil.com',
      '/\\evil.com',
      '/\t/evil.com',
      'foo:bar',
    ])
      assert.equal(
        render(url),
        '<p data-markdown="p"><a title="t: x">a</a><img /><form></form></p>\n',
        url
      );
    renderer.dispose();
  }
  // Plain output checks neither Markdown nor kept URLs beyond script schemes.
  assert.equal(
    html('<a href="data:x">a</a>', { allowedHtml: list }),
    '<p><a href="data:x">a</a></p>\n'
  );
});

void test('kept tags keep renderer attributes out and decode block text', () => {
  assert.equal(
    html('<a data-words-island="x" href="/">a</a>', {
      allowedHtml: { a: ['data-words-island', 'href'] },
    }),
    '<p><a href="/">a</a></p>\n'
  );
  assert.equal(
    html('<details>\n&copy; &lt;b&gt; &#0; &amp; "q"\n</details>'),
    '<details>\n© &lt;b&gt; � &amp; &quot;q&quot;\n</details>\n'
  );
});

void test('element hooks do not see kept tags that start with their name', () => {
  const renderer = createHtmlRenderer({
    allowedHtml: { 'a-card': [], a: ['href'] },
    components: { a: (element) => `<b>${element}</b>` },
  });
  assert.equal(
    renderer.render('<a-card>c</a-card> <a href="/r">r</a>', false).html,
    '<p data-markdown="p"><a-card>c</a-card> <b><a href="/r">r</a></b></p>\n'
  );
  renderer.dispose();
});
