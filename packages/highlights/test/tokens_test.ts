import assert from 'node:assert';
import t from 'node:test';

import { HighlightsHighlighter, LANGS } from '../lib/highlighter';
import type {
  CodeToHtmlOptions,
  CodeToTokensOptions,
  Theme,
  ThemedToken,
} from '../lib/index';
import {
  codeToHtml,
  codeToTokens,
  init,
  LiveTokenizer,
  StreamTokenizer,
} from '../lib/index';
import { rangeToToken, resolveOptionThemes } from '../lib/tokens';
import { transformWat, wat2wasm } from '../scripts/build';
import { cssVariables } from '../themes/index';
import pierreDarkVibrant from '../themes/pierre-dark-vibrant.json' with { type: 'json' };
import pierreDark from '../themes/pierre-dark.json' with { type: 'json' };
import pierreLightVibrant from '../themes/pierre-light-vibrant.json' with { type: 'json' };
import pierreLight from '../themes/pierre-light.json' with { type: 'json' };
import { splitRecordLines, tokenizeRecords } from './_records';
import { makeRand, spansOf, textOf, themeColor } from './_util';

let highlighter: HighlightsHighlighter;
t.before(() => {
  const url = new URL('./byte_records.wat', import.meta.url);
  const { code } = transformWat(
    url,
    `(module
    (import "../src/highlights.wat")
    (func (export "highlightByteRecords")
      (global.set $srcBase (i32.const 65536))
      (global.set $streaming (i32.const 0))
      (global.set $streamDepth (i32.const 0))
      (call $sigReset)
      (call $hlBegin)
      (call $highlightLang (i32.load8_u (i32.const 0)))
      (i32.store (i32.const 10) (i32.sub (global.get $out) (i32.load (i32.const 6))))))`
  );
  const wasmModule = new WebAssembly.Module(wat2wasm(url.pathname, code));
  highlighter = new HighlightsHighlighter(wasmModule);
  init(wasmModule);
});

/** join a line's token contents back together */
const lineText = (tokens: ThemedToken[]) =>
  tokens.map((tk) => tk.content).join('');

void t.test(
  'string input preserves UTF-8 across memory growth and reuse',
  () => {
    const encoder = new TextEncoder();
    const hl = new HighlightsHighlighter(highlighter.wasmModule);
    for (const code of [
      '',
      'x'.repeat(65536 - 96),
      'é'.repeat(65536),
      '日本語🙂'.repeat(65536),
      '\ud800',
      'const text = "日本語🙂";',
    ]) {
      const expected = encoder.encode(code);
      const length = hl.writeInput(code);
      assert.equal(length, expected.length);
      assert.deepEqual(hl.buffer.subarray(65536, 65536 + length), expected);
      assert.ok(hl.buffer.length >= 65536 + length + 96);
    }
  }
);

void t.test('font-only bundled emphasis keeps italic and bold styling', () => {
  const code = '*hello* **world**';
  for (const theme of [pierreDark, pierreLight]) {
    const options = { lang: 'md', theme } as const;
    const tokens = codeToTokens(code, options).tokens[0];
    assert.equal(
      tokens.find((token) => token.content === '*hello*')?.fontStyle,
      1
    );
    assert.equal(
      tokens.find((token) => token.content === '**world**')?.fontStyle,
      2
    );
    const html = new TextDecoder().decode(codeToHtml(code, options));
    assert.match(html, /font-style:italic/);
    assert.match(html, /font-weight:700/);
  }
});

