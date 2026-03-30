import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { FileTreeOptions, FileTreeStateConfig } from '../src/FileTree';
import {
  type BenchmarkEnvironment,
  calculateDeltaPercent,
  formatMs,
  formatSignedMs,
  formatSignedPercent,
  getEnvironment,
  parseNonNegativeInteger,
  parsePositiveInteger,
  printTable,
  summarizeSamples,
  type TimingSummary,
} from './lib/benchmarkUtils';
import type {
  BenchmarkRenderRuntime,
  BenchmarkVirtualizedRootProps,
  BenchmarkVirtualRange,
} from './lib/benchmarkVirtualizedRenderRuntime';
import {
  type FileListToTreeBenchmarkCase,
  filterBenchmarkCases,
  getFileListToTreeBenchmarkCases,
} from './lib/fileListToTreeBenchmarkData';

type TreeRenderOperationName = 'renderStaticWindow' | 'constructAndRender';

export interface BenchmarkConfig {
  runs: number;
  warmupRuns: number;
  outputJson: boolean;
  caseFilters: string[];
  comparePath?: string;
  windowStart: number;
  windowSize: number;
  itemHeight: number;
  viewportHeight: number;
}

interface BenchmarkRuntimeInfo {
  codePath: 'dist';
  nodeEnv: 'production';
  renderer: 'preact-render-to-string';
  renderHarness: 'benchmark-local-static-virtualizer';
  buildCommand: 'bun run build';
}

interface LoadedBenchmarkRuntime {
  runtimeInfo: BenchmarkRuntimeInfo;
  h: typeof import('preact').h;
  renderToString: typeof import('preact-render-to-string').renderToString;
  benchmarkRuntime: BenchmarkRenderRuntime;
}

interface BenchmarkFileTreeInstance {
  options: FileTreeOptions;
  stateConfig: FileTreeStateConfig;
}

interface PreparedBenchmarkCase {
  name: string;
  source: FileListToTreeBenchmarkCase['source'];
  fileCount: number;
  uniqueFolderCount: number;
  maxDepth: number;
  expandedFolderCount: number;
  options: FileTreeOptions;
  stateConfig: FileTreeStateConfig;
  sharedRenderInstance: BenchmarkFileTreeInstance;
  expectedWindowRange: BenchmarkVirtualRange;
  expectedRenderedItemCount: number;
  expectedHtmlLength: number;
  htmlChecksum: number;
}

interface CaseSummary {
  name: string;
  source: FileListToTreeBenchmarkCase['source'];
  fileCount: number;
  uniqueFolderCount: number;
  maxDepth: number;
  expandedFolderCount: number;
  windowStart: number;
  windowSize: number;
  renderedItemCount: number;
  htmlLength: number;
  htmlChecksum: number;
  operations: Record<TreeRenderOperationName, TimingSummary>;
}

