import { TextDocument } from '../src/editor/textDocument';
import {
  MAX_SEARCH_MATCHES,
  type SearchPanelState,
  type SearchParams,
} from '../src/search';
import {
  type CodeViewSearchItem,
  CodeViewSearchScan,
} from '../src/search/codeViewSearch';
import type { CodeViewItem, FileDiffMetadata } from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';

interface BenchmarkConfig {
  lines: number[];
  runs: number;
  warmupRuns: number;
  outputJson: boolean;
  only: string | undefined;
}

interface BenchmarkSample {
  collectMs: number;
  matchMs: number;
  totalMs: number;
  matchCount: number;
}

interface TimingSummary {
  bestMs: number;
  medianMs: number;
}

interface BenchmarkSummary {
  name: string;
  lines: number;
  runs: number;
  matchCount: number;
  collect: TimingSummary | null;
  match: TimingSummary | null;
  total: TimingSummary;
}

interface BenchmarkCase {
  name: string;
  expectedLines: number;
  prepare: (
    fixtures: BenchmarkFixtures
  ) => (params: SearchParams) => BenchmarkSample;
}

interface BenchmarkFixtures {
  contents: { before: string; after: string };
  fileDiff: FileDiffMetadata;
}

const DEFAULT_CONFIG: BenchmarkConfig = {
  lines: [10_000, 100_000],
  runs: 5,
  warmupRuns: 2,
  outputJson: false,
  only: undefined,
};

const QUERIES = [
  { name: 'rare-literal', text: 'missing_search_needle', regex: false },
  { name: 'common-literal', text: 'function', regex: false },
  { name: 'regex', text: 'value_[0-9a-f]{8}', regex: true },
];

// Reads fixture sizes, sample counts and output filters from the command line.
function parseArgs(argv: string[]): BenchmarkConfig {
  const config = { ...DEFAULT_CONFIG };
  for (let index = 0; index < argv.length; index++) {
    const rawArg = argv[index];
    if (rawArg === '--help' || rawArg === '-h') {
      console.log('Usage: moonx diffs:benchmark-code-view-search -- [options]');
      console.log('');
      console.log('Options:');
      console.log(
        '  --lines <number>        One size (default: 10000 and 100000; opt into 1000000)'
      );
      console.log(
        `  --runs <number>         Measured runs per case (default: ${DEFAULT_CONFIG.runs})`
      );
      console.log(
        `  --warmup-runs <number>  Warmup runs per case (default: ${DEFAULT_CONFIG.warmupRuns})`
      );
      console.log('  --json                  Emit machine-readable JSON');
      console.log('  --only <substring>      Run matching case names');
      console.log('  -h, --help              Show this help output');
      process.exit(0);
    }
    if (rawArg === '--json') {
      config.outputJson = true;
      continue;
    }
    const [flag, inlineValue] = rawArg.split('=', 2);
    if (
      flag !== '--lines' &&
      flag !== '--runs' &&
      flag !== '--warmup-runs' &&
      flag !== '--only'
    ) {
      throw new Error(`Unknown argument: ${rawArg}`);
    }
    const value = inlineValue ?? argv[index + 1];
    if (value == null) {
      throw new Error(`Missing value for ${flag}`);
    }
    if (inlineValue == null) index++;
    if (flag === '--only') {
      config.only = value;
      continue;
    }
    const parsed = Number(value);
    if (
      !Number.isSafeInteger(parsed) ||
      parsed < (flag === '--warmup-runs' ? 0 : 1)
    ) {
      throw new Error(
        `Invalid ${flag} value "${value}". Expected ${flag === '--warmup-runs' ? 'a non-negative' : 'a positive'} integer.`
      );
    }
    if (flag === '--lines') config.lines = [parsed];
    else if (flag === '--runs') config.runs = parsed;
    else config.warmupRuns = parsed;
  }
  return config;
}

