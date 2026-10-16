import * as jsdiff from 'diff';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { arch, cpus, totalmem, type } from 'node:os';

import * as core from '../lib/core';
import { optimizeWasm, transformWat, wat2wasm } from '../scripts/build';
import { type ApiName, bindApi, genFixtures } from './fixtures';

const enc = new TextEncoder();
const BASELINE = 'diff@9.0.0';
const CHART_SCENARIO = 'createTwoFilesPatch';

const CHART_THEMES = {
  light: { text: '#24292F', bar: '#1f883d' },
  dark: { text: '#C9D1D9', bar: '#238636' },
};

interface Column {
  title: string;
  align?: 'left' | 'right';
  /** lower = dropped first when columns are scarce (omit to always keep) */
  hide?: number;
}

interface Result {
  name: string;
  lib: 'mine' | 'theirs';
  median: number;
  mean: number;
  iters: number;
  alloc?: number;
}

const fmt = (n: number, unit = '') =>
  n.toFixed(n >= 100 ? 0 : n >= 10 ? 1 : 2) + unit;
const us = (ms: number) => (ms >= 10 ? fmt(ms) + 'ms' : fmt(ms * 1000) + 'µs');
const baselineLabel = (rel: number) =>
  rel >= 1 ? `${fmt(rel)}× slower` : `${fmt(1 / rel)}× faster`;
const mib = (bytes: number) => fmt(bytes / 1024 ** 2, ' MB');
const dim = (s: string) => (process.stdout.isTTY ? `\x1b[90m${s}\x1b[0m` : s);

