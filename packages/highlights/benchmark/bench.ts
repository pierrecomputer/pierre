import { readFileSync } from 'node:fs';
import { arch, cpus, totalmem, type } from 'node:os';
import type { Language } from 'tree-sitter-highlight';

import { init, StreamTokenizer } from '../lib/index';
import { optimizeWasm, transformWat, wat2wasm } from '../scripts/build';
import pierreDark from '../themes/pierre-dark.json' with { type: 'json' };

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
  const termW = process.stdout.columns ?? Infinity;
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

function runBench<T>(
  fn: (arg: T) => unknown,
  arg: T,
  budget = 1500,
  iters = 2000
): { median: number; iters: number } {
  const first = (() => {
    const t = performance.now();
    fn(arg);
    return performance.now() - t;
  })();
  // Shorten warmup for slow contenders to cap runtime.
  const warmup = first > 200 ? 1 : 5;
  for (let i = 0; i < warmup; i++) fn(arg);
  const samples = [];
  const budgetEnd = performance.now() + budget;
  while (
    (samples.length < 3 || performance.now() < budgetEnd) &&
    samples.length < iters
  ) {
    const start = performance.now();
    fn(arg);
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return {
    median: samples[Math.floor(samples.length / 2)],
    iters: samples.length,
  };
}

interface Contender {
  name: string;
  html?: boolean;
  /** The main benchmark passes the fixture as UTF-8 bytes instead of a string. */
  bytes?: boolean;
  fn: (src: string | Uint8Array, lang: FixtureLang) => unknown;
  tokens?: (src: string, lang: FixtureLang) => unknown;
  hast?: (src: string, lang: FixtureLang) => unknown;
  stream?: (chunks: string[], lang: FixtureLang) => number;
}

async function loadContenders(): Promise<Contender[]> {
  const contenders: Contender[] = [];

  contenders.push({
    name: 'highlights',
    html: true,
    fn: (src, lang) =>
      dec.decode(highlights.codeToHtml(src, { lang, theme: pierreDark })),
    tokens: (src, lang) =>
      highlights.codeToTokens(src, { lang, theme: pierreDark }),
    stream: (chunks, lang) => {
      const stream = new StreamTokenizer({ lang, theme: pierreDark });
      let tokenCount = 0;
      for (const chunk of chunks) {
        for (const line of stream.pushCode(chunk)) tokenCount += line.length;
      }
      for (const line of stream.end()) tokenCount += line.length;
      return tokenCount;
    },
  });
  contenders.push({
    name: 'highlights (bytes io)',
    html: true,
    bytes: true,
    fn: (bytes, lang) =>
      highlights.codeToHtml(bytes, { lang, theme: pierreDark }),
  });

  try {
    const { createHighlighter } = await import('shiki');
    const langs: FixtureLang[] = ['ts', 'jsonc', 'css', 'html'];
    const hl = await createHighlighter({ themes: ['github-dark'], langs });
    contenders.push({
      name: 'shiki',
      html: true,
      fn: (src, lang) =>
        hl.codeToHtml(src as string, { lang, theme: 'github-dark' }),
      tokens: (src, lang) =>
        hl.codeToTokens(src, { lang, theme: 'github-dark' }),
      hast: (src, lang) => hl.codeToHast(src, { lang, theme: 'github-dark' }),
      stream: (chunks, lang) => {
        let grammarState: ReturnType<typeof hl.getLastGrammarState> | undefined;
        let tail = '';
        let tokenCount = 0;
        for (const chunk of chunks) {
          const lines = (tail + chunk).split('\n');
          tail = lines.pop() ?? '';
          for (const line of lines) {
            const result = hl.codeToTokens(line, {
              lang,
              theme: 'github-dark',
              grammarState,
            });
            grammarState = result.grammarState;
            tokenCount += result.tokens[0].length;
          }
        }
        const result = hl.codeToTokens(tail, {
          lang,
          theme: 'github-dark',
          grammarState,
        });
        return tokenCount + result.tokens[0].length;
      },
    });
  } catch {
    console.log('(shiki not installed, skipping)');
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
      name: 'tree-sitter-highlight',
      html: true,
      fn: (src, lang) => treeSitter.highlight(src as string, langs[lang]),
    });
  } catch (e) {
    console.log(
      `(tree-sitter-highlight not installed, skipping: ${(e as Error).message})`
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
      const lines = highlights.codeToTokens(input, { lang, theme: pierreDark })
        .tokens.length;
      const highlightsResult = runBench(
        (src: string) => highlightsFn(src, lang),
        input
      );
      const shikiResult = runBench((src: string) => shikiFn(src, lang), input);
      rows.push([
        name,
        String(lines),
        us(highlightsResult.median),
        fmt(mb / (highlightsResult.median / 1000)) + ' MB/s',
        us(shikiResult.median),
        baselineLabel(highlightsResult.median / shikiResult.median),
      ]);
    }
    console.log(`${title} (TypeScript):`);
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

  const rows = [];
  for (const { name, lang, input } of STREAM_FIXTURES) {
    const chunks: string[] = [];
    for (let at = 0; at < input.length; at += 4096) {
      chunks.push(input.slice(at, at + 4096));
    }
    const mb = enc.encode(input).length / 1024 / 1024;
    const highlightsResult = runBench((parts: string[]) => {
      highlightsStream(parts, lang);
    }, chunks);
    const shikiResult = runBench((parts: string[]) => {
      shikiStream(parts, lang);
    }, chunks);
    rows.push([
      name,
      String(input.split('\n').length),
      String(chunks.length),
      us(highlightsResult.median),
      fmt(mb / (highlightsResult.median / 1000)) + ' MB/s',
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

const BASELINE = 'shiki';
const contenders = await loadContenders();

interface BenchResult {
  name: string;
  html?: boolean;
  median?: number;
  iters?: number;
  error?: string;
}

if (streamOnly) {
  benchmarkStream(contenders);
} else if (tokensOnly) {
  benchmarkTokens(contenders);
} else {
  for (const { name, lang, input } of FIXTURES) {
    const inputBytes = enc.encode(input);
    const mb = inputBytes.length / 1024 / 1024;

    const results: BenchResult[] = [];
    for (const { name: cname, fn, bytes: wantsBytes, html } of contenders) {
      try {
        results.push({
          name: cname,
          html,
          ...runBench(
            (arg: string | Uint8Array) => fn(arg, lang),
            wantsBytes === true ? inputBytes : input
          ),
        });
      } catch (e) {
        results.push({ name: cname, error: (e as Error).message });
      }
    }
    const base =
      results.find((r) => r.name === BASELINE && r.error == null) ??
      results.find((r) => r.error == null);
    if (base?.median == null) continue;
    const baseMedian = base.median;
    results.sort((a, b) => (b.median ?? Infinity) - (a.median ?? Infinity));

    console.log(
      `input: ${name} (${(inputBytes.length / 1024).toFixed(0)} KB, lang=${lang})`
    );
    const cols = [
      { title: 'tool' },
      { title: 'output', hide: 1 },
      { title: 'iters', align: 'right' as const, hide: 2 },
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
          `failed: ${(r.error ?? 'no samples').slice(0, 40)}`,
        ];
      }
      const vs =
        r === base ? '1.00× (baseline)' : baselineLabel(r.median / baseMedian);
      return [
        r.name,
        r.html != null ? 'html' : 'tree',
        String(r.iters),
        us(r.median),
        fmt(mb / (r.median / 1000)) + ' MB/s',
        vs,
      ];
    });
    printTable(cols, rows);
    console.log();
  }
}
