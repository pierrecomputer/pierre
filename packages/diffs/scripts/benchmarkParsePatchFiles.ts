import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { ParsedPatch } from '../src/types';
import { parsePatchFiles } from '../src/utils/parsePatchFiles';

type BenchmarkMode = 'parse-only' | 'parse-time-detach';

interface BenchmarkFixtureSpec {
  label: string;
  path: string;
}

interface BenchmarkConfig {
  fixtures: BenchmarkFixtureSpec[];
  outputJson: boolean;
  runs: number;
  warmupRuns: number;
}

interface ParsedPatchStats {
  additionLineCount: number;
  deletionLineCount: number;
  fileCount: number;
  hunkCount: number;
  patchCount: number;
  unifiedLineCount: number;
}

interface FixtureStats {
  bytes: number;
  lines: number;
  parsed: ParsedPatchStats;
}

interface ModeSummary {
  fixture: string;
  mode: BenchmarkMode;
  runs: number;
  meanMs: number;
  medianMs: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
  stdDevMs: number;
  overheadPct: number;
}

const BENCHMARK_MODES: BenchmarkMode[] = ['parse-only', 'parse-time-detach'];

const DEFAULT_FIXTURES: BenchmarkFixtureSpec[] = [
  createFixtureSpec('smol', '../../../apps/docs/app/api/diff/smol.patch'),
  createFixtureSpec('larg', '../../../apps/docs/app/api/diff/larg.patch'),
  createFixtureSpec('larg2', '../../../apps/docs/app/api/diff/larg2.patch'),
  createFixtureSpec('larg3', '../../../apps/docs/app/api/diff/larg3.patch'),
];

const DEFAULT_CONFIG: Omit<BenchmarkConfig, 'fixtures'> = {
  outputJson: false,
  runs: 5,
  warmupRuns: 1,
};

function createFixtureSpec(
  label: string,
  relativePath: string
): BenchmarkFixtureSpec {
  return {
    label,
    path: resolve(import.meta.dir, relativePath),
  };
}

function parsePositiveInteger(value: string, flagName: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `Invalid ${flagName} value "${value}". Expected a positive integer.`
    );
  }
  return parsed;
}

function parseArgs(argv: string[]): BenchmarkConfig {
  const config: BenchmarkConfig = {
    ...DEFAULT_CONFIG,
    fixtures: DEFAULT_FIXTURES,
  };
  const fixtureArgs: string[] = [];

  for (let index = 0; index < argv.length; index++) {
    const rawArg = argv[index];
    if (rawArg === '--help' || rawArg === '-h') {
      printHelpAndExit();
    }
    if (rawArg === '--json') {
      config.outputJson = true;
      continue;
    }

    const [flag, inlineValue] = rawArg.split('=', 2);
    if (flag === '--runs') {
      const value = inlineValue ?? argv[index + 1];
      if (value == null) {
        throw new Error('Missing value for --runs');
      }
      if (inlineValue == null) {
        index++;
      }
      config.runs = parsePositiveInteger(value, '--runs');
      continue;
    }
    if (flag === '--warmup-runs') {
      const value = inlineValue ?? argv[index + 1];
      if (value == null) {
        throw new Error('Missing value for --warmup-runs');
      }
      if (inlineValue == null) {
        index++;
      }
      config.warmupRuns = parsePositiveInteger(value, '--warmup-runs');
      continue;
    }
    if (flag === '--fixture') {
      const value = inlineValue ?? argv[index + 1];
      if (value == null) {
        throw new Error('Missing value for --fixture');
      }
      if (inlineValue == null) {
        index++;
      }
      fixtureArgs.push(value);
      continue;
    }
    if (flag === '--fixtures') {
      const value = inlineValue ?? argv[index + 1];
      if (value == null) {
        throw new Error('Missing value for --fixtures');
      }
      if (inlineValue == null) {
        index++;
      }
      fixtureArgs.push(...value.split(',').filter(Boolean));
      continue;
    }

    throw new Error(`Unknown argument: ${rawArg}`);
  }

  if (fixtureArgs.length > 0) {
    config.fixtures = fixtureArgs.map(resolveFixtureArg);
  }

  return config;
}

function resolveFixtureArg(rawFixture: string): BenchmarkFixtureSpec {
  const fixture = DEFAULT_FIXTURES.find(({ label }) => label === rawFixture);
  if (fixture != null) {
    return fixture;
  }

  return {
    label: rawFixture,
    path: resolve(rawFixture),
  };
}

