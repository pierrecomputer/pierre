import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

type Entry = typeof import('../dist/index.js');

const dec = new TextDecoder();
const html = (
  entry: Entry,
  md: string | Uint8Array,
  options?: { math?: boolean }
) => dec.decode(entry.renderToHtml(md, options));
const math = 'a $x^2$\n\n$$\ny\n$$';
const mathAsCode =
  '<p>a <code>x^2</code></p>\n' + '<pre><code>y\n</code></pre>\n';

// Each import gets a fresh entry module over the one shared dist/core.js, as
// in an app that loads both entries.
let loads = 0;
const load = (name: string): Promise<Entry> =>
  import(`../dist/${name}.js?${++loads}`);

// Both entries must keep their own Wasm build whichever loads first.
const check = (words: Entry, noMath: Entry) => {
  assert.match(html(words, math, { math: true }), /<svg/);
  assert.equal(html(noMath, math, { math: true }), mathAsCode);
  const update = (entry: Entry) =>
    entry.createHtmlSession().render(math, { math: true }).html;
  assert.match(update(words), /<svg/);
  assert.equal(update(noMath), mathAsCode);
};

void test('@pierre/words/no-math renders as @pierre/words, smaller, with math as code', async () => {
  const words = readFileSync(new URL('../dist/words.wasm', import.meta.url));
  const noMath = readFileSync(
    new URL('../dist/words-no-math.wasm', import.meta.url)
  );
  assert.ok(
    noMath.length < words.length * 0.75,
    `${noMath.length} of ${words.length} bytes`
  );

  const document = readFileSync(
    new URL('../README.md', import.meta.url),
    'utf-8'
  );
  const full = await load('index');
  const lite = await load('no-math');
  assert.equal(html(lite, document), html(full, document));
  check(full, lite);
});

void test('the default and no-math entries keep separate state in either load order', async () => {
  const lite = await load('no-math');
  const full = await load('index');
  check(full, lite);
  // A session keeps its entry's module after the other entry loads again.
  const session = full.createHtmlSession();
  session.render('one');
  await load('no-math');
  assert.match(session.render('one $x$', { math: true }).html, /<svg/);
});
