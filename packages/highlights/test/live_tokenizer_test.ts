import assert from 'node:assert';
import t from 'node:test';

import { LANGS } from '../lib/highlighter';
import type {
  HighlightedToken,
  Lang,
  LiveTextEdit,
  ThemedToken,
} from '../lib/index';
import {
  codeToTokens,
  init,
  LiveTokenizer,
  StreamTokenizer,
  tokenNames,
} from '../lib/index';
import { transformWat, wat2wasm } from '../scripts/build';
import pierreDark from '../themes/pierre-dark.json' with { type: 'json' };
import { tokenizerSamples } from './_samples';
import { assertLineFedParity, makeRand, themeColor } from './_util';

let wasmModule: WebAssembly.Module;

t.before(() => {
  const url = new URL('./live_test.wat', import.meta.url);
  const { code } = transformWat(
    url,
    `(module
      (import "../src/highlights.wat")
      (global (export "freeHeads") i32 (i32.const $mem.liveFree)))`
  );
  wasmModule = new WebAssembly.Module(wat2wasm(url.pathname, code));
  init(wasmModule);
});

const terminatorRe = /\r\n|\r|\n/g;

/** Content of each line; CRLF, lone CR, and lone LF all terminate. */
function docLines(code: string): string[] {
  return code.split(terminatorRe);
}

/** Absolute UTF-16 offset of each line start. */
function lineStartsOf(code: string): number[] {
  const starts = [0];
  for (const m of code.matchAll(terminatorRe)) {
    starts.push(m.index + m[0].length);
  }
  return starts;
}

/**
 * The document as the reference tokenizers see it: live tokenization presents
 * every line break to the lexers as `\n`, so lone-CR terminators map to LF
 * (offsets are unchanged — both are one UTF-16 unit).
 */
function lexNormalized(code: string): string {
  return code.replace(/\r(?!\n)/g, '\n');
}

/** Assert the live document matches a fresh full tokenization of `code`. */
function assertMatchesFresh(
  live: LiveTokenizer,
  code: string,
  lang: Lang,
  label: string
): void {
  const fresh = codeToTokens(lexNormalized(code), {
    lang,
    theme: pierreDark,
  }).tokens;
  const lines = docLines(code);
  const starts = lineStartsOf(code);
  assert.equal(live.lineCount, lines.length, `${label}: line count`);
  for (let i = 0; i < lines.length; i++) {
    assert.equal(live.getLineText(i), lines[i], `${label}: line ${i} text`);
    assert.equal(
      live.getLineLength(i),
      lines[i].length,
      `${label}: line ${i} length`
    );
    const relative = fresh[i].map((tk: ThemedToken) => ({
      ...tk,
      offset: tk.offset - starts[i],
    }));
    assert.deepEqual(
      live.getLineTokens(i).tokens,
      relative,
      `${label}: line ${i} tokens`
    );
  }
}

const editTexts = [
  '',
  'x',
  ' ',
  '\n',
  '\n\n',
  '"',
  '`',
  '/*',
  '*/',
  'const a = 1;\n',
  '}',
  '{',
  '𝛼🙂',
  'é日本',
  '\r\n',
  '\r',
  'x\ry',
  '<b>',
  '#',
  '--',
  '${x}',
];

/** Build a random non-overlapping batch against the live line lengths. */
function randomBatch(rand: () => number, live: LiveTokenizer): LiveTextEdit[] {
  const lineCount = live.lineCount;
  const raw: {
    sl: number;
    sc: number;
    el: number;
    ec: number;
    text: string;
  }[] = [];
  const n = 1 + (rand() % 3);
  for (let i = 0; i < n; i++) {
    const sl = rand() % lineCount;
    const sc = rand() % (live.getLineLength(sl) + 1);
    const el = Math.min(lineCount - 1, sl + (rand() % 3));
    let ec = rand() % (live.getLineLength(el) + 1);
    if (el === sl && ec < sc) ec = sc;
    raw.push({ sl, sc, el, ec, text: editTexts[rand() % editTexts.length] });
  }
  raw.sort((a, b) => (a.sl !== b.sl ? a.sl - b.sl : a.sc - b.sc));
  const picked: typeof raw = [];
  for (const e of raw) {
    const prev = picked[picked.length - 1];
    if (
      prev !== undefined &&
      (prev.el > e.sl ||
        (prev.el === e.sl && prev.ec > e.sc) ||
        (prev.sl === e.sl && prev.sc === e.sc))
    ) {
      continue;
    }
    picked.push(e);
  }
  // deliver in reverse to exercise unordered batch handling
  return picked.reverse().map((e) => ({
    range: {
      start: { line: e.sl, character: e.sc },
      end: { line: e.el, character: e.ec },
    },
    newText: e.text,
  }));
}

/** Apply the same edits to a mirror string with plain UTF-16 splices. */
function applyToMirror(code: string, edits: readonly LiveTextEdit[]): string {
  const starts = lineStartsOf(code);
  const spans = edits
    .map((e) => ({
      from: starts[e.range.start.line] + e.range.start.character,
      to: starts[e.range.end.line] + e.range.end.character,
      text: e.newText,
    }))
    // apply back to front; on a tie the wider range goes first so an insert
    // at the same offset ends up before the replaced text
    .sort((a, b) => (a.from !== b.from ? b.from - a.from : b.to - a.to));
  for (const s of spans) {
    code = code.slice(0, s.from) + s.text + code.slice(s.to);
  }
  return code;
}

void t.test('LiveTokenizer: eager indexing matches codeToTokens', () => {
  assert.deepEqual(
    new Set(tokenizerSamples.map(([lang]) => LANGS[lang])),
    new Set(Object.values(LANGS)),
    'tokenizer samples cover every lexer, including plain text'
  );
  for (const [lang, code] of tokenizerSamples) {
    const live = new LiveTokenizer({ lang, theme: pierreDark, code });
    assertMatchesFresh(live, code, lang, `init ${lang}`);
    live.dispose();
  }
});

/**
 * Assert the live document matches the same text fed to StreamTokenizer one
 * line per chunk: exactly the boundary condition live tokenization uses.
 * Full-document lookahead (markdown and mdx block decisions) may legally
 * differ from this on malformed constructs, so randomized edits compare
 * against the streaming oracle while pristine documents also compare
 * against codeToTokens above.
 */
function assertMatchesLineStream(
  live: LiveTokenizer,
  code: string,
  lang: Lang,
  label: string
): void {
  const stream = new StreamTokenizer({ lang, theme: pierreDark });
  const streamed: ThemedToken[][] = [];
  const normalized = lexNormalized(code);
  for (const chunk of normalized.length === 0
    ? []
    : normalized.split(/(?<=\n)/)) {
    streamed.push(...stream.pushCode(chunk));
  }
  streamed.push(...stream.end());
  const lines = docLines(code);
  const starts = lineStartsOf(code);
  assert.equal(live.lineCount, lines.length, `${label}: line count`);
  for (let i = 0; i < lines.length; i++) {
    assert.equal(live.getLineText(i), lines[i], `${label}: line ${i} text`);
    const relative = streamed[i].map((tk: ThemedToken) => ({
      ...tk,
      offset: tk.offset - starts[i],
    }));
    assert.deepEqual(
      live.getLineTokens(i).tokens,
      relative,
      `${label}: line ${i} tokens`
    );
  }
}

void t.test('LiveTokenizer: randomized edit batches match streaming', () => {
  const rand = makeRand(0x2f6e2b1);
  for (const [lang, code] of tokenizerSamples) {
    const live = new LiveTokenizer({ lang, theme: pierreDark, code });
    let mirror = code;
    for (let round = 0; round < 6; round++) {
      const batch = randomBatch(rand, live);
      const before = live.revision;
      const update = live.applyEdits(batch);
      mirror = applyToMirror(mirror, batch);
      assert.equal(update.lineCount, docLines(mirror).length);
      assert.ok(update.revision >= before);
      assertMatchesLineStream(live, mirror, lang, `${lang} round ${round}`);
    }
    live.dispose();
  }
});

