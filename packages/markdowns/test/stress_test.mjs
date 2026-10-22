import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createStressFixture,
  STRESS_BASE_CHARACTERS,
  STRESS_SCALES,
} from '../benchmark/fixtures.mjs';
import {
  createMarkdownSession,
  renderToElements,
  renderToHtml,
} from '../dist/node.mjs';

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
  const session = createMarkdownSession();
  const initial = session.render(source);
  assert.equal(
    initial.filter((node) => node.type === 'element' && node.tagName === 'pre')
      .length,
    100
  );
  assert.equal(
    initial.filter((node) => node.type === 'element' && node.tagName === 'p')
      .length,
    10100
  );
  assert.deepEqual(
    session.render(source + '\n\nAppended **tail**.'),
    renderToElements(source + '\n\nAppended **tail**.')
  );
  renderToHtml('overwrite shared memory'.repeat(100000));
  assert.equal(initial[0].children[0].value, 'Paragraph 0: ');
  assert.equal(initial.at(-1).children[0].value, 'Done.');
  assert.deepEqual(
    session.render('replacement'),
    renderToElements('replacement')
  );
});
