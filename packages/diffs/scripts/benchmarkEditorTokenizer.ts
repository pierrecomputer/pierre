import { type IGrammar, type StateStack } from 'shiki/textmate';

import { TextDocument } from '../src/editor/textDocument';
import { EditorTokenizer } from '../src/editor/tokenizer';
import type { DiffsHighlighter, RenderRange } from '../src/types';

interface BenchmarkConfig {
  lines: number;
  runs: number;
  warmupRuns: number;
  outputJson: boolean;
}

interface BenchmarkSample {
  elapsedMs: number;
  operations: Record<string, number>;
}

interface BenchmarkCase {
  name: string;
  description: string;
  run: () => BenchmarkSample;
}

interface BenchmarkSummary {
  name: string;
  description: string;
  runs: number;
  meanMs: number;
  medianMs: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
  operations: Record<string, number>;
}

interface MockCounters {
  grammarCalls: number;
  setThemeCalls: number;
}

const DEFAULT_CONFIG: BenchmarkConfig = {
  lines: 100_000,
  runs: 10,
  warmupRuns: 3,
  outputJson: false,
};

const TOKEN_DATA = new Uint32Array([0, 0]);
const messageListeners = new Set<EventListenerOrEventListenerObject>();
const postedMessages: unknown[] = [];
let mutationCallback: ((records: MutationRecord[]) => void) | undefined;

Reflect.set(globalThis, 'window', globalThis);
Reflect.set(globalThis, 'matchMedia', () => ({
  addEventListener() {},
  addListener() {},
  dispatchEvent() {
    return false;
  },
  matches: true,
  media: '(prefers-color-scheme: dark)',
  onchange: null,
  removeEventListener() {},
  removeListener() {},
}));
Reflect.set(globalThis, 'document', {
  body: {},
  documentElement: {},
});
Reflect.set(globalThis, 'getComputedStyle', () => ({
  colorScheme: 'dark',
}));
Reflect.set(
  globalThis,
  'MutationObserver',
  class {
    constructor(callback: MutationCallback) {
      mutationCallback = (records) =>
        callback(records, this as unknown as MutationObserver);
    }

    observe() {}

    disconnect() {}

    takeRecords() {
      return [];
    }
  }
);
Reflect.set(
  globalThis,
  'addEventListener',
  (type: string, listener: EventListenerOrEventListenerObject) => {
    if (type === 'message') {
      messageListeners.add(listener);
    }
  }
);
Reflect.set(
  globalThis,
  'removeEventListener',
  (type: string, listener: EventListenerOrEventListenerObject) => {
    if (type === 'message') {
      messageListeners.delete(listener);
    }
  }
);
Reflect.set(globalThis, 'postMessage', (message: unknown) => {
  postedMessages.push(message);
});

function parseInteger(
  value: string,
  flagName: string,
  allowZero = false
): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < (allowZero ? 0 : 1)) {
    throw new Error(
      `Invalid ${flagName} value "${value}". Expected ${allowZero ? 'a non-negative' : 'a positive'} integer.`
    );
  }
  return parsed;
}

function parseArgs(argv: string[]): BenchmarkConfig {
  const config = { ...DEFAULT_CONFIG };
  for (let index = 0; index < argv.length; index++) {
    const rawArg = argv[index];
    if (rawArg === '--help' || rawArg === '-h') {
      console.log('Usage: moonx diffs:benchmark-editor-tokenizer -- [options]');
      console.log('');
      console.log('Options:');
      console.log(
        `  --lines <number>        Document lines (default: ${DEFAULT_CONFIG.lines})`
      );
      console.log(
        `  --runs <number>         Measured runs per case (default: ${DEFAULT_CONFIG.runs})`
      );
      console.log(
        `  --warmup-runs <number>  Warmup runs per case (default: ${DEFAULT_CONFIG.warmupRuns})`
      );
      console.log('  --json                  Emit machine-readable JSON');
      console.log('  -h, --help              Show this help output');
      process.exit(0);
    }
    if (rawArg === '--json') {
      config.outputJson = true;
      continue;
    }

    const [flag, inlineValue] = rawArg.split('=', 2);
    const value = inlineValue ?? argv[index + 1];
    if (flag === '--lines' || flag === '--runs' || flag === '--warmup-runs') {
      if (value === undefined) {
        throw new Error(`Missing value for ${flag}`);
      }
      if (inlineValue === undefined) {
        index++;
      }
      const parsed = parseInteger(value, flag, flag === '--warmup-runs');
      if (flag === '--lines') {
        config.lines = parsed;
      } else if (flag === '--runs') {
        config.runs = parsed;
      } else {
        config.warmupRuns = parsed;
      }
      continue;
    }
    throw new Error(`Unknown argument: ${rawArg}`);
  }
  if (config.lines < 2) {
    throw new Error('--lines must be at least 2');
  }
  return config;
}

