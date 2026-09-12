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
import pierreDark from '../themes/pierre-dark.json' with { type: 'json' };
import pierreLight from '../themes/pierre-light.json' with { type: 'json' };
import { splitRecordLines, tokenizeRecords } from './_records';
import { makeRand, themeColor } from './_util';

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
  assert.throws(
    () => codeToHtml('x', single as unknown as CodeToHtmlOptions),
    dark
  );
  assert.throws(() => new StreamTokenizer(single), dark);
  assert.throws(() => new LiveTokenizer(single), dark);
  assert.throws(() => codeToTokens('x', multi), light);
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