/** Print a box-drawn table that fits the terminal. */
function printTable(cols: Column[], rows: string[][]) {
  const termW = process.stdout.columns ?? Infinity;
  const colWidth = (c: Column, i: number) =>
    Math.max(c.title.length, ...rows.map((r) => (r[i] ?? '').length));
  const tableW = (idxs: number[]) =>
    idxs.reduce((s, i) => s + colWidth(cols[i], i), 0) + 1 + 3 * idxs.length;

  let keep = cols.map((_, i) => i);
  const droppable = cols
    .map((c, i) => ({ i, hide: c.hide }))
    .filter((c) => c.hide != null)
    .sort((a, b) => a.hide! - b.hide!);
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

function renderChart(
  results: Result[],
  { text, bar }: { text: string; bar: string },
  caption: string
) {
  const rows = [...results].sort((a, b) => a.median - b.median);
  const left = 160,
    barMax = 540,
    top = 20,
    rowH = 20,
    barH = 14;
  const gridH = rows.length * rowH;
  const maxMs = rows[rows.length - 1].median;
  const px = (n: number) => +n.toFixed(3);
  const x = (ms: number) => px(left + (ms / maxMs) * barMax);
  const axisLabel = (v: number) => +v.toFixed(2) + 'ms';
  const valueLabel = (v: number) => fmt(v) + 'ms';
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

  let step = 1e-3;
  const bumps = [2, 2.5, 2];
  for (let i = 0; maxMs / step > 6; i++) step *= bumps[i % 3];

  const lines = [
    `<svg width="800" height="${
      top + gridH + 58
    }" fill="black" font-family="sans-serif" font-size="13px" xmlns="http://www.w3.org/2000/svg">`,
  ];
  for (let k = 0; k * step <= maxMs; k++) {
    lines.push(
      `  <rect x="${x(k * step)}" y="${top}" width="1" height="${gridH}" fill="#7F7F7F" fill-opacity="0.25"/>`
    );
  }
  rows.forEach((r, i) => {
    const y = top + 3 + i * rowH;
    const bold = r.name === '@pierre/patches' ? ' font-weight="bold"' : '';
    const w = px((r.median / maxMs) * barMax);
    lines.push(
      `  <rect x="${left}" y="${y}" width="${w}" height="${barH}" fill="${bar}"/>`
    );
    lines.push(
      `  <text x="${left - 8}" y="${y + 7}" text-anchor="end" dominant-baseline="middle"${bold} fill="${text}">${esc(
        r.name
      )}</text>`
    );
    lines.push(
      `  <text x="${px(left + w + 8)}" y="${y + 7}" dominant-baseline="middle"${bold} fill="${text}">${valueLabel(
        r.median
      )}</text>`
    );
  });
  for (let k = 0; k * step <= maxMs; k++) {
    lines.push(
      `  <text x="${x(k * step)}" y="${
        top + gridH + 4
      }" text-anchor="middle" dominant-baseline="hanging" fill="${text}">${axisLabel(k * step)}</text>`
    );
  }
  lines.push(
    `  <text x="${left}" y="${
      top + gridH + 34
    }" dominant-baseline="hanging" font-size="12px" fill="${text}" fill-opacity="0.5">${esc(caption)}</text>`
  );
  lines.push('</svg>');
  return lines.join('\n') + '\n';
}

function runBench(fn: () => unknown, warmup = 5, budget = 1200, iters = 2000) {
  for (let i = 0; i < warmup; i++) fn(); // warmup
  const samples: number[] = [];
  const budgetEnd = performance.now() + budget;
  while (
    (samples.length < warmup || performance.now() < budgetEnd) &&
    samples.length < iters
  ) {
    const start = performance.now();
    fn();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return {
    median: samples[Math.floor(samples.length / 2)],
    mean: samples.reduce((a, b) => a + b, 0) / samples.length,
    iters: samples.length,
  };
}

/** median bytes that one call allocates, over 3 fresh processes (see memory.ts) */
function runMemory(
  lib: Result['lib'],
  s: { name: string; api: ApiName; input: string; perLine: boolean }
) {
  const runs: number[] = [];
  for (let i = 0; i < 3; i++) {
    const { status, stdout, stderr } = spawnSync(
      process.execPath,
      [
        `${import.meta.dirname}/memory.ts`,
        lib,
        s.api,
        s.input,
        s.perLine ? 'perLine' : '',
      ],
      {
        input: lib === 'mine' ? wasmBytes : '',
        encoding: 'utf8',
        env: { ...process.env, BUN_JSC_useGC: '0' },
      }
    );
    if (status !== 0) throw new Error(`memory.ts ${lib} ${s.name}: ${stderr}`);
    runs.push(+stdout);
  }
  return runs.sort((a, b) => a - b)[1];
}

const t0 = performance.now();
const code = transformWat(new URL('../src/patch.wat', import.meta.url));
// optimize exactly as the build does, so these numbers describe the published wasm
const wasmBytes = optimizeWasm(wat2wasm('patch.wat', code));
const wasm = new WebAssembly.Module(wasmBytes);
core.init(() => wasm);
console.log(
  dim(
    `patch.wasm: ${wasmBytes.length} bytes (-O3), compiled in ${Math.ceil(performance.now() - t0)}ms`
  )
);

const cpu = cpus()[0]?.model ?? arch();
console.log(
  dim(
    `${cpu} (${cpus().length} cores), ${Math.round(
      totalmem() / 1024 ** 3
    )} GB RAM, ${type()} ${arch()}, bun ${Bun.version}\n`
  )
);

const fx = genFixtures();
const genChart = process.argv.includes('--chart');
const genMemory = process.argv.includes('--memory');
let chartResults: Result[] = [];
let chartInput = '';
const SCENARIOS = (
  [
    { name: 'createTwoFilesPatch', api: 'createTwoFilesPatch', input: 'line' },
    {
      name: 'createTwoFilesPatch (divergent)',
      api: 'createTwoFilesPatch',
      input: 'div',
    },
    { name: 'diffLines', api: 'diffLines', input: 'line' },
    { name: 'diffWordsWithSpace', api: 'diffWordsWithSpace', input: 'word' },
    {
      name: 'diffWordsWithSpace (unicode)',
      api: 'diffWordsWithSpace',
      input: 'uniWord',
    },
    { name: 'diffChars', api: 'diffChars', input: 'char' },
    { name: 'diffChars (unicode)', api: 'diffChars', input: 'uniChar' },
    {
      name: 'diffWordsWithSpace (per line)',
      api: 'diffWordsWithSpace',
      input: 'pair',
      perLine: true,
    },
    {
      name: 'diffChars (per line)',
      api: 'diffChars',
      input: 'pair',
      perLine: true,
    },
  ] satisfies { name: string; api: ApiName; input: string; perLine?: boolean }[]
).map((s) => ({
  ...s,
  old: fx[s.input + 'Old'],
  new: fx[s.input + 'New'],
  perLine: 'perLine' in s,
  mine: bindApi(core, s.api, 'perLine' in s),
  theirs: bindApi(jsdiff, s.api, 'perLine' in s),
}));

// verify both produce identical output before timing anything
for (const s of SCENARIOS) {
  const a = JSON.stringify(s.mine(s.old, s.new));
  const b = JSON.stringify(s.theirs(s.old, s.new));
  if (a !== b) {
    console.error(
      `✗ ${s.name}: output differs from ${BASELINE}, refusing to benchmark`
    );
    process.exit(1);
  }
}

for (const s of SCENARIOS) {
  const mb =
    (enc.encode(s.old).length + enc.encode(s.new).length) / 1024 / 1024;
  const results: Result[] = [
    {
      name: '@pierre/patches',
      lib: 'mine',
      ...runBench(() => s.mine(s.old, s.new)),
    },
    {
      name: BASELINE,
      lib: 'theirs',
      ...runBench(() => s.theirs(s.old, s.new)),
    },
  ];
  if (genMemory) {
    for (const r of results) r.alloc = runMemory(r.lib, s);
  }
  const base = results.find((r) => r.name === BASELINE)!;
  results.sort((a, b) => b.median - a.median);

  console.log(`${s.name} (${(mb * 1024).toFixed(0)} KB old+new)`);
  const cols: Column[] = [
    { title: 'library' },
    { title: 'iters', align: 'right', hide: 1 },
    { title: 'median', align: 'right' },
    { title: 'mean', align: 'right', hide: 0 },
    { title: 'throughput', align: 'right', hide: 2 },
    { title: `vs ${BASELINE}`, hide: 3 },
    ...(genMemory ? [{ title: 'allocated', align: 'right' } as const] : []),
  ];
  const rows = results.map((r) => [
    r.name,
    String(r.iters),
    us(r.median),
    us(r.mean),
    fmt(mb / (r.median / 1000)) + ' MB/s',
    r === base ? '1.00× (baseline)' : baselineLabel(r.median / base.median),
    ...(genMemory ? [mib(r.alloc!)] : []),
  ]);
  printTable(cols, rows);
  console.log();
  if (s.name === CHART_SCENARIO) {
    chartResults = results;
    chartInput = `${s.name}: generated JavaScript (${(mb * 1024).toFixed(0)} KB old+new)`;
  }
}

if (genChart) {
  for (const [theme, colors] of Object.entries(CHART_THEMES)) {
    writeFileSync(
      new URL(`./benchmark-${theme}.svg`, import.meta.url),
      renderChart(chartResults, colors, chartInput)
    );
  }
  console.log(dim('benchmark-{light,dark}.svg updated'));
}