function percentile(sortedValues: number[], rank: number): number {
  const index = (sortedValues.length - 1) * rank;
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);
  const lower = sortedValues[lowerIndex] ?? 0;
  const upper = sortedValues[upperIndex] ?? lower;
  return lower + (upper - lower) * (index - lowerIndex);
}

function createTokenizer(
  textDocument: TextDocument<unknown>,
  counters: MockCounters,
  options: {
    matchBrackets?: boolean;
    systemTheme?: boolean;
    onThemeChange?: () => void;
  } = {}
): EditorTokenizer {
  const grammar = {
    tokenizeLine2(_lineText: string, ruleStack: StateStack) {
      counters.grammarCalls++;
      return {
        tokens: TOKEN_DATA,
        ruleStack,
        stoppedEarly: false,
      };
    },
  } as unknown as IGrammar;
  const highlighter = {
    getLanguage: () => grammar,
    getLoadedLanguages: () => ['typescript'],
    getTheme: () => ({ colors: {} }),
    setTheme: (themeName: string) => {
      counters.setThemeCalls++;
      return {
        colorMap: [''],
        theme: { name: themeName, type: 'dark' },
      };
    },
  } as unknown as DiffsHighlighter;
  return new EditorTokenizer({
    highlighter,
    textDocument,
    codeOptions:
      options.systemTheme === true
        ? {
            theme: { dark: 'dark-theme', light: 'light-theme' },
            themeType: 'system',
          }
        : { theme: 'dark-theme', themeType: 'dark' },
    matchBrackets: options.matchBrackets,
    setStyle() {},
    onDeferTokenize() {},
    onThemeChange: options.onThemeChange,
  });
}

function primeTokenizer(
  tokenizer: EditorTokenizer,
  textDocument: TextDocument<unknown>
): void {
  const lineCount = textDocument.lineCount;
  tokenizer.tokenize(
    {
      startLine: 0,
      startCharacter: 0,
      endCharacter: 0,
      endLine: lineCount - 1,
      endedAtDocumentEnd: false,
      previousLineCount: lineCount,
      lineCount,
      lineDelta: 0,
      changedLineRanges: [[0, lineCount - 1]],
    },
    {
      startingLine: 0,
      totalLines: lineCount,
      bufferBefore: 0,
      bufferAfter: 0,
    }
  );
}

function resetMessages(): void {
  if (messageListeners.size > 0) {
    throw new Error('A benchmark case leaked a background message listener');
  }
  postedMessages.length = 0;
}

function dispatchMessage(data: unknown): void {
  const event = { data } as MessageEvent;
  for (const listener of [...messageListeners]) {
    if (typeof listener === 'function') {
      listener(event);
    } else {
      listener.handleEvent(event);
    }
  }
}

function drainMessages(counters: MockCounters, maxMessages: number): number {
  const originalPerformanceNow = performance.now;
  let messageIndex = 0;
  Object.defineProperty(performance, 'now', {
    configurable: true,
    value: () => counters.grammarCalls / 1000,
  });
  try {
    while (messageIndex < postedMessages.length) {
      if (messageIndex >= maxMessages) {
        throw new Error('Background tokenizer did not settle');
      }
      dispatchMessage(postedMessages[messageIndex]);
      messageIndex++;
    }
  } finally {
    Object.defineProperty(performance, 'now', {
      configurable: true,
      value: originalPerformanceNow,
    });
  }
  return messageIndex;
}

function collectGarbage(): void {
  if (typeof Bun !== 'undefined') {
    Bun.gc(true);
  }
}

