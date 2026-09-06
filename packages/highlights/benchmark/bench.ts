import assert from 'node:assert/strict';
import { openSync, readFileSync } from 'node:fs';
import { arch, cpus, totalmem, type } from 'node:os';
import { WriteStream } from 'node:tty';
import type { Language } from 'tree-sitter-highlight';

import { init, StreamTokenizer, type ThemedToken } from '../lib/index';
import { optimizeWasm, transformWat, wat2wasm } from '../scripts/build';
import pierreDark from '../themes/pierre-dark.json' with { type: 'json' };
import { measure, type Measurement } from './measure';

const enc = new TextEncoder();
const dec = new TextDecoder();

const fmt = (n: number, unit = '') =>
  n.toFixed(n >= 100 ? 0 : n >= 10 ? 1 : 2) + unit;
const us = (ms: number) => (ms >= 10 ? fmt(ms) + 'ms' : fmt(ms * 1000) + 'µs');
const baselineLabel = (rel: number) =>
  rel >= 1 ? `${fmt(rel)}× slower` : `${fmt(1 / rel)}× faster`;
const dim = (s: string) => `\x1b[90m${s}\x1b[0m`;
const tokensOnly = process.argv.includes('--tokens');
const streamOnly = process.argv.includes('--stream');

/** The languages the benchmark fixtures cover in every contender. */
type FixtureLang = 'ts' | 'jsonc' | 'css' | 'html';

interface Fixture {
  name: string;
  lang: FixtureLang;
  input: string;
}

const FIXTURES: Fixture[] = [
  { name: 'tiny.css.txt', lang: 'css', input: loadFixture('tiny.css') },
  { name: 'tiny.html.txt', lang: 'html', input: loadFixture('tiny.html') },
  { name: 'tiny.jsonc.txt', lang: 'jsonc', input: loadFixture('tiny.jsonc') },
  { name: 'tiny.ts.txt', lang: 'ts', input: loadFixture('tiny.ts') },

  { name: 'small.css.txt', lang: 'css', input: loadFixture('small.css') },
  { name: 'small.html.txt', lang: 'html', input: loadFixture('small.html') },
  { name: 'small.jsonc.txt', lang: 'jsonc', input: loadFixture('small.jsonc') },
  { name: 'small.ts.txt', lang: 'ts', input: loadFixture('small.ts') },

  { name: 'large.css.txt', lang: 'css', input: loadFixture('large.css') },
  { name: 'large.html.txt', lang: 'html', input: loadFixture('large.html') },
  { name: 'large.jsonc.txt', lang: 'jsonc', input: loadFixture('large.jsonc') },
  { name: 'large.ts.txt', lang: 'ts', input: loadFixture('large.ts') },
];
const TOKEN_FIXTURES: Fixture[] = [
  ...FIXTURES.filter((f) => f.lang === 'ts'),
  {
    name: 'unicode-lines.ts',
    lang: 'ts',
    input: 'const greeting = "日本語 🎈"; // naïve résumé\n'.repeat(10_000),
  },
];
const STREAM_FIXTURES: Fixture[] = [
  ...FIXTURES,
  TOKEN_FIXTURES[TOKEN_FIXTURES.length - 1],
];

function loadFixture(name: string): string {
  return readFileSync(
    new URL(`./fixtures/${name}.txt`, import.meta.url),
    'utf8'
  );
}

interface Column {
  title: string;
  align?: 'right';
  /** Drop order when the table exceeds the terminal width (lowest first). */
  hide?: number;
}

