#!/usr/bin/env node

import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire, isBuiltin } from 'node:module';
import { arch, availableParallelism, cpus, totalmem, type } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { init } from '../dist/index.mjs';

const enc = new TextEncoder();
const dec = new TextDecoder();

const fmt = (n, unit = '') => n.toFixed(n >= 100 ? 0 : n >= 10 ? 1 : 2) + unit;
const us = (ms) => (ms >= 10 ? fmt(ms) + 'ms' : fmt(ms * 1000) + 'µs');
const kb = (bytes) =>
  bytes >= 1024 * 1024
    ? fmt(bytes / 1024 / 1024) + ' MB'
    : fmt(bytes / 1024) + ' KB';
const relative = (rel) =>
  rel >= 1 ? `${fmt(rel)}× slower` : `${fmt(1 / rel)}× faster`;
const dim = (s) => (process.stdout.isTTY ? `\x1b[90m${s}\x1b[0m` : s);

const BASELINE = 'markdown-it';

const CHART_THEMES = {
  light: { text: '#24292F', bar: '#1f883d' },
  dark: { text: '#C9D1D9', bar: '#238636' },
};

const FIXTURES = [
  { name: 'tiny.md', input: loadFixture('tiny') },
  { name: 'small.md', input: loadFixture('simd') },
  { name: 'large.md', input: loadFixture('gfm-spec') },
];

