import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { renderToHtml } from '../dist/node.mjs';

const dec = new TextDecoder();
const html = (md) => dec.decode(renderToHtml(md));

export function loadSpec(...names) {
  if (names.length === 0) names = ['commonmark', 'gfm'];
  return names.flatMap((name) =>
    JSON.parse(
      readFileSync(
        new URL(`./spec/${name}-spec.json`, import.meta.url),
        'utf-8'
      )
    )
  );
}

// The renderer always enables GFM (tagfilter, autolink extension) and follows
// CommonMark 0.31.2. The upstream fixtures do not: GFM's spec.txt is 0.29, and
// neither suite applies tagfilter or the autolink extension to core Autolinks
// negatives. expectedHtml() brings the fixtures in line with the product.
const cmByMarkdown = new Map(
  loadSpec('commonmark').map((e) => [e.markdown, e.html])
);

const FILTER =
  /<(\/?(?:title|textarea|style|xmp|iframe|noembed|noframes|script|plaintext))(?=[\s>/])/gi;

function applyTagfilter(s) {
  return s.replace(FILTER, '&lt;$1');
}

// Core Autolinks examples that the GFM autolink extension rewrites.
const gfmAutolink = new Map([
  [
    '<https://foo.bar/baz bim>\n',
    '<p>&lt;<a href="https://foo.bar/baz">https://foo.bar/baz</a> bim&gt;</p>\n',
  ],
  [
    '< https://foo.bar >\n',
    '<p>&lt; <a href="https://foo.bar">https://foo.bar</a> &gt;</p>\n',
  ],
  [
    'https://example.com\n',
    '<p><a href="https://example.com">https://example.com</a></p>\n',
  ],
  [
    'foo@bar.example.com\n',
    '<p><a href="mailto:foo@bar.example.com">foo@bar.example.com</a></p>\n',
  ],
  [
    '<http://foo.bar/baz bim>\n',
    '<p>&lt;<a href="http://foo.bar/baz">http://foo.bar/baz</a> bim&gt;</p>\n',
  ],
  [
    '< http://foo.bar >\n',
    '<p>&lt; <a href="http://foo.bar">http://foo.bar</a> &gt;</p>\n',
  ],
  [
    'http://example.com\n',
    '<p><a href="http://example.com">http://example.com</a></p>\n',
  ],
]);

function expectedHtml(example, suite) {
  const autolink = gfmAutolink.get(example.markdown);
  if (autolink) return autolink;
  let want = example.html;
  if (suite === 'gfm') {
    const cm = cmByMarkdown.get(example.markdown);
    if (cm !== undefined) want = cm;
  }
  return applyTagfilter(want);
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  void test('CommonMark', async (t) => {
    for (const example of loadSpec('commonmark')) {
      await t.test(`CommonMark: ${example.section} #${example.example}`, () => {
        assert.equal(
          html(example.markdown),
          expectedHtml(example, 'commonmark')
        );
      });
    }
  });
  void test('GFM', async (t) => {
    for (const example of loadSpec('gfm')) {
      await t.test(`GFM: ${example.section} #${example.example}`, () => {
        assert.equal(html(example.markdown), expectedHtml(example, 'gfm'));
      });
    }
  });
}
