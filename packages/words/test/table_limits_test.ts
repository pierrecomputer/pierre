import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createHtmlSession,
  renderToAnsi,
  renderToHtml,
} from '../dist/index.js';

const decoder = new TextDecoder();
const header = `${Array(512).fill('a').join('|')}\n${Array(512).fill('-').join('|')}\n`;
const atLimit = `${header}${'|\n'.repeat(1024)}`;

void test('sparse tables stop after exceeding the generated-cell budget', () => {
  const before = decoder.decode(renderToHtml(atLimit));
  assert.equal((before.match(/<tr>/g) ?? []).length, 1025);
  assert.ok(before.endsWith('</table>\n'));

  const crossed = `${atLimit}|\n`;
  const output = decoder.decode(renderToHtml(`${crossed}outside\nnext\n`));
  assert.equal((output.match(/<tr>/g) ?? []).length, 1026);
  assert.ok(output.endsWith('</table>\n<p>outside\nnext</p>\n'));
  assert.ok(output.length < 6_000_000);
  assert.ok(
    decoder.decode(renderToAnsi(`${crossed}outside\n`)).endsWith('outside\n')
  );
});

void test('supplied cells and earlier tables do not consume the empty-cell budget', () => {
  const dense = `${Array(512).fill('x').join('|')}\n`.repeat(20);
  const source = `${header}${dense}${'|\n'.repeat(1025)}outside\n`;
  const output = decoder.decode(renderToHtml(source));
  assert.equal((output.match(/<tr>/g) ?? []).length, 1046);
  assert.ok(output.endsWith('</table>\n<p>outside</p>\n'));

  const small = '| a | b |\n| - | - |\n| x |\n';
  const fresh = decoder.decode(renderToHtml(small));
  assert.ok(fresh.includes('<td></td>'));
  assert.ok(
    decoder.decode(renderToHtml(`${source}\n${small}`)).endsWith(fresh)
  );
});

void test('streamed sparse tables preserve the same limit through appends and resets', () => {
  const session = createHtmlSession();
  for (const source of [
    atLimit,
    `${atLimit}|\n`,
    `${atLimit}|\noutside\n`,
    `${atLimit}|\noutside\n\nnext`,
    '| a |\n| - |\n| x |\n',
  ]) {
    assert.equal(
      session.render(source).html,
      decoder.decode(renderToHtml(source))
    );
  }
});

void test('table width traversal and sparse-cell budgets remain independent', () => {
  const prefix = `${'plain '.repeat(100_000)}\n\n`;
  const small = '| a | b |\n| - | - |\n| x |\n';
  const wide = `${atLimit}|\noutside\n`;
  const source = `${prefix}${small}\n${wide}\n${small}`;
  for (const render of [renderToHtml, renderToAnsi]) {
    const smallOutput = decoder.decode(render(small));
    const expected = [prefix, small, wide, small]
      .map((part) => decoder.decode(render(part)))
      .join(render === renderToAnsi ? '\n' : '');
    assert.equal(decoder.decode(render(source)), expected);
    assert.equal(decoder.decode(render(small)), smallOutput);
  }
});
