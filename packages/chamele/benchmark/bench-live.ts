// Benchmarks for the incremental LiveTokenizer: eager indexing, cached
// reads, one-character and structural edits with convergence profiles, and
// retained-memory footprints. The full-rebuild baseline re-runs codeToTokens
// over the whole document per edit, which is what the previous LiveTokenizer
// did on every line change.
import { readFileSync } from 'node:fs';

import type { LiveTextEdit } from '../lib/index';
import { codeToTokens, init, LiveTokenizer } from '../lib/index';
import { optimizeWasm, transformWat, wat2wasm } from '../scripts/build';
import pierreDark from '../themes/pierre-dark.json' with { type: 'json' };

const fmt = (n: number, unit = '') =>
  n.toFixed(n >= 100 ? 0 : n >= 10 ? 1 : 2) + unit;
const us = (ms: number) => (ms >= 10 ? fmt(ms) + 'ms' : fmt(ms * 1000) + 'µs');
const mb = (bytes: number) => fmt(bytes / 1048576) + 'MB';

const url = new URL('../src/chamele.wat', import.meta.url);
const { code } = transformWat(url);
const wasmModule = new WebAssembly.Module(
  optimizeWasm(wat2wasm(url.pathname, code))
);
init(wasmModule);

const largeTs = readFileSync(
  new URL('./fixtures/large.ts.txt', import.meta.url),
  'utf8'
);
const hundredK = Array.from(
  { length: 100_000 },
  (_, i) => `const value${i} = compute(${i}) + "text ${i}"; // trailing note`
).join('\n');
const unicode = 'const greeting = "日本語 🎈"; // naïve résumé\n'.repeat(
  10_000
);

interface Sample {
  median: number;
  p95: number;
}

function measure(rounds: number, run: () => void, settle?: () => void): Sample {
  const times: number[] = [];
  for (let i = 0; i < rounds; i++) {
    const t0 = performance.now();
    run();
    times.push(performance.now() - t0);
    settle?.();
  }
  times.sort((a, b) => a - b);
  return {
    median: times[times.length >> 1],
    p95: times[Math.min(times.length - 1, Math.ceil(times.length * 0.95) - 1)],
  };
}

const changedLines = (u: {
  lineChanges: readonly { newStartLine: number; newEndLine: number }[];
}) => u.lineChanges.reduce((s, c) => s + (c.newEndLine - c.newStartLine), 0);

function editAt(
  live: LiveTokenizer,
  line: number,
  flip: boolean
): LiveTextEdit {
  const len = live.getLineLength(line);
  return {
    range: {
      start: { line, character: Math.max(0, len - 1) },
      end: { line, character: len },
    },
    newText: flip ? '1' : '2',
  };
}

interface Row {
  fixture: string;
  scenario: string;
  median: string;
  p95: string;
  lines: string;
}

const rows: Row[] = [];

function bench(
  fixture: string,
  scenario: string,
  sample: Sample,
  lines = ''
): void {
  rows.push({
    fixture,
    scenario,
    median: us(sample.median),
    p95: us(sample.p95),
    lines,
  });
}

