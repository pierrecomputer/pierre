import { chromium } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  type BenchmarkConfig,
  type BenchmarkFixture,
  type BenchmarkRunSummary,
  type ComparedSummary,
  formatMs,
  formatPct,
  loadRealFixtures,
  parseArgs,
} from './benchmarkIterateOverDiff';

interface BrowserCliConfig {
  benchmarkConfig: BenchmarkConfig;
  browserChannel: string;
  headless: boolean;
}

interface BrowserInfo {
  userAgent: string;
  href: string;
}

interface BrowserBenchmarkBaseOutput {
  runtime: 'chrome';
  browser: BrowserInfo;
  fixturePath: string;
  config: BenchmarkConfig;
  caseCount: number;
  fixtureCount: number;
}

interface BrowserComparisonOutput extends BrowserBenchmarkBaseOutput {
  benchmark: 'iterateOverDiff:baseline-compare';
  implementations: {
    baseline: string;
    current: string;
  };
  baseline: BenchmarkRunSummary;
  current: BenchmarkRunSummary;
  scoreDeltaPct: number;
  checksumMatch: boolean;
  comparedCases: number;
  comparisons: ComparedSummary[];
}

interface BrowserSingleOutput extends BrowserBenchmarkBaseOutput {
  benchmark: 'iterateOverDiff';
  implementation: string;
  checksum: number;
  score: number;
  summaries: BenchmarkRunSummary['summaries'];
}

type BrowserBenchmarkOutput = BrowserComparisonOutput | BrowserSingleOutput;

interface BrowserBenchmarkInput {
  config: BenchmarkConfig;
  realFixtures: BenchmarkFixture[];
  browser: BrowserInfo;
}

function printHelpAndExit(): never {
  console.log(
    'Usage: bun ws diffs benchmark:iterate-over-diff:browser -- [options]'
  );
  console.log('');
  console.log('Runs the iterateOverDiff benchmark inside Chrome/Chromium.');
  console.log('');
  console.log('Browser options:');
  console.log(
    '  --browser-channel <name>  Playwright browser channel: chrome, chromium, chrome-beta, chrome-dev, msedge (default: chrome)'
  );
  console.log('  --headed                  Show the browser window');
  console.log(
    '  --headless <true|false>   Run headless or headed (default: true)'
  );
  console.log(
    '  --batch-runs <number>     Same benchmark option as Bun; Chrome defaults to 10 to avoid timer-resolution zeros'
  );
  console.log('');
  console.log('Benchmark options are the same as benchmark:iterate-over-diff.');
  process.exit(0);
}

function parseBoolean(value: string, flagName: string): boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(
    `Invalid ${flagName} value "${value}". Expected true or false.`
  );
}

function parseBrowserArgs(argv: string[]): BrowserCliConfig {
  const benchmarkArgs: string[] = [];
  let browserChannel = 'chrome';
  let hasExplicitBatchRuns = false;
  let headless = true;

  for (let index = 0; index < argv.length; index++) {
    const rawArg = argv[index];
    if (rawArg === '--help' || rawArg === '-h') {
      printHelpAndExit();
    }
    if (rawArg === '--headed') {
      headless = false;
      continue;
    }

    const [flag, inlineValue] = rawArg.split('=', 2);
    if (flag === '--browser-channel') {
      const value = inlineValue ?? argv[index + 1];
      if (value == null) throw new Error('Missing value for --browser-channel');
      if (inlineValue == null) index++;
      browserChannel = value;
      continue;
    }
    if (flag === '--headless') {
      const value = inlineValue ?? argv[index + 1];
      if (value == null) throw new Error('Missing value for --headless');
      if (inlineValue == null) index++;
      headless = parseBoolean(value, '--headless');
      continue;
    }
    if (flag === '--batch-runs') {
      hasExplicitBatchRuns = true;
    }

    benchmarkArgs.push(rawArg);
  }

  const benchmarkConfig = parseArgs(benchmarkArgs);
  if (!hasExplicitBatchRuns) {
    benchmarkConfig.batchRuns = 10;
  }
  if (benchmarkConfig.measureMemory) {
    throw new Error(
      '--memory is not supported in the Chrome benchmark yet. The browser runner reports timing/checksum data only.'
    );
  }
  if (
    benchmarkConfig.memoryChildImplementation != null ||
    benchmarkConfig.memoryChildCaseIndex != null
  ) {
    throw new Error('--memory-child is only supported by the Bun benchmark.');
  }

  return {
    benchmarkConfig,
    browserChannel,
    headless,
  };
}