void t.test(
  'LiveTokenizer: randomized renderRange batches match unranged updates',
  () => {
    const rand = makeRand(0x51c37a9);
    for (const [lang, code] of tokenizerSamples) {
      const plain = new LiveTokenizer({ lang, theme: pierreDark, code });
      const deliveries: Map<number, HighlightedToken[]>[] = [];
      const ranged = new LiveTokenizer({
        lang,
        theme: pierreDark,
        code,
        onDeferTokenize: (lines) => deliveries.push(lines),
      });
      // whether the previous round left deferred work for the next edit's
      // settle path; deliveries then mix coordinate spaces, so the exact-once
      // coverage check only runs on rounds that start and end settled
      let carriedPending = false;
      for (let round = 0; round < 6; round++) {
        const batch = randomBatch(rand, plain);
        const update = plain.applyEdits(batch);
        const startLine = Math.floor(rand() * (update.lineCount + 1));
        const endLine = startLine + Math.floor(rand() * (update.lineCount + 2));
        deliveries.length = 0;
        const rangedUpdate = ranged.applyEdits(batch, {
          renderRange: [startLine, endLine],
        });
        const label = `${lang} ranged round ${round}`;
        for (const line of rangedUpdate.lines.keys()) {
          assert.ok(
            line >= startLine && line < endLine,
            `${label}: line ${line} inside [${startLine}, ${endLine})`
          );
        }
        if (rand() < 0.5) {
          carriedPending = ranged.pendingTokenization;
          continue;
        }
        ranged.flush();
        if (!carriedPending) {
          const seen = new Set<number>(rangedUpdate.lines.keys());
          for (const lines of deliveries) {
            for (const line of lines.keys()) {
              assert.ok(!seen.has(line), `${label}: line ${line} once`);
              seen.add(line);
            }
          }
          const expected = new Set<number>();
          for (const change of update.lineChanges) {
            for (let i = change.newStartLine; i < change.newEndLine; i++) {
              expected.add(i);
            }
          }
          assert.deepEqual(
            [...seen].sort((a, b) => a - b),
            [...expected].sort((a, b) => a - b),
            `${label}: coverage`
          );
        }
        carriedPending = false;
        for (let i = 0; i < plain.lineCount; i++) {
          assert.deepEqual(
            ranged.getLineTokens(i),
            plain.getLineTokens(i),
            `${label}: line ${i} tokens`
          );
        }
      }
      ranged.flush();
      for (let i = 0; i < plain.lineCount; i++) {
        assert.deepEqual(
          ranged.getLineTokens(i),
          plain.getLineTokens(i),
          `${lang} final line ${i} tokens`
        );
      }
      plain.dispose();
      ranged.dispose();
    }
  }
);

void t.test(
  'LiveTokenizer: HTML template state survives edits and restores',
  () => {
    for (const lang of ['js', 'jsx', 'ts', 'tsx'] as const) {
      let code =
        'html`<div title="before ${\nhtml`<b>${value}</b>`\n} after"\n disabled>\n<!-- comment\nend -->\n</div>`;';
      const live = new LiveTokenizer({ lang, theme: pierreDark, code });
      assertMatchesFresh(live, code, lang, 'initial HTML');
      for (const marker of ['other', '/* HTML */', 'html']) {
        const end = code.indexOf('`');
        live.applyEdits([
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: end },
            },
            newText: marker,
          },
        ]);
        code = marker + code.slice(end);
        assertMatchesFresh(live, code, lang, marker);
        const start = code.indexOf('value');
        const range = {
          start: { line: 1, character: 10 },
          end: { line: 1, character: 15 },
        };
        live.applyEdits([{ range, newText: 'count' }]);
        code = code.slice(0, start) + 'count' + code.slice(start + 5);
        assertMatchesFresh(live, code, lang, 'nested edit');
        live.applyEdits([{ range, newText: 'value' }]);
        code = code.slice(0, start) + 'value' + code.slice(start + 5);
      }
      live.dispose();
    }
  }
);

void t.test(
  'LiveTokenizer: CSS templates restore state after marker edits',
  () => {
    for (const lang of ['js', 'jsx', 'ts', 'tsx'] as const) {
      let code =
        'css`.card {\n color: ${\ncss`red`\n};\n content: "${html`<b>${value}</b>`} after";\n /* first\n last */\n}`;';
      const live = new LiveTokenizer({ lang, theme: pierreDark, code });
      assertMatchesFresh(live, code, lang, 'initial CSS');
      for (const marker of ['other', '/* CSS */', 'html', 'css']) {
        const end = code.indexOf('`');
        live.applyEdits([
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: end },
            },
            newText: marker,
          },
        ]);
        code = marker + code.slice(end);
        assertMatchesFresh(live, code, lang, marker);
      }
      live.dispose();
    }
  }
);

void t.test(
  'LiveTokenizer: Angular metadata restores markup and expression state after edits',
  () => {
    for (const lang of ['js', 'jsx', 'ts', 'tsx'] as const) {
      let code =
        '({ template: `<p\n [title]="${\n({ template: `<b>{{ nested }}</b>` }).template\n} + name">\n@if (ready) { {{\n name | uppercase\n }} }\n</p>` });';
      const live = new LiveTokenizer({ lang, theme: pierreDark, code });
      assertMatchesFresh(live, code, lang, 'initial Angular template');
      let key = 'template';
      for (const replacement of ['fallback', 'styles', 'template']) {
        live.applyEdits([
          {
            range: {
              start: { line: 0, character: 3 },
              end: { line: 0, character: 3 + key.length },
            },
            newText: replacement,
          },
        ]);
        code = code.slice(0, 3) + replacement + code.slice(3 + key.length);
        key = replacement;
        if (key === 'styles') {
          // Angular markup is malformed CSS, whose lookahead can differ by line.
          assertMatchesLineStream(live, code, lang, key);
        } else {
          assertMatchesFresh(live, code, lang, key);
        }
      }
      live.dispose();
    }
  }
);

void t.test('LiveTokenizer: restores a full template stack after edits', () => {
  for (const lang of ['js', 'jsx', 'ts', 'tsx'] as const) {
    const head = 'html`<b>${'.repeat(256) + '\n';
    const tail = '\n' + '}</b>`'.repeat(256);
    const code = head + 'value' + tail;
    const live = new LiveTokenizer({ lang, theme: pierreDark, code });
    assertMatchesFresh(live, code, lang, 'full template stack');
    live.applyEdits([
      {
        range: {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 5 },
        },
        newText: '({ value: "x" }).value',
      },
    ]);
    assertMatchesFresh(
      live,
      head + '({ value: "x" }).value' + tail,
      lang,
      'edited full template stack'
    );
    live.dispose();
  }
});

void t.test('LiveTokenizer: empty and edge documents', () => {
  for (const code of [
    '',
    '\n',
    'a',
    'a\n',
    '\n\n',
    '\r\n',
    '\r',
    'a\r',
    '\r\r',
  ]) {
    const live = new LiveTokenizer({ lang: 'ts', theme: pierreDark, code });
    assertMatchesFresh(live, code, 'ts', JSON.stringify(code));
    live.dispose();
  }
  // constructor without code starts as one empty line
  const live = new LiveTokenizer({ lang: 'ts', theme: pierreDark });
  assert.equal(live.lineCount, 1);
  assert.equal(live.getLineText(0), '');
});

void t.test(
  'LiveTokenizer: a state-neutral middle edit re-tokenizes one line',
  () => {
    const code = Array.from(
      { length: 20 },
      (_, i) => `const v${i} = ${i};`
    ).join('\n');
    const live = new LiveTokenizer({ lang: 'ts', theme: pierreDark, code });
    const edit: LiveTextEdit = {
      range: {
        start: { line: 10, character: 13 },
        end: { line: 10, character: 14 },
      },
      newText: '9',
    };
    const update = live.applyEdits([edit]);
    // convergence on the edited line itself: the change list covers exactly it
    assert.deepEqual(update.lineChanges, [
      { oldStartLine: 10, oldEndLine: 11, newStartLine: 10, newEndLine: 11 },
    ]);
    assert.equal(live.getLineText(10), 'const v10 = 19;');
    assertMatchesFresh(live, applyToMirror(code, [edit]), 'ts', 'neutral edit');
    live.dispose();
  }
);

