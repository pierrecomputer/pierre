import assert from 'node:assert';
import t from 'node:test';

import { LANGS } from '../lib/highlighter';
import type {
  CodeToHastOptions,
  CodeToTokensOptions,
  HastElement,
  HastText,
  Theme,
  ThemedToken,
} from '../lib/index';
import { codeToHast, codeToTokens, init, StreamTokenizer } from '../lib/index';
import {
  buildHast,
  lineRecordsToRuns,
  resolveOptionThemes,
  runToToken,
  splitRecordLines,
} from '../lib/tokens';
import { transformWat, wat2wasm } from '../scripts/build';
import { cssVariables } from '../themes/index';
import pierreDark from '../themes/pierre-dark.json' with { type: 'json' };
import pierreLight from '../themes/pierre-light.json' with { type: 'json' };
import { makeRand, themeColor } from './_util';

/** `init` returns the full internal class; parity tests reach its record APIs. */
interface InternalHighlighter {
  tokenizeRecords(langId: number, inputLength: number): Uint32Array;
  tokenizeLineRecords(langId: number, inputLength: number): Uint32Array;
  writeInput(input: string | Uint8Array | ArrayBuffer): number;
}

let highlighter: InternalHighlighter;
t.before(() => {
  const url = new URL('../src/highlights.wat', import.meta.url);
  const { code } = transformWat(url);
  highlighter = init(
    new WebAssembly.Module(wat2wasm(url.pathname, code))
  ) as unknown as InternalHighlighter;
});

/** join a line's token contents back together */
const lineText = (tokens: ThemedToken[]) =>
  tokens.map((tk) => tk.content).join('');

/** Assert-and-return an element node; tests navigate known tree shapes. */
const el = (node: HastElement | HastText | undefined): HastElement => {
  assert.ok(node !== undefined && node.type === 'element');
  return node;
};

/** Assert-and-return a text node's value. */
const textValue = (node: HastElement | HastText | undefined): string => {
  assert.ok(node !== undefined && node.type === 'text');
  return node.value;
};

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

/** Run the previous mode-2 host splitter as a parity baseline. */
function hostRuns(
  code: string,
  lang: keyof typeof langIds,
  maxLineLength?: number
) {
  const recs = highlighter.tokenizeRecords(
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
    runs.map((run) => runToToken(code, run, themes, '--shiki-'))
  );
}

const hostLineStarts = (code: string) => [
  0,
  ...Array.from(code.matchAll(/\n/g), (match) => match.index + 1),
];

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
          runs.map((run) => runToToken(input, run, themes, '--shiki-'))
        ),
        `${lang}: wasm lines differ for ${JSON.stringify(input)}`
      );
      const recs = highlighter.tokenizeLineRecords(
        langIds[lang],
        highlighter.writeInput(input)
      );
      const adapted = lineRecordsToRuns(recs, recs.length >> 1);
      assert.deepEqual(adapted.lineRuns, expectedRuns);
      assert.deepEqual(adapted.lineStarts, hostLineStarts(input));
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

void t.test('codeToHast: shiki-shaped tree', () => {
  const root = codeToHast('const a = 1 // x\n', {
    lang: 'ts',
    theme: pierreDark,
  });
  assert.equal(root.type, 'root');
  const pre = root.children[0];
  assert.equal(pre.tagName, 'pre');
  assert.equal(pre.properties.tabindex, '0');
  assert.match(
    pre.properties.style as string,
    /^background-color:#[0-9a-f]+;color:#/
  );
  const codeEl = el(pre.children[0]);
  assert.equal(codeEl.tagName, 'code');
  // lines are span.line elements joined by newline text nodes
  assert.equal(codeEl.children.length, 3);
  const [line1, sep, line2] = codeEl.children.map(
    (child) => child as HastElement
  );
  assert.equal(line1.properties.class, 'line');
  assert.deepEqual(sep, { type: 'text', value: '\n' });
  assert.deepEqual(line2.children, []);
  const span = el(line1.children[0]);
  assert.equal(span.tagName, 'span');
  assert.equal(
    span.properties.style,
    `color:${themeColor('keyword.declaration')}`
  );
  assert.equal(textValue(span.children[0]), 'const ');
});

void t.test('codeToHast: wasm line records match host splitting', () => {
  const samples: [string, keyof typeof langIds][] = [
    ['', 'ts'],
    ['const a = 1;\n\nlet b = 2;\r\n', 'ts'],
    ['const greeting = "日本語 🎈"; // naïve résumé\n', 'ts'],
    ['.a {\r\n  color: red; /* x\n  y */\r\n}\n', 'css'],
    ['<div title="a\nb">é</div>\n', 'html'],
  ];
  for (const [code, lang] of samples) {
    const options = { lang, theme: pierreDark };
    const themes = resolveOptionThemes(options);
    const lineRuns = hostRuns(code, lang);
    const lineStarts = hostLineStarts(code);
    const common = { codeToHast, codeToTokens, meta: {} };
    assert.deepEqual(
      codeToHast(code, options),
      buildHast(code, lineRuns, lineStarts, themes, options, common),
      lang
    );
  }

  const code = 'let a = 1\nlet bb = 22\nlet c = 3';
  const options: CodeToHastOptions = {
    lang: 'ts',
    theme: pierreDark,
    tokenizeMaxLineLength: 10,
    decorations: [{ start: 2, end: 15, tagName: 'mark' }],
  };
  const themes = resolveOptionThemes(options);
  assert.deepEqual(
    codeToHast(code, options),
    buildHast(
      code,
      hostRuns(code, 'ts', options.tokenizeMaxLineLength),
      hostLineStarts(code),
      themes,
      options,
      { codeToHast, codeToTokens, meta: {} }
    )
  );
});

