import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { bundledThemesInfo } from 'shiki';

import { HighlightsHighlighter } from '../lib/highlighter';
import type { Theme } from '../lib/index';
import { isThemeColor, themeBackground, themeForeground } from '../lib/theme';
import tokenTypes from '../lib/token-types';
import { transformWat, wat2wasm } from '../scripts/build';
import * as themes from '../themes/index';
import { checkInvariants, loadLang, spansOf } from './_util';

const {
  cssVariables,
  pierreDark,
  pierreDarkVibrant,
  pierreLight,
  pierreLightVibrant,
  toCSS,
} = themes;
const json = loadLang('json', '$hlJson');
const tsx = loadLang('tsx', '$hlTsx');
const emitterUrl = new URL('./theme_cache.wat', import.meta.url);
const emitterWat = transformWat(
  emitterUrl,
  `(module
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

void test('multi-theme span cache: openers are reused per set and cleared on a switch', () => {
  const { highlighter, spanCache } = cachedEmitter();
  const dec = new TextDecoder();
  const number = tokenTypes.indexOf('number');
  // a set borrows the single-theme span cache region as its opener arena
  const arena = () => ({
    id: highlighter.dv.getUint32(spanCache, true),
    used: highlighter.dv.getUint32(spanCache + 4, true),
    number: highlighter.dv.getUint16(spanCache + 8 + number * 2, true),
  });
  const single = { lang: 'json', theme: pierreDark } as const;
  const a = {
    lang: 'json',
    themes: { light: pierreLight, dark: pierreDark },
  } as const;
  const b = {
    lang: 'json',
    themes: { light: pierreDark, dark: pierreLight },
  } as const;
  const fresh = (options: typeof a | typeof single) =>
    dec.decode(cachedEmitter().highlighter.codeToHtml('1 "s" 2', options));
  highlighter.codeToHtml('1', a);
  const first = arena();
  assert.ok(first.id > 0);
  assert.equal(first.used, first.number);
  assert.ok(first.number > 0);
  // later calls with the set add openers without touching cached ones, and
  // token calls leave the arena alone
  assert.equal(dec.decode(highlighter.codeToHtml('1 "s" 2', a)), fresh(a));
  const second = arena();
  assert.equal(second.id, first.id);
  assert.equal(second.number, first.number);
  assert.ok(second.used > first.used);
  highlighter.codeToTokens('1 "s" 2', a);
  assert.deepEqual(arena(), second);
  // a different set clears the arena
  assert.equal(dec.decode(highlighter.codeToHtml('1 "s" 2', b)), fresh(b));
  const third = arena();
  assert.notEqual(third.id, first.id);
  assert.ok(third.number > 0);
  assert.equal(dec.decode(highlighter.codeToHtml('1 "s" 2', a)), fresh(a));
  assert.equal(arena().id, first.id);
  // a single theme reclaims the region and renders correctly, after which
  // the set starts over
  assert.equal(
    dec.decode(highlighter.codeToHtml('1 "s" 2', single)),
    fresh(single)
  );
  assert.equal(arena().id, 0);
  assert.ok(highlighter.buffer[spanCache + number * 66] > 0);
  assert.equal(dec.decode(highlighter.codeToHtml('1 "s" 2', a)), fresh(a));
  assert.equal(arena().id, first.id);
  assert.equal(
    dec.decode(highlighter.codeToHtml('1 "s" 2', single)),
    fresh(single)
  );
  // openers the arena cannot hold render directly on every use
  const cssVariablePrefix = `--${'x'.repeat(3000)}-`;
  const long = { ...a, cssVariablePrefix } as const;
  const html = dec.decode(highlighter.codeToHtml('1 "s" 2', long));
  assert.equal(html, fresh(long));
  assert.ok(html.includes(`${cssVariablePrefix}dark:`));
  const overflow = arena();
  assert.equal(overflow.used, 0);
  assert.equal(overflow.number, 0);
});

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
    pierreDarkVibrant,
    pierreLight,
    pierreLightVibrant,
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
  // One alphabetical run, then the rarely emitted members in a second run so
  // every common member keeps a one-byte Wasm constant (see src/token.wat).
  const syntax = tokenTypes.slice(1, -2);
  const descents = syntax.filter((name, i) => i > 0 && name < syntax[i - 1]);
  assert.equal(descents.length, 1, `runs start at: ${descents.join(', ')}`);
  assert.equal(descents[0], 'enum');
  for (const name of ['namespace', 'punctuation.markup', 'selector'])
    assert.ok(syntax.includes(name));
});

void test('bundled themes: matches Shiki and Pierre catalogs and metadata', () => {
  const camel = (name: string) =>
    name.replace(/-([a-z\d])/g, (_, part: string) => part.toUpperCase());
  const pierreThemesUrl = new URL('../../theme/themes/', import.meta.url);
  const pierreThemes = readdirSync(pierreThemesUrl)
    .filter((file) => file.endsWith('.json'))
    .map(
      (file) =>
        JSON.parse(readFileSync(new URL(file, pierreThemesUrl), 'utf8')) as {
          name: string;
          displayName: string;
          type: 'dark' | 'light';
          colors: Record<string, string>;
        }
    );
  const themeInfo = [
    ...bundledThemesInfo,
    ...pierreThemes.map(({ name: id, displayName, type }) => ({
      id,
      displayName,
      type,
    })),
  ];
  const themeNames = themeInfo.map(({ id }) => id).sort();
  assert.deepEqual(
    readdirSync(new URL('../themes/', import.meta.url))
      .filter((file) => file.endsWith('.json'))
      .map((file) => file.slice(0, -5))
      .sort(),
    themeNames
  );
  const bundledThemes = new Map(
    Object.entries(themes).filter(
      ([, value]) =>
        typeof value === 'object' && 'name' in value && value !== cssVariables
    )
  );
  assert.deepEqual(
    [...bundledThemes.keys()].sort(),
    themeNames.map(camel).sort()
  );
  for (const { id, displayName, type } of themeInfo) {
    const theme = bundledThemes.get(camel(id)) as Theme;
    assert.equal(theme.name, displayName, id);
    assert.equal(theme.appearance, type, id);
    assert.ok(Object.keys(theme.style.syntax ?? {}).length > 0, id);
    assert.ok(isThemeColor(themeBackground(theme.style)), id);
    assert.ok(isThemeColor(themeForeground(theme.style)), id);
  }
  for (const { name, colors } of pierreThemes) {
    const theme = bundledThemes.get(camel(name)) as Theme;
    assert.equal(
      themeBackground(theme.style),
      colors['editor.background'],
      name
    );
    assert.equal(
      themeForeground(theme.style),
      colors['editor.foreground'],
      name
    );
  }
});

void test('Pierre themes: vibrant palettes are exported', () => {
  for (const [theme, appearance] of [
    [pierreDarkVibrant, 'dark'],
    [pierreLightVibrant, 'light'],
  ] as const) {
    assert.equal(theme.appearance, appearance);
    assert.equal(
      theme.name,
      `Pierre ${appearance === 'dark' ? 'Dark' : 'Light'} Vibrant`
    );
    const css = toCSS(theme);
    for (const [key, color] of [
      ['background', theme.style['editor.background']],
      ['foreground', theme.style['editor.foreground']],
    ]) {
      assert.match(color ?? '', /^color\(display-p3 /);
      assert.ok(css.includes(`--hls-${key}: ${color};`));
    }
    for (const [scope, settings] of Object.entries(theme.style.syntax ?? {})) {
      const color = typeof settings === 'string' ? settings : settings.color;
      if (color === undefined) continue;
      assert.match(color, /^color\(display-p3 /);
      assert.ok(
        css.includes(`--hls-${scope.replace(/[._]/g, '-')}: ${color};`)
      );
    }
  }
});

void test('toCSS: converts a theme to custom properties', () => {
  const css = toCSS(pierreDark);
  assert.ok(
    css.startsWith(
      '--hls-background: #0a0a0a;--hls-foreground: #fafafa;' +
        '--hls-comment: #737373;--hls-comment-doc: #737373;'
    )
  );
});

void test('toCSS: retains P3 alpha through inherited syntax scopes', () => {
  const color = 'color(display-p3 .2 .4 .6 / .5)';
  const css = toCSS({
    name: 'P3 alpha',
    appearance: 'dark',
    style: {
      foreground: color,
      syntax: { keyword: color, 'keyword.declaration': { font_weight: 700 } },
    },
  });
  assert.ok(css.includes(`--hls-foreground: ${color};`));
  assert.ok(css.includes(`--hls-keyword-declaration: ${color};`));
});

void test('css variables: exported theme selects the dedicated mode', () => {
  assert.equal(cssVariables.cssVariables, true);
  assert.deepEqual(cssVariables.style, {});
});

void test('css variables: renderer emits custom properties', () => {
  assert.equal(
    checkInvariants(tsx.hl, 'const a = 1', { theme: cssVariables }),
    `<pre class="highlights" style="background-color:var(--hls-background);color:var(--hls-foreground);"><code>` +
      `<span style="color:var(--hls-keyword-declaration)">const </span>` +
      `<span style="color:var(--hls-variable)">a </span>` +
      `<span style="color:var(--hls-operator)">= </span>` +
      `<span style="color:var(--hls-number)">1</span></code></pre>`
  );
  assert.match(
    checkInvariants(json.hl, '{"key": 1}', { theme: cssVariables }),
    /color:var\(--hls-property-json-key\)/
  );
});

void test('css variables: switching themes does not leak table state', () => {
  const variable = tsx.hl('const', { theme: cssVariables });
  assert.match(tsx.hl('const', { theme: pierreDark }), /color:#[a-f0-9]+/);
  assert.equal(tsx.hl('const', { theme: cssVariables }), variable);
});

void test('css variables: HTML and declarations use the supplied prefix', () => {
  const { highlighter, spanCache } = cachedEmitter();
  const code = '1 "<span style=\\"color:var(--hls-number)\\">日本語 &"';
  const dec = new TextDecoder();
  const defaults = dec.decode(
    highlighter.codeToHtml(code, { lang: 'json', theme: cssVariables })
  );
  const cached = highlighter.buffer.slice(spanCache, spanCache + 4818);
  for (const cssVariablePrefix of [
    '--code-',
    '--日本語-',
    `--${'x'.repeat(65536)}-`,
    '--other-',
    undefined,
  ]) {
    const prefix = cssVariablePrefix ?? '--hls-';
    const options = {
      lang: 'json',
      theme: cssVariables,
      cssVariablePrefix,
    } as const;
    const bytes = new TextEncoder().encode(code);
    for (const input of [code, bytes, bytes.buffer]) {
      const html = dec.decode(highlighter.codeToHtml(input, options));
      assert.equal(
        html,
        defaults.replace(/<(?:pre|span)[^>]*>/g, (tag) =>
          tag.replaceAll('--hls-', prefix)
        )
      );
      assert.deepEqual(
        highlighter.buffer.slice(spanCache, spanCache + 4818),
        cached
      );
    }
    const css = toCSS(pierreDark, { cssVariablePrefix });
    assert.equal(css, toCSS(pierreDark).replaceAll('--hls-', prefix));
  }
});

void test('css variables: long prefixes and large tokens grow output safely', () => {
  const { highlighter } = cachedEmitter();
  const cssVariablePrefix = `--${'x'.repeat(100000)}-`;
  const code = `"${'&'.repeat(100000)}"`;
  const html = new TextDecoder().decode(
    highlighter.codeToHtml(code, {
      lang: 'json',
      theme: cssVariables,
      cssVariablePrefix,
    })
  );
  assert.ok(html.includes(`color:var(${cssVariablePrefix}string)`));
  assert.ok(html.endsWith(`"${'&amp;'.repeat(100000)}"</span></code></pre>`));
});

void test('css variables: prefixes stay inside the HTML style attribute', () => {
  const { highlighter } = cachedEmitter();
  const html = new TextDecoder().decode(
    highlighter.codeToHtml('1', {
      lang: 'json',
      theme: cssVariables,
      cssVariablePrefix: '--"<>&-',
    })
  );
  assert.ok(html.includes('var(--&quot;&lt;&gt;&amp;-number)'));
  assert.doesNotMatch(html, /var\(--"/);
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
  assert.match(html, /color:var\(--hls-keyword-declaration\)/);
  assert.doesNotMatch(html, /#000000|font-style|font-weight/);
});

void test('short hex colors match their expanded RGB and RGBA forms', () => {
  const palette = (
    foreground: string,
    background: string,
    number: string
  ): Theme => ({
    name: 'short hex',
    appearance: 'dark',
    style: {
      'editor.foreground': foreground,
      'editor.background': background,
      syntax: { number },
    },
  });
  const short = palette('#FFF', '#1234', '#F008');
  const long = palette('#FFFFFF', '#11223344', '#FF000088');
  const code = '1 true';
  assert.equal(json.hl(code, { theme: short }), json.hl(code, { theme: long }));
  assert.match(json.hl(code, { theme: short }), /color:#ff000088/);
  assert.match(
    json.hl(code, { theme: short }),
    /background-color:#11223344;color:#ffffff/
  );
});

void test('toCSS resolves every token scope through its parents and foreground', () => {
  for (const theme of [
    pierreDark,
    themes.vitesseDark,
    {
      name: 'inherited',
      appearance: 'dark',
      style: {
        foreground: '#fff',
        syntax: {
          keyword: '#f00',
          'keyword.declaration': { font_weight: 700 },
          'keyword.control': '#0f0',
        },
      },
    },
  ]) {
    const css = toCSS(theme);
    for (const name of tokenTypes.slice(1, -2)) {
      assert.ok(
        css.includes(`--hls-${name.replace(/[._]/g, '-')}: `),
        `${theme.name}: ${name}`
      );
    }
    if (theme.name === 'inherited') {
      assert.ok(css.includes('--hls-keyword-declaration: #f00;'));
      assert.ok(css.includes('--hls-keyword-control: #0f0;'));
      assert.ok(css.includes('--hls-variable: #fff;'));
    }
  }
});

void test('toCSS: rejects colors that can escape the declaration', () => {
  const css = toCSS({
    name: 'hostile',
    appearance: 'dark',
    style: {
      'editor.foreground': 'red;} body{display:none} :root{--x',
      'editor.background': 'url("x")',
      syntax: {
        keyword: '#f00;}',
        string: ' #0f0 ',
        comment: { color: 'var(--evil)', font_style: 'italic' },
        number: 'color(display-p3 1 0 0);display:none',
        'bad;name': '#fff',
      },
    },
  });
  // every declaration is `--hls-<ident>: <hex|inherit>;` and nothing else, so
  // no theme value can close the declaration or the rule it is written into
  assert.match(css, /^(?:--hls-[a-z0-9-]+: (?:#[0-9a-f]{3,8}|inherit);)+$/i);
  assert.doesNotMatch(css, /--hls-foreground|--hls-background|bad/);
  assert.ok(css.includes('--hls-keyword: inherit;'));
  assert.ok(css.includes('--hls-string: #0f0;'));
  assert.ok(css.includes('--hls-comment: inherit;'));
  assert.ok(css.includes('--hls-number: inherit;'));
  // scopes without their own color would inherit the rejected foreground
  assert.ok(css.includes('--hls-variable: inherit;'));
});

void test('theme helpers: color validation and fallback chains', () => {
  for (const ok of [
    '#fff',
    '#FFF8',
    '#a1b2c3',
    '#A1B2C3D4',
    ' #fff ',
    'color(display-p3 1 0.5 0)',
    ' color(display-p3 .1 .2 .3 / .5) ',
  ]) {
    assert.ok(isThemeColor(ok), ok);
  }
  for (const bad of [
    'fff',
    '#ff',
    '#fffff',
    '#ggg',
    'red',
    '#fff;',
    'color(display-p3 1 0)',
    'color(display-p3 1 0 0 /)',
    'color(display-p3 1 0 0);display:none',
    'color(display-p3 1 0 0)" onmouseover="alert(1)',
    'color(display-p3 var(--red) 0 0)',
    12,
    null,
  ]) {
    assert.equal(isThemeColor(bad), false, String(bad));
  }
  assert.equal(
    themeForeground({
      'editor.foreground': '#1',
      text: '#2',
      foreground: '#3',
    }),
    '#1'
  );
  assert.equal(themeForeground({ text: '#2', foreground: '#3' }), '#2');
  assert.equal(themeForeground({ foreground: '#3' }), '#3');
  assert.equal(themeForeground({}), undefined);
  assert.equal(
    themeBackground({ 'editor.background': '#4', background: '#5' }),
    '#4'
  );
  assert.equal(themeBackground({ background: '#5' }), '#5');
  assert.equal(themeBackground({}), undefined);
});