void t.test('LiveTokenizer: multiline edits stop at state convergence', () => {
  const code = 'const a = `one\ntwo\nthree`;\nlet x = 1;\nlet y = 2;\n';
  const live = new LiveTokenizer({ lang: 'ts', theme: pierreDark, code });
  // a two-line replacement whose final line restores the old outgoing state
  // stops exactly at the edited range, leaving later lines untouched
  const update = live.applyEdits([
    {
      range: {
        start: { line: 3, character: 8 },
        end: { line: 4, character: 9 },
      },
      newText: '9;\nlet y = 8',
    },
  ]);
  assert.deepEqual(update.lineChanges, [
    { oldStartLine: 3, oldEndLine: 5, newStartLine: 3, newEndLine: 5 },
  ]);
  assertMatchesFresh(
    live,
    'const a = `one\ntwo\nthree`;\nlet x = 9;\nlet y = 8;\n',
    'ts',
    'convergent replacement'
  );
  live.dispose();
});

void t.test(
  'LiveTokenizer: a full change list preserves adjacent allocator state',
  () => {
    const code = 'const a = 0;\n'.repeat(2000);
    const live = new LiveTokenizer({ lang: 'ts', theme: pierreDark, code });
    const edits = Array.from({ length: 1000 }, (_, i) => ({
      range: {
        start: { line: i * 2, character: 10 },
        end: { line: i * 2, character: 11 },
      },
      newText: '1',
    }));
    assert.equal(live.applyEdits(edits).lineChanges.length, 1000);
    assertMatchesFresh(
      live,
      'const a = 1;\nconst a = 0;\n'.repeat(1000),
      'ts',
      'full change list'
    );
    // Reuse the free lists after the last change record has been written.
    assert.equal(
      live.applyEdits(edits.map((edit) => ({ ...edit, newText: '0' })))
        .lineChanges.length,
      1000
    );
    assertMatchesFresh(live, code, 'ts', 'reused free lists');
    live.dispose();
  }
);

void t.test('LiveTokenizer: unterminated constructs propagate to EOF', () => {
  const code = 'let a = 1;\nlet b = 2;\nlet c = 3;\n';
  const live = new LiveTokenizer({ lang: 'ts', theme: pierreDark, code });
  const update = live.applyEdits([
    {
      range: {
        start: { line: 0, character: 8 },
        end: { line: 0, character: 8 },
      },
      newText: '`',
    },
  ]);
  assert.deepEqual(update.lineChanges, [
    { oldStartLine: 0, oldEndLine: 4, newStartLine: 0, newEndLine: 4 },
  ]);
  assertMatchesFresh(
    live,
    'let a = `1;\nlet b = 2;\nlet c = 3;\n',
    'ts',
    'open template'
  );
  live.dispose();
});

void t.test('LiveTokenizer: structural change ranges map old to new', () => {
  const code = 'aaa\nbbb\nccc\n';
  const live = new LiveTokenizer({ lang: 'plain', theme: pierreDark, code });
  const update = live.applyEdits([
    {
      range: {
        start: { line: 1, character: 0 },
        end: { line: 1, character: 0 },
      },
      newText: 'zzz\n',
    },
  ]);
  assert.equal(update.previousLineCount, 4);
  assert.equal(update.lineCount, 5);
  assert.deepEqual(update.lineChanges, [
    { oldStartLine: 1, oldEndLine: 2, newStartLine: 1, newEndLine: 3 },
  ]);
  assert.equal(live.getLineText(1), 'zzz');
  assert.equal(live.getLineText(2), 'bbb');
  live.dispose();
});

void t.test('LiveTokenizer: batch validation is atomic', () => {
  const code = 'one\ntwo\n';
  const live = new LiveTokenizer({ lang: 'plain', theme: pierreDark, code });
  const revision = live.revision;
  const good: LiveTextEdit = {
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
    newText: 'X',
  };
  const cases: [LiveTextEdit[], ErrorConstructor][] = [
    // out-of-range line
    [
      [
        good,
        {
          range: {
            start: { line: 9, character: 0 },
            end: { line: 9, character: 0 },
          },
          newText: 'x',
        },
      ],
      RangeError,
    ],
    // character past the line end
    [
      [
        {
          range: {
            start: { line: 1, character: 4 },
            end: { line: 1, character: 4 },
          },
          newText: 'x',
        },
      ],
      RangeError,
    ],
    // inverted range
    [
      [
        {
          range: {
            start: { line: 1, character: 2 },
            end: { line: 0, character: 0 },
          },
          newText: 'x',
        },
      ],
      RangeError,
    ],
    // overlapping edits
    [
      [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 2 },
          },
          newText: 'x',
        },
        {
          range: {
            start: { line: 0, character: 1 },
            end: { line: 0, character: 3 },
          },
          newText: 'y',
        },
      ],
      RangeError,
    ],
    // malformed shapes
    [[{ range: { start: { line: 0 } } } as unknown as LiveTextEdit], TypeError],
    [[{ range: good.range, newText: 1 } as unknown as LiveTextEdit], TypeError],
  ];
  for (const [batch, err] of cases) {
    assert.throws(() => live.applyEdits(batch), err);
    assert.equal(live.revision, revision);
    assert.equal(live.getLineText(0), 'one');
    assert.equal(live.getLineText(1), 'two');
  }
  for (const endpoint of ['start', 'end'] as const) {
    for (const coordinate of ['line', 'character'] as const) {
      for (const value of [-1, 0.5, NaN, Infinity]) {
        const invalid = {
          ...good,
          range: {
            ...good.range,
            [endpoint]: { ...good.range[endpoint], [coordinate]: value },
          },
        };
        assert.throws(() => live.applyEdits([good, invalid]), TypeError);
        assert.equal(live.revision, revision);
        assert.equal(live.getText(), code);
        assertMatchesFresh(
          live,
          code,
          'plain',
          `${endpoint}.${coordinate}=${value}`
        );
      }
    }
  }
  live.dispose();
});

void t.test('LiveTokenizer: no-op batches leave the revision alone', () => {
  const code = 'one\r\ntwo\nthree';
  const live = new LiveTokenizer({ lang: 'plain', theme: pierreDark, code });
  const revision = live.revision;
  const before = live.getLineRecords(1);
  const noops: LiveTextEdit[][] = [
    [],
    // empty range, empty text
    [
      {
        range: {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 2 },
        },
        newText: '',
      },
    ],
    // byte-identical same-line replacement
    [
      {
        range: {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 3 },
        },
        newText: 'two',
      },
    ],
    // byte-identical multi-line replacement including a CRLF terminator
    [
      {
        range: {
          start: { line: 0, character: 1 },
          end: { line: 2, character: 2 },
        },
        newText: 'ne\r\ntwo\nth',
      },
    ],
  ];
  for (const batch of noops) {
    const update = live.applyEdits(batch);
    assert.equal(update.revision, revision);
    assert.deepEqual(update.lineChanges, []);
    assert.equal(update.lineCount, 3);
  }
  // the borrowed view was never invalidated
  assert.equal(before.revision, live.revision);
  assert.deepEqual([...live.getLineRecords(1).data], [...before.data]);
  live.dispose();
});

void t.test('LiveTokenizer: revisions bump once per successful batch', () => {
  const live = new LiveTokenizer({
    lang: 'ts',
    theme: pierreDark,
    code: 'a\nb',
  });
  assert.equal(live.revision, 0);
  live.applyEdits([
    {
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 },
      },
      newText: 'x',
    },
  ]);
  assert.equal(live.revision, 1);
  const records = live.getLineRecords(0);
  assert.equal(records.revision, 1);
  live.reset('c\nd');
  assert.equal(live.revision, 2);
  assert.ok(records.revision < live.revision);
  live.dispose();
});

