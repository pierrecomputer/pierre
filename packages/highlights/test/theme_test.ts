import assert from 'node:assert/strict';
import test from 'node:test';
import { bundledThemesInfo } from 'shiki';

import { HighlightsHighlighter } from '../lib/highlighter';
import type { Theme } from '../lib/index';
import tokenTypes from '../lib/token-types';
import { transformWat, wat2wasm } from '../scripts/build';
import * as themes from '../themes/index';
import { checkInvariants, loadLang, spansOf } from './util';

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
const emitterUrl = new URL('./theme_cache.wat', import.meta.url);
const emitterWat = transformWat(
  emitterUrl,
  `(module
    (memory (export "memory") 3)
    (import "../src/langs/json.wat")
    (global (export "spanCache") i32 (i32.const $mem.emitterSpanCache))
    (global (export "themeTable") i32 (i32.const $mem.themeTable))
    (global (export "themeCache") i32 (i32.const $mem.emitterThemeCache))
    (func (export "highlight") (call $hlBegin) (call $hlJson) (call $hlEnd)))`
);
const emitterModule = new WebAssembly.Module(
  wat2wasm(emitterUrl.pathname, emitterWat.code)
);

/** Expose cache addresses so tests can check reuse and direct theme writes. */
function cachedEmitter() {
  const highlighter = new HighlightsHighlighter(emitterModule);
  const { spanCache, themeTable, themeCache } = highlighter.instance.exports;
  return {
    highlighter,
    spanCache: Number((spanCache as WebAssembly.Global).value),
    themeTable: Number((themeTable as WebAssembly.Global).value),
    themeCache: Number((themeCache as WebAssembly.Global).value),
  };
}

void test('span cache: HTML and token calls retain previously formatted styles', () => {
  const { highlighter, spanCache, themeCache } = cachedEmitter();
  const options = { lang: 'json', theme: pierreDark } as const;
  const numberSlot = spanCache + tokenTypes.indexOf('number') * 66;
  highlighter.codeToHtml('1', options);
  const number = highlighter.buffer.slice(numberSlot, numberSlot + 66);
  assert.ok(number[0] > 0);
  highlighter.codeToHtml('"s"', options);
  assert.deepEqual(
    highlighter.buffer.slice(numberSlot, numberSlot + 66),
    number
  );
  const spans = highlighter.buffer.slice(spanCache, spanCache + 4818);
  const theme = highlighter.buffer.slice(themeCache, themeCache + 384);
  highlighter.codeToTokens('1 "s"', { lang: 'json', theme: pierreLight });
  assert.deepEqual(
    highlighter.buffer.slice(spanCache, spanCache + 4818),
    spans
  );
  assert.deepEqual(
    highlighter.buffer.slice(themeCache, themeCache + 384),
    theme
  );
});

void test('span cache: theme and output-mode switches match a fresh instance', () => {
  const { highlighter } = cachedEmitter();
  for (const theme of [
    cssVariables,
    pierreDark,
    pierreLight,
    { name: 'unthemed', appearance: 'dark', style: {} },
    cssVariables,
    pierreDark,
  ]) {
    const options = { lang: 'json', theme } as const;
    const expected = cachedEmitter().highlighter.codeToHtml('1 "s" 2', options);
    assert.deepEqual(highlighter.codeToHtml('1 "s" 2', options), expected);
    highlighter.codeToTokens('3', options);
    assert.deepEqual(highlighter.codeToHtml('1 "s" 2', options), expected);
  }
});

void test('span cache: direct theme writes invalidate colors, alpha, and fonts', () => {
  const { highlighter, themeTable, themeCache, spanCache } = cachedEmitter();
  const options = { lang: 'json', theme: pierreDark } as const;
  const number = tokenTypes.indexOf('number');
  const record = themeTable + number * 5;
  const dec = new TextDecoder();
  highlighter.codeToHtml('1', options);
  for (const [bytes, color, font] of [
    [
      [0x12, 0x34, 0x56, 0x78, 0x17],
      '#12345678',
      ';font-style:italic;font-weight:700',
    ],
    [
      [0x12, 0x34, 0x56, 0xff, 0x17],
      '#123456',
      ';font-style:italic;font-weight:700',
    ],
    [[0x12, 0x34, 0x56, 0xff, 0x09], '#123456', ';font-weight:900'],
    [[0x12, 0x34, 0x56, 0xff, 0], '#123456', ''],
  ] as const) {
    const saved = highlighter.buffer.slice(themeCache, themeCache + 384);
    highlighter.buffer.set(bytes, record);
    highlighter.codeToTokens('1', options);
    assert.deepEqual(
      highlighter.buffer.slice(themeCache, themeCache + 384),
      saved
    );
    const html = dec.decode(highlighter.codeToHtml('1', options));
    assert.deepEqual(spansOf(html), [{ text: '1', color, font }]);
  }
  // Changes in the first and last vector pairs must invalidate unused slots too.
  for (const name of ['attribute', 'foreground'] as const) {
    highlighter.codeToHtml('1', options);
    highlighter.buffer[themeTable + tokenTypes.indexOf(name) * 5] ^= 1;
    highlighter.codeToHtml('"s"', options);
    assert.equal(highlighter.buffer[spanCache + number * 66], 0);
  }
});

void test('token types: syntax captures are sorted and complete', () => {
  const syntax = tokenTypes.slice(1, -2);
  assert.deepEqual(syntax, [...syntax].sort());
  for (const name of ['namespace', 'punctuation.markup', 'selector'])
    assert.ok(syntax.includes(name));
});

void test('bundled themes: matches Shiki names and metadata', () => {
  const camel = (name: string) =>
    name.replace(/-([a-z\d])/g, (_, part: string) => part.toUpperCase());
  const shikiThemeNames = bundledThemesInfo.map(({ id }) => id);
  const pierreExports = [
    'pierreDark',
    'pierreDarkProtanopia',
    'pierreDarkSoft',
    'pierreDarkTritanopia',
    'pierreLight',
    'pierreLightProtanopia',
    'pierreLightSoft',
    'pierreLightTritanopia',
  ];
  assert.deepEqual(
    Object.entries(themes)
      .filter(
        ([key, value]) =>
          key !== 'cssVariables' &&
          value != null &&
          typeof value === 'object' &&
          !Array.isArray(value) &&
          'name' in value
      )
      .map(([key]) => key)
      .sort(),
    [...shikiThemeNames.map(camel), ...pierreExports].sort()
  );
  for (const { id, displayName, type } of bundledThemesInfo) {
    const theme = themes[camel(id) as keyof typeof themes] as Theme;
    assert.equal(theme.name, displayName, id);
    assert.equal(theme.appearance, type, id);
    assert.ok(Object.keys(theme.style.syntax ?? {}).length > 0, id);
    assert.match(
      theme.style['editor.background'] ?? theme.style.background ?? '',
      /^#[a-f\d]{6}(?:[a-f\d]{2})?$/i,
      id
    );
    assert.match(
      theme.style['editor.foreground'] ??
        theme.style.text ??
        theme.style.foreground ??
        '',
      /^#[a-f\d]{6}(?:[a-f\d]{2})?$/i,
      id
    );
  }
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
    `<pre class="highlights" style="background-color:var(--cha-background);color:var(--cha-foreground);"><code>` +
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