interface OperationComparisonSummary {
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

interface CaseComparison {
  name: string;
  htmlChecksumMatches: boolean;
  renderedItemCountMatches: boolean;
  htmlLengthMatches: boolean;
  operations: Record<TreeRenderOperationName, OperationComparisonSummary>;
}

interface BenchmarkComparison {
  baselinePath: string;
  baselineEnvironment: BenchmarkEnvironment;
  baselineRuntime: BenchmarkRuntimeInfo;
  baselineConfig: BenchmarkConfig;
  unmatchedCurrentCases: string[];
  unmatchedBaselineCases: string[];
  checksumMismatches: string[];
  cases: CaseComparison[];
}

interface BenchmarkOutput {
  benchmark: 'virtualizedFileTreeRender';
  environment: BenchmarkEnvironment;
  runtime: BenchmarkRuntimeInfo;
  config: BenchmarkConfig;
  checksum: number;
  cases: CaseSummary[];
  comparison?: BenchmarkComparison;
}

interface LoadedBenchmarkBaseline {
  path: string;
  output: BenchmarkOutput;
}

interface RenderSnapshot {
  html: string;
  renderedItemCount: number;
  htmlLength: number;
  htmlChecksum: number;
}

const DEFAULT_CONFIG: BenchmarkConfig = {
  runs: 12,
  warmupRuns: 3,
  outputJson: false,
  caseFilters: [],
  windowStart: 0,
  windowSize: 30,
  itemHeight: 30,
  viewportHeight: 500,
};

const OPERATION_ORDER: TreeRenderOperationName[] = [
  'renderStaticWindow',
  'constructAndRender',
];
const DEFAULT_CASE_FILTERS = ['linux'];
const COMPARE_SENSITIVE_CONFIG_FIELDS = [
  'windowStart',
  'windowSize',
  'itemHeight',
  'viewportHeight',
] as const;
type CompareSensitiveConfigField =
  (typeof COMPARE_SENSITIVE_CONFIG_FIELDS)[number];
const COMPARE_SENSITIVE_RUNTIME_FIELDS = [
  'codePath',
  'nodeEnv',
  'renderer',
  'renderHarness',
] as const;
type CompareSensitiveRuntimeField =
  (typeof COMPARE_SENSITIVE_RUNTIME_FIELDS)[number];
type ComparableRuntimeMetadata = Record<CompareSensitiveRuntimeField, string>;
type ComparableRenderBenchmarkBaseline = {
  path: string;
  output: {
    config: Pick<BenchmarkConfig, CompareSensitiveConfigField>;
    runtime?: Partial<ComparableRuntimeMetadata>;
  };
};
type ComparableRenderBenchmarkComparison = {
  unmatchedCurrentCases: string[];
  checksumMismatches: string[];
};

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const textDecoder = new TextDecoder();

function printHelpAndExit(): never {
  console.log('Usage: bun ws trees benchmark:render -- [options]');
  console.log('');
  console.log('Options:');
  console.log(
    '  --runs <number>          Measured runs per benchmark case (default: 12)'
  );
  console.log(
    '  --warmup-runs <number>   Warmup runs per benchmark case before measurement (default: 3)'
  );
  console.log(
    '  --window-start <number>  First visible item index for the simulated virtual window (default: 0)'
  );
  console.log(
    '  --window-size <number>   Visible item count for the simulated virtual window (default: 30)'
  );
  console.log(
    '  --item-height <number>   Fixed row height passed to the simulated virtual window (default: 30)'
  );
  console.log(
    '  --viewport-height <number>  Viewport height passed to the simulated virtual window (default: 500)'
  );
  console.log(
    '  --case <filter>          Run only cases whose name contains the filter (repeatable). Defaults to linux fixture only.'
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
      flag === '--window-start' ||
      flag === '--window-size' ||
      flag === '--item-height' ||
      flag === '--viewport-height' ||
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
      } else if (flag === '--window-start') {
        config.windowStart = parseNonNegativeInteger(value, '--window-start');
      } else if (flag === '--window-size') {
        config.windowSize = parsePositiveInteger(value, '--window-size');
      } else if (flag === '--item-height') {
        config.itemHeight = parsePositiveInteger(value, '--item-height');
      } else if (flag === '--viewport-height') {
        config.viewportHeight = parsePositiveInteger(
          value,
          '--viewport-height'
        );
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

function decodeOutput(output: Uint8Array): string {
  return textDecoder.decode(output).trim();
}

// Benchmark the same code we publish by rebuilding `dist/` up front and then
// importing the built modules under an explicit production NODE_ENV.
function ensureProductionDistBuild(): BenchmarkRuntimeInfo {
  process.env.NODE_ENV = 'production';

  const buildResult = Bun.spawnSync({
    cmd: ['bun', 'run', 'build'],
    cwd: packageRoot,
    env: {
      ...process.env,
      AGENT: '1',
      NODE_ENV: 'production',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  if (buildResult.exitCode !== 0) {
    const stdout = decodeOutput(buildResult.stdout);
    const stderr = decodeOutput(buildResult.stderr);
    throw new Error(
      [
        'Failed to build @pierre/trees before running the render benchmark.',
        stdout !== '' ? `stdout:\n${stdout}` : null,
        stderr !== '' ? `stderr:\n${stderr}` : null,
      ]
        .filter((line): line is string => line != null)
        .join('\n\n')
    );
  }

  return {
    codePath: 'dist',
    nodeEnv: 'production',
    renderer: 'preact-render-to-string',
    renderHarness: 'benchmark-local-static-virtualizer',
    buildCommand: 'bun run build',
  };
}

async function loadBenchmarkRuntime(): Promise<LoadedBenchmarkRuntime> {
  const runtimeInfo = ensureProductionDistBuild();
  const [{ h }, renderToStringModule, runtimeModule] = await Promise.all([
    import('preact'),
    import('preact-render-to-string'),
    import(
      new URL('./lib/benchmarkVirtualizedRenderRuntime.tsx', import.meta.url)
        .href
    ),
  ]);
  const benchmarkRuntime =
    await runtimeModule.loadBenchmarkVirtualizedRenderRuntime();

  return {
    runtimeInfo,
    h,
    renderToString: renderToStringModule.renderToString,
    benchmarkRuntime,
  };
}

function createOperationSampleStorage(): Record<
  TreeRenderOperationName,
  number[]
> {
  return {
    renderStaticWindow: [],
    constructAndRender: [],
  };
}

function checksumHtml(html: string): number {
  let hash = 2166136261;
  for (let index = 0; index < html.length; index++) {
    hash ^= html.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function countRenderedItems(html: string): number {
  return html.split('data-type="item"').length - 1;
}

function buildWindowRange(config: BenchmarkConfig): BenchmarkVirtualRange {
  return {
    start: config.windowStart,
    end: config.windowStart + config.windowSize - 1,
  };
}

function collectExpandedFolderPaths(
  files: string[],
  benchmarkRuntime: BenchmarkRenderRuntime
): string[] {
  const expandedPaths = new Set<string>();

  for (const filePath of files) {
    const normalizedPath = benchmarkRuntime.normalizeInputPath(filePath);
    if (normalizedPath == null) {
      continue;
    }

    benchmarkRuntime.forEachFolderInNormalizedPath(
      normalizedPath.path,
      normalizedPath.isDirectory,
      (folderPath) => {
        expandedPaths.add(folderPath);
      }
    );
  }

  return Array.from(expandedPaths);
}

function createFileTreeOptions(
  caseConfig: FileListToTreeBenchmarkCase
): FileTreeOptions {
  return {
    id: `benchmark-render-${caseConfig.name.replace(/[^A-Za-z0-9_-]/g, '-')}`,
    initialFiles: caseConfig.files,
    flattenEmptyDirectories: true,
    sort: false,
    virtualize: { threshold: 0 },
  };
}

function createStateConfig(
  caseConfig: FileListToTreeBenchmarkCase,
  benchmarkRuntime: BenchmarkRenderRuntime
): FileTreeStateConfig {
  return {
    initialExpandedItems:
      caseConfig.expandedFolders ??
      collectExpandedFolderPaths(caseConfig.files, benchmarkRuntime),
  };
}

function buildRootProps(
  fileTree: BenchmarkFileTreeInstance,
  config: BenchmarkConfig
): BenchmarkVirtualizedRootProps {
  return {
    fileTreeOptions: fileTree.options,
    stateConfig: fileTree.stateConfig,
    virtualizedRenderWindow: {
      range: buildWindowRange(config),
      itemHeight: config.itemHeight,
      viewportHeight: config.viewportHeight,
    },
  };
}

function renderBenchmarkWindow(
  fileTree: BenchmarkFileTreeInstance,
  config: BenchmarkConfig,
  runtime: LoadedBenchmarkRuntime
): RenderSnapshot {
  const html = runtime.renderToString(
    runtime.h(
      runtime.benchmarkRuntime.BenchmarkVirtualizedRoot,
      buildRootProps(fileTree, config)
    )
  );
  return {
    html,
    renderedItemCount: countRenderedItems(html),
    htmlLength: html.length,
    htmlChecksum: checksumHtml(html),
  };
}

// Prepares a stable benchmark fixture once per case so measured runs only pay
// for instance construction and/or SSR rendering, not fixture discovery.
function prepareBenchmarkCase(
  caseConfig: FileListToTreeBenchmarkCase,
  config: BenchmarkConfig,
  runtime: LoadedBenchmarkRuntime
): PreparedBenchmarkCase {
  const options = createFileTreeOptions(caseConfig);
  const stateConfig = createStateConfig(caseConfig, runtime.benchmarkRuntime);
  const sharedRenderInstance = new runtime.benchmarkRuntime.FileTree(
    options,
    stateConfig
  );
  const expectedSnapshot = renderBenchmarkWindow(
    sharedRenderInstance,
    config,
    runtime
  );

  return {
    name: caseConfig.name,
    source: caseConfig.source,
    fileCount: caseConfig.fileCount,
    uniqueFolderCount: caseConfig.uniqueFolderCount,
    maxDepth: caseConfig.maxDepth,
    expandedFolderCount: stateConfig.initialExpandedItems?.length ?? 0,
    options,
    stateConfig,
    sharedRenderInstance,
    expectedWindowRange: buildWindowRange(config),
    expectedRenderedItemCount: expectedSnapshot.renderedItemCount,
    expectedHtmlLength: expectedSnapshot.htmlLength,
    htmlChecksum: expectedSnapshot.htmlChecksum,
  };
}

function assertDeterministicRender(
  caseConfig: PreparedBenchmarkCase,
  snapshot: Omit<RenderSnapshot, 'html'>
): void {
  if (snapshot.renderedItemCount !== caseConfig.expectedRenderedItemCount) {
    throw new Error(
      `Non-deterministic rendered item count for ${caseConfig.name}. Expected ${caseConfig.expectedRenderedItemCount}, received ${snapshot.renderedItemCount}.`
    );
  }

  if (snapshot.htmlLength !== caseConfig.expectedHtmlLength) {
    throw new Error(
      `Non-deterministic HTML length for ${caseConfig.name}. Expected ${caseConfig.expectedHtmlLength}, received ${snapshot.htmlLength}.`
    );
  }

  if (snapshot.htmlChecksum !== caseConfig.htmlChecksum) {
    throw new Error(
      `Non-deterministic HTML checksum for ${caseConfig.name}. Expected ${caseConfig.htmlChecksum}, received ${snapshot.htmlChecksum}.`
    );
  }
}

// Benchmarks only stay comparable when the output payload has the same shape.
// Load and validate the previous JSON run up front so comparison failures are
// immediate instead of producing misleading deltas later on.
function readBenchmarkBaseline(comparePath: string): LoadedBenchmarkBaseline {
  const resolvedPath = resolve(process.cwd(), comparePath);
  const parsed = JSON.parse(
    readFileSync(resolvedPath, 'utf-8')
  ) as Partial<BenchmarkOutput> | null;

  if (parsed == null || parsed.benchmark !== 'virtualizedFileTreeRender') {
    throw new Error(
      `Invalid benchmark baseline at ${resolvedPath}. Expected virtualizedFileTreeRender JSON output.`
    );
  }

  if (!Array.isArray(parsed.cases)) {
    throw new Error(
      `Invalid benchmark baseline at ${resolvedPath}. Expected a cases array.`
    );
  }

  if (parsed.runtime == null || typeof parsed.runtime !== 'object') {
    throw new Error(
      `Invalid benchmark baseline at ${resolvedPath}. Expected runtime metadata from the current benchmark script.`
    );
  }

  return {
    path: resolvedPath,
    output: parsed as BenchmarkOutput,
  };
}

function buildComparison(
  baseline: LoadedBenchmarkBaseline,
  caseSummaries: CaseSummary[]
): BenchmarkComparison {
  const baselineCases = new Map(
    baseline.output.cases.map((summary) => [summary.name, summary])
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

    if (
      typeof baselineSummary.htmlChecksum !== 'number' ||
      typeof baselineSummary.renderedItemCount !== 'number' ||
      typeof baselineSummary.htmlLength !== 'number'
    ) {
      throw new Error(
        `Baseline case ${currentSummary.name} is missing HTML benchmark metadata. Regenerate the baseline with the current benchmark script.`
      );
    }

    const operationComparisons = Object.fromEntries(
      OPERATION_ORDER.map((operation) => {
        const baselineOperation = baselineSummary.operations?.[operation];
        const currentOperation = currentSummary.operations[operation];
        if (baselineOperation == null) {
          throw new Error(
            `Missing ${operation} summary for ${currentSummary.name}. Regenerate the baseline with the current benchmark script.`
          );
        }

        return [
          operation,
          {
            baselineMedianMs: baselineOperation.medianMs,
            currentMedianMs: currentOperation.medianMs,
            medianDeltaMs:
              currentOperation.medianMs - baselineOperation.medianMs,
            medianDeltaPct: calculateDeltaPercent(
              currentOperation.medianMs,
              baselineOperation.medianMs
            ),
            baselineMeanMs: baselineOperation.meanMs,
            currentMeanMs: currentOperation.meanMs,
            meanDeltaMs: currentOperation.meanMs - baselineOperation.meanMs,
            meanDeltaPct: calculateDeltaPercent(
              currentOperation.meanMs,
              baselineOperation.meanMs
            ),
            baselineP95Ms: baselineOperation.p95Ms,
            currentP95Ms: currentOperation.p95Ms,
            p95DeltaMs: currentOperation.p95Ms - baselineOperation.p95Ms,
            p95DeltaPct: calculateDeltaPercent(
              currentOperation.p95Ms,
              baselineOperation.p95Ms
            ),
          },
        ];
      })
    ) as Record<TreeRenderOperationName, OperationComparisonSummary>;

    return {
      name: currentSummary.name,
      htmlChecksumMatches:
        baselineSummary.htmlChecksum === currentSummary.htmlChecksum,
      renderedItemCountMatches:
        baselineSummary.renderedItemCount === currentSummary.renderedItemCount,
      htmlLengthMatches:
        baselineSummary.htmlLength === currentSummary.htmlLength,
      operations: operationComparisons,
    };
  });

  return {
    baselinePath: baseline.path,
    baselineEnvironment: baseline.output.environment,
    baselineRuntime: baseline.output.runtime,
    baselineConfig: baseline.output.config,
    unmatchedCurrentCases: caseSummaries
      .filter((summary) => !baselineCases.has(summary.name))
      .map((summary) => summary.name),
    unmatchedBaselineCases: baseline.output.cases
      .filter((summary) => !currentCaseNames.has(summary.name))
      .map((summary) => summary.name),
    checksumMismatches: caseComparisons
      .filter(
        (summary) =>
          !summary.htmlChecksumMatches ||
          !summary.renderedItemCountMatches ||
          !summary.htmlLengthMatches
      )
      .map((summary) => summary.name),
    cases: caseComparisons,
  };
}

function buildCompareCompatibilityErrors(
  baseline: ComparableRenderBenchmarkBaseline,
  comparison: ComparableRenderBenchmarkComparison,
  currentConfig: Pick<BenchmarkConfig, CompareSensitiveConfigField>,
  currentRuntime: ComparableRuntimeMetadata
): string[] {
  const errors: string[] = [];

  for (const field of COMPARE_SENSITIVE_CONFIG_FIELDS) {
    if (baseline.output.config[field] !== currentConfig[field]) {
      errors.push(
        `baseline ${field}=${baseline.output.config[field]} does not match current ${field}=${currentConfig[field]}`
      );
    }
  }

  for (const field of COMPARE_SENSITIVE_RUNTIME_FIELDS) {
    if (baseline.output.runtime?.[field] !== currentRuntime[field]) {
      errors.push(
        `baseline ${field}=${baseline.output.runtime?.[field] ?? 'missing'} does not match current ${field}=${currentRuntime[field]}`
      );
    }
  }

  if (comparison.unmatchedCurrentCases.length > 0) {
    errors.push(
      `baseline is missing current cases: ${comparison.unmatchedCurrentCases.join(', ')}`
    );
  }

  if (comparison.checksumMismatches.length > 0) {
    errors.push(
      `baseline HTML output does not match current output for cases: ${comparison.checksumMismatches.join(', ')}`
    );
  }

  return errors;
}

// Compare mode is intended for regression checks, so mismatched baselines
// should fail the run instead of producing a misleading success exit code.
export function assertComparableRenderBenchmarkBaseline(
  baseline: ComparableRenderBenchmarkBaseline,
  comparison: ComparableRenderBenchmarkComparison,
  currentConfig: Pick<BenchmarkConfig, CompareSensitiveConfigField>,
  currentRuntime: ComparableRuntimeMetadata
): void {
  const errors = buildCompareCompatibilityErrors(
    baseline,
    comparison,
    currentConfig,
    currentRuntime
  );
  if (errors.length === 0) {
    return;
  }

  throw new Error(
    [
      `Incompatible benchmark baseline at ${baseline.path}.`,
      ...errors.map((error) => `- ${error}`),
      'Regenerate the baseline with the current benchmark settings before using --compare.',
    ].join('\n')
  );
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
  console.log(
    `baselineCodePath=${comparison.baselineRuntime.codePath} baselineNodeEnv=${comparison.baselineRuntime.nodeEnv} baselineRenderer=${comparison.baselineRuntime.renderer} baselineHarness=${comparison.baselineRuntime.renderHarness}`
  );
  console.log(
    `baselineWindowStart=${comparison.baselineConfig.windowStart} baselineWindowSize=${comparison.baselineConfig.windowSize}`
  );
  console.log(
    `baselineItemHeight=${comparison.baselineConfig.itemHeight} baselineViewportHeight=${comparison.baselineConfig.viewportHeight}`
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
      renderDeltaMs: formatSignedMs(
        summary.operations.renderStaticWindow.medianDeltaMs
      ),
      renderDeltaPct: formatSignedPercent(
        summary.operations.renderStaticWindow.medianDeltaPct
      ),
      endToEndDeltaMs: formatSignedMs(
        summary.operations.constructAndRender.medianDeltaMs
      ),
      endToEndDeltaPct: formatSignedPercent(
        summary.operations.constructAndRender.medianDeltaPct
      ),
      htmlChecksum: summary.htmlChecksumMatches ? 'match' : 'mismatch',
      htmlLength: summary.htmlLengthMatches ? 'match' : 'mismatch',
      renderedItems: summary.renderedItemCountMatches ? 'match' : 'mismatch',
    })),
    [
      'case',
      'renderDeltaMs',
      'renderDeltaPct',
      'endToEndDeltaMs',
      'endToEndDeltaPct',
      'htmlChecksum',
      'htmlLength',
      'renderedItems',
    ]
  );
}

export async function main() {
  const config = parseArgs(process.argv.slice(2));
  const runtime = await loadBenchmarkRuntime();
  const selectedCaseConfigs =
    config.caseFilters.length > 0
      ? filterBenchmarkCases(
          getFileListToTreeBenchmarkCases(),
          config.caseFilters
        )
      : filterBenchmarkCases(
          getFileListToTreeBenchmarkCases(),
          DEFAULT_CASE_FILTERS
        );

  if (selectedCaseConfigs.length === 0) {
    throw new Error('No benchmark cases matched the provided --case filters.');
  }

  const preparedCases = selectedCaseConfigs.map((caseConfig) =>
    prepareBenchmarkCase(caseConfig, config, runtime)
  );
  const samplesByCase = preparedCases.map(() => createOperationSampleStorage());

  const runCaseOperation = (
    caseConfig: PreparedBenchmarkCase,
    operation: TreeRenderOperationName
  ) => {
    let snapshot: RenderSnapshot;

    const startTime = performance.now();
    if (operation === 'renderStaticWindow') {
      snapshot = renderBenchmarkWindow(
        caseConfig.sharedRenderInstance,
        config,
        runtime
      );
    } else {
      const fileTree = new runtime.benchmarkRuntime.FileTree(
        caseConfig.options,
        caseConfig.stateConfig
      );
      snapshot = renderBenchmarkWindow(fileTree, config, runtime);
    }
    const elapsedMs = performance.now() - startTime;

    assertDeterministicRender(caseConfig, snapshot);
    return { elapsedMs };
  };

  // Measure each operation in its own pass so repeated instance construction
  // does not bleed into the isolated render-only samples.
  for (const operation of OPERATION_ORDER) {
    for (let runIndex = 0; runIndex < config.warmupRuns; runIndex++) {
      for (
        let caseOffset = 0;
        caseOffset < preparedCases.length;
        caseOffset++
      ) {
        const caseIndex = (runIndex + caseOffset) % preparedCases.length;
        runCaseOperation(preparedCases[caseIndex], operation);
      }
    }

    for (let runIndex = 0; runIndex < config.runs; runIndex++) {
      for (
        let caseOffset = 0;
        caseOffset < preparedCases.length;
        caseOffset++
      ) {
        const caseIndex = (runIndex + caseOffset) % preparedCases.length;
        const caseConfig = preparedCases[caseIndex];
        const { elapsedMs } = runCaseOperation(caseConfig, operation);
        samplesByCase[caseIndex][operation].push(elapsedMs);
      }
    }
  }

  const caseSummaries: CaseSummary[] = preparedCases.map(
    (caseConfig, index) => ({
      name: caseConfig.name,
      source: caseConfig.source,
      fileCount: caseConfig.fileCount,
      uniqueFolderCount: caseConfig.uniqueFolderCount,
      maxDepth: caseConfig.maxDepth,
      expandedFolderCount: caseConfig.expandedFolderCount,
      windowStart: caseConfig.expectedWindowRange.start,
      windowSize:
        caseConfig.expectedWindowRange.end -
        caseConfig.expectedWindowRange.start +
        1,
      renderedItemCount: caseConfig.expectedRenderedItemCount,
      htmlLength: caseConfig.expectedHtmlLength,
      htmlChecksum: caseConfig.htmlChecksum,
      operations: {
        renderStaticWindow: summarizeSamples(
          samplesByCase[index].renderStaticWindow
        ),
        constructAndRender: summarizeSamples(
          samplesByCase[index].constructAndRender
        ),
      },
    })
  );

  const checksum = caseSummaries.reduce(
    (sum, summary) =>
      sum +
      summary.htmlChecksum +
      summary.htmlLength +
      summary.renderedItemCount,
    0
  );
  const environment = getEnvironment();
  const baseline =
    config.comparePath != null
      ? readBenchmarkBaseline(config.comparePath)
      : undefined;
  const comparison =
    baseline != null ? buildComparison(baseline, caseSummaries) : undefined;
  if (baseline != null && comparison != null) {
    assertComparableRenderBenchmarkBaseline(
      baseline,
      comparison,
      config,
      runtime.runtimeInfo
    );
  }

  const output: BenchmarkOutput = {
    benchmark: 'virtualizedFileTreeRender',
    environment,
    runtime: runtime.runtimeInfo,
    config,
    checksum,
    cases: caseSummaries,
    ...(comparison != null && { comparison }),
  };

  if (config.outputJson) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log('virtualized file tree render benchmark');
  console.log(
    `bun=${environment.bunVersion} platform=${environment.platform} arch=${environment.arch}`
  );
  console.log(
    `runtime=${runtime.runtimeInfo.codePath} nodeEnv=${runtime.runtimeInfo.nodeEnv} renderer=${runtime.runtimeInfo.renderer} harness=${runtime.runtimeInfo.renderHarness}`
  );
  console.log(`buildCommand=${runtime.runtimeInfo.buildCommand}`);
  console.log(
    `cases=${preparedCases.length} runsPerCase=${config.runs} warmupRunsPerCase=${config.warmupRuns}`
  );
  console.log(
    `windowStart=${config.windowStart} windowSize=${config.windowSize} itemHeight=${config.itemHeight} viewportHeight=${config.viewportHeight}`
  );
  if (config.caseFilters.length > 0) {
    console.log(`filters=${config.caseFilters.join(', ')}`);
  } else {
    console.log(`filters=${DEFAULT_CASE_FILTERS.join(', ')} (default)`);
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
      expanded: String(summary.expandedFolderCount),
      htmlItems: String(summary.renderedItemCount),
      htmlBytes: String(summary.htmlLength),
      renderMedianMs: formatMs(summary.operations.renderStaticWindow.medianMs),
      renderP95Ms: formatMs(summary.operations.renderStaticWindow.p95Ms),
      endToEndMedianMs: formatMs(
        summary.operations.constructAndRender.medianMs
      ),
      endToEndP95Ms: formatMs(summary.operations.constructAndRender.p95Ms),
    })),
    [
      'case',
      'source',
      'files',
      'folders',
      'depth',
      'expanded',
      'htmlItems',
      'htmlBytes',
      'renderMedianMs',
      'renderP95Ms',
      'endToEndMedianMs',
      'endToEndP95Ms',
    ]
  );

  if (comparison != null) {
    printComparison(comparison);
  }
}

if (import.meta.main) {
  await main();
}