// Seeded source-like lines avoid benchmarking one repeated string. Every tenth
// line changes only its return value, preserving one match per source line.
function createContents(lineCount: number): { before: string; after: string } {
  let seed = 0x12345678;
  const before: string[] = [];
  const after: string[] = [];
  for (let index = 0; index < lineCount; index++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const name = seed.toString(16).padStart(8, '0');
    const prefix = `export function value_${name}() { return record[${index % 1000}] + `;
    before.push(`${prefix}1; }`);
    after.push(`${prefix}${index % 10 === 0 ? 2 : 1}; }`);
  }
  return { before: before.join('\n'), after: after.join('\n') };
}

// Scatter individual inserts so retained documents exercise fragmented pieces.
// For diffs, edit changed lines so the original every-tenth-line shape stays valid.
function createEditedDocument(
  contents: string,
  lineCount: number,
  inserts: number,
  changedLinesOnly = false
): TextDocument {
  const document = new TextDocument('file:///benchmark.ts', contents);
  const editableLines = changedLinesOnly
    ? Math.ceil(lineCount / 10)
    : lineCount;
  for (let index = 0; index < inserts; index++) {
    const line = ((index * 7919) % editableLines) * (changedLinesOnly ? 10 : 1);
    const position = { line, character: 7 };
    document.applyEdits(
      [{ range: { start: position, end: position }, newText: ' ' }],
      false
    );
  }
  return document;
}

// Measures the same scan used by CodeView, including source preparation.
function searchItem(
  getItem: () => CodeViewSearchItem,
  params: SearchParams
): BenchmarkSample {
  const start = performance.now();
  const scan = new CodeViewSearchScan(
    params,
    ['item'],
    getItem,
    MAX_SEARCH_MATCHES
  );
  scan.advance();
  const matches = scan.getItemMatches('item');
  const elapsed = performance.now() - start;
  return {
    collectMs: 0,
    matchMs: elapsed,
    totalMs: elapsed,
    matchCount: matches?.length ?? 0,
  };
}

// Prepare shared single-item source and diff data after selecting its cases.
function createFixtures(lines: number): BenchmarkFixtures {
  const contents = createContents(lines);
  const fileDiff = parseDiffFromFile(
    { name: 'benchmark.ts', contents: contents.before },
    { name: 'benchmark.ts', contents: contents.after },
    { preferredDiffLib: '@pierre/patches', disableLineMatching: true },
    true
  );
  return { contents, fileDiff };
}

// Describe cases before preparing data so filters avoid unneeded large fixtures.
function createCases(lines: number): BenchmarkCase[] {
  const cases: BenchmarkCase[] = [
    {
      name: 'file',
      expectedLines: lines,
      prepare:
        ({ contents }) =>
        (params) =>
          searchItem(
            () => ({ type: 'file', contents: contents.after }),
            params
          ),
    },
  ];
  const diffStyles: ('split' | 'unified')[] = ['split', 'unified'];
  for (const diffStyle of diffStyles) {
    const expectedLines =
      diffStyle === 'split' ? lines * 2 : lines + Math.ceil(lines / 10);
    cases.push({
      name: `diff/${diffStyle}`,
      expectedLines,
      prepare:
        ({ fileDiff }) =>
        (params) =>
          searchItem(
            () => ({ type: 'diff', fileDiff, diffStyle, additionsOnly: false }),
            params
          ),
    });
  }
  for (const inserts of [0, 100, 5000]) {
    cases.push({
      name: `edited-file/inserts-${inserts}`,
      expectedLines: lines,
      prepare: ({ contents }) => {
        const document = createEditedDocument(contents.after, lines, inserts);
        return (params) =>
          searchItem(
            () => ({ type: 'file', contents: document.getText() }),
            params
          );
      },
    });
    for (const diffStyle of diffStyles) {
      const expectedLines =
        diffStyle === 'split' ? lines * 2 : lines + Math.ceil(lines / 10);
      cases.push({
        name: `edited-diff/${diffStyle}/inserts-${inserts}`,
        expectedLines,
        prepare: ({ contents, fileDiff }) => {
          const document = createEditedDocument(
            contents.after,
            lines,
            inserts,
            true
          );
          return (params) =>
            searchItem(
              () => ({
                type: 'diff',
                fileDiff,
                diffStyle,
                additionsOnly: false,
                additionContents: document.getText(),
              }),
              params
            );
        },
      });
    }
  }
  return cases;
}