void t.test(
  'font-only syntax inherits a parent color or the foreground',
  () => {
    for (const foreground of ['#abcdef', undefined]) {
      const theme: Theme = {
        name: 'font-only',
        appearance: 'dark',
        style: {
          foreground,
          syntax: {
            keyword: '#123456',
            'keyword.declaration': { font_weight: 700 },
            comment: { font_style: 'italic' },
          },
        },
      };
      const code = 'const a = 1; // hello';
      const options = { lang: 'ts', theme } as const;
      const tokens = codeToTokens(code, options).tokens[0];
      const keyword = tokens.find((token) => token.content.startsWith('const'));
      assert.equal(keyword?.color, '#123456');
      assert.equal(keyword?.fontStyle, 2);
      const comment = tokens.find((token) => token.type === 1);
      assert.equal(comment?.color, foreground);
      assert.equal(comment?.fontStyle, 1);
      const html = new TextDecoder().decode(codeToHtml(code, options));
      assert.match(html, /color:#123456;font-weight:700/);
      assert.ok(
        html.includes(`color:${foreground ?? 'inherit'};font-style:italic`)
      );
    }
  }
);

const langIds = {
  css: LANGS.css,
  html: LANGS.html,
  json: LANGS.json,
  markdown: LANGS.markdown,
  python: LANGS.python,
  rust: LANGS.rust,
  ts: LANGS.ts,
  tsx: LANGS.tsx,
};

/** Run the host byte-record splitter as an independent parity baseline. */
function hostRuns(
  code: string,
  lang: keyof typeof langIds,
  maxLineLength?: number
) {
  const recs = tokenizeRecords(
    highlighter,
    langIds[lang],
    highlighter.writeInput(code)
  );
  return splitRecordLines(
    code,
    recs,
    recs.length >> 1,
    undefined,
    maxLineLength
  );
}

function hostTokens(
  code: string,
  lang: keyof typeof langIds,
  maxLineLength?: number
) {
  const themes = resolveOptionThemes({ lang, theme: pierreDark });
  return hostRuns(code, lang, maxLineLength).map((runs) =>
    runs.map((run) => rangeToToken(code, ...run, themes, '--shiki-'))
  );
}

void t.test('codeToTokens: lines, offsets, and terminators', () => {
  const code = 'const a = 1; // hi\n\nlet s = "x";\r\nendé 🎈\n';
  const { tokens, fg, bg, themeName } = codeToTokens(code, {
    lang: 'ts',
    theme: pierreDark,
  });
  // like shiki: one array per line, empty lines empty, trailing `\n` yields a
  // final empty line, and `\r\n` terminators are excluded from token content
  assert.equal(tokens.length, 5);
  assert.deepEqual(tokens[1], []);
  assert.deepEqual(tokens[4], []);
  assert.equal(lineText(tokens[0]), 'const a = 1; // hi');
  assert.equal(lineText(tokens[2]), 'let s = "x";');
  assert.equal(lineText(tokens[3]), 'endé 🎈');
  // offsets are absolute string indices into the input
  for (const line of tokens) {
    for (const token of line) {
      assert.equal(
        code.slice(token.offset, token.offset + token.content.length),
        token.content
      );
    }
  }
  assert.equal(tokens[0][0].color, themeColor('keyword.declaration'));
  // comments and strings carry the shiki standard token type
  assert.equal(tokens[0].at(-1)?.type, 1);
  assert.equal(tokens[2].find((tk) => tk.content === '"x"')?.type, 2);
  assert.equal(fg, themeColor('foreground'));
  assert.equal(bg, themeColor('background'));
  assert.equal(themeName, pierreDark.name);
});

void t.test('codeToTokens: dual themes emit custom-property styles', () => {
  const { tokens, fg, bg, rootStyle } = codeToTokens('const a = 1', {
    lang: 'ts',
    themes: { dark: pierreDark, light: pierreLight },
    defaultColor: false,
    cssVariablePrefix: '--x-',
  });
  const first = tokens[0][0];
  assert.equal(first.color, undefined);
  assert.ok(first.htmlStyle !== undefined);
  assert.equal(first.htmlStyle['--x-dark'], themeColor('keyword.declaration'));
  assert.equal(
    first.htmlStyle['--x-light'],
    themeColor('keyword.declaration', pierreLight)
  );
  assert.ok(fg !== undefined && bg !== undefined);
  assert.match(fg, /^--x-dark:#[0-9a-f]+;--x-light:#[0-9a-f]+$/);
  assert.match(bg, /^--x-dark-bg:#[0-9a-f]+;--x-light-bg:#[0-9a-f]+$/);
  assert.equal(rootStyle, `${fg};${bg}`);
});

void t.test('codeToTokens: css-variable theme resolves var() colors', () => {
  const { tokens, fg, bg } = codeToTokens('const a = 1', {
    lang: 'ts',
    theme: cssVariables,
  });
  assert.equal(tokens[0][0].color, 'var(--hls-keyword-declaration)');
  assert.equal(fg, 'var(--hls-foreground)');
  assert.equal(bg, 'var(--hls-background)');
});

void t.test(
  'css-variable prefixes agree across tokens, streams, and live edits',
  () => {
    const code = 'const a = 1';
    for (const cssVariablePrefix of [
      '--code-',
      '--other-',
      undefined,
      '--code-',
    ]) {
      const prefix = cssVariablePrefix ?? '--hls-';
      const options = {
        lang: 'ts',
        theme: cssVariables,
        cssVariablePrefix,
      } as const;
      const result = codeToTokens(code, options);
      assert.equal(
        result.tokens[0][0].color,
        `var(${prefix}keyword-declaration)`
      );
      assert.equal(result.fg, `var(${prefix}foreground)`);
      assert.equal(result.bg, `var(${prefix}background)`);
      const stream = new StreamTokenizer(options);
      assert.deepEqual(
        [...stream.pushCode(code), ...stream.end()],
        result.tokens
      );
      const live = new LiveTokenizer({ ...options, code });
      try {
        assert.deepEqual(live.getLineTokens(0).tokens, result.tokens[0]);
        live.applyEdits([
          {
            range: {
              start: { line: 0, character: 10 },
              end: { line: 0, character: 11 },
            },
            newText: '42',
          },
        ]);
        assert.deepEqual(
          live.getLineTokens(0).tokens,
          codeToTokens('const a = 42', options).tokens[0]
        );
      } finally {
        live.dispose();
      }
      for (const defaultColor of [false, 'light', 'light-dark()'] as const) {
        const multiple = codeToTokens(code, {
          lang: 'ts',
          themes: { light: cssVariables, dark: cssVariables },
          cssVariablePrefix,
          defaultColor,
        });
        const color = `var(${prefix}keyword-declaration)`;
        assert.deepEqual(
          multiple.tokens[0][0].htmlStyle,
          defaultColor === 'light-dark()'
            ? { color }
            : defaultColor === 'light'
              ? { color, [`${prefix}dark`]: color }
              : { [`${prefix}dark`]: color, [`${prefix}light`]: color }
        );
        assert.equal(multiple.fg?.includes(`var(${prefix}foreground)`), true);
        assert.equal(multiple.bg?.includes(`var(${prefix}background)`), true);
      }
    }
  }
);

void t.test(
  'vibrant themes retain P3 colors in tokens, streams, and live edits',
  () => {
    const code = 'const value = 1;';
    for (const theme of [pierreDarkVibrant, pierreLightVibrant]) {
      const options = { lang: 'ts', theme } as const;
      const result = codeToTokens(code, options);
      assert.equal(result.fg, theme.style['editor.foreground']);
      assert.equal(result.bg, theme.style['editor.background']);
      assert.equal(result.tokens[0][0].color, theme.style.syntax.keyword.color);
      assert.equal(
        result.tokens[0].find((token) => token.content === '1')?.color,
        theme.style.syntax.number.color
      );
      const stream = new StreamTokenizer(options);
      assert.deepEqual(
        [
          ...stream.pushCode(code.slice(0, 8)),
          ...stream.pushCode(code.slice(8)),
          ...stream.end(),
        ],
        result.tokens
      );
      const live = new LiveTokenizer({ ...options, code });
      try {
        assert.deepEqual(live.getLineTokens(0).tokens, result.tokens[0]);
        const character = code.indexOf('1');
        live.applyEdits([
          {
            range: {
              start: { line: 0, character },
              end: { line: 0, character: character + 1 },
            },
            newText: '42',
          },
        ]);
        assert.deepEqual(
          live.getLineTokens(0).tokens,
          codeToTokens(code.replace('1', '42'), options).tokens[0]
        );
      } finally {
        live.dispose();
      }
    }
    const paired = codeToTokens('const', {
      lang: 'ts',
      themes: { dark: pierreDarkVibrant, light: pierreLightVibrant },
      defaultColor: false,
    });
    assert.deepEqual(paired.tokens[0][0].htmlStyle, {
      '--hls-dark': pierreDarkVibrant.style.syntax.keyword.color,
      '--hls-light': pierreLightVibrant.style.syntax.keyword.color,
    });
  }
);

void t.test(
  'P3 HTML preserves fonts, byte input, and escaped source text',
  () => {
    const foreground = 'color(display-p3 .9 .8 .7)';
    const background = 'color(display-p3 .1 .2 .3 / .5)';
    const keyword = 'color(display-p3 1 .2 .3 / .75)';
    const theme: Theme = {
      name: 'P3 with inherited fonts',
      appearance: 'dark',
      style: {
        foreground,
        background,
        syntax: {
          keyword,
          'keyword.declaration': { font_style: 'italic', font_weight: 600 },
          number: '#abc',
          string: 'color(display-p3 1 0 0);display:none',
        },
      },
    };
    const code = `const label = '<span style="color:var(--hls-number)">日本語 &';\r\n1`;
    const bytes = new TextEncoder().encode(code);
    const options = { lang: 'ts', theme } as const;
    const expected = new TextDecoder().decode(codeToHtml(code, options));
    for (const input of [code, bytes, bytes.buffer]) {
      const html = new TextDecoder().decode(codeToHtml(input, options));
      assert.equal(html, expected);
      assert.equal(textOf(html), code);
      assert.ok(
        html.includes(`background-color:${background};color:${foreground}"`)
      );
      const spans = spansOf(html);
      const declaration = spans.find((span) => span.text.startsWith('const'));
      assert.equal(declaration?.color, keyword);
      assert.equal(declaration?.font, ';font-style:italic;font-weight:600');
      assert.equal(spans.find((span) => span.text === '1')?.color, '#aabbcc');
      assert.ok(
        html.includes(
          '&lt;span style="color:var(--hls-number)"&gt;日本語 &amp;'
        )
      );
      assert.doesNotMatch(html, /display:none/);
    }
  }
);

void t.test('codeToTokens: token records tile every input (fuzz)', () => {
  const langs: (keyof typeof langIds)[] = [
    'tsx',
    'css',
    'html',
    'json',
    'markdown',
    'python',
    'rust',
  ];
  const alphabet = Array.from(
    'abcXYZ09 _-$#@/\\\'"`()[]{}<>=+*&|:;,.!?\n\r\t\0é_日本語🙂𝛼'
  );
  const rand = makeRand(0x2545f491);
  for (const lang of langs) {
    for (let sample = 0; sample < 64; sample++) {
      let input = '';
      for (let n = sample; n-- !== 0; ) {
        input += alphabet[rand() % alphabet.length];
      }
      const { tokens } = codeToTokens(input, { lang, theme: pierreDark });
      const expectedRuns = hostRuns(input, lang);
      const themes = resolveOptionThemes({ lang, theme: pierreDark });
      assert.deepEqual(
        tokens,
        expectedRuns.map((runs) =>
          runs.map((run) => rangeToToken(input, ...run, themes, '--shiki-'))
        ),
        `${lang}: wasm lines differ for ${JSON.stringify(input)}`
      );
      const expectedLines = input.split(/\r?\n/);
      const terminators = input.match(/\r?\n/g) ?? [];
      assert.equal(tokens.length, expectedLines.length);
      let offset = 0;
      for (const [i, line] of tokens.entries()) {
        assert.equal(
          lineText(line),
          expectedLines[i],
          `${lang}: line ${i} of ${JSON.stringify(input)}`
        );
        for (const token of line) {
          assert.equal(token.offset, offset, `${lang}: token offset`);
          offset += token.content.length;
        }
        offset += terminators[i]?.length ?? 0;
      }
      assert.equal(offset, input.length);
    }
  }
});

void t.test('codeToTokens: wasm line records match host splitting', () => {
  const samples: [string, keyof typeof langIds][] = [
    ['', 'ts'],
    ['const a = 1;\n\nlet b = 2;\r\n', 'ts'],
    ['const greeting = "日本語 🎈"; // naïve résumé\n', 'ts'],
    ['.a {\r\n  color: red; /* x\n  y */\r\n}\n', 'css'],
    ['<div title="a\nb">é</div>\n', 'html'],
  ];
  for (const [code, lang] of samples) {
    const options = { lang, theme: pierreDark };
    assert.deepEqual(
      codeToTokens(code, options).tokens,
      hostTokens(code, lang),
      lang
    );
  }
  const capped: CodeToTokensOptions = {
    lang: 'ts',
    theme: pierreDark,
    tokenizeMaxLineLength: 10,
  };
  const code = 'let a = 1\nlet bb = 22\nlet c = 3';
  assert.deepEqual(
    codeToTokens(code, capped).tokens,
    hostTokens(code, 'ts', capped.tokenizeMaxLineLength)
  );
});

void t.test('tokenizeMaxLineLength collapses overlong lines', () => {
  const code = 'let a = 1\nlet bb = 22\nlet c = 3';
  const { tokens } = codeToTokens(code, {
    lang: 'ts',
    theme: pierreDark,
    tokenizeMaxLineLength: 10,
  });
  // short lines keep their runs; the 11-char middle line becomes one
  // unthemed token (shiki's `line.length >= tokenizeMaxLineLength` cutoff)
  assert.ok(tokens[0].length > 1);
  assert.deepEqual(
    tokens[1].map((tk) => [tk.offset, tk.content]),
    [[10, 'let bb = 22']]
  );
  assert.equal(tokens[1][0].color, themeColor('foreground'));
  assert.ok(tokens[2].length > 1);
  // streaming honors the same cap
  const stream = new StreamTokenizer({
    lang: 'ts',
    theme: pierreDark,
    tokenizeMaxLineLength: 10,
  });
  const streamed = [...stream.pushCode(code), ...stream.end()];
  assert.deepEqual(streamed, tokens);
});

void t.test(
  'tokenizeMaxLineLength includes the exact UTF-16 limit and excludes terminators',
  () => {
    for (const line of ['x = 1234', 'x = "🙂"']) {
      for (const newline of ['\n', '\r\n']) {
        const code = line + newline;
        for (const limit of [
          0,
          line.length - 1,
          line.length,
          line.length + 1,
        ]) {
          const options = {
            lang: 'ts',
            theme: pierreDark,
            tokenizeMaxLineLength: limit,
          } as const;
          const tokens = codeToTokens(code, options).tokens;
          assert.deepEqual(tokens[1], []);
          assert.equal(lineText(tokens[0]), line);
          if (limit > 0 && limit <= line.length) {
            assert.equal(tokens[0].length, 1);
            assert.equal(tokens[0][0].offset, 0);
            assert.equal(tokens[0][0].color, themeColor('foreground'));
          } else {
            assert.deepEqual(
              tokens,
              codeToTokens(code, { lang: 'ts', theme: pierreDark }).tokens
            );
            assert.ok(tokens[0].length > 1);
          }
          const stream = new StreamTokenizer(options);
          assert.deepEqual([...stream.pushCode(code), ...stream.end()], tokens);
        }
      }
    }
  }
);

void t.test('theme styles cache by object identity, not name', () => {
  const variantA = {
    name: 'same-name',
    appearance: 'dark',
    style: { syntax: { keyword: { color: '#ff0000' } } },
  };
  const variantB = {
    name: 'same-name',
    appearance: 'dark',
    style: { syntax: { keyword: { color: '#00ff00' } } },
  };
  const colorOf = (theme: Theme) =>
    codeToTokens('const a = 1', { lang: 'ts', theme }).tokens[0][0].color;
  assert.equal(colorOf(variantA), '#ff0000');
  assert.equal(colorOf(variantB), '#00ff00');
  assert.equal(colorOf(variantA), '#ff0000');
  assert.equal(themeColor('keyword', variantA), '#ff0000');
  assert.equal(themeColor('keyword', variantB), '#00ff00');
  assert.equal(themeColor('keyword', variantA), '#ff0000');
});

void t.test('codeToTokens: defaultColor applies one theme inline', () => {
  const themes = { dark: pierreDark, light: pierreLight };
  const keyword = themeColor('keyword.declaration');
  const keywordLight = themeColor('keyword.declaration', pierreLight);
  // like shiki, `light` is the default theme: plain color plus one custom
  // property per other theme, and root metadata carries both
  const light = codeToTokens('const a = 1', { lang: 'ts', themes });
  assert.deepEqual(light.tokens[0][0].htmlStyle, {
    color: keywordLight,
    '--hls-dark': keyword,
  });
  assert.equal(
    light.fg,
    `${themeColor('foreground', pierreLight)};--hls-dark:${themeColor('foreground')}`
  );
  assert.equal(
    light.bg,
    `${themeColor('background', pierreLight)};--hls-dark-bg:${themeColor('background')}`
  );
  assert.equal(light.rootStyle, undefined);
  const dark = codeToTokens('const a = 1', {
    lang: 'ts',
    themes,
    defaultColor: 'dark',
  });
  assert.deepEqual(dark.tokens[0][0].htmlStyle, {
    color: keyword,
    '--hls-light': keywordLight,
  });
  // `light-dark()` merges the pair into one color
  const merged = codeToTokens('const a = 1', {
    lang: 'ts',
    themes,
    defaultColor: 'light-dark()',
  });
  assert.deepEqual(merged.tokens[0][0].htmlStyle, {
    color: `light-dark(${keywordLight}, ${keyword})`,
  });
  assert.equal(
    merged.fg,
    `light-dark(${themeColor('foreground', pierreLight)}, ${themeColor('foreground')})`
  );
  assert.throws(
    () => codeToTokens('x', { lang: 'ts', themes: { dark: pierreDark } }),
    /must contain the defaultColor key `light`/
  );
  assert.throws(
    () =>
      codeToTokens('x', {
        lang: 'ts',
        themes: { dark: pierreDark },
        defaultColor: 'light-dark()',
      }),
    /light-dark/
  );
  const bare = codeToTokens('x', {
    lang: 'ts',
    theme: { name: 'bare', appearance: 'dark', style: {} },
  });
  assert.equal(bare.fg, undefined);
  assert.equal(bare.bg, undefined);
  assert.equal(bare.rootStyle, undefined);
  assert.equal(bare.themeName, 'bare');
});

void t.test(
  'multi-theme tokens reuse styles by token id without mixing options',
  () => {
    const code = 'const a = 1; const b = 2;';
    for (const defaultColor of [false, 'light', 'light-dark()'] as const) {
      for (const prefix of ['--one-', '--two-']) {
        const result = codeToTokens(code, {
          lang: 'ts',
          themes: { light: pierreLight, dark: pierreDark },
          defaultColor,
          cssVariablePrefix: prefix,
        });
        const keywords = result.tokens[0].filter((token) =>
          token.content.startsWith('const')
        );
        assert.equal(keywords.length, 2);
        assert.equal(keywords[0].htmlStyle, keywords[1].htmlStyle);
        if (defaultColor === false) {
          assert.equal(
            keywords[0].htmlStyle?.[`${prefix}dark`],
            themeColor('keyword.declaration', pierreDark)
          );
          assert.equal(
            keywords[0].htmlStyle?.[`${prefix}light`],
            themeColor('keyword.declaration', pierreLight)
          );
        }
      }
    }
  }
);

/** The style attribute of every `<span>` in source order. */
const spanStyles = (html: string) =>
  [...html.matchAll(/<span style="([^"]*)">/g)].map((m) => m[1]);

/** The style attribute of the `<pre>` wrapper. */
const rootStyle = (html: string) =>
  html.match(/^<pre class="highlights" style="([^"]*)"><code>/)?.[1];

void t.test(
  'codeToHtml: themes render every theme into each span from one lex',
  () => {
    const dec = new TextDecoder();
    const code =
      'const label = \'<span style="color:var(--hls-number)">日本語 &\';\r\n1';
    const themes = { light: pierreLight, dark: pierreDark };
    const keyword = (theme: Theme) => themeColor('keyword.declaration', theme);
    const fg = (theme: Theme) => themeColor('foreground', theme);
    const bg = (theme: Theme) => themeColor('background', theme);
    const cases: [CodeToHtmlOptions, string, string][] = [
      [
        { lang: 'ts', themes },
        `background-color:${bg(pierreLight)};--hls-dark-bg:${bg(pierreDark)};color:${fg(pierreLight)};--hls-dark:${fg(pierreDark)}`,
        `color:${keyword(pierreLight)};--hls-dark:${keyword(pierreDark)}`,
      ],
      [
        { lang: 'ts', themes, defaultColor: 'dark' },
        `background-color:${bg(pierreDark)};--hls-light-bg:${bg(pierreLight)};color:${fg(pierreDark)};--hls-light:${fg(pierreLight)}`,
        `color:${keyword(pierreDark)};--hls-light:${keyword(pierreLight)}`,
      ],
      [
        { lang: 'ts', themes, defaultColor: false, cssVariablePrefix: '--x-' },
        `--x-dark:${fg(pierreDark)};--x-light:${fg(pierreLight)};--x-dark-bg:${bg(pierreDark)};--x-light-bg:${bg(pierreLight)}`,
        `--x-dark:${keyword(pierreDark)};--x-light:${keyword(pierreLight)}`,
      ],
      [
        { lang: 'ts', themes, defaultColor: 'light-dark()' },
        `background-color:light-dark(${bg(pierreLight)}, ${bg(pierreDark)});color:light-dark(${fg(pierreLight)}, ${fg(pierreDark)})`,
        `color:light-dark(${keyword(pierreLight)}, ${keyword(pierreDark)})`,
      ],
    ];
    const bytes = new TextEncoder().encode(code);
    for (const [options, root, first] of cases) {
      const html = dec.decode(codeToHtml(code, options));
      assert.equal(rootStyle(html), root);
      assert.equal(spanStyles(html)[0], first);
      assert.equal(textOf(html), code);
      assert.ok(
        html.includes(
          '&lt;span style="color:var(--hls-number)"&gt;日本語 &amp;'
        )
      );
      // the root matches what codeToTokens reports for a custom renderer
      const tokens = codeToTokens(code, options);
      assert.equal(
        root,
        tokens.rootStyle ?? `background-color:${tokens.bg};color:${tokens.fg}`
      );
      for (const input of [bytes, bytes.buffer]) {
        assert.equal(dec.decode(codeToHtml(input, options)), html);
      }
      // a fresh instance agrees, so no state leaks between theme sets
      assert.equal(
        dec.decode(
          new HighlightsHighlighter(highlighter.wasmModule).codeToHtml(
            code,
            options
          )
        ),
        html
      );
    }
    // single-theme output is unchanged by the sets rendered in between
    const single = { lang: 'ts', theme: pierreDark } as const;
    const expected = dec.decode(
      new HighlightsHighlighter(highlighter.wasmModule).codeToHtml(code, single)
    );
    assert.equal(dec.decode(codeToHtml(code, single)), expected);
    codeToHtml(code, cases[0][0]);
    assert.equal(dec.decode(codeToHtml(code, single)), expected);
    // sets merge neighbors only when every theme agrees on their style
    const doc = (name: string, color: string): Theme => ({
      name,
      appearance: 'dark',
      style: { syntax: { comment: '#222222', 'comment.doc': color } },
    });
    const comments = '/** a */ // b';
    assert.deepEqual(
      spanStyles(
        dec.decode(
          codeToHtml(comments, {
            lang: 'ts',
            themes: { light: doc('l', '#222222'), dark: doc('d', '#222222') },
          })
        )
      ),
      ['color:#222222;--hls-dark:#222222']
    );
    assert.deepEqual(
      spanStyles(
        dec.decode(
          codeToHtml(comments, {
            lang: 'ts',
            themes: { light: doc('l', '#222222'), dark: doc('d', '#333333') },
          })
        )
      ),
      ['color:#222222;--hls-dark:#333333', 'color:#222222;--hls-dark:#222222']
    );
  }
);

void t.test(
  'codeToHtml: theme sets keep fonts, missing colors, and light-dark() sides',
  () => {
    const dec = new TextDecoder();
    const light: Theme = {
      name: 'light',
      appearance: 'light',
      style: {
        foreground: '#111111',
        background: '#eeeeee',
        syntax: {
          keyword: '#123456',
          'keyword.declaration': { font_style: 'italic' },
          comment: { font_style: 'italic' },
          number: '#00ff0080',
        },
      },
    };
    const dark: Theme = {
      name: 'dark',
      appearance: 'dark',
      style: {
        foreground: '#ffffff',
        syntax: {
          keyword: '#abcdef',
          'keyword.declaration': { font_style: 'italic', font_weight: 700 },
          comment: { font_weight: 300 },
          number: '#00ff0080',
        },
      },
    };
    const code = 'const a = 1; // c';
    const html = dec.decode(
      codeToHtml(code, { lang: 'ts', themes: { light, dark } })
    );
    // a theme without a background contributes no root property; a token
    // no theme styles gets no span
    assert.equal(
      rootStyle(html),
      'background-color:#eeeeee;color:#111111;--hls-dark:#ffffff'
    );
    assert.ok(html.includes('</span>a = <span'));
    assert.deepEqual(spanStyles(html), [
      'color:#123456;font-style:italic;--hls-dark:#abcdef;--hls-dark-font-style:italic;--hls-dark-font-weight:700',
      'color:#00ff0080;--hls-dark:#00ff0080',
      'color:#111111;font-style:italic;--hls-dark:#ffffff;--hls-dark-font-weight:300',
    ]);
    const variables = dec.decode(
      codeToHtml(code, {
        lang: 'ts',
        themes: { light, dark },
        defaultColor: false,
      })
    );
    assert.equal(
      rootStyle(variables),
      '--hls-dark:#ffffff;--hls-light:#111111;--hls-light-bg:#eeeeee'
    );
    assert.equal(
      spanStyles(variables)[0],
      '--hls-dark:#abcdef;--hls-dark-font-style:italic;--hls-dark-font-weight:700;--hls-light:#123456;--hls-light-font-style:italic'
    );
    // light-dark(): shared colors and fonts stay plain, the rest split per
    // side, and a side without a background or color falls back to a keyword
    const merged = dec.decode(
      codeToHtml(code, {
        lang: 'ts',
        themes: { light, dark },
        defaultColor: 'light-dark()',
      })
    );
    assert.equal(
      rootStyle(merged),
      'background-color:light-dark(#eeeeee, transparent);color:light-dark(#111111, #ffffff)'
    );
    assert.deepEqual(spanStyles(merged), [
      'color:light-dark(#123456, #abcdef);font-style:italic;--hls-dark-font-weight:700',
      'color:#00ff0080',
      'color:light-dark(#111111, #ffffff);--hls-light-font-style:italic;--hls-dark-font-weight:300',
    ]);
    const bare: Theme = {
      name: 'bare',
      appearance: 'dark',
      style: { syntax: { keyword: '#abcdef' } },
    };
    const partial = dec.decode(
      codeToHtml(code, {
        lang: 'ts',
        themes: { light, dark: bare },
        defaultColor: 'light-dark()',
      })
    );
    assert.equal(
      rootStyle(partial),
      'background-color:light-dark(#eeeeee, transparent);color:light-dark(#111111, currentcolor)'
    );
    assert.deepEqual(spanStyles(partial), [
      'color:light-dark(#123456, #abcdef);--hls-light-font-style:italic',
      'color:light-dark(#00ff0080, currentcolor)',
      'color:light-dark(#111111, currentcolor);--hls-light-font-style:italic',
    ]);
    // unthemed sets produce the bare wrapper
    const empty: Theme = { name: 'empty', appearance: 'dark', style: {} };
    for (const defaultColor of ['light', 'light-dark()'] as const) {
      assert.equal(
        dec.decode(
          codeToHtml('const', {
            lang: 'ts',
            themes: { light: empty, dark: empty },
            defaultColor,
          })
        ),
        '<pre class="highlights" style=""><code>const</code></pre>'
      );
    }
  }
);

void t.test(
  'codeToHtml: theme sets escape host names and grow output for long ones',
  () => {
    const dec = new TextDecoder();
    const escaped = dec.decode(
      codeToHtml('const', {
        lang: 'ts',
        themes: { light: pierreLight, 'd<a>"rk&': pierreDark },
        cssVariablePrefix: '--"<>&-',
      })
    );
    const name = '--&quot;&lt;&gt;&amp;-d&lt;a&gt;&quot;rk&amp;';
    assert.ok(escaped.includes(`;${name}-bg:`));
    assert.ok(
      escaped.includes(`;${name}:${themeColor('keyword.declaration')}"`)
    );
    assert.doesNotMatch(escaped, /--"/);
    const cssVariablePrefix = `--${'x'.repeat(100000)}-`;
    const long = dec.decode(
      codeToHtml(`"${'&'.repeat(1000)}"`, {
        lang: 'json',
        themes: { light: pierreLight, dark: pierreDark },
        cssVariablePrefix,
      })
    );
    assert.ok(
      long.includes(`;${cssVariablePrefix}dark:${themeColor('string')}"`)
    );
    assert.ok(long.endsWith(`"${'&amp;'.repeat(1000)}"</span></code></pre>`));
    const big = 'const a = 1;\n'.repeat(20000);
    assert.equal(
      textOf(
        dec.decode(
          codeToHtml(big, {
            lang: 'ts',
            themes: { light: pierreLight, dark: pierreDark },
          })
        )
      ),
      big
    );
  }
);

void t.test(
  'codeToHtml: sets with Display P3 or CSS-variable members render through tag replacement',
  () => {
    const dec = new TextDecoder();
    const html = dec.decode(
      codeToHtml('const', {
        lang: 'ts',
        themes: { light: pierreLightVibrant, dark: cssVariables },
        cssVariablePrefix: '--x-',
      })
    );
    assert.equal(
      rootStyle(html),
      `background-color:${pierreLightVibrant.style['editor.background']};--x-dark-bg:var(--x-background);color:${pierreLightVibrant.style['editor.foreground']};--x-dark:var(--x-foreground)`
    );
    assert.deepEqual(spanStyles(html), [
      `color:${pierreLightVibrant.style.syntax.keyword.color};--x-dark:var(--x-keyword-declaration)`,
    ]);
    assert.equal(textOf(html), 'const');
  }
);

void t.test(
  'codeToHtml: theme set options are validated like codeToTokens',
  () => {
    assert.throws(
      () => codeToHtml('x', { lang: 'ts', themes: { dark: pierreDark } }),
      /must contain the defaultColor key `light`/
    );
    assert.throws(
      () => codeToHtml('x', { lang: 'ts', themes: {} }),
      /themes must not be empty/
    );
    assert.throws(
      () =>
        codeToHtml('x', {
          lang: 'ts',
          themes: { dark: pierreDark },
          defaultColor: 'light-dark()',
        }),
      /light-dark/
    );
    assert.throws(
      () =>
        codeToHtml('x', {
          lang: 'ts',
          themes: { light: 'github-light' },
        } as unknown as CodeToHtmlOptions),
      { name: 'TypeError', message: /^invalid theme: .*"github-light"/ }
    );
  }
);

void t.test('light-dark(): missing colors use valid CSS fallbacks', () => {
  const dark: Theme = { name: 'empty', appearance: 'dark', style: {} };
  for (const color of ['#123456', 'color(display-p3 0.1 0.2 0.3)']) {
    const light: Theme = {
      name: 'partial',
      appearance: 'light',
      style: {
        foreground: '#111111',
        background: '#eeeeee',
        syntax: { keyword: color },
      },
    };
    const options = {
      lang: 'ts',
      themes: { light, dark },
      defaultColor: 'light-dark()',
    } as const;
    const result = codeToTokens('const x', options);
    assert.equal(result.fg, 'light-dark(#111111, currentcolor)');
    assert.equal(result.bg, 'light-dark(#eeeeee, transparent)');
    assert.equal(
      result.tokens[0][0].htmlStyle?.color,
      `light-dark(${color}, currentcolor)`
    );
    const html = new TextDecoder().decode(codeToHtml('const x', options));
    assert.equal(
      rootStyle(html),
      `background-color:${result.bg};color:${result.fg}`
    );
    assert.equal(
      spanStyles(html)[0],
      `color:light-dark(${color}, currentcolor)`
    );
    assert.doesNotMatch(html, /inherit/);
  }
});

void t.test(
  'multi-theme caches release discarded partners of a fixed theme',
  async () => {
    const light = { ...pierreLight };
    let first: WeakRef<Record<string, string>> | undefined;
    for (let i = 0; i < 256; i++) {
      const token = codeToTokens('const', {
        lang: 'ts',
        themes: { light, dark: { ...pierreDark } },
      }).tokens[0][0];
      assert.ok(token.htmlStyle !== undefined);
      if (i === 0) first = new WeakRef(token.htmlStyle);
    }
    for (let i = 0; i < 3; i++) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      Bun.gc(true);
    }
    assert.ok(first !== undefined);
    assert.equal(first.deref(), undefined);
    // The fixed theme remains in use, so collecting it cannot explain eviction.
    assert.equal(
      codeToTokens('const', { lang: 'ts', theme: light }).themeName,
      light.name
    );
  }
);

void t.test(
  'multi-theme styles are shared across calls that name the same set',
  () => {
    const options = {
      lang: 'ts',
      themes: { light: pierreLight, dark: pierreDark },
    } as const;
    assert.equal(
      resolveOptionThemes(options),
      resolveOptionThemes({ ...options, themes: { ...options.themes } })
    );
    assert.notEqual(
      resolveOptionThemes(options),
      resolveOptionThemes({ ...options, defaultColor: 'dark' })
    );
    // prefixes share the list: styles are keyed by prefix downstream
    assert.equal(
      resolveOptionThemes(options),
      resolveOptionThemes({ ...options, cssVariablePrefix: '--x-' })
    );
    assert.equal(
      codeToTokens('const', options).tokens[0][0].htmlStyle,
      codeToTokens('let', { ...options }).tokens[0][0].htmlStyle
    );
  }
);

void t.test(
  'codeToTokens preserves BOM content and offsets for byte input',
  () => {
    const code = '\ufeffconst x = 1;\n\ufefflet y = 2;';
    const options = { lang: 'ts', theme: pierreDark } as const;
    const bytes = new TextEncoder().encode(code);
    const expected = codeToTokens(code, options);
    assert.deepEqual(codeToTokens(bytes, options), expected);
    assert.deepEqual(codeToTokens(bytes.buffer, options), expected);
    assert.equal(lineText(expected.tokens[0]), code.split('\n')[0]);
    assert.equal(expected.tokens[1][0].offset, code.indexOf('\n') + 1);
  }
);

void t.test('a theme id string is rejected with a TypeError naming it', () => {
  // Shiki accepts theme ids; here a string must fail on the `invalid theme`
  // path at every entry point instead of surfacing a raw engine TypeError
  const single = {
    lang: 'ts',
    theme: 'github-dark',
  } as unknown as CodeToTokensOptions;
  const multi = {
    lang: 'ts',
    themes: { light: 'github-light' },
  } as unknown as CodeToTokensOptions;
  const dark = {
    name: 'TypeError',
    message: /^invalid theme: .*the string "github-dark"/,
  };
  const light = {
    name: 'TypeError',
    message: /^invalid theme: .*the string "github-light"/,
  };
  assert.throws(() => codeToTokens('x', single), dark);
  assert.throws(() => codeToHtml('x', single), dark);
  assert.throws(() => new StreamTokenizer(single), dark);
  assert.throws(() => new LiveTokenizer(single), dark);
  assert.throws(() => codeToTokens('x', multi), light);
  assert.throws(() => codeToHtml('x', multi), light);
  assert.throws(() => new StreamTokenizer(multi), light);
  assert.throws(() => new LiveTokenizer(multi), light);
  // a family names its first member
  assert.throws(
    () =>
      codeToTokens('x', {
        lang: 'ts',
        theme: { themes: ['github-dark'] },
      } as unknown as CodeToTokensOptions),
    {
      name: 'TypeError',
      message: /ThemeFamily whose first member is the string "github-dark"/,
    }
  );
  // other non-themes stay on the same error path
  for (const theme of [null, undefined, {}, { name: '' }, 7, ['x']]) {
    assert.throws(
      () =>
        codeToTokens('x', {
          lang: 'ts',
          theme,
        } as unknown as CodeToTokensOptions),
      { name: 'TypeError', message: /^invalid theme: expected a Theme/ }
    );
  }
  // a rejected stream constructor leaves the pooled instance usable
  const stream = new StreamTokenizer({ lang: 'ts', theme: pierreDark });
  assert.deepEqual(
    [...stream.pushCode('let x\n'), ...stream.end()],
    codeToTokens('let x\n', { lang: 'ts', theme: pierreDark }).tokens
  );
});
