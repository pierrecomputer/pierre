import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { init, renderToHtml } from '../dist/core.js';

const dec = new TextDecoder();
const html = (md: string, options?: { math?: boolean }) =>
  dec.decode(renderToHtml(md, options));

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
  init(new WebAssembly.Module(words));
  const expected = html(document);
  assert.match(html('$x$', { math: true }), /<svg/);
  // The entry loads its module into the same core, in place of the default one.
  await import('../dist/no-math.js');
  assert.equal(html(document), expected);
  assert.equal(
    html('a $x^2$\n\n$$\ny\n$$', { math: true }),
    '<p>a <code>x^2</code></p>\n' + '<pre><code>y\n</code></pre>\n'
  );
});