function printHelpAndExit(): never {
  console.log('Usage: bun ws diffs benchmark:parse-patch-files [options]');
  console.log('');
  console.log('Options:');
  console.log(
    '  --runs <number>          Measured runs per fixture/mode (default: 5)'
  );
  console.log(
    '  --warmup-runs <number>   Warmup runs per fixture/mode before measurement (default: 1)'
  );
  console.log(
    '  --fixture <name|path>    Fixture label or path to benchmark; can be repeated'
  );
  console.log(
    '  --fixtures <names>       Comma-separated fixture labels or paths'
  );
  console.log('  --json                   Emit machine-readable JSON output');
  console.log('  -h, --help               Show this help output');
  process.exit(0);
}

function countLines(contents: string): number {
  if (contents.length === 0) {
    return 0;
  }

  let lines = 1;
  for (let index = 0; index < contents.length; index++) {
    if (contents.charCodeAt(index) === 10) {
      lines++;
    }
  }
  return lines;
}

function collectParsedStats(parsedPatches: ParsedPatch[]): ParsedPatchStats {
  let additionLineCount = 0;
  let deletionLineCount = 0;
  let fileCount = 0;
  let hunkCount = 0;
  let unifiedLineCount = 0;

  for (const patch of parsedPatches) {
    fileCount += patch.files.length;
    for (const file of patch.files) {
      additionLineCount += file.additionLines.length;
      deletionLineCount += file.deletionLines.length;
      hunkCount += file.hunks.length;
      unifiedLineCount += file.unifiedLineCount;
    }
  }

  return {
    additionLineCount,
    deletionLineCount,
    fileCount,
    hunkCount,
    patchCount: parsedPatches.length,
    unifiedLineCount,
  };
}

function getStatsChecksum(stats: ParsedPatchStats): number {
  return (
    stats.patchCount +
    stats.fileCount * 3 +
    stats.hunkCount * 7 +
    stats.additionLineCount * 11 +
    stats.deletionLineCount * 13 +
    stats.unifiedLineCount * 17
  );
}

function runBenchmarkMode(
  patch: string,
  mode: BenchmarkMode
): { elapsedMs: number; stats: ParsedPatchStats } {
  const startTime = performance.now();
  const parsedPatches = parsePatchFiles(patch, 'benchmark', false, {
    detachStrings: mode === 'parse-time-detach',
  });
  const elapsedMs = performance.now() - startTime;
  return { elapsedMs, stats: collectParsedStats(parsedPatches) };
}

function percentile(sortedValues: number[], percentileRank: number): number {
  if (sortedValues.length === 0) {
    return 0;
  }

  const rank = (sortedValues.length - 1) * percentileRank;
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.ceil(rank);
  const lower = sortedValues[lowerIndex] ?? sortedValues[0] ?? 0;
  const upper =
    sortedValues[upperIndex] ?? sortedValues[sortedValues.length - 1] ?? lower;
  if (lowerIndex === upperIndex) {
    return lower;
  }

  return lower + (upper - lower) * (rank - lowerIndex);
}

function summarizeMode(
  fixture: string,
  mode: BenchmarkMode,
  samples: number[],
  parseOnlyMeanMs: number
): ModeSummary {
  if (samples.length === 0) {
    return {
      fixture,
      mode,
      runs: 0,
      meanMs: 0,
      medianMs: 0,
      p95Ms: 0,
      minMs: 0,
      maxMs: 0,
      stdDevMs: 0,
      overheadPct: 0,
    };
  }

  const sortedSamples = [...samples].sort((left, right) => left - right);
  const total = samples.reduce((sum, value) => sum + value, 0);
  const mean = total / samples.length;
  const variance =
    samples.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    samples.length;

  return {
    fixture,
    mode,
    runs: samples.length,
    meanMs: mean,
    medianMs: percentile(sortedSamples, 0.5),
    p95Ms: percentile(sortedSamples, 0.95),
    minMs: sortedSamples[0] ?? 0,
    maxMs: sortedSamples[sortedSamples.length - 1] ?? 0,
    stdDevMs: Math.sqrt(variance),
    overheadPct:
      mode === 'parse-only'
        ? 0
        : ((mean - parseOnlyMeanMs) / parseOnlyMeanMs) * 100,
  };
}