function createBenchmarkCases(
  config: BenchmarkConfig,
  sourceText: string
): BenchmarkCase[] {
  const fullRange: RenderRange = {
    startingLine: 0,
    totalLines: config.lines,
    bufferBefore: 0,
    bufferAfter: 0,
  };

  return [
    {
      name: 'unbounded-structural-edit',
      description:
        'Insert a newline at line 0 after fully populating tokenizer state.',
      run() {
        resetMessages();
        const counters = { grammarCalls: 0, setThemeCalls: 0 };
        const textDocument = new TextDocument(
          'structural.ts',
          sourceText,
          'typescript'
        );
        const tokenizer = createTokenizer(textDocument, counters, {
          matchBrackets: false,
        });
        primeTokenizer(tokenizer, textDocument);
        const change = textDocument.applyEdits([
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 0 },
            },
            newText: 'inserted\n',
          },
        ]);
        if (change === undefined) {
          throw new Error(
            'Expected the structural edit to change the document'
          );
        }
        counters.grammarCalls = 0;
        postedMessages.length = 0;
        collectGarbage();
        const started = performance.now();
        const dirtyLines = tokenizer.tokenize(change);
        const elapsedMs = performance.now() - started;
        const operations = {
          grammarCalls: counters.grammarCalls,
          dirtyLines: dirtyLines.size,
          backgroundMessages: postedMessages.length,
        };
        tokenizer.cleanUp();
        return { elapsedMs, operations };
      },
    },
    {
      name: 'deep-state-prebuild',
      description:
        'Start grammar-state preparation for a viewport at the document tail.',
      run() {
        resetMessages();
        const counters = { grammarCalls: 0, setThemeCalls: 0 };
        const textDocument = new TextDocument(
          'prebuild.ts',
          sourceText,
          'typescript'
        );
        const tokenizer = createTokenizer(textDocument, counters, {
          matchBrackets: false,
        });
        collectGarbage();
        const started = performance.now();
        tokenizer.prebuildStateStack({
          ...fullRange,
          startingLine: config.lines - 1,
          totalLines: 1,
        });
        const elapsedMs = performance.now() - started;
        const synchronousGrammarCalls = counters.grammarCalls;
        const backgroundMessages = drainMessages(
          counters,
          textDocument.lineCount + 1
        );
        const operations = {
          synchronousGrammarCalls,
          backgroundMessages,
          totalGrammarCalls: counters.grammarCalls,
        };
        tokenizer.cleanUp();
        return { elapsedMs, operations };
      },
    },
    {
      name: 'bracket-cache-invalidation',
      description:
        'Edit one character at line 0 after caching bracket ranges for every line.',
      run() {
        resetMessages();
        const counters = { grammarCalls: 0, setThemeCalls: 0 };
        const textDocument = new TextDocument(
          'brackets.ts',
          sourceText,
          'typescript'
        );
        const tokenizer = createTokenizer(textDocument, counters, {
          matchBrackets: true,
        });
        primeTokenizer(tokenizer, textDocument);
        const change = textDocument.applyEdits([
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 1 },
            },
            newText: 'L',
          },
        ]);
        if (change === undefined) {
          throw new Error('Expected the same-line edit to change the document');
        }
        counters.grammarCalls = 0;
        collectGarbage();
        const started = performance.now();
        const dirtyLines = tokenizer.tokenize(change, {
          ...fullRange,
          totalLines: 1,
        });
        const elapsedMs = performance.now() - started;
        const operations = {
          grammarCalls: counters.grammarCalls,
          dirtyLines: dirtyLines.size,
        };
        tokenizer.cleanUp();
        return { elapsedMs, operations };
      },
    },
    {
      name: 'comparison-state-remap-no-baseline',
      description:
        'Informational only: remap and converge many structural edits; no permanent pre-fix baseline was captured.',
      run() {
        resetMessages();
        const counters = { grammarCalls: 0, setThemeCalls: 0 };
        const textDocument = new TextDocument(
          'remap.ts',
          sourceText,
          'typescript'
        );
        const tokenizer = createTokenizer(textDocument, counters, {
          matchBrackets: false,
        });
        primeTokenizer(tokenizer, textDocument);
        const editCount = Math.min(
          128,
          config.lines,
          Math.max(2, Math.floor(config.lines / 1000))
        );
        const edits = Array.from({ length: editCount }, (_, index) => {
          const line = Math.floor(
            ((index + 1) * config.lines) / (editCount + 1)
          );
          return {
            range: {
              start: { line, character: 0 },
              end: { line, character: 0 },
            },
            newText: 'inserted\n',
          };
        });
        const change = textDocument.applyEdits(edits);
        if (change === undefined) {
          throw new Error('Expected structural edits to change the document');
        }
        counters.grammarCalls = 0;
        postedMessages.length = 0;
        collectGarbage();
        const started = performance.now();
        tokenizer.tokenize(change, {
          startingLine: change.startLine,
          totalLines: 1,
          bufferBefore: 0,
          bufferAfter: 0,
        });
        const elapsedMs = performance.now() - started;
        const synchronousGrammarCalls = counters.grammarCalls;
        const backgroundMessages = drainMessages(
          counters,
          textDocument.lineCount + 1
        );
        const operations = {
          edits: editCount,
          changedLineChanges: change.changedLineChanges?.length ?? 0,
          synchronousGrammarCalls,
          backgroundMessages,
          totalGrammarCalls: counters.grammarCalls,
        };
        tokenizer.cleanUp();
        return { elapsedMs, operations };
      },
    },
    {
      name: 'no-op-theme-mutation',
      description:
        'Notify an unchanged system-theme tokenizer of a root class mutation.',
      run() {
        resetMessages();
        mutationCallback = undefined;
        let themeChangeCallbacks = 0;
        const counters = { grammarCalls: 0, setThemeCalls: 0 };
        const textDocument = new TextDocument(
          'theme.ts',
          'line 0\nline 1',
          'typescript'
        );
        const tokenizer = createTokenizer(textDocument, counters, {
          matchBrackets: false,
          systemTheme: true,
          onThemeChange: () => {
            themeChangeCallbacks++;
          },
        });
        const callback = mutationCallback;
        if (callback === undefined) {
          throw new Error('Expected a system-theme MutationObserver');
        }
        counters.setThemeCalls = 0;
        collectGarbage();
        const started = performance.now();
        callback([
          {
            attributeName: 'class',
            type: 'attributes',
          } as MutationRecord,
        ]);
        const elapsedMs = performance.now() - started;
        const operations = {
          backgroundRestarts: postedMessages.length,
          setThemeCalls: counters.setThemeCalls,
          themeChangeCallbacks,
        };
        tokenizer.cleanUp();
        mutationCallback = undefined;
        return { elapsedMs, operations };
      },
    },
    {
      name: 'multi-instance-message-collision',
      description:
        'Dispatch one tokenizer job message while two tokenizer jobs are active.',
      run() {
        resetMessages();
        const counters = [
          { grammarCalls: 0, setThemeCalls: 0 },
          { grammarCalls: 0, setThemeCalls: 0 },
        ];
        const tokenizers = counters.map((counter, index) => {
          const textDocument = new TextDocument(
            `collision-${index}.ts`,
            'line 0\nline 1',
            'typescript'
          );
          const tokenizer = createTokenizer(textDocument, counter, {
            matchBrackets: false,
          });
          tokenizer.tokenize(
            {
              startLine: 0,
              startCharacter: 0,
              endCharacter: 0,
              endLine: 1,
              endedAtDocumentEnd: false,
              previousLineCount: 2,
              lineCount: 2,
              lineDelta: 0,
              changedLineRanges: [[0, 1]],
            },
            {
              startingLine: 0,
              totalLines: 1,
              bufferBefore: 0,
              bufferAfter: 0,
            }
          );
          return tokenizer;
        });
        const firstMessage = postedMessages[0];
        if (firstMessage === undefined || messageListeners.size !== 2) {
          throw new Error('Expected two active tokenizer background jobs');
        }
        counters[0].grammarCalls = 0;
        counters[1].grammarCalls = 0;
        collectGarbage();
        const started = performance.now();
        dispatchMessage(firstMessage);
        const elapsedMs = performance.now() - started;
        const operations = {
          sourceGrammarCalls: counters[0].grammarCalls,
          foreignGrammarCalls: counters[1].grammarCalls,
          triggeredInstances:
            Number(counters[0].grammarCalls > 0) +
            Number(counters[1].grammarCalls > 0),
        };
        for (const tokenizer of tokenizers) {
          tokenizer.cleanUp();
        }
        return { elapsedMs, operations };
      },
    },
  ];
}