function loadFixture(name) {
  return readFileSync(
    new URL(`./fixtures/${name}.md`, import.meta.url),
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

function renderChart(results, { text, bar }, caption) {
  const rows = results
    .filter((r) => !r.error)
    .sort((a, b) => a.median - b.median);
  if (rows.length === 0) return null;
  const left = 160,
    barMax = 540,
    top = 20,
    rowH = 20,
    barH = 14;
  const gridH = rows.length * rowH;
  const maxMs = rows[rows.length - 1].median;
  const px = (n) => +n.toFixed(3);
  const x = (ms) => px(left + (ms / maxMs) * barMax);
  const axisLabel = (v) =>
    v >= 1000 ? +(v / 1000).toFixed(2) + 's' : +v.toFixed(2) + 'ms';
  const valueLabel = (v) => (v >= 1000 ? fmt(v / 1000) + 's' : fmt(v) + 'ms');
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

  // pick a "nice" tick step (1/2/5 * 10^k) so the axis has at most 6 intervals
  let step = 1e-3;
  const bumps = [2, 2.5, 2];
  for (let i = 0; maxMs / step > 6; i++) step *= bumps[i % 3];

  const lines = [
    `<svg width="800" height="${
      top + gridH + (caption ? 58 : 30)
    }" fill="black" font-family="sans-serif" font-size="13px" xmlns="http://www.w3.org/2000/svg">`,
  ];
  for (let k = 0; k * step <= maxMs; k++) {
    lines.push(
      `  <rect x="${x(k * step)}" y="${top}" width="1" height="${gridH}" fill="#7F7F7F" fill-opacity="0.25"/>`
    );
  }
  rows.forEach((r, i) => {
    const y = top + 3 + i * rowH;
    const bold = r.name.startsWith('@pierre/markdowns')
      ? ' font-weight="bold"'
      : '';
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
  if (caption) {
    lines.push(
      `  <text x="${left}" y="${
        top + gridH + 34
      }" dominant-baseline="hanging" font-size="12px" fill="${text}" fill-opacity="0.5">${esc(caption)}</text>`
    );
  }
  lines.push(`</svg>`);
  return lines.join('\n') + '\n';
}

let sink = 0;
function consume(out) {
  sink ^= (typeof out === 'string' ? out.length : out.byteLength) | 0;
}

function runBench(fn, arg, check, budget = 1500) {
  const first = fn(arg);
  check(first);
  consume(first);
  const warmUntil = performance.now() + 250;
  for (let i = 1; i < 5 || (i < 80 && performance.now() < warmUntil); i++)
    consume(fn(arg));

  let batch = 1;
  for (;;) {
    const t0 = performance.now();
    for (let i = 0; i < batch; i++) consume(fn(arg));
    if (performance.now() - t0 >= 1.5 || batch >= 2048) break;
    batch *= 2;
  }

  const samples = [];
  const budgetEnd = performance.now() + budget;
  while (
    samples.length < 5 ||
    (performance.now() < budgetEnd && samples.length < 2000)
  ) {
    const t0 = performance.now();
    for (let i = 0; i < batch; i++) consume(fn(arg));
    samples.push((performance.now() - t0) / batch);
  }
  samples.sort((a, b) => a - b);
  return {
    median: samples[Math.floor(samples.length / 2)],
    iters: samples.length * batch,
  };
}

const expectString = (out) => {
  if (typeof out !== 'string') throw new TypeError('expected an HTML string');
};
const expectBytes = (out) => {
  if (!(out instanceof Uint8Array)) throw new TypeError('expected bytes');
};

async function loadContenders() {
  const wasm = new WebAssembly.Module(
    readFileSync(new URL('../dist/md.wasm', import.meta.url))
  );
  const stringMd = init(wasm);
  const bytesMd = init(wasm);
  const contenders = [
    {
      name: '@pierre/markdowns',
      fn: (src) => dec.decode(stringMd.render(src, 0).output),
    },
  ];

  try {
    const md4xNapi = await import('md4x/napi');
    await md4xNapi.init();
    contenders.push({
      name: 'md4x (N-API)',
      fn: (src) => md4xNapi.renderToHtml(src),
    });
  } catch (e) {
    console.log(`(md4x/napi not available, skipping: ${e.message})`);
  }
  try {
    const md4xWasm = await import('md4x/wasm');
    await md4xWasm.init();
    contenders.push({
      name: 'md4x (wasm)',
      fn: (src) => md4xWasm.renderToHtml(src),
    });
  } catch (e) {
    console.log(`(md4x/wasm not available, skipping: ${e.message})`);
  }
  try {
    const { default: MarkdownIt } = await import('markdown-it');
    const md = new MarkdownIt({
      html: true,
      linkify: true,
      typographer: false,
    });
    md.linkify.set({ fuzzyLink: false, fuzzyEmail: false });
    contenders.push({ name: 'markdown-it', fn: (src) => md.render(src) });
  } catch (e) {
    console.log(`(markdown-it not installed, skipping: ${e.message})`);
  }

  return {
    contenders,
    bytes: {
      name: '@pierre/markdowns (bytes io)',
      fn: (bytes) => bytesMd.render(bytes, 0).output,
    },
  };
}

function moduleClosure(entry) {
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    let src;
    try {
      src = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
    } catch {
      return;
    }
    const req = createRequire(file);
    const specs = [
      ...src.matchAll(/\bfrom\s*["']([^"']+)["']/g),
      ...src.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g),
      ...src.matchAll(/\brequire\s*\(\s*["']([^"']+)["']\s*\)/g),
    ];
    for (const [, spec] of specs) {
      if (isBuiltin(spec)) continue;
      try {
        visit(req.resolve(spec));
      } catch {}
    }
  };
  visit(entry);
  let bytes = 0;
  for (const file of seen) bytes += statSync(file).size;
  return bytes;
}

function resolved(spec) {
  return fileURLToPath(import.meta.resolve(spec));
}

function pkgRoot(spec) {
  let dir = dirname(resolved(spec));
  for (;;) {
    try {
      if (JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name)
        return dir;
    } catch {}
    const parent = dirname(dir);
    if (parent === dir) return dir;
    dir = parent;
  }
}

function nativeAddon(root) {
  const { platform, arch } = process;
  const musl =
    platform === 'linux' &&
    !process.report?.getReport?.()?.header?.glibcVersionRuntime;
  const name = `md4x.${platform}-${arch}${musl ? '-musl' : ''}.node`;
  return join(root, 'build', name);
}

function sumStat(...paths) {
  let total = 0;
  for (const p of paths) total += statSync(p).size;
  return total;
}

function sizeRows() {
  const wasm = readFileSync(new URL('../dist/md.wasm', import.meta.url));
  const glue = ['dist/index.mjs', 'dist/node.mjs'].reduce(
    (s, f) => s + statSync(new URL(`../${f}`, import.meta.url)).size,
    0
  );
  const rows = [
    [
      '@pierre/markdowns',
      kb(wasm.length + glue),
      `${kb(wasm.length)} wasm (${kb(gzipSync(wasm, { level: 9 }).length)} gz) + ${kb(glue)} js glue`,
    ],
  ];
  try {
    const entry = resolved('markdown-it');
    const bytes = moduleClosure(entry);
    const entrySize = statSync(entry).size;
    rows.push([
      'markdown-it',
      kb(bytes),
      `${kb(entrySize)} ESM + ${kb(bytes - entrySize)} runtime deps`,
    ]);
  } catch {}
  try {
    const root = pkgRoot('md4x/napi');
    const native = nativeAddon(root);
    const js = sumStat(
      join(root, 'lib/napi.mjs'),
      join(root, 'lib/_shared.mjs')
    );
    rows.push([
      'md4x (N-API)',
      kb(statSync(native).size + js),
      `${kb(statSync(native).size)} ${process.platform}-${process.arch} addon + ${kb(js)} js`,
    ]);
  } catch {}
  try {
    const root = pkgRoot('md4x/wasm');
    const wasmFile = join(root, 'build/md4x.wasm');
    const js = sumStat(
      join(root, 'lib/wasm/default.mjs'),
      join(root, 'lib/wasm/common.mjs'),
      join(root, 'lib/_shared.mjs')
    );
    rows.push([
      'md4x (wasm)',
      kb(statSync(wasmFile).size + js),
      `${kb(statSync(wasmFile).size)} wasm + ${kb(js)} js glue`,
    ]);
  } catch {}
  return rows;
}

const { contenders, bytes: bytesContender } = await loadContenders();
const cpuList = cpus();
const cpu = cpuList[0]?.model ?? arch();
console.log(
  dim(
    `${cpu} (${cpuList.length || availableParallelism()} cores), ${Math.round(totalmem() / 1024 ** 3)} GB RAM, ` +
      `${type()} ${arch()}, node ${process.versions.node}\n`
  )
);

const genChart = process.argv.includes('--chart');
let chartResults, chartInput;

for (const { name, input } of FIXTURES) {
  const inputBytes = enc.encode(input);
  const mb = inputBytes.length / 1e6;
  const results = [];
  for (const { name: cname, fn } of contenders) {
    try {
      results.push({ name: cname, ...runBench(fn, input, expectString) });
    } catch (e) {
      results.push({ name: cname, error: e.message });
    }
  }
  const base =
    results.find((r) => r.name === BASELINE && !r.error) ??
    results.find((r) => !r.error);
  const tableResults = [...results];
  try {
    tableResults.push({
      name: bytesContender.name,
      ...runBench(bytesContender.fn, inputBytes, expectBytes),
    });
  } catch (e) {
    tableResults.push({ name: bytesContender.name, error: e.message });
  }
  tableResults.sort((a, b) => (b.median ?? Infinity) - (a.median ?? Infinity));
  console.log(`input: ${name} (${kb(inputBytes.length)})`);
  printTable(
    [
      { title: 'tool' },
      { title: 'iters', align: 'right', hide: 2 },
      { title: 'median', align: 'right' },
      { title: 'throughput', align: 'right', hide: 3 },
      { title: `vs ${base.name}`, hide: 4 },
    ],
    tableResults.map((r) =>
      r.error
        ? [r.name, '—', '—', '—', `failed: ${r.error.slice(0, 40)}`]
        : [
            r.name,
            String(r.iters),
            us(r.median),
            fmt(mb / (r.median / 1000)) + ' MB/s',
            r === base ? '1.00× ' : relative(r.median / base.median),
          ]
    )
  );
  console.log();
  if (name === 'large.md') {
    chartResults = tableResults;
    chartInput = `Input: gfm-spec.md (${kb(inputBytes.length)})`;
  }
}

console.log('size (what this machine loads to render):');
printTable(
  [
    { title: 'tool' },
    { title: 'size', align: 'right' },
    { title: 'contents', hide: 1 },
  ],
  sizeRows()
);

if (genChart) {
  for (const [theme, colors] of Object.entries(CHART_THEMES)) {
    const svg = renderChart(chartResults, colors, chartInput);
    if (svg)
      writeFileSync(new URL(`./benchmark-${theme}.svg`, import.meta.url), svg);
  }
  console.log(dim(`benchmark-{light,dark}.svg updated`));
}

if (sink === 0x7fffffff) {
  console.log(dim('sink:'), sink);
}
