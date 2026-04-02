import { getVirtualizationWorkload } from '@pierre/tree-test-data';
import { do_not_optimize, measure } from 'mitata';
import { cpus } from 'node:os';

import { PathStore } from '../src/index';
import type { PathStoreVisibleRow } from '../src/public-types';
import { measureScenariosSequentially } from './benchmark-runner';

const WORKLOAD_NAMES = ['linux-5x', 'linux-10x'] as const;
const VIEWPORT_MODES = ['first', 'middle'] as const;
const VISIBLE_WINDOW_SIZES = [30, 100, 200, 500] as const;
const QUICK_VISIBLE_WINDOW_SIZES = [30, 200] as const;
const BENCHMARK_PROFILE_NAMES = ['quick', 'full'] as const;
const QUICK_WORKLOAD_NAMES = ['linux-5x'] as const;
const MUTATION_SCENARIO_KINDS = [
  'rename-leaf',
  'delete-leaf',
  'add-sibling',
  'move-leaf',
  'expand-directory',
  'rename-root-file',
  'rename-root-directory',
] as const;
const QUICK_MUTATION_SCENARIO_KINDS = [
  'rename-leaf',
  'rename-root-directory',
] as const;
const VISIBLE_SCENARIO_SAMPLE_COUNT = 10;
const BUILD_SCENARIO_SAMPLE_COUNT = 5;
const PREPARE_AND_E2E_SCENARIO_SAMPLE_COUNT = 3;
const MUTATION_SCENARIO_SAMPLE_COUNT = 25;
const MUTATION_SCENARIO_WARMUP_COUNT = 5;
const MUTATION_WINDOW_SIZE = 200;
const PREVIEW_LIMIT = 12;
const ROOT_FILE_SEED_PATH = 'zz-benchmark-root-file.ts';
const ROOT_FILE_RENAMED_PATH = 'zz-benchmark-root-file-renamed.ts';
const HUMAN_BENCHMARK_NAME_MIN_WIDTH = 32;
const HUMAN_BENCHMARK_NAME_MAX_WIDTH = 72;
const HUMAN_PROGRESS_LABEL_WIDTH = 44;
const LOCAL_VISIBLE_PATH_SEARCH_RADIUS = MUTATION_WINDOW_SIZE * 2;
const VISIBLE_PATH_SEARCH_CHUNK_SIZE = 1_024;
const ANSI_ENABLED = process.stdout.isTTY;
const WAIT_INDICATOR_FRAMES = ['.  ', '.. ', '...'] as const;
const BENCHMARK_INTENT =
  'Measure absolute path-store scenario latencies by workload and operation. Build and visible-read scenarios use presorted inputs everywhere except the standalone preparePaths benchmarks. Mutation scenarios measure commit plus the immediate store-side render contract: getVisibleCount() and getVisibleSlice(start, end), either for the changed window or for a preserved offscreen viewport.';

type BenchmarkWorkloadName = (typeof WORKLOAD_NAMES)[number];
type BenchmarkProfileName = (typeof BENCHMARK_PROFILE_NAMES)[number];
type ViewportMode = (typeof VIEWPORT_MODES)[number];
type ScenarioCategory = 'prepare' | 'build' | 'visible' | 'e2e' | 'mutation';
type MutationScenarioKind = (typeof MUTATION_SCENARIO_KINDS)[number];
type MutationReadIntent = 'render-changed-window' | 'preserve-viewport';
type MutationProgressPhase = 'warmup' | 'sample';

interface BenchmarkCliOptions {
  filter?: RegExp;
  json: boolean;
  profile: BenchmarkProfileName;
}

interface BenchmarkWorkload {
  expandedFolders: readonly string[];
  fileCount: number;
  fileCountLabel: string;
  getPreparedFiles: () => readonly string[];
  label: string;
  name: BenchmarkWorkloadName;
  rawFiles: readonly string[];
  rootCount: number;
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
  total: number;
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
  p75: number;
  p99: number;
  ticks: number;
}

interface MitataBenchmarkResult {
  alias: string;
  runs: Array<{
    stats: MitataRunStats;
  }>;
}

interface MeasuredRunStats extends MitataRunStats {
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
  generatedAt: string;
  intent: string;
  kind: 'path-store-benchmark-run';
  profile: BenchmarkProfileName;
  results: MitataJsonResult;
  scenarios: ScenarioManifest[];
}