async function buildBrowserBundle(): Promise<{
  outdir: string;
  bundlePath: string;
}> {
  const outdir = mkdtempSync(join(tmpdir(), 'diffs-iterate-browser-'));
  const result = await Bun.build({
    entrypoints: [
      resolve(import.meta.dir, 'benchmarkIterateOverDiffBrowserEntry.ts'),
    ],
    outdir,
    target: 'browser',
    format: 'esm',
    naming: 'benchmark.js',
  });

  if (!result.success) {
    const messages = result.logs.map((log) => log.message).join('\n');
    throw new Error(`Failed to build browser benchmark bundle:\n${messages}`);
  }

  const bundlePath = result.outputs[0]?.path;
  if (bundlePath == null) {
    throw new Error('Browser benchmark bundle did not produce an output path.');
  }
  return { outdir, bundlePath };
}

async function runInChrome({
  benchmarkConfig,
  browserChannel,
  headless,
}: BrowserCliConfig): Promise<BrowserBenchmarkOutput> {
  const realFixtures =
    benchmarkConfig.preset === 'stress'
      ? []
      : loadRealFixtures(benchmarkConfig.fixturePath);
  const { outdir, bundlePath } = await buildBrowserBundle();
  const browser = await chromium.launch({
    channel: browserChannel === 'chromium' ? undefined : browserChannel,
    headless,
    args: ['--js-flags=--expose-gc'],
  });

  try {
    const page = await browser.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => {
      pageErrors.push(error.stack ?? error.message);
    });
    page.on('console', (message) => {
      if (message.type() === 'error') {
        pageErrors.push(message.text());
      }
    });

    await page.goto('about:blank');
    await page.addScriptTag({
      content: readFileSync(bundlePath, 'utf8'),
      type: 'module',
    });
    await page.waitForFunction(
      () =>
        typeof (
          globalThis as typeof globalThis & {
            __runIterateOverDiffBrowserBenchmark?: unknown;
          }
        ).__runIterateOverDiffBrowserBenchmark === 'function'
    );
    const browserInfo: BrowserInfo = await page.evaluate(() => ({
      userAgent: navigator.userAgent,
      href: location.href,
    }));
    const input: BrowserBenchmarkInput = {
      config: benchmarkConfig,
      realFixtures,
      browser: browserInfo,
    };
    const output = await page.evaluate((benchmarkInput) => {
      const benchmarkGlobal = globalThis as typeof globalThis & {
        __runIterateOverDiffBrowserBenchmark?: (
          input: BrowserBenchmarkInput
        ) => BrowserBenchmarkOutput;
      };
      const runBenchmark = benchmarkGlobal.__runIterateOverDiffBrowserBenchmark;
      if (runBenchmark == null) {
        throw new Error('Browser benchmark bundle did not install its runner.');
      }
      return runBenchmark(benchmarkInput);
    }, input);

    if (pageErrors.length > 0) {
      throw new Error(
        `Browser errors during benchmark:\n${pageErrors.join('\n')}`
      );
    }
    return output;
  } finally {
    await browser.close();
    rmSync(outdir, { recursive: true, force: true });
  }
}

interface ComparisonTableRow {
  case: string;
  meanBase: string;
  meanNow: string;
  meanDelta: string;
  p95Delta: string;
  rows: string;
  checksum: string;
}

