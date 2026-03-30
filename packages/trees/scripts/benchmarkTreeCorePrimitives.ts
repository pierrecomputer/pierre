import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createTree } from '../src/core/create-tree';
import type {
  FeatureImplementation,
  TreeConfig,
  TreeInstance,
} from '../src/core/types/core';
import { contextMenuFeature } from '../src/features/context-menu/feature';
import { gitStatusFeature } from '../src/features/git-status/feature';
import { hotkeysCoreFeature } from '../src/features/hotkeys-core/feature';
import { propMemoizationFeature } from '../src/features/prop-memoization/feature';
import { renamingFeature } from '../src/features/renaming/feature';
import { fileTreeSearchFeature } from '../src/features/search/feature';
import { selectionFeature } from '../src/features/selection/feature';
import { syncDataLoaderFeature } from '../src/features/sync-data-loader/feature';
import { generateSyncDataLoaderFromTreeData } from '../src/loader/sync';
import type { FileTreeData, FileTreeNode } from '../src/types';
import { fileListToTree } from '../src/utils/fileListToTree';
import {
  type BenchmarkEnvironment,
  calculateDeltaPercent,
  formatMs,
  formatSignedMs,
  formatSignedPercent,
  getEnvironment,
  measureAverageIterationMs,
  parseNonNegativeInteger,
  parsePositiveInteger,
  printTable,
  summarizeSamples,
  type TimingSummary,
} from './lib/benchmarkUtils';
import {
  type FileListToTreeBenchmarkCase,
  filterBenchmarkCases,
  getFileListToTreeBenchmarkCases,
} from './lib/fileListToTreeBenchmarkData';
import {
  checksumFileTreeData,
  checksumTreeItems,
} from './lib/treeBenchmarkChecksums';

type TreeCorePrimitiveName = 'createTree' | 'rebuildTree';
type FeatureProfileName = 'minimal' | 'root-default' | 'virtualized-card';
type RebuildModeName = 'unchanged' | 'expanded-copy';

interface BenchmarkConfig {
  runs: number;
  warmupRuns: number;
  outputJson: boolean;
  caseFilters: string[];
  createIterations: number;
  rebuildIterations: number;
  featureProfile: FeatureProfileName;
  rebuildMode: RebuildModeName;
  comparePath?: string;
}

interface PreparedBenchmarkCase {
  name: string;
  source: FileListToTreeBenchmarkCase['source'];
  fileCount: number;
  uniqueFolderCount: number;
  maxDepth: number;
  treeNodeCount: number;
  folderNodeCount: number;
  expandedItemCount: number;
  expandedItemIds: string[];
  treeChecksum: number;
  createConfig: TreeConfig<FileTreeNode>;
  rebuildInstance: TreeInstance<FileTreeNode>;
}

interface CaseSummary {
  name: string;
  source: FileListToTreeBenchmarkCase['source'];
  fileCount: number;
  uniqueFolderCount: number;
  maxDepth: number;
  treeNodeCount: number;
  folderNodeCount: number;
  expandedItemCount: number;
  treeChecksum: number;
  createChecksum: number;
  rebuildChecksum: number;
  operations: Record<TreeCorePrimitiveName, TimingSummary>;
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
  treeChecksumMatches: boolean;
  createChecksumMatches: boolean;
  rebuildChecksumMatches: boolean;
  operations: Record<TreeCorePrimitiveName, OperationComparisonSummary>;
}

interface BenchmarkComparison {
  baselinePath: string;
  baselineEnvironment: BenchmarkEnvironment;
  baselineConfig: BenchmarkConfig;
  unmatchedCurrentCases: string[];
  unmatchedBaselineCases: string[];
  checksumMismatches: string[];
  cases: CaseComparison[];
}

interface BenchmarkOutput {
  benchmark: 'treeCorePrimitives';
  environment: BenchmarkEnvironment;
  config: BenchmarkConfig;
  checksum: number;
  cases: CaseSummary[];
  comparison?: BenchmarkComparison;
}

interface LoadedBenchmarkBaseline {
  path: string;
  output: BenchmarkOutput;
}

const OPERATION_ORDER: TreeCorePrimitiveName[] = ['createTree', 'rebuildTree'];

