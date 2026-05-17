import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface BenchmarkSummary {
  label: string;
  meanMs: number;
  medianMs: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
  checksum: number;
  rows: number;
  meanHeapGrowth?: number;
  meanRetainedHeapDelta?: number;
}

interface BenchmarkOutput {
  benchmark: 'iterateOverDiff';
  score: number;
  checksum: number;
  summaries: BenchmarkSummary[];
}

interface Config {
  baselinePath: string;
  candidatePath: string;
  outputJson: boolean;
}

interface ComparedSummary {
  label: string;
  baselineMeanMs: number;
  candidateMeanMs: number;
  meanDeltaMs: number;
  meanDeltaPct: number;
  baselineP95Ms: number;
  candidateP95Ms: number;
  p95DeltaPct: number;
  baselineHeapGrowth: number | undefined;
  candidateHeapGrowth: number | undefined;
  heapGrowthDeltaPct: number | undefined;
  rowsMatch: boolean;
  checksumMatch: boolean;
}

function parseArgs(argv: string[]): Config {
  let outputJson = false;
  const paths: string[] = [];

  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      printHelpAndExit();
    }
    if (arg === '--json') {
      outputJson = true;
      continue;
    }
    paths.push(arg);
  }

  const [baselinePath, candidatePath] = paths;
  if (baselinePath == null || candidatePath == null || paths.length > 2) {
    throw new Error(
      'Expected exactly two benchmark JSON paths: <baseline.json> <candidate.json>'
    );
  }

  return {
    baselinePath: resolve(process.cwd(), baselinePath),
    candidatePath: resolve(process.cwd(), candidatePath),
    outputJson,
  };
}

function printHelpAndExit(): never {
  console.log(
    'Usage: bun ws diffs benchmark:iterate-over-diff:compare <baseline.json> <candidate.json> [--json]'
  );
  console.log('');
  console.log(
    'Compares JSON output produced by benchmark:iterate-over-diff --json.'
  );
  console.log(
    'Negative deltas are faster/smaller; positive deltas are slower/larger.'
  );
  process.exit(0);
}

function readBenchmarkOutput(path: string): BenchmarkOutput {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as BenchmarkOutput;
  if (parsed.benchmark !== 'iterateOverDiff') {
    throw new Error(`Unsupported benchmark output in ${path}`);
  }
  return parsed;
}

function percentDelta(baseline: number, candidate: number): number {
  if (baseline === 0) {
    return candidate === 0 ? 0 : Infinity;
  }
  return ((candidate - baseline) / baseline) * 100;
}

function optionalPercentDelta(
  baseline: number | undefined,
  candidate: number | undefined
): number | undefined {
  if (baseline == null || candidate == null) {
    return undefined;
  }
  return percentDelta(baseline, candidate);
}

function compareSummaries(
  baseline: BenchmarkOutput,
  candidate: BenchmarkOutput
): ComparedSummary[] {
  const baselineByLabel = new Map(
    baseline.summaries.map((summary) => [summary.label, summary])
  );

  return candidate.summaries
    .map((candidateSummary) => {
      const baselineSummary = baselineByLabel.get(candidateSummary.label);
      if (baselineSummary == null) {
        return undefined;
      }
      return {
        label: candidateSummary.label,
        baselineMeanMs: baselineSummary.meanMs,
        candidateMeanMs: candidateSummary.meanMs,
        meanDeltaMs: candidateSummary.meanMs - baselineSummary.meanMs,
        meanDeltaPct: percentDelta(
          baselineSummary.meanMs,
          candidateSummary.meanMs
        ),
        baselineP95Ms: baselineSummary.p95Ms,
        candidateP95Ms: candidateSummary.p95Ms,
        p95DeltaPct: percentDelta(
          baselineSummary.p95Ms,
          candidateSummary.p95Ms
        ),
        baselineHeapGrowth: baselineSummary.meanHeapGrowth,
        candidateHeapGrowth: candidateSummary.meanHeapGrowth,
        heapGrowthDeltaPct: optionalPercentDelta(
          baselineSummary.meanHeapGrowth,
          candidateSummary.meanHeapGrowth
        ),
        rowsMatch: baselineSummary.rows === candidateSummary.rows,
        checksumMatch: baselineSummary.checksum === candidateSummary.checksum,
      } satisfies ComparedSummary;
    })
    .filter((summary): summary is ComparedSummary => summary != null)
    .sort(
      (left, right) =>
        Math.abs(right.meanDeltaPct) - Math.abs(left.meanDeltaPct)
    );
}

