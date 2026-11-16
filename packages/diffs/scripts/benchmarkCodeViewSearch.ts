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
  completion?: TimingSummary;
  blocked?: TimingSummary;
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
  const scan = new CodeViewSearchScan(params, 1, getItem, MAX_SEARCH_MATCHES);
  scan.advance();
  const matches = scan.getItemMatches(0);
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
            () => ({
              type: 'file',
              itemId: 'item',
              contents: contents.after,
            }),
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
            () => ({
              type: 'diff',
              itemId: 'item',
              fileDiff,
              diffStyle,
              additionsOnly: false,
            }),
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
            () => ({
              type: 'file',
              itemId: 'item',
              contents: document.getText(),
            }),
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
                itemId: 'item',
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
  lines: number,
  itemLines = 1000
): CodeViewItem<undefined>[] {
  const items: CodeViewItem<undefined>[] = [];
  for (let startLine = 0; startLine < lines; startLine += itemLines) {
    const contents = createContents(Math.min(itemLines, lines - startLine));
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
  return (
    state?.text === query.text &&
    state.matchCount === expectedCount &&
    !state.searching
  );
}

// Measures query updates, navigation and item changes after setup.
// Deferred render callbacks and the final state report complete each sample.
async function measureCodeViewCase(
  kind: 'files' | 'diffs',
  query: (typeof QUERIES)[number],
  lines: number,
  config: BenchmarkConfig,
  layout:
    | 'top'
    | 'dense-middle-single'
    | 'dense-middle-many'
    | 'small-items' = 'top',
  navigation?: 'next' | 'previous',
  mutation?: 'edit' | 'editor-edit' | 'add-items'
): Promise<BenchmarkSummary> {
  const [
    { CodeView },
    { disposeHighlighter, getSharedHighlighter },
    { createRoot, installDom, renderItems, wait, waitFor },
    { fillSearch, getSearchInput },
    { Editor },
  ] = await Promise.all([
    import('../src/components/CodeView'),
    import('../src/highlighter/shared_highlighter'),
    import('../test/domHarness'),
    import('../test/codeViewSearchHarness'),
    import('../src/editor/editor'),
  ]);
  await getSharedHighlighter({
    themes: ['pierre-dark', 'pierre-light'],
    langs: ['text'],
    preferredHighlighter: 'shiki-js',
  });
  const dom = installDom();
  let searchState: SearchPanelState | undefined;
  let completedAt = 0;
  let measuringQuery = false;
  let longestRenderMs = 0;
  const requestFrame = globalThis.requestAnimationFrame;
  // Include deferred result selection in the longest query/render callback.
  globalThis.requestAnimationFrame = (callback) =>
    requestFrame((time) => {
      if (!measuringQuery) {
        callback(time);
        return;
      }
      const startedAt = performance.now();
      try {
        callback(time);
      } finally {
        longestRenderMs = Math.max(
          longestRenderMs,
          performance.now() - startedAt
        );
      }
    });
  const viewer = new CodeView({
    useTokenTransformer: mutation === 'editor-edit' ? true : undefined,
    createEditor: (type, settings, key) => new Editor(type, settings, key),
    expandUnchanged: navigation != null ? true : undefined,
    searchOptions: { defaults: { regex: query.regex, caseSensitive: false } },
    onSearchStateChange: (state) => {
      searchState = state;
      if (state?.text === query.text && !state.searching) {
        completedAt = performance.now();
      }
    },
  });
  const name =
    mutation != null
      ? `code-view/${mutation}/${kind}/${query.name}`
      : navigation != null
        ? layout === 'small-items'
          ? `code-view/small-items/${kind}/${navigation}`
          : layout === 'dense-middle-single'
            ? `code-view/navigation-single/${kind}/${navigation}`
            : `code-view/navigation/${kind}/${navigation}`
        : layout === 'top'
          ? `code-view/${kind}/${query.name}`
          : `code-view/${layout}/${kind}/${query.name}`;
  const initialCount =
    query.name === 'rare-literal'
      ? 0
      : Math.min(lines * (kind === 'diffs' ? 2 : 1), MAX_SEARCH_MATCHES);
  const expectedCount =
    mutation === 'add-items' && query.name !== 'rare-literal'
      ? Math.min(
          (lines + 10_000) * (kind === 'diffs' ? 2 : 1),
          MAX_SEARCH_MATCHES
        )
      : initialCount;
  try {
    const root = createRoot();
    // The benchmark presses the same keys as a user in the find input.
    const navigateSearch = (previous: boolean) => {
      getSearchInput(root).dispatchEvent(
        new window.KeyboardEvent('keydown', {
          key: 'Enter',
          shiftKey: previous,
          bubbles: true,
          cancelable: true,
        })
      );
    };
    viewer.setup(root);
    const itemLines =
      layout === 'dense-middle-single'
        ? lines
        : layout === 'small-items'
          ? 4
          : 1000;
    const items = createCodeViewItems(kind, lines, itemLines);
    const first = items[0];
    if (first == null) throw new Error(`${name}: first item is missing`);
    if (mutation === 'editor-edit') first.edit = true;
    const replacement =
      mutation === 'edit'
        ? createCodeViewItems(kind, Math.min(lines, 1000))[0]
        : undefined;
    if (replacement != null) replacement.version = 1;
    if (replacement?.type === 'file') {
      replacement.file = {
        ...replacement.file,
        contents: `// changed\n${replacement.file.contents}`,
      };
    } else if (replacement != null) {
      const contents = createContents(Math.min(lines, 1000));
      replacement.fileDiff = parseDiffFromFile(
        { name: 'item-0.txt', contents: contents.before },
        { name: 'item-0.txt', contents: `// changed\n${contents.after}` },
        { preferredDiffLib: '@pierre/patches', disableLineMatching: true },
        true
      );
    }
    const additions =
      mutation === 'add-items' ? createCodeViewItems(kind, 10_000) : [];
    for (const item of additions) item.id = `added-${item.id}`;
    await renderItems(viewer, items);
    const samples: number[] = [];
    const completionSamples: number[] = [];
    const blockedSamples: number[] = [];
    for (let index = 0; index < config.warmupRuns + config.runs; index++) {
      if (mutation != null) {
        viewer.closeSearch();
        viewer.setItems([]);
        await renderItems(viewer, items);
      }
      viewer.openSearch({ query: '', scope: 'all', mode: 'find' });
      await wait(0);
      if (layout !== 'top') {
        const middleLine = Math.min(Math.floor(lines / 2), 40_000);
        const item = items[Math.floor(middleLine / itemLines)];
        if (item == null) throw new Error(`${name}: middle item is missing`);
        viewer.scrollTo({
          type: 'line',
          id: item.id,
          lineNumber: (middleLine % itemLines) + 1,
          side: 'additions',
          align: 'center',
          behavior: 'instant',
        });
        viewer.render(true);
        await wait(0);
      }
      if (navigation != null) {
        if (layout === 'small-items') {
          viewer.openSearch({ query: query.text, scope: 'all', mode: 'find' });
          await waitFor(() =>
            hasExpectedSearchState(searchState, query, expectedCount)
          );
        }
        viewer.scrollTo({ type: 'position', position: 0, behavior: 'instant' });
        viewer.render(true);
        if (layout === 'small-items') fillSearch(root, query.text);
        else
          viewer.openSearch({ query: query.text, scope: 'all', mode: 'find' });
        await waitFor(() =>
          hasExpectedSearchState(searchState, query, expectedCount)
        );
        if (searchState?.currentMatchIndex !== 0) {
          throw new Error(
            `${name}: expected the first match before navigation`
          );
        }
        navigateSearch(true);
        navigateSearch(true);
        if (searchState?.currentMatchIndex !== expectedCount - 2) {
          throw new Error(
            `${name}: could not prepare navigation near the end: ${searchState?.currentMatchIndex} of ${expectedCount}`
          );
        }
      }
      if (mutation != null) {
        viewer.openSearch({ query: query.text, scope: 'all', mode: 'find' });
        await waitFor(
          () => hasExpectedSearchState(searchState, query, initialCount),
          { timeout: 15000 }
        );
        if (!hasExpectedSearchState(searchState, query, initialCount)) {
          throw new Error(`${name}: initial search did not finish`);
        }
      }
      Bun.gc(true);
      completedAt = 0;
      longestRenderMs = 0;
      measuringQuery = true;
      const start = performance.now();
      if (mutation != null) {
        if (mutation === 'add-items') viewer.addItems(additions);
        else if (mutation === 'edit') {
          if (replacement == null)
            throw new Error(`${name}: replacement is missing`);
          viewer.updateItem(replacement);
        } else {
          const editor = viewer.getEditor(first.id);
          if (editor == null) throw new Error(`${name}: editor is missing`);
          editor.applyEdits([
            {
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 0 },
              },
              newText: '// changed ',
            },
          ]);
        }
        viewer.render(true);
      } else if (navigation != null) {
        navigateSearch(navigation === 'previous');
        const expectedIndex = expectedCount - (navigation === 'next' ? 1 : 3);
        if (searchState?.currentMatchIndex !== expectedIndex) {
          throw new Error(`${name}: expected current index ${expectedIndex}`);
        }
        completedAt = performance.now();
      } else {
        viewer.openSearch({ query: query.text, scope: 'all', mode: 'find' });
      }
      const elapsed = performance.now() - start;
      await waitFor(
        () =>
          completedAt > 0 &&
          hasExpectedSearchState(searchState, query, expectedCount),
        { timeout: 15000 }
      );
      measuringQuery = false;
      if (!hasExpectedSearchState(searchState, query, expectedCount)) {
        throw new Error(
          `${name}: expected query "${query.text}" with ${expectedCount} matches, got query "${searchState?.text}" with ${searchState?.matchCount}`
        );
      }
      if (index >= config.warmupRuns) {
        samples.push(elapsed);
        completionSamples.push(completedAt - start);
        blockedSamples.push(Math.max(elapsed, longestRenderMs));
      }
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
      completion: summarize(completionSamples),
      blocked: summarize(blockedSamples),
    };
  } finally {
    viewer.cleanUp();
    globalThis.requestAnimationFrame = requestFrame;
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
  const mutations: ('edit' | 'editor-edit' | 'add-items')[] = [
    'edit',
    'editor-edit',
    'add-items',
  ];
  for (const mutation of mutations) {
    for (const kind of codeViewKinds) {
      for (const query of QUERIES) {
        if (query.name === 'regex') continue;
        if (
          config.only == null ||
          `code-view/${mutation}/${kind}/${query.name}`.includes(config.only)
        ) {
          results.push(
            await measureCodeViewCase(
              kind,
              query,
              lines,
              config,
              'top',
              undefined,
              mutation
            )
          );
        }
      }
    }
  }
  if (lines === 100_000) {
    for (const kind of codeViewKinds) {
      for (const query of QUERIES) {
        if (query.name === 'regex') continue;
        if (
          config.only == null ||
          `code-view/small-items/${kind}/${query.name}`.includes(config.only)
        ) {
          results.push(
            await measureCodeViewCase(kind, query, lines, config, 'small-items')
          );
        }
      }
      if (
        config.only == null ||
        `code-view/small-items/${kind}/next`.includes(config.only)
      ) {
        results.push(
          await measureCodeViewCase(
            kind,
            QUERIES[1],
            lines,
            config,
            'small-items',
            'next'
          )
        );
      }
    }
  }
  if (lines === 100_000) {
    const directions: ('next' | 'previous')[] = ['next', 'previous'];
    for (const direction of directions) {
      if (
        config.only == null ||
        `code-view/navigation-single/files/${direction}`.includes(config.only)
      ) {
        results.push(
          await measureCodeViewCase(
            'files',
            QUERIES[1],
            lines,
            config,
            'dense-middle-single',
            direction
          )
        );
      }
    }
    for (const kind of codeViewKinds) {
      for (const direction of directions) {
        if (
          config.only == null ||
          `code-view/navigation/${kind}/${direction}`.includes(config.only)
        ) {
          results.push(
            await measureCodeViewCase(
              kind,
              QUERIES[1],
              lines,
              config,
              'top',
              direction
            )
          );
        }
      }
    }
  }
  const middleLayouts: ('dense-middle-single' | 'dense-middle-many')[] = [
    'dense-middle-single',
    'dense-middle-many',
  ];
  for (const layout of middleLayouts) {
    for (const kind of codeViewKinds) {
      for (const query of QUERIES) {
        if (query.name !== 'common-literal') continue;
        if (
          config.only == null ||
          `code-view/${layout}/${kind}/${query.name}`.includes(config.only)
        ) {
          results.push(
            await measureCodeViewCase(kind, query, lines, config, layout)
          );
        }
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
          blocked:
            'Maximum synchronous query call or requestAnimationFrame callback duration during that query in jsdom; JavaScript callbacks, not browser tasks',
          navigation:
            'Synchronous Enter or Shift+Enter near the end of a completed 100000-match list; query setup and two previous steps are excluded',
          smallItems:
            '25000 items of four lines each, searched from the middle; navigation reuses the finished scan and positions near its last match before timing Next',
          denseMiddle:
            'Public scrolling to a middle line in one large item or a collection of 1000-line items, before the query timer starts',
          mutations:
            'Finished all-items find before updateItem, an editor insertion, or a 10000-line append; blocked includes the immediate render and completion ends at the final state callback',
          fixturePreparationExcluded: true,
          forcedGcBeforeTiming: true,
          perItemMatchingIncludesPreparation: true,
          codeView:
            'Synchronous public query update in jsdom at every configured size and query, for files and split diffs in items of up to 1000 lines; completion records the final state callback separately',
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
    'Blocked is the maximum synchronous query call or render callback duration in jsdom, not a browser task. Navigation cases time Enter or Shift+Enter near the end of 100000 matches. Other CodeView cases time the public query update; completion measures the final state callback separately.'
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
      blocked:
        result.blocked == null
          ? 'N/A'
          : `${result.blocked.bestMs.toFixed(3)}/${result.blocked.medianMs.toFixed(3)}`,
      completion:
        result.completion == null
          ? 'N/A'
          : `${result.completion.bestMs.toFixed(3)}/${result.completion.medianMs.toFixed(3)}`,
    }))
  );
}
