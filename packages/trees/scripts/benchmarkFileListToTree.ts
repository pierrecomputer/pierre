import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { FileTreeData } from '../src/types';
import {
  benchmarkFileListToTreeStages,
  type FileListToTreeStageName,
} from '../src/utils/fileListToTree';
import {
  type FileListToTreeBenchmarkCase,
  filterBenchmarkCases,
  getFileListToTreeBenchmarkCases,
} from './lib/fileListToTreeBenchmarkData';

interface BenchmarkConfig {
  runs: number;
  warmupRuns: number;
  outputJson: boolean;
  caseFilters: string[];
  comparePath?: string;
}

interface BenchmarkEnvironment {
  bunVersion: string;
  platform: string;
  arch: string;
}

interface TimingSummary {
  runs: number;
  meanMs: number;
  medianMs: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
  stdDevMs: number;
}

interface CaseSummary extends TimingSummary {
  name: string;
  source: FileListToTreeBenchmarkCase['source'];
  fileCount: number;
  uniqueFolderCount: number;
  maxDepth: number;
  checksum: number;
}

interface StageSummary {
  name: string;
  stages: Record<FileListToTreeStageName, TimingSummary>;
}

interface CaseComparison {
  name: string;
  checksumMatches: boolean;
  baselineChecksum: number;
  currentChecksum: number;
  baselineMedianMs: number;
  currentMedianMs: number;
  medianDeltaMs: number;
  medianDeltaPct: number;
  baselineMeanMs: number;
  currentMeanMs: number;
  meanDeltaMs: number;
  meanDeltaPct: number;
  baselineP95Ms: number;
  currentP95Ms: number;
  p95DeltaMs: number;
  p95DeltaPct: number;
}

interface StageComparisonSummary {
  baselineMedianMs: number;
  currentMedianMs: number;
  medianDeltaMs: number;
  medianDeltaPct: number;
}

interface StageComparison {
  name: string;
  stages: Record<FileListToTreeStageName, StageComparisonSummary>;
}

interface BenchmarkComparison {
  baselinePath: string;
  baselineEnvironment: BenchmarkEnvironment;
  baselineConfig: BenchmarkConfig;
  unmatchedCurrentCases: string[];
  unmatchedBaselineCases: string[];
  checksumMismatches: string[];
  cases: CaseComparison[];
  stages: StageComparison[];
}

interface BenchmarkOutput {
  benchmark: 'fileListToTree';
  environment: BenchmarkEnvironment;
  config: BenchmarkConfig;
  checksum: number;
  cases: CaseSummary[];
  stages: StageSummary[];
  comparison?: BenchmarkComparison;
}

interface LoadedBenchmarkBaseline {
  path: string;
  output: BenchmarkOutput;
}

const DEFAULT_CONFIG: BenchmarkConfig = {
  runs: 25,
  warmupRuns: 5,
  outputJson: false,
  caseFilters: [],
};

const STAGE_ORDER: FileListToTreeStageName[] = [
  'buildPathGraph',
  'buildFlattenedNodes',
  'buildFolderNodes',
  'hashTreeKeys',
];

function parsePositiveInteger(value: string, flagName: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `Invalid ${flagName} value '${value}'. Expected a positive integer.`
    );
  }
  return parsed;
}

function parseNonNegativeInteger(value: string, flagName: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(
      `Invalid ${flagName} value '${value}'. Expected a non-negative integer.`
    );
  }
  return parsed;
}

