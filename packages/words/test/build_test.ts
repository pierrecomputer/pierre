import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { init, renderToHtml } from '../dist/core.js';

const dec = new TextDecoder();
const html = (md: string, options?: { math?: boolean }) =>
  dec.decode(renderToHtml(md, options));

void test('--no-math builds a smaller module that shows math as code', () => {
  const dir = mkdtempSync(join(tmpdir(), 'words-build-'));
  try {
    const published = readFileSync(
      new URL('../dist/words.wasm', import.meta.url)
    );
    const out = join(dir, 'words.wasm');
    execFileSync(
      process.execPath,
      [
        new URL('../scripts/build.ts', import.meta.url).pathname,
        '--no-math',
        '--out',
        out,
      ],
      { stdio: 'pipe' }
    );
    const noMath = readFileSync(out);
    // --out leaves the published build alone.
    assert.deepEqual(
      readFileSync(new URL('../dist/words.wasm', import.meta.url)),
      published
    );
    assert.ok(
      noMath.length < published.length * 0.75,
      `${noMath.length} of ${published.length} bytes`
    );

    const document = readFileSync(
      new URL('../README.md', import.meta.url),
      'utf-8'
    );
    init(new WebAssembly.Module(published));
    const expected = html(document);
    assert.match(html('$x$', { math: true }), /<svg/);
    init(new WebAssembly.Module(noMath));
    assert.equal(html(document), expected);
    assert.equal(
      html('a $x^2$\n\n$$\ny\n$$', { math: true }),
      '<p>a <code>x^2</code></p>\n' + '<pre><code>y\n</code></pre>\n'
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