const MINIMAL_FEATURE_PROFILE: FeatureImplementation[] = [
  syncDataLoaderFeature,
];
const ROOT_DEFAULT_FEATURE_PROFILE: FeatureImplementation[] = [
  syncDataLoaderFeature,
  selectionFeature,
  hotkeysCoreFeature,
  fileTreeSearchFeature,
  gitStatusFeature,
  contextMenuFeature,
  propMemoizationFeature,
];

const VIRTUALIZED_CARD_FEATURE_PROFILE: FeatureImplementation[] = [
  syncDataLoaderFeature,
  selectionFeature,
  hotkeysCoreFeature,
  fileTreeSearchFeature,
  gitStatusFeature,
  contextMenuFeature,
  renamingFeature,
  propMemoizationFeature,
];

function parseFeatureProfile(value: string): FeatureProfileName {
  if (
    value === 'minimal' ||
    value === 'root-default' ||
    value === 'virtualized-card'
  ) {
    return value;
  }

  throw new Error(
    `Invalid --feature-profile value '${value}'. Expected one of: minimal, root-default, virtualized-card.`
  );
}

function getFeaturesForProfile(
  profile: FeatureProfileName
): FeatureImplementation[] {
  if (profile === 'minimal') {
    return MINIMAL_FEATURE_PROFILE;
  }
  if (profile === 'virtualized-card') {
    return VIRTUALIZED_CARD_FEATURE_PROFILE;
  }
  return ROOT_DEFAULT_FEATURE_PROFILE;
}

function parseRebuildMode(value: string): RebuildModeName {
  if (value === 'unchanged' || value === 'expanded-copy') {
    return value;
  }

  throw new Error(
    `Invalid --rebuild-mode value '${value}'. Expected one of: unchanged, expanded-copy.`
  );
}

const DEFAULT_CONFIG: BenchmarkConfig = {
  runs: 60,
  warmupRuns: 8,
  outputJson: false,
  caseFilters: [],
  createIterations: 1,
  rebuildIterations: 8,
  featureProfile: 'virtualized-card',
  rebuildMode: 'unchanged',
};

