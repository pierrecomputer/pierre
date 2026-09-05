import assert from 'node:assert';
import t from 'node:test';

import {
  assertLineFedParity,
  checkInvariants,
  colorOf,
  distinctColor,
  distinctTheme,
  exactColor,
  loadLang,
  type TestLang,
  themeColor,
  tokenKinds,
} from './util';

let svelte: TestLang;
t.before(() => (svelte = loadLang('svelte', '$hlSvelte')));

/** Highlight under the distinct theme after checking the lexer invariants. */
const hl = (src: string) =>
  checkInvariants(svelte.hl, src, { theme: distinctTheme });

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

void t.test('svelte: if, each, await, and key blocks', () => {
  const html = hl(
    '{#if a}A{:else if b}B{:else}C{/if}\n{#each items as item, i (item.id)}{item}{:else}none{/each}\n{#await promise}wait{:then value}{value}{:catch error}{error.message}{/await}\n{#key k}{/key}'
  );
  for (const marker of [
    '#if',
    ':else if',
    ':else',
    '/if',
    '#each',
    '/each',
    '#await',
    ':then',
    ':catch',
    '/await',
    '#key',
    '/key',
  ]) {
    assert.equal(
      exactColor(html, marker),
      distinctColor('keyword.control'),
      marker
    );
  }
  assert.equal(exactColor(html, 'as'), distinctColor('keyword'));
  for (const name of [
    'a',
    'b',
    'items',
    'item',
    'promise',
    'value',
    'error',
    'k',
  ]) {
    assert.equal(exactColor(html, name), distinctColor('variable'), name);
  }
  assert.equal(exactColor(html, 'id'), distinctColor('property'));
  assert.equal(exactColor(html, 'message'), distinctColor('property'));
});

void t.test('svelte: tag directives and snippets', () => {
  const html = hl(
    '{@html raw} {@const x = 1} {@debug a, b} {#snippet row(item)}{item}{/snippet} {@render row(x)}'
  );
  for (const marker of [
    '@html',
    '@const',
    '@debug',
    '#snippet',
    '/snippet',
    '@render',
  ]) {
    assert.equal(
      exactColor(html, marker),
      distinctColor('keyword.control'),
      marker
    );
  }
  assert.equal(exactColor(html, 'raw'), distinctColor('variable'));
  assert.equal(exactColor(html, 'x'), distinctColor('variable'));
  assert.equal(exactColor(html, '='), distinctColor('operator'));
  assert.equal(exactColor(html, '1'), distinctColor('number'));
  assert.equal(exactColor(html, 'row'), distinctColor('function'));
});

void t.test('svelte: runes and reactive statements inside script', () => {
  const html = hl(
    '<script>\n  let count = $state(0);\n  $: doubled = count * 2;\n  $effect(() => {});\n</script>'
  );
  assert.equal(exactColor(html, 'let'), distinctColor('keyword.declaration'));
  assert.equal(exactColor(html, '$state'), distinctColor('function'));
  assert.equal(exactColor(html, '$effect'), distinctColor('function'));
  assert.equal(exactColor(html, '$'), distinctColor('variable'));
  assert.equal(exactColor(html, 'doubled'), distinctColor('variable'));
  assert.equal(exactColor(html, '2'), distinctColor('number'));
});

void t.test(
  'svelte: element directives, spreads, and shorthand attributes',
  () => {
    assert.deepEqual(
      tokenKinds(
        'svelte',
        '<button on:click|preventDefault={h} {...spread} {shorthand}>x</button>'
      ).slice(0, 14),
      [
        ['<', 'punctuation.bracket.html'],
        ['button', 'tag'],
        ['on:click|preventDefault', 'attribute'],
        ['=', 'punctuation.delimiter.html'],
        ['{', 'punctuation.special'],
        ['h', 'variable'],
        ['}', 'punctuation.special'],
        ['{', 'punctuation.special'],
        ['...', 'operator'],
        ['spread', 'variable'],
        ['}', 'punctuation.special'],
        ['{', 'punctuation.special'],
        ['shorthand', 'variable'],
        ['}', 'punctuation.special'],
      ]
    );
  }
);

void t.test('svelte: special elements, slots, and dotted components', () => {
  const html = hl(
    '<svelte:head><title>x</title></svelte:head>\n<svelte:window on:keydown={k} />\n<slot name="x">fallback</slot>\n<Comp.Sub let:item />'
  );
  for (const tag of [
    'svelte:head',
    'title',
    'svelte:window',
    'slot',
    'Comp.Sub',
  ]) {
    assert.equal(exactColor(html, tag), distinctColor('tag'), tag);
  }
  assert.equal(exactColor(html, 'on:keydown'), distinctColor('attribute'));
  assert.equal(exactColor(html, 'k'), distinctColor('variable'));
  assert.equal(exactColor(html, 'name'), distinctColor('attribute'));
  assert.equal(exactColor(html, '"x"'), distinctColor('string'));
  assert.equal(exactColor(html, 'let:item'), distinctColor('attribute'));
});

void t.test(
  'svelte: braces inside strings and templates do not end an expression',
  () => {
    assert.deepEqual(
      tokenKinds(
        'svelte',
        '{a < b} {"}"} {\'}\'} {`}`} {f({ a: 1 })} {x => <b/>}'
      ),
      [
        ['{', 'punctuation.special'],
        ['a', 'variable'],
        ['<', 'operator'],
        ['b', 'variable'],
        ['}', 'punctuation.special'],
        ['{', 'punctuation.special'],
        ['"}"', 'string'],
        ['}', 'punctuation.special'],
        ['{', 'punctuation.special'],
        ["'}'", 'string'],
        ['}', 'punctuation.special'],
        ['{', 'punctuation.special'],
        ['`}`', 'string'],
        ['}', 'punctuation.special'],
        ['{', 'punctuation.special'],
        ['f', 'function'],
        ['({', 'punctuation.bracket'],
        ['a', 'property'],
        [':', 'punctuation.delimiter'],
        ['1', 'number'],
        ['})', 'punctuation.bracket'],
        ['}', 'punctuation.special'],
        ['{', 'punctuation.special'],
        ['x', 'variable.parameter'],
        ['=>', 'operator'],
        ['<', 'punctuation.bracket.jsx'],
        ['b', 'tag.jsx'],
        ['/>', 'punctuation.bracket.jsx'],
        ['}', 'punctuation.special'],
      ]
    );
  }
);

void t.test(
  'svelte: block openers and expressions spanning lines stream line-fed',
  () => {
    assertLineFedParity(
      'svelte',
      '{#if\n  a &&\n  b\n}\nx\n{/if}\n{#each items as item}\n  <li>{\n    item\n  }</li>\n{/each}\n'
    );
    assertLineFedParity(
      'svelte',
      '<script>\n  const s = `a\nb`;\n</script>\n<div\n  class="x"\n  on:click={f}>\n</div>\n'
    );
  }
);

void t.test(
  'svelte: comments are opaque; malformed and split ranges are bounded',
  () => {
    assert.deepEqual(
      tokenKinds('svelte', '<!-- {notAnExpression} <b> -->')[0],
      ['<!-- {notAnExpression} <b> -->', 'comment']
    );
    for (const src of [
      '{',
      '{"}"',
      '{#if',
      '{#each items as',
      '{:else',
      '{/',
      '{@',
      '<button on:click={',
      '<script>{',
      '<style>.x{',
      '<!--',
    ]) {
      checkInvariants(svelte.hl, src);
    }
    const split = loadLang('svelte', '$hlSvelte', 16);
    checkInvariants(split.hl, '{#if ok}<p>{value}</p>{/if}');
  }
);