function printTable(cols: Column[], rows: string[][]) {
  // Moon pipes stdout; COLUMNS can lag behind the actual terminal size.
  let columns = process.stdout.columns ?? Number(process.env.COLUMNS);
  if (process.stdout.isTTY !== true) {
    try {
      const terminal = new WriteStream(openSync('/dev/tty', 'w'));
      try {
        columns = terminal.getWindowSize()[0];
      } finally {
        terminal.destroy();
      }
    } catch {
      // Detached runs use the supplied COLUMNS value.
    }
  }
  const target = process.env.MOON_TARGET;
  const termW =
    (columns > 0 ? columns : Infinity) -
    (target == null ? 0 : target.length + 3);
  const colWidth = (c: Column, i: number) =>
    Math.max(c.title.length, ...rows.map((r) => (r[i] ?? '').length));
  const tableW = (idxs: number[]) =>
    idxs.reduce((s, i) => s + colWidth(cols[i], i), 0) + 1 + 3 * idxs.length;

  let keep = cols.map((_, i) => i);
  const droppable = cols
    .map((c, i) => ({ i, hide: c.hide }))
    .filter((c): c is { i: number; hide: number } => c.hide != null)
    .sort((a, b) => a.hide - b.hide);
  for (const { i } of droppable) {
    if (tableW(keep) <= termW) break;
    keep = keep.filter((j) => j !== i);
  }

  const useBox = tableW(keep) <= termW;
  const widths = keep.map((i) => colWidth(cols[i], i));
  const cell = (s: string, j: number) =>
    cols[keep[j]].align === 'right'
      ? s.padStart(widths[j])
      : s.padEnd(widths[j]);
  const pick = (cells: string[]) => keep.map((i) => cells[i] ?? '');

  if (useBox) {
    const line = (l: string, m: string, r: string) =>
      l + widths.map((w) => '─'.repeat(w + 2)).join(m) + r;
    const row = (cells: string[]) =>
      '│ ' + pick(cells).map(cell).join(' │ ') + ' │';
    console.log(line('┌', '┬', '┐'));
    console.log(row(cols.map((c) => c.title)));
    console.log(line('├', '┼', '┤'));
    for (const r of rows) console.log(row(r));
    console.log(line('└', '┴', '┘'));
  } else {
    const row = (cells: string[]) => pick(cells).map(cell).join('  ');
    console.log(row(cols.map((c) => c.title)));
    for (const r of rows) console.log(row(r));
  }
}

interface Contender {
  name: string;
  /** The main benchmark passes the fixture as UTF-8 bytes instead of a string. */
  bytes?: boolean;
  langs?: readonly FixtureLang[];
  fn: (src: string | Uint8Array, lang: FixtureLang) => unknown;
  tokens?: (src: string, lang: FixtureLang) => { tokens: ThemedToken[][] };
  hast?: (src: string, lang: FixtureLang) => unknown;
  stream?: (chunks: string[], lang: FixtureLang) => ThemedToken[][];
}

async function loadContenders(): Promise<Contender[]> {
  const contenders: Contender[] = [];

  contenders.push({
    name: 'highlights',
    fn: (src, lang) =>
      dec.decode(highlights.codeToHtml(src, { lang, theme: pierreDark })),
    tokens: (src, lang) =>
      highlights.codeToTokens(src, { lang, theme: pierreDark }),
    stream: (chunks, lang) => {
      const stream = new StreamTokenizer({ lang, theme: pierreDark });
      const tokens: ThemedToken[][] = [];
      for (const chunk of chunks) {
        tokens.push(...stream.pushCode(chunk));
      }
      tokens.push(...stream.end());
      return tokens;
    },
  });
  contenders.push({
    name: 'highlights (bytes)',
    bytes: true,
    fn: (bytes, lang) =>
      highlights.codeToHtml(bytes, { lang, theme: pierreDark }),
  });

  try {
    const { createHighlighter } = await import('shiki');
    const langs: FixtureLang[] = ['ts', 'jsonc', 'css', 'html'];
    const hl = await createHighlighter({ themes: ['github-dark'], langs });
    // Disable early exits so long lines receive complete tokenization too.
    const options = {
      theme: 'github-dark',
      tokenizeMaxLineLength: 0,
      tokenizeTimeLimit: 0,
    };
    contenders.push({
      name: 'shiki',
      fn: (src, lang) => hl.codeToHtml(src as string, { ...options, lang }),
      tokens: (src, lang) => hl.codeToTokens(src, { ...options, lang }),
      hast: (src, lang) => hl.codeToHast(src, { ...options, lang }),
      stream: (chunks, lang) => {
        let grammarState: ReturnType<typeof hl.getLastGrammarState> | undefined;
        let tail = '';
        let offset = 0;
        const tokens: ThemedToken[][] = [];
        for (const chunk of chunks) {
          tail += chunk;
          const end = tail.lastIndexOf('\n') + 1;
          if (end === 0) continue;
          // Process the same completed lines as StreamTokenizer.pushCode.
          // Omit the final separator so grammar state doesn't advance an
          // extra empty line before the next chunk.
          const contentEnd = tail[end - 2] === '\r' ? end - 2 : end - 1;
          const result = hl.codeToTokens(tail.slice(0, contentEnd), {
            ...options,
            lang,
            grammarState,
          });
          tail = tail.slice(end);
          grammarState = result.grammarState;
          for (const line of result.tokens) {
            for (const token of line) token.offset += offset;
          }
          tokens.push(...result.tokens);
          offset += end;
        }
        const result = hl.codeToTokens(tail, {
          lang,
          ...options,
          grammarState,
        });
        for (const line of result.tokens) {
          for (const token of line) token.offset += offset;
        }
        tokens.push(...result.tokens);
        return tokens;
      },
    });
  } catch (e) {
    console.log(`(shiki unavailable, skipping: ${(e as Error).message})`);
  }

  try {
    const treeSitter = await import('tree-sitter-highlight');
    // tree-sitter-highlight declares an ambient const enum, which cannot be
    // read as values under isolatedModules; inline Language.TS/JSON/CSS/HTML.
    const langs: Record<FixtureLang, Language> = {
      ts: 2,
      jsonc: 4,
      css: 6,
      html: 7,
    };
    contenders.push({
      name: 'tree-sitter (NAPI)',
      // Its JSON grammar handles comments, but HTML output has no token spans.
      langs: ['ts', 'jsonc', 'css'],
      fn: (src, lang) => treeSitter.highlight(src as string, langs[lang]),
    });
  } catch (e) {
    console.log(
      `(tree-sitter syntax unavailable, skipping: ${(e as Error).message})`
    );
  }

  return contenders;
}