function printHelpAndExit(): never {
  console.log('Usage: bun ws trees benchmark:core -- [options]');
  console.log('');
  console.log('Options:');
  console.log(
    '  --runs <number>               Measured runs per benchmark case (default: 60)'
  );
  console.log(
    '  --warmup-runs <number>        Warmup runs per benchmark case before measurement (default: 8)'
  );
  console.log(
    '  --create-iterations <number>  createTree + setMounted(true) + rebuildTree calls per measured sample (default: 1)'
  );
  console.log(
    '  --rebuild-iterations <number> rebuildTree calls per measured sample (default: 8)'
  );
  console.log(
    '  --rebuild-mode <name>         Rebuild mode: unchanged | expanded-copy (default: unchanged)'
  );
  console.log(
    '  --feature-profile <name>      Feature profile: minimal | root-default | virtualized-card (default: virtualized-card)'
  );
  console.log(
    '  --case <filter>               Run only cases whose name contains the filter (repeatable)'
  );
  console.log(
    '  --compare <path>              Compare against a prior --json benchmark run'
  );
  console.log(
    '  --json                        Emit machine-readable JSON output'
  );
  console.log('  -h, --help                    Show this help output');
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
      flag === '--create-iterations' ||
      flag === '--rebuild-iterations' ||
      flag === '--rebuild-mode' ||
      flag === '--feature-profile' ||
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
      } else if (flag === '--create-iterations') {
        config.createIterations = parsePositiveInteger(
          value,
          '--create-iterations'
        );
      } else if (flag === '--rebuild-iterations') {
        config.rebuildIterations = parsePositiveInteger(
          value,
          '--rebuild-iterations'
        );
      } else if (flag === '--rebuild-mode') {
        config.rebuildMode = parseRebuildMode(value);
      } else if (flag === '--feature-profile') {
        config.featureProfile = parseFeatureProfile(value);
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

function createOperationSampleStorage(): Record<
  TreeCorePrimitiveName,
  number[]
> {
  return {
    createTree: [],
    rebuildTree: [],
  };
}

function collectFolderIds(treeData: FileTreeData): {
  folderNodeCount: number;
  expandedItemIds: string[];
} {
  const expandedItemIds: string[] = [];
  let folderNodeCount = 0;

  for (const [id, node] of Object.entries(treeData)) {
    if (node.children == null) {
      continue;
    }

    folderNodeCount += 1;
    if (id !== 'root') {
      expandedItemIds.push(id);
    }
  }

  return {
    folderNodeCount,
    expandedItemIds,
  };
}

// Resolves fixture-provided expanded folder paths to item IDs in the built
// tree. Falls back to expanding all folders when no mapping is available.
function resolveExpandedItemIds(
  treeData: FileTreeData,
  fallbackExpandedItemIds: string[],
  expandedFolderPaths: string[] | undefined
): string[] {
  if (expandedFolderPaths == null) {
    return fallbackExpandedItemIds;
  }

  const pathToId = new Map<string, string>();
  for (const [id, node] of Object.entries(treeData)) {
    if (node.children != null) {
      pathToId.set(node.path, id);
    }
  }

  const resolvedIds: string[] = [];
  const seen = new Set<string>();
  for (const folderPath of expandedFolderPaths) {
    const id = pathToId.get(folderPath);
    if (id == null || id === 'root' || seen.has(id)) {
      continue;
    }
    seen.add(id);
    resolvedIds.push(id);
  }

  return resolvedIds.length > 0 ? resolvedIds : fallbackExpandedItemIds;
}

// Builds the core benchmark fixture once per case so measured runs include
// only createTree/rebuildTree work and not file-list parsing or loader setup.
function prepareBenchmarkCase(
  caseConfig: FileListToTreeBenchmarkCase,
  featureProfile: FeatureProfileName
): PreparedBenchmarkCase {
  // Match the trees-dev virtualization workload: disable sorting and use
  // flattened-directory traversal in the sync loader.
  const treeData = fileListToTree(caseConfig.files, {
    sortComparator: false,
  });
  const { folderNodeCount, expandedItemIds: allFolderItemIds } =
    collectFolderIds(treeData);
  const expandedItemIds = resolveExpandedItemIds(
    treeData,
    allFolderItemIds,
    caseConfig.expandedFolders
  );
  const createConfig: TreeConfig<FileTreeNode> = {
    rootItemId: 'root',
    dataLoader: generateSyncDataLoaderFromTreeData(treeData, {
      flattenEmptyDirectories: true,
    }),
    getItemName: (item) => item.getItemData().name,
    isItemFolder: (item) => item.getItemData().children != null,
    features: [...getFeaturesForProfile(featureProfile)],
    initialState: {
      expandedItems: expandedItemIds,
      focusedItem: null,
    },
  };

  const rebuildInstance = createTree(createConfig);
  rebuildInstance.setMounted(true);
  rebuildInstance.rebuildTree();

  return {
    name: caseConfig.name,
    source: caseConfig.source,
    fileCount: caseConfig.fileCount,
    uniqueFolderCount: caseConfig.uniqueFolderCount,
    maxDepth: caseConfig.maxDepth,
    treeNodeCount: Object.keys(treeData).length,
    folderNodeCount,
    expandedItemCount: expandedItemIds.length,
    expandedItemIds,
    treeChecksum: checksumFileTreeData(treeData),
    createConfig,
    rebuildInstance,
  };
}

// Benchmarks only stay comparable when the output payload has the same shape.
// Load and validate the previous JSON run up front so comparison failures are
// immediate instead of producing misleading deltas later on.
function readBenchmarkBaseline(comparePath: string): LoadedBenchmarkBaseline {
  const resolvedPath = resolve(process.cwd(), comparePath);
  const parsed = JSON.parse(
    readFileSync(resolvedPath, 'utf-8')
  ) as Partial<BenchmarkOutput> | null;

  if (parsed == null || parsed.benchmark !== 'treeCorePrimitives') {
    throw new Error(
      `Invalid benchmark baseline at ${resolvedPath}. Expected treeCorePrimitives JSON output.`
    );
  }

  if (!Array.isArray(parsed.cases)) {
    throw new Error(
      `Invalid benchmark baseline at ${resolvedPath}. Expected a cases array.`
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
      typeof baselineSummary.treeChecksum !== 'number' ||
      typeof baselineSummary.createChecksum !== 'number' ||
      typeof baselineSummary.rebuildChecksum !== 'number'
    ) {
      throw new Error(
        `Baseline case ${currentSummary.name} is missing checksums. Regenerate the baseline with the current benchmark script.`
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
    ) as Record<TreeCorePrimitiveName, OperationComparisonSummary>;

    return {
      name: currentSummary.name,
      treeChecksumMatches:
        baselineSummary.treeChecksum === currentSummary.treeChecksum,
      createChecksumMatches:
        baselineSummary.createChecksum === currentSummary.createChecksum,
      rebuildChecksumMatches:
        baselineSummary.rebuildChecksum === currentSummary.rebuildChecksum,
      operations: operationComparisons,
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
      .filter(
        (summary) =>
          !summary.treeChecksumMatches ||
          !summary.createChecksumMatches ||
          !summary.rebuildChecksumMatches
      )
      .map((summary) => summary.name),
    cases: caseComparisons,
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
  console.log(
    `baselineCreateIterations=${comparison.baselineConfig.createIterations} baselineRebuildIterations=${comparison.baselineConfig.rebuildIterations}`
  );
  console.log(
    `baselineFeatureProfile=${comparison.baselineConfig.featureProfile}`
  );
  console.log(`baselineRebuildMode=${comparison.baselineConfig.rebuildMode}`);

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
      createDeltaMs: formatSignedMs(
        summary.operations.createTree.medianDeltaMs
      ),
      createDeltaPct: formatSignedPercent(
        summary.operations.createTree.medianDeltaPct
      ),
      rebuildDeltaMs: formatSignedMs(
        summary.operations.rebuildTree.medianDeltaMs
      ),
      rebuildDeltaPct: formatSignedPercent(
        summary.operations.rebuildTree.medianDeltaPct
      ),
      treeChecksum: summary.treeChecksumMatches ? 'match' : 'mismatch',
      createChecksum: summary.createChecksumMatches ? 'match' : 'mismatch',
      rebuildChecksum: summary.rebuildChecksumMatches ? 'match' : 'mismatch',
    })),
    [
      'case',
      'createDeltaMs',
      'createDeltaPct',
      'rebuildDeltaMs',
      'rebuildDeltaPct',
      'treeChecksum',
      'createChecksum',
      'rebuildChecksum',
    ]
  );
}