for (const [name, source, lang] of [
  ['large.ts (10k lines)', largeTs, 'ts'],
  ['synthetic 100k lines', hundredK, 'ts'],
  ['unicode 10k lines', unicode, 'ts'],
] as const) {
  const initSample = measure(name.includes('100k') ? 3 : 7, () => {
    new LiveTokenizer({ lang, theme: pierreDark, code: source }).dispose();
  });
  bench(name, 'eager init', initSample);

  const live = new LiveTokenizer({ lang, theme: pierreDark, code: source });
  const lineCount = live.lineCount;
  const middle = lineCount >> 1;

  let flip = false;
  let retok = 0;
  for (const [label, line] of [
    ['edit top', 0],
    ['edit middle', middle],
    ['edit end', lineCount - 2],
  ] as const) {
    const sample = measure(200, () => {
      flip = !flip;
      retok = changedLines(live.applyEdits([editAt(live, line, flip)]));
    });
    bench(name, label, sample, String(retok));
  }

  // structural churn: insert a line, then delete it again
  const structural = measure(100, () => {
    flip = !flip;
    if (flip) {
      retok = changedLines(
        live.applyEdits([
          {
            range: {
              start: { line: middle, character: 0 },
              end: { line: middle, character: 0 },
            },
            newText: 'const inserted = 1;\n',
          },
        ])
      );
    } else {
      retok = changedLines(
        live.applyEdits([
          {
            range: {
              start: { line: middle, character: 0 },
              end: { line: middle + 1, character: 0 },
            },
            newText: '',
          },
        ])
      );
    }
  });
  bench(name, 'structural edit', structural, String(retok));

  // worst case: opening a template literal near the top re-tokenizes to EOF,
  // closing it again re-tokenizes back
  const eof = measure(20, () => {
    flip = !flip;
    retok = changedLines(
      live.applyEdits([
        flip
          ? {
              range: {
                start: { line: 2, character: 0 },
                end: { line: 2, character: 0 },
              },
              newText: '`',
            }
          : {
              range: {
                start: { line: 2, character: 0 },
                end: { line: 2, character: 1 },
              },
              newText: '',
            },
      ])
    );
  });
  bench(name, 'EOF propagation', eof, String(retok));

  // the same worst case bounded to a 120-line viewport renderRange: the timed
  // slice re-tokenizes the visible window only, and the off-screen tail
  // settles between rounds outside the timing
  const viewport = measure(
    20,
    () => {
      flip = !flip;
      retok = live.applyEdits(
        [
          flip
            ? {
                range: {
                  start: { line: 2, character: 0 },
                  end: { line: 2, character: 0 },
                },
                newText: '`',
              }
            : {
                range: {
                  start: { line: 2, character: 0 },
                  end: { line: 2, character: 1 },
                },
                newText: '',
              },
        ],
        { renderRange: [0, 120] }
      ).lines.size;
    },
    () => live.flush()
  );
  bench(name, 'EOF + renderRange', viewport, String(retok));

  const rawReads = measure(50, () => {
    for (let i = 0; i < 100; i++) {
      live.getLineRecords((((i * 7919) % lineCount) + lineCount) % lineCount);
    }
  });
  bench(name, 'raw reads ×100', rawReads);

  const themedReads = measure(50, () => {
    for (let i = 0; i < 100; i++) {
      live.getLineTokens((((i * 7919) % lineCount) + lineCount) % lineCount);
    }
  });
  bench(name, 'themed reads ×100', themedReads);

  // full-rebuild baseline: what every keystroke used to cost
  const baseline = measure(name.includes('100k') ? 5 : 20, () => {
    codeToTokens(source, { lang, theme: pierreDark });
  });
  bench(name, 'baseline full rebuild', baseline);

  live.dispose();
}

const pad = (s: string, w: number, right = false) =>
  right ? s.padStart(w) : s.padEnd(w);
const cols = ['fixture', 'scenario', 'median', 'p95', 'retok lines'] as const;
const widths = [
  Math.max(...rows.map((r) => r.fixture.length), 7),
  Math.max(...rows.map((r) => r.scenario.length), 8),
  Math.max(...rows.map((r) => r.median.length), 6),
  Math.max(...rows.map((r) => r.p95.length), 4),
  Math.max(...rows.map((r) => r.lines.length), 11),
];
console.log(cols.map((c, i) => pad(c, widths[i], i >= 2)).join('   '));
let lastFixture = '';
for (const r of rows) {
  console.log(
    [
      pad(r.fixture === lastFixture ? '' : r.fixture, widths[0]),
      pad(r.scenario, widths[1]),
      pad(r.median, widths[2], true),
      pad(r.p95, widths[3], true),
      pad(r.lines, widths[4], true),
    ].join('   ')
  );
  lastFixture = r.fixture;
}

// footprint: retained wasm memory and interned-state accounting through the
// raw exports on the 100k-line fixture
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
const bytes = new TextEncoder().encode(hundredK);
const ptr = raw.liveStage(bytes.length);
new Uint8Array(raw.memory.buffer).set(bytes, ptr);
raw.liveInitDoc(ptr, bytes.length, 31);
raw.liveRun(0x7fffffff);
console.log('\n100k-line footprint:');
console.log(`  wasm memory      ${mb(raw.memory.buffer.byteLength)}`);
console.log(`  heap live        ${mb(raw.liveStats(3))}`);
console.log(`  interned states  ${raw.liveStats(1)} (${mb(raw.liveStats(2))})`);
console.log(
  `  state blob size  ${raw.liveStats(6)} bytes of checkpoint region`
);