void t.test('LiveTokenizer: packed records tile each line', () => {
  const code = 'const s = "str"; // note\n';
  const live = new LiveTokenizer({ lang: 'ts', theme: pierreDark, code });
  const { format, data } = live.getLineRecords(0);
  assert.equal(format, 'packed24');
  const tokens = live.getLineTokens(0).tokens;
  let start = 0;
  const spans: [number, number, string][] = [];
  for (const word of data) {
    const end = word & 0xffffff;
    const id = word >>> 24;
    assert.ok(end > start);
    assert.ok(id < tokenNames.length);
    spans.push([start, end, tokenNames[id]]);
    start = end;
  }
  assert.equal(start, live.getLineLength(0));
  // records and themed tokens describe identical boundaries
  assert.deepEqual(
    tokens.map((tk) => [tk.offset, tk.offset + tk.content.length]),
    spans.map(([s, e]) => [s, e])
  );
  // string and comment records carry the standard types used for brackets
  const ignored = live.getLineTokens(0).bracketIgnoredRanges;
  assert.deepEqual(ignored, [
    [10, 15],
    [17, 24],
  ]);
  live.dispose();
});

void t.test('LiveTokenizer: long lines switch to wide records', () => {
  const long = 'a'.repeat(0x1000000 + 8);
  const live = new LiveTokenizer({
    lang: 'plain',
    theme: pierreDark,
    code: long,
  });
  const { format, data } = live.getLineRecords(0);
  assert.equal(format, 'wide32');
  assert.equal(data.length, 2);
  assert.equal(data[0], long.length);
  assert.equal(data[1], 0);
  assert.equal(live.getLineLength(0), long.length);
  live.dispose();
});

void t.test(
  'LiveTokenizer: tokenizeMaxLineLength collapses themed output',
  () => {
    const code = 'const aaaaaaaaaa = 1;\nx\n';
    const live = new LiveTokenizer({
      lang: 'ts',
      theme: pierreDark,
      code,
      tokenizeMaxLineLength: 10,
    });
    const { tokens, bracketIgnoredRanges } = live.getLineTokens(0);
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].content, 'const aaaaaaaaaa = 1;');
    assert.deepEqual(bracketIgnoredRanges, []);
    // raw records stay precise
    assert.ok(live.getLineRecords(0).data.length > 1);
    // short lines keep full tokens
    assert.ok(live.getLineTokens(1).tokens.length >= 1);
    live.dispose();
  }
);

void t.test('LiveTokenizer: preserves leading BOMs in document lines', () => {
  let code = '\uFEFFconst x = 1;\n\uFEFFlet y = 2;';
  const live = new LiveTokenizer({ lang: 'ts', theme: pierreDark, code });
  assert.equal(live.getText(), code);
  assertMatchesFresh(live, code, 'ts', 'leading BOMs');

  const edits = [
    {
      range: {
        start: { line: 0, character: 1 },
        end: { line: 0, character: 6 },
      },
      newText: 'let',
    },
    {
      range: {
        start: { line: 1, character: 0 },
        end: { line: 1, character: 1 },
      },
      newText: '',
    },
  ];
  live.applyEdits(edits);
  code = applyToMirror(code, edits);
  assert.equal(live.getText(), code);
  assertMatchesFresh(live, code, 'ts', 'edited BOM lines');
  live.dispose();
});

void t.test('LiveTokenizer: lone surrogates survive edits as WTF-8', () => {
  const live = new LiveTokenizer({
    lang: 'plain',
    theme: pierreDark,
    code: 'x\uD800y\nplain',
  });
  assert.equal(live.getLineText(0), 'x\uD800y');
  assert.equal(live.getLineLength(0), 3);
  // splitting an astral pair leaves matching lone halves on both sides
  const astral = new LiveTokenizer({
    lang: 'plain',
    theme: pierreDark,
    code: 'x𝛼y',
  });
  astral.applyEdits([
    {
      range: {
        start: { line: 0, character: 2 },
        end: { line: 0, character: 2 },
      },
      newText: 'Q',
    },
  ]);
  assert.equal(astral.getLineText(0), 'x𝛼y'.slice(0, 2) + 'Q' + 'x𝛼y'.slice(2));
  assert.equal(astral.getLineLength(0), 5);
  // and splitting across a newline produces two WTF-8 lines
  astral.applyEdits([
    {
      range: {
        start: { line: 0, character: 2 },
        end: { line: 0, character: 3 },
      },
      newText: '\n',
    },
  ]);
  assert.equal(astral.getLineText(0), 'x\uD835');
  assert.equal(astral.getLineText(1), '\uDEFCy');
  live.dispose();
  astral.dispose();
});

void t.test(
  'LiveTokenizer: rejoined surrogate pairs match fresh tokens',
  () => {
    const code = 'const 𝛼 = 1;';
    for (const separator of ['Q', '\n', '\r', '\r\n']) {
      const live = new LiveTokenizer({ lang: 'ts', theme: pierreDark, code });
      try {
        live.applyEdits([
          {
            range: {
              start: { line: 0, character: 7 },
              end: { line: 0, character: 7 },
            },
            newText: separator,
          },
        ]);
        assert.equal(
          live.getText(),
          code.slice(0, 7) + separator + code.slice(7)
        );
        live.applyEdits([
          {
            range: {
              start: { line: 0, character: 7 },
              end:
                separator === 'Q'
                  ? { line: 0, character: 8 }
                  : { line: 1, character: 0 },
            },
            newText: '',
          },
        ]);
        assert.equal(live.getText(), code);
        assertMatchesFresh(live, code, 'ts', JSON.stringify(separator));
      } finally {
        live.dispose();
      }
    }
  }
);

void t.test(
  'LiveTokenizer: joins surrogate pairs at both replacement boundaries',
  () => {
    for (const [code, start, end, newText] of [
      ['const \uD835 = 1;', 7, 7, '\uDEFC'],
      ['const \uDEFC = 1;', 6, 6, '\uD835'],
      ['const \uD835-\uDEFC = 1;', 7, 8, '\uDEFC\uD835'],
      ['\uD835', 1, 1, '\uDEFC'],
      ['\uDEFC', 0, 0, '\uD835'],
    ] as const) {
      const live = new LiveTokenizer({ lang: 'ts', theme: pierreDark, code });
      try {
        live.applyEdits([
          {
            range: {
              start: { line: 0, character: start },
              end: { line: 0, character: end },
            },
            newText,
          },
        ]);
        const expected = code.slice(0, start) + newText + code.slice(end);
        assert.equal(live.getText(), expected);
        assertMatchesFresh(live, expected, 'ts', JSON.stringify(code));
      } finally {
        live.dispose();
      }
    }
  }
);

void t.test('LiveTokenizer: final-line terminator edits', () => {
  const live = new LiveTokenizer({ lang: 'ts', theme: pierreDark, code: 'a' });
  // adding a trailing terminator creates the trailing empty line
  live.applyEdits([
    {
      range: {
        start: { line: 0, character: 1 },
        end: { line: 0, character: 1 },
      },
      newText: '\n',
    },
  ]);
  assert.equal(live.lineCount, 2);
  assertMatchesFresh(live, 'a\n', 'ts', 'added terminator');
  // removing it merges the final empty line back
  live.applyEdits([
    {
      range: {
        start: { line: 0, character: 1 },
        end: { line: 1, character: 0 },
      },
      newText: '',
    },
  ]);
  assert.equal(live.lineCount, 1);
  assertMatchesFresh(live, 'a', 'ts', 'removed terminator');
  live.dispose();
});