function printHelpAndExit(): never {
  console.log('Usage: bun ws trees benchmark -- [options]');
  console.log('');
  console.log('Options:');
  console.log(
    '  --runs <number>          Measured runs per benchmark case (default: 25)'
  );
  console.log(
    '  --warmup-runs <number>   Warmup runs per benchmark case before measurement (default: 5)'
  );
  console.log(
    '  --case <filter>          Run only cases whose name contains the filter (repeatable)'
  );
  console.log(
    '  --compare <path>         Compare against a prior --json benchmark run'
  );
  console.log('  --json                   Emit machine-readable JSON output');
  console.log('  -h, --help               Show this help output');
  process.exit(0);
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
    if (
      flag === '--runs' ||
      flag === '--warmup-runs' ||
      flag === '--case' ||
      flag === '--compare'
    ) {
      const value = inlineValue ?? argv[index + 1];
      if (value == null) {
        throw new Error(`Missing value for ${flag}`);
      }
      if (inlineValue == null) {
        index += 1;
      }

      if (flag === '--runs') {
        config.runs = parsePositiveInteger(value, '--runs');
      } else if (flag === '--warmup-runs') {
        config.warmupRuns = parseNonNegativeInteger(value, '--warmup-runs');
      } else if (flag === '--case') {
        config.caseFilters.push(value);
      } else {
        config.comparePath = value;
      }
      continue;
    }

    throw new Error(`Unknown argument: ${rawArg}`);
  }

  return config;
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