// Compare highlights's complete codeToTokens and codeToHast APIs against
// Shiki's, using Pierre Dark for highlights and GitHub Dark for Shiki.
function benchmarkTokens(contenders: Contender[]) {
  const shiki = contenders.find((c) => c.name === 'shiki');
  const shikiTokens = shiki?.tokens;
  const shikiHast = shiki?.hast;
  if (shikiTokens == null || shikiHast == null) {
    console.log('shiki not installed; tokens benchmark skipped');
    return;
  }

  const apis = [
    {
      title: 'codeToTokens',
      highlightsFn: (src: string, lang: FixtureLang) =>
        highlights.codeToTokens(src, { lang, theme: pierreDark }),
      shikiFn: shikiTokens,
    },
    {
      title: 'codeToHast',
      highlightsFn: (src: string, lang: FixtureLang) =>
        highlights.codeToHast(src, { lang, theme: pierreDark }),
      shikiFn: shikiHast,
    },
  ];
  for (const { title, highlightsFn, shikiFn } of apis) {
    const rows = [];
    for (const { name, lang, input } of TOKEN_FIXTURES) {
      const mb = enc.encode(input).length / 1024 / 1024;
      const lines = input.split('\n').length;
      const [highlightsResult, shikiResult] = measure([
        () => highlightsFn(input, lang),
        () => shikiFn(input, lang),
      ]);
      rows.push([
        name,
        String(lines),
        us(highlightsResult.median),
        fmt(mb / (highlightsResult.median / 1000)) + ' MiB/s',
        us(shikiResult.median),
        baselineLabel(highlightsResult.median / shikiResult.median),
      ]);
    }
    console.log(title + ':');
    printTable(
      [
        { title: 'input' },
        { title: 'lines', align: 'right', hide: 1 },
        { title: 'highlights', align: 'right' },
        { title: 'throughput', align: 'right', hide: 2 },
        { title: 'shiki', align: 'right' },
        { title: 'vs shiki' },
      ],
      rows
    );
    console.log();
  }
}

// Compare fresh streaming tokenizers over Diffs' 4,096-character batches.
function benchmarkStream(contenders: Contender[]) {
  const highlightsStream = contenders.find(
    (c) => c.name === 'highlights'
  )?.stream;
  const shikiStream = contenders.find((c) => c.name === 'shiki')?.stream;
  if (highlightsStream == null || shikiStream == null) {
    console.log('shiki not installed; stream benchmark skipped');
    return;
  }
  const streams: NonNullable<Contender['stream']>[] = [
    highlightsStream,
    shikiStream,
  ];

  // Validate every fixture before starting the slower timing runs.
  const fixtures = STREAM_FIXTURES.map(({ name, lang, input }) => {
    const chunks: string[] = [];
    for (let at = 0; at < input.length; at += 4096) {
      chunks.push(input.slice(at, at + 4096));
    }
    const lines = input.split(/\r?\n/);
    for (const stream of streams) {
      const tokens = stream(chunks, lang);
      assert.equal(tokens.length, lines.length, `${name}: streamed line count`);
      for (const [i, line] of tokens.entries()) {
        assert.ok(
          line.map((token) => token.content).join('') === lines[i],
          `${name}: streamed content on line ${i}`
        );
        for (const token of line) {
          assert.ok(
            input.slice(token.offset, token.offset + token.content.length) ===
              token.content,
            `${name}: streamed offset on line ${i}`
          );
        }
      }
    }
    return { name, lang, input, chunks };
  });
  const rows = [];
  for (const { name, lang, input, chunks } of fixtures) {
    const mb = enc.encode(input).length / 1024 / 1024;
    const [highlightsResult, shikiResult] = measure([
      () => highlightsStream(chunks, lang),
      () => shikiStream(chunks, lang),
    ]);
    rows.push([
      name,
      String(input.split('\n').length),
      String(chunks.length),
      us(highlightsResult.median),
      fmt(mb / (highlightsResult.median / 1000)) + ' MiB/s',
      us(shikiResult.median),
      baselineLabel(highlightsResult.median / shikiResult.median),
    ]);
  }
  console.log('StreamTokenizer (4,096-character chunks):');
  printTable(
    [
      { title: 'input' },
      { title: 'lines', align: 'right', hide: 1 },
      { title: 'chunks', align: 'right', hide: 2 },
      { title: 'highlights', align: 'right' },
      { title: 'throughput', align: 'right', hide: 3 },
      { title: 'shiki', align: 'right' },
      { title: 'vs shiki' },
    ],
    rows
  );
}

