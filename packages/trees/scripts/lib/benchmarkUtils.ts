export interface BenchmarkEnvironment {
  bunVersion: string;
  platform: string;
  arch: string;
}

export interface TimingSummary {
  runs: number;
  meanMs: number;
  medianMs: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
  stdDevMs: number;
}

export function parsePositiveInteger(value: string, flagName: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `Invalid ${flagName} value '${value}'. Expected a positive integer.`
    );
  }
  return parsed;
}

export function parseNonNegativeInteger(
  value: string,
  flagName: string
): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(
      `Invalid ${flagName} value '${value}'. Expected a non-negative integer.`
    );
  }
  return parsed;
}

export function percentile(
  sortedValues: number[],
  percentileRank: number
): number {
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

// Converts raw timing samples into the same summary statistics used in JSON
// output, text tables, and baseline comparisons.
export function summarizeSamples(samples: number[]): TimingSummary {
  if (samples.length === 0) {
    return {
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
    runs: samples.length,
    meanMs: mean,
    medianMs: percentile(sortedSamples, 0.5),
    p95Ms: percentile(sortedSamples, 0.95),
    minMs: sortedSamples[0] ?? 0,
    maxMs: sortedSamples[sortedSamples.length - 1] ?? 0,
    stdDevMs: Math.sqrt(variance),
  };
}

export function formatMs(value: number): string {
  return value.toFixed(3);
}

export function formatSignedMs(value: number): string {
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${value.toFixed(3)}`;
}

export function formatSignedPercent(value: number): string {
  if (!Number.isFinite(value)) {
    return value > 0 ? '+inf%' : value < 0 ? '-inf%' : '0.0%';
  }

  const prefix = value > 0 ? '+' : '';
  return `${prefix}${value.toFixed(1)}%`;
}

export function printTable(
  rows: Record<string, string>[],
  headers: string[]
): void {
  const widths = headers.map((header) => {
    const valueWidth = rows.reduce(
      (max, row) => Math.max(max, row[header]?.length ?? 0),
      header.length
    );
    return valueWidth;
  });

  const formatRow = (row: Record<string, string>) =>
    headers
      .map((header, index) => (row[header] ?? '').padEnd(widths[index]))
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

export function getEnvironment(): BenchmarkEnvironment {
  return {
    bunVersion: Bun.version,
    platform: process.platform,
    arch: process.arch,
  };
}

export function calculateDeltaPercent(
  current: number,
  baseline: number
): number {
  if (baseline === 0) {
    return current === 0 ? 0 : Number.POSITIVE_INFINITY;
  }

  return ((current - baseline) / baseline) * 100;
}

// Runs `runIteration` multiple times and reports per-iteration milliseconds.
// This reduces timer jitter for very fast operations while keeping reported
// numbers comparable to single-call timings.
export function measureAverageIterationMs(
  iterations: number,
  runIteration: () => void
): number {
  const startTime = performance.now();
  for (let iteration = 0; iteration < iterations; iteration++) {
    runIteration();
  }
  return (performance.now() - startTime) / iterations;
}
