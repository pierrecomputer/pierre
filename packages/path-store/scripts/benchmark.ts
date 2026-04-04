import { getVirtualizationWorkload } from '@pierre/tree-test-data';
import { do_not_optimize } from 'mitata';
import { cpus } from 'node:os';
import { basename, resolve } from 'node:path';

import { PathStore } from '../src/index';
import type { PathStoreVisibleRow } from '../src/public-types';

const WORKLOAD_NAMES = ['linux-5x', 'linux-10x'] as const;
const PHASE_4_WIDE_DIRECTORY_WORKLOAD_NAME = 'wide-directory-5k' as const;
const PHASE_5_FLATTEN_CHAIN_WORKLOAD_NAME = 'flatten-chain-5k' as const;
const VIEWPORT_MODES = ['first', 'middle'] as const;
const VISIBLE_WINDOW_SIZES = [30, 100, 200, 500] as const;
const QUICK_VISIBLE_WINDOW_SIZES = [30, 200] as const;
const BENCHMARK_PROFILE_NAMES = ['quick', 'full'] as const;
const BENCHMARK_PRESET_NAMES = ['presorted-render'] as const;
const QUICK_WORKLOAD_NAMES = ['linux-5x'] as const;
const MUTATION_SCENARIO_KINDS = [
  'rename-leaf',
  'delete-leaf',
  'delete-subtree',
  'add-sibling',
  'move-leaf',
  'move-subtree',
  'batch-visible-renames',
  'expand-directory',
  'rename-root-file',
  'rename-root-directory',
] as const;
const QUICK_MUTATION_SCENARIO_KINDS = [
  'rename-leaf',
  'rename-root-directory',
] as const;
const VISIBLE_SCENARIO_SAMPLE_COUNT = 50;
const COLD_VISIBLE_SCENARIO_SAMPLE_COUNT = 10;
const LIST_AND_SCROLL_SCENARIO_SAMPLE_COUNT = 10;
const BUILD_SCENARIO_SAMPLE_COUNT = 20;
const PREPARE_AND_E2E_SCENARIO_SAMPLE_COUNT = 3;
const MUTATION_SCENARIO_SAMPLE_COUNT = 100;
const DESTRUCTIVE_MUTATION_SCENARIO_SAMPLE_COUNT = 10;
const MUTATION_SCENARIO_WARMUP_COUNT = 5;
const TARGET_SHORT_SCENARIO_WALL_TIME_MS = 2_000;
const MAX_DYNAMIC_SAMPLE_COUNT = 250_000;
const MUTATION_WINDOW_SIZE = 200;
const SCROLL_WINDOW_STEP = 24;
const SCROLL_WINDOW_COUNT = 10;
const PREVIEW_LIMIT = 12;
const ROOT_FILE_SEED_PATH = 'zz-benchmark-root-file.ts';
const ROOT_FILE_RENAMED_PATH = 'zz-benchmark-root-file-renamed.ts';
const PHASE_4_WIDE_DIRECTORY_FILE_COUNT = 5_000;
const HUMAN_BENCHMARK_NAME_MIN_WIDTH = 32;
const HUMAN_BENCHMARK_NAME_MAX_WIDTH = 72;
const HUMAN_PROGRESS_LABEL_WIDTH = 44;
const LOCAL_VISIBLE_PATH_SEARCH_RADIUS = MUTATION_WINDOW_SIZE * 2;
const VISIBLE_PATH_SEARCH_CHUNK_SIZE = 1_024;
const ANSI_ENABLED = process.stdout.isTTY;
const BENCHMARK_INTENT =
  'Measure absolute path-store scenario latencies by workload and operation. Build and visible-read scenarios use presorted inputs everywhere except the standalone preparePaths benchmarks. Mutation scenarios measure commit plus the immediate store-side render contract: getVisibleCount() and getVisibleSlice(start, end), either for the changed window or for a preserved offscreen viewport.';
const COMPARE_INTENT =
  'Compare two path-store benchmark JSON runs and decide whether the candidate is meaningfully better than the baseline. Acceptance is based on p50 improvement, with a bootstrap 95% confidence interval when raw samples are available.';
const COMPARE_CONFIDENCE_LEVEL = 0.95;
const COMPARE_DEFAULT_MIN_EFFECT_PCT = 3;
const COMPARE_DEFAULT_BOOTSTRAP_RESAMPLES = 1_000;
const COMPARE_MAX_SAMPLE_POOL = 1_024;

type BenchmarkWorkloadName =
  | (typeof WORKLOAD_NAMES)[number]
  | typeof PHASE_4_WIDE_DIRECTORY_WORKLOAD_NAME
  | typeof PHASE_5_FLATTEN_CHAIN_WORKLOAD_NAME;
type BenchmarkProfileName = (typeof BENCHMARK_PROFILE_NAMES)[number];
type BenchmarkPresetName = (typeof BENCHMARK_PRESET_NAMES)[number];
type ViewportMode = (typeof VIEWPORT_MODES)[number];
type ScenarioCategory =
  | 'prepare'
  | 'build'
  | 'visible'
  | 'visible-cold'
  | 'scroll'
  | 'list'
  | 'e2e'
  | 'mutation';
type MutationScenarioKind = (typeof MUTATION_SCENARIO_KINDS)[number];
type MutationReadIntent = 'render-changed-window' | 'preserve-viewport';
type MutationProgressPhase = 'warmup' | 'sample';

interface BenchmarkCliOptions {
  bootstrapResamples: number;
  compare?:
    | {
        baselinePath: string;
        candidatePath: string;
      }
    | undefined;
  filter?: RegExp;
  includeSamples: boolean;
  json: boolean;
  minEffectPct: number;
  preset?: BenchmarkPresetName;
  profile: BenchmarkProfileName;
}

interface BenchmarkWorkload {
  fileCount: number;
  fileCountLabel: string;
  getPreparedFiles: () => readonly string[];
  getPreparedInput: () => import('../src/public-types').PathStorePreparedInput;
  getPresortedFiles: () => readonly string[];
  label: string;
  name: BenchmarkWorkloadName;
  rawFiles: readonly string[];
  rootCount: number;
  rootDirectoryPaths: readonly string[];
}

interface WindowBounds {
  end: number;
  start: number;
}

interface VisibleWindowRead {
  rows: readonly PathStoreVisibleRow[];
  visibleCount: number;
}

interface MutationReadPlan {
  bounds: WindowBounds;
  intent: MutationReadIntent;
  renderTargetPath?: string;
  windowShifted: boolean;
}

interface ScenarioProgress {
  completed: number;
  phase: MutationProgressPhase;
  total?: number;
}

interface ScenarioManifest {
  afterPreview?: readonly string[];
  baselineWindowEnd?: number;
  baselineWindowStart?: number;
  beforePreview?: readonly string[];
  category: ScenarioCategory;
  destinationPath?: string;
  fileCount: number;
  name: string;
  notes?: readonly string[];
  preparationTimeMs?: number;
  postMutationReadIntent?: MutationReadIntent;
  preview?: readonly string[];
  renderTargetPath?: string;
  targetPath?: string;
  targetVisible?: boolean;
  viewport?: ViewportMode;
  visibleCount?: number;
  windowEnd?: number;
  windowShifted?: boolean;
  windowSize?: number;
  windowStart?: number;
  workload: BenchmarkWorkloadName;
}

interface BenchmarkScenario {
  manifest: ScenarioManifest;
  measure: (
    progressReporter?: ((progress: ScenarioProgress) => void) | undefined
  ) => Promise<MeasuredRunStats>;
  name: string;
}

interface BenchmarkScenarioFactory {
  build: () => BenchmarkScenario;
  name: string;
}

interface MitataRunStats {
  avg: number;
  max: number;
  min: number;
  p50: number;
  p95?: number;
  p75: number;
  p99: number;
  samples?: readonly number[];
  ticks: number;
}

interface MitataBenchmarkResult {
  alias: string;
  runs: Array<{
    stats: MitataRunStats;
    wallTimeMs?: number;
  }>;
}

interface MeasuredRunStats extends MitataRunStats {
  p95: number;
  samples: readonly number[];
}

interface MitataJsonResult {
  benchmarks: MitataBenchmarkResult[];
  context?: {
    arch?: string | null;
    cpu?: {
      freq?: number;
      name?: string | null;
    };
    runtime?: string | null;
    version?: string | null;
  };
  layout?: unknown;
}

interface BenchmarkRunOutput {
  derivedSummaries?: DerivedBenchmarkSummaryOutput[];
  generatedAt: string;
  intent: string;
  kind: 'path-store-benchmark-run';
  preparationTimeMs: number;
  profile: BenchmarkProfileName;
  results: MitataJsonResult;
  scenarios: ScenarioManifest[];
}

interface BenchmarkCompareScenario {
  accepted: boolean;
  baseline: {
    p50: number;
    p95?: number;
    samples: number;
    wallTimeMs?: number;
  };
  candidate: {
    p50: number;
    p95?: number;
    samples: number;
    wallTimeMs?: number;
  };
  category?: ScenarioCategory;
  ci95HighPct?: number;
  ci95LowPct?: number;
  classification: 'improved' | 'regressed' | 'inconclusive';
  confidenceAvailable: boolean;
  name: string;
  notes?: readonly string[];
  p50ImprovementPct: number;
  p95ImprovementPct?: number;
  statisticallySignificant: boolean;
  workload?: BenchmarkWorkloadName;
}

interface BenchmarkCompareOutput {
  baselineFile: string;
  baselinePath: string;
  bootstrapResamples: number;
  candidateFile: string;
  candidatePath: string;
  comparedScenarios: BenchmarkCompareScenario[];
  confidenceLevel: number;
  generatedAt: string;
  intent: string;
  kind: 'path-store-benchmark-compare';
  minEffectPct: number;
  summary: {
    accepted: number;
    compared: number;
    improved: number;
    inconclusive: number;
    regressed: number;
  };
}

interface HumanBenchmarkRun {
  derivedSummaries: DerivedBenchmarkSummary[];
  results: MitataJsonResult;
}

interface ScenarioMeasurementResult {
  name: string;
  preparationTimeMs: number;
  stats: MeasuredRunStats;
  wallTimeMs: number;
}

interface DerivedBenchmarkSummary {
  components: readonly string[];
  name: string;
  preparationTimeMs: number;
  stats: MeasuredRunStats;
  wallTimeMs: number;
}

interface DerivedBenchmarkSummaryOutput {
  components: readonly string[];
  name: string;
  preparationTimeMs: number;
  sampleStrategy: 'min-component-samples';
  stats: MitataRunStats;
  wallTimeMs: number;
}

interface BenchmarkProfile {
  includeBuild: boolean;
  includeEndToEnd: boolean;
  includePrepare: boolean;
  mutationScenarioKinds: readonly MutationScenarioKind[];
  name: BenchmarkProfileName;
  visibleWindowSizes: readonly number[];
  workloadNames: readonly BenchmarkWorkloadName[];
}

const ANSI = {
  bold: ANSI_ENABLED ? '\u001B[1m' : '',
  cyan: ANSI_ENABLED ? '\u001B[36m' : '',
  dim: ANSI_ENABLED ? '\u001B[2m' : '',
  green: ANSI_ENABLED ? '\u001B[32m' : '',
  reset: ANSI_ENABLED ? '\u001B[0m' : '',
};

function styleText(text: string, ...styles: readonly string[]): string {
  if (!ANSI_ENABLED || styles.length === 0) {
    return text;
  }

  return `${styles.join('')}${text}${ANSI.reset}`;
}

function getPresetFilter(preset: BenchmarkPresetName): RegExp {
  switch (preset) {
    case 'presorted-render':
      return /^(prepare-presorted-input\/linux-5x|build\/linux-5x|visible-first\/linux-5x\/30)$/;
  }
}

function parseArgs(argv: readonly string[]): BenchmarkCliOptions {
  let bootstrapResamples = COMPARE_DEFAULT_BOOTSTRAP_RESAMPLES;
  let compare:
    | {
        baselinePath: string;
        candidatePath: string;
      }
    | undefined;
  let filter: RegExp | undefined;
  let includeSamples = false;
  let json = false;
  let minEffectPct = COMPARE_DEFAULT_MIN_EFFECT_PCT;
  let preset: BenchmarkPresetName | undefined;
  let profile: BenchmarkProfileName = 'quick';

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];

    if (argument === '--full') {
      profile = 'full';
      continue;
    }

    if (argument === '--json') {
      json = true;
      continue;
    }

    if (argument === '--samples') {
      includeSamples = true;
      continue;
    }

    if (argument === '--compare') {
      const baselinePath = argv[index + 1];
      const candidatePath = argv[index + 2];
      if (
        baselinePath == null ||
        baselinePath.length === 0 ||
        candidatePath == null ||
        candidatePath.length === 0
      ) {
        throw new Error(
          'Expected <baseline.json> <candidate.json> after --compare'
        );
      }

      compare = {
        baselinePath: resolve(baselinePath),
        candidatePath: resolve(candidatePath),
      };
      index += 2;
      continue;
    }

    if (argument === '--min-effect-pct') {
      const value = argv[index + 1];
      if (value == null || value.length === 0) {
        throw new Error('Expected a value after --min-effect-pct');
      }

      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error(
          `Invalid --min-effect-pct value: ${value}. Expected a non-negative number.`
        );
      }

      minEffectPct = parsed;
      index++;
      continue;
    }

    if (argument === '--bootstrap-resamples') {
      const value = argv[index + 1];
      if (value == null || value.length === 0) {
        throw new Error('Expected a value after --bootstrap-resamples');
      }

      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(
          `Invalid --bootstrap-resamples value: ${value}. Expected a positive integer.`
        );
      }

      bootstrapResamples = parsed;
      index++;
      continue;
    }

    if (argument === '--profile') {
      const value = argv[index + 1];
      if (value == null || value.length === 0) {
        throw new Error('Expected a value after --profile');
      }

      if (!(BENCHMARK_PROFILE_NAMES as readonly string[]).includes(value)) {
        throw new Error(
          `Unknown benchmark profile: ${value}. Expected one of: ${BENCHMARK_PROFILE_NAMES.join(', ')}`
        );
      }

      profile = value as BenchmarkProfileName;
      index++;
      continue;
    }

    if (argument === '--preset') {
      const value = argv[index + 1];
      if (value == null || value.length === 0) {
        throw new Error('Expected a value after --preset');
      }

      if (!(BENCHMARK_PRESET_NAMES as readonly string[]).includes(value)) {
        throw new Error(
          `Unknown benchmark preset: ${value}. Expected one of: ${BENCHMARK_PRESET_NAMES.join(', ')}`
        );
      }

      preset = value as BenchmarkPresetName;
      filter = getPresetFilter(preset);
      index++;
      continue;
    }

    if (argument === '--filter') {
      const value = argv[index + 1];
      if (value == null || value.length === 0) {
        throw new Error('Expected a value after --filter');
      }

      filter = new RegExp(value);
      index++;
      continue;
    }

    if (argument === '--help') {
      console.log('Usage: bun ws path-store benchmark -- [options]');
      console.log('');
      console.log('Options:');
      console.log(
        '  --profile <name>  Scenario profile: quick (default) or full'
      );
      console.log('  --full            Shortcut for --profile full');
      console.log(
        `  --preset <name>   Apply a named scenario filter preset (${BENCHMARK_PRESET_NAMES.join(', ')})`
      );
      console.log(
        '  --filter <regex>   Run only scenarios whose names match the regex'
      );
      console.log(
        '  --json             Emit a JSON wrapper with scenario metadata'
      );
      console.log(
        '  --samples          Include raw timing samples in JSON output'
      );
      console.log(
        '  --compare <baseline.json> <candidate.json>  Compare two JSON runs'
      );
      console.log(
        `  --min-effect-pct <n>  Minimum required p50 improvement for acceptance (default ${COMPARE_DEFAULT_MIN_EFFECT_PCT})`
      );
      console.log(
        `  --bootstrap-resamples <n>  Bootstrap resample count for compare mode (default ${COMPARE_DEFAULT_BOOTSTRAP_RESAMPLES})`
      );
      process.exit(0);
    }

    throw new Error(`Unknown benchmark argument: ${argument}`);
  }

  return {
    bootstrapResamples,
    compare,
    filter,
    includeSamples,
    json,
    minEffectPct,
    preset,
    profile,
  };
}

