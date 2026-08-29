import assert from 'node:assert';
import t from 'node:test';

import { checkInvariants, colorOf, loadLang, themeColor } from './util.mjs';

let astro;
t.before(() => (astro = loadLang('astro', '$hlAstro')));

const TAG = themeColor('tag');
const ATTR = themeColor('attribute');
const VARIABLE = themeColor('variable');
const KEYWORD = themeColor('keyword');
const TYPE = themeColor('type.builtin');
const CSS_PROPERTY = themeColor('property');

void t.test('astro: front matter, HTML, and template expressions', () => {
  const src =
    '---\nconst title: string = "Home";\n---\n<main class="page"><h1>{pageTitle}</h1></main>';
  const out = checkInvariants(astro.hl, src);
  assert.equal(colorOf(out, 'const'), KEYWORD);
  assert.equal(colorOf(out, 'string'), TYPE);
  assert.equal(colorOf(out, 'main'), TAG);
  assert.equal(colorOf(out, 'class'), ATTR);
  assert.equal(colorOf(out, 'pageTitle'), VARIABLE);
});

void t.test('astro: script and style bodies remain embedded languages', () => {
  const src =
    '<script>const value = 1;</script><style>.box { color: red; }</style>{afterValue}';
  const out = checkInvariants(astro.hl, src);
  assert.equal(colorOf(out, 'const'), KEYWORD);
  assert.equal(colorOf(out, 'color'), CSS_PROPERTY);
  assert.equal(colorOf(out, 'afterValue'), VARIABLE);
});

void t.test('astro: malformed and split ranges remain bounded', () => {
  for (const src of [
    '---',
    '---\na: 1',
    '{',
    '{"}"',
    '<script>{',
    '<style>.x{',
    '<div a={x>',
  ]) {
    checkInvariants(astro.hl, src);
  }
  const split = loadLang('astro', '$hlAstro', 21);
  checkInvariants(split.hl, '---\nconst a = 1;\n---\n<div>{value}</div>');
});