void t.test('LiveTokenizer: CR terminators merge and split like bytes', () => {
  // inserting a CR right before a lone-LF terminator joins into one CRLF
  const live = new LiveTokenizer({
    lang: 'ts',
    theme: pierreDark,
    code: 'let a = 1;\nlet b = 2;',
  });
  let update = live.applyEdits([
    {
      range: {
        start: { line: 0, character: 10 },
        end: { line: 0, character: 10 },
      },
      newText: '\r',
    },
  ]);
  assert.equal(update.lineCount, 2);
  assert.equal(live.getText(), 'let a = 1;\r\nlet b = 2;');
  assertMatchesFresh(live, 'let a = 1;\r\nlet b = 2;', 'ts', 'CR+LF join');

  // deleting the LF of a CRLF leaves a lone-CR terminator, same line count
  update = live.applyEdits([
    {
      range: {
        start: { line: 0, character: 10 },
        end: { line: 1, character: 0 },
      },
      newText: '\r',
    },
  ]);
  assert.equal(update.lineCount, 2);
  assert.equal(live.getText(), 'let a = 1;\rlet b = 2;');
  assertMatchesFresh(live, 'let a = 1;\rlet b = 2;', 'ts', 'lone CR');

  // a trailing CR at EOF terminates a final empty line
  update = live.applyEdits([
    {
      range: {
        start: { line: 1, character: 10 },
        end: { line: 1, character: 10 },
      },
      newText: '\r',
    },
  ]);
  assert.equal(update.lineCount, 3);
  assert.equal(live.getText(), 'let a = 1;\rlet b = 2;\r');
  assertMatchesFresh(live, 'let a = 1;\rlet b = 2;\r', 'ts', 'EOF CR');
  live.dispose();

  // an inserted LF at the start of the line after a lone-CR terminator is
  // byte-wise the second half of a CRLF: the lines join instead of splitting
  const joiner = new LiveTokenizer({
    lang: 'plain',
    theme: pierreDark,
    code: 'x\rz',
  });
  update = joiner.applyEdits([
    {
      range: {
        start: { line: 1, character: 0 },
        end: { line: 1, character: 0 },
      },
      newText: '\ny',
    },
  ]);
  assert.equal(update.lineCount, 2);
  assert.equal(joiner.getText(), 'x\r\nyz');
  assertMatchesFresh(joiner, 'x\r\nyz', 'plain', 'CR absorbs inserted LF');
  joiner.dispose();

  // deleting a whole line's content between a lone-CR line and an LF
  // terminator leaves the CR adjacent to the LF: one CRLF, not two breaks
  const collapser = new LiveTokenizer({
    lang: 'plain',
    theme: pierreDark,
    code: 'x\rab\nz',
  });
  update = collapser.applyEdits([
    {
      range: {
        start: { line: 1, character: 0 },
        end: { line: 1, character: 2 },
      },
      newText: '',
    },
  ]);
  assert.equal(update.lineCount, 2);
  assert.equal(collapser.getText(), 'x\r\nz');
  assertMatchesFresh(collapser, 'x\r\nz', 'plain', 'CR meets LF terminator');
  collapser.dispose();
});

void t.test('LiveTokenizer: renderRange updates match sync updates', () => {
  const lang = 'js';
  const code = 'const view = `one ${\nvalue\n}`;\n';
  const syncLive = new LiveTokenizer({ lang, theme: pierreDark, code });
  const deliveries: Map<number, HighlightedToken[]>[] = [];
  const rangedLive = new LiveTokenizer({
    lang,
    theme: pierreDark,
    code,
    onDeferTokenize: (lines) => deliveries.push(lines),
  });
  const batch: LiveTextEdit[] = [
    {
      range: {
        start: { line: 0, character: 6 },
        end: { line: 0, character: 10 },
      },
      newText: 'view2',
    },
    {
      range: {
        start: { line: 1, character: 0 },
        end: { line: 1, character: 0 },
      },
      newText: 'inner\n',
    },
  ];
  const syncUpdate = syncLive.applyEdits(batch);
  assert.equal(syncUpdate.lines.size, 0, 'no renderRange leaves lines empty');
  const update = rangedLive.applyEdits(batch, { renderRange: [0, 2] });
  assert.equal(update.revision, syncUpdate.revision);
  assert.equal(update.lineCount, syncUpdate.lineCount);
  for (const line of update.lines.keys()) {
    assert.ok(line >= 0 && line < 2, `line ${line} is inside the range`);
  }
  rangedLive.flush();
  assert.equal(rangedLive.pendingTokenization, false);
  for (let i = 0; i < syncLive.lineCount; i++) {
    assert.deepEqual(rangedLive.getLineTokens(i), syncLive.getLineTokens(i));
  }
  // every re-tokenized line arrives exactly once: in-range through the
  // update, the rest through onDeferTokenize
  const seen = new Map<number, HighlightedToken[]>(update.lines);
  for (const lines of deliveries) {
    for (const [line, tokens] of lines) {
      assert.ok(!seen.has(line), `line ${line} delivered once`);
      seen.set(line, tokens);
    }
  }
  const expected = new Set<number>();
  for (const change of syncUpdate.lineChanges) {
    for (let i = change.newStartLine; i < change.newEndLine; i++) {
      expected.add(i);
    }
  }
  assert.deepEqual(
    [...seen.keys()].sort((a, b) => a - b),
    [...expected].sort((a, b) => a - b)
  );
  for (const [line, tokens] of seen) {
    assert.equal(
      tokens.map((tk) => tk[2]).join(''),
      rangedLive.getLineText(line)
    );
    assert.equal(tokens[0][0], 0, 'tuples start at column 0');
  }
  syncLive.dispose();
  rangedLive.dispose();
});

void t.test(
  'LiveTokenizer: an edit while deferred work is pending merges the tail',
  async () => {
    const code = Array.from(
      { length: 400 },
      (_, i) => `const v${i} = ${i};`
    ).join('\n');
    const deliveries: Map<number, HighlightedToken[]>[] = [];
    const live = new LiveTokenizer({
      lang: 'ts',
      theme: pierreDark,
      code,
      onDeferTokenize: (lines) => deliveries.push(lines),
    });
    // an opening backtick invalidates every following line
    const first = live.applyEdits(
      [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
          newText: '`',
        },
      ],
      { renderRange: [0, 4] }
    );
    assert.ok(live.pendingTokenization, 'the tail is deferred');
    assert.deepEqual([...first.lines.keys()], [0, 1, 2, 3]);
    const staleTail = live.getLineTokens(399).tokens;
    // the next edit does NOT run the old tail to convergence synchronously:
    // the unreached ranges merge into the new update's own deferred work
    const second = live.applyEdits(
      [
        {
          range: {
            start: { line: 0, character: 1 },
            end: { line: 0, character: 1 },
          },
          newText: 'x',
        },
      ],
      { renderRange: [0, 4] }
    );
    assert.ok(live.pendingTokenization, 'the merged tail is still deferred');
    assert.deepEqual(live.getLineTokens(399).tokens, staleTail);
    live.flush();
    assert.equal(live.pendingTokenization, false);
    assert.notDeepEqual(live.getLineTokens(399).tokens, staleTail);
    // both edits leave line numbers unchanged, so delivery coordinates agree
    // across the two revisions: every line arrives through one channel
    const delivered = new Set<number>(first.lines.keys());
    for (const lines of deliveries) {
      for (const line of lines.keys()) delivered.add(line);
    }
    for (const line of second.lines.keys()) delivered.add(line);
    assert.equal(delivered.size, 400, 'every line was delivered');
    assert.equal(live.getText(), '`x' + code);
    assertMatchesFresh(live, '`x' + code, 'ts', 'settled document');
    // superseded slices must not fire after the flush settles everything
    const settledDeliveries = deliveries.length;
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(deliveries.length, settledDeliveries);
    live.dispose();
  }
);