function formatMs(value: number): string {
  return value.toFixed(3);
}

function formatPct(value: number | undefined): string {
  if (value == null) {
    return '-';
  }
  if (!Number.isFinite(value)) {
    return value > 0 ? '+Inf%' : '-Inf%';
  }
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

function formatHeap(value: number | undefined): string {
  if (value == null) {
    return '-';
  }
  return `${(value / 1024).toFixed(1)}KiB`;
}

interface TableRow {
  case: string;
  meanBase: string;
  meanNext: string;
  meanDelta: string;
  p95Delta: string;
  heapBase: string;
  heapNext: string;
  heapDelta: string;
  rows: string;
  checksum: string;
}

function printComparisonTable(comparisons: ComparedSummary[]) {
  const rows: TableRow[] = comparisons.map((comparison) => ({
    case: comparison.label,
    meanBase: formatMs(comparison.baselineMeanMs),
    meanNext: formatMs(comparison.candidateMeanMs),
    meanDelta: `${formatMs(comparison.meanDeltaMs)} (${formatPct(
      comparison.meanDeltaPct
    )})`,
    p95Delta: formatPct(comparison.p95DeltaPct),
    heapBase: formatHeap(comparison.baselineHeapGrowth),
    heapNext: formatHeap(comparison.candidateHeapGrowth),
    heapDelta: formatPct(comparison.heapGrowthDeltaPct),
    rows: comparison.rowsMatch ? 'ok' : 'DIFF',
    checksum: comparison.checksumMatch ? 'ok' : 'DIFF',
  }));
  const headers: (keyof TableRow)[] = [
    'case',
    'meanBase',
    'meanNext',
    'meanDelta',
    'p95Delta',
    'heapBase',
    'heapNext',
    'heapDelta',
    'rows',
    'checksum',
  ];
  const widths = headers.map((header) =>
    rows.reduce((max, row) => Math.max(max, row[header].length), header.length)
  );
  const formatRow = (row: TableRow) =>
    headers
      .map((header, index) => row[header].padEnd(widths[index]))
      .join('  ')
      .trimEnd();
  const headerRow: TableRow = {
    case: 'case',
    meanBase: 'meanBase',
    meanNext: 'meanNext',
    meanDelta: 'meanDelta',
    p95Delta: 'p95Delta',
    heapBase: 'heapBase',
    heapNext: 'heapNext',
    heapDelta: 'heapDelta',
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

function main() {
  const config = parseArgs(process.argv.slice(2));
  const baseline = readBenchmarkOutput(config.baselinePath);
  const candidate = readBenchmarkOutput(config.candidatePath);
  const comparisons = compareSummaries(baseline, candidate);
  const scoreDeltaPct = percentDelta(baseline.score, candidate.score);
  const checksumMatch = baseline.checksum === candidate.checksum;

  if (config.outputJson) {
    console.log(
      JSON.stringify(
        {
          benchmark: 'iterateOverDiff:compare',
          baselinePath: config.baselinePath,
          candidatePath: config.candidatePath,
          baselineScore: baseline.score,
          candidateScore: candidate.score,
          scoreDeltaPct,
          checksumMatch,
          comparedCases: comparisons.length,
          comparisons,
        },
        null,
        2
      )
    );
    return;
  }

  console.log('iterateOverDiff benchmark comparison');
  console.log(`baseline=${config.baselinePath}`);
  console.log(`candidate=${config.candidatePath}`);
  console.log(
    `score ${formatMs(baseline.score)}ms -> ${formatMs(
      candidate.score
    )}ms (${formatPct(scoreDeltaPct)})`
  );
  console.log(`checksum=${checksumMatch ? 'ok' : 'DIFF'}`);
  console.log('');
  printComparisonTable(comparisons);
}

main();
