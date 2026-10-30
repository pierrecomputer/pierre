import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { setImmediate } from 'node:timers/promises';

import { createHtmlSession, init, renderToHtml } from '../dist/core.js';
import { createStressFixture } from './fixtures.ts';

assert.equal(typeof globalThis.gc, 'function', 'Run with --expose-gc');
const module = new WebAssembly.Module(
  readFileSync(new URL('../dist/md.wasm', import.meta.url))
);
let arena = init(module);
const decoder = new TextDecoder();
const options = { incomplete: true, skipHtml: true };
const full = (source: string) => decoder.decode(renderToHtml(source, options));
const median = (values: number[]) =>
  values.slice().sort((a: number, b: number) => a - b)[
    Math.floor(values.length / 2)
  ];
let sink = 0;

/** Measure live JS heap and the independent Wasm arena after reclaiming garbage. */
async function memory() {
  await setImmediate();
  globalThis.gc!();
  await setImmediate();
  globalThis.gc!();
  return {
    heapUsedBytes: process.memoryUsage().heapUsed,
    wasmCommittedBytes: arena.memory.buffer.byteLength,
  };
}

/** Replay the same append sequence without retaining an array of source prefixes. */
function replay(
  source: string,
  chunk: number,
  incremental: boolean,
  validate = false
) {
  const session = incremental ? createHtmlSession() : undefined;
  const times = [];
  for (let end = chunk; ; end += chunk) {
    const input = source.slice(0, Math.min(end, source.length));
    const start = performance.now();
    const html =
      session != null ? session.render(input, options).html : full(input);
    times.push(performance.now() - start);
    sink ^= html.length;
    if (validate) assert.equal(html, full(input), `prefix ${input.length}`);
    if (end >= source.length) break;
  }
  return {
    totalMilliseconds: times.reduce((a, b) => a + b, 0),
    p95UpdateMilliseconds: times.slice().sort((a, b) => a - b)[
      Math.floor(times.length * 0.95)
    ],
    maximumUpdateMilliseconds: Math.max(...times),
    updates: times.length,
  };
}

const scaleArgument = process.argv.find((argument: string) =>
  argument.startsWith('--scales=')
);
const scales = scaleArgument
  ? scaleArgument.slice('--scales='.length).split(',').map(Number)
  : [1, 100, 1000];
assert.ok(
  scales.length > 0 &&
    scales.every((scale: number) => [1, 100, 1000].includes(scale)),
  'Expected --scales=1,100,1000'
);
const outputFile = process.argv
  .slice(2)
  .find((argument: string) => !argument.startsWith('--'));
const results = [];
for (const scale of scales) {
  const source = createStressFixture(scale);
  const chunk = 32 * scale;
  const staticTimes = [];
  const trials: Record<string, ReturnType<typeof replay>[]> = {
    full: [],
    incremental: [],
  };
  // Use distinct warmup content; alternate timed order to reduce warm-arena bias.
  full(createStressFixture(1));
  createHtmlSession().render(createStressFixture(1), options);
  for (let run = 0; run < 6; run++) {
    const start = performance.now();
    sink ^= full(source).length;
    if (run !== 0) staticTimes.push(performance.now() - start);
    for (const kind of run % 2 !== 0
      ? ['full', 'incremental']
      : ['incremental', 'full']) {
      const sample = replay(source, chunk, kind === 'incremental');
      if (run !== 0) trials[kind].push(sample);
    }
  }
  const parity = replay(source, chunk, true, true);
  arena = init(module);
  const baseline = await memory();
  let session: ReturnType<typeof createHtmlSession> | null =
    createHtmlSession();
  let output;
  for (let end = chunk; end < source.length; end += chunk)
    output = session.render(source.slice(0, end), options);
  output = session.render(source, options);
  sink ^= output.html.length;
  const retained = await memory();
  const outputCharacters = output.html.length;
  output = null;
  const sessionOnly = await memory();
  session = null;
  const released = await memory();
  const result = {
    scale,
    sourceBytes: Buffer.byteLength(source),
    chunk,
    staticHtmlMedianMilliseconds: median(staticTimes),
    staticTimes,
    full: {
      medianTotalMilliseconds: median(
        trials.full.map((v) => v.totalMilliseconds)
      ),
      trials: trials.full,
    },
    incremental: {
      medianTotalMilliseconds: median(
        trials.incremental.map((v) => v.totalMilliseconds)
      ),
      trials: trials.incremental,
    },
    matchingPrefixes: parity.updates,
    outputCharacters,
    memory: { baseline, retained, sessionOnly, released },
  };
  results.push(result);
  console.log(JSON.stringify(result));
}
const report = {
  date: new Date().toISOString(),
  runtime: process.version,
  cpu: cpus()[0].model,
  logicalCpus: cpus().length,
  totalMemoryBytes: totalmem(),
  platform: `${process.platform}/${process.arch}`,
  samples: 5,
  results,
  mutableTailCases: [] as {
    name: string;
    sourceBytes: number;
    matchingPrefixes: number;
    fullMedianMilliseconds: number;
    incrementalMedianMilliseconds: number;
  }[],
  sink,
  notes: [
    'HTML strings only: excludes formatting hooks, highlighting, DOM, layout, and React.',
    '32 * scale characters per update; this keeps 267 deliveries at all three scales.',
    'Five timed replays after one untimed replay; full/incremental order alternates.',
    'All sampled incremental prefixes are checked against a fresh HTML render outside timing.',
    'Memory is a separate replay after replacing the shared arena. Source is included in baseline.',
    'Heap and Wasm committed bytes are separate counters, not total process memory.',
    'Releasing a session does not shrink the shared Wasm arena; arena bytes are a high-water mark.',
  ],
};
// These inputs cannot reuse completed block HTML, or deliberately disable it.
for (const [name, source] of [
  ['one open paragraph', 'plain **bold** text '.repeat(900)],
  [
    'one open code fence',
    '```typescript\n' + 'const count = 42;\n'.repeat(1000),
  ],
  ['reference definitions', '[id]: /target\n\n' + createStressFixture(1)],
]) {
  const trials: Record<string, number[]> = { full: [], incremental: [] };
  for (let run = 0; run < 6; run++)
    for (const kind of run % 2 !== 0
      ? ['full', 'incremental']
      : ['incremental', 'full']) {
      const sample = replay(source, 64, kind === 'incremental');
      if (run !== 0) trials[kind].push(sample.totalMilliseconds);
    }
  const parity = replay(source, 64, true, true);
  report.mutableTailCases.push({
    name,
    sourceBytes: Buffer.byteLength(source),
    matchingPrefixes: parity.updates,
    fullMedianMilliseconds: median(trials.full),
    incrementalMedianMilliseconds: median(trials.incremental),
  });
}
if (outputFile)
  writeFileSync(outputFile, JSON.stringify(report, null, 2) + '\n');