function printComparisonTable(comparisons: ComparedSummary[]) {
  const rows: ComparisonTableRow[] = comparisons.map((comparison) => ({
    case: comparison.label,
    meanBase: formatMs(comparison.baselineMeanMs),
    meanNow: formatMs(comparison.currentMeanMs),
    meanDelta: `${formatMs(comparison.meanDeltaMs)} (${formatPct(
      comparison.meanDeltaPct
    )})`,
    p95Delta: formatPct(comparison.p95DeltaPct),
    rows: comparison.rowsMatch ? 'ok' : 'DIFF',
    checksum: comparison.checksumMatch ? 'ok' : 'DIFF',
  }));
  const headers: (keyof ComparisonTableRow)[] = [
    'case',
    'meanBase',
    'meanNow',
    'meanDelta',
    'p95Delta',
    'rows',
    'checksum',
  ];
  const widths = headers.map((header) =>
    rows.reduce((max, row) => Math.max(max, row[header].length), header.length)
  );
  const formatRow = (row: ComparisonTableRow) =>
    headers
      .map((header, index) => row[header].padEnd(widths[index]))
      .join('  ')
      .trimEnd();
  const headerRow: ComparisonTableRow = {
    case: 'case',
    meanBase: 'meanBase',
    meanNow: 'meanNow',
    meanDelta: 'meanDelta',
    p95Delta: 'p95Delta',
    rows: 'rows',
    checksum: 'checksum',
  };

  console.log(formatRow(headerRow));
  console.log(
    widths
      .map((width) => '-'.repeat(width))
      .join('  ')
      .trimEnd()
  );
  for (const row of rows) {
    console.log(formatRow(row));
  }
}

interface SummaryTableRow {
  case: string;
  runs: string;
  mean: string;
  p50: string;
  p95: string;
  rows: string;
  checksum: string;
}

function printSummaryTable(summaries: BenchmarkRunSummary['summaries']) {
  const rows: SummaryTableRow[] = summaries.map((summary) => ({
    case: summary.label,
    runs: String(summary.runs),
    mean: formatMs(summary.meanMs),
    p50: formatMs(summary.medianMs),
    p95: formatMs(summary.p95Ms),
    rows: String(summary.rows),
    checksum: String(summary.checksum),
  }));
  const headers: (keyof SummaryTableRow)[] = [
    'case',
    'runs',
    'mean',
    'p50',
    'p95',
    'rows',
    'checksum',
  ];
  const widths = headers.map((header) =>
    rows.reduce((max, row) => Math.max(max, row[header].length), header.length)
  );
  const formatRow = (row: SummaryTableRow) =>
    headers
      .map((header, index) => row[header].padEnd(widths[index]))
      .join('  ')
      .trimEnd();
  const headerRow: SummaryTableRow = {
    case: 'case',
    runs: 'runs',
    mean: 'mean',
    p50: 'p50',
    p95: 'p95',
    rows: 'rows',
    checksum: 'checksum',
  };

  console.log(formatRow(headerRow));
  console.log(
    widths
      .map((width) => '-'.repeat(width))
      .join('  ')
      .trimEnd()
  );
  for (const row of rows) {
    console.log(formatRow(row));
  }
}

function printBrowserOutput(output: BrowserBenchmarkOutput) {
  if (output.benchmark === 'iterateOverDiff:baseline-compare') {
    console.log('iterateOverDiff Chrome benchmark comparison');
    console.log(`browser=${output.browser.userAgent}`);
    console.log(`fixture=${output.fixturePath}`);
    console.log(`fixtures=${output.fixtureCount} cases=${output.caseCount}`);
    console.log(
      `preset=${output.config.preset} runsPerCase=${output.config.runs} warmupRunsPerCase=${output.config.warmupRuns} batchRuns=${output.config.batchRuns}`
    );
    console.log(
      `baseline=${output.implementations.baseline} current=${output.implementations.current}`
    );
    console.log(
      `score ${formatMs(output.baseline.score)}ms -> ${formatMs(
        output.current.score
      )}ms (${formatPct(output.scoreDeltaPct)})`
    );
    console.log(`checksum=${output.checksumMatch ? 'ok' : 'DIFF'}`);
    console.log('');
    printComparisonTable(output.comparisons);
    return;
  }

  console.log('iterateOverDiff Chrome benchmark');
  console.log(`browser=${output.browser.userAgent}`);
  console.log(`fixture=${output.fixturePath}`);
  console.log(`fixtures=${output.fixtureCount} cases=${output.caseCount}`);
  console.log(
    `preset=${output.config.preset} runsPerCase=${output.config.runs} warmupRunsPerCase=${output.config.warmupRuns} batchRuns=${output.config.batchRuns}`
  );
  console.log(`implementation=${output.implementation}`);
  console.log(`checksum=${output.checksum}`);
  console.log('');
  printSummaryTable(output.summaries);
  console.log('');
  console.log(`score=${formatMs(output.score)}ms`);
}

async function main() {
  const config = parseBrowserArgs(process.argv.slice(2));
  const output = await runInChrome(config);
  if (config.benchmarkConfig.outputJson) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }
  printBrowserOutput(output);
}

await main();
