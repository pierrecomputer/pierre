import assert from 'node:assert/strict';
import test from 'node:test';

import { createHtmlRenderer } from '../dist/html.js';

void test('retained open-fence updates keep the options used to render them', () => {
  const source = 'First\n\n```text\nhello';
  const renderer = createHtmlRenderer({ controls: false });
  const before = renderer.render(source, true, true);
  const expected = createHtmlRenderer({ controls: false }).render(
    source,
    true,
    true
  ).html;

  renderer.configure({ controls: true });
  const after = renderer.render(source, true, true);
  assert.match(after.html, /data-code-action="copy"/);
  assert.equal(before.html, expected);
  assert.equal(before.stable + before.pending, expected);
  assert.equal(before.code?.pending, before.pending);
  renderer.dispose();
});

void test('a failed highlighter disposal clears the live session before retry', () => {
  let disposed = 0;
  const renderer = createHtmlRenderer({
    plugins: {
      code: {
        highlight: () => null,
        createSession: () => ({
          highlight: () => null,
          dispose() {
            disposed++;
            if (disposed === 1) throw new Error('Disposal failed once');
          },
        }),
      },
    },
  });

  renderer.render('```text\nhello', true, true);
  assert.throws(() => renderer.dispose(), /Disposal failed once/);
  renderer.dispose();
  assert.equal(disposed, 1);
  renderer.render('```text\nhello world', true, true);
  renderer.dispose();
  assert.equal(disposed, 2);
});