function summarizeSamples(samples: number[]): TimingSummary {
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

function formatMs(value: number): string {
  return value.toFixed(3);
}

function formatSignedMs(value: number): string {
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${value.toFixed(3)}`;
}

function formatSignedPercent(value: number): string {
  if (!Number.isFinite(value)) {
    return value > 0 ? '+inf%' : value < 0 ? '-inf%' : '0.0%';
  }

  const prefix = value > 0 ? '+' : '';
  return `${prefix}${value.toFixed(1)}%`;
}

function checksumTree(tree: FileTreeData): number {
  let checksum = 0;

  for (const [id, node] of Object.entries(tree)) {
    checksum += id.length;
    checksum += node.name.length;
    checksum += node.path.length;

    if (node.children != null) {
      checksum += node.children.direct.length;
      for (const child of node.children.direct) {
        checksum += child.length;
      }
      if (node.children.flattened != null) {
        checksum += node.children.flattened.length;
        for (const child of node.children.flattened) {
          checksum += child.length;
        }
      }
    }

    if (node.flattens != null) {
      checksum += node.flattens.length;
      for (const path of node.flattens) {
        checksum += path.length;
      }
    }
  }

  return checksum;
}

function printTable(rows: Record<string, string>[], headers: string[]): void {
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

function createStageSampleStorage(): Record<FileListToTreeStageName, number[]> {
  return {
    buildPathGraph: [],
    buildFlattenedNodes: [],
    buildFolderNodes: [],
    hashTreeKeys: [],
  };
}

function getEnvironment(): BenchmarkEnvironment {
  return {
    bunVersion: Bun.version,
    platform: process.platform,
    arch: process.arch,
  };
}

function calculateDeltaPercent(current: number, baseline: number): number {
  if (baseline === 0) {
    return current === 0 ? 0 : Number.POSITIVE_INFINITY;
  }

  return ((current - baseline) / baseline) * 100;
}

// Benchmarks only stay comparable when the output payload has the same shape.
// Load and validate the previous JSON run up front so comparison failures are
// immediate instead of producing misleading deltas later on.
function readBenchmarkBaseline(comparePath: string): LoadedBenchmarkBaseline {
  const resolvedPath = resolve(process.cwd(), comparePath);
  const parsed = JSON.parse(
    readFileSync(resolvedPath, 'utf-8')
  ) as Partial<BenchmarkOutput> | null;

  if (parsed == null || parsed.benchmark !== 'fileListToTree') {
    throw new Error(
      `Invalid benchmark baseline at ${resolvedPath}. Expected fileListToTree JSON output.`
    );
  }

  if (!Array.isArray(parsed.cases) || !Array.isArray(parsed.stages)) {
    throw new Error(
      `Invalid benchmark baseline at ${resolvedPath}. Expected cases and stages arrays.`
    );
  }

  return {
    path: resolvedPath,
    output: parsed as BenchmarkOutput,
  };
}

function buildComparison(
  baseline: LoadedBenchmarkBaseline,
  caseSummaries: CaseSummary[],
  stageSummaries: StageSummary[]
): BenchmarkComparison {
  const baselineCases = new Map(
    baseline.output.cases.map((summary) => [summary.name, summary])
  );
  const baselineStages = new Map(
    baseline.output.stages.map((summary) => [summary.name, summary])
  );
  const currentCaseNames = new Set(
    caseSummaries.map((summary) => summary.name)
  );

  const matchedCases = caseSummaries.filter((summary) =>
    baselineCases.has(summary.name)
  );
  if (matchedCases.length === 0) {
    throw new Error(
      `No benchmark cases matched baseline ${baseline.path}. Regenerate the baseline or adjust --case filters.`
    );
  }

  const caseComparisons = matchedCases.map((currentSummary) => {
    const baselineSummary = baselineCases.get(currentSummary.name);
    if (baselineSummary == null) {
      throw new Error(`Missing baseline case for ${currentSummary.name}`);
    }
    if (typeof baselineSummary.checksum !== 'number') {
      throw new Error(
        `Baseline case ${currentSummary.name} is missing a checksum. Regenerate the baseline with the current benchmark script.`
      );
    }

    return {
      name: currentSummary.name,
      checksumMatches: baselineSummary.checksum === currentSummary.checksum,
      baselineChecksum: baselineSummary.checksum,
      currentChecksum: currentSummary.checksum,
      baselineMedianMs: baselineSummary.medianMs,
      currentMedianMs: currentSummary.medianMs,
      medianDeltaMs: currentSummary.medianMs - baselineSummary.medianMs,
      medianDeltaPct: calculateDeltaPercent(
        currentSummary.medianMs,
        baselineSummary.medianMs
      ),
      baselineMeanMs: baselineSummary.meanMs,
      currentMeanMs: currentSummary.meanMs,
      meanDeltaMs: currentSummary.meanMs - baselineSummary.meanMs,
      meanDeltaPct: calculateDeltaPercent(
        currentSummary.meanMs,
        baselineSummary.meanMs
      ),
      baselineP95Ms: baselineSummary.p95Ms,
      currentP95Ms: currentSummary.p95Ms,
      p95DeltaMs: currentSummary.p95Ms - baselineSummary.p95Ms,
      p95DeltaPct: calculateDeltaPercent(
        currentSummary.p95Ms,
        baselineSummary.p95Ms
      ),
    };
  });

  const stageComparisons = matchedCases.map((currentSummary) => {
    const currentStageSummary = stageSummaries.find(
      (summary) => summary.name === currentSummary.name
    );
    const baselineStageSummary = baselineStages.get(currentSummary.name);
    if (currentStageSummary == null || baselineStageSummary == null) {
      throw new Error(
        `Missing stage summary for ${currentSummary.name}. Regenerate the baseline with the current benchmark script.`
      );
    }

    return {
      name: currentSummary.name,
      stages: Object.fromEntries(
        STAGE_ORDER.map((stage) => {
          const currentStage = currentStageSummary.stages[stage];
          const baselineStage = baselineStageSummary.stages[stage];
          if (currentStage == null || baselineStage == null) {
            throw new Error(
              `Missing ${stage} stage summary for ${currentSummary.name}. Regenerate the baseline with the current benchmark script.`
            );
          }

          return [
            stage,
            {
              baselineMedianMs: baselineStage.medianMs,
              currentMedianMs: currentStage.medianMs,
              medianDeltaMs: currentStage.medianMs - baselineStage.medianMs,
              medianDeltaPct: calculateDeltaPercent(
                currentStage.medianMs,
                baselineStage.medianMs
              ),
            },
          ];
        })
      ) as Record<FileListToTreeStageName, StageComparisonSummary>,
    };
  });

  return {
    baselinePath: baseline.path,
    baselineEnvironment: baseline.output.environment,
    baselineConfig: baseline.output.config,
    unmatchedCurrentCases: caseSummaries
      .filter((summary) => !baselineCases.has(summary.name))
      .map((summary) => summary.name),
    unmatchedBaselineCases: baseline.output.cases
      .filter((summary) => !currentCaseNames.has(summary.name))
      .map((summary) => summary.name),
    checksumMismatches: caseComparisons
      .filter((summary) => !summary.checksumMatches)
      .map((summary) => summary.name),
    cases: caseComparisons,
    stages: stageComparisons,
  };
}

function printComparison(comparison: BenchmarkComparison): void {
  console.log('');
  console.log('Comparison vs baseline');
  console.log(`baseline=${comparison.baselinePath}`);
  console.log(
    `baselineBun=${comparison.baselineEnvironment.bunVersion} baselinePlatform=${comparison.baselineEnvironment.platform} baselineArch=${comparison.baselineEnvironment.arch}`
  );
  console.log(
    `baselineRunsPerCase=${comparison.baselineConfig.runs} baselineWarmupRunsPerCase=${comparison.baselineConfig.warmupRuns}`
  );
  if (comparison.unmatchedCurrentCases.length > 0) {
    console.log(
      `unmatchedCurrentCases=${comparison.unmatchedCurrentCases.join(', ')}`
    );
  }
  if (comparison.unmatchedBaselineCases.length > 0) {
    console.log(
      `unmatchedBaselineCases=${comparison.unmatchedBaselineCases.join(', ')}`
    );
  }
  if (comparison.checksumMismatches.length > 0) {
    console.log(
      `checksumMismatches=${comparison.checksumMismatches.join(', ')}`
    );
  }
  console.log('');
  console.log('Case median deltas');
  printTable(
    comparison.cases.map((summary) => ({
      case: summary.name,
      baselineMedianMs: formatMs(summary.baselineMedianMs),
      currentMedianMs: formatMs(summary.currentMedianMs),
      deltaMs: formatSignedMs(summary.medianDeltaMs),
      deltaPct: formatSignedPercent(summary.medianDeltaPct),
      checksum: summary.checksumMatches ? 'match' : 'mismatch',
    })),
    [
      'case',
      'baselineMedianMs',
      'currentMedianMs',
      'deltaMs',
      'deltaPct',
      'checksum',
    ]
  );
  console.log('');
  console.log('Stage median deltas');
  printTable(
    comparison.stages.map((summary) => ({
      case: summary.name,
      buildPathGraph: formatSignedMs(
        summary.stages.buildPathGraph.medianDeltaMs
      ),
      buildFlattenedNodes: formatSignedMs(
        summary.stages.buildFlattenedNodes.medianDeltaMs
      ),
      buildFolderNodes: formatSignedMs(
        summary.stages.buildFolderNodes.medianDeltaMs
      ),
      hashTreeKeys: formatSignedMs(summary.stages.hashTreeKeys.medianDeltaMs),
    })),
    [
      'case',
      'buildPathGraph',
      'buildFlattenedNodes',
      'buildFolderNodes',
      'hashTreeKeys',
    ]
  );
}

function main() {
  const config = parseArgs(process.argv.slice(2));
  const selectedCases = filterBenchmarkCases(
    getFileListToTreeBenchmarkCases(),
    config.caseFilters
  );

  if (selectedCases.length === 0) {
    throw new Error('No benchmark cases matched the provided --case filters.');
  }

  const totalSamples = selectedCases.map(() => [] as number[]);
  const stageSamples = selectedCases.map(() => createStageSampleStorage());
  const caseChecksums = selectedCases.map(
    () => undefined as number | undefined
  );

  const runSingleCase = (
    caseConfig: FileListToTreeBenchmarkCase,
    caseIndex: number
  ) => {
    const startTime = performance.now();
    const result = benchmarkFileListToTreeStages(caseConfig.files);
    const elapsedMs = performance.now() - startTime;
    const resultChecksum = checksumTree(result.tree);
    const existingChecksum = caseChecksums[caseIndex];

    if (existingChecksum == null) {
      caseChecksums[caseIndex] = resultChecksum;
    } else if (existingChecksum !== resultChecksum) {
      throw new Error(
        `Non-deterministic checksum for benchmark case ${caseConfig.name}. Expected ${existingChecksum}, received ${resultChecksum}.`
      );
    }

    return {
      elapsedMs,
      checksum: resultChecksum,
      stageTimingsMs: result.stageTimingsMs,
    };
  };

  for (let runIndex = 0; runIndex < config.warmupRuns; runIndex++) {
    for (let caseOffset = 0; caseOffset < selectedCases.length; caseOffset++) {
      const caseIndex = (runIndex + caseOffset) % selectedCases.length;
      const caseConfig = selectedCases[caseIndex];
      runSingleCase(caseConfig, caseIndex);
    }
  }

  for (let runIndex = 0; runIndex < config.runs; runIndex++) {
    for (let caseOffset = 0; caseOffset < selectedCases.length; caseOffset++) {
      const caseIndex = (runIndex + caseOffset) % selectedCases.length;
      const caseConfig = selectedCases[caseIndex];
      const { elapsedMs, stageTimingsMs } = runSingleCase(
        caseConfig,
        caseIndex
      );
      totalSamples[caseIndex].push(elapsedMs);
      for (const stage of STAGE_ORDER) {
        stageSamples[caseIndex][stage].push(stageTimingsMs[stage]);
      }
    }
  }

  const caseSummaries: CaseSummary[] = selectedCases.map(
    (caseConfig, index) => {
      const checksum = caseChecksums[index];
      if (checksum == null) {
        throw new Error(
          `Missing checksum for benchmark case ${caseConfig.name}`
        );
      }

      return {
        name: caseConfig.name,
        source: caseConfig.source,
        fileCount: caseConfig.fileCount,
        uniqueFolderCount: caseConfig.uniqueFolderCount,
        maxDepth: caseConfig.maxDepth,
        checksum,
        ...summarizeSamples(totalSamples[index]),
      };
    }
  );

  const stageSummaries: StageSummary[] = selectedCases.map(
    (caseConfig, index) => ({
      name: caseConfig.name,
      stages: Object.fromEntries(
        STAGE_ORDER.map((stage) => [
          stage,
          summarizeSamples(stageSamples[index][stage]),
        ])
      ) as Record<FileListToTreeStageName, TimingSummary>,
    })
  );

  const checksum = caseSummaries.reduce(
    (sum, summary) => sum + summary.checksum,
    0
  );
  const environment = getEnvironment();
  const comparison =
    config.comparePath != null
      ? buildComparison(
          readBenchmarkBaseline(config.comparePath),
          caseSummaries,
          stageSummaries
        )
      : undefined;

  const output: BenchmarkOutput = {
    benchmark: 'fileListToTree',
    environment,
    config,
    checksum,
    cases: caseSummaries,
    stages: stageSummaries,
    ...(comparison != null && { comparison }),
  };

  if (config.outputJson) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log('fileListToTree benchmark');
  console.log(
    `bun=${environment.bunVersion} platform=${environment.platform} arch=${environment.arch}`
  );
  console.log(
    `cases=${selectedCases.length} runsPerCase=${config.runs} warmupRunsPerCase=${config.warmupRuns}`
  );
  if (config.caseFilters.length > 0) {
    console.log(`filters=${config.caseFilters.join(', ')}`);
  }
  console.log(`checksum=${checksum}`);
  console.log('');

  printTable(
    caseSummaries.map((summary) => ({
      case: summary.name,
      source: summary.source,
      files: String(summary.fileCount),
      folders: String(summary.uniqueFolderCount),
      depth: String(summary.maxDepth),
      runs: String(summary.runs),
      meanMs: formatMs(summary.meanMs),
      medianMs: formatMs(summary.medianMs),
      p95Ms: formatMs(summary.p95Ms),
      stdDevMs: formatMs(summary.stdDevMs),
    })),
    [
      'case',
      'source',
      'files',
      'folders',
      'depth',
      'runs',
      'meanMs',
      'medianMs',
      'p95Ms',
      'stdDevMs',
    ]
  );
  console.log('');
  console.log('Stage medians (ms)');
  printTable(
    stageSummaries.map((summary) => ({
      case: summary.name,
      buildPathGraph: formatMs(summary.stages.buildPathGraph.medianMs),
      buildFlattenedNodes: formatMs(
        summary.stages.buildFlattenedNodes.medianMs
      ),
      buildFolderNodes: formatMs(summary.stages.buildFolderNodes.medianMs),
      hashTreeKeys: formatMs(summary.stages.hashTreeKeys.medianMs),
    })),
    [
      'case',
      'buildPathGraph',
      'buildFlattenedNodes',
      'buildFolderNodes',
      'hashTreeKeys',
    ]
  );

  if (comparison != null) {
    printComparison(comparison);
  }
}

main();
