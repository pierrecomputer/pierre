import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseMergeConflictDiffFromFile } from '../src/utils/parseMergeConflictDiffFromFile';

interface BenchmarkCase {
  label: string;
  maxContextLines: number;
}

interface BenchmarkConfig {
  runs: number;
  warmupRuns: number;
  outputJson: boolean;
}

interface CaseSummary {
  label: string;
  maxContextLines: number;
  runs: number;
  meanMs: number;
  medianMs: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
  stdDevMs: number;
}

const BENCHMARK_CASES: BenchmarkCase[] = [
  { label: 'maxContextLines=10', maxContextLines: 10 },
  { label: 'maxContextLines=3', maxContextLines: 3 },
  { label: 'maxContextLines=Infinity', maxContextLines: Infinity },
];

const DEFAULT_CONFIG: BenchmarkConfig = {
  runs: 500,
  warmupRuns: 20,
  outputJson: false,
};

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
  const config: BenchmarkConfig = { ...DEFAULT_CONFIG };

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

    throw new Error(`Unknown argument: ${rawArg}`);
  }

  return config;
}

function printHelpAndExit(): never {
  console.log(
    'Usage: bun ws diffs benchmark:parse-merge-conflict -- [options]'
  );
  console.log('');
  console.log('Options:');
  console.log(
    '  --runs <number>          Measured runs per benchmark case (default: 500)'
  );
  console.log(
    '  --warmup-runs <number>   Warmup runs per benchmark case before measurement (default: 20)'
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

  const interpolation = rank - lowerIndex;
  return lower + (upper - lower) * interpolation;
}

function summarizeCase(
  caseConfig: BenchmarkCase,
  samples: number[]
): CaseSummary {
  if (samples.length === 0) {
    return {
      label: caseConfig.label,
      maxContextLines: caseConfig.maxContextLines,
      runs: 0,
      meanMs: 0,
      medianMs: 0,
      p95Ms: 0,
      minMs: 0,
      maxMs: 0,
      stdDevMs: 0,
    };
  }

  const sortedSamples = [...samples].sort((left, right) => left - right);
  const total = samples.reduce((sum, value) => sum + value, 0);
  const mean = total / samples.length;
  const variance =
    samples.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    samples.length;

  return {
    label: caseConfig.label,
    maxContextLines: caseConfig.maxContextLines,
    runs: samples.length,
    meanMs: mean,
    medianMs: percentile(sortedSamples, 0.5),
    p95Ms: percentile(sortedSamples, 0.95),
    minMs: sortedSamples[0] ?? 0,
    maxMs: sortedSamples[sortedSamples.length - 1] ?? 0,
    stdDevMs: Math.sqrt(variance),
  };
}

function formatMs(value: number): string {
  return value.toFixed(3);
}

function printSummaryTable(summaries: CaseSummary[]) {
  const rows = summaries.map((summary) => ({
    case: summary.label,
    runs: String(summary.runs),
    meanMs: formatMs(summary.meanMs),
    medianMs: formatMs(summary.medianMs),
    p95Ms: formatMs(summary.p95Ms),
    minMs: formatMs(summary.minMs),
    maxMs: formatMs(summary.maxMs),
    stdDevMs: formatMs(summary.stdDevMs),
  }));

  const headers: (keyof (typeof rows)[number])[] = [
    'case',
    'runs',
    'meanMs',
    'medianMs',
    'p95Ms',
    'minMs',
    'maxMs',
    'stdDevMs',
  ];

  const widths = headers.map((header) => {
    const valueWidth = rows.reduce(
      (max, row) => Math.max(max, row[header].length),
      header.length
    );
    return valueWidth;
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

function createCaseStorage() {
  return BENCHMARK_CASES.map(() => [] as number[]);
}

function main() {
  const config = parseArgs(process.argv.slice(2));
  const fixturePath = resolve(
    import.meta.dir,
    '../../../apps/demo/src/mocks/fileConflictLarge.txt'
  );
  const fileConflictLarge = readFileSync(fixturePath, 'utf-8');
  const fixtureLineCount = countLines(fileConflictLarge);
  const fixtureFile = {
    name: 'fileConflictLarge.ts',
    contents: fileConflictLarge,
  };

  const samplesByCase = createCaseStorage();
  let resultChecksum = 0;

  const runSingleCase = (caseConfig: BenchmarkCase) => {
    const startTime = performance.now();
    const result = parseMergeConflictDiffFromFile(
      fixtureFile,
      caseConfig.maxContextLines
    );
    const elapsedMs = performance.now() - startTime;
    resultChecksum +=
      result.fileDiff.hunks.length +
      result.fileDiff.unifiedLineCount +
      result.actions.length +
      result.markerRows.length;
    return elapsedMs;
  };

  for (let runIndex = 0; runIndex < config.warmupRuns; runIndex++) {
    for (
      let caseOffset = 0;
      caseOffset < BENCHMARK_CASES.length;
      caseOffset++
    ) {
      const caseIndex = (runIndex + caseOffset) % BENCHMARK_CASES.length;
      const caseConfig = BENCHMARK_CASES[caseIndex];
      runSingleCase(caseConfig);
    }
  }

  for (let runIndex = 0; runIndex < config.runs; runIndex++) {
    for (
      let caseOffset = 0;
      caseOffset < BENCHMARK_CASES.length;
      caseOffset++
    ) {
      const caseIndex = (runIndex + caseOffset) % BENCHMARK_CASES.length;
      const caseConfig = BENCHMARK_CASES[caseIndex];
      const elapsedMs = runSingleCase(caseConfig);
      samplesByCase[caseIndex].push(elapsedMs);
    }
  }

  const summaries = BENCHMARK_CASES.map((caseConfig, index) =>
    summarizeCase(caseConfig, samplesByCase[index])
  );

  // Pool all samples across cases and compute the overall median as a single combined score
  const allSamples = samplesByCase.flat().sort((a, b) => a - b);
  const score = percentile(allSamples, 0.5);

  if (config.outputJson) {
    console.log(
      JSON.stringify(
        {
          benchmark: 'parseMergeConflictDiffFromFile',
          fixturePath,
          fixtureLineCount,
          config,
          checksum: resultChecksum,
          summaries,
          score,
        },
        null,
        2
      )
    );
    return;
  }

  console.log('parseMergeConflictDiffFromFile benchmark');
  console.log(`fixture=${fixturePath}`);
  console.log(`fixtureLines=${fixtureLineCount}`);
  console.log(
    `runsPerCase=${config.runs} warmupRunsPerCase=${config.warmupRuns}`
  );
  console.log(`checksum=${resultChecksum}`);
  console.log('');
  printSummaryTable(summaries);
  console.log('');
  console.log(`score=${formatMs(score)}ms`);
}

main();
