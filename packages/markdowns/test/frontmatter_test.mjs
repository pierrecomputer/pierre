import assert from 'node:assert';
import test from 'node:test';

import { renderToHtml } from '../dist/node.mjs';

const dec = new TextDecoder();
const meta = (yaml) =>
  renderToHtml(`---\n${yaml}\n---\nbody\n`, { frontmatter: true })[0];

void test('scalars are typed the way YAML says', () => {
  assert.deepEqual(meta('a: hello'), { a: 'hello' });
  assert.deepEqual(meta('a: 42\nb: -1.5\nc: 2e3'), { a: 42, b: -1.5, c: 2e3 });
  assert.deepEqual(meta('a: true\nb: False\nc: null\nd: ~\ne:'), {
    a: true,
    b: false,
    c: null,
    d: null,
    e: null,
  });
  assert.deepEqual(meta('a: "1"\nb: \'2\''), { a: '1', b: '2' });
  assert.deepEqual(
    meta('a: 2024-01-02'),
    { a: '2024-01-02' },
    'a date stays a string'
  );
});

void test('mappings, sequences and comments', () => {
  assert.deepEqual(meta('a:\n  b: 1\n  c: 2'), { a: { b: 1, c: 2 } });
  assert.deepEqual(meta('a:\n  - 1\n  - 2'), { a: [1, 2] });
  assert.deepEqual(meta('- 1\n- 2'), [1, 2]);
  assert.deepEqual(meta('a:\n  - n: x\n    v: 1\n  - n: y'), {
    a: [{ n: 'x', v: 1 }, { n: 'y' }],
  });
  assert.deepEqual(meta('# lead\na: 1 # trailing\n# tail'), { a: 1 });
  assert.deepEqual(meta('a: "has # hash"'), { a: 'has # hash' });
});

void test('flow collections and block scalars', () => {
  assert.deepEqual(meta('a: [1, 2, x]'), { a: [1, 2, 'x'] });
  assert.deepEqual(meta('a: {b: 1, c: two}'), { a: { b: 1, c: 'two' } });
  assert.deepEqual(meta('a: [[1, 2], [3]]'), { a: [[1, 2], [3]] });
  assert.deepEqual(meta('a: |\n  one\n  two'), { a: 'one\ntwo\n' });
  assert.deepEqual(meta('a: |-\n  one\n  two'), { a: 'one\ntwo' });
  assert.deepEqual(meta('a: >\n  one\n  two'), { a: 'one two\n' });
});

void test('the frontmatter is removed from the body', () => {
  const [m, html] = renderToHtml('---\ntitle: T\n---\n# H\n', {
    frontmatter: true,
  });
  assert.deepEqual(m, { title: 'T' });
  assert.equal(dec.decode(html), '<h1>H</h1>\n');
});

void test('without the option the block is ordinary markdown', () => {
  assert.equal(
    dec.decode(renderToHtml('---\ntitle: T\n---\n# H\n')),
    '<hr />\n<h2>title: T</h2>\n<h1>H</h1>\n'
  );
});

void test('a document with no frontmatter reports none', () => {
  const [m, html] = renderToHtml('# H\n', { frontmatter: true });
  assert.equal(m, null);
  assert.equal(dec.decode(html), '<h1>H</h1>\n');
  assert.deepEqual(
    renderToHtml('---\nunterminated\n', { frontmatter: true })[0],
    null
  );
});

void test("only JSON's own number spellings stay numbers", () => {
  assert.deepEqual(meta('a: 0'), { a: 0 });
  assert.deepEqual(meta('a: -1.5e-3'), { a: -0.0015 });
  assert.deepEqual(meta('a: 1e5'), { a: 100000 });
  // YAML numbers JSON.parse would reject are strings, not broken JSON
  for (const [src, value] of [
    ['.5', '.5'],
    ['5.', '5.'],
    ['007', '007'],
    ['+5', '+5'],
    ['0x1f', '0x1f'],
    ['1e', '1e'],
    ['1.2.3', '1.2.3'],
  ]) {
    assert.deepEqual(meta(`a: ${src}`), { a: value }, src);
  }
});

void test('a malformed flow collection still yields parseable metadata', () => {
  assert.deepEqual(meta('a: [x, y,]'), { a: ['x', 'y'] });
  assert.deepEqual(meta('a: {x: 1,}'), { a: { x: 1 } });
  assert.deepEqual(meta('a: [,]'), { a: [] });
  assert.deepEqual(meta('a: {x}'), { a: { x: null } });
  assert.deepEqual(meta('a: ['), { a: [] });
  assert.deepEqual(meta('a: {x: '), { a: { x: null } });
  assert.deepEqual(meta('a: [}'), { a: ['}'] });
  assert.deepEqual(meta('a: [{]'), { a: [{ ']': null }] });
  // `k: v` inside a flow sequence is the one-pair mapping YAML says it is
  assert.deepEqual(meta('a: [x: 1, y]'), { a: [{ x: 1 }, 'y'] });
});

void test('deeply nested frontmatter does not overflow the stack', () => {
  for (const src of [
    '- '.repeat(100000) + 'x',
    'a: ' + '['.repeat(100000),
    'a: ' + '{'.repeat(50000),
  ]) {
    assert.doesNotThrow(() =>
      renderToHtml(`---\n${src}\n---\nbody\n`, { frontmatter: true })
    );
  }
});