const BENCHMARK_PROFILES: Record<BenchmarkProfileName, BenchmarkProfile> = {
  full: {
    includeBuild: true,
    includeEndToEnd: true,
    includePrepare: true,
    mutationScenarioKinds: MUTATION_SCENARIO_KINDS,
    name: 'full',
    visibleWindowSizes: VISIBLE_WINDOW_SIZES,
    workloadNames: WORKLOAD_NAMES,
  },
  quick: {
    includeBuild: true,
    includeEndToEnd: false,
    includePrepare: false,
    mutationScenarioKinds: QUICK_MUTATION_SCENARIO_KINDS,
    name: 'quick',
    visibleWindowSizes: QUICK_VISIBLE_WINDOW_SIZES,
    workloadNames: QUICK_WORKLOAD_NAMES,
  },
};

// Targeted filter runs should be able to reach any scenario even when the
// default profile intentionally stays small for fast feedback loops.
function resolveProfile(cliOptions: BenchmarkCliOptions): BenchmarkProfile {
  if (cliOptions.filter != null) {
    return BENCHMARK_PROFILES.full;
  }

  return BENCHMARK_PROFILES[cliOptions.profile];
}

// Builds the same expanded tree shape the virtualized file tree will read from
// so the benchmark scenarios match the intended production workload.
function createExpandedStore(
  workload: BenchmarkWorkload,
  seededPaths: readonly string[] = []
): PathStore {
  const store = new PathStore({
    flattenEmptyDirectories: true,
    initialExpansion: 'open',
    preparedInput: workload.getPreparedInput(),
  });

  for (const path of seededPaths) {
    store.add(path);
  }

  return store;
}

// Converts a logical viewport mode into the exact visible range the benchmark
// will read back after building or mutating the store.
function getWindowBounds(
  store: PathStore,
  viewport: ViewportMode,
  windowSize: number
): WindowBounds {
  const visibleCount = store.getVisibleCount();
  if (visibleCount === 0) {
    return { end: -1, start: 0 };
  }

  if (viewport === 'first') {
    return {
      end: Math.min(visibleCount - 1, windowSize - 1),
      start: 0,
    };
  }

  const maxStart = Math.max(0, visibleCount - windowSize);
  const middleStart = Math.floor(visibleCount / 2) - Math.floor(windowSize / 2);
  const start = Math.max(0, Math.min(maxStart, middleStart));

  return {
    end: Math.min(visibleCount - 1, start + windowSize - 1),
    start,
  };
}

function getWindowBoundsAtStart(
  visibleCount: number,
  start: number,
  windowSize: number
): WindowBounds {
  if (visibleCount <= 0) {
    return { end: -1, start: 0 };
  }

  const clampedStart = Math.max(0, Math.min(start, visibleCount - 1));
  return {
    end: Math.min(visibleCount - 1, clampedStart + windowSize - 1),
    start: clampedStart,
  };
}

function getSequentialScrollBounds(
  store: PathStore,
  viewport: ViewportMode,
  windowSize: number
): readonly WindowBounds[] {
  const visibleCount = store.getVisibleCount();
  if (visibleCount <= 0) {
    return [{ end: -1, start: 0 }];
  }

  const initialBounds = getWindowBounds(store, viewport, windowSize);
  const bounds: WindowBounds[] = [initialBounds];

  for (let index = 1; index < SCROLL_WINDOW_COUNT; index++) {
    const nextStart = Math.min(
      Math.max(0, visibleCount - windowSize),
      initialBounds.start + index * SCROLL_WINDOW_STEP
    );
    bounds.push(getWindowBoundsAtStart(visibleCount, nextStart, windowSize));
  }

  return bounds;
}

function getWindowRows(
  store: PathStore,
  bounds: WindowBounds
): readonly PathStoreVisibleRow[] {
  if (bounds.end < bounds.start) {
    return [];
  }

  return store.getVisibleSlice(bounds.start, bounds.end);
}

function readVisibleWindow(
  store: PathStore,
  bounds: WindowBounds
): VisibleWindowRead {
  const visibleCount = store.getVisibleCount();
  return {
    rows:
      bounds.end < bounds.start
        ? []
        : store.getVisibleSlice(bounds.start, bounds.end),
    visibleCount,
  };
}

// Keeps a changed-window read as close as possible to the original viewport
// while still forcing the changed row back into the rendered slice.
function getWindowBoundsContainingIndex(
  visibleCount: number,
  index: number,
  windowSize: number,
  preferredStart: number
): WindowBounds {
  if (visibleCount === 0) {
    return { end: -1, start: 0 };
  }

  const maxStart = Math.max(0, visibleCount - windowSize);
  const minStart = Math.max(0, index - windowSize + 1);
  const maxAllowedStart = Math.min(index, maxStart);
  const start = Math.max(minStart, Math.min(maxAllowedStart, preferredStart));

  return {
    end: Math.min(visibleCount - 1, start + windowSize - 1),
    start,
  };
}

function findVisiblePathInBounds(
  store: PathStore,
  bounds: WindowBounds,
  targetPaths: readonly string[]
): { index: number; path: string } | null {
  if (targetPaths.length === 0) {
    return null;
  }

  const targetPathSet = new Set(targetPaths);
  const rows = getWindowRows(store, bounds);

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    if (row != null && targetPathSet.has(row.path)) {
      return {
        index: bounds.start + rowIndex,
        path: row.path,
      };
    }
  }

  return null;
}

// Most changed-window mutations stay near the current viewport, so search there
// first and only fall back to chunked scans if the mutation moved farther away.
function findVisiblePathNearBounds(
  store: PathStore,
  baselineBounds: WindowBounds,
  targetPaths: readonly string[]
): { index: number; path: string } | null {
  const visibleCount = store.getVisibleCount();
  if (visibleCount === 0 || targetPaths.length === 0) {
    return null;
  }

  const localBounds = {
    end: Math.min(
      visibleCount - 1,
      baselineBounds.end + LOCAL_VISIBLE_PATH_SEARCH_RADIUS
    ),
    start: Math.max(0, baselineBounds.start - LOCAL_VISIBLE_PATH_SEARCH_RADIUS),
  };
  const localMatch = findVisiblePathInBounds(store, localBounds, targetPaths);
  if (localMatch != null) {
    return localMatch;
  }

  for (
    let start = 0;
    start < visibleCount;
    start += VISIBLE_PATH_SEARCH_CHUNK_SIZE
  ) {
    const chunkBounds = {
      end: Math.min(
        visibleCount - 1,
        start + VISIBLE_PATH_SEARCH_CHUNK_SIZE - 1
      ),
      start,
    };
    const match = findVisiblePathInBounds(store, chunkBounds, targetPaths);
    if (match != null) {
      return match;
    }
  }

  return null;
}

function createPreservedViewportReadPlan(
  baselineBounds: WindowBounds
): MutationReadPlan {
  return {
    bounds: baselineBounds,
    intent: 'preserve-viewport',
    windowShifted: false,
  };
}

// Mutation scenarios need an explicit read model after the write commits:
// either keep the current viewport, or shift just enough to render the change.
function createRenderChangedWindowPlan(
  store: PathStore,
  baselineBounds: WindowBounds,
  windowSize: number,
  targetPaths: readonly string[]
): MutationReadPlan {
  if (targetPaths.length === 0) {
    return {
      bounds: baselineBounds,
      intent: 'render-changed-window',
      windowShifted: false,
    };
  }

  const preferredMatch = findVisiblePathInBounds(
    store,
    baselineBounds,
    targetPaths
  );
  if (preferredMatch != null) {
    return {
      bounds: baselineBounds,
      intent: 'render-changed-window',
      renderTargetPath: preferredMatch.path,
      windowShifted: false,
    };
  }

  const match = findVisiblePathNearBounds(store, baselineBounds, targetPaths);
  if (match == null) {
    throw new Error(
      `Could not find a visible render target for paths: ${targetPaths.join(', ')}`
    );
  }

  const bounds = getWindowBoundsContainingIndex(
    store.getVisibleCount(),
    match.index,
    windowSize,
    baselineBounds.start
  );

  return {
    bounds,
    intent: 'render-changed-window',
    renderTargetPath: match.path,
    windowShifted:
      bounds.start !== baselineBounds.start ||
      bounds.end !== baselineBounds.end,
  };
}

function getPreview(rows: readonly PathStoreVisibleRow[]): string[] {
  return rows.slice(0, PREVIEW_LIMIT).map((row) => row.path);
}

function hasVisiblePath(
  rows: readonly PathStoreVisibleRow[],
  targetPath: string
): boolean {
  return rows.some((row) => row.path === targetPath);
}

function requireVisibleFile(
  rows: readonly PathStoreVisibleRow[],
  scenarioName: string
): PathStoreVisibleRow {
  const row = rows.find((candidate) => candidate.kind === 'file');
  if (row == null) {
    throw new Error(`No visible file available for ${scenarioName}`);
  }

  return row;
}

function requireVisibleDirectoryWithChildren(
  rows: readonly PathStoreVisibleRow[],
  scenarioName: string
): PathStoreVisibleRow {
  const row = rows.find(
    (candidate) =>
      candidate.kind === 'directory' && candidate.hasChildren === true
  );
  if (row == null) {
    throw new Error(
      `No expandable visible directory available for ${scenarioName}`
    );
  }

  return row;
}

function requireVisibleDirectoryWithRoom(
  rows: readonly PathStoreVisibleRow[],
  scenarioName: string,
  minimumTrailingRows = 8
): PathStoreVisibleRow {
  const lastEligibleIndex = Math.max(0, rows.length - minimumTrailingRows - 1);
  for (
    let rowIndex = 0;
    rowIndex < rows.length && rowIndex <= lastEligibleIndex;
    rowIndex++
  ) {
    const row = rows[rowIndex];
    if (row != null && row.kind === 'directory' && row.hasChildren === true) {
      return row;
    }
  }

  return requireVisibleDirectoryWithChildren(rows, scenarioName);
}

function requireVisibleMoveDestinationDirectory(
  rows: readonly PathStoreVisibleRow[],
  sourcePath: string,
  scenarioName: string
): PathStoreVisibleRow {
  const sourceParentPath = splitPath(sourcePath).parentPath;

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    if (
      row != null &&
      row.kind === 'directory' &&
      row.path !== sourceParentPath
    ) {
      return row;
    }
  }

  throw new Error(
    `No visible destination directory available for ${scenarioName}`
  );
}

function requireRootDirectory(
  store: PathStore,
  scenarioName: string
): PathStoreVisibleRow {
  const rows = getWindowRows(store, {
    end: Math.min(store.getVisibleCount() - 1, 64),
    start: 0,
  });
  const row = rows.find(
    (candidate) => candidate.depth === 0 && candidate.kind === 'directory'
  );

  if (row == null) {
    throw new Error(`No root directory available for ${scenarioName}`);
  }

  return row;
}

function requireSecondRootDirectoryPath(
  workload: BenchmarkWorkload,
  excludedPath: string,
  scenarioName: string
): string {
  const path = workload.rootDirectoryPaths.find(
    (candidate) => candidate !== excludedPath
  );

  if (path == null) {
    throw new Error(`No second root directory available for ${scenarioName}`);
  }

  return path;
}

function getVisibleFiles(
  rows: readonly PathStoreVisibleRow[]
): readonly PathStoreVisibleRow[] {
  return rows.filter((row) => row.kind === 'file');
}

function splitPath(path: string): {
  isDirectory: boolean;
  name: string;
  parentPath: string;
} {
  const isDirectory = path.endsWith('/');
  const normalizedPath = isDirectory ? path.slice(0, -1) : path;
  const lastSlashIndex = normalizedPath.lastIndexOf('/');

  return {
    isDirectory,
    name:
      lastSlashIndex === -1
        ? normalizedPath
        : normalizedPath.slice(lastSlashIndex + 1),
    parentPath:
      lastSlashIndex === -1 ? '' : normalizedPath.slice(0, lastSlashIndex + 1),
  };
}

function renamePathWithSuffix(path: string, suffix: string): string {
  const { isDirectory, name, parentPath } = splitPath(path);

  if (isDirectory) {
    return `${parentPath}${name}-${suffix}/`;
  }

  const extensionIndex = name.lastIndexOf('.');
  if (extensionIndex > 0) {
    return `${parentPath}${name.slice(0, extensionIndex)}-${suffix}${name.slice(extensionIndex)}`;
  }

  return `${parentPath}${name}-${suffix}`;
}

function createSiblingPath(path: string, suffix: string): string {
  return renamePathWithSuffix(path, suffix);
}

function getMovedPathIntoDirectory(
  path: string,
  destinationDirectoryPath: string
): string {
  const { isDirectory, name } = splitPath(path);
  return `${destinationDirectoryPath}${name}${isDirectory ? '/' : ''}`;
}

function formatDuration(ns: number): string {
  if (ns >= 1_000_000_000) {
    return `${(ns / 1_000_000_000).toFixed(2)} s`;
  }

  if (ns >= 1_000_000) {
    return `${(ns / 1_000_000).toFixed(2)} ms`;
  }

  if (ns >= 1_000) {
    return `${(ns / 1_000).toFixed(2)} us`;
  }

  return `${ns.toFixed(2)} ns`;
}

function formatCount(value: number): string {
  return value.toLocaleString();
}

function getHumanBenchmarkFactoryNameWidth(
  scenarioFactories: readonly BenchmarkScenarioFactory[]
): number {
  let maxWidth = HUMAN_BENCHMARK_NAME_MIN_WIDTH;

  for (let index = 0; index < scenarioFactories.length; index++) {
    const factory = scenarioFactories[index];
    if (factory == null) {
      continue;
    }

    const prefix = `[${index + 1}/${scenarioFactories.length}] `;
    maxWidth = Math.max(maxWidth, prefix.length + factory.name.length);
  }

  return Math.min(HUMAN_BENCHMARK_NAME_MAX_WIDTH, maxWidth);
}

function getHumanBenchmarkNameWidth(names: readonly string[]): number {
  let maxWidth = HUMAN_BENCHMARK_NAME_MIN_WIDTH;

  for (const name of names) {
    maxWidth = Math.max(maxWidth, name.length);
  }

  return Math.min(HUMAN_BENCHMARK_NAME_MAX_WIDTH, maxWidth);
}

function padBenchmarkLabel(label: string, width: number): string {
  if (label.length <= width) {
    return label.padEnd(width);
  }

  if (width <= 3) {
    return label.slice(0, width);
  }

  return `${label.slice(0, width - 3)}...`;
}

function formatHumanDurationCell(duration: number, width = 10): string {
  return formatDuration(duration).padStart(width);
}

function formatHumanSamplesCell(ticks: number): string {
  return formatCount(ticks).padStart(10);
}

function formatHumanWallTimeCell(durationMs: number): string {
  return formatDuration(durationMs * 1_000_000).padStart(10);
}

