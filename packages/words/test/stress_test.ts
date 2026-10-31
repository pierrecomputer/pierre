import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createStressFixture,
  STRESS_BASE_CHARACTERS,
  STRESS_SCALES,
} from '../benchmark/fixtures/index.ts';
import { createHtmlSession, renderToHtml } from '../dist/index.js';

const decoder = new TextDecoder();
const full = (source: string) => decoder.decode(renderToHtml(source));

void test('stress fixtures preserve sizes and independent block boundaries at every scale', () => {
  for (const scale of STRESS_SCALES) {
    const source = createStressFixture(scale);
    assert.equal(
      source.length,
      STRESS_BASE_CHARACTERS * scale + 2 * (scale - 1)
    );
    assert.equal(Buffer.byteLength(source), source.length);
    assert.equal(source.split('```typescript\n').length - 1, scale);
    assert.equal(source.split('Done.\n\nParagraph 0:').length - 1, scale - 1);
    assert.ok(source.endsWith('Done.'));
  }
});

void test('100x fixture renders all blocks, owns output, and stays correct on append and reset', () => {
  const source = createStressFixture(100);
  const session = createHtmlSession();
  const initial = session.render(source);
  assert.equal((initial.html.match(/<pre>/g) ?? []).length, 100);
  assert.equal((initial.html.match(/<p>/g) ?? []).length, 10100);
  assert.equal(initial.stable + initial.pending, initial.html);
  assert.equal(initial.html, full(source));
  assert.equal(
    session.render(source + '\n\nAppended **tail**.').html,
    full(source + '\n\nAppended **tail**.')
  );
  renderToHtml('overwrite shared memory'.repeat(100000));
  assert.ok(initial.html.startsWith('<p>Paragraph 0: '));
  assert.ok(initial.html.endsWith('<p>Done.</p>\n'));
  const replacement = session.render('replacement');
  assert.equal(replacement.reset, true);
  assert.equal(replacement.html, full('replacement'));
});
