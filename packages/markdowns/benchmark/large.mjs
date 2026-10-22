import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setImmediate } from 'node:timers/promises';

import {
  createMarkdownSession,
  init,
  renderToElements,
  renderToHtml,
} from '../dist/index.mjs';
import {
  createStressFixture,
  STRESS_BASE_CHARACTERS,
  STRESS_SCALES,
} from './fixtures.mjs';

const scale = Number(process.argv[2] ?? 100);
const updates = Number(process.argv[3] ?? 16);
const outputPath = process.argv[4];
assert.ok(
  STRESS_SCALES.includes(scale),
  'Scale must be 1, 100, or 1000. Usage: bench-large -- [scale=100] [updates=16] [output.json]'
);
assert.ok(
  Number.isInteger(updates) && updates >= 1 && updates <= 32,
  'Updates must be an integer from 1 to 32; large cases intentionally use sparse appends.'
);
assert.equal(
  typeof globalThis.gc,
  'function',
  'Memory measurements require Node --expose-gc. Run the markdowns:bench-large Moon task.'
);

const module = new WebAssembly.Module(
  await readFile(new URL('../dist/md.wasm', import.meta.url))
);
const source = createStressFixture(scale);
const base = createStressFixture(1);
const ends = Array.from({ length: updates }, (_, i) =>
  Math.ceil((source.length * (i + 1)) / updates)
);
let renderer = init(module);

/** Collect outside timed sections and give unreachable render frames a turn. */
async function collect() {
  await setImmediate();
  globalThis.gc();
  await setImmediate();
  globalThis.gc();
}

/** RSS is process residency; neither it nor external is a live-object count. */
async function memory() {
  await collect();
  const usage = process.memoryUsage();
  return {
    heapUsedBytes: usage.heapUsed,
    externalBytes: usage.external,
    rssBytes: usage.rss,
    wasmCommittedBytes: renderer.memory.buffer.byteLength,
  };
}

/** Count a large tree without serializing it or copying its children arrays. */
function describe(nodes) {
  const counts = {
    rootNodes: nodes.length,
    elements: 0,
    textNodes: 0,
    textCharacters: 0,
    paragraphs: 0,
    links: 0,
    codeBlocks: 0,
  };
  const visit = (list) => {
    for (const node of list) {
      if (node.type === 'text') {
        counts.textNodes++;
        counts.textCharacters += node.value.length;
      } else {
        counts.elements++;
        if (node.tagName === 'p') counts.paragraphs++;
        if (node.tagName === 'a') counts.links++;
        if (node.tagName === 'pre') counts.codeBlocks++;
        visit(node.children);
      }
    }
  };
  visit(nodes);
  return counts;
}

// Warm the compiled module on one unit, without retaining a large reference tree.
renderToHtml(base);
let baseNodes = renderToElements(base);
const baseCounts = describe(baseNodes);
const firstNode = baseNodes[0];
const lastNode = baseNodes.at(-1);
baseNodes = null;
createMarkdownSession().render(base, { incomplete: true });

/** Assert both ends and all structural counts on the complete repeated fixture. */
function checkComplete(nodes) {
  const actual = describe(nodes);
  for (const [key, count] of Object.entries(baseCounts))
    assert.equal(actual[key], count * scale, `${key} at ${scale}×`);
  assert.deepEqual(nodes[0], firstNode);
  assert.deepEqual(nodes.at(-1), lastNode);
  return actual;
}

/** Replace the shared arena so each stage starts with its own committed pages. */
async function reset() {
  renderer = init(module);
  return memory();
}

/** Report three render samples, keeping GC and validation outside their timers. */
async function measureRender(render, validate) {
  const before = await reset();
  const milliseconds = [];
  let result;
  for (let sample = 0; sample < 3; sample++) {
    result = null;
    await collect();
    const started = performance.now();
    result = render(source);
    milliseconds.push(performance.now() - started);
  }
  const retained = await memory();
  const details = validate(result);
  result = null;
  const releasedOutput = await memory();
  const replacedArena = await reset();
  return {
    milliseconds,
    medianMilliseconds: [...milliseconds].sort((a, b) => a - b)[1],
    details,
    memory: { before, retained, releasedOutput, replacedArena },
  };
}

