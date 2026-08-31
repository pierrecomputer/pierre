import assert from 'node:assert';
import t from 'node:test';

import {
  checkInvariants,
  colorOf,
  loadLang,
  spansOf,
  type TestLang,
  themeColor,
} from './util';

let mdx: TestLang;
t.before(() => (mdx = loadLang('mdx', '$hlMdx')));

const TITLE = themeColor('title');
const COMPONENT = themeColor('tag.component.jsx');
const ATTR = themeColor('attribute.jsx');
const VARIABLE = themeColor('variable');
const FUNCTION = themeColor('function');
const STRING = themeColor('string');

void t.test('mdx: Markdown with JSX components and expressions', () => {
  const src =
    '# Hello {user}\n<Card title="Hi" count={items.length}>{render()}</Card>\n';
  const out = checkInvariants(mdx.hl, src);
  assert.equal(colorOf(out, 'Hello'), TITLE);
  assert.equal(colorOf(out, 'Card'), COMPONENT);
  assert.equal(colorOf(out, 'title'), ATTR);
  assert.equal(colorOf(out, '"Hi"'), STRING);
  assert.equal(colorOf(out, 'user'), VARIABLE);
  assert.equal(colorOf(out, 'render'), FUNCTION);
  assert.ok(
    spansOf(out).filter(
      (span) => span.text.includes('Card') && span.color === COMPONENT
    ).length >= 2
  );
});

void t.test(
  'mdx: nested object braces and braces in strings stay in one expression',
  () => {
    const out = checkInvariants(mdx.hl, '{format({ text: "}" })}\nafter');
    assert.equal(colorOf(out, 'format'), FUNCTION);
    assert.equal(colorOf(out, '"}"'), STRING);
  }
);

void t.test('mdx: malformed JSX and split ranges stay bounded', () => {
  for (const src of [
    '<',
    '<Card',
    '{',
    '{"}"',
    '</Card',
    '# h\n<X a={1>',
    'é {名}',
  ]) {
    checkInvariants(mdx.hl, src);
  }
  const split = loadLang('mdx', '$hlMdx', 10);
  checkInvariants(split.hl, '# hi\n<Card>{value}</Card>\n');
});
