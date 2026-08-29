import assert from 'node:assert/strict';
import test from 'node:test';

import tokenTypes from '../lib/token-types.mjs';
import * as themes from '../themes/index.mjs';
import { checkInvariants, loadLang } from './util.mjs';

const {
  cssVariables,
  pierreDark,
  pierreDarkProtanopia,
  pierreDarkSoft,
  pierreDarkTritanopia,
  pierreLight,
  pierreLightProtanopia,
  pierreLightSoft,
  pierreLightTritanopia,
  toCSS,
} = themes;
const json = loadLang('json', '$hlJson');
const tsx = loadLang('tsx', '$hlTsx');

void test('token types: syntax captures are sorted and complete', () => {
  const syntax = tokenTypes.slice(1, -2);
  assert.deepEqual(syntax, [...syntax].sort());
  for (const name of ['namespace', 'punctuation.markup', 'selector'])
    assert.ok(syntax.includes(name));
});

void test('bundled themes: exports every JSON theme', () => {
  assert.equal(Object.keys(themes).length, 71);
  assert.deepEqual(
    [
      pierreLight,
      pierreLightProtanopia,
      pierreLightSoft,
      pierreLightTritanopia,
      pierreDark,
      pierreDarkProtanopia,
      pierreDarkSoft,
      pierreDarkTritanopia,
    ].map(({ name }) => name),
    [
      'Pierre Light',
      'Pierre Light Protanopia & Deuteranopia',
      'Pierre Light Soft',
      'Pierre Light Tritanopia',
      'Pierre Dark',
      'Pierre Dark Protanopia & Deuteranopia',
      'Pierre Dark Soft',
      'Pierre Dark Tritanopia',
    ]
  );
});

void test('toCSS: converts a theme to custom properties', () => {
  const css = toCSS(pierreDark);
  assert.ok(
    css.startsWith(
      '--cha-background: #0a0a0a;--cha-foreground: #fafafa;' +
        '--cha-comment: #737373;--cha-comment-doc: #737373;'
    )
  );
});

void test('css variables: exported theme selects the dedicated mode', () => {
  assert.equal(cssVariables.cssVariables, true);
  assert.deepEqual(cssVariables.style, {});
});

void test('css variables: renderer emits custom properties', () => {
  assert.equal(
    checkInvariants(tsx.hl, 'const a = 1', { theme: cssVariables }),
    `<pre class="chamele" style="background-color:var(--cha-background);color:var(--cha-foreground);"><code>` +
      `<span style="color:var(--cha-keyword-declaration)">const </span>` +
      `<span style="color:var(--cha-variable)">a </span>` +
      `<span style="color:var(--cha-operator)">= </span>` +
      `<span style="color:var(--cha-number)">1</span></code></pre>`
  );
  assert.match(
    checkInvariants(json.hl, '{"key": 1}', { theme: cssVariables }),
    /color:var\(--cha-property-json-key\)/
  );
});

void test('css variables: switching themes does not leak table state', () => {
  const variable = tsx.hl('const', { theme: cssVariables });
  assert.match(tsx.hl('const', { theme: pierreDark }), /color:#[a-f0-9]+/);
  assert.equal(tsx.hl('const', { theme: cssVariables }), variable);
});

void test('css variables: bypasses compilation and ignores theme styles', () => {
  let styleReads = 0;
  const theme = {
    ...cssVariables,
    name: 'CSS variables with ignored styles',
    appearance: 'dark',
    style: new Proxy(
      {
        syntax: {
          'keyword.declaration': {
            color: '#000000',
            font_style: 'italic',
            font_weight: 700,
          },
        },
      },
      {
        get() {
          styleReads++;
          throw new Error('theme style was compiled');
        },
      }
    ),
  };
  const html = checkInvariants(tsx.hl, 'const', { theme });
  assert.equal(styleReads, 0);
  assert.match(html, /color:var\(--cha-keyword-declaration\)/);
  assert.doesNotMatch(html, /#000000|font-style|font-weight/);
});