function summarize(
  benchmarkCase: BenchmarkCase,
  samples: BenchmarkSample[]
): BenchmarkSummary {
  const elapsed = samples
    .map((sample) => sample.elapsedMs)
    .sort((left, right) => left - right);
  const operations = samples[0]?.operations ?? {};
  const expectedOperations = JSON.stringify(operations);
  for (const sample of samples) {
    if (JSON.stringify(sample.operations) !== expectedOperations) {
      throw new Error(
        `Non-deterministic operation counts in ${benchmarkCase.name}`
      );
    }
  }
  const total = elapsed.reduce((sum, value) => sum + value, 0);
  return {
    name: benchmarkCase.name,
    description: benchmarkCase.description,
    runs: elapsed.length,
    meanMs: total / elapsed.length,
    medianMs: percentile(elapsed, 0.5),
    p95Ms: percentile(elapsed, 0.95),
    minMs: elapsed[0] ?? 0,
    maxMs: elapsed[elapsed.length - 1] ?? 0,
    operations,
  };
}

function printTable(summaries: BenchmarkSummary[]): void {
  const rows = summaries.map((summary) => ({
    scenario: summary.name,
    median: summary.medianMs.toFixed(3),
    p95: summary.p95Ms.toFixed(3),
    min: summary.minMs.toFixed(3),
    max: summary.maxMs.toFixed(3),
    operations: Object.entries(summary.operations)
      .map(([key, value]) => `${key}=${value}`)
      .join(','),
  }));
  const headers = [
    'scenario',
    'median',
    'p95',
    'min',
    'max',
    'operations',
  ] as const;
  const widths = headers.map((header) =>
    rows.reduce(
      (width, row) => Math.max(width, row[header].length),
      header.length
    )
  );
  const formatRow = (row: Record<(typeof headers)[number], string>) =>
    headers
      .map((header, index) => row[header].padEnd(widths[index]))
      .join('  ')
      .trimEnd();
  console.log(formatRow(Object.fromEntries(headers.map((key) => [key, key]))));
  console.log(widths.map((width) => '-'.repeat(width)).join('  '));
  for (const row of rows) {
    console.log(formatRow(row));
  }
}