const t0 = performance.now();
const { code } = transformWat(
  new URL('../src/highlights.wat', import.meta.url)
);
// Use the publish build settings so results match the shipped Wasm.
const wasmBytes = optimizeWasm(wat2wasm('highlights.wat', code));
const highlights = init(new WebAssembly.Module(wasmBytes));
console.log(
  dim(
    `highlights.wasm: ${wasmBytes.length} bytes (-O3), compiled in ${Math.ceil(performance.now() - t0)}ms`
  )
);

const cpu = cpus()[0]?.model ?? arch();
const machine = `${cpu} (${cpus().length} cores), ${Math.round(
  totalmem() / 1024 ** 3
)} GB RAM, ${type()} ${arch()}, ${
  process.versions.bun != null
    ? `bun ${process.versions.bun}`
    : `node ${process.versions.node}`
}`;
console.log(dim(machine + '\n'));
console.log(
  dim(
    '200 ms warmup; ≥1.5 s timed per case; rotating batches; median batch mean.\n'
  )
);

const BASELINE = 'shiki';
const contenders = await loadContenders();

interface BenchResult extends Partial<Measurement> {
  name: string;
  bytes?: boolean;
  error?: string;
}

if (streamOnly) {
  benchmarkStream(contenders);
} else if (tokensOnly) {
  benchmarkTokens(contenders);
} else {
  const order = [
    'highlights (bytes)',
    'highlights',
    'tree-sitter (NAPI)',
    'shiki',
  ];
  for (const { name, lang, input } of FIXTURES) {
    const inputBytes = enc.encode(input);
    const mb = inputBytes.length / 1024 / 1024;

    const results: BenchResult[] = [];
    const cases: (() => unknown)[] = [];
    for (const { name: cname, fn, bytes: wantsBytes, langs } of contenders) {
      if (langs != null && !langs.includes(lang)) {
        console.log(
          dim(`${cname}: ${lang} excluded (incomplete language support)`)
        );
        continue;
      }
      try {
        const run = () => fn(wantsBytes === true ? inputBytes : input, lang);
        run();
        cases.push(run);
        results.push({
          name: cname,
          bytes: wantsBytes,
        });
      } catch (e) {
        results.push({ name: cname, error: (e as Error).message });
      }
    }
    const measurements = measure(cases);
    let index = 0;
    for (const result of results) {
      if (result.error == null) Object.assign(result, measurements[index++]);
    }
    const base =
      results.find((r) => r.name === BASELINE && r.median != null) ??
      results.find((r) => r.bytes !== true && r.median != null);
    if (base?.median == null) continue;
    const baseMedian = base.median;
    results.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));

    console.log(
      `input: ${name} (${(inputBytes.length / 1024).toFixed(0)} KiB, lang=${lang})`
    );
    const cols = [
      { title: 'tool' },
      { title: 'output', hide: 1 },
      { title: 'iters', align: 'right' as const, hide: 2 },
      { title: 'samples', align: 'right' as const, hide: 2 },
      { title: 'median', align: 'right' as const },
      { title: 'throughput', align: 'right' as const, hide: 3 },
      { title: `vs ${base.name}`, hide: 4 },
    ];
    const rows = results.map((r) => {
      if (r.error != null || r.median == null) {
        return [
          r.name,
          '',
          '—',
          '—',
          '—',
          '—',
          `failed: ${(r.error ?? 'no samples').slice(0, 40)}`,
        ];
      }
      const vs =
        r.bytes === true
          ? 'different I/O'
          : r === base
            ? '1.00× (baseline)'
            : baselineLabel(r.median / baseMedian);
      return [
        r.name,
        r.bytes === true ? 'HTML bytes' : 'HTML string',
        String(r.iterations),
        String(r.samples),
        us(r.median),
        fmt(mb / (r.median / 1000)) + ' MiB/s',
        vs,
      ];
    });
    printTable(cols, rows);
    console.log();
  }
}