function printHumanBenchmarkHeader(
  context: NonNullable<MitataJsonResult['context']>,
  scenarioCount: number,
  nameWidth: number
): void {
  if (context.cpu?.freq != null) {
    console.log(
      `${styleText('clk:', ANSI.dim)} ~${context.cpu.freq.toFixed(2)} GHz`
    );
  }
  if (context.cpu?.name != null) {
    console.log(`${styleText('cpu:', ANSI.dim)} ${context.cpu.name}`);
  }
  console.log(
    `${styleText('runtime:', ANSI.dim)} ${context.runtime}${context.version == null ? '' : ` ${context.version}`} (${context.arch})`
  );
  console.log(
    `${styleText('scenarios:', ANSI.dim)} ${formatCount(scenarioCount)}`
  );
  console.log('');

  console.log(
    styleText(
      `${'benchmark'.padEnd(nameWidth)} ${'p50'.padStart(10)} ${'p95'.padStart(10)} ${'min'.padStart(10)} ${'max'.padStart(10)} ${'prep'.padStart(10)} ${'wall'.padStart(10)} ${'samples'.padStart(10)}`,
      ANSI.bold
    )
  );
  console.log(styleText('-'.repeat(nameWidth + 83), ANSI.dim));
}

function printHumanBenchmarkBootBanner(
  cliOptions: BenchmarkCliOptions,
  profile: BenchmarkProfile
): void {
  console.log(styleText('path-store benchmark', ANSI.bold, ANSI.cyan));
  console.log(`${styleText('profile:', ANSI.dim)} ${profile.name}`);
  if (cliOptions.preset != null) {
    console.log(`${styleText('preset:', ANSI.dim)} ${cliOptions.preset}`);
  }
  console.log(
    `${styleText('workloads:', ANSI.dim)} ${profile.workloadNames.join(', ')}`
  );
  console.log(
    `${styleText('filter:', ANSI.dim)} ${cliOptions.filter?.source ?? 'none'}`
  );
  console.log(
    `${styleText('base samples:', ANSI.dim)} build=${formatCount(BUILD_SCENARIO_SAMPLE_COUNT)}, prepare/e2e=${formatCount(PREPARE_AND_E2E_SCENARIO_SAMPLE_COUNT)}, visible=${formatCount(VISIBLE_SCENARIO_SAMPLE_COUNT)}, visible-cold=${formatCount(COLD_VISIBLE_SCENARIO_SAMPLE_COUNT)}, list/scroll=${formatCount(LIST_AND_SCROLL_SCENARIO_SAMPLE_COUNT)}, mutation=${formatCount(MUTATION_SCENARIO_SAMPLE_COUNT)} (+ ${formatCount(MUTATION_SCENARIO_WARMUP_COUNT)} warmup, reused store where possible; delete-subtree=${formatCount(DESTRUCTIVE_MUTATION_SCENARIO_SAMPLE_COUNT)} fresh-store samples)`
  );
  console.log(
    `${styleText('short runs:', ANSI.dim)} scenarios under ${formatDuration(TARGET_SHORT_SCENARIO_WALL_TIME_MS * 1_000_000)} wall time scale sample counts upward toward that target`
  );
  console.log(
    `${styleText('input mode:', ANSI.dim)} presorted for all scenarios except prepare/*`
  );
  console.log(
    `${styleText('boot:', ANSI.dim)} loading workloads and preparing scenarios...`
  );
  console.log('');
}

function getHumanCompareNameWidth(
  comparedScenarios: readonly BenchmarkCompareScenario[]
): number {
  let maxWidth = HUMAN_BENCHMARK_NAME_MIN_WIDTH;

  for (let index = 0; index < comparedScenarios.length; index++) {
    const scenario = comparedScenarios[index];
    if (scenario == null) {
      continue;
    }

    maxWidth = Math.max(maxWidth, scenario.name.length);
  }

  return Math.min(HUMAN_BENCHMARK_NAME_MAX_WIDTH, maxWidth);
}

