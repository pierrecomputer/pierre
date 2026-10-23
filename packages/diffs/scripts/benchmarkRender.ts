// Render benchmark for FileDiff, the editor seam and CodeView scrolling, in
// jsdom. Measures one operation per sample with setup excluded, so numbers
// compare across refactors of the rendering pipeline. DOM costs in jsdom are
// not browser costs; only relative changes between runs of this script mean
// anything.
//
//   moonx diffs:benchmark-render -- [--lines 2000] [--runs 5] [--warmup-runs 1]
//                                   [--only <substring>] [--json]

import { CodeView } from '../src/components/CodeView';
import { FileDiff, type FileDiffOptions } from '../src/components/FileDiff';
import { DEFAULT_THEMES } from '../src/constants';
import { Editor } from '../src/editor/editor';
import {
  disposeHighlighter,
  getHighlighterIfLoaded,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';
import type {
  CodeViewItem,
  DiffLineAnnotation,
  RenderRange,
} from '../src/types';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { createRoot, installDom, wait, waitFor } from '../test/domHarness';

interface BenchmarkConfig {
  lines: number;
  runs: number;
  warmupRuns: number;
  only: string | undefined;
  outputJson: boolean;
}

interface Prepared {
  run: () => void | Promise<void>;
  cleanup: () => void;
}

interface BenchmarkCase {
  name: string;
  description: string;
  // Builds fresh state for one sample and returns the timed operation.
  prepare: () => Prepared | Promise<Prepared>;
}

interface BenchmarkSummary {
  name: string;
  description: string;
  runs: number;
  medianMs: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
}

const DEFAULT_CONFIG: BenchmarkConfig = {
  lines: 2000,
  runs: 5,
  warmupRuns: 1,
  only: undefined,
  outputJson: false,
};

const LANGS = ['text', 'typescript'] as const;

function parseArgs(argv: string[]): BenchmarkConfig {
  const config = { ...DEFAULT_CONFIG };
  for (let index = 0; index < argv.length; index++) {
    const rawArg = argv[index];
    if (rawArg === '--help' || rawArg === '-h') {
      console.log('Usage: moonx diffs:benchmark-render -- [options]');
      console.log('');
      console.log('Options:');
      console.log(
        `  --lines <number>        New-file lines (default: ${DEFAULT_CONFIG.lines})`
      );
      console.log(
        `  --runs <number>         Measured runs per case (default: ${DEFAULT_CONFIG.runs})`
      );
      console.log(
        `  --warmup-runs <number>  Warmup runs per case (default: ${DEFAULT_CONFIG.warmupRuns})`
      );
      console.log(
        '  --only <substring>      Run only cases whose name contains it'
      );
      console.log('  --json                  Emit machine-readable JSON');
      process.exit(0);
    }
    if (rawArg === '--json') {
      config.outputJson = true;
      continue;
    }
    const [flag, inlineValue] = rawArg.split('=', 2);
    const value = inlineValue ?? argv[index + 1];
    if (value === undefined) {
      throw new Error(`Missing value for ${flag}`);
    }
    if (inlineValue === undefined) {
      index++;
    }
    switch (flag) {
      case '--lines':
        config.lines = Number.parseInt(value, 10);
        break;
      case '--runs':
        config.runs = Number.parseInt(value, 10);
        break;
      case '--warmup-runs':
        config.warmupRuns = Number.parseInt(value, 10);
        break;
      case '--only':
        config.only = value;
        break;
      default:
        throw new Error(`Unknown argument: ${rawArg}`);
    }
  }
  if (!Number.isFinite(config.lines) || config.lines < 100) {
    throw new Error('--lines must be at least 100');
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

// ---------------------------------------------------------------------------
// Fixture: a TypeScript file where every 40th line changed and one block of
// ten lines was inserted, so the diff has many hunks separated by collapsed
// context.

interface Fixture {
  oldFile: { name: string; contents: string };
  newFile: { name: string; contents: string };
  // A changed line, a context line and the line after the inserted block,
  // as zero-based new-file line indexes.
  changedLine: number;
  contextLine: number;
}

function createFixture(lines: number): Fixture {
  const oldLines: string[] = [];
  for (let index = 0; index < lines; index++) {
    oldLines.push(
      `export const value${index} = compute(${index}, "label ${index}", [${index % 7}, ${index % 11}]);`
    );
  }
  const newLines = oldLines.map((line, index) =>
    index % 40 === 20 ? line.replace('compute(', 'computeNext(') : line
  );
  const insertAt = Math.floor(lines / 2);
  newLines.splice(
    insertAt,
    0,
    ...Array.from(
      { length: 10 },
      (_, index) => `export const inserted${index} = ${index};`
    )
  );
  return {
    oldFile: { name: 'bench.ts', contents: oldLines.join('\n') + '\n' },
    newFile: { name: 'bench.ts', contents: newLines.join('\n') + '\n' },
    changedLine: 20,
    contextLine: 21,
  };
}

function createContainer(): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return container;
}

function hasTokenSpans(container: HTMLElement): boolean {
  return (
    container.shadowRoot?.querySelector('[data-content] [data-line] span') !=
    null
  );
}

function isEditable(container: HTMLElement): boolean {
  return (
    container.shadowRoot?.querySelector<HTMLElement>(
      '[data-code]:not([data-deletions]) [data-content]'
    )?.contentEditable === 'true'
  );
}

function assertHighlighterReady(): void {
  if (
    getHighlighterIfLoaded({ theme: DEFAULT_THEMES, langs: [...LANGS] }) == null
  ) {
    throw new Error('benchmarkRender: shared highlighter is not loaded');
  }
}

function baseOptions(
  diffStyle: 'split' | 'unified',
  extra: Partial<FileDiffOptions<undefined, undefined>> = {}
): FileDiffOptions<undefined, undefined> {
  return {
    theme: DEFAULT_THEMES,
    preferredHighlighter: 'highlights',
    disableFileHeader: true,
    disableErrorHandling: true,
    diffStyle,
    ...extra,
  };
}

// Renders a read-only diff synchronously (the highlighter is preloaded) and
// checks that rows came out highlighted.
function renderReadOnly(
  fixture: Fixture,
  options: FileDiffOptions<undefined, undefined>,
  renderRange?: RenderRange,
  lineAnnotations?: DiffLineAnnotation<undefined>[]
): { fileDiff: FileDiff<undefined>; container: HTMLElement } {
  assertHighlighterReady();
  const container = createContainer();
  const fileDiff = new FileDiff<undefined>(options);
  fileDiff.render({
    oldFile: fixture.oldFile,
    newFile: fixture.newFile,
    fileContainer: container,
    forceRender: true,
    renderRange,
    lineAnnotations,
  });
  if (!hasTokenSpans(container)) {
    throw new Error('benchmarkRender: first render was not highlighted');
  }
  return { fileDiff, container };
}

async function renderEditable(
  fixture: Fixture,
  diffStyle: 'split' | 'unified',
  renderRange?: RenderRange
): Promise<{
  fileDiff: FileDiff<undefined>;
  editor: Editor<'file-diff', undefined>;
  container: HTMLElement;
}> {
  const { fileDiff, container } = renderReadOnly(
    fixture,
    baseOptions(diffStyle, {
      expandUnchanged: true,
      useTokenTransformer: true,
    }),
    renderRange
  );
  const editor = new Editor<'file-diff', undefined>('file-diff');
  editor.edit(fileDiff);
  await waitFor(() => isEditable(container), { timeout: 10_000 });
  if (!isEditable(container)) {
    throw new Error('benchmarkRender: editor did not attach');
  }
  // Let the attach-time tokenizer pass settle before timing edits.
  await wait(20);
  return { fileDiff, editor, container };
}

function replaceText(
  editor: Editor<'file-diff', undefined>,
  line: number,
  start: number,
  end: number,
  newText: string
): void {
  editor.applyEdits([
    {
      range: {
        start: { line, character: start },
        end: { line, character: end },
      },
      newText,
    },
  ]);
}

function windowRange(startingLine: number, totalLines: number): RenderRange {
  return { startingLine, totalLines, bufferBefore: 0, bufferAfter: 0 };
}

// ---------------------------------------------------------------------------
// Cases

function createCases(config: BenchmarkConfig): BenchmarkCase[] {
  const fixture = createFixture(config.lines);
  const cases: BenchmarkCase[] = [];
  const WINDOW = 200;

  for (const diffStyle of ['split', 'unified'] as const) {
    const tag = diffStyle;

    cases.push({
      name: `first-paint/${tag}/expanded`,
      description: 'render() of the whole diff with expandUnchanged',
      prepare() {
        assertHighlighterReady();
        const container = createContainer();
        const fileDiff = new FileDiff<undefined>(
          baseOptions(diffStyle, { expandUnchanged: true })
        );
        return {
          run() {
            fileDiff.render({
              oldFile: fixture.oldFile,
              newFile: fixture.newFile,
              fileContainer: container,
              forceRender: true,
            });
          },
          cleanup() {
            fileDiff.cleanUp();
            container.remove();
          },
        };
      },
    });

    cases.push({
      name: `first-paint/${tag}/window`,
      description: `render() of a ${WINDOW}-line window`,
      prepare() {
        assertHighlighterReady();
        const container = createContainer();
        const fileDiff = new FileDiff<undefined>(
          baseOptions(diffStyle, { expandUnchanged: true })
        );
        return {
          run() {
            fileDiff.render({
              oldFile: fixture.oldFile,
              newFile: fixture.newFile,
              fileContainer: container,
              forceRender: true,
              renderRange: windowRange(0, WINDOW),
            });
          },
          cleanup() {
            fileDiff.cleanUp();
            container.remove();
          },
        };
      },
    });

    cases.push({
      name: `rehighlight/${tag}/expanded`,
      description: 'onThemeChange(): clear the cache and render again',
      prepare() {
        const { fileDiff, container } = renderReadOnly(
          fixture,
          baseOptions(diffStyle, { expandUnchanged: true })
        );
        return {
          run() {
            fileDiff.onThemeChange();
          },
          cleanup() {
            fileDiff.cleanUp();
            container.remove();
          },
        };
      },
    });

    cases.push({
      name: `expand-hunk/${tag}`,
      description: 'expandHunk() on a diff with collapsed context',
      prepare() {
        const { fileDiff, container } = renderReadOnly(
          fixture,
          baseOptions(diffStyle)
        );
        return {
          run() {
            fileDiff.expandHunk(1, 'down');
          },
          cleanup() {
            fileDiff.cleanUp();
            container.remove();
          },
        };
      },
    });

    cases.push({
      name: `annotations-change/${tag}/expanded`,
      description: 'render() with a new annotations array',
      prepare() {
        const { fileDiff, container } = renderReadOnly(
          fixture,
          baseOptions(diffStyle, { expandUnchanged: true }),
          undefined,
          []
        );
        const lineAnnotations: DiffLineAnnotation<undefined>[] = [
          { lineNumber: 30, side: 'additions', metadata: undefined },
        ];
        return {
          run() {
            fileDiff.render({
              oldFile: fixture.oldFile,
              newFile: fixture.newFile,
              fileContainer: container,
              lineAnnotations,
            });
          },
          cleanup() {
            fileDiff.cleanUp();
            container.remove();
          },
        };
      },
    });

    cases.push({
      name: `scroll-step/${tag}`,
      description: `render() moving a ${WINDOW}-line window by half (partial render)`,
      prepare() {
        const { fileDiff, container } = renderReadOnly(
          fixture,
          baseOptions(diffStyle, { expandUnchanged: true }),
          windowRange(0, WINDOW)
        );
        return {
          run() {
            fileDiff.render({
              oldFile: fixture.oldFile,
              newFile: fixture.newFile,
              fileContainer: container,
              renderRange: windowRange(WINDOW / 2, WINDOW),
            });
          },
          cleanup() {
            fileDiff.cleanUp();
            container.remove();
          },
        };
      },
    });

    cases.push({
      name: `scroll-jump/${tag}`,
      description: `render() moving a ${WINDOW}-line window with no overlap (full render)`,
      prepare() {
        const { fileDiff, container } = renderReadOnly(
          fixture,
          baseOptions(diffStyle, { expandUnchanged: true }),
          windowRange(0, WINDOW)
        );
        return {
          run() {
            fileDiff.render({
              oldFile: fixture.oldFile,
              newFile: fixture.newFile,
              fileContainer: container,
              renderRange: windowRange(config.lines - WINDOW - 50, WINDOW),
            });
          },
          cleanup() {
            fileDiff.cleanUp();
            container.remove();
          },
        };
      },
    });

    cases.push({
      name: `edit-attach/${tag}/window`,
      description: 'editor.edit() on a rendered window with token spans',
      prepare() {
        const { fileDiff, container } = renderReadOnly(
          fixture,
          baseOptions(diffStyle, {
            expandUnchanged: true,
            useTokenTransformer: true,
          }),
          windowRange(0, WINDOW)
        );
        const editor = new Editor<'file-diff', undefined>('file-diff');
        return {
          run() {
            editor.edit(fileDiff);
          },
          cleanup() {
            editor.cleanUp();
            fileDiff.cleanUp();
            container.remove();
          },
        };
      },
    });

    for (const [scope, range] of [
      ['window', windowRange(0, WINDOW)],
      ['expanded', undefined],
    ] as const) {
      cases.push({
        name: `type-in-change/${tag}/${scope}`,
        description: 'applyEdits() inside an already changed line',
        async prepare() {
          const { fileDiff, editor, container } = await renderEditable(
            fixture,
            diffStyle,
            range
          );
          return {
            run() {
              replaceText(editor, fixture.changedLine, 13, 13, 'x');
            },
            cleanup() {
              editor.cleanUp();
              fileDiff.cleanUp();
              container.remove();
            },
          };
        },
      });

      cases.push({
        name: `type-context-to-change/${tag}/${scope}`,
        description: 'applyEdits() turning a context line into a change',
        async prepare() {
          const { fileDiff, editor, container } = await renderEditable(
            fixture,
            diffStyle,
            range
          );
          return {
            run() {
              replaceText(editor, fixture.contextLine, 13, 13, 'x');
            },
            cleanup() {
              editor.cleanUp();
              fileDiff.cleanUp();
              container.remove();
            },
          };
        },
      });

      cases.push({
        name: `enter/${tag}/${scope}`,
        description: 'applyEdits() inserting a line break (line-count edit)',
        async prepare() {
          const { fileDiff, editor, container } = await renderEditable(
            fixture,
            diffStyle,
            range
          );
          return {
            run() {
              replaceText(editor, fixture.contextLine, 0, 0, '\n');
            },
            cleanup() {
              editor.cleanUp();
              fileDiff.cleanUp();
              container.remove();
            },
          };
        },
      });
    }
  }

  // CodeView: one large diff item, scrolled and edited through the
  // virtualizer's own frame.
  const codeViewItem = (edit: boolean): CodeViewItem<undefined> => ({
    id: 'bench',
    type: 'diff',
    fileDiff: parseDiffFromFile(fixture.oldFile, fixture.newFile),
    edit,
    version: 1,
  });
  const setupCodeView = async (edit: boolean) => {
    assertHighlighterReady();
    const root = createRoot({ height: 800, width: 1000 });
    const viewer = new CodeView<undefined, undefined>({
      theme: DEFAULT_THEMES,
      preferredHighlighter: 'highlights',
      diffStyle: 'split',
      expandUnchanged: true,
      useTokenTransformer: true,
      createEditor: (type, options, key) => new Editor(type, options, key),
    });
    viewer.setup(root);
    viewer.setItems([codeViewItem(edit)]);
    viewer.render(true);
    await wait(0);
    if (edit) {
      await waitFor(() => viewer.getEditor('bench') != null, {
        timeout: 10_000,
      });
      const editor = viewer.getEditor('bench');
      if (editor == null) {
        throw new Error('benchmarkRender: CodeView editor did not attach');
      }
      await wait(20);
    }
    return {
      viewer,
      root,
      cleanup() {
        viewer.cleanUp();
        root.remove();
      },
    };
  };
  const STEP = 800;

  cases.push({
    name: 'codeview-scroll-step/split',
    description: `ten scrolls of one viewport (${STEP}px), each rendered immediately`,
    async prepare() {
      const { viewer, cleanup } = await setupCodeView(false);
      return {
        run() {
          for (let step = 1; step <= 10; step++) {
            viewer.scrollTo({
              type: 'position',
              position: step * STEP,
              behavior: 'instant',
            });
            viewer.render(true);
          }
        },
        cleanup,
      };
    },
  });

  cases.push({
    name: 'codeview-scroll-jump/split',
    description: 'one scroll to the middle of the file, rendered immediately',
    async prepare() {
      const { viewer, cleanup } = await setupCodeView(false);
      return {
        run() {
          viewer.scrollTo({
            type: 'position',
            position: (config.lines / 2) * 20,
            behavior: 'instant',
          });
          viewer.render(true);
        },
        cleanup,
      };
    },
  });

  cases.push({
    name: 'codeview-type-in-change/split',
    description: 'applyEdits() in a changed line, then the queued frame',
    async prepare() {
      const { viewer, cleanup } = await setupCodeView(true);
      const editor = viewer.getEditor('bench') as Editor<
        'file-diff',
        undefined
      >;
      return {
        run() {
          replaceText(editor, fixture.changedLine, 13, 13, 'x');
          viewer.render(true);
        },
        cleanup,
      };
    },
  });

  cases.push({
    name: 'codeview-enter/split',
    description: 'applyEdits() inserting a line break, then the queued frame',
    async prepare() {
      const { viewer, cleanup } = await setupCodeView(true);
      const editor = viewer.getEditor('bench') as Editor<
        'file-diff',
        undefined
      >;
      return {
        run() {
          replaceText(editor, fixture.contextLine, 0, 0, '\n');
          viewer.render(true);
        },
        cleanup,
      };
    },
  });

  return config.only == null
    ? cases
    : cases.filter((benchmarkCase) =>
        benchmarkCase.name.includes(config.only!)
      );
}

// ---------------------------------------------------------------------------

async function measure(
  benchmarkCase: BenchmarkCase,
  runs: number,
  warmupRuns: number
): Promise<number[]> {
  const samples: number[] = [];
  for (let run = 0; run < warmupRuns + runs; run++) {
    const prepared = await benchmarkCase.prepare();
    try {
      const start = performance.now();
      await prepared.run();
      const elapsed = performance.now() - start;
      if (run >= warmupRuns) {
        samples.push(elapsed);
      }
    } finally {
      prepared.cleanup();
      // Drain queued frames and background tokenizing between samples.
      await wait(5);
    }
  }
  return samples;
}

function summarize(
  benchmarkCase: BenchmarkCase,
  samples: number[]
): BenchmarkSummary {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    name: benchmarkCase.name,
    description: benchmarkCase.description,
    runs: sorted.length,
    medianMs: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    minMs: sorted[0] ?? 0,
    maxMs: sorted[sorted.length - 1] ?? 0,
  };
}

function printTable(summaries: BenchmarkSummary[]): void {
  const rows = summaries.map((summary) => ({
    scenario: summary.name,
    median: summary.medianMs.toFixed(2),
    p95: summary.p95Ms.toFixed(2),
    min: summary.minMs.toFixed(2),
    max: summary.maxMs.toFixed(2),
  }));
  const headers = ['scenario', 'median', 'p95', 'min', 'max'] as const;
  const widths = headers.map((header) =>
    rows.reduce(
      (width, row) => Math.max(width, row[header].length),
      header.length
    )
  );
  const formatRow = (row: Record<(typeof headers)[number], string>) =>
    headers
      .map((header, index) =>
        index === 0
          ? row[header].padEnd(widths[index])
          : row[header].padStart(widths[index])
      )
      .join('  ')
      .trimEnd();
  console.log(
    formatRow({
      scenario: 'scenario',
      median: 'median',
      p95: 'p95',
      min: 'min',
      max: 'max',
    })
  );
  console.log(widths.map((width) => '-'.repeat(width)).join('  '));
  for (const row of rows) {
    console.log(formatRow(row));
  }
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  const dom = installDom();
  try {
    await getSharedHighlighter({
      preferredHighlighter: 'highlights',
      themes: [DEFAULT_THEMES.dark, DEFAULT_THEMES.light],
      langs: [...LANGS],
    });
    const cases = createCases(config);
    const summaries: BenchmarkSummary[] = [];
    for (const benchmarkCase of cases) {
      const samples = await measure(
        benchmarkCase,
        config.runs,
        config.warmupRuns
      );
      summaries.push(summarize(benchmarkCase, samples));
      if (!config.outputJson) {
        const last = summaries[summaries.length - 1];
        console.error(
          `${last.name.padEnd(44)} median ${last.medianMs.toFixed(2).padStart(9)} ms`
        );
      }
    }
    const result = {
      benchmark: 'render',
      config,
      measurement: {
        environment: 'jsdom',
        highlighter: 'highlights, preloaded',
        setupExcluded: true,
      },
      summaries,
    };
    if (config.outputJson) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log('');
    console.log('Render benchmark (jsdom, milliseconds)');
    console.log(
      `lines=${config.lines} runsPerCase=${config.runs} warmupRunsPerCase=${config.warmupRuns}`
    );
    console.log('');
    printTable(summaries);
    console.log('');
    for (const summary of summaries) {
      console.log(`${summary.name}: ${summary.description}`);
    }
  } finally {
    await disposeHighlighter();
    dom.cleanup();
  }
}

await main();