function main(): void {
  const config = parseArgs(process.argv.slice(2));
  const sourceText = Array.from(
    { length: config.lines },
    (_, index) => `const value${index} = ${index};`
  ).join('\n');
  const benchmarkCases = createBenchmarkCases(config, sourceText);
  const samples = benchmarkCases.map(() => [] as BenchmarkSample[]);
  let checksum = 0;

  for (let run = 0; run < config.warmupRuns; run++) {
    for (let offset = 0; offset < benchmarkCases.length; offset++) {
      benchmarkCases[(run + offset) % benchmarkCases.length].run();
    }
  }
  for (let run = 0; run < config.runs; run++) {
    for (let offset = 0; offset < benchmarkCases.length; offset++) {
      const caseIndex = (run + offset) % benchmarkCases.length;
      const sample = benchmarkCases[caseIndex].run();
      samples[caseIndex].push(sample);
      checksum += Object.values(sample.operations).reduce(
        (sum, value) => sum + value,
        0
      );
    }
  }

  const summaries = benchmarkCases.map((benchmarkCase, index) =>
    summarize(benchmarkCase, samples[index])
  );
  const result = {
    benchmark: 'EditorTokenizer',
    config,
    measurement: {
      setupExcluded: true,
      forcedGcBeforeTiming: true,
      prebuildDebounceExcluded: true,
      backgroundDrainExcluded: true,
      backgroundDrainClock: '1ms per 1000 mock grammar calls',
      grammar: 'deterministic one-token mock',
    },
    checksum,
    summaries,
  };
  if (config.outputJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log('EditorTokenizer benchmark');
  console.log(
    `lines=${config.lines} runsPerCase=${config.runs} warmupRunsPerCase=${config.warmupRuns}`
  );
  console.log(
    'Setup, forced GC, and the prebuild debounce delay are excluded from timings.'
  );
  console.log('');
  printTable(summaries);
  console.log('');
  for (const summary of summaries) {
    console.log(`${summary.name}: ${summary.description}`);
  }
  console.log(`checksum=${checksum}`);
}

const originalSetTimeout = globalThis.setTimeout;
Reflect.set(globalThis, 'setTimeout', ((callback: () => void) => {
  callback();
  return 0;
}) as unknown as typeof setTimeout);
try {
  main();
} finally {
  Reflect.set(globalThis, 'setTimeout', originalSetTimeout);
}
