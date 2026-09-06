// Benchmarks for the incremental LiveTokenizer: eager indexing, cached
// reads, edits paired with full rebuilds of the same edited text, and memory.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import type { LiveTextEdit, LiveUpdateOptions } from '../lib/index';
import { codeToTokens, init, LiveTokenizer } from '../lib/index';
import { optimizeWasm, transformWat, wat2wasm } from '../scripts/build';
import pierreDark from '../themes/pierre-dark.json' with { type: 'json' };
import { measure, type Measurement } from './measure';

const fmt = (n: number, unit = '') =>
  n.toFixed(n >= 100 ? 0 : n >= 10 ? 1 : 2) + unit;
const us = (ms: number) => (ms >= 10 ? fmt(ms) + 'ms' : fmt(ms * 1000) + 'µs');
const mb = (bytes: number) => fmt(bytes / 1048576) + 'MiB';

const url = new URL('../src/highlights.wat', import.meta.url);
const { code } = transformWat(url);
const wasmModule = new WebAssembly.Module(
  optimizeWasm(wat2wasm(url.pathname, code))
);
init(wasmModule);

const largeTs = readFileSync(
  // ~ 10k lines
  new URL('./fixtures/large.ts.txt', import.meta.url),
  'utf8'
);
const hundredK = largeTs.repeat(10);
const unicode = 'const greeting = "日本語 🎈"; // naïve résumé\n'.repeat(
  10_000
);

const changedLines = (u: {
  lineChanges: readonly { newStartLine: number; newEndLine: number }[];
}) => u.lineChanges.reduce((s, c) => s + (c.newEndLine - c.newStartLine), 0);

interface Row {
  fixture: string;
  scenario: string;
  median: string;
  p95: string;
  samples: string;
  lines: string;
}

const rows: Row[] = [];

function bench(
  fixture: string,
  scenario: string,
  sample: Measurement,
  lines = ''
): void {
  rows.push({
    fixture,
    scenario,
    median: us(sample.median),
    p95: us(sample.p95),
    samples: String(sample.samples),
    lines,
  });
}

console.log(
  '200 ms warmup; 1.5 s budget per case, including cleanup; ≥20 timed calls.'
);
console.log(
  'Live edits update retained records; rebuilds materialize all themed tokens.'
);
console.log(
  'Edits and rebuild inputs are prepared before timing; undo and flush are untimed.\n'
);

for (const [name, source, lang] of [
  ['large.ts (10k lines)', largeTs, 'ts'],
  ['synthetic 100k lines', hundredK, 'ts'],
  ['unicode 10k lines', unicode, 'ts'],
] as const) {
  let initialized: LiveTokenizer | undefined;
  const [initSample] = measure(
    [
      {
        run: () =>
          (initialized = new LiveTokenizer({
            lang,
            theme: pierreDark,
            code: source,
          })),
        afterEach: () => initialized?.dispose(),
      },
    ],
    { batch: false }
  );
  bench(name, 'eager init', initSample);

  const lines = source.split('\n');
  const middle = lines.length >> 1;
  const offsets = [0];
  for (const line of lines)
    offsets.push(offsets[offsets.length - 1] + line.length + 1);
  const scenarios: {
    label: string;
    edit: LiveTextEdit;
    options?: LiveUpdateOptions;
  }[] = [];
  for (const [label, line] of [
    ['edit top', 0],
    ['edit middle', middle],
    ['edit end', lines.length - 2],
  ] as const) {
    const len = lines[line].length;
    scenarios.push({
      label,
      edit: {
        range: {
          start: { line, character: Math.max(0, len - 1) },
          end: { line, character: len },
        },
        newText: lines[line].endsWith('1') ? '2' : '1',
      },
    });
  }
  scenarios.push(
    {
      label: 'insert line',
      edit: {
        range: {
          start: { line: middle, character: 0 },
          end: { line: middle, character: 0 },
        },
        newText: 'const inserted = 1;\n',
      },
    },
    {
      label: 'delete line',
      edit: {
        range: {
          start: { line: middle, character: 0 },
          end: { line: middle + 1, character: 0 },
        },
        newText: '',
      },
    }
  );
  for (const viewport of [false, true]) {
    scenarios.push({
      label: viewport ? 'template + viewport' : 'template propagation',
      edit: {
        range: {
          start: { line: 2, character: 0 },
          end: { line: 2, character: 0 },
        },
        newText: '`',
      },
      options: viewport ? { renderRange: [0, 120] } : undefined,
    });
  }

  for (const { label, edit, options } of scenarios) {
    const live = new LiveTokenizer({ lang, theme: pierreDark, code: source });
    try {
      const { start, end } = edit.range;
      const from = offsets[start.line] + start.character;
      const to = offsets[end.line] + end.character;
      const edited = source.slice(0, from) + edit.newText + source.slice(to);
      const inserted = edit.newText.split('\n');
      const undo: LiveTextEdit = {
        range: {
          start,
          end: {
            line: start.line + inserted.length - 1,
            character:
              inserted.length === 1
                ? start.character + edit.newText.length
                : inserted[inserted.length - 1].length,
          },
        },
        newText: source.slice(from, to),
      };
      const edits = [edit];
      const undoEdits = [undo];
      const update = live.applyEdits(edits, options);
      const retok = options == null ? changedLines(update) : update.lines.size;
      live.flush();
      assert.equal(live.getText(), edited);
      live.applyEdits(undoEdits);
      assert.equal(live.getText(), source);

      const [incremental, rebuild] = measure(
        [
          {
            run: () => live.applyEdits(edits, options),
            afterEach: () => {
              live.flush();
              live.applyEdits(undoEdits);
            },
          },
          () => codeToTokens(edited, { lang, theme: pierreDark }),
        ],
        { batch: false }
      );
      assert.equal(live.getText(), source);
      bench(name, label, incremental, String(retok));
      bench(name, label + ' / rebuild', rebuild);
    } finally {
      live.dispose();
    }
  }

  const live = new LiveTokenizer({ lang, theme: pierreDark, code: source });
  try {
    const indices = Array.from(
      { length: 100 },
      (_, i) => (i * 7919) % live.lineCount
    );
    const [rawReads, themedReads] = measure(
      [
        () => indices.map((line) => live.getLineRecords(line)),
        () => indices.map((line) => live.getLineTokens(line)),
      ],
      { batch: false }
    );
    bench(name, 'raw reads \u00D7100', rawReads);
    bench(name, 'themed reads \u00D7100', themedReads);
  } finally {
    live.dispose();
  }
}

const pad = (s: string, w: number, right = false) =>
  right ? s.padStart(w) : s.padEnd(w);
const cols = [
  'fixture',
  'scenario',
  'median',
  'p95',
  'samples',
  'changed lines',
] as const;
const widths = [
  Math.max(...rows.map((r) => r.fixture.length), 7),
  Math.max(...rows.map((r) => r.scenario.length), 8),
  Math.max(...rows.map((r) => r.median.length), 6),
  Math.max(...rows.map((r) => r.p95.length), 4),
  Math.max(...rows.map((r) => r.samples.length), 7),
  Math.max(...rows.map((r) => r.lines.length), 13),
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
      pad(r.samples, widths[4], true),
      pad(r.lines, widths[5], true),
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