function formatPercentCell(value: number, width = 10): string {
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${value.toFixed(2)}%`.padStart(width);
}

function formatConfidenceCell(
  lowPct: number | undefined,
  highPct: number | undefined,
  width = 24
): string {
  if (lowPct == null || highPct == null) {
    return 'n/a'.padStart(width);
  }

  return `[${lowPct.toFixed(2)}%, ${highPct.toFixed(2)}%]`.padStart(width);
}

function formatComparisonStatus(
  comparedScenario: BenchmarkCompareScenario
): string {
  const acceptedLabel = 'accept'.padStart(8);
  const improveLabel = 'improve'.padStart(8);
  const regressLabel = 'regress'.padStart(8);
  const unclearLabel = 'unclear'.padStart(8);

  if (comparedScenario.accepted) {
    return styleText(acceptedLabel, ANSI.green, ANSI.bold);
  }

  switch (comparedScenario.classification) {
    case 'improved':
      return styleText(improveLabel, ANSI.green);
    case 'regressed':
      return regressLabel;
    case 'inconclusive':
      return styleText(unclearLabel, ANSI.dim);
  }
}

function printHumanBenchmarkCompareHeader(
  compareOutput: BenchmarkCompareOutput,
  filterSource: string
): void {
  const nameWidth = getHumanCompareNameWidth(compareOutput.comparedScenarios);

  console.log(styleText('path-store benchmark compare', ANSI.bold, ANSI.cyan));
  console.log(
    `${styleText('baseline:', ANSI.dim)} ${compareOutput.baselineFile}`
  );
  console.log(
    `${styleText('candidate:', ANSI.dim)} ${compareOutput.candidateFile}`
  );
  console.log(`${styleText('filter:', ANSI.dim)} ${filterSource}`);
  console.log(
    `${styleText('acceptance:', ANSI.dim)} candidate p50 must improve by at least ${compareOutput.minEffectPct.toFixed(2)}%`
  );
  console.log(
    `${styleText('confidence:', ANSI.dim)} ${compareOutput.confidenceLevel * 100}% bootstrap CI over median improvement (${formatCount(compareOutput.bootstrapResamples)} resamples when raw samples are available)`
  );
  console.log('');
  console.log(
    styleText(
      `${'benchmark'.padEnd(nameWidth)} ${'base p50'.padStart(10)} ${'cand p50'.padStart(10)} ${'delta'.padStart(10)} ${'ci95'.padStart(24)} ${'p95'.padStart(10)} ${'status'.padStart(8)}`,
      ANSI.bold
    )
  );
  console.log(styleText('-'.repeat(nameWidth + 78), ANSI.dim));
}

function printHumanBenchmarkCompareRow(
  comparedScenario: BenchmarkCompareScenario,
  nameWidth: number
): void {
  console.log(
    [
      padBenchmarkLabel(comparedScenario.name, nameWidth),
      formatHumanDurationCell(comparedScenario.baseline.p50),
      formatHumanDurationCell(comparedScenario.candidate.p50),
      formatPercentCell(comparedScenario.p50ImprovementPct),
      formatConfidenceCell(
        comparedScenario.ci95LowPct,
        comparedScenario.ci95HighPct
      ),
      comparedScenario.p95ImprovementPct == null
        ? 'n/a'.padStart(10)
        : formatPercentCell(comparedScenario.p95ImprovementPct),
      formatComparisonStatus(comparedScenario),
    ].join(' ')
  );
}

function printHumanBenchmarkCompareSummary(
  compareOutput: BenchmarkCompareOutput,
  filterSource: string
): void {
  const nameWidth = getHumanCompareNameWidth(compareOutput.comparedScenarios);

  printHumanBenchmarkCompareHeader(compareOutput, filterSource);

  for (let index = 0; index < compareOutput.comparedScenarios.length; index++) {
    const scenario = compareOutput.comparedScenarios[index];
    if (scenario == null) {
      continue;
    }

    printHumanBenchmarkCompareRow(scenario, nameWidth);
  }

  console.log('');
  console.log(
    `${styleText('summary:', ANSI.dim)} compared=${formatCount(compareOutput.summary.compared)}, accepted=${formatCount(compareOutput.summary.accepted)}, improved=${formatCount(compareOutput.summary.improved)}, regressed=${formatCount(compareOutput.summary.regressed)}, inconclusive=${formatCount(compareOutput.summary.inconclusive)}`
  );
}

function printHumanBenchmarkRow(
  label: string,
  stats: MeasuredRunStats,
  preparationTimeMs: number,
  wallTimeMs: number,
  nameWidth: number
): void {
  const row = [
    styleText(padBenchmarkLabel(label, nameWidth), ANSI.bold),
    styleText(formatHumanDurationCell(stats.p50), ANSI.green),
    styleText(formatHumanDurationCell(stats.p95), ANSI.dim),
    styleText(formatHumanDurationCell(stats.min), ANSI.dim),
    styleText(formatHumanDurationCell(stats.max), ANSI.dim),
    styleText(formatHumanWallTimeCell(preparationTimeMs), ANSI.dim),
    formatHumanWallTimeCell(wallTimeMs),
    styleText(formatHumanSamplesCell(stats.ticks), ANSI.dim),
  ].join(' ');

  console.log(row);
}

function printHumanDerivedBenchmarkSummaries(
  summaries: readonly DerivedBenchmarkSummary[],
  nameWidth: number
): void {
  if (summaries.length === 0) {
    return;
  }

  console.log('');
  console.log(styleText('derived summaries', ANSI.bold, ANSI.cyan));
  console.log(
    `${styleText('note:', ANSI.dim)} sums independently measured component scenarios; samples shows the minimum component sample count.`
  );
  console.log(
    styleText(
      `${'benchmark'.padEnd(nameWidth)} ${'p50'.padStart(10)} ${'p95'.padStart(10)} ${'min'.padStart(10)} ${'max'.padStart(10)} ${'prep'.padStart(10)} ${'wall'.padStart(10)} ${'samples'.padStart(10)}`,
      ANSI.bold
    )
  );
  console.log(styleText('-'.repeat(nameWidth + 83), ANSI.dim));

  for (const summary of summaries) {
    printHumanBenchmarkRow(
      summary.name,
      summary.stats,
      summary.preparationTimeMs,
      summary.wallTimeMs,
      nameWidth
    );
  }
}

function printHumanMeasurementProgress(
  index: number,
  total: number,
  scenarioName: string
): void {
  console.log(
    `${styleText('› run', ANSI.dim)} [${index}/${total}] ${scenarioName}`
  );
}

function clearHumanLiveLine(): void {
  if (!process.stdout.isTTY) {
    return;
  }

  process.stdout.clearLine?.(0);
  process.stdout.cursorTo?.(0);
}

function createHumanLiveMeasurementProgress(
  index: number,
  total: number,
  scenarioName: string
): {
  stop: () => void;
  update: (progress: ScenarioProgress) => void;
} {
  if (!process.stdout.isTTY) {
    printHumanMeasurementProgress(index, total, scenarioName);
    return {
      stop() {},
      update() {},
    };
  }

  let latestProgress: ScenarioProgress | undefined;

  const render = (): void => {
    const prefix = `${styleText('› run', ANSI.dim)} [${index}/${total}] ${padBenchmarkLabel(
      scenarioName,
      HUMAN_PROGRESS_LABEL_WIDTH
    )}`;
    const progressLabel =
      latestProgress == null
        ? 'sampling'
        : latestProgress.total == null
          ? `${latestProgress.phase} ${latestProgress.completed}`
          : `${latestProgress.phase} ${latestProgress.completed}/${latestProgress.total}`;

    clearHumanLiveLine();
    process.stdout.write(`${prefix} ${styleText(progressLabel, ANSI.dim)}`);
  };

  render();

  return {
    stop() {
      clearHumanLiveLine();
    },
    update(progress) {
      latestProgress = progress;
      render();
    },
  };
}

function getScenarioSampleCount(category: ScenarioCategory): number {
  switch (category) {
    case 'visible':
      return VISIBLE_SCENARIO_SAMPLE_COUNT;
    case 'visible-cold':
      return COLD_VISIBLE_SCENARIO_SAMPLE_COUNT;
    case 'scroll':
    case 'list':
      return LIST_AND_SCROLL_SCENARIO_SAMPLE_COUNT;
    case 'mutation':
      return MUTATION_SCENARIO_SAMPLE_COUNT;
    case 'build':
      return BUILD_SCENARIO_SAMPLE_COUNT;
    case 'prepare':
    case 'e2e':
      return PREPARE_AND_E2E_SCENARIO_SAMPLE_COUNT;
  }
}

function getBenchmarkContext(): NonNullable<MitataJsonResult['context']> {
  return {
    arch: `${process.arch}-${process.platform}`,
    cpu: {
      name: cpus()[0]?.model ?? null,
    },
    runtime: 'bun',
    version: Bun.version,
  };
}

function sanitizeMeasuredRunStats(stats: MeasuredRunStats): MitataRunStats {
  return {
    avg: stats.avg,
    max: stats.max,
    min: stats.min,
    p50: stats.p50,
    p95: stats.p95,
    p75: stats.p75,
    p99: stats.p99,
    ticks: stats.ticks,
  };
}

function createBenchmarkResult(
  alias: string,
  stats: MeasuredRunStats,
  wallTimeMs: number,
  includeSamples: boolean
): MitataBenchmarkResult {
  const sanitizedStats = sanitizeMeasuredRunStats(stats);
  if (includeSamples) {
    sanitizedStats.samples = stats.samples;
  }

  return {
    alias,
    runs: [
      {
        stats: sanitizedStats,
        wallTimeMs,
      },
    ],
  };
}

function parseVisibleFirstScenarioName(
  name: string
): { windowSize: number; workload: BenchmarkWorkloadName } | null {
  const match = /^visible-first\/([^/]+)\/(\d+)$/.exec(name);
  if (match == null) {
    return null;
  }

  const workload = match[1] as BenchmarkWorkloadName;
  const windowSize = Number(match[2]);
  if (!Number.isInteger(windowSize) || windowSize <= 0) {
    return null;
  }

  return { windowSize, workload };
}

function sumMeasuredRunStats(
  componentStats: readonly MeasuredRunStats[]
): MeasuredRunStats {
  return {
    avg: componentStats.reduce((total, stats) => total + stats.avg, 0),
    max: componentStats.reduce((total, stats) => total + stats.max, 0),
    min: componentStats.reduce((total, stats) => total + stats.min, 0),
    p50: componentStats.reduce((total, stats) => total + stats.p50, 0),
    p75: componentStats.reduce((total, stats) => total + stats.p75, 0),
    p95: componentStats.reduce((total, stats) => total + stats.p95, 0),
    p99: componentStats.reduce((total, stats) => total + stats.p99, 0),
    samples: [],
    ticks: componentStats.reduce(
      (minimum, stats) => Math.min(minimum, stats.ticks),
      Number.MAX_SAFE_INTEGER
    ),
  };
}

function createDerivedBenchmarkSummaries(
  results: readonly ScenarioMeasurementResult[]
): DerivedBenchmarkSummary[] {
  const resultByName = new Map(results.map((result) => [result.name, result]));
  const summaries: DerivedBenchmarkSummary[] = [];

  for (const result of results) {
    const visibleFirst = parseVisibleFirstScenarioName(result.name);
    if (visibleFirst == null) {
      continue;
    }

    const buildResult = resultByName.get(`build/${visibleFirst.workload}`);
    if (buildResult == null) {
      continue;
    }

    const preparePresortedResult = resultByName.get(
      `prepare-presorted-input/${visibleFirst.workload}`
    );
    if (preparePresortedResult != null) {
      summaries.push({
        components: [
          preparePresortedResult.name,
          buildResult.name,
          result.name,
        ],
        name: `equivalent-presorted-first-render/${visibleFirst.workload}/${visibleFirst.windowSize}`,
        preparationTimeMs:
          preparePresortedResult.preparationTimeMs +
          buildResult.preparationTimeMs +
          result.preparationTimeMs,
        stats: sumMeasuredRunStats([
          preparePresortedResult.stats,
          buildResult.stats,
          result.stats,
        ]),
        wallTimeMs:
          preparePresortedResult.wallTimeMs +
          buildResult.wallTimeMs +
          result.wallTimeMs,
      });
    } else {
      summaries.push({
        components: [buildResult.name, result.name],
        name: `equivalent-presorted-warm-first-render/${visibleFirst.workload}/${visibleFirst.windowSize}`,
        preparationTimeMs:
          buildResult.preparationTimeMs + result.preparationTimeMs,
        stats: sumMeasuredRunStats([buildResult.stats, result.stats]),
        wallTimeMs: buildResult.wallTimeMs + result.wallTimeMs,
      });
    }

    const prepareResult = resultByName.get(`prepare/${visibleFirst.workload}`);
    if (prepareResult != null) {
      summaries.push({
        components: [prepareResult.name, buildResult.name, result.name],
        name: `equivalent-raw-unsorted-first-render/${visibleFirst.workload}/${visibleFirst.windowSize}`,
        preparationTimeMs:
          prepareResult.preparationTimeMs +
          buildResult.preparationTimeMs +
          result.preparationTimeMs,
        stats: sumMeasuredRunStats([
          prepareResult.stats,
          buildResult.stats,
          result.stats,
        ]),
        wallTimeMs:
          prepareResult.wallTimeMs + buildResult.wallTimeMs + result.wallTimeMs,
      });
    }
  }

  return summaries;
}

async function runBenchmarksForJson(
  scenarioFactories: readonly BenchmarkScenarioFactory[],
  includeSamples: boolean
): Promise<{
  derivedSummaries: DerivedBenchmarkSummaryOutput[];
  preparationTimeMs: number;
  results: MitataJsonResult;
  scenarios: ScenarioManifest[];
}> {
  const benchmarks: MitataJsonResult['benchmarks'] = [];
  const manifests: ScenarioManifest[] = [];
  const results: ScenarioMeasurementResult[] = [];
  let preparationTimeMs = 0;

  for (let index = 0; index < scenarioFactories.length; index++) {
    const factory = scenarioFactories[index];
    if (factory == null) {
      continue;
    }

    const scenarioPreparationStartedAt = performance.now();
    const scenario = factory.build();
    const scenarioPreparationTimeMs =
      performance.now() - scenarioPreparationStartedAt;
    preparationTimeMs += scenarioPreparationTimeMs;
    scenario.manifest.preparationTimeMs = scenarioPreparationTimeMs;
    manifests.push(scenario.manifest);

    const wallTimeStart = performance.now();
    const stats = await scenario.measure();
    const wallTimeMs = performance.now() - wallTimeStart;
    results.push({
      name: scenario.name,
      preparationTimeMs: scenarioPreparationTimeMs,
      stats,
      wallTimeMs,
    });

    benchmarks.push(
      createBenchmarkResult(scenario.name, stats, wallTimeMs, includeSamples)
    );

    maybeCollectGarbage();
  }

  return {
    derivedSummaries: createDerivedBenchmarkSummaries(results).map(
      (summary) => ({
        components: summary.components,
        name: summary.name,
        preparationTimeMs: summary.preparationTimeMs,
        sampleStrategy: 'min-component-samples',
        stats: sanitizeMeasuredRunStats(summary.stats),
        wallTimeMs: summary.wallTimeMs,
      })
    ),
    preparationTimeMs,
    results: {
      benchmarks,
      context: getBenchmarkContext(),
      layout: [{ name: null, types: [] }],
    },
    scenarios: manifests,
  };
}

function getPercentile(
  sortedSamples: readonly number[],
  percentile: number
): number {
  const lastIndex = sortedSamples.length - 1;
  if (lastIndex < 0) {
    return 0;
  }

  const sampleIndex = Math.min(
    lastIndex,
    Math.max(0, Math.round(lastIndex * percentile))
  );
  return sortedSamples[sampleIndex] ?? 0;
}

function summarizeSamples(samples: readonly number[]): MeasuredRunStats {
  const sortedSamples = [...samples].sort((left, right) => left - right);
  let total = 0;

  for (let index = 0; index < sortedSamples.length; index++) {
    total += sortedSamples[index] ?? 0;
  }

  return {
    avg: total / sortedSamples.length,
    max: sortedSamples[sortedSamples.length - 1] ?? 0,
    min: sortedSamples[0] ?? 0,
    p50: getPercentile(sortedSamples, 0.5),
    p95: getPercentile(sortedSamples, 0.95),
    p75: getPercentile(sortedSamples, 0.75),
    p99: getPercentile(sortedSamples, 0.99),
    samples: sortedSamples,
    ticks: sortedSamples.length,
  };
}

function computeImprovementPct(
  baselineNs: number,
  candidateNs: number
): number {
  if (baselineNs <= 0) {
    return 0;
  }

  return ((baselineNs - candidateNs) / baselineNs) * 100;
}

function hashStringSeed(text: string): number {
  let hash = 2_166_136_261;

  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }

  return hash >>> 0;
}

function createDeterministicRandom(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state += 0x6d2b79f5;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

// Compare mode only needs the overall sample distribution shape, so it uses a
// stratified subset when runs captured very large sample arrays.
function getCompareSamplePool(samples: readonly number[]): number[] {
  const sortedSamples = [...samples].sort((left, right) => left - right);
  if (sortedSamples.length <= COMPARE_MAX_SAMPLE_POOL) {
    return sortedSamples;
  }

  const pool: number[] = [];
  const lastIndex = sortedSamples.length - 1;

  for (let index = 0; index < COMPARE_MAX_SAMPLE_POOL; index++) {
    const sampleIndex = Math.round(
      (index / (COMPARE_MAX_SAMPLE_POOL - 1)) * lastIndex
    );
    const sample = sortedSamples[sampleIndex];
    if (sample == null) {
      continue;
    }

    pool.push(sample);
  }

  return pool;
}

function getMedianFromSortedSamples(samples: readonly number[]): number {
  return getPercentile(samples, 0.5);
}

function createBootstrapMedianSample(
  sourceSamples: readonly number[],
  random: () => number
): number {
  const resampled = new Array<number>(sourceSamples.length);

  for (let index = 0; index < sourceSamples.length; index++) {
    const sampledIndex = Math.floor(random() * sourceSamples.length);
    resampled[index] = sourceSamples[sampledIndex] ?? 0;
  }

  resampled.sort((left, right) => left - right);
  return getMedianFromSortedSamples(resampled);
}

function getBootstrapMedianImprovementCI(
  scenarioName: string,
  baselineSamples: readonly number[],
  candidateSamples: readonly number[],
  bootstrapResamples: number
):
  | {
      ci95HighPct: number;
      ci95LowPct: number;
      notes?: readonly string[];
    }
  | undefined {
  if (baselineSamples.length < 2 || candidateSamples.length < 2) {
    return undefined;
  }

  const baselinePool = getCompareSamplePool(baselineSamples);
  const candidatePool = getCompareSamplePool(candidateSamples);
  const random = createDeterministicRandom(hashStringSeed(scenarioName));
  const improvementSamples: number[] = [];

  for (let index = 0; index < bootstrapResamples; index++) {
    const baselineMedian = createBootstrapMedianSample(baselinePool, random);
    const candidateMedian = createBootstrapMedianSample(candidatePool, random);
    improvementSamples.push(
      computeImprovementPct(baselineMedian, candidateMedian)
    );
  }

  improvementSamples.sort((left, right) => left - right);

  const notes: string[] = [];
  if (
    baselinePool.length !== baselineSamples.length ||
    candidatePool.length !== candidateSamples.length
  ) {
    notes.push(
      `Bootstrap confidence uses stratified ${formatCount(Math.max(baselinePool.length, candidatePool.length))}-sample pools from larger raw sample arrays.`
    );
  }

  return {
    ci95HighPct: getPercentile(
      improvementSamples,
      1 - (1 - COMPARE_CONFIDENCE_LEVEL) / 2
    ),
    ci95LowPct: getPercentile(
      improvementSamples,
      (1 - COMPARE_CONFIDENCE_LEVEL) / 2
    ),
    notes: notes.length === 0 ? undefined : notes,
  };
}

function getComparisonClassification(
  p50ImprovementPct: number,
  ci95LowPct: number | undefined,
  ci95HighPct: number | undefined
): 'improved' | 'regressed' | 'inconclusive' {
  if (ci95LowPct != null && ci95HighPct != null) {
    if (ci95LowPct > 0) {
      return 'improved';
    }

    if (ci95HighPct < 0) {
      return 'regressed';
    }

    return 'inconclusive';
  }

  if (p50ImprovementPct > 0) {
    return 'improved';
  }

  if (p50ImprovementPct < 0) {
    return 'regressed';
  }

  return 'inconclusive';
}

function getComparisonAcceptance(
  p50ImprovementPct: number,
  ci95LowPct: number | undefined,
  minEffectPct: number
): boolean {
  if (ci95LowPct != null) {
    return ci95LowPct >= minEffectPct;
  }

  return p50ImprovementPct >= minEffectPct;
}

function getComparisonSignificance(
  ci95LowPct: number | undefined,
  ci95HighPct: number | undefined
): boolean {
  if (ci95LowPct == null || ci95HighPct == null) {
    return false;
  }

  return ci95LowPct > 0 || ci95HighPct < 0;
}

function getScenarioManifestByName(
  runOutput: BenchmarkRunOutput
): Map<string, ScenarioManifest> {
  return new Map(
    runOutput.scenarios.map((scenario) => [scenario.name, scenario])
  );
}

function createCompareScenario(
  name: string,
  baselineRun: MitataBenchmarkResult['runs'][number],
  candidateRun: MitataBenchmarkResult['runs'][number],
  baselineManifest: ScenarioManifest | undefined,
  candidateManifest: ScenarioManifest | undefined,
  options: Pick<BenchmarkCliOptions, 'bootstrapResamples' | 'minEffectPct'>
): BenchmarkCompareScenario {
  const baselineStats = baselineRun.stats;
  const candidateStats = candidateRun.stats;
  const p50ImprovementPct = computeImprovementPct(
    baselineStats.p50,
    candidateStats.p50
  );
  const p95ImprovementPct =
    baselineStats.p95 != null && candidateStats.p95 != null
      ? computeImprovementPct(baselineStats.p95, candidateStats.p95)
      : undefined;

  const bootstrapCI = getBootstrapMedianImprovementCI(
    name,
    baselineStats.samples ?? [],
    candidateStats.samples ?? [],
    options.bootstrapResamples
  );

  const notes: string[] = [];
  if (bootstrapCI?.notes != null) {
    notes.push(...bootstrapCI.notes);
  }

  if (baselineStats.samples == null || candidateStats.samples == null) {
    notes.push(
      'Raw samples are unavailable, so confidence intervals are omitted. Re-run benchmarks with --json --samples for confidence-aware comparisons.'
    );
  }

  const ci95LowPct = bootstrapCI?.ci95LowPct;
  const ci95HighPct = bootstrapCI?.ci95HighPct;

  return {
    accepted: getComparisonAcceptance(
      p50ImprovementPct,
      ci95LowPct,
      options.minEffectPct
    ),
    baseline: {
      p50: baselineStats.p50,
      p95: baselineStats.p95,
      samples: baselineStats.ticks,
      wallTimeMs: baselineRun.wallTimeMs,
    },
    candidate: {
      p50: candidateStats.p50,
      p95: candidateStats.p95,
      samples: candidateStats.ticks,
      wallTimeMs: candidateRun.wallTimeMs,
    },
    category: candidateManifest?.category ?? baselineManifest?.category,
    ci95HighPct,
    ci95LowPct,
    classification: getComparisonClassification(
      p50ImprovementPct,
      ci95LowPct,
      ci95HighPct
    ),
    confidenceAvailable: ci95LowPct != null && ci95HighPct != null,
    name,
    notes: notes.length === 0 ? undefined : notes,
    p50ImprovementPct,
    p95ImprovementPct,
    statisticallySignificant: getComparisonSignificance(
      ci95LowPct,
      ci95HighPct
    ),
    workload: candidateManifest?.workload ?? baselineManifest?.workload,
  };
}

// Compare mode reads two prior benchmark runs, matches scenarios by name, and
// reports a simple accept/reject signal that an optimization loop can consume.
async function createBenchmarkCompareOutput(
  baselinePath: string,
  candidatePath: string,
  options: Pick<
    BenchmarkCliOptions,
    'bootstrapResamples' | 'filter' | 'minEffectPct'
  >
): Promise<BenchmarkCompareOutput> {
  const baselineOutput = (await Bun.file(
    baselinePath
  ).json()) as BenchmarkRunOutput;
  const candidateOutput = (await Bun.file(
    candidatePath
  ).json()) as BenchmarkRunOutput;

  if (baselineOutput.kind !== 'path-store-benchmark-run') {
    throw new Error(
      `Expected a path-store benchmark run in ${baselinePath}, got ${String(baselineOutput.kind)}`
    );
  }

  if (candidateOutput.kind !== 'path-store-benchmark-run') {
    throw new Error(
      `Expected a path-store benchmark run in ${candidatePath}, got ${String(candidateOutput.kind)}`
    );
  }

  const baselineBenchmarks = new Map(
    baselineOutput.results.benchmarks.map((benchmark) => [
      benchmark.alias,
      benchmark,
    ])
  );
  const candidateBenchmarks = new Map(
    candidateOutput.results.benchmarks.map((benchmark) => [
      benchmark.alias,
      benchmark,
    ])
  );
  const baselineManifests = getScenarioManifestByName(baselineOutput);
  const candidateManifests = getScenarioManifestByName(candidateOutput);

  const scenarioNames = [...baselineBenchmarks.keys()]
    .filter((name) => candidateBenchmarks.has(name))
    .filter((name) =>
      options.filter == null ? true : options.filter.test(name)
    )
    .sort((left, right) => left.localeCompare(right));

  if (scenarioNames.length === 0) {
    throw new Error(
      'No shared benchmark scenarios matched the provided filter.'
    );
  }

  const comparedScenarios = scenarioNames.map((name) => {
    const baselineBenchmark = baselineBenchmarks.get(name);
    const candidateBenchmark = candidateBenchmarks.get(name);
    const baselineRun = baselineBenchmark?.runs[0];
    const candidateRun = candidateBenchmark?.runs[0];

    if (baselineRun == null || candidateRun == null) {
      throw new Error(`Missing benchmark run data for scenario ${name}`);
    }

    return createCompareScenario(
      name,
      baselineRun,
      candidateRun,
      baselineManifests.get(name),
      candidateManifests.get(name),
      options
    );
  });

  return {
    baselineFile: basename(baselinePath),
    baselinePath,
    bootstrapResamples: options.bootstrapResamples,
    candidateFile: basename(candidatePath),
    candidatePath,
    comparedScenarios,
    confidenceLevel: COMPARE_CONFIDENCE_LEVEL,
    generatedAt: new Date().toISOString(),
    intent: COMPARE_INTENT,
    kind: 'path-store-benchmark-compare',
    minEffectPct: options.minEffectPct,
    summary: {
      accepted: comparedScenarios.filter((scenario) => scenario.accepted)
        .length,
      compared: comparedScenarios.length,
      improved: comparedScenarios.filter(
        (scenario) => scenario.classification === 'improved'
      ).length,
      inconclusive: comparedScenarios.filter(
        (scenario) => scenario.classification === 'inconclusive'
      ).length,
      regressed: comparedScenarios.filter(
        (scenario) => scenario.classification === 'regressed'
      ).length,
    },
  };
}

interface FreshSampleMeasurement<TSample> {
  createSample: () => TSample;
  destroySample?: (sample: TSample) => void;
  runSample: (sample: TSample) => unknown;
}

interface ReusedStoreMutationMeasurement {
  apply: (store: PathStore) => unknown;
  createStore: () => PathStore;
  reset: (store: PathStore) => void;
}

type BenchmarkListenerType = '*' | 'batch' | 'move' | 'add';

function maybeCollectGarbage(): void {
  const runtime = Bun as unknown as {
    gc?: (force?: boolean) => void;
  };
  runtime.gc?.(true);
}

function attachBenchmarkListener(
  store: PathStore,
  type: BenchmarkListenerType
): void {
  let eventCount = 0;
  let visibleCountDeltaTotal = 0;

  store.on(type, (event) => {
    eventCount++;
    visibleCountDeltaTotal += event.visibleCountDelta ?? 0;
    do_not_optimize(event.operation);
    do_not_optimize(eventCount);
    do_not_optimize(visibleCountDeltaTotal);
  });
}

function createProgressEmitter(
  progressReporter?: ((progress: ScenarioProgress) => void) | undefined
): {
  report: (progress: ScenarioProgress) => void;
} {
  let lastReportAt = 0;

  return {
    report(progress) {
      if (progressReporter == null) {
        return;
      }

      const now = performance.now();
      const shouldReport =
        progress.completed === 0 ||
        progress.completed === progress.total ||
        now - lastReportAt >= 50;

      if (!shouldReport) {
        return;
      }

      lastReportAt = now;
      progressReporter(progress);
    },
  };
}

function measureFunctionSamples(
  bench: () => unknown,
  sampleCount: number,
  options: {
    innerGc?: boolean;
    warmupCount?: number;
  } = {},
  progressReporter?: ((progress: ScenarioProgress) => void) | undefined
): MeasuredRunStats {
  const progress = createProgressEmitter(progressReporter);
  const warmupCount = options.warmupCount ?? 0;

  if (warmupCount > 0) {
    progress.report({
      completed: 0,
      phase: 'warmup',
      total: warmupCount,
    });

    for (let warmupIndex = 0; warmupIndex < warmupCount; warmupIndex++) {
      do_not_optimize(bench());
      progress.report({
        completed: warmupIndex + 1,
        phase: 'warmup',
        total: warmupCount,
      });

      if (options.innerGc === true) {
        maybeCollectGarbage();
      }
    }
  }

  if (options.innerGc === true) {
    maybeCollectGarbage();
  }

  progress.report({
    completed: 0,
    phase: 'sample',
    total: sampleCount,
  });

  const timings: number[] = [];
  const measurementStartedAt = performance.now();
  let sampleIndex = 0;

  while (sampleIndex < MAX_DYNAMIC_SAMPLE_COUNT) {
    const startTime = process.hrtime.bigint();
    const result = bench();
    const endTime = process.hrtime.bigint();

    do_not_optimize(result);
    timings.push(Number(endTime - startTime));
    sampleIndex++;

    const elapsedMs = performance.now() - measurementStartedAt;
    const reachedMinimum = sampleIndex >= sampleCount;

    progress.report({
      completed: sampleIndex,
      phase: 'sample',
      total: reachedMinimum ? undefined : sampleCount,
    });

    if (options.innerGc === true) {
      maybeCollectGarbage();
    }

    if (reachedMinimum && elapsedMs >= TARGET_SHORT_SCENARIO_WALL_TIME_MS) {
      break;
    }
  }

  return summarizeSamples(timings);
}

function measureFreshSampleBench<TSample>(
  measurement: FreshSampleMeasurement<TSample>,
  sampleCount: number,
  options: {
    innerGc?: boolean;
    warmupCount?: number;
  } = {},
  progressReporter?: ((progress: ScenarioProgress) => void) | undefined
): MeasuredRunStats {
  const progress = createProgressEmitter(progressReporter);
  const warmupCount = options.warmupCount ?? 0;

  if (warmupCount > 0) {
    progress.report({
      completed: 0,
      phase: 'warmup',
      total: warmupCount,
    });

    for (let warmupIndex = 0; warmupIndex < warmupCount; warmupIndex++) {
      const sample = measurement.createSample();

      try {
        do_not_optimize(measurement.runSample(sample));
      } finally {
        measurement.destroySample?.(sample);
      }

      progress.report({
        completed: warmupIndex + 1,
        phase: 'warmup',
        total: warmupCount,
      });

      if (options.innerGc === true) {
        maybeCollectGarbage();
      }
    }
  }

  if (options.innerGc === true) {
    maybeCollectGarbage();
  }

  progress.report({
    completed: 0,
    phase: 'sample',
    total: sampleCount,
  });

  const timings: number[] = [];
  const measurementStartedAt = performance.now();
  let sampleIndex = 0;

  while (sampleIndex < MAX_DYNAMIC_SAMPLE_COUNT) {
    const sample = measurement.createSample();

    try {
      const startTime = process.hrtime.bigint();
      const result = measurement.runSample(sample);
      const endTime = process.hrtime.bigint();

      do_not_optimize(result);
      timings.push(Number(endTime - startTime));
    } finally {
      measurement.destroySample?.(sample);
    }
    sampleIndex++;

    const elapsedMs = performance.now() - measurementStartedAt;
    const reachedMinimum = sampleIndex >= sampleCount;

    progress.report({
      completed: sampleIndex,
      phase: 'sample',
      total: reachedMinimum ? undefined : sampleCount,
    });

    if (options.innerGc === true) {
      maybeCollectGarbage();
    }

    if (reachedMinimum && elapsedMs >= TARGET_SHORT_SCENARIO_WALL_TIME_MS) {
      break;
    }
  }

  return summarizeSamples(timings);
}

// Interactive edits happen against one long-lived store, so mutation timings
// should reuse that store and only reset state between timed iterations.
function measureMutationWithReusedStore(
  measurement: ReusedStoreMutationMeasurement,
  progressReporter?: ((progress: ScenarioProgress) => void) | undefined
): MeasuredRunStats {
  const store = measurement.createStore();
  const timings: number[] = [];
  const progress = createProgressEmitter(progressReporter);

  progress.report({
    completed: 0,
    phase: 'warmup',
    total: MUTATION_SCENARIO_WARMUP_COUNT,
  });

  for (
    let warmupIndex = 0;
    warmupIndex < MUTATION_SCENARIO_WARMUP_COUNT;
    warmupIndex++
  ) {
    const result = measurement.apply(store);

    do_not_optimize(result);
    measurement.reset(store);
    progress.report({
      completed: warmupIndex + 1,
      phase: 'warmup',
      total: MUTATION_SCENARIO_WARMUP_COUNT,
    });
  }

  progress.report({
    completed: 0,
    phase: 'sample',
    total: MUTATION_SCENARIO_SAMPLE_COUNT,
  });

  const measurementStartedAt = performance.now();
  let sampleIndex = 0;

  while (sampleIndex < MAX_DYNAMIC_SAMPLE_COUNT) {
    const startTime = process.hrtime.bigint();
    const result = measurement.apply(store);
    const endTime = process.hrtime.bigint();

    do_not_optimize(result);
    measurement.reset(store);
    timings.push(Number(endTime - startTime));
    sampleIndex++;

    const elapsedMs = performance.now() - measurementStartedAt;
    const reachedMinimum = sampleIndex >= MUTATION_SCENARIO_SAMPLE_COUNT;

    progress.report({
      completed: sampleIndex,
      phase: 'sample',
      total: reachedMinimum ? undefined : MUTATION_SCENARIO_SAMPLE_COUNT,
    });

    if (reachedMinimum && elapsedMs >= TARGET_SHORT_SCENARIO_WALL_TIME_MS) {
      break;
    }
  }

  return summarizeSamples(timings);
}

async function runBenchmarksForHuman(
  scenarioFactories: readonly BenchmarkScenarioFactory[]
): Promise<HumanBenchmarkRun & { preparationTimeMs: number }> {
  const context = getBenchmarkContext();
  const nameWidth = getHumanBenchmarkFactoryNameWidth(scenarioFactories);

  printHumanBenchmarkHeader(context, scenarioFactories.length, nameWidth);

  const results: ScenarioMeasurementResult[] = [];
  let preparationTimeMs = 0;

  for (let index = 0; index < scenarioFactories.length; index++) {
    const factory = scenarioFactories[index];
    if (factory == null) {
      continue;
    }

    const scenarioPreparationStartedAt = performance.now();
    const scenario = factory.build();
    const scenarioPreparationTimeMs =
      performance.now() - scenarioPreparationStartedAt;
    preparationTimeMs += scenarioPreparationTimeMs;
    scenario.manifest.preparationTimeMs = scenarioPreparationTimeMs;

    const progress = createHumanLiveMeasurementProgress(
      index + 1,
      scenarioFactories.length,
      scenario.name
    );
    const wallTimeStart = performance.now();

    try {
      const stats = await scenario.measure((update) => {
        progress.update(update);
      });
      const wallTimeMs = performance.now() - wallTimeStart;

      progress.stop();
      const result = {
        name: scenario.name,
        preparationTimeMs: scenarioPreparationTimeMs,
        stats,
        wallTimeMs,
      };
      results.push(result);
      printHumanBenchmarkRow(
        `[${index + 1}/${scenarioFactories.length}] ${result.name}`,
        result.stats,
        result.preparationTimeMs,
        result.wallTimeMs,
        nameWidth
      );
      maybeCollectGarbage();
    } catch (error) {
      progress.stop();
      throw error;
    }
  }

  return {
    derivedSummaries: createDerivedBenchmarkSummaries(results),
    preparationTimeMs,
    results: {
      benchmarks: results.map((result) =>
        createBenchmarkResult(
          result.name,
          result.stats,
          result.wallTimeMs,
          false
        )
      ),
      context,
      layout: [{ name: null, types: [] }],
    },
  };
}

function loadWorkload(workloadName: BenchmarkWorkloadName): BenchmarkWorkload {
  if (workloadName === PHASE_4_WIDE_DIRECTORY_WORKLOAD_NAME) {
    return createWideDirectoryWorkload();
  }

  if (workloadName === PHASE_5_FLATTEN_CHAIN_WORKLOAD_NAME) {
    return createFlattenChainWorkload();
  }

  const workload = getVirtualizationWorkload(workloadName);
  let preparedFiles: readonly string[] | undefined;
  let preparedInput:
    | import('../src/public-types').PathStorePreparedInput
    | undefined;

  return {
    fileCount: workload.files.length,
    fileCountLabel: workload.fileCountLabel,
    getPreparedFiles() {
      preparedFiles ??= workload.presortedFiles;
      return preparedFiles;
    },
    getPreparedInput() {
      preparedInput ??= PathStore.preparePresortedInput(
        workload.presortedFiles
      );
      return preparedInput;
    },
    getPresortedFiles() {
      return workload.presortedFiles;
    },
    label: workload.label,
    name: workloadName,
    rawFiles: workload.files,
    rootCount: workload.rootCount,
    rootDirectoryPaths: getRootDirectoryPaths(workload.files),
  };
}

function createWideDirectoryWorkload(): BenchmarkWorkload {
  const rawFiles = Array.from(
    { length: PHASE_4_WIDE_DIRECTORY_FILE_COUNT },
    (_, index) => `wide/item${index + 1}.ts`
  );
  let preparedFiles: readonly string[] | undefined;
  let preparedInput:
    | import('../src/public-types').PathStorePreparedInput
    | undefined;

  return {
    fileCount: rawFiles.length,
    fileCountLabel: `${rawFiles.length.toLocaleString()} files in one wide directory`,
    getPreparedFiles() {
      preparedFiles ??= PathStore.preparePaths(rawFiles);
      return preparedFiles;
    },
    getPreparedInput() {
      preparedInput ??= PathStore.prepareInput(rawFiles);
      return preparedInput;
    },
    getPresortedFiles() {
      preparedFiles ??= PathStore.preparePaths(rawFiles);
      return preparedFiles;
    },
    label: 'Synthetic wide directory fixture',
    name: PHASE_4_WIDE_DIRECTORY_WORKLOAD_NAME,
    rawFiles,
    rootCount: 1,
    rootDirectoryPaths: ['wide/'],
  };
}

function createFlattenChainWorkload(): BenchmarkWorkload {
  const bucketCount = 50;
  const chainsPerBucket = 100;
  const rawFiles = Array.from(
    { length: bucketCount * chainsPerBucket },
    (_, index) => {
      const bucketIndex = Math.floor(index / chainsPerBucket) + 1;
      const chainIndex = (index % chainsPerBucket) + 1;
      const bucketName = `bucket-${String(bucketIndex).padStart(2, '0')}`;
      const chainName = `chain-${String(chainIndex).padStart(3, '0')}`;
      return `${bucketName}/${chainName}/one/two/three/four/file.ts`;
    }
  );
  let preparedFiles: readonly string[] | undefined;
  let preparedInput:
    | import('../src/public-types').PathStorePreparedInput
    | undefined;

  return {
    fileCount: rawFiles.length,
    fileCountLabel: `${rawFiles.length.toLocaleString()} files in repeated flattenable chains`,
    getPreparedFiles() {
      preparedFiles ??= PathStore.preparePaths(rawFiles);
      return preparedFiles;
    },
    getPreparedInput() {
      preparedInput ??= PathStore.prepareInput(rawFiles);
      return preparedInput;
    },
    getPresortedFiles() {
      preparedFiles ??= PathStore.preparePaths(rawFiles);
      return preparedFiles;
    },
    label: 'Synthetic flatten-heavy fixture',
    name: PHASE_5_FLATTEN_CHAIN_WORKLOAD_NAME,
    rawFiles,
    rootCount: bucketCount,
    rootDirectoryPaths: getRootDirectoryPaths(rawFiles),
  };
}

// Large root-level scenarios need canonical root paths even when the first
// visible window only covers the first expanded root subtree.
function getRootDirectoryPaths(paths: readonly string[]): readonly string[] {
  const rootDirectories: string[] = [];
  const seen = new Set<string>();

  for (const path of paths) {
    const slashIndex = path.indexOf('/');
    if (slashIndex === -1) {
      continue;
    }

    const rootDirectoryPath = path.slice(0, slashIndex + 1);
    if (seen.has(rootDirectoryPath)) {
      continue;
    }

    seen.add(rootDirectoryPath);
    rootDirectories.push(rootDirectoryPath);
  }

  return rootDirectories;
}

function createPrepareScenarioFactory(
  workload: BenchmarkWorkload
): BenchmarkScenarioFactory {
  const name = `prepare/${workload.name}`;

  return {
    name,
    build() {
      return {
        manifest: {
          category: 'prepare',
          fileCount: workload.fileCount,
          name,
          workload: workload.name,
        },
        measure(progressReporter) {
          return Promise.resolve(
            measureFunctionSamples(
              () => do_not_optimize(PathStore.preparePaths(workload.rawFiles)),
              getScenarioSampleCount('prepare'),
              {},
              progressReporter
            )
          );
        },
        name,
      };
    },
  };
}

function createPreparePresortedInputScenarioFactory(
  workload: BenchmarkWorkload
): BenchmarkScenarioFactory {
  const name = `prepare-presorted-input/${workload.name}`;

  return {
    name,
    build() {
      const presortedFiles = workload.getPresortedFiles();

      return {
        manifest: {
          category: 'prepare',
          fileCount: workload.fileCount,
          name,
          notes: [
            'Parses already-canonical presorted strings into prepared input.',
          ],
          workload: workload.name,
        },
        measure(progressReporter) {
          return Promise.resolve(
            measureFunctionSamples(
              () =>
                do_not_optimize(
                  PathStore.preparePresortedInput(presortedFiles)
                ),
              getScenarioSampleCount('prepare'),
              {},
              progressReporter
            )
          );
        },
        name,
      };
    },
  };
}

function createBuildScenarioFactory(
  workload: BenchmarkWorkload
): BenchmarkScenarioFactory {
  const name = `build/${workload.name}`;

  return {
    name,
    build() {
      const previewVisibleCount =
        createExpandedStore(workload).getVisibleCount();

      return {
        manifest: {
          category: 'build',
          fileCount: workload.fileCount,
          name,
          visibleCount: previewVisibleCount,
          workload: workload.name,
        },
        measure(progressReporter) {
          return Promise.resolve(
            measureFunctionSamples(
              () => {
                const store = createExpandedStore(workload);
                return do_not_optimize(store.getNodeCount());
              },
              getScenarioSampleCount('build'),
              { innerGc: true, warmupCount: 2 },
              progressReporter
            )
          );
        },
        name,
      };
    },
  };
}

function createListScenarioFactory(
  workload: BenchmarkWorkload
): BenchmarkScenarioFactory {
  const name = `list/${workload.name}`;

  return {
    name,
    build() {
      const previewStore = createExpandedStore(workload);
      const preview = previewStore.list().slice(0, PREVIEW_LIMIT);

      return {
        manifest: {
          category: 'list',
          fileCount: workload.fileCount,
          name,
          preview,
          visibleCount: previewStore.getVisibleCount(),
          workload: workload.name,
        },
        measure(progressReporter) {
          return Promise.resolve(
            measureFunctionSamples(
              () => do_not_optimize(previewStore.list()),
              getScenarioSampleCount('list'),
              { innerGc: true },
              progressReporter
            )
          );
        },
        name,
      };
    },
  };
}

function createVisibleScenarioFactory(
  workload: BenchmarkWorkload,
  viewport: ViewportMode,
  windowSize: number
): BenchmarkScenarioFactory {
  const name = `visible-${viewport}/${workload.name}/${windowSize}`;

  return {
    name,
    build() {
      const store = createExpandedStore(workload);
      const bounds = getWindowBounds(store, viewport, windowSize);
      const read = readVisibleWindow(store, bounds);

      return {
        manifest: {
          category: 'visible',
          fileCount: workload.fileCount,
          name,
          preview: getPreview(read.rows),
          viewport,
          visibleCount: read.visibleCount,
          windowEnd: bounds.end,
          windowSize,
          windowStart: bounds.start,
          workload: workload.name,
        },
        measure(progressReporter) {
          return Promise.resolve(
            measureFunctionSamples(
              () => do_not_optimize(readVisibleWindow(store, bounds)),
              getScenarioSampleCount('visible'),
              {},
              progressReporter
            )
          );
        },
        name,
      };
    },
  };
}

function createColdVisibleScenarioFactory(
  workload: BenchmarkWorkload,
  viewport: ViewportMode,
  windowSize: number
): BenchmarkScenarioFactory {
  const name = `visible-cold-${viewport}/${workload.name}/${windowSize}`;

  return {
    name,
    build() {
      const previewStore = createExpandedStore(workload);
      const bounds = getWindowBounds(previewStore, viewport, windowSize);
      const read = readVisibleWindow(previewStore, bounds);

      return {
        manifest: {
          category: 'visible-cold',
          fileCount: workload.fileCount,
          name,
          notes: [
            'Creates a fresh expanded store for each timed visible read.',
          ],
          preview: getPreview(read.rows),
          viewport,
          visibleCount: read.visibleCount,
          windowEnd: bounds.end,
          windowSize,
          windowStart: bounds.start,
          workload: workload.name,
        },
        measure(progressReporter) {
          return Promise.resolve(
            measureFreshSampleBench(
              {
                createSample() {
                  return createExpandedStore(workload);
                },
                runSample(store) {
                  return do_not_optimize(readVisibleWindow(store, bounds));
                },
              },
              getScenarioSampleCount('visible-cold'),
              { innerGc: true },
              progressReporter
            )
          );
        },
        name,
      };
    },
  };
}

function createSequentialScrollScenarioFactory(
  workload: BenchmarkWorkload,
  viewport: ViewportMode,
  windowSize: number
): BenchmarkScenarioFactory {
  const name = `scroll-${viewport}/${workload.name}/${windowSize}`;

  return {
    name,
    build() {
      const store = createExpandedStore(workload);
      const boundsList = getSequentialScrollBounds(store, viewport, windowSize);
      const preview = getPreview(
        getWindowRows(store, boundsList[0] ?? { end: -1, start: 0 })
      );

      return {
        manifest: {
          category: 'scroll',
          fileCount: workload.fileCount,
          name,
          notes: [
            `Reads ${formatCount(boundsList.length)} consecutive windows with a ${formatCount(SCROLL_WINDOW_STEP)}-row step.`,
          ],
          preview,
          viewport,
          visibleCount: store.getVisibleCount(),
          windowEnd: (boundsList[boundsList.length - 1] ?? boundsList[0])?.end,
          windowSize,
          windowStart: boundsList[0]?.start,
          workload: workload.name,
        },
        measure(progressReporter) {
          return Promise.resolve(
            measureFunctionSamples(
              () => {
                let lastRead: VisibleWindowRead = { rows: [], visibleCount: 0 };
                for (const bounds of boundsList) {
                  lastRead = readVisibleWindow(store, bounds);
                }

                return do_not_optimize(lastRead);
              },
              getScenarioSampleCount('scroll'),
              {},
              progressReporter
            )
          );
        },
        name,
      };
    },
  };
}

function createEndToEndScenarioFactory(
  workload: BenchmarkWorkload,
  viewport: ViewportMode,
  windowSize: number
): BenchmarkScenarioFactory {
  const name = `e2e-${viewport}/${workload.name}/${windowSize}`;

  return {
    name,
    build() {
      const previewStore = createExpandedStore(workload);
      const bounds = getWindowBounds(previewStore, viewport, windowSize);
      const read = readVisibleWindow(previewStore, bounds);

      return {
        manifest: {
          category: 'e2e',
          fileCount: workload.fileCount,
          name,
          preview: getPreview(read.rows),
          viewport,
          visibleCount: read.visibleCount,
          windowEnd: bounds.end,
          windowSize,
          windowStart: bounds.start,
          workload: workload.name,
        },
        measure(progressReporter) {
          return Promise.resolve(
            measureFunctionSamples(
              () => {
                const store = createExpandedStore(workload);
                const nextBounds = getWindowBounds(store, viewport, windowSize);
                return do_not_optimize(readVisibleWindow(store, nextBounds));
              },
              getScenarioSampleCount('e2e'),
              { innerGc: true },
              progressReporter
            )
          );
        },
        name,
      };
    },
  };
}

function createRenameLeafScenarioFactory(
  workload: BenchmarkWorkload,
  viewport: ViewportMode
): BenchmarkScenarioFactory {
  const name = `mutate/rename-leaf/${viewport}/${workload.name}/${MUTATION_WINDOW_SIZE}`;

  return {
    name,
    build() {
      const previewStore = createExpandedStore(workload);
      const baselineBounds = getWindowBounds(
        previewStore,
        viewport,
        MUTATION_WINDOW_SIZE
      );
      const baselineRead = readVisibleWindow(previewStore, baselineBounds);
      const targetPath = requireVisibleFile(baselineRead.rows, name).path;
      const renamedPath = renamePathWithSuffix(targetPath, 'benchmark-renamed');

      const simulationStore = createExpandedStore(workload);
      simulationStore.move(targetPath, renamedPath);
      const readPlan = createRenderChangedWindowPlan(
        simulationStore,
        baselineBounds,
        MUTATION_WINDOW_SIZE,
        [renamedPath]
      );
      const postMutationRead = readVisibleWindow(
        simulationStore,
        readPlan.bounds
      );

      return {
        manifest: {
          afterPreview: getPreview(postMutationRead.rows),
          baselineWindowEnd: baselineBounds.end,
          baselineWindowStart: baselineBounds.start,
          beforePreview: getPreview(baselineRead.rows),
          category: 'mutation',
          destinationPath: renamedPath,
          fileCount: workload.fileCount,
          name,
          postMutationReadIntent: readPlan.intent,
          renderTargetPath: readPlan.renderTargetPath,
          targetPath,
          targetVisible: true,
          viewport,
          visibleCount: postMutationRead.visibleCount,
          windowEnd: readPlan.bounds.end,
          windowShifted: readPlan.windowShifted,
          windowSize: MUTATION_WINDOW_SIZE,
          windowStart: readPlan.bounds.start,
          workload: workload.name,
        },
        measure(progressReporter) {
          return Promise.resolve(
            measureMutationWithReusedStore(
              {
                apply(store) {
                  store.move(targetPath, renamedPath);
                  return readVisibleWindow(store, readPlan.bounds);
                },
                createStore() {
                  return createExpandedStore(workload);
                },
                reset(store) {
                  store.move(renamedPath, targetPath);
                },
              },
              progressReporter
            )
          );
        },
        name,
      };
    },
  };
}

function createRenameLeafListenerScenarioFactory(
  workload: BenchmarkWorkload,
  viewport: ViewportMode,
  listenerType: '*' | 'move'
): BenchmarkScenarioFactory {
  const listenerLabel = listenerType === '*' ? 'wildcard' : 'specific';
  const name = `mutate/rename-leaf-listener-${listenerLabel}/${viewport}/${workload.name}/${MUTATION_WINDOW_SIZE}`;

  return {
    name,
    build() {
      const previewStore = createExpandedStore(workload);
      const baselineBounds = getWindowBounds(
        previewStore,
        viewport,
        MUTATION_WINDOW_SIZE
      );
      const baselineRead = readVisibleWindow(previewStore, baselineBounds);
      const targetPath = requireVisibleFile(baselineRead.rows, name).path;
      const renamedPath = renamePathWithSuffix(targetPath, 'benchmark-renamed');

      const simulationStore = createExpandedStore(workload);
      simulationStore.move(targetPath, renamedPath);
      const readPlan = createRenderChangedWindowPlan(
        simulationStore,
        baselineBounds,
        MUTATION_WINDOW_SIZE,
        [renamedPath]
      );
      const postMutationRead = readVisibleWindow(
        simulationStore,
        readPlan.bounds
      );

      return {
        manifest: {
          afterPreview: getPreview(postMutationRead.rows),
          baselineWindowEnd: baselineBounds.end,
          baselineWindowStart: baselineBounds.start,
          beforePreview: getPreview(baselineRead.rows),
          category: 'mutation',
          destinationPath: renamedPath,
          fileCount: workload.fileCount,
          name,
          notes: [`Attached ${listenerLabel} listener to the store.`],
          postMutationReadIntent: readPlan.intent,
          renderTargetPath: readPlan.renderTargetPath,
          targetPath,
          targetVisible: true,
          viewport,
          visibleCount: postMutationRead.visibleCount,
          windowEnd: readPlan.bounds.end,
          windowShifted: readPlan.windowShifted,
          windowSize: MUTATION_WINDOW_SIZE,
          windowStart: readPlan.bounds.start,
          workload: workload.name,
        },
        measure(progressReporter) {
          return Promise.resolve(
            measureMutationWithReusedStore(
              {
                apply(store) {
                  store.move(targetPath, renamedPath);
                  return readVisibleWindow(store, readPlan.bounds);
                },
                createStore() {
                  const store = createExpandedStore(workload);
                  attachBenchmarkListener(store, listenerType);
                  return store;
                },
                reset(store) {
                  store.move(renamedPath, targetPath);
                },
              },
              progressReporter
            )
          );
        },
        name,
      };
    },
  };
}

function createDeleteLeafScenarioFactory(
  workload: BenchmarkWorkload,
  viewport: ViewportMode
): BenchmarkScenarioFactory {
  const name = `mutate/delete-leaf/${viewport}/${workload.name}/${MUTATION_WINDOW_SIZE}`;

  return {
    name,
    build() {
      const previewStore = createExpandedStore(workload);
      const baselineBounds = getWindowBounds(
        previewStore,
        viewport,
        MUTATION_WINDOW_SIZE
      );
      const baselineRead = readVisibleWindow(previewStore, baselineBounds);
      const targetPath = requireVisibleFile(baselineRead.rows, name).path;

      const simulationStore = createExpandedStore(workload);
      simulationStore.remove(targetPath);
      const readPlan = createRenderChangedWindowPlan(
        simulationStore,
        baselineBounds,
        MUTATION_WINDOW_SIZE,
        []
      );
      const postMutationRead = readVisibleWindow(
        simulationStore,
        readPlan.bounds
      );

      return {
        manifest: {
          afterPreview: getPreview(postMutationRead.rows),
          baselineWindowEnd: baselineBounds.end,
          baselineWindowStart: baselineBounds.start,
          beforePreview: getPreview(baselineRead.rows),
          category: 'mutation',
          fileCount: workload.fileCount,
          name,
          postMutationReadIntent: readPlan.intent,
          targetPath,
          targetVisible: true,
          viewport,
          visibleCount: postMutationRead.visibleCount,
          windowEnd: readPlan.bounds.end,
          windowShifted: readPlan.windowShifted,
          windowSize: MUTATION_WINDOW_SIZE,
          windowStart: readPlan.bounds.start,
          workload: workload.name,
        },
        measure(progressReporter) {
          return Promise.resolve(
            measureMutationWithReusedStore(
              {
                apply(store) {
                  store.remove(targetPath);
                  return readVisibleWindow(store, readPlan.bounds);
                },
                createStore() {
                  return createExpandedStore(workload);
                },
                reset(store) {
                  store.add(targetPath);
                },
              },
              progressReporter
            )
          );
        },
        name,
      };
    },
  };
}

function createAddSiblingScenarioFactory(
  workload: BenchmarkWorkload,
  viewport: ViewportMode
): BenchmarkScenarioFactory {
  const name = `mutate/add-sibling/${viewport}/${workload.name}/${MUTATION_WINDOW_SIZE}`;

  return {
    name,
    build() {
      const previewStore = createExpandedStore(workload);
      const baselineBounds = getWindowBounds(
        previewStore,
        viewport,
        MUTATION_WINDOW_SIZE
      );
      const baselineRead = readVisibleWindow(previewStore, baselineBounds);
      const targetPath = requireVisibleFile(baselineRead.rows, name).path;
      const addedPath = createSiblingPath(targetPath, 'benchmark-added');

      const simulationStore = createExpandedStore(workload);
      simulationStore.add(addedPath);
      const readPlan = createRenderChangedWindowPlan(
        simulationStore,
        baselineBounds,
        MUTATION_WINDOW_SIZE,
        [addedPath]
      );
      const postMutationRead = readVisibleWindow(
        simulationStore,
        readPlan.bounds
      );

      return {
        manifest: {
          afterPreview: getPreview(postMutationRead.rows),
          baselineWindowEnd: baselineBounds.end,
          baselineWindowStart: baselineBounds.start,
          beforePreview: getPreview(baselineRead.rows),
          category: 'mutation',
          destinationPath: addedPath,
          fileCount: workload.fileCount,
          name,
          postMutationReadIntent: readPlan.intent,
          renderTargetPath: readPlan.renderTargetPath,
          targetPath,
          targetVisible: true,
          viewport,
          visibleCount: postMutationRead.visibleCount,
          windowEnd: readPlan.bounds.end,
          windowShifted: readPlan.windowShifted,
          windowSize: MUTATION_WINDOW_SIZE,
          windowStart: readPlan.bounds.start,
          workload: workload.name,
        },
        measure(progressReporter) {
          return Promise.resolve(
            measureMutationWithReusedStore(
              {
                apply(store) {
                  store.add(addedPath);
                  return readVisibleWindow(store, readPlan.bounds);
                },
                createStore() {
                  return createExpandedStore(workload);
                },
                reset(store) {
                  store.remove(addedPath);
                },
              },
              progressReporter
            )
          );
        },
        name,
      };
    },
  };
}

function createAddSiblingListenerScenarioFactory(
  workload: BenchmarkWorkload,
  viewport: ViewportMode
): BenchmarkScenarioFactory {
  const name = `mutate/add-sibling-listener-wildcard/${viewport}/${workload.name}/${MUTATION_WINDOW_SIZE}`;

  return {
    name,
    build() {
      const previewStore = createExpandedStore(workload);
      const baselineBounds = getWindowBounds(
        previewStore,
        viewport,
        MUTATION_WINDOW_SIZE
      );
      const baselineRead = readVisibleWindow(previewStore, baselineBounds);
      const targetPath = requireVisibleFile(baselineRead.rows, name).path;
      const addedPath = createSiblingPath(targetPath, 'benchmark-added');

      const simulationStore = createExpandedStore(workload);
      simulationStore.add(addedPath);
      const readPlan = createRenderChangedWindowPlan(
        simulationStore,
        baselineBounds,
        MUTATION_WINDOW_SIZE,
        [addedPath]
      );
      const postMutationRead = readVisibleWindow(
        simulationStore,
        readPlan.bounds
      );

      return {
        manifest: {
          afterPreview: getPreview(postMutationRead.rows),
          baselineWindowEnd: baselineBounds.end,
          baselineWindowStart: baselineBounds.start,
          beforePreview: getPreview(baselineRead.rows),
          category: 'mutation',
          destinationPath: addedPath,
          fileCount: workload.fileCount,
          name,
          notes: [
            'Attached wildcard listener to a flatten-sensitive add-sibling case.',
          ],
          postMutationReadIntent: readPlan.intent,
          renderTargetPath: readPlan.renderTargetPath,
          targetPath,
          targetVisible: true,
          viewport,
          visibleCount: postMutationRead.visibleCount,
          windowEnd: readPlan.bounds.end,
          windowShifted: readPlan.windowShifted,
          windowSize: MUTATION_WINDOW_SIZE,
          windowStart: readPlan.bounds.start,
          workload: workload.name,
        },
        measure(progressReporter) {
          return Promise.resolve(
            measureMutationWithReusedStore(
              {
                apply(store) {
                  store.add(addedPath);
                  return readVisibleWindow(store, readPlan.bounds);
                },
                createStore() {
                  const store = createExpandedStore(workload);
                  attachBenchmarkListener(store, '*');
                  return store;
                },
                reset(store) {
                  store.remove(addedPath);
                },
              },
              progressReporter
            )
          );
        },
        name,
      };
    },
  };
}

function createMoveLeafScenarioFactory(
  workload: BenchmarkWorkload,
  viewport: ViewportMode
): BenchmarkScenarioFactory {
  const name = `mutate/move-leaf/${viewport}/${workload.name}/${MUTATION_WINDOW_SIZE}`;

  return {
    name,
    build() {
      const previewStore = createExpandedStore(workload);
      const baselineBounds = getWindowBounds(
        previewStore,
        viewport,
        MUTATION_WINDOW_SIZE
      );
      const baselineRead = readVisibleWindow(previewStore, baselineBounds);
      const targetPath = requireVisibleFile(baselineRead.rows, name).path;
      const destinationDirectory = requireVisibleMoveDestinationDirectory(
        baselineRead.rows,
        targetPath,
        name
      );
      const movedPath = getMovedPathIntoDirectory(
        targetPath,
        destinationDirectory.path
      );

      const simulationStore = createExpandedStore(workload);
      simulationStore.move(targetPath, destinationDirectory.path);
      const readPlan = createRenderChangedWindowPlan(
        simulationStore,
        baselineBounds,
        MUTATION_WINDOW_SIZE,
        [movedPath]
      );
      const postMutationRead = readVisibleWindow(
        simulationStore,
        readPlan.bounds
      );

      return {
        manifest: {
          afterPreview: getPreview(postMutationRead.rows),
          baselineWindowEnd: baselineBounds.end,
          baselineWindowStart: baselineBounds.start,
          beforePreview: getPreview(baselineRead.rows),
          category: 'mutation',
          destinationPath: movedPath,
          fileCount: workload.fileCount,
          name,
          notes: [`Moved into visible directory ${destinationDirectory.path}.`],
          postMutationReadIntent: readPlan.intent,
          renderTargetPath: readPlan.renderTargetPath,
          targetPath,
          targetVisible: true,
          viewport,
          visibleCount: postMutationRead.visibleCount,
          windowEnd: readPlan.bounds.end,
          windowShifted: readPlan.windowShifted,
          windowSize: MUTATION_WINDOW_SIZE,
          windowStart: readPlan.bounds.start,
          workload: workload.name,
        },
        measure(progressReporter) {
          return Promise.resolve(
            measureMutationWithReusedStore(
              {
                apply(store) {
                  store.move(targetPath, destinationDirectory.path);
                  return readVisibleWindow(store, readPlan.bounds);
                },
                createStore() {
                  return createExpandedStore(workload);
                },
                reset(store) {
                  store.move(movedPath, targetPath);
                },
              },
              progressReporter
            )
          );
        },
        name,
      };
    },
  };
}

function createDeleteSubtreeScenarioFactory(
  workload: BenchmarkWorkload,
  viewport: ViewportMode
): BenchmarkScenarioFactory {
  const name = `mutate/delete-subtree/${viewport}/${workload.name}/${MUTATION_WINDOW_SIZE}`;

  return {
    name,
    build() {
      const previewStore = createExpandedStore(workload);
      const baselineBounds = getWindowBounds(
        previewStore,
        viewport,
        MUTATION_WINDOW_SIZE
      );
      const baselineRead = readVisibleWindow(previewStore, baselineBounds);
      const targetPath = requireRootDirectory(previewStore, name).path;

      const simulationStore = createExpandedStore(workload);
      simulationStore.remove(targetPath, { recursive: true });
      const readPlan =
        viewport === 'first'
          ? createRenderChangedWindowPlan(
              simulationStore,
              baselineBounds,
              MUTATION_WINDOW_SIZE,
              []
            )
          : createPreservedViewportReadPlan(baselineBounds);
      const postMutationRead = readVisibleWindow(
        simulationStore,
        readPlan.bounds
      );

      return {
        manifest: {
          afterPreview: getPreview(postMutationRead.rows),
          baselineWindowEnd: baselineBounds.end,
          baselineWindowStart: baselineBounds.start,
          beforePreview: getPreview(baselineRead.rows),
          category: 'mutation',
          fileCount: workload.fileCount,
          name,
          notes: [
            'Uses a fresh store per timed sample because subtree restoration is intentionally excluded from the measurement.',
          ],
          postMutationReadIntent: readPlan.intent,
          targetPath,
          targetVisible: hasVisiblePath(baselineRead.rows, targetPath),
          viewport,
          visibleCount: postMutationRead.visibleCount,
          windowEnd: readPlan.bounds.end,
          windowShifted: readPlan.windowShifted,
          windowSize: MUTATION_WINDOW_SIZE,
          windowStart: readPlan.bounds.start,
          workload: workload.name,
        },
        measure(progressReporter) {
          return Promise.resolve(
            measureFreshSampleBench(
              {
                createSample() {
                  return createExpandedStore(workload);
                },
                runSample(store) {
                  store.remove(targetPath, { recursive: true });
                  return do_not_optimize(
                    readVisibleWindow(store, readPlan.bounds)
                  );
                },
              },
              DESTRUCTIVE_MUTATION_SCENARIO_SAMPLE_COUNT,
              { innerGc: true },
              progressReporter
            )
          );
        },
        name,
      };
    },
  };
}

function createMoveSubtreeScenarioFactory(
  workload: BenchmarkWorkload,
  viewport: ViewportMode
): BenchmarkScenarioFactory {
  const name = `mutate/move-subtree/${viewport}/${workload.name}/${MUTATION_WINDOW_SIZE}`;

  return {
    name,
    build() {
      const previewStore = createExpandedStore(workload);
      const baselineBounds = getWindowBounds(
        previewStore,
        viewport,
        MUTATION_WINDOW_SIZE
      );
      const baselineRead = readVisibleWindow(previewStore, baselineBounds);
      const targetPath = requireRootDirectory(previewStore, name).path;
      const destinationPath = requireSecondRootDirectoryPath(
        workload,
        targetPath,
        name
      );
      const movedPath = getMovedPathIntoDirectory(targetPath, destinationPath);

      const simulationStore = createExpandedStore(workload);
      simulationStore.move(targetPath, destinationPath);
      const readPlan =
        viewport === 'first'
          ? createRenderChangedWindowPlan(
              simulationStore,
              baselineBounds,
              MUTATION_WINDOW_SIZE,
              [movedPath]
            )
          : createPreservedViewportReadPlan(baselineBounds);
      const postMutationRead = readVisibleWindow(
        simulationStore,
        readPlan.bounds
      );

      return {
        manifest: {
          afterPreview: getPreview(postMutationRead.rows),
          baselineWindowEnd: baselineBounds.end,
          baselineWindowStart: baselineBounds.start,
          beforePreview: getPreview(baselineRead.rows),
          category: 'mutation',
          destinationPath: movedPath,
          fileCount: workload.fileCount,
          name,
          notes: [
            `Moved expanded subtree into root directory ${destinationPath}.`,
          ],
          postMutationReadIntent: readPlan.intent,
          renderTargetPath: readPlan.renderTargetPath,
          targetPath,
          targetVisible: hasVisiblePath(baselineRead.rows, targetPath),
          viewport,
          visibleCount: postMutationRead.visibleCount,
          windowEnd: readPlan.bounds.end,
          windowShifted: readPlan.windowShifted,
          windowSize: MUTATION_WINDOW_SIZE,
          windowStart: readPlan.bounds.start,
          workload: workload.name,
        },
        measure(progressReporter) {
          return Promise.resolve(
            measureMutationWithReusedStore(
              {
                apply(store) {
                  store.move(targetPath, destinationPath);
                  return readVisibleWindow(store, readPlan.bounds);
                },
                createStore() {
                  return createExpandedStore(workload);
                },
                reset(store) {
                  store.move(movedPath, targetPath);
                },
              },
              progressReporter
            )
          );
        },
        name,
      };
    },
  };
}

function createBatchVisibleRenamesScenarioFactory(
  workload: BenchmarkWorkload,
  viewport: ViewportMode
): BenchmarkScenarioFactory {
  const name = `mutate/batch-visible-renames/${viewport}/${workload.name}/${MUTATION_WINDOW_SIZE}`;

  return {
    name,
    build() {
      const previewStore = createExpandedStore(workload);
      const baselineBounds = getWindowBounds(
        previewStore,
        viewport,
        MUTATION_WINDOW_SIZE
      );
      const baselineRead = readVisibleWindow(previewStore, baselineBounds);
      const targetFiles = getVisibleFiles(baselineRead.rows).slice(0, 16);
      if (targetFiles.length === 0) {
        throw new Error(`No visible files available for ${name}`);
      }

      const renamedPairs = targetFiles.map((row, index) => ({
        from: row.path,
        to: renamePathWithSuffix(row.path, `batch-${index + 1}`),
      }));
      const destinationPaths = renamedPairs.map((pair) => pair.to);

      const simulationStore = createExpandedStore(workload);
      simulationStore.batch(
        renamedPairs.map((pair) => ({
          from: pair.from,
          to: pair.to,
          type: 'move' as const,
        }))
      );
      const readPlan = createRenderChangedWindowPlan(
        simulationStore,
        baselineBounds,
        MUTATION_WINDOW_SIZE,
        destinationPaths
      );
      const postMutationRead = readVisibleWindow(
        simulationStore,
        readPlan.bounds
      );

      return {
        manifest: {
          afterPreview: getPreview(postMutationRead.rows),
          baselineWindowEnd: baselineBounds.end,
          baselineWindowStart: baselineBounds.start,
          beforePreview: getPreview(baselineRead.rows),
          category: 'mutation',
          fileCount: workload.fileCount,
          name,
          notes: [
            `Renames ${formatCount(renamedPairs.length)} visible files in one batch.`,
          ],
          postMutationReadIntent: readPlan.intent,
          renderTargetPath: readPlan.renderTargetPath,
          targetPath: renamedPairs[0]?.from,
          targetVisible: true,
          viewport,
          visibleCount: postMutationRead.visibleCount,
          windowEnd: readPlan.bounds.end,
          windowShifted: readPlan.windowShifted,
          windowSize: MUTATION_WINDOW_SIZE,
          windowStart: readPlan.bounds.start,
          workload: workload.name,
        },
        measure(progressReporter) {
          return Promise.resolve(
            measureMutationWithReusedStore(
              {
                apply(store) {
                  store.batch(
                    renamedPairs.map((pair) => ({
                      from: pair.from,
                      to: pair.to,
                      type: 'move' as const,
                    }))
                  );
                  return readVisibleWindow(store, readPlan.bounds);
                },
                createStore() {
                  return createExpandedStore(workload);
                },
                reset(store) {
                  store.batch(
                    renamedPairs.map((pair) => ({
                      from: pair.to,
                      to: pair.from,
                      type: 'move' as const,
                    }))
                  );
                },
              },
              progressReporter
            )
          );
        },
        name,
      };
    },
  };
}

function createBatchVisibleRenamesListenerScenarioFactory(
  workload: BenchmarkWorkload,
  viewport: ViewportMode
): BenchmarkScenarioFactory {
  const name = `mutate/batch-visible-renames-listener-wildcard/${viewport}/${workload.name}/${MUTATION_WINDOW_SIZE}`;

  return {
    name,
    build() {
      const previewStore = createExpandedStore(workload);
      const baselineBounds = getWindowBounds(
        previewStore,
        viewport,
        MUTATION_WINDOW_SIZE
      );
      const baselineRead = readVisibleWindow(previewStore, baselineBounds);
      const targetFiles = getVisibleFiles(baselineRead.rows).slice(0, 16);
      if (targetFiles.length === 0) {
        throw new Error(`No visible files available for ${name}`);
      }

      const renamedPairs = targetFiles.map((row, index) => ({
        from: row.path,
        to: renamePathWithSuffix(row.path, `batch-${index + 1}`),
      }));
      const destinationPaths = renamedPairs.map((pair) => pair.to);

      const simulationStore = createExpandedStore(workload);
      simulationStore.batch(
        renamedPairs.map((pair) => ({
          from: pair.from,
          to: pair.to,
          type: 'move' as const,
        }))
      );
      const readPlan = createRenderChangedWindowPlan(
        simulationStore,
        baselineBounds,
        MUTATION_WINDOW_SIZE,
        destinationPaths
      );
      const postMutationRead = readVisibleWindow(
        simulationStore,
        readPlan.bounds
      );

      return {
        manifest: {
          afterPreview: getPreview(postMutationRead.rows),
          baselineWindowEnd: baselineBounds.end,
          baselineWindowStart: baselineBounds.start,
          beforePreview: getPreview(baselineRead.rows),
          category: 'mutation',
          fileCount: workload.fileCount,
          name,
          notes: [
            `Renames ${formatCount(renamedPairs.length)} visible files in one batch with a wildcard listener attached.`,
          ],
          postMutationReadIntent: readPlan.intent,
          renderTargetPath: readPlan.renderTargetPath,
          targetPath: renamedPairs[0]?.from,
          targetVisible: true,
          viewport,
          visibleCount: postMutationRead.visibleCount,
          windowEnd: readPlan.bounds.end,
          windowShifted: readPlan.windowShifted,
          windowSize: MUTATION_WINDOW_SIZE,
          windowStart: readPlan.bounds.start,
          workload: workload.name,
        },
        measure(progressReporter) {
          return Promise.resolve(
            measureMutationWithReusedStore(
              {
                apply(store) {
                  store.batch(
                    renamedPairs.map((pair) => ({
                      from: pair.from,
                      to: pair.to,
                      type: 'move' as const,
                    }))
                  );
                  return readVisibleWindow(store, readPlan.bounds);
                },
                createStore() {
                  const store = createExpandedStore(workload);
                  attachBenchmarkListener(store, '*');
                  return store;
                },
                reset(store) {
                  store.batch(
                    renamedPairs.map((pair) => ({
                      from: pair.to,
                      to: pair.from,
                      type: 'move' as const,
                    }))
                  );
                },
              },
              progressReporter
            )
          );
        },
        name,
      };
    },
  };
}

function createExpandDirectoryScenarioFactory(
  workload: BenchmarkWorkload,
  viewport: ViewportMode
): BenchmarkScenarioFactory {
  const name = `mutate/expand-directory/${viewport}/${workload.name}/${MUTATION_WINDOW_SIZE}`;

  return {
    name,
    build() {
      const expandedStore = createExpandedStore(workload);
      const expandedBounds = getWindowBounds(
        expandedStore,
        viewport,
        MUTATION_WINDOW_SIZE
      );
      const expandedRead = readVisibleWindow(expandedStore, expandedBounds);
      const targetPath = requireVisibleDirectoryWithRoom(
        expandedRead.rows,
        name
      ).path;

      const collapsedStore = createExpandedStore(workload);
      collapsedStore.collapse(targetPath);
      const baselineBounds = getWindowBounds(
        collapsedStore,
        viewport,
        MUTATION_WINDOW_SIZE
      );
      const baselineRead = readVisibleWindow(collapsedStore, baselineBounds);
      const readPlan = createRenderChangedWindowPlan(
        expandedStore,
        baselineBounds,
        MUTATION_WINDOW_SIZE,
        [targetPath]
      );
      const postMutationRead = readVisibleWindow(
        expandedStore,
        readPlan.bounds
      );

      return {
        manifest: {
          afterPreview: getPreview(postMutationRead.rows),
          baselineWindowEnd: baselineBounds.end,
          baselineWindowStart: baselineBounds.start,
          beforePreview: getPreview(baselineRead.rows),
          category: 'mutation',
          fileCount: workload.fileCount,
          name,
          postMutationReadIntent: readPlan.intent,
          renderTargetPath: readPlan.renderTargetPath,
          targetPath,
          targetVisible: hasVisiblePath(baselineRead.rows, targetPath),
          viewport,
          visibleCount: postMutationRead.visibleCount,
          windowEnd: readPlan.bounds.end,
          windowShifted: readPlan.windowShifted,
          windowSize: MUTATION_WINDOW_SIZE,
          windowStart: readPlan.bounds.start,
          workload: workload.name,
        },
        measure(progressReporter) {
          return Promise.resolve(
            measureMutationWithReusedStore(
              {
                apply(store) {
                  store.expand(targetPath);
                  return readVisibleWindow(store, readPlan.bounds);
                },
                createStore() {
                  const store = createExpandedStore(workload);
                  store.collapse(targetPath);
                  return store;
                },
                reset(store) {
                  store.collapse(targetPath);
                },
              },
              progressReporter
            )
          );
        },
        name,
      };
    },
  };
}

function createRenameRootFileScenarioFactory(
  workload: BenchmarkWorkload,
  viewport: ViewportMode
): BenchmarkScenarioFactory {
  const name = `mutate/rename-root-file/${viewport}/${workload.name}/${MUTATION_WINDOW_SIZE}`;

  return {
    name,
    build() {
      const previewStore = createExpandedStore(workload, [ROOT_FILE_SEED_PATH]);
      const baselineBounds = getWindowBounds(
        previewStore,
        viewport,
        MUTATION_WINDOW_SIZE
      );
      const baselineRead = readVisibleWindow(previewStore, baselineBounds);

      const simulationStore = createExpandedStore(workload, [
        ROOT_FILE_SEED_PATH,
      ]);
      simulationStore.move(ROOT_FILE_SEED_PATH, ROOT_FILE_RENAMED_PATH);
      const readPlan =
        viewport === 'first'
          ? createRenderChangedWindowPlan(
              simulationStore,
              baselineBounds,
              MUTATION_WINDOW_SIZE,
              [ROOT_FILE_RENAMED_PATH]
            )
          : createPreservedViewportReadPlan(baselineBounds);
      const postMutationRead = readVisibleWindow(
        simulationStore,
        readPlan.bounds
      );

      return {
        manifest: {
          afterPreview: getPreview(postMutationRead.rows),
          baselineWindowEnd: baselineBounds.end,
          baselineWindowStart: baselineBounds.start,
          beforePreview: getPreview(baselineRead.rows),
          category: 'mutation',
          destinationPath: ROOT_FILE_RENAMED_PATH,
          fileCount: workload.fileCount,
          name,
          notes: [`Seeded ${ROOT_FILE_SEED_PATH} before timing.`],
          postMutationReadIntent: readPlan.intent,
          renderTargetPath: readPlan.renderTargetPath,
          targetPath: ROOT_FILE_SEED_PATH,
          targetVisible: hasVisiblePath(baselineRead.rows, ROOT_FILE_SEED_PATH),
          viewport,
          visibleCount: postMutationRead.visibleCount,
          windowEnd: readPlan.bounds.end,
          windowShifted: readPlan.windowShifted,
          windowSize: MUTATION_WINDOW_SIZE,
          windowStart: readPlan.bounds.start,
          workload: workload.name,
        },
        measure(progressReporter) {
          return Promise.resolve(
            measureMutationWithReusedStore(
              {
                apply(store) {
                  store.move(ROOT_FILE_SEED_PATH, ROOT_FILE_RENAMED_PATH);
                  return readVisibleWindow(store, readPlan.bounds);
                },
                createStore() {
                  return createExpandedStore(workload, [ROOT_FILE_SEED_PATH]);
                },
                reset(store) {
                  store.move(ROOT_FILE_RENAMED_PATH, ROOT_FILE_SEED_PATH);
                },
              },
              progressReporter
            )
          );
        },
        name,
      };
    },
  };
}

function createRenameRootDirectoryScenarioFactory(
  workload: BenchmarkWorkload,
  viewport: ViewportMode
): BenchmarkScenarioFactory {
  const name = `mutate/rename-root-directory/${viewport}/${workload.name}/${MUTATION_WINDOW_SIZE}`;

  return {
    name,
    build() {
      const previewStore = createExpandedStore(workload);
      const baselineBounds = getWindowBounds(
        previewStore,
        viewport,
        MUTATION_WINDOW_SIZE
      );
      const baselineRead = readVisibleWindow(previewStore, baselineBounds);
      const targetPath = requireRootDirectory(previewStore, name).path;
      const renamedPath = renamePathWithSuffix(targetPath, 'benchmark-renamed');

      const simulationStore = createExpandedStore(workload);
      simulationStore.move(targetPath, renamedPath);
      const readPlan =
        viewport === 'first'
          ? createRenderChangedWindowPlan(
              simulationStore,
              baselineBounds,
              MUTATION_WINDOW_SIZE,
              [renamedPath]
            )
          : createPreservedViewportReadPlan(baselineBounds);
      const postMutationRead = readVisibleWindow(
        simulationStore,
        readPlan.bounds
      );

      return {
        manifest: {
          afterPreview: getPreview(postMutationRead.rows),
          baselineWindowEnd: baselineBounds.end,
          baselineWindowStart: baselineBounds.start,
          beforePreview: getPreview(baselineRead.rows),
          category: 'mutation',
          destinationPath: renamedPath,
          fileCount: workload.fileCount,
          name,
          postMutationReadIntent: readPlan.intent,
          renderTargetPath: readPlan.renderTargetPath,
          targetPath,
          targetVisible: hasVisiblePath(baselineRead.rows, targetPath),
          viewport,
          visibleCount: postMutationRead.visibleCount,
          windowEnd: readPlan.bounds.end,
          windowShifted: readPlan.windowShifted,
          windowSize: MUTATION_WINDOW_SIZE,
          windowStart: readPlan.bounds.start,
          workload: workload.name,
        },
        measure(progressReporter) {
          return Promise.resolve(
            measureMutationWithReusedStore(
              {
                apply(store) {
                  store.move(targetPath, renamedPath);
                  return readVisibleWindow(store, readPlan.bounds);
                },
                createStore() {
                  return createExpandedStore(workload);
                },
                reset(store) {
                  store.move(renamedPath, targetPath);
                },
              },
              progressReporter
            )
          );
        },
        name,
      };
    },
  };
}

function createScenarioFactories(
  profile: BenchmarkProfile,
  workloads: readonly BenchmarkWorkload[]
): BenchmarkScenarioFactory[] {
  const factories: BenchmarkScenarioFactory[] = [];

  for (const workload of workloads) {
    if (profile.includePrepare) {
      factories.push(createPrepareScenarioFactory(workload));
      factories.push(createPreparePresortedInputScenarioFactory(workload));
    }

    factories.push(createListScenarioFactory(workload));

    if (profile.includeBuild) {
      factories.push(createBuildScenarioFactory(workload));
    }

    for (const windowSize of profile.visibleWindowSizes) {
      for (const viewport of VIEWPORT_MODES) {
        factories.push(
          createVisibleScenarioFactory(workload, viewport, windowSize)
        );
        factories.push(
          createColdVisibleScenarioFactory(workload, viewport, windowSize)
        );
        factories.push(
          createSequentialScrollScenarioFactory(workload, viewport, windowSize)
        );
        if (profile.includeEndToEnd) {
          factories.push(
            createEndToEndScenarioFactory(workload, viewport, windowSize)
          );
        }
      }
    }

    for (const viewport of VIEWPORT_MODES) {
      for (const mutationScenarioKind of profile.mutationScenarioKinds) {
        switch (mutationScenarioKind) {
          case 'rename-leaf':
            factories.push(createRenameLeafScenarioFactory(workload, viewport));
            break;
          case 'delete-leaf':
            factories.push(createDeleteLeafScenarioFactory(workload, viewport));
            break;
          case 'delete-subtree':
            factories.push(
              createDeleteSubtreeScenarioFactory(workload, viewport)
            );
            break;
          case 'add-sibling':
            factories.push(createAddSiblingScenarioFactory(workload, viewport));
            break;
          case 'move-leaf':
            factories.push(createMoveLeafScenarioFactory(workload, viewport));
            break;
          case 'move-subtree':
            factories.push(
              createMoveSubtreeScenarioFactory(workload, viewport)
            );
            break;
          case 'batch-visible-renames':
            factories.push(
              createBatchVisibleRenamesScenarioFactory(workload, viewport)
            );
            break;
          case 'expand-directory':
            factories.push(
              createExpandDirectoryScenarioFactory(workload, viewport)
            );
            break;
          case 'rename-root-file':
            factories.push(
              createRenameRootFileScenarioFactory(workload, viewport)
            );
            break;
          case 'rename-root-directory':
            factories.push(
              createRenameRootDirectoryScenarioFactory(workload, viewport)
            );
            break;
        }
      }
    }
  }

  if (profile.name === 'full') {
    const listenerBenchmarkWorkload = loadWorkload('linux-5x');
    for (const viewport of VIEWPORT_MODES) {
      factories.push(
        createRenameLeafListenerScenarioFactory(
          listenerBenchmarkWorkload,
          viewport,
          '*'
        )
      );
      factories.push(
        createRenameLeafListenerScenarioFactory(
          listenerBenchmarkWorkload,
          viewport,
          'move'
        )
      );
      factories.push(
        createBatchVisibleRenamesListenerScenarioFactory(
          listenerBenchmarkWorkload,
          viewport
        )
      );
    }

    const wideDirectoryWorkload = loadWorkload(
      PHASE_4_WIDE_DIRECTORY_WORKLOAD_NAME
    );
    factories.push(
      createVisibleScenarioFactory(wideDirectoryWorkload, 'middle', 200)
    );

    const flattenChainWorkload = loadWorkload(
      PHASE_5_FLATTEN_CHAIN_WORKLOAD_NAME
    );
    factories.push(
      createVisibleScenarioFactory(flattenChainWorkload, 'middle', 200)
    );
    factories.push(
      createAddSiblingListenerScenarioFactory(flattenChainWorkload, 'first')
    );
  }

  return factories;
}

const cliOptions = parseArgs(process.argv.slice(2));

if (cliOptions.compare != null) {
  const compareOutput = await createBenchmarkCompareOutput(
    cliOptions.compare.baselinePath,
    cliOptions.compare.candidatePath,
    cliOptions
  );

  if (cliOptions.json) {
    console.log(JSON.stringify(compareOutput));
  } else {
    printHumanBenchmarkCompareSummary(
      compareOutput,
      cliOptions.filter?.source ?? 'none'
    );
  }
} else {
  const profile = resolveProfile(cliOptions);

  if (!cliOptions.json) {
    printHumanBenchmarkBootBanner(cliOptions, profile);
  }

  const workloads: BenchmarkWorkload[] =
    profile.workloadNames.map(loadWorkload);
  const scenarioFactories = createScenarioFactories(profile, workloads);
  const selectedFactories = scenarioFactories.filter((factory) =>
    cliOptions.filter == null ? true : cliOptions.filter.test(factory.name)
  );

  if (selectedFactories.length === 0) {
    throw new Error('No benchmark scenarios matched the provided filter.');
  }

  if (cliOptions.json) {
    const jsonRun = await runBenchmarksForJson(
      selectedFactories,
      cliOptions.includeSamples
    );
    const runOutput: BenchmarkRunOutput = {
      derivedSummaries: jsonRun.derivedSummaries,
      generatedAt: new Date().toISOString(),
      intent: BENCHMARK_INTENT,
      kind: 'path-store-benchmark-run',
      preparationTimeMs: jsonRun.preparationTimeMs,
      profile: profile.name,
      results: jsonRun.results,
      scenarios: jsonRun.scenarios,
    };

    console.log(JSON.stringify(runOutput));
  } else {
    const humanRun = await runBenchmarksForHuman(selectedFactories);
    const derivedNameWidth = getHumanBenchmarkNameWidth(
      humanRun.derivedSummaries.map((summary) => summary.name)
    );
    const nameWidth = Math.max(
      getHumanBenchmarkFactoryNameWidth(selectedFactories),
      derivedNameWidth
    );
    printHumanDerivedBenchmarkSummaries(humanRun.derivedSummaries, nameWidth);
    console.log('');
    console.log(
      `${styleText('Completed', ANSI.green, ANSI.bold)} ${formatCount(humanRun.results.benchmarks.length)} scenarios. Use --json for detailed scenario metadata.`
    );
  }
}