void t.test(
  'LiveTokenizer: edits interrupting mid-run background slices converge',
  async () => {
    // Structural edits land while budgeted background slices are part-way
    // through the tail, so the native merge sees a cursor inside a range,
    // shifted pending pieces, and pieces swallowed by replacements.
    const rand = makeRand(0x7b21d43);
    const code = Array.from(
      { length: 300 },
      (_, i) => `const v${i} = \`t${i}\`; // note ${i}`
    ).join('\n');
    const live = new LiveTokenizer({ lang: 'ts', theme: pierreDark, code });
    let mirror = code;
    for (let round = 0; round < 40; round++) {
      const batch = randomBatch(rand, live);
      const startLine = rand() % (live.lineCount + 1);
      live.applyEdits(batch, { renderRange: [startLine, startLine + 3] });
      mirror = applyToMirror(mirror, batch);
      // let a few budgeted slices run without settling
      const ticks = rand() % 3;
      for (let i = 0; i < ticks; i++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    live.flush();
    assertMatchesLineStream(live, mirror, 'ts', 'mid-slice merge');
    live.dispose();
  }
);

void t.test('LiveTokenizer: pause suspends slices until resume', async () => {
  const code = Array.from({ length: 300 }, (_, i) => `let v${i} = ${i};`).join(
    '\n'
  );
  const deliveries: Map<number, HighlightedToken[]>[] = [];
  const live = new LiveTokenizer({
    lang: 'ts',
    theme: pierreDark,
    code,
    onDeferTokenize: (lines) => deliveries.push(lines),
  });
  live.applyEdits(
    [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
        newText: '`',
      },
    ],
    { renderRange: [0, 4] }
  );
  assert.ok(live.pendingTokenization);
  live.pause();
  const paused = deliveries.length;
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(deliveries.length, paused, 'no slices ran while paused');
  assert.ok(live.pendingTokenization, 'pending work survives the pause');
  live.resume();
  const deadline = Date.now() + 2000;
  while (live.pendingTokenization && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.equal(live.pendingTokenization, false, 'resume finishes the tail');
  assert.ok(deliveries.length > paused, 'resume delivered the tail');
  assertMatchesFresh(live, '`' + code, 'ts', 'resumed document');
  live.dispose();
});

void t.test(
  'LiveTokenizer: token-dense long lines do not trap the wasm heap',
  () => {
    // ~65k token records on one 130k-char line: packing them must grow the
    // heap while the record window sits far above the heap ceiling
    const dense = 'const a=1;'.repeat(13_000);
    const live = new LiveTokenizer({
      lang: 'ts',
      theme: pierreDark,
      code: dense,
    });
    assertMatchesFresh(live, dense, 'ts', 'dense init');
    // the same line arriving through an edit takes the incremental path
    const edited = new LiveTokenizer({
      lang: 'ts',
      theme: pierreDark,
      code: 'let x = 1;\nlet y = 2;\n',
    });
    edited.applyEdits([
      {
        range: {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 0 },
        },
        newText: `${dense}\n`,
      },
    ]);
    assertMatchesFresh(
      edited,
      `let x = 1;\n${dense}\nlet y = 2;\n`,
      'ts',
      'dense edit'
    );
    live.dispose();
    edited.dispose();
  }
);

void t.test(
  'LiveTokenizer: reset swaps in a fresh document, optionally deferred',
  () => {
    const deliveries: Map<number, HighlightedToken[]>[] = [];
    const live = new LiveTokenizer({
      lang: 'ts',
      theme: pierreDark,
      code: 'a\nb',
      onDeferTokenize: (lines) => deliveries.push(lines),
    });
    const update = live.reset('const x = 1;\nconst y = 2;\n');
    assert.deepEqual(update.lineChanges, [
      { oldStartLine: 0, oldEndLine: 2, newStartLine: 0, newEndLine: 3 },
    ]);
    assert.equal(update.lines.size, 0);
    assertMatchesFresh(live, 'const x = 1;\nconst y = 2;\n', 'ts', 'reset');
    const code = '/* note\nspans lines */\nlet z = 3;\nlet w = 4;';
    const ranged = live.reset(code, { renderRange: [0, 2] });
    assert.equal(ranged.previousLineCount, 3);
    assert.equal(ranged.lineCount, 4);
    assert.deepEqual([...ranged.lines.keys()], [0, 1]);
    live.flush();
    assert.equal(live.getText(), code);
    assertMatchesFresh(live, code, 'ts', 'deferred reset');
    const delivered = new Set<number>();
    for (const lines of deliveries) {
      for (const line of lines.keys()) delivered.add(line);
    }
    assert.deepEqual(
      [...delivered].sort((a, b) => a - b),
      [2, 3]
    );
    live.dispose();
  }
);

void t.test('LiveTokenizer: renderRange options are validated', () => {
  const live = new LiveTokenizer({ lang: 'ts', theme: pierreDark, code: 'a' });
  const edit: LiveTextEdit = {
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    newText: 'b',
  };
  assert.throws(
    () => live.applyEdits([edit], { renderRange: [2, 1] }),
    /renderRange/
  );
  assert.throws(
    () => live.applyEdits([edit], { renderRange: [-1, 2] }),
    /renderRange/
  );
  assert.throws(
    () => live.applyEdits([edit], { renderRange: [0, 1.5] }),
    /renderRange/
  );
  // a range past the end of the document clamps instead of throwing
  const update = live.applyEdits([edit], { renderRange: [0, 99] });
  assert.deepEqual([...update.lines.keys()], [0]);
  assert.equal(live.pendingTokenization, false);
  live.dispose();
});

void t.test('LiveTokenizer: dispose invalidates the instance', () => {
  const live = new LiveTokenizer({ lang: 'ts', theme: pierreDark, code: 'a' });
  live.dispose();
  assert.throws(() => live.lineCount, /disposed/);
  assert.throws(() => live.getLineText(0), /disposed/);
  assert.throws(() => live.applyEdits([]), /disposed/);
  assert.throws(() => live.reset(''), /disposed/);
  live.dispose(); // idempotent
});

void t.test('LiveTokenizer: line accessors check bounds', () => {
  const live = new LiveTokenizer({
    lang: 'ts',
    theme: pierreDark,
    code: 'a\nb',
  });
  for (const bad of [-1, 2, 1.5, Number.NaN, Infinity, -Infinity]) {
    assert.throws(() => live.getLineText(bad), RangeError);
    assert.throws(() => live.getLineLength(bad), RangeError);
    assert.throws(() => live.getLineRecords(bad), RangeError);
    assert.throws(() => live.getLineTokens(bad), RangeError);
  }
  live.dispose();
});

void t.test('live wasm: compaction keeps the document intact', () => {
  // Drive the native exports directly so the compaction trigger (freed
  // space above one mebibyte and above live) can be exercised and observed.
  interface RawLive {
    memory: WebAssembly.Memory;
    liveStage(len: number): number;
    liveInitDoc(ptr: number, len: number, lang: number): void;
    liveApplyEdits(ptr: number): void;
    liveRun(budget: number): number;
    liveLineCount(): number;
    liveLineByteLen(i: number): number;
    liveLineTextPtr(i: number): number;
    liveStats(k: number): number;
  }
  const env = { is_id_start: () => 1, is_id_continue: () => 1 };
  const raw = new WebAssembly.Instance(wasmModule, { env })
    .exports as unknown as RawLive;
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const lineText = (i: number) => {
    const bytes = new Uint8Array(raw.memory.buffer).subarray(
      raw.liveLineTextPtr(i),
      raw.liveLineTextPtr(i) + raw.liveLineByteLen(i)
    );
    return dec.decode(bytes);
  };
  // a ~2 MiB document whose initial block will be freed wholesale
  const doc = Array.from(
    { length: 20000 },
    (_, i) => `const value${i} = ${'"x"'.repeat(30)};`
  ).join('\n');
  const bytes = enc.encode(doc);
  const ptr = raw.liveStage(bytes.length);
  new Uint8Array(raw.memory.buffer).set(bytes, ptr);
  raw.liveInitDoc(ptr, bytes.length, LANGS.ts);
  raw.liveRun(0x7fffffff);
  // replace everything with three tiny lines; the freed text dwarfs live data
  const newText = enc.encode('let a = 1;\nlet b = 2;\nlet c = 3;');
  const staged = raw.liveStage(4 + 24 + newText.length);
  const dv = new DataView(raw.memory.buffer);
  dv.setUint32(staged, 1, true);
  dv.setUint32(staged + 4, 0, true);
  dv.setUint32(staged + 8, 0, true);
  dv.setUint32(staged + 12, 19999, true);
  dv.setUint32(staged + 16, raw.liveLineByteLen(19999), true);
  dv.setUint32(staged + 20, 4 + 24, true);
  dv.setUint32(staged + 24, newText.length, true);
  new Uint8Array(raw.memory.buffer).set(newText, staged + 4 + 24);
  raw.liveApplyEdits(staged);
  raw.liveRun(0x7fffffff);
  // freed space was reclaimed by the slide
  assert.equal(raw.liveStats(4), 0, 'free lists were reset by compaction');
  assert.ok(raw.liveStats(7) < 1 << 21, 'the heap end moved down');
  // the surviving document reads back correctly through moved blocks
  assert.equal(raw.liveLineCount(), 3);
  assert.deepEqual(
    [lineText(0), lineText(1), lineText(2)],
    ['let a = 1;', 'let b = 2;', 'let c = 3;']
  );
  // and the tokenizer still works after the slide
  const more = enc.encode('D');
  const staged2 = raw.liveStage(4 + 24 + more.length);
  const dv2 = new DataView(raw.memory.buffer);
  dv2.setUint32(staged2, 1, true);
  dv2.setUint32(staged2 + 4, 1, true);
  dv2.setUint32(staged2 + 8, 4, true);
  dv2.setUint32(staged2 + 12, 1, true);
  dv2.setUint32(staged2 + 16, 5, true);
  dv2.setUint32(staged2 + 20, 4 + 24, true);
  dv2.setUint32(staged2 + 24, more.length, true);
  new Uint8Array(raw.memory.buffer).set(more, staged2 + 4 + 24);
  raw.liveApplyEdits(staged2);
  raw.liveRun(0x7fffffff);
  assert.equal(lineText(1), 'let D = 2;');
});

void t.test(
  'LiveTokenizer: alternating same-line edits do not grow wasm memory',
  () => {
    const code = Array.from(
      { length: 50 },
      (_, i) => `const v${i} = ${i};`
    ).join('\n');
    const live = new LiveTokenizer({ lang: 'ts', theme: pierreDark, code });
    const texts = ['const v25 = 25;', 'const v25 = 12345678;'];
    // warm the allocator, then hold the footprint steady
    const internals = live as unknown as {
      getLineRecords(line: number): { data: Uint32Array };
    };
    let warmedBytes = 0;
    for (let i = 0; i < 10000; i++) {
      live.applyEdits([
        {
          range: {
            start: { line: 25, character: 0 },
            end: { line: 25, character: live.getLineLength(25) },
          },
          newText: texts[i & 1],
        },
      ]);
      const bytes = internals.getLineRecords(0).data.buffer.byteLength;
      if (i === 100) warmedBytes = bytes;
      if (i > 100) {
        assert.equal(bytes, warmedBytes, `memory grew at iteration ${i}`);
      }
    }
    live.dispose();
  }
);

void t.test(
  'live wasm: a shrunk staging block leaves only class-sized free blocks',
  () => {
    // The document initializer trims the staged block to the encoded length.
    // A tail that is not exactly a size-class size must stay attached: a free
    // list keyed by class hands blocks out at the class size, so a smaller
    // block parked there would overrun its neighbor on the next allocation.
    interface RawLive {
      memory: WebAssembly.Memory;
      freeHeads: WebAssembly.Global;
      liveStage(len: number): number;
      liveInitDoc(ptr: number, len: number, lang: number): void;
      liveRun(budget: number): number;
    }
    const env = { is_id_start: () => 1, is_id_continue: () => 1 };
    const raw = new WebAssembly.Instance(wasmModule, { env })
      .exports as unknown as RawLive;
    // mirror of $lvRoundSize: 8-byte steps to 64, quarter-power-of-two above
    const roundSize = (size: number): number => {
      if (size < 16) size = 16;
      if (size <= 64) return (size + 7) & -8;
      const p = 32 - Math.clz32(size - 1);
      if (p >= 17) return (size + 7) & -8;
      const quarter = 1 << (p - 2);
      return (size + quarter - 1) & -quarter;
    };
    const freeHeads = Number(raw.freeHeads.value);
    for (const [staged, used] of [
      [1000, 300],
      [4096, 100],
      [70000, 65000],
    ] as const) {
      const ptr = raw.liveStage(staged);
      const bytes = new TextEncoder().encode('a'.repeat(used - 1) + '\n');
      new Uint8Array(raw.memory.buffer).set(bytes, ptr);
      raw.liveInitDoc(ptr, used, LANGS.c);
      raw.liveRun(0x7fffffff);
      const dv = new DataView(raw.memory.buffer);
      for (let idx = 0; idx < 32; idx++) {
        let head = dv.getUint32(freeHeads + idx * 4, true);
        while (head !== 0) {
          const size = dv.getUint32(head, true) & -2;
          assert.equal(
            roundSize(size),
            size,
            `free block of ${size} bytes in class ${idx} after staging ${staged}/${used}`
          );
          head = dv.getUint32(head + 4, true);
        }
      }
    }
  }
);

void t.test(
  'live wasm: JavaScript state blobs stay small inside braces',
  () => {
    // The ecma lexers keep their cross-line state in globals and stacks, so
    // the lexer checkpoint region is all zero for them; the blob layout puts
    // it last so the trailing-zero trim drops it from every interned state.
    interface RawLive {
      memory: WebAssembly.Memory;
      liveStage(len: number): number;
      liveInitDoc(ptr: number, len: number, lang: number): void;
      liveRun(budget: number): number;
      liveStats(k: number): number;
    }
    const env = { is_id_start: () => 1, is_id_continue: () => 1 };
    const raw = new WebAssembly.Instance(wasmModule, { env })
      .exports as unknown as RawLive;
    const doc = Array.from(
      { length: 500 },
      (_, i) =>
        `function f${i}(a, b) {\n  if (a) {\n    return b + ${i};\n  }\n  return a;\n}\n`
    ).join('');
    const bytes = new TextEncoder().encode(doc);
    const ptr = raw.liveStage(bytes.length);
    new Uint8Array(raw.memory.buffer).set(bytes, ptr);
    raw.liveInitDoc(ptr, bytes.length, LANGS.js);
    raw.liveRun(0x7fffffff);
    const states = raw.liveStats(1);
    const stateBytes = raw.liveStats(2);
    assert.ok(states > 0);
    assert.ok(
      stateBytes / states < 400,
      `average blob ${stateBytes / states} bytes; the checkpoint region leaked in`
    );
  }
);

/** Join a line's token contents for the edit assertions below. */
const tokenLineText = (tokens: ThemedToken[]) =>
  tokens.map((token) => token.content).join('');

/** Replace one whole line through the batched edit API. */
const replaceLine = (live: LiveTokenizer, line: number, text: string) =>
  live.applyEdits([
    {
      range: {
        start: { line, character: 0 },
        end: { line, character: live.getLineLength(line) },
      },
      newText: text,
    },
  ]);

void t.test('LiveTokenizer: line updates and bracket-ignored ranges', () => {
  const live = new LiveTokenizer({
    lang: 'ts',
    theme: pierreDark,
    code: 'function f() {\n  return 1;\n}',
  });
  assert.equal(live.lineCount, 3);
  replaceLine(live, 1, '  return "a { b"; // c(d)');
  const updated = live.getLineTokens(1);
  assert.equal(tokenLineText(updated.tokens), '  return "a { b"; // c(d)');
  // offsets are line-relative
  assert.equal(updated.tokens[0].offset, 0);
  // the string and the comment are ignored ranges for bracket matching
  assert.deepEqual(updated.bracketIgnoredRanges, [
    [9, 16],
    [18, 25],
  ]);
  // unchanged lines agree with codeToTokens
  const line0 = live.getLineTokens(0);
  const direct = codeToTokens('function f() {\n  return "a { b"; // c(d)\n}', {
    lang: 'ts',
    theme: pierreDark,
  }).tokens[0];
  assert.deepEqual(line0.tokens, direct);
  assert.deepEqual(line0.bracketIgnoredRanges, []);
  live.dispose();
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
    assert.equal(live.getLineTokens(1).tokens[0].type, 2);
    // closing the template on line 0 flips line 1 out of the string
    const update = replaceLine(live, 0, 'const s = `abc`;');
    assert.equal(update.lineChanges.length, 1);
    assertMatchesFresh(
      live,
      'const s = `abc`;\nrest`;',
      'ts',
      'closed template'
    );
    live.dispose();
  }
);

void t.test('LiveTokenizer: structural edits move lines', () => {
  const live = new LiveTokenizer({ lang: 'ts', theme: pierreDark, code: 'a' });
  live.applyEdits([
    {
      range: {
        start: { line: 0, character: 1 },
        end: { line: 0, character: 1 },
      },
      newText: '\nlet b = 1',
    },
  ]);
  assert.equal(live.lineCount, 2);
  live.applyEdits([
    {
      range: {
        start: { line: 0, character: 0 },
        end: { line: 1, character: 0 },
      },
      newText: '',
    },
  ]);
  assert.equal(live.lineCount, 1);
  const { tokens } = live.getLineTokens(0);
  assert.equal(tokenLineText(tokens), 'let b = 1');
  live.dispose();
});

void t.test(
  'LiveTokenizer: line lengths are known before deferred work reaches a line',
  () => {
    const code = Array.from(
      { length: 200 },
      (_, i) => `let v${i} = ${i};`
    ).join('\n');
    const live = new LiveTokenizer({
      lang: 'ts',
      theme: pierreDark,
      code,
      renderRange: [0, 5],
    });
    assert.equal(live.pendingTokenization, true);
    assert.equal(live.getLineLength(150), live.getLineText(150).length);
    // an edit below the viewport validates against the real line length
    live.applyEdits(
      [
        {
          range: {
            start: { line: 150, character: 3 },
            end: { line: 150, character: 3 },
          },
          newText: 'X',
        },
      ],
      { renderRange: [0, 5] }
    );
    assert.equal(live.getLineText(150), 'letX v150 = 150;');
    // a freshly spliced line reports its length before it is tokenized
    live.applyEdits(
      [
        {
          range: {
            start: { line: 100, character: 0 },
            end: { line: 100, character: 0 },
          },
          newText: 'let another = 2;\nlet more = "é🙂";\n',
        },
      ],
      { renderRange: [0, 5] }
    );
    assert.equal(live.pendingTokenization, true);
    assert.equal(live.getLineLength(100), 'let another = 2;'.length);
    assert.equal(live.getLineLength(101), 'let more = "é🙂";'.length);
    live.applyEdits(
      [
        {
          range: {
            start: { line: 101, character: 4 },
            end: { line: 101, character: 4 },
          },
          newText: 'x',
        },
      ],
      { renderRange: [0, 5] }
    );
    live.flush();
    assert.equal(live.getLineText(101), 'let xmore = "é🙂";');
    assert.equal(live.getLineLength(101), 'let xmore = "é🙂";'.length);
    live.dispose();
  }
);

void t.test(
  'LiveTokenizer: mutating calls from the update delivery throw',
  () => {
    const code = Array.from({ length: 60 }, (_, i) => `let v${i} = ${i};`).join(
      '\n'
    );
    let seen: string | undefined;
    const live = new LiveTokenizer({
      lang: 'ts',
      theme: pierreDark,
      code,
      onDeferTokenize: () => {
        try {
          live.applyEdits([
            {
              range: {
                start: { line: 40, character: 0 },
                end: { line: 40, character: 0 },
              },
              newText: 'a\nb\nc\n',
            },
          ]);
        } catch (e) {
          seen = String(e);
        }
      },
    });
    const update = live.applyEdits(
      [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
          newText: '`',
        },
      ],
      { renderRange: [10, 12] }
    );
    assert.match(seen ?? '', /cannot be called from onDeferTokenize/);
    // the outer update still describes its own edit
    assert.equal(update.lineCount, 60);
    assert.equal(update.previousLineCount, 60);
    live.flush();
    live.dispose();
  }
);

