import assert from 'node:assert';
import t from 'node:test';

import {
  checkInvariants,
  colorOf,
  loadLang,
  type TestLang,
  themeColor,
} from './util';

let svelte: TestLang;
t.before(() => (svelte = loadLang('svelte', '$hlSvelte')));

const TAG = themeColor('tag');
const ATTR = themeColor('attribute');
const VARIABLE = themeColor('variable');
const KEYWORD = themeColor('keyword');
const PROPERTY = themeColor('property');

void t.test('svelte: expressions, blocks, and element directives', () => {
  const src =
    '{#if ready}<button on:click={save}>{label}</button>{:else}{@html fallback}{/if}';
  const out = checkInvariants(svelte.hl, src);
  assert.equal(colorOf(out, 'ready'), VARIABLE);
  assert.equal(colorOf(out, 'button'), TAG);
  assert.equal(colorOf(out, 'on:click'), ATTR);
  assert.equal(colorOf(out, 'save'), VARIABLE);
  assert.equal(colorOf(out, 'fallback'), VARIABLE);
});

void t.test('svelte: script and style bodies stay embedded', () => {
  const out = checkInvariants(
    svelte.hl,
    '<script>let ready = true;</script><style>.x { color: red }</style>{afterReady}'
  );
  assert.equal(colorOf(out, 'let'), KEYWORD);
  assert.equal(colorOf(out, 'color'), PROPERTY);
  assert.equal(colorOf(out, 'afterReady'), VARIABLE);
});

void t.test(
  'svelte: comments are opaque; malformed and split ranges are bounded',
  () => {
    checkInvariants(svelte.hl, '<!-- {notAnExpression} --><p>{value}</p>');
    for (const src of [
      '{',
      '{"}"',
      '{#if',
      '<button on:click={',
      '<script>{',
      '<style>.x{',
    ]) {
      checkInvariants(svelte.hl, src);
    }
    const split = loadLang('svelte', '$hlSvelte', 16);
    checkInvariants(split.hl, '{#if ok}<p>{value}</p>{/if}');
  }
);
