import assert from 'node:assert';
import test from 'node:test';

import { renderToAnsi, renderToHtml } from '../dist/node.mjs';

const dec = new TextDecoder();
const html = (md) => dec.decode(renderToHtml(md));
const ansi = (md, options) => dec.decode(renderToAnsi(md, options));

void test('accepts strings, byte arrays and buffers', () => {
  const expected = '<h1>ü</h1>\n';
  assert.equal(html('# ü'), expected);
  assert.equal(html(new TextEncoder().encode('# ü')), expected);
  assert.equal(html(new TextEncoder().encode('# ü').buffer), expected);
  assert.throws(() => renderToHtml(42), TypeError);
  assert.throws(() => renderToHtml(null), TypeError);
});

void test('returns a view of wasm memory', () => {
  const bytes = renderToHtml('# a');
  assert.ok(bytes instanceof Uint8Array);
  assert.equal(dec.decode(bytes), '<h1>a</h1>\n');
});

void test('results do not depend on what was rendered before', () => {
  const docs = ['# a', '- x\n- y', '> q', '| a |\n| - |\n| 1 |', '*e* `c`', ''];
  const first = docs.map((d) => html(d));
  for (let round = 0; round < 3; round++) {
    renderToHtml('filler '.repeat(5000));
    renderToAnsi('more filler '.repeat(1000));
    docs.forEach((d, i) => assert.equal(html(d), first[i], JSON.stringify(d)));
  }
});

void test('backtick closer memo is render-local', () => {
  for (const n of [64, 31, 8, 2, 1, 17, 63]) {
    const ticks = '`'.repeat(n);
    html(`${ticks}no closer`);
    assert.equal(html(`${ticks}x${ticks}`), '<p><code>x</code></p>\n');
  }
});

void test('multi-megabyte input still renders', () => {
  const big = '# heading\n\nsome *text* with a [link](/u).\n\n'.repeat(20000);
  const out = html(big);
  assert.ok(out.length > big.length, `${out.length} bytes out`);
  assert.equal(out.slice(0, 18), '<h1>heading</h1>\n<');
});

void test('blocks with more than 65535 lines survive', () => {
  const lines = 70000;
  assert.equal(html(Array(lines).fill('a').join('\n')).length, lines * 2 + 7);
  assert.equal(
    html('```\n' + Array(lines).fill('x').join('\n') + '\n```').length,
    lines * 2 + 25
  );
});

void test('a link may not contain another link', () => {
  assert.equal(
    html('[x [y](z) [q]](w)'),
    '<p>[x <a href="z">y</a> [q]](w)</p>\n'
  );
  assert.equal(
    html('[![m](m.jpg)](/u)'),
    '<p><a href="/u"><img src="m.jpg" alt="m" /></a></p>\n',
    'an image inside a link is still a link'
  );
});

void test('malformed frontmatter still yields valid JSON', () => {
  for (const yaml of [
    'a: [',
    'a: [}',
    'a: {',
    'a: [[[',
    'a: ' + '['.repeat(5000),
    '- '.repeat(5000) + 'x',
  ]) {
    const [meta] = renderToHtml(`---\n${yaml}\n---\nbody\n`, {
      frontmatter: true,
    });
    assert.ok(meta !== undefined, yaml.slice(0, 20));
  }
});

void test('UTF-8 survives the round trip', () => {
  assert.equal(html('é 中 🎉'), '<p>é 中 🎉</p>\n');
  assert.equal(html('`é`'), '<p><code>é</code></p>\n');
  assert.equal(html('# 🎉 party'), '<h1>🎉 party</h1>\n');
});

void test('empty and whitespace-only documents', () => {
  assert.equal(html(''), '');
  assert.equal(html('\n\n\n'), '');
  assert.equal(ansi(''), '');
  assert.equal(html('   '), '');
});

void test('carriage returns are accepted as line endings', () => {
  assert.equal(html('a\r\nb'), '<p>a\nb</p>\n');
  assert.equal(html('# a\rb'), '<h1>a</h1>\n<p>b</p>\n');
  assert.equal(
    html('```\r\na\r\nb\r\n```'),
    '<pre><code>a\nb\n</code></pre>\n'
  );
});
