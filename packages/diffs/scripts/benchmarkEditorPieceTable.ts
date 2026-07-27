import { PieceTable } from '../src/editor/pieceTable';

const line = 'function benchmark(value: number) { return value + 1; }\n';
const lineCount = 12_000;
const text = line.repeat(lineCount);
const editCount = 2_000;
const scatteredOffsets = Array.from({ length: editCount }, (_, i) => {
  const lineIndex = (i * 7919) % lineCount;
  return lineIndex * line.length + 9 + (i % 20);
});
const batchEdits = Array.from({ length: editCount }, (_, i) => {
  const lineIndex = Math.floor(((i + 1) * lineCount) / (editCount + 1));
  const start = lineIndex * line.length + 20;
  return { start, end: start + 1, text: i % 2 === 0 ? 'x' : 'y' };
});
const lookupOffsets = Array.from(
  { length: 20_000 },
  (_, i) => (i * 104729) % text.length
);
const sliceOffsets = Array.from(
  { length: 5_000 },
  (_, i) => (i * 48611) % (text.length - 80)
);

const createFragmentedTable = () => {
  const table = new PieceTable(text);
  for (let i = 0; i < scatteredOffsets.length; i++) {
    const start = scatteredOffsets[i];
    table.applyEdits([
      { start, end: start + 1, text: i % 2 === 0 ? 'q' : 'z' },
    ]);
  }
  return table;
};

const scenarios: {
  name: string;
  operations: number;
  prepare: () => () => number;
}[] = [
  {
    name: 'construct/large-document',
    operations: 1,
    prepare: () => () => new PieceTable(text).lineCount,
  },
  {
    name: 'edit/sequential-typing',
    operations: 5_000,
    prepare: () => {
      const table = new PieceTable('');
      return () => {
        for (let i = 0; i < 5_000; i++) {
          table.insert('x', i);
        }
        return table.getText().length;
      };
    },
  },
  {
    name: 'edit/scattered-inserts',
    operations: scatteredOffsets.length,
    prepare: () => {
      const table = new PieceTable(text);
      return () => {
        for (const offset of scatteredOffsets) {
          table.insert('x', offset);
        }
        return table.lineCount;
      };
    },
  },
  {
    name: 'edit/append-after-fragmentation',
    operations: 2_000,
    prepare: () => {
      const table = createFragmentedTable();
      const end = text.length;
      return () => {
        for (let i = 0; i < 2_000; i++) {
          table.insert('x', end + i);
        }
        return table.lineCount;
      };
    },
  },
  {
    name: 'edit/batch-replacements',
    operations: batchEdits.length,
    prepare: () => {
      const table = new PieceTable(text);
      return () => {
        table.applyEdits(batchEdits);
        return table.lineCount;
      };
    },
  },
  {
    name: 'read/fragmented-position-round-trips',
    operations: lookupOffsets.length,
    prepare: () => {
      const table = createFragmentedTable();
      return () => {
        let checksum = 0;
        for (const offset of lookupOffsets) {
          const position = table.positionAt(offset);
          checksum += table.offsetAt(position);
        }
        return checksum;
      };
    },
  },
  {
    name: 'read/fragmented-slices',
    operations: sliceOffsets.length,
    prepare: () => {
      const table = createFragmentedTable();
      return () => {
        let checksum = 0;
        for (const start of sliceOffsets) {
          checksum += table.getTextSlice(start, start + 80).length;
        }
        return checksum;
      };
    },
  },
  {
    name: 'search/fragmented-whole-word',
    operations: lineCount,
    prepare: () => {
      const table = createFragmentedTable();
      return () =>
        table.search({
          text: 'function',
          replaceText: '',
          caseSensitive: true,
          wholeWord: true,
          regex: false,
        }).length;
    },
  },
];

const results: {
  name: string;
  operations: number;
  p50Ms: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
  opsPerSecond: number;
  samplesMs: number[];
}[] = [];
let checksum = 0;
for (const scenario of scenarios) {
  for (let i = 0; i < 2; i++) {
    checksum += scenario.prepare()();
  }

  const samplesMs: number[] = [];
  for (let i = 0; i < 9; i++) {
    const run = scenario.prepare();
    const start = performance.now();
    checksum += run();
    samplesMs.push(performance.now() - start);
  }
  samplesMs.sort((a, b) => a - b);
  const p50Ms = samplesMs[Math.floor(samplesMs.length / 2)];
  const p95Ms = samplesMs[Math.ceil(samplesMs.length * 0.95) - 1];
  results.push({
    name: scenario.name,
    operations: scenario.operations,
    p50Ms,
    p95Ms,
    minMs: samplesMs[0],
    maxMs: samplesMs[samplesMs.length - 1],
    opsPerSecond: scenario.operations / (p50Ms / 1000),
    samplesMs,
  });
}

if (checksum <= 0) {
  throw new Error('PieceTable benchmark produced an invalid checksum');
}
console.table(
  results.map(({ name, p50Ms, p95Ms, minMs, maxMs, opsPerSecond }) => ({
    name,
    p50Ms: p50Ms.toFixed(3),
    p95Ms: p95Ms.toFixed(3),
    minMs: minMs.toFixed(3),
    maxMs: maxMs.toFixed(3),
    opsPerSecond: Math.round(opsPerSecond),
  }))
);
console.log(`PIECE_TABLE_BENCHMARK_RESULTS=${JSON.stringify(results)}`);