void t.test('codeToHast: transformer hooks run in shiki order', () => {
  const calls: string[] = [];
  const root = codeToHast('a = 1\nb = 2', {
    lang: 'python',
    theme: pierreDark,
    transformers: [
      {
        preprocess(code) {
          calls.push('preprocess');
          return code.replace('b = 2', 'c = 3');
        },
        tokens(lines) {
          calls.push(`tokens:${lines.length}`);
          return lines;
        },
        span(node, line, col, lineElement, token) {
          calls.push(`span:${line}:${col}:${token.content}`);
          node.properties['data-char'] = String(col);
        },
        line(node, line) {
          calls.push(`line:${line}`);
          delete node.properties.class;
        },
        pre() {
          calls.push('pre');
        },
        root() {
          calls.push('root');
        },
      },
    ],
  });
  assert.equal(calls[0], 'preprocess');
  assert.equal(calls[1], 'tokens:2');
  assert.ok(calls.includes('span:2:0:c '));
  assert.deepEqual(calls.slice(-2), ['pre', 'root']);
  const line1 = el(el(root.children[0].children[0]).children[0]);
  assert.equal(line1.properties.class, undefined);
  assert.equal(el(line1.children[0]).properties['data-char'], '0');
});

void t.test('codeToHast: decorations wrap and split spans', () => {
  const root = codeToHast('const abc = 1', {
    lang: 'ts',
    theme: pierreDark,
    decorations: [
      {
        start: { line: 0, character: 6 },
        end: { line: 0, character: 9 },
        properties: { class: 'highlighted-word' },
      },
    ],
  });
  const line = el(el(root.children[0].children[0]).children[0]);
  const wrapper = line.children.find(
    (child): child is HastElement =>
      child.type === 'element' && child.properties.class === 'highlighted-word'
  );
  assert.ok(wrapper !== undefined, 'decoration wrapper exists');
  const text = wrapper.children
    .map((span) => textValue(el(span).children[0]))
    .join('');
  assert.equal(text, 'abc');
});

void t.test('codeToHast: nested decorations wrap only their own range', () => {
  // the inner wrap splices several spans into one wrapper; the outer range
  // must still resolve its boundaries against the mutated children
  const code = 'const abc = 1';
  const root = codeToHast(code, {
    lang: 'ts',
    theme: pierreDark,
    decorations: [
      { start: 1, end: 12, properties: { class: 'outer' } },
      { start: 2, end: 11, properties: { class: 'inner' } },
    ],
  });
  const textOf = (node: HastElement | HastText): string =>
    node.type === 'text'
      ? node.value
      : node.children.map((child) => textOf(child)).join('');
  const line = el(el(root.children[0].children[0]).children[0]);
  const outer = line.children.find(
    (child): child is HastElement =>
      child.type === 'element' && child.properties.class === 'outer'
  );
  assert.ok(outer !== undefined, 'outer wrapper exists');
  assert.equal(textOf(outer), code.slice(1, 12));
  const inner = outer.children.find(
    (child): child is HastElement =>
      child.type === 'element' && child.properties.class === 'inner'
  );
  assert.ok(inner !== undefined, 'inner wrapper nests inside the outer one');
  assert.equal(textOf(inner), code.slice(2, 11));
  assert.equal(textOf(line), code);
});

void t.test('codeToHast: transformer context and token htmlAttrs', () => {
  const seen: Record<string, unknown> = {};
  const root = codeToHast('let a = 1\nlet b = 2', {
    lang: 'ts',
    theme: pierreDark,
    meta: { 'data-source': 'test', _hidden: 'x' },
    transformers: [
      {
        tokens(lines) {
          // shiki's transformerStyleToClass pattern: move styling to a class
          for (const token of lines[0]) {
            token.htmlAttrs = { class: 'tok' };
          }
        },
        pre(node) {
          this.addClassToHast(node, 'from-context');
          seen.meta = this.meta['data-source'];
          seen.structure = this.structure;
          seen.lineCount = this.lines.length;
          seen.codeTag = this.code.tagName;
          seen.reTokens = this.codeToTokens('a', {
            lang: 'ts',
            theme: pierreDark,
          }).tokens.length;
        },
      },
    ],
  });
  const pre = root.children[0];
  const preClass = pre.properties.class;
  assert.ok(Array.isArray(preClass));
  assert.equal(preClass.includes('from-context'), true);
  assert.equal(pre.properties['data-source'], 'test');
  assert.equal(pre.properties._hidden, undefined);
  assert.deepEqual(seen, {
    meta: 'test',
    structure: 'classic',
    lineCount: 2,
    codeTag: 'code',
    reTokens: 1,
  });
  const span = el(el(el(pre.children[0]).children[0]).children[0]);
  assert.equal(span.properties.class, 'tok');
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