interface HumanBenchmarkRun {
  results: MitataJsonResult;
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

function parseArgs(argv: readonly string[]): BenchmarkCliOptions {
  let filter: RegExp | undefined;
  let json = false;
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
        '  --filter <regex>   Run only scenarios whose names match the regex'
      );
      console.log(
        '  --json             Emit a JSON wrapper with scenario metadata'
      );
      process.exit(0);
    }

    throw new Error(`Unknown benchmark argument: ${argument}`);
  }

  return { filter, json, profile };
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
    flattenEmptyDirectories: false,
    initialExpandedPaths: workload.expandedFolders,
    paths: workload.getPreparedFiles(),
    presorted: true,
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

function getMovedLeafPath(
  path: string,
  destinationDirectoryPath: string
): string {
  return `${destinationDirectoryPath}${splitPath(path).name}`;
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

function getHumanBenchmarkNameWidth(
  scenarios: readonly BenchmarkScenario[]
): number {
  let maxWidth = HUMAN_BENCHMARK_NAME_MIN_WIDTH;

  for (let index = 0; index < scenarios.length; index++) {
    const scenario = scenarios[index];
    if (scenario == null) {
      continue;
    }

    const prefix = `[${index + 1}/${scenarios.length}] `;
    maxWidth = Math.max(maxWidth, prefix.length + scenario.name.length);
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
      `${'benchmark'.padEnd(nameWidth)} ${'avg'.padStart(10)} ${'wall'.padStart(10)} ${'(min … max)'.padStart(25)} ${'p75 / p99'.padStart(24)} ${'samples'.padStart(10)}`,
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
  console.log(
    `${styleText('workloads:', ANSI.dim)} ${profile.workloadNames.join(', ')}`
  );
  console.log(
    `${styleText('filter:', ANSI.dim)} ${cliOptions.filter?.source ?? 'none'}`
  );
  console.log(
    `${styleText('samples:', ANSI.dim)} build=${formatCount(BUILD_SCENARIO_SAMPLE_COUNT)}, prepare/e2e=${formatCount(PREPARE_AND_E2E_SCENARIO_SAMPLE_COUNT)}, visible=${formatCount(VISIBLE_SCENARIO_SAMPLE_COUNT)}, mutation=${formatCount(MUTATION_SCENARIO_SAMPLE_COUNT)} (+ ${formatCount(MUTATION_SCENARIO_WARMUP_COUNT)} warmup, reused store)`
  );
  console.log(
    `${styleText('input mode:', ANSI.dim)} presorted for all scenarios except prepare/*`
  );
  console.log(
    `${styleText('boot:', ANSI.dim)} loading workloads and preparing scenarios...`
  );
  console.log('');
}

function printHumanBenchmarkPreparationSummary(
  selectedScenarioCount: number
): void {
  console.log(
    `${styleText('prepared:', ANSI.dim)} ${formatCount(selectedScenarioCount)} scenarios`
  );
  console.log(`${styleText('run:', ANSI.dim)} collecting timing samples...`);
  console.log('');
}

function printHumanBenchmarkRow(
  label: string,
  stats: MitataRunStats,
  wallTimeMs: number,
  nameWidth: number
): void {
  const row = [
    styleText(padBenchmarkLabel(label, nameWidth), ANSI.bold),
    styleText(formatHumanDurationCell(stats.avg), ANSI.green),
    styleText(formatHumanWallTimeCell(wallTimeMs), ANSI.cyan),
    styleText(
      ` (${formatHumanDurationCell(stats.min).trim()} … ${formatHumanDurationCell(stats.max).trim()})`.padStart(
        25
      ),
      ANSI.dim
    ),
    styleText(
      `${formatHumanDurationCell(stats.p75).trim()} / ${formatHumanDurationCell(stats.p99).trim()}`.padStart(
        24
      ),
      ANSI.dim
    ),
    styleText(formatHumanSamplesCell(stats.ticks), ANSI.dim),
  ].join(' ');

  console.log(row);
}

function printHumanPreparationProgress(
  index: number,
  total: number,
  scenarioName: string
): void {
  console.log(
    `${styleText('· prepare', ANSI.dim)} [${index}/${total}] ${scenarioName}`
  );
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

function formatHumanWaitIndicator(frame: number): string {
  return WAIT_INDICATOR_FRAMES[frame % WAIT_INDICATOR_FRAMES.length] ?? '.  ';
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

  const startedAt = performance.now();
  let frame = 0;
  let latestProgress: ScenarioProgress | undefined;

  const render = (): void => {
    const elapsedMs = performance.now() - startedAt;
    const prefix = `${styleText('› run', ANSI.dim)} [${index}/${total}] ${padBenchmarkLabel(
      scenarioName,
      HUMAN_PROGRESS_LABEL_WIDTH
    )}`;
    const progressLabel =
      latestProgress == null
        ? 'sampling'
        : `${latestProgress.phase} ${latestProgress.completed}/${latestProgress.total}`;
    const waitIndicator = formatHumanWaitIndicator(frame);

    clearHumanLiveLine();
    process.stdout.write(
      `${styleText(waitIndicator, ANSI.cyan)} ${prefix} ${styleText(
        formatDuration(elapsedMs * 1_000_000).padStart(10),
        ANSI.cyan
      )} ${styleText(progressLabel, ANSI.dim)}`
    );
    frame++;
  };

  render();
  const intervalId = setInterval(render, 80);

  return {
    stop() {
      clearInterval(intervalId);
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
    p75: stats.p75,
    p99: stats.p99,
    ticks: stats.ticks,
  };
}

function createBenchmarkResult(
  alias: string,
  stats: MeasuredRunStats
): MitataBenchmarkResult {
  return {
    alias,
    runs: [
      {
        stats: sanitizeMeasuredRunStats(stats),
      },
    ],
  };
}

async function runBenchmarksForJson(
  scenarios: readonly BenchmarkScenario[]
): Promise<MitataJsonResult> {
  const results = await measureScenariosSequentially(scenarios);

  return {
    benchmarks: results.map((result) =>
      createBenchmarkResult(result.name, result.stats)
    ),
    context: getBenchmarkContext(),
    layout: [{ name: null, types: [] }],
  };
}

async function measureWithFixedSamples(
  target: unknown,
  category: ScenarioCategory,
  options: {
    innerGc?: boolean;
  } = {}
): Promise<MeasuredRunStats> {
  return (await measure(target as never, {
    inner_gc: options.innerGc === true,
    max_samples: getScenarioSampleCount(category),
    min_cpu_time: 0,
    min_samples: getScenarioSampleCount(category),
  })) as MeasuredRunStats;
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
    p75: getPercentile(sortedSamples, 0.75),
    p99: getPercentile(sortedSamples, 0.99),
    samples: sortedSamples,
    ticks: sortedSamples.length,
  };
}

interface ReusedStoreMutationMeasurement {
  apply: (store: PathStore) => unknown;
  createStore: () => PathStore;
  reset: (store: PathStore) => void;
}

// Interactive edits happen against one long-lived store, so mutation timings
// should reuse that store and only reset state between timed iterations.
function measureMutationWithReusedStore(
  measurement: ReusedStoreMutationMeasurement,
  progressReporter?: ((progress: ScenarioProgress) => void) | undefined
): MeasuredRunStats {
  const store = measurement.createStore();
  const timings: number[] = [];

  for (
    let iteration = 0;
    iteration < MUTATION_SCENARIO_WARMUP_COUNT + MUTATION_SCENARIO_SAMPLE_COUNT;
    iteration++
  ) {
    const startTime = process.hrtime.bigint();
    const result = measurement.apply(store);
    const endTime = process.hrtime.bigint();

    do_not_optimize(result);
    measurement.reset(store);
    progressReporter?.(
      iteration < MUTATION_SCENARIO_WARMUP_COUNT
        ? {
            completed: iteration + 1,
            phase: 'warmup',
            total: MUTATION_SCENARIO_WARMUP_COUNT,
          }
        : {
            completed: iteration + 1 - MUTATION_SCENARIO_WARMUP_COUNT,
            phase: 'sample',
            total: MUTATION_SCENARIO_SAMPLE_COUNT,
          }
    );

    if (iteration >= MUTATION_SCENARIO_WARMUP_COUNT) {
      timings.push(Number(endTime - startTime));
    }
  }

  return summarizeSamples(timings);
}

async function runBenchmarksForHuman(
  scenarios: readonly BenchmarkScenario[]
): Promise<HumanBenchmarkRun> {
  const context = getBenchmarkContext();
  const nameWidth = getHumanBenchmarkNameWidth(scenarios);

  printHumanBenchmarkHeader(context, scenarios.length, nameWidth);

  const results: Array<{
    name: string;
    stats: MeasuredRunStats;
    wallTimeMs: number;
  }> = [];

  for (let index = 0; index < scenarios.length; index++) {
    const scenario = scenarios[index];
    if (scenario == null) {
      continue;
    }

    const progress = createHumanLiveMeasurementProgress(
      index + 1,
      scenarios.length,
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
        stats,
        wallTimeMs,
      };
      results.push(result);
      printHumanBenchmarkRow(
        `[${index + 1}/${scenarios.length}] ${result.name}`,
        result.stats,
        result.wallTimeMs,
        nameWidth
      );
    } catch (error) {
      progress.stop();
      throw error;
    }
  }

  return {
    results: {
      benchmarks: results.map((result) =>
        createBenchmarkResult(result.name, result.stats)
      ),
      context,
      layout: [{ name: null, types: [] }],
    },
  };
}

function loadWorkload(workloadName: BenchmarkWorkloadName): BenchmarkWorkload {
  const workload = getVirtualizationWorkload(workloadName);
  let preparedFiles: readonly string[] | undefined;

  return {
    expandedFolders: workload.expandedFolders,
    fileCount: workload.files.length,
    fileCountLabel: workload.fileCountLabel,
    getPreparedFiles() {
      preparedFiles ??= PathStore.preparePaths(workload.files);
      return preparedFiles;
    },
    label: workload.label,
    name: workloadName,
    rawFiles: workload.files,
    rootCount: workload.rootCount,
  };
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
        measure() {
          return measureWithFixedSamples(
            () => do_not_optimize(PathStore.preparePaths(workload.rawFiles)),
            'prepare'
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
      const previewStore = createExpandedStore(workload);

      return {
        manifest: {
          category: 'build',
          fileCount: workload.fileCount,
          name,
          visibleCount: previewStore.getVisibleCount(),
          workload: workload.name,
        },
        measure() {
          return measureWithFixedSamples(
            () => {
              const store = createExpandedStore(workload);
              return do_not_optimize(store.getNodeCount());
            },
            'build',
            { innerGc: true }
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
        measure() {
          return measureWithFixedSamples(
            () => do_not_optimize(readVisibleWindow(store, bounds)),
            'visible'
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
        measure() {
          return measureWithFixedSamples(
            () => {
              const store = createExpandedStore(workload);
              const nextBounds = getWindowBounds(store, viewport, windowSize);
              return do_not_optimize(readVisibleWindow(store, nextBounds));
            },
            'e2e',
            { innerGc: true }
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
      const movedPath = getMovedLeafPath(targetPath, destinationDirectory.path);

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
    }

    if (profile.includeBuild) {
      factories.push(createBuildScenarioFactory(workload));
    }

    for (const windowSize of profile.visibleWindowSizes) {
      for (const viewport of VIEWPORT_MODES) {
        factories.push(
          createVisibleScenarioFactory(workload, viewport, windowSize)
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
          case 'add-sibling':
            factories.push(createAddSiblingScenarioFactory(workload, viewport));
            break;
          case 'move-leaf':
            factories.push(createMoveLeafScenarioFactory(workload, viewport));
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

  return factories;
}

const cliOptions = parseArgs(process.argv.slice(2));
const profile = resolveProfile(cliOptions);

if (!cliOptions.json) {
  printHumanBenchmarkBootBanner(cliOptions, profile);
}

const workloads: BenchmarkWorkload[] = profile.workloadNames.map(loadWorkload);
const scenarioFactories = createScenarioFactories(profile, workloads);
const selectedFactories = scenarioFactories.filter((factory) =>
  cliOptions.filter == null ? true : cliOptions.filter.test(factory.name)
);

if (selectedFactories.length === 0) {
  throw new Error('No benchmark scenarios matched the provided filter.');
}

const scenarios: BenchmarkScenario[] = [];

for (let index = 0; index < selectedFactories.length; index++) {
  const factory = selectedFactories[index];
  if (factory == null) {
    continue;
  }

  if (!cliOptions.json) {
    printHumanPreparationProgress(
      index + 1,
      selectedFactories.length,
      factory.name
    );
  }

  scenarios.push(factory.build());
}

if (cliOptions.json) {
  const runOutput: BenchmarkRunOutput = {
    generatedAt: new Date().toISOString(),
    intent: BENCHMARK_INTENT,
    kind: 'path-store-benchmark-run',
    profile: profile.name,
    results: await runBenchmarksForJson(scenarios),
    scenarios: scenarios.map((scenario) => scenario.manifest),
  };

  console.log(JSON.stringify(runOutput));
} else {
  printHumanBenchmarkPreparationSummary(selectedFactories.length);
  const humanRun = await runBenchmarksForHuman(scenarios);
  console.log('');
  console.log(
    `${styleText('Completed', ANSI.green, ANSI.bold)} ${formatCount(humanRun.results.benchmarks.length)} scenarios. Use --json for detailed scenario metadata.`
  );
}