// Report both the fastest warmed run and the median to expose noisy samples.
function summarize(values: number[]): TimingSummary {
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  return {
    bestMs: values[0],
    medianMs:
      values.length % 2 === 0
        ? (values[middle - 1] + values[middle]) / 2
        : values[middle],
  };
}

// Check counts on every pass so a faster incomplete scan cannot look like a win.
function measureCase(
  scenario: BenchmarkCase,
  run: (params: SearchParams) => BenchmarkSample,
  query: (typeof QUERIES)[number],
  lines: number,
  config: BenchmarkConfig
): BenchmarkSummary {
  const params: SearchParams = {
    text: query.text,
    regex: query.regex,
    replaceText: '',
    caseSensitive: false,
    wholeWord: false,
  };
  const expectedCount =
    query.name === 'rare-literal'
      ? 0
      : Math.min(scenario.expectedLines, MAX_SEARCH_MATCHES);
  const samples: BenchmarkSample[] = [];
  for (let index = 0; index < config.warmupRuns + config.runs; index++) {
    Bun.gc(true);
    const sample = run(params);
    if (sample.matchCount !== expectedCount) {
      throw new Error(
        `${scenario.name}/${query.name}: expected ${expectedCount} matches, got ${sample.matchCount}`
      );
    }
    if (index >= config.warmupRuns) samples.push(sample);
  }
  return {
    name: `${scenario.name}/${query.name}`,
    lines,
    runs: config.runs,
    matchCount: expectedCount,
    collect: summarize(samples.map((sample) => sample.collectMs)),
    match: summarize(samples.map((sample) => sample.matchMs)),
    total: summarize(samples.map((sample) => sample.totalMs)),
  };
}

// Build exact-size collections of files or real split diffs for the public API.
function createCodeViewItems(
  kind: 'files' | 'diffs',
  lines: number
): CodeViewItem<undefined>[] {
  const items: CodeViewItem<undefined>[] = [];
  for (let startLine = 0; startLine < lines; startLine += 1000) {
    const contents = createContents(Math.min(1000, lines - startLine));
    const id = `item-${items.length}`;
    const name = `${id}.txt`;
    if (kind === 'files') {
      items.push({
        id,
        type: 'file',
        file: { name, contents: contents.after },
      });
    } else {
      items.push({
        id,
        type: 'diff',
        fileDiff: parseDiffFromFile(
          { name, contents: contents.before },
          { name, contents: contents.after },
          { preferredDiffLib: '@pierre/patches', disableLineMatching: true },
          true
        ),
      });
    }
  }
  return items;
}

// Match the query as well as the count so an empty-query report cannot pass a
// rare search whose expected count is also zero.
function hasExpectedSearchState(
  state: SearchPanelState | undefined,
  query: (typeof QUERIES)[number],
  expectedCount: number
): boolean {
  return state?.text === query.text && state.matchCount === expectedCount;
}