function formatMs(value: number): string {
  return value.toFixed(2);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatPercent(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}

function printSummaryTable(
  summaries: ModeSummary[],
  fixtureStats: Map<string, FixtureStats>
): void {
  const rows = summaries.map((summary) => {
    const stats = fixtureStats.get(summary.fixture);
    if (stats == null) {
      throw new Error(`Missing fixture stats for ${summary.fixture}`);
    }
    return {
      fixture: summary.fixture,
      mode: summary.mode,
      bytes: formatNumber(stats.bytes),
      lines: formatNumber(stats.lines),
      files: formatNumber(stats.parsed.fileCount),
      hunks: formatNumber(stats.parsed.hunkCount),
      runs: String(summary.runs),
      meanMs: formatMs(summary.meanMs),
      medianMs: formatMs(summary.medianMs),
      p95Ms: formatMs(summary.p95Ms),
      overhead: formatPercent(summary.overheadPct),
    };
  });
  const headers: (keyof (typeof rows)[number])[] = [
    'fixture',
    'mode',
    'bytes',
    'lines',
    'files',
    'hunks',
    'runs',
    'meanMs',
    'medianMs',
    'p95Ms',
    'overhead',
  ];
  const widths = headers.map((header) => {
    return rows.reduce(
      (max, row) => Math.max(max, row[header].length),
      header.length
    );
  });
  const formatRow = (row: Record<string, string>) =>
    headers
      .map((header, index) => row[header].padEnd(widths[index]))
      .join('  ')
      .trimEnd();
  const headerRow = Object.fromEntries(
    headers.map((header) => [header, header])
  );

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

function createSampleStorage(): Map<BenchmarkMode, number[]> {
  const storage = new Map<BenchmarkMode, number[]>();
  for (const mode of BENCHMARK_MODES) {
    storage.set(mode, []);
  }
  return storage;
}

function forceGarbageCollection(): void {
  globalThis.gc?.();
}

function main() {
  const config = parseArgs(process.argv.slice(2));
  const fixtureStats = new Map<string, FixtureStats>();
  const summaries: ModeSummary[] = [];
  let checksum = 0;

  for (const fixture of config.fixtures) {
    const patch = readFileSync(fixture.path, 'utf-8');
    const samplesByMode = createSampleStorage();

    for (let runIndex = 0; runIndex < config.warmupRuns; runIndex++) {
      for (const mode of BENCHMARK_MODES) {
        forceGarbageCollection();
        const { stats } = runBenchmarkMode(patch, mode);
        checksum += getStatsChecksum(stats);
      }
    }

    for (let runIndex = 0; runIndex < config.runs; runIndex++) {
      for (
        let modeOffset = 0;
        modeOffset < BENCHMARK_MODES.length;
        modeOffset++
      ) {
        const mode =
          BENCHMARK_MODES[(runIndex + modeOffset) % BENCHMARK_MODES.length];
        forceGarbageCollection();
        const { elapsedMs, stats } = runBenchmarkMode(patch, mode);
        checksum += getStatsChecksum(stats);
        samplesByMode.get(mode)?.push(elapsedMs);
        fixtureStats.set(fixture.label, {
          bytes: Buffer.byteLength(patch),
          lines: countLines(patch),
          parsed: stats,
        });
      }
    }

    const parseOnlySamples = samplesByMode.get('parse-only') ?? [];
    const parseOnlyMeanMs =
      parseOnlySamples.reduce((sum, value) => sum + value, 0) /
      parseOnlySamples.length;
    for (const mode of BENCHMARK_MODES) {
      summaries.push(
        summarizeMode(
          fixture.label,
          mode,
          samplesByMode.get(mode) ?? [],
          parseOnlyMeanMs
        )
      );
    }
  }

  if (config.outputJson) {
    console.log(
      JSON.stringify(
        {
          benchmark: 'parsePatchFiles',
          checksum,
          config: {
            fixtures: config.fixtures,
            runs: config.runs,
            warmupRuns: config.warmupRuns,
          },
          fixtureStats: Object.fromEntries(fixtureStats),
          summaries,
        },
        null,
        2
      )
    );
    return;
  }

  console.log('parsePatchFiles benchmark');
  console.log(
    `runsPerMode=${config.runs} warmupRunsPerMode=${config.warmupRuns}`
  );
  console.log(`checksum=${checksum}`);
  console.log('');
  printSummaryTable(summaries, fixtureStats);
}

main();
