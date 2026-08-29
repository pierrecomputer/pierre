import assert from 'node:assert';
import t from 'node:test';

import {
  codeToHast,
  codeToTokens,
  init,
  LiveTokenizer,
  TokenizeStream,
} from '../lib/index.mjs';
import {
  buildHast,
  lineRecordsToRuns,
  resolveOptionThemes,
  runToToken,
  splitRecordLines,
} from '../lib/tokens.mjs';
import { transformWat, wat2wasm } from '../scripts/build.mjs';
import { cssVariables } from '../themes/index.mjs';
import pierreDark from '../themes/pierre-dark.json' with { type: 'json' };
import pierreLight from '../themes/pierre-light.json' with { type: 'json' };
import { themeColor } from './util.mjs';

let highlighter;
t.before(() => {
  const url = new URL('../src/chamele.wat', import.meta.url);
  const { code } = transformWat(url);
  highlighter = init(new WebAssembly.Module(wat2wasm(url.pathname, code)));
});

/** join a line's token contents back together */
const lineText = (tokens) => tokens.map((tk) => tk.content).join('');

const langIds = {
  css: 6,
  html: 11,
  json: 12,
  markdown: 15,
  python: 18,
  rust: 19,
  ts: 24,
  tsx: 24,
};

/** Run the previous mode-2 host splitter as a parity baseline. */
function hostRuns(code, lang, maxLineLength) {
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

function hostTokens(code, lang, maxLineLength) {
  const themes = resolveOptionThemes({ theme: pierreDark });
  return hostRuns(code, lang, maxLineLength).map((runs) =>
    runs.map((run) => runToToken(code, run, themes, '--shiki-'))
  );
}

const hostLineStarts = (code) => [
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
  assert.equal(tokens[0].at(-1).type, 1);
  assert.equal(tokens[2].find((tk) => tk.content === '"x"').type, 2);
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
  assert.equal(first.htmlStyle['--x-dark'], themeColor('keyword.declaration'));
  assert.equal(
    first.htmlStyle['--x-light'],
    themeColor('keyword.declaration', pierreLight)
  );
  assert.match(fg, /^--x-dark:#[0-9a-f]+;--x-light:#[0-9a-f]+$/);
  assert.match(bg, /^--x-dark-bg:#[0-9a-f]+;--x-light-bg:#[0-9a-f]+$/);
  assert.equal(rootStyle, `${fg};${bg}`);
});

void t.test('codeToTokens: css-variable theme resolves var() colors', () => {
  const { tokens, fg, bg } = codeToTokens('const a = 1', {
    lang: 'ts',
    theme: cssVariables,
  });
  assert.equal(tokens[0][0].color, 'var(--cha-keyword-declaration)');
  assert.equal(fg, 'var(--cha-foreground)');
  assert.equal(bg, 'var(--cha-background)');
});

void t.test('codeToTokens: token records tile every input (fuzz)', () => {
  const langs = ['tsx', 'css', 'html', 'json', 'markdown', 'python', 'rust'];
  const alphabet = [
    ...'abcXYZ09 _-$#@/\\\'"`()[]{}<>=+*&|:;,.!?\n\r\t\0é_日本語',
  ];
  let seed = 0x2545f491;
  for (const lang of langs) {
    for (let sample = 0; sample < 48; sample++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      let input = '';
      for (let n = seed & 63; n-- !== 0; ) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        input += alphabet[seed % alphabet.length];
      }
      const { tokens } = codeToTokens(input, { lang, theme: pierreDark });
      const expectedRuns = hostRuns(input, lang);
      const themes = resolveOptionThemes({ theme: pierreDark });
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
      // rebuild the input from lines: token contents joined by the input's
      // own terminators must reproduce it exactly (the lossless invariant)
      let rebuilt = '';
      let cursor = 0;
      for (const [i, line] of tokens.entries()) {
        rebuilt += lineText(line);
        if (i < tokens.length - 1) {
          const nl = input.indexOf('\n', rebuilt.length);
          assert.notEqual(nl, -1, `${lang}: missing terminator`);
          rebuilt += input.slice(rebuilt.length, nl + 1);
        }
        cursor = rebuilt.length;
      }
      assert.equal(rebuilt, input, `${lang}: ${JSON.stringify(input)}`);
      assert.ok(cursor === input.length);
    }
  }
});

void t.test('codeToTokens: wasm line records match host splitting', () => {
  const samples = [
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
  const capped = {
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
  assert.match(pre.properties.style, /^background-color:#[0-9a-f]+;color:#/);
  const codeEl = pre.children[0];
  assert.equal(codeEl.tagName, 'code');
  // lines are span.line elements joined by newline text nodes
  assert.equal(codeEl.children.length, 3);
  const [line1, sep, line2] = codeEl.children;
  assert.equal(line1.properties.class, 'line');
  assert.deepEqual(sep, { type: 'text', value: '\n' });
  assert.deepEqual(line2.children, []);
  const span = line1.children[0];
  assert.equal(span.tagName, 'span');
  assert.equal(
    span.properties.style,
    `color:${themeColor('keyword.declaration')}`
  );
  assert.equal(span.children[0].value, 'const ');
});

void t.test('codeToHast: wasm line records match host splitting', () => {
  const samples = [
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
  const options = {
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
  const calls = [];
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
  const line1 = root.children[0].children[0].children[0];
  assert.equal(line1.properties.class, undefined);
  assert.equal(line1.children[0].properties['data-char'], '0');
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
  const line = root.children[0].children[0].children[0];
  const wrapper = line.children.find(
    (child) => child.properties?.class === 'highlighted-word'
  );
  assert.ok(wrapper !== undefined, 'decoration wrapper exists');
  const text = wrapper.children.map((span) => span.children[0].value).join('');
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
  const textOf = (node) =>
    node.type === 'text'
      ? node.value
      : node.children.map((child) => textOf(child)).join('');
  const line = root.children[0].children[0].children[0];
  const outer = line.children.find(
    (child) => child.properties?.class === 'outer'
  );
  assert.ok(outer !== undefined, 'outer wrapper exists');
  assert.equal(textOf(outer), code.slice(1, 12));
  const inner = outer.children.find(
    (child) => child.properties?.class === 'inner'
  );
  assert.ok(inner !== undefined, 'inner wrapper nests inside the outer one');
  assert.equal(textOf(inner), code.slice(2, 11));
  assert.equal(textOf(line), code);
});

void t.test('codeToHast: transformer context and token htmlAttrs', () => {
  const seen = {};
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
  assert.equal(pre.properties.class.includes('from-context'), true);
  assert.equal(pre.properties['data-source'], 'test');
  assert.equal(pre.properties._hidden, undefined);
  assert.deepEqual(seen, {
    meta: 'test',
    structure: 'classic',
    lineCount: 2,
    codeTag: 'code',
    reTokens: 1,
  });
  const span = pre.children[0].children[0].children[0];
  assert.equal(span.properties.class, 'tok');
});

void t.test(
  'TokenizeStream: chunked output matches codeToTokens (fuzz)',
  () => {
    const samples = [
      ['ts', 'const a = `tpl\nline2`;\n// done\nlet b = "x"\n'],
      ['css', '.a {\n  color: red; /* note\nspans lines */\n}\n'],
      ['markdown', '# title\n\n```js\nlet a = 1\n```\ntail'],
      ['python', 'def f():\n    return """doc\nstring"""\n'],
      // multi-byte lines followed by ASCII, and astral pairs the random
      // chunking will split across pushes
      ['ts', 'const é = "日本語"\nconst x = 1 // 🎈🎈\nlet y = 2\n'],
    ];
    let seed = 0x51ed2701;
    for (const [lang, code] of samples) {
      const direct = codeToTokens(code, { lang, theme: pierreDark }).tokens;
      for (let round = 0; round < 16; round++) {
        const stream = new TokenizeStream({ lang, theme: pierreDark });
        const streamed = [];
        let at = 0;
        while (at < code.length) {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          const step = 1 + (seed % 9);
          streamed.push(...stream.pushCode(code.slice(at, at + step)));
          at += step;
        }
        streamed.push(...stream.end());
        assert.deepEqual(streamed, direct, `${lang} round ${round}`);
      }
    }
  }
);

void t.test('TokenizeStream: empty stream yields one empty line', () => {
  const stream = new TokenizeStream({ lang: 'ts', theme: pierreDark });
  assert.deepEqual(stream.pushCode(''), []);
  assert.deepEqual(stream.end(), [[]]);
});

void t.test('TokenizeStream: ASCII resumed after a multi-byte line', () => {
  // the resumed byte offset (3 for `é\n`) exceeds the char offset (2); the
  // ASCII fast path must not treat record byte ends as string offsets
  const code = 'é\nconst x = 1\n';
  const direct = codeToTokens(code, { lang: 'ts', theme: pierreDark }).tokens;
  const stream = new TokenizeStream({ lang: 'ts', theme: pierreDark });
  const streamed = [
    ...stream.pushCode('é\n'),
    ...stream.pushCode('const x = 1\n'),
  ];
  streamed.push(...stream.end());
  assert.deepEqual(streamed, direct);
  assert.equal(lineText(streamed[1]), 'const x = 1');
});

void t.test('TokenizeStream: surrogate pair split across chunks', () => {
  const code = 'const s = "🎈"\nlet x = 1\n';
  const direct = codeToTokens(code, { lang: 'ts', theme: pierreDark }).tokens;
  const [high, low] = ['🎈'[0], '🎈'[1]];
  const stream = new TokenizeStream({ lang: 'ts', theme: pierreDark });
  const streamed = [
    ...stream.pushCode(`const s = "${high}`),
    ...stream.pushCode(`${low}"\nlet x = 1\n`),
    ...stream.end(),
  ];
  assert.deepEqual(streamed, direct);
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
  const stream = new TokenizeStream({
    lang: 'ts',
    theme: pierreDark,
    tokenizeMaxLineLength: 10,
  });
  const streamed = [...stream.pushCode(code), ...stream.end()];
  assert.deepEqual(streamed, tokens);
});

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
  const colorOf = (theme) =>
    codeToTokens('const a = 1', { lang: 'ts', theme }).tokens[0][0].color;
  assert.equal(colorOf(variantA), '#ff0000');
  assert.equal(colorOf(variantB), '#00ff00');
});

void t.test('LiveTokenizer: line updates and bracket-ignored ranges', () => {
  const live = new LiveTokenizer({
    lang: 'ts',
    theme: pierreDark,
    code: 'function f() {\n  return 1;\n}',
  });
  assert.equal(live.lineCount, 3);
  const updated = live.tokenizeLine(1, '  return "a { b"; // c(d)');
  assert.equal(lineText(updated.tokens), '  return "a { b"; // c(d)');
  // offsets are line-relative
  assert.equal(updated.tokens[0].offset, 0);
  // the string and the comment are ignored ranges for bracket matching
  assert.deepEqual(updated.bracketIgnoredRanges, [
    [9, 16],
    [18, 25],
  ]);
  // unchanged lines tokenize from cache and agree with codeToTokens
  const line0 = live.tokenizeLine(0, 'function f() {');
  const direct = codeToTokens('function f() {\n  return "a { b"; // c(d)\n}', {
    lang: 'ts',
    theme: pierreDark,
  }).tokens[0];
  assert.deepEqual(
    line0.tokens.map((tk) => [tk.offset, tk.content, tk.color]),
    direct.map((tk) => [tk.offset, tk.content, tk.color])
  );
  assert.deepEqual(line0.bracketIgnoredRanges, []);
});

void t.test(
  'LiveTokenizer: multi-line constructs re-tokenize across lines',
  () => {
    const live = new LiveTokenizer({
      lang: 'ts',
      theme: pierreDark,
      code: 'const s = `abc\nrest`;',
    });
    // line 1 starts inside the template literal
    const inside = live.tokenizeLine(1, 'rest`;');
    assert.equal(inside.tokens[0].type, 2);
    // closing the template on line 0 flips line 1 out of the string
    live.tokenizeLine(0, 'const s = `abc`;');
    const outside = live.tokenizeLine(1, 'rest`;');
    assert.notEqual(outside.tokens[0].type, 2);
  }
);

void t.test('LiveTokenizer: splice and append lines', () => {
  const live = new LiveTokenizer({ lang: 'ts', theme: pierreDark, code: 'a' });
  live.tokenizeLine(1, 'let b = 1');
  assert.equal(live.lineCount, 2);
  live.spliceLines(0, 1);
  assert.equal(live.lineCount, 1);
  const { tokens } = live.tokenizeLine(0, 'let b = 1');
  assert.equal(lineText(tokens), 'let b = 1');
});