// Time the public query update across the requested items. Setup and waiting for
// the final query and count stay outside the timer, measuring synchronous work.
async function measureCodeViewCase(
  kind: 'files' | 'diffs',
  query: (typeof QUERIES)[number],
  lines: number,
  config: BenchmarkConfig
): Promise<BenchmarkSummary> {
  const [
    { CodeView },
    { disposeHighlighter, getSharedHighlighter },
    { createRoot, installDom, renderItems, wait, waitFor },
  ] = await Promise.all([
    import('../src/components/CodeView'),
    import('../src/highlighter/shared_highlighter'),
    import('../test/domHarness'),
  ]);
  await getSharedHighlighter({
    themes: ['pierre-dark', 'pierre-light'],
    langs: ['text'],
    preferredHighlighter: 'shiki-js',
  });
  const dom = installDom();
  let searchState: SearchPanelState | undefined;
  const viewer = new CodeView({
    searchOptions: { defaults: { regex: query.regex, caseSensitive: false } },
    onSearchStateChange: (state) => {
      searchState = state;
    },
  });
  const name = `code-view/${kind}/${query.name}`;
  const expectedCount =
    query.name === 'rare-literal'
      ? 0
      : Math.min(lines * (kind === 'diffs' ? 2 : 1), MAX_SEARCH_MATCHES);
  try {
    const root = createRoot();
    viewer.setup(root);
    const items = createCodeViewItems(kind, lines);
    await renderItems(viewer, items);
    const samples: number[] = [];
    for (let index = 0; index < config.warmupRuns + config.runs; index++) {
      viewer.openSearch({ query: '', scope: 'all', mode: 'find' });
      await wait(0);
      Bun.gc(true);
      const start = performance.now();
      viewer.openSearch({ query: query.text, scope: 'all', mode: 'find' });
      const elapsed = performance.now() - start;
      await waitFor(() =>
        hasExpectedSearchState(searchState, query, expectedCount)
      );
      if (!hasExpectedSearchState(searchState, query, expectedCount)) {
        throw new Error(
          `${name}: expected query "${query.text}" with ${expectedCount} matches, got query "${searchState?.text}" with ${searchState?.matchCount}`
        );
      }
      if (index >= config.warmupRuns) samples.push(elapsed);
      viewer.closeSearch();
    }
    return {
      name,
      lines,
      runs: config.runs,
      matchCount: expectedCount,
      collect: null,
      match: null,
      total: summarize(samples),
    };
  } finally {
    viewer.cleanUp();
    dom.cleanup();
    await disposeHighlighter();
  }
}

const config = parseArgs(process.argv.slice(2));
const results: BenchmarkSummary[] = [];
const codeViewKinds: ('files' | 'diffs')[] = ['files', 'diffs'];
for (const lines of config.lines) {
  const cases = createCases(lines)
    .map((scenario) => ({
      scenario,
      queries: QUERIES.filter(
        (query) =>
          config.only == null ||
          `${scenario.name}/${query.name}`.includes(config.only)
      ),
    }))
    .filter(({ queries }) => queries.length > 0);
  if (cases.length > 0) {
    const fixtures = createFixtures(lines);
    for (const { scenario, queries } of cases) {
      const run = scenario.prepare(fixtures);
      for (const query of queries) {
        results.push(measureCase(scenario, run, query, lines, config));
      }
    }
  }
  for (const kind of codeViewKinds) {
    for (const query of QUERIES) {
      if (
        config.only == null ||
        `code-view/${kind}/${query.name}`.includes(config.only)
      ) {
        results.push(await measureCodeViewCase(kind, query, lines, config));
      }
    }
  }
}
if (results.length === 0)
  throw new Error(`No cases match --only "${config.only}"`);

if (config.outputJson) {
  console.log(
    JSON.stringify(
      {
        config,
        maxSearchMatches: MAX_SEARCH_MATCHES,
        measurement: {
          fixturePreparationExcluded: true,
          forcedGcBeforeTiming: true,
          perItemMatchingIncludesPreparation: true,
          codeView:
            'Synchronous public query update in jsdom at every configured size and query, for files and split diffs in items of up to 1000 lines; final-query/count waiting excluded',
        },
        results,
      },
      null,
      2
    )
  );
} else {
  console.log(
    `CodeView search: ${config.runs} measured runs, ${config.warmupRuns} warmups per case; cap=${MAX_SEARCH_MATCHES}`
  );
  console.log(
    'Times are best/median ms. Per-item scans include preparation and matching; collection is zero. Fixture preparation and forced GC are excluded.'
  );
  console.log(
    'CodeView cases search files and split diffs at every configured size and query, in items of up to 1000 lines. Total is the synchronous public query update in jsdom; final-query/count waiting is excluded.'
  );
  console.table(
    results.map((result) => ({
      name: result.name,
      lines: result.lines,
      count: result.matchCount,
      collect:
        result.collect == null
          ? 'N/A'
          : `${result.collect.bestMs.toFixed(3)}/${result.collect.medianMs.toFixed(3)}`,
      match:
        result.match == null
          ? 'N/A'
          : `${result.match.bestMs.toFixed(3)}/${result.match.medianMs.toFixed(3)}`,
      total: `${result.total.bestMs.toFixed(3)}/${result.total.medianMs.toFixed(3)}`,
    }))
  );
}
