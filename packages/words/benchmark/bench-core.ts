import type * as Words from '@pierre/words';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { environment, loadFixtures } from './shared.ts';
const { values: flags } = parseArgs({
  options: {
    baseline: { type: 'string' },
    candidate: { type: 'string' },
    json: { type: 'string' },
  },
});
assert.ok(
  flags.baseline !== undefined,
  '--baseline /absolute/path/to/built/checkout is required'
);
const candidate =
  flags.candidate === undefined
    ? fileURLToPath(new URL('../../../', import.meta.url))
    : resolve(flags.candidate);
const engines = await Promise.all(
  [resolve(flags.baseline), candidate].map(async (repo) => {
    const entry = createRequire(repo + '/packages/words/package.json').resolve(
      '@pierre/words'
    );
    return {
      repo,
      entry,
      ...((await import(pathToFileURL(entry).href)) as typeof Words),
    };
  })
);
const names = readFileSync(
  candidate + '/packages/words/src/entities.txt',
  'utf8'
)
  .split('\n')
  .filter((l) => l !== '' && !l.startsWith('# '))
  .map((l) => l.split(' ')[0]);
const random = [...names];
let state = 123456789;
for (let i = random.length - 1; i > 0; i--) {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  const j = state % (i + 1);
  [random[i], random[j]] = [random[j], random[i]];
}
const cases: [string, string, ('ansi' | 'html-string')?][] = [
  ...loadFixtures().map(({ name, source }): [string, string, 'ansi'] => [
    `ansi-${name}`,
    source,
    'ansi',
  ]),
  ['html-short-paragraph', 'ordinary '.repeat(100), 'html-string'],
  [
    'html-long-paragraph',
    'This is ordinary prose with many words in a paragraph. '.repeat(2048),
    'html-string',
  ],
  [
    'html-short-lines',
    'An ordinary line with no punctuation\n'.repeat(4096),
    'html-string',
  ],
  [
    'html-table',
    (
      '| first | second | third |\n| --- | --- | --- |\n' +
      '| a **bold** value | `code` | plain |\n'.repeat(32) +
      '\n'
    ).repeat(32),
    'html-string',
  ],
  [
    'entities-sorted',
    names
      .map((n) => `&${n};`)
      .join(' ')
      .repeat(4),
  ],
  [
    'entities-shuffled',
    random
      .map((n) => `&${n};`)
      .join(' ')
      .repeat(4),
  ],
  [
    'entities-common',
    '&amp; &lt; &gt; &quot; &nbsp; &copy; &mdash; &ndash; '.repeat(1500),
  ],
  [
    'entities-unknown',
    random
      .map((n) => `&${n}x;`)
      .join(' ')
      .repeat(4),
  ],
  [
    'entities-long',
    names
      .filter((n) => n.length > 8)
      .map((n) => `&${n};`)
      .join(' ')
      .repeat(12),
  ],
  ...[4000, 5000, 6000, 10000].map((cells): [string, string, 'ansi'] => [
    `ansi-table-${cells}`,
    '|' +
      Array(20).fill('heading').join('|') +
      '|\n|' +
      Array(20).fill('---').join('|') +
      '|\n' +
      Array.from(
        { length: cells / 20 },
        (_, i) =>
          '|' +
          Array.from({ length: 20 }, (_, j) => `${i}-${j} **bold** é 中`).join(
            '|'
          ) +
          '|'
      ).join('\n'),
    'ansi',
  ]),
  ...[257, 512].map((columns): [string, string, 'ansi'] => [
    `ansi-table-${columns}-columns`,
    '|' +
      Array(columns).fill('heading').join('|') +
      '|\n|' +
      Array(columns).fill('---').join('|') +
      '|\n' +
      Array.from(
        { length: 20 },
        (_, i) =>
          '|' +
          Array.from(
            { length: columns },
            (_, j) => `${i}-${j} **bold** é 中`
          ).join('|') +
          '|'
      ).join('\n'),
    'ansi',
  ]),
];
const median = (x: number[]) =>
  [...x].sort((a, b) => a - b)[Math.floor(x.length / 2)];
let sink = 0;
const decoder = new TextDecoder();
const results = [];
for (const [name, source, mode] of cases) {
  const callbacks = engines.map(
    (e) => () =>
      mode === 'ansi'
        ? e.renderToAnsi(source, { width: 200 })
        : mode === 'html-string'
          ? decoder.decode(e.renderToHtml(source))
          : e.renderToHtml(source)
  );
  const hashes = callbacks.map((fn) =>
    createHash('sha256').update(fn()).digest('hex')
  );
  assert.equal(hashes[0], hashes[1], name);
  const stats = callbacks.map(() => ({ samples: [] as number[], batch: 1 }));
  for (let side = 0; side < 2; side++) {
    const fn = callbacks[side];
    let runs = 0;
    const start = performance.now();
    while (performance.now() - start < 300) {
      sink += fn().length;
      runs++;
    }
    stats[side].batch = Math.max(
      1,
      Math.round((runs / (performance.now() - start)) * 5)
    );
  }
  for (let round = 0; round < 50; round++)
    for (const side of round % 2 !== 0 ? [1, 0] : [0, 1]) {
      const { batch, samples } = stats[side];
      const fn = callbacks[side];
      const start = performance.now();
      for (let i = 0; i < batch; i++) sink += fn().length;
      samples.push((performance.now() - start) / batch);
    }
  const result = {
    name,
    mode: mode ?? 'html-bytes',
    bytes: Buffer.byteLength(source),
    outputHash: hashes[0],
    baselineMs: median(stats[0].samples),
    candidateMs: median(stats[1].samples),
    stats,
  };
  const speedup = result.baselineMs / result.candidateMs;
  results.push({ ...result, speedup });
  console.log(name, speedup, result.baselineMs, result.candidateMs);
}
const report = {
  environment: environment([]),
  runtime: {
    node: process.version,
    bun: process.versions.bun,
    arch: process.arch,
  },
  repositories: engines.map((e) => e.repo),
  entries: engines.map((e) => e.entry),
  results,
  sink,
};
if (flags.json !== undefined)
  writeFileSync(flags.json, JSON.stringify(report, null, 2) + '\n');