function main() {
  const config = parseArgs(process.argv.slice(2));
  const selectedCaseConfigs = filterBenchmarkCases(
    getFileListToTreeBenchmarkCases(),
    config.caseFilters
  );

  if (selectedCaseConfigs.length === 0) {
    throw new Error('No benchmark cases matched the provided --case filters.');
  }

  const preparedCases = selectedCaseConfigs.map((caseConfig) =>
    prepareBenchmarkCase(caseConfig, config.featureProfile)
  );
  const samplesByCase = preparedCases.map(() => createOperationSampleStorage());
  const createChecksums = preparedCases.map(
    () => undefined as number | undefined
  );
  const rebuildChecksums = preparedCases.map(
    () => undefined as number | undefined
  );

  const runCaseOperation = (
    caseConfig: PreparedBenchmarkCase,
    caseIndex: number,
    operation: TreeCorePrimitiveName
  ) => {
    if (operation === 'createTree') {
      let lastCreatedTree: TreeInstance<FileTreeNode> | undefined;
      const elapsedMs = measureAverageIterationMs(
        config.createIterations,
        () => {
          const createdTree = createTree(caseConfig.createConfig);
          createdTree.setMounted(true);
          createdTree.rebuildTree();
          lastCreatedTree = createdTree;
        }
      );

      const createdTree = lastCreatedTree;
      if (createdTree == null) {
        throw new Error(`Missing createTree result for ${caseConfig.name}`);
      }

      const checksum = checksumTreeItems(createdTree);
      const existingChecksum = createChecksums[caseIndex];
      if (existingChecksum == null) {
        createChecksums[caseIndex] = checksum;
      } else if (existingChecksum !== checksum) {
        throw new Error(
          `Non-deterministic createTree checksum for benchmark case ${caseConfig.name}. Expected ${existingChecksum}, received ${checksum}.`
        );
      }

      return { elapsedMs };
    }

    const elapsedMs = measureAverageIterationMs(
      config.rebuildIterations,
      () => {
        if (config.rebuildMode === 'expanded-copy') {
          caseConfig.rebuildInstance.setConfig((previousConfig) => ({
            ...previousConfig,
            state: {
              ...(previousConfig.state ?? {}),
              expandedItems: [...caseConfig.expandedItemIds],
            },
          }));
        }

        caseConfig.rebuildInstance.rebuildTree();
      }
    );
    const checksum = checksumTreeItems(caseConfig.rebuildInstance);
    const existingChecksum = rebuildChecksums[caseIndex];
    if (existingChecksum == null) {
      rebuildChecksums[caseIndex] = checksum;
    } else if (existingChecksum !== checksum) {
      throw new Error(
        `Non-deterministic rebuildTree checksum for benchmark case ${caseConfig.name}. Expected ${existingChecksum}, received ${checksum}.`
      );
    }

    return { elapsedMs };
  };

  // Measure each primitive in its own pass so createTree allocation churn does
  // not bleed into rebuildTree samples (and vice-versa).
  for (const operation of OPERATION_ORDER) {
    for (let runIndex = 0; runIndex < config.warmupRuns; runIndex++) {
      for (
        let caseOffset = 0;
        caseOffset < preparedCases.length;
        caseOffset++
      ) {
        const caseIndex = (runIndex + caseOffset) % preparedCases.length;
        const caseConfig = preparedCases[caseIndex];
        runCaseOperation(caseConfig, caseIndex, operation);
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
        const { elapsedMs } = runCaseOperation(
          caseConfig,
          caseIndex,
          operation
        );
        samplesByCase[caseIndex][operation].push(elapsedMs);
      }
    }
  }

  const caseSummaries: CaseSummary[] = preparedCases.map(
    (caseConfig, index) => {
      const createChecksum = createChecksums[index];
      if (createChecksum == null) {
        throw new Error(`Missing createTree checksum for ${caseConfig.name}`);
      }

      const rebuildChecksum = rebuildChecksums[index];
      if (rebuildChecksum == null) {
        throw new Error(`Missing rebuildTree checksum for ${caseConfig.name}`);
      }

      return {
        name: caseConfig.name,
        source: caseConfig.source,
        fileCount: caseConfig.fileCount,
        uniqueFolderCount: caseConfig.uniqueFolderCount,
        maxDepth: caseConfig.maxDepth,
        treeNodeCount: caseConfig.treeNodeCount,
        folderNodeCount: caseConfig.folderNodeCount,
        expandedItemCount: caseConfig.expandedItemCount,
        treeChecksum: caseConfig.treeChecksum,
        createChecksum,
        rebuildChecksum,
        operations: {
          createTree: summarizeSamples(samplesByCase[index].createTree),
          rebuildTree: summarizeSamples(samplesByCase[index].rebuildTree),
        },
      };
    }
  );

  const checksum = caseSummaries.reduce(
    (sum, summary) =>
      sum +
      summary.treeChecksum +
      summary.createChecksum +
      summary.rebuildChecksum,
    0
  );
  const environment = getEnvironment();
  const comparison =
    config.comparePath != null
      ? buildComparison(
          readBenchmarkBaseline(config.comparePath),
          caseSummaries
        )
      : undefined;

  const output: BenchmarkOutput = {
    benchmark: 'treeCorePrimitives',
    environment,
    config,
    checksum,
    cases: caseSummaries,
    ...(comparison != null && { comparison }),
  };

  if (config.outputJson) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log('tree core primitives benchmark');
  console.log(
    `bun=${environment.bunVersion} platform=${environment.platform} arch=${environment.arch}`
  );
  console.log(
    `cases=${preparedCases.length} runsPerCase=${config.runs} warmupRunsPerCase=${config.warmupRuns}`
  );
  console.log(
    `createIterationsPerSample=${config.createIterations} rebuildIterationsPerSample=${config.rebuildIterations}`
  );
  console.log(`featureProfile=${config.featureProfile}`);
  console.log(`rebuildMode=${config.rebuildMode}`);
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
      nodes: String(summary.treeNodeCount),
      expanded: String(summary.expandedItemCount),
      runs: String(summary.operations.createTree.runs),
      createMedianMs: formatMs(summary.operations.createTree.medianMs),
      createP95Ms: formatMs(summary.operations.createTree.p95Ms),
      rebuildMedianMs: formatMs(summary.operations.rebuildTree.medianMs),
      rebuildP95Ms: formatMs(summary.operations.rebuildTree.p95Ms),
    })),
    [
      'case',
      'source',
      'files',
      'folders',
      'depth',
      'nodes',
      'expanded',
      'runs',
      'createMedianMs',
      'createP95Ms',
      'rebuildMedianMs',
      'rebuildP95Ms',
    ]
  );

  if (comparison != null) {
    printComparison(comparison);
  }
}

main();
