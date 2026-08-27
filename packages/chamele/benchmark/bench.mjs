#!/usr/bin/env node

import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { arch, cpus, totalmem, type } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import { init } from '../lib/index.mjs';
import { optimizeWasm, transformWat, wat2wasm } from '../scripts/build.mjs';
import pierreDark from '../themes/pierre-dark.json' with { type: 'json' };

const enc = new TextEncoder();
const dec = new TextDecoder();

const fmt = (n, unit = '') => n.toFixed(n >= 100 ? 0 : n >= 10 ? 1 : 2) + unit;
const us = (ms) => (ms >= 10 ? fmt(ms) + 'ms' : fmt(ms * 1000) + 'µs');
const kb = (bytes) =>
  bytes >= 1024 * 1024
    ? fmt(bytes / 1024 / 1024) + ' MB'
    : fmt(bytes / 1024) + ' KB';
const baselineLabel = (rel) =>
  rel >= 1 ? `${fmt(rel)}× slower` : `${fmt(1 / rel)}× faster`;
const dim = (s) => (process.stdout.isTTY ? `\x1b[90m${s}\x1b[0m` : s);

const FIXTURES = [
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

function loadFixture(name) {
  return readFileSync(
    new URL(`./fixtures/${name}.txt`, import.meta.url),
    'utf8'
  );
}

function printTable(cols, rows) {
  const termW = process.stdout.columns || Infinity;
  const colWidth = (c, i) =>
    Math.max(c.title.length, ...rows.map((r) => (r[i] ?? '').length));
  const tableW = (idxs) =>
    idxs.reduce((s, i) => s + colWidth(cols[i], i), 0) + 1 + 3 * idxs.length;

  let keep = cols.map((_, i) => i);
  const droppable = cols
    .map((c, i) => ({ i, hide: c.hide }))
    .filter((c) => c.hide != null)
    .sort((a, b) => a.hide - b.hide);
  for (const { i } of droppable) {
    if (tableW(keep) <= termW) break;
    keep = keep.filter((j) => j !== i);
  }

  const useBox = tableW(keep) <= termW;
  const widths = keep.map((i) => colWidth(cols[i], i));
  const cell = (s, j) =>
    cols[keep[j]].align === 'right'
      ? s.padStart(widths[j])
      : s.padEnd(widths[j]);
  const pick = (cells) => keep.map((i) => cells[i] ?? '');

  if (useBox) {
    const line = (l, m, r) =>
      l + widths.map((w) => '─'.repeat(w + 2)).join(m) + r;
    const row = (cells) => '│ ' + pick(cells).map(cell).join(' │ ') + ' │';
    console.log(line('┌', '┬', '┐'));
    console.log(row(cols.map((c) => c.title)));
    console.log(line('├', '┼', '┤'));
    for (const r of rows) console.log(row(r));
    console.log(line('└', '┴', '┘'));
  } else {
    const row = (cells) => pick(cells).map(cell).join('  ');
    console.log(row(cols.map((c) => c.title)));
    for (const r of rows) console.log(row(r));
  }
}

function runBench(fn, arg, budget = 1500, iters = 2000) {
  const first = (() => {
    const t = performance.now();
    fn(arg);
    return performance.now() - t;
  })();
  // slow contenders get a shorter warmup so the whole run stays bounded
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

async function loadContenders() {
  const contenders = [];

  contenders.push({
    name: 'chamele',
    html: true,
    fn: (src, lang) =>
      dec.decode(chamele.codeToHtml(src, { lang, theme: pierreDark })),
  });
  contenders.push({
    name: 'chamele (bytes io)',
    html: true,
    bytes: true,
    fn: (bytes, lang) => chamele.codeToHtml(bytes, { lang, theme: pierreDark }),
  });

  try {
    const { createHighlighter } = await import('shiki');
    const langs = ['ts', 'jsonc', 'css', 'html'];
    const hl = await createHighlighter({ themes: ['github-dark'], langs });
    contenders.push({
      name: 'shiki',
      html: true,
      fn: (src, lang) => hl.codeToHtml(src, { lang, theme: 'github-dark' }),
    });
  } catch {
    console.log('(shiki not installed, skipping)');
  }

  try {
    const treeSitter = (await import('tree-sitter-highlight')).default;
    const langs = {
      ts: treeSitter.Language.TS,
      jsonc: treeSitter.Language.JSON,
      css: treeSitter.Language.CSS,
      html: treeSitter.Language.HTML,
    };
    contenders.push({
      name: 'tree-sitter-highlight',
      html: true,
      fn: (src, lang) => treeSitter.highlight(src, langs[lang]),
    });
  } catch (e) {
    console.log(
      `(tree-sitter-highlight not installed, skipping: ${e.message})`
    );
  }

  return contenders;
}

function dirSize(path) {
  let total = 0;
  const walk = (p) => {
    for (const entry of readdirSync(p, { withFileTypes: true })) {
      const full = join(p, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) total += statSync(full).size;
    }
  };
  walk(path);
  return total;
}

function installedSize(...pkgs) {
  let total = 0;
  let found = 0;
  for (const pkg of pkgs) {
    // direct deps only: pnpm does not hoist transitive ones to the root
    try {
      total += dirSize(
        realpathSync(
          new URL(`../node_modules/${pkg}`, import.meta.url).pathname
        )
      );
      found += 1;
    } catch {}
  }
  return found ? total : null;
}

function sizeRows(wasmBytes) {
  const glueFiles = [
    'lib/index.mjs',
    'lib/theme.mjs',
    'lib/token-types.mjs',
    'lib/browser.mjs',
    'themes/pierre-dark.json',
  ];
  const glue = glueFiles.reduce(
    (s, f) => s + statSync(new URL(`../${f}`, import.meta.url)).size,
    0
  );
  const chameleTotal = wasmBytes.length + glue;
  const shikiPkgs = ['shiki'];
  try {
    for (const p of readdirSync(
      realpathSync(
        new URL('../node_modules/@shikijs', import.meta.url).pathname
      )
    )) {
      shikiPkgs.push(`@shikijs/${p}`);
    }
  } catch {}
  let treeSitterHighlightSize = null;
  try {
    const path = realpathSync(
      new URL('../node_modules/tree-sitter-highlight', import.meta.url).pathname
    );
    treeSitterHighlightSize = [
      'tree-sitter-highlight.darwin-arm64.node',
      'index.js',
    ].reduce((size, file) => size + statSync(join(path, file)).size, 0);
  } catch {}
  const rows = [
    [
      'chamele',
      kb(chameleTotal),
      `${kb(wasmBytes.length)} wasm (${kb(gzipSync(wasmBytes, { level: 9 }).length)} gz) + ${kb(glue)} js glue`,
    ],
  ];
  const others = [
    [
      'shiki (installed)',
      installedSize(
        ...shikiPkgs,
        'vscode-textmate',
        'vscode-oniguruma',
        'oniguruma-to-es'
      ),
      'textmate grammars + themes + engines',
    ],
    [
      'tree-sitter-highlight (installed)',
      treeSitterHighlightSize,
      'darwin-arm64 native addon + index.js',
    ],
  ];
  for (const [name, size, note] of others) {
    if (size != null) rows.push([name, kb(size), note]);
  }
  return rows;
}

const t0 = performance.now();
const { code } = transformWat(new URL('../src/chamele.wat', import.meta.url));
// optimize exactly as `pnpm build` does, so these numbers describe the published wasm
const wasmBytes = optimizeWasm(wat2wasm('chamele.wat', code));
const chamele = init(new WebAssembly.Module(wasmBytes));
console.log(
  dim(
    `chamele.wasm: ${wasmBytes.length} bytes (-O3), compiled in ${Math.ceil(performance.now() - t0)}ms`
  )
);

const cpu = cpus()[0]?.model ?? arch();
const machine = `${cpu} (${cpus().length} cores), ${Math.round(
  totalmem() / 1024 ** 3
)} GB RAM, ${type()} ${arch()}, node ${process.versions.node}`;
console.log(dim(machine + '\n'));

const BASELINE = 'shiki';
const contenders = await loadContenders();

for (const { name, lang, input } of FIXTURES) {
  const inputBytes = enc.encode(input);
  const mb = inputBytes.length / 1024 / 1024;

  const results = [];
  for (const { name: cname, fn, bytes: wantsBytes, html } of contenders) {
    try {
      results.push({
        name: cname,
        html,
        ...runBench((arg) => fn(arg, lang), wantsBytes ? inputBytes : input),
      });
    } catch (e) {
      results.push({ name: cname, error: e.message });
    }
  }
  const base =
    results.find((r) => r.name === BASELINE && !r.error) ??
    results.find((r) => !r.error);
  results.sort((a, b) => (b.median ?? Infinity) - (a.median ?? Infinity));

  console.log(
    `input: ${name} (${(inputBytes.length / 1024).toFixed(0)} KB, lang=${lang})`
  );
  const cols = [
    { title: 'tool' },
    { title: 'output', hide: 1 },
    { title: 'iters', align: 'right', hide: 2 },
    { title: 'median', align: 'right' },
    { title: 'throughput', align: 'right', hide: 3 },
    { title: `vs ${base.name}`, hide: 4 },
  ];
  const rows = results.map((r) => {
    if (r.error) {
      return [r.name, '', '—', '—', '—', `failed: ${r.error.slice(0, 40)}`];
    }
    const vs =
      r === base ? '1.00× (baseline)' : baselineLabel(r.median / base.median);
    return [
      r.name,
      r.html ? 'html' : 'tree',
      String(r.iters),
      us(r.median),
      fmt(mb / (r.median / 1000)) + ' MB/s',
      vs,
    ];
  });
  printTable(cols, rows);
  console.log();
}

console.log('size (what you ship / install to highlight ts+json+css+html):');
const sizes = sizeRows(wasmBytes);
printTable(
  [
    { title: 'tool' },
    { title: 'size', align: 'right' },
    { title: 'note', hide: 1 },
  ],
  sizes
);
