import { pierreDark } from '@pierre/highlights/themes';

import { TextDocument } from '../src/editor/textDocument';
import { EditorTokenizer } from '../src/editor/tokenizer';
import type { TextEdit } from '../src/editor/types';
import type { DiffsHighlighter, RenderRange } from '../src/types';

const config = { lines: 100_000, runs: 10, warmupRuns: 3, outputJson: false };
for (let index = 2; index < process.argv.length; index++) {
  const argument = process.argv[index];
  if (argument === '--help' || argument === '-h') {
    console.log(
      'Usage: moonx diffs:benchmark-editor-tokenizer -- [--lines N] [--runs N] [--warmup-runs N] [--json]'
    );
    process.exit(0);
  }
  if (argument === '--json') {
    config.outputJson = true;
    continue;
  }
  const [flag, inlineValue] = argument.split('=', 2);
  const key =
    flag === '--lines'
      ? 'lines'
      : flag === '--runs'
        ? 'runs'
        : flag === '--warmup-runs'
          ? 'warmupRuns'
          : undefined;
  if (key === undefined) throw new Error(`Unknown option: ${flag}`);
  const value = Number(inlineValue ?? process.argv[++index]);
  if (
    !Number.isInteger(value) ||
    value < (key === 'warmupRuns' ? 0 : key === 'lines' ? 2 : 1)
  ) {
    throw new Error(
      `Invalid ${flag}: expected a ${key === 'warmupRuns' ? 'non-negative' : 'positive'} integer`
    );
  }
  config[key] = value;
}

Reflect.set(globalThis, 'window', {
  matchMedia: () => ({ matches: true }),
});
const highlighter = {
  getTheme: () => pierreDark,
} as unknown as DiffsHighlighter;
const code = Array.from(
  { length: config.lines },
  (_, line) => `const value${line} = "line ${line}";`
).join('\n');
const fullRange: RenderRange = {
  startingLine: 0,
  totalLines: config.lines,
  bufferBefore: 0,
  bufferAfter: 0,
};
const viewport: RenderRange = {
  ...fullRange,
  totalLines: Math.min(100, config.lines),
};
const middleLine = Math.floor(config.lines / 2);
const cases: {
  name: string;
  edits: TextEdit[];
  range: RenderRange;
  realign?: boolean;
}[] = [
  {
    name: 'single-line',
    edits: [
      {
        range: {
          start: { line: middleLine, character: 0 },
          end: { line: middleLine, character: 5 },
        },
        newText: 'let',
      },
    ],
    range: fullRange,
  },
  {
    name: 'disjoint-lines',
    edits: [0, config.lines - 1].map((line) => ({
      range: { start: { line, character: 0 }, end: { line, character: 5 } },
      newText: 'let',
    })),
    range: fullRange,
  },
  {
    name: 'visible-newline',
    edits: [
      {
        range: {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 0 },
        },
        newText: 'const inserted = true;\n',
      },
    ],
    range: viewport,
  },
  {
    name: 'visible-newline-realigned',
    edits: [
      {
        range: {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 0 },
        },
        newText: 'const inserted = true;\n',
      },
    ],
    range: viewport,
    realign: true,
  },
  {
    name: 'multiline-state',
    edits: [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
        newText: '/*',
      },
    ],
    range: fullRange,
  },
  {
    name: 'multiline-state-viewport',
    edits: [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
        newText: '/*',
      },
    ],
    range: viewport,
  },
];
const results = [];
for (const benchmark of cases) {
  const samples: number[] = [];
  let foregroundLines = 0;
  for (let run = -config.warmupRuns; run < config.runs; run++) {
    const document = new TextDocument('benchmark.ts', code, 'typescript');
    const tokenizer = new EditorTokenizer({
      highlighter,
      textDocument: document,
      codeOptions: { theme: 'pierre-dark', themeType: 'dark' },
      setStyle() {},
      onDeferTokenize() {},
    });
    try {
      // Finish the initial document before timing an incremental edit.
      tokenizer.getStringCommentRegexpRangesInLine(config.lines - 1);
      const change = document.applyEdits(benchmark.edits);
      if (change === undefined) throw new Error('Expected benchmark edit');
      const start = performance.now();
      const lines = tokenizer.tokenize(
        change,
        benchmark.range,
        benchmark.realign
      );
      const elapsed = performance.now() - start;
      if (run >= 0) samples.push(elapsed);
      foregroundLines = lines.size;
    } finally {
      tokenizer.cleanUp();
    }
  }
  samples.sort((a, b) => a - b);
  results.push({
    name: benchmark.name,
    medianMs: samples[Math.floor(samples.length / 2)],
    p95Ms:
      samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))],
    meanMs: samples.reduce((sum, value) => sum + value, 0) / samples.length,
    foregroundLines,
  });
}
if (config.outputJson)
  console.log(JSON.stringify({ config, results }, null, 2));
else {
  console.log(
    `Editor tokenizer: ${config.lines.toLocaleString()} lines, ${config.runs} runs`
  );
  console.table(results);
}