void t.test(
  'LiveTokenizer: update tuples use the theme foreground for unstyled runs',
  () => {
    const live = new LiveTokenizer({
      lang: 'markdown',
      theme: pierreDark,
      code: 'some *text* and `code` here',
    });
    try {
      const update = live.applyEdits(
        [
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 4 },
            },
            newText: 'more',
          },
        ],
        { renderRange: [0, 1] }
      );
      assert.deepEqual(
        update.lines.get(0),
        live
          .getLineTokens(0)
          .tokens.map((token) => [token.offset, token.color, token.content])
      );
      assert.equal(
        update.lines.get(0)?.[0][1],
        pierreDark.style['editor.foreground']
      );
    } finally {
      live.dispose();
    }
  }
);

void t.test(
  'LiveTokenizer: no-op edits resume a paused deferred tail',
  async () => {
    for (const edits of [
      [],
      [
        {
          range: {
            start: { line: 5, character: 0 },
            end: { line: 5, character: 3 },
          },
          newText: 'let',
        },
      ],
    ]) {
      const code = Array.from(
        { length: 200 },
        (_, i) => `let v${i} = ${i};`
      ).join('\n');
      let deliveries = 0;
      const live = new LiveTokenizer({
        lang: 'ts',
        theme: pierreDark,
        code,
        onDeferTokenize: () => {
          deliveries++;
        },
      });
      try {
        live.applyEdits(
          [
            {
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 0 },
              },
              newText: '/*',
            },
          ],
          { renderRange: [0, 10] }
        );
        live.pause();
        assert.ok(live.pendingTokenization);
        const revision = live.revision;
        const before = deliveries;
        live.applyEdits(edits, { renderRange: [0, 10] });
        assert.equal(live.revision, revision);
        const deadline = Date.now() + 2000;
        while (live.pendingTokenization && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        assert.equal(live.pendingTokenization, false);
        assert.ok(deliveries > before);
        assertMatchesFresh(live, '/*' + code, 'ts', 'no-op resumed document');
      } finally {
        live.dispose();
      }
    }
  }
);