const html = await measureRender(renderToHtml, (bytes) => {
  assert.ok(bytes.byteLength > source.length);
  // Validate both ends without decoding an additional large HTML string.
  const beginning = new TextDecoder().decode(bytes.subarray(0, 512));
  const ending = new TextDecoder().decode(bytes.subarray(-512));
  assert.ok(beginning.includes('<p>'));
  assert.ok(ending.includes('</code></pre>'));
  assert.ok(ending.includes('<p>Done.</p>'));
  return { borrowedOutputBytes: bytes.byteLength };
});

const elements = await measureRender(renderToElements, checkComplete);

// Measure append-session memory independently of the later full-parse checks:
// those checks would otherwise grow the shared arena and inflate this result.
const sessionBefore = await reset();
let session = createMarkdownSession();
let sessionNodes;
const appendMilliseconds = [];
for (const end of ends) {
  const input = source.slice(0, end);
  const started = performance.now();
  sessionNodes = session.render(input, { incomplete: true });
  appendMilliseconds.push(performance.now() - started);
}
const sessionRetained = await memory();
const sessionCounts = checkComplete(sessionNodes);
sessionNodes = null;
const sessionOnly = await memory();
session = null;
const sessionReleased = await memory();
const sessionReplacedArena = await reset();

// Retain only the current prefix pair. Never store every prefix, stringify the
// trees, or stream millions of single-character updates through this stress run.
let paritySession = createMarkdownSession();
let fullReplayMilliseconds = 0;
let incrementalReplayMilliseconds = 0;
for (const [i, end] of ends.entries()) {
  const input = source.slice(0, end);
  let actual;
  let expected;
  // Alternate ordering to avoid consistently granting one side the warm arena.
  const full = () => {
    const started = performance.now();
    expected = renderToElements(input, { incomplete: true });
    fullReplayMilliseconds += performance.now() - started;
  };
  const incremental = () => {
    const started = performance.now();
    actual = paritySession.render(input, { incomplete: true });
    incrementalReplayMilliseconds += performance.now() - started;
  };
  if (i % 2 === 0) {
    full();
    incremental();
  } else {
    incremental();
    full();
  }
  assert.deepEqual(actual, expected, `Sparse prefix ${i + 1}/${updates}`);
  actual = null;
  expected = null;
  // Reclaim the discarded comparison tree between large sparse updates.
  await collect();
}
paritySession = null;
await reset();

const report = {
  runtime: process.version,
  platform: `${process.platform}/${process.arch}`,
  scale,
  baseCharacters: STRESS_BASE_CHARACTERS,
  characters: source.length,
  utf8Bytes: Buffer.byteLength(source),
  updates,
  html,
  elements,
  appendSession: {
    millisecondsPerUpdate: appendMilliseconds,
    totalMilliseconds: appendMilliseconds.reduce(
      (sum, value) => sum + value,
      0
    ),
    maximumUpdateMilliseconds: Math.max(...appendMilliseconds),
    details: sessionCounts,
    memory: {
      before: sessionBefore,
      retained: sessionRetained,
      sessionOnly,
      releasedOutput: sessionReleased,
      replacedArena: sessionReplacedArena,
    },
  },
  correctness: {
    matchingSparsePrefixes: updates,
    fullReplayMilliseconds,
    incrementalReplayMilliseconds,
  },
  notes: [
    'Parser APIs only: excludes React, highlighting, token fades, DOM, and browser layout/paint.',
    'Render timings are three samples after a one-unit warmup; append and parity replays run once.',
    'GC and assertions run outside timers. Timed operations may still incur automatic GC.',
    'Inputs are sparse prefixes, not a simulated real-time token stream; do not compare these ratios with 64-character replay benchmarks.',
    'Memory includes the source, module, and harness. heapUsed is JS heap; external and RSS overlap other allocations and are not live-memory sums.',
    'wasmCommittedBytes measures the shared linear-memory high-water mark, not occupied parser data. Replacing the arena is benchmark isolation, not a public trimming API.',
    'A retained session owns its cached tree even after the caller releases the returned array. Released-output samples keep the current Wasm arena alive.',
    'Parity timing uses a shared arena and alternating order; append-session memory was measured separately before those full parses.',
  ],
};
if (outputPath) {
  const path = resolve(outputPath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
}
console.log(JSON.stringify(report, null, 2));