void t.test(
  'LiveTokenizer: heredoc closers after a lone CR agree across delivery paths',
  () => {
    // the stream resumer used to skip to the next LF while looking for the
    // closing delimiter, so a closer after a lone CR inside a line-fed chunk
    // was missed and the heredoc swallowed the rest of the document
    for (const [lang, code] of [
      ['bash', 'cat <<EOF\nbody\rEOF\necho done\n'],
      ['ruby', 'x = <<~EOS\n  a\r  b\rEOS\ny = 1\n'],
    ] as const) {
      const whole = assertLineFedParity(lang, code, 'CR before the closer');
      // the line after the heredoc is code again, not string
      const after = whole[2][0];
      assert.notEqual(after.color, whole[1][0].color, `${lang}: closer ends`);
      const live = new LiveTokenizer({ lang, theme: pierreDark, code });
      assertMatchesFresh(live, code, lang, `${lang} CR heredoc`);
      assertMatchesLineStream(live, code, lang, `${lang} CR heredoc`);
      live.dispose();
    }
  }
);

void t.test(
  'LiveTokenizer: over-long lines use the theme foreground on every path',
  () => {
    // update.lines and onDeferTokenize tuples must carry the same color
    // getLineTokens reports for a line past tokenizeMaxLineLength
    const long = `const x = "${'a'.repeat(1188)}";`;
    assert.equal(long.length, 1201);
    const code = `${long}\nlet y = 1;\nlet z = 2;\n`;
    const deferred: Map<number, HighlightedToken[]>[] = [];
    const live = new LiveTokenizer({
      lang: 'ts',
      theme: pierreDark,
      code,
      tokenizeMaxLineLength: 1000,
      renderRange: [0, 0],
      onDeferTokenize: (lines) => deferred.push(lines),
    });
    try {
      live.flush();
      const fg = themeColor('foreground');
      assert.ok(fg !== null);
      const viaDefer = deferred.find((lines) => lines.has(0))?.get(0);
      assert.deepEqual(viaDefer, [[0, fg, long]], 'onDeferTokenize tuple');
      const viaUpdate = live.reset(code, { renderRange: [0, 1] }).lines.get(0);
      assert.deepEqual(viaUpdate, [[0, fg, long]], 'update.lines tuple');
      const { tokens } = live.getLineTokens(0);
      assert.equal(tokens.length, 1);
      assert.equal(tokens[0].color, fg, 'getLineTokens color');
      // a line under the limit keeps its syntax colors in the tuples
      const short = live.reset(code, { renderRange: [1, 2] }).lines.get(1);
      assert.ok(short !== undefined && short.length > 1);
    } finally {
      live.dispose();
    }
  }
);
