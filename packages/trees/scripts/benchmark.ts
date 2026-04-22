import { getVirtualizationWorkload } from '@pierre/tree-test-data';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { preparePresortedFileTreeInput } from '../src/index';
import { FileTreeController } from '../src/model/FileTreeController';
import {
  computeFileTreeLayout,
  computeStickyRows,
  type FileTreeLayoutSnapshot,
  type FileTreeLayoutStickyRow,
} from '../src/model/fileTreeLayout';
import type {
  FileTreeStickyRowCandidate,
  FileTreeVisibleRow,
} from '../src/model/types';

const PRESET_NAMES = ['get-item', 'sticky-scroll', 'all'] as const;
const DEFAULT_PRESET: BenchmarkPresetName = 'get-item';
const DEFAULT_SAMPLE_COUNT = 8;
const DEFAULT_WARMUP_COUNT = 1;
const COLD_SAMPLE_COUNT = 3;
const ITEM_HEIGHT = 30;
const VIEWPORT_HEIGHT = 700;
const OVERSCAN = 10;
const WINDOW_ROW_COUNT =
  Math.ceil(VIEWPORT_HEIGHT / ITEM_HEIGHT) + OVERSCAN * 2;
const HUMAN_NAME_MIN_WIDTH = 36;
const HUMAN_NAME_MAX_WIDTH = 76;

type BenchmarkPresetName = (typeof PRESET_NAMES)[number];

interface BenchmarkCliOptions {
  filter?: RegExp;
  includeSamples: boolean;
  json: boolean;
  preset: BenchmarkPresetName;
  sampleCountOverride?: number;
}

interface BenchmarkStats {
  avg: number;
  max: number;
  min: number;
  p50: number;
  p75: number;
  p95: number;
  p99: number;
  samples?: readonly number[];
  ticks: number;
}

interface BenchmarkManifest {
  category: 'get-item' | 'sticky-scroll';
  fileCount: number;
  name: string;
  notes?: readonly string[];
  visibleCount?: number;
  workload: 'aosp' | 'linux-5x';
}

interface BenchmarkRunOutput {
  generatedAt: string;
  kind: 'trees-benchmark-run';
  preset: BenchmarkPresetName;
  results: BenchmarkResult[];
}

interface BenchmarkResult {
  manifest: BenchmarkManifest;
  name: string;
  preparationTimeMs: number;
  stats: BenchmarkStats;
  wallTimeMs: number;
}

interface BuiltBenchmarkScenario {
  createSample?: () => unknown;
  destroy?: () => void;
  destroySample?: (sample: unknown) => void;
  manifest: BenchmarkManifest;
  measure: (sample: unknown, sampleIndex: number) => unknown;
  sampleCount: number;
  warmupCount: number;
}

interface BenchmarkScenarioFactory {
  build: () => BuiltBenchmarkScenario;
  name: string;
}

interface AospBenchmarkWorkload {
  allExpandedPaths: readonly string[];
  fileCount: number;
  paths: readonly string[];
  preparedInput: ReturnType<typeof preparePresortedFileTreeInput>;
}

interface FileTreeViewLayoutBenchmarkState {
  overlayHeight: number;
  overlayRows: readonly FileTreeLayoutStickyRow<FileTreeVisibleRow>[];
  snapshot: FileTreeLayoutSnapshot<FileTreeVisibleRow>;
  visibleRows: readonly FileTreeVisibleRow[];
}

interface AospBenchmarkSample {
  controller: FileTreeController;
}

let sink = 0;
let cachedAospWorkload: AospBenchmarkWorkload | null = null;

function parseArgs(argv: readonly string[]): BenchmarkCliOptions {
  let filter: RegExp | undefined;
  let includeSamples = false;
  let json = false;
  let preset = DEFAULT_PRESET;
  let sampleCountOverride: number | undefined;

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];

    if (argument === '--') {
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

    if (argument === '--json') {
      json = true;
      continue;
    }

    if (argument === '--preset') {
      const value = argv[index + 1];
      if (value == null || value.length === 0) {
        throw new Error('Expected a value after --preset');
      }
      if (!(PRESET_NAMES as readonly string[]).includes(value)) {
        throw new Error(
          `Unknown benchmark preset: ${value}. Expected one of: ${PRESET_NAMES.join(', ')}`
        );
      }
      preset = value as BenchmarkPresetName;
      index++;
      continue;
    }

    if (argument === '--sample-count') {
      const value = argv[index + 1];
      if (value == null || value.length === 0) {
        throw new Error('Expected a value after --sample-count');
      }
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(
          `Invalid --sample-count value: ${value}. Expected a positive integer.`
        );
      }
      sampleCountOverride = parsed;
      index++;
      continue;
    }

    if (argument === '--samples') {
      includeSamples = true;
      continue;
    }

    if (argument === '--help') {
      console.log('Usage: bun ws trees benchmark -- [options]');
      console.log('');
      console.log('Options:');
      console.log(
        `  --preset <name>       Benchmark preset (${PRESET_NAMES.join(', ')}; default ${DEFAULT_PRESET})`
      );
      console.log('  --filter <regex>      Run only matching scenarios');
      console.log('  --sample-count <n>    Override timed sample count');
      console.log('  --json                Emit machine-readable JSON');
      console.log('  --samples             Include raw timing samples in JSON');
      process.exit(0);
    }

    throw new Error(`Unknown benchmark argument: ${argument}`);
  }

  return {
    filter,
    includeSamples,
    json,
    preset,
    sampleCountOverride,
  };
}

function getRepoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
}

function readAospFixture(): {
  allExpandedPaths: readonly string[];
  paths: readonly string[];
} {
  const fixturePath = resolve(
    getRepoRoot(),
    'apps/docs/public/trees-dev/aosp-files.json.gz'
  );
  if (!existsSync(fixturePath)) {
    throw new Error(
      `Missing AOSP benchmark fixture at ${fixturePath}. Run apps/docs/scripts/generateAospArtifacts.ts first.`
    );
  }

  const rawPayload = JSON.parse(
    gunzipSync(readFileSync(fixturePath)).toString('utf8')
  ) as {
    allExpandedPaths?: unknown;
    paths?: unknown;
  };

  if (
    !Array.isArray(rawPayload.paths) ||
    !Array.isArray(rawPayload.allExpandedPaths)
  ) {
    throw new Error(
      `Invalid AOSP benchmark fixture at ${fixturePath}: expected paths and allExpandedPaths arrays.`
    );
  }

  return {
    allExpandedPaths: rawPayload.allExpandedPaths as readonly string[],
    paths: rawPayload.paths as readonly string[],
  };
}

function loadAospWorkload(): AospBenchmarkWorkload {
  if (cachedAospWorkload != null) {
    return cachedAospWorkload;
  }

  const { allExpandedPaths, paths } = readAospFixture();
  cachedAospWorkload = {
    allExpandedPaths,
    fileCount: paths.length,
    paths,
    preparedInput: preparePresortedFileTreeInput(paths),
  };
  return cachedAospWorkload;
}

function createAospController(
  workload: AospBenchmarkWorkload
): FileTreeController {
  return new FileTreeController({
    flattenEmptyDirectories: true,
    initialExpandedPaths: workload.allExpandedPaths,
    preparedInput: workload.preparedInput,
  });
}

function createAospScrollTops(visibleCount: number): readonly number[] {
  const maxScrollableIndex = Math.max(0, visibleCount - WINDOW_ROW_COUNT);
  const indices = [
    1,
    Math.floor(maxScrollableIndex * 0.05),
    Math.floor(maxScrollableIndex * 0.25),
    Math.floor(maxScrollableIndex * 0.5),
    Math.floor(maxScrollableIndex * 0.75),
    Math.floor(maxScrollableIndex * 0.95),
  ];
  return indices.map((index) => Math.max(0, index) * ITEM_HEIGHT);
}

function computeStickyRowsFromCandidates(
  candidates: readonly FileTreeStickyRowCandidate[],
  scrollTop: number,
  itemHeight: number,
  totalRowCount: number
): readonly FileTreeLayoutStickyRow<FileTreeVisibleRow>[] {
  return candidates
    .map((candidate, slotDepth) => {
      const defaultTop = slotDepth * itemHeight;
      const nextBoundaryIndex = candidate.subtreeEndIndex + 1;
      if (nextBoundaryIndex >= totalRowCount) {
        return { row: candidate.row, top: defaultTop };
      }

      const nextBoundaryTop = nextBoundaryIndex * itemHeight - scrollTop;
      return {
        row: candidate.row,
        top: Math.min(defaultTop, nextBoundaryTop - itemHeight),
      };
    })
    .filter((entry) => entry.top + itemHeight > 0);
}

// Mirrors the virtualized view's scroll-layout update so the benchmark measures
// the same full-row materialization and sticky-row derivation that hurt traces.
function computeFileTreeViewLayoutBenchmarkState({
  controller,
  scrollTop,
  stickyFolders,
}: {
  controller: FileTreeController;
  scrollTop: number;
  stickyFolders: boolean;
}): FileTreeViewLayoutBenchmarkState {
  const visibleCount = controller.getVisibleCount();
  const stickyCandidates =
    stickyFolders && visibleCount > 0
      ? controller.getStickyRowCandidates(scrollTop, ITEM_HEIGHT)
      : [];
  const visibleRows =
    stickyCandidates == null && stickyFolders && visibleCount > 0
      ? controller.getVisibleRows(0, visibleCount - 1)
      : [];
  const stickyRows =
    stickyCandidates == null
      ? undefined
      : computeStickyRowsFromCandidates(
          stickyCandidates,
          scrollTop,
          ITEM_HEIGHT,
          visibleCount
        );
  const snapshot = computeFileTreeLayout(visibleRows, {
    itemHeight: ITEM_HEIGHT,
    overscan: OVERSCAN,
    scrollTop,
    stickyRows,
    totalRowCount: visibleCount,
    viewportHeight: VIEWPORT_HEIGHT,
  });

  const previewStickyCandidates =
    stickyFolders && scrollTop <= 0 && visibleCount > 0
      ? controller.getStickyRowCandidates(1, ITEM_HEIGHT)
      : [];
  const overlayRows =
    previewStickyCandidates != null && scrollTop <= 0
      ? computeStickyRowsFromCandidates(
          previewStickyCandidates,
          1,
          ITEM_HEIGHT,
          visibleCount
        )
      : stickyFolders && scrollTop <= 0 && visibleRows.length > 0
        ? computeStickyRows(visibleRows, 1, ITEM_HEIGHT)
        : snapshot.sticky.rows;
  const overlayHeight = overlayRows.reduce(
    (maxBottom, entry) => Math.max(maxBottom, entry.top + ITEM_HEIGHT),
    0
  );

  return {
    overlayHeight,
    overlayRows,
    snapshot,
    visibleRows,
  };
}

function computeStickyViewUpdateWindowRead(
  controller: FileTreeController,
  scrollTop: number
): {
  overlayRows: readonly FileTreeLayoutStickyRow<FileTreeVisibleRow>[];
  rows: readonly FileTreeVisibleRow[];
  snapshot: FileTreeLayoutSnapshot<FileTreeVisibleRow>;
} {
  const layoutState = computeFileTreeViewLayoutBenchmarkState({
    controller,
    scrollTop,
    stickyFolders: true,
  });
  const { snapshot } = layoutState;
  const stickyPathSet = new Set(
    layoutState.snapshot.sticky.rows.map((entry) => entry.row.path)
  );
  const rows =
    snapshot.window.endIndex < snapshot.window.startIndex
      ? []
      : controller
          .getVisibleRows(snapshot.window.startIndex, snapshot.window.endIndex)
          .filter((row) => !stickyPathSet.has(row.path));

  return {
    overlayRows: layoutState.overlayRows,
    rows,
    snapshot,
  };
}

function computeStickyScrollSequenceWindowRead(
  controller: FileTreeController,
  scrollTops: readonly number[]
): {
  dispatches: number;
  rows: number;
  stickyRows: number;
  totalRows: number;
} {
  let rows = 0;
  let stickyRows = 0;
  let totalRows = 0;

  for (const scrollTop of scrollTops) {
    const update = computeStickyViewUpdateWindowRead(controller, scrollTop);
    rows += update.rows.length;
    stickyRows += update.overlayRows.length;
    totalRows += update.snapshot.physical.totalRowCount;
  }

  return {
    dispatches: scrollTops.length,
    rows,
    stickyRows,
    totalRows,
  };
}

function computeNoStickyWindowRead(
  controller: FileTreeController,
  scrollTop: number
): {
  rows: readonly FileTreeVisibleRow[];
  snapshot: FileTreeLayoutSnapshot<FileTreeVisibleRow>;
} {
  const visibleCount = controller.getVisibleCount();
  const snapshot = computeFileTreeLayout([], {
    itemHeight: ITEM_HEIGHT,
    overscan: OVERSCAN,
    scrollTop,
    totalRowCount: visibleCount,
    viewportHeight: VIEWPORT_HEIGHT,
  });
  const rows =
    snapshot.window.endIndex < snapshot.window.startIndex
      ? []
      : controller.getVisibleRows(
          snapshot.window.startIndex,
          snapshot.window.endIndex
        );

  return {
    rows,
    snapshot,
  };
}

function consume(value: unknown): void {
  if (value == null) {
    sink += 1;
    return;
  }

  if (typeof value === 'number') {
    sink += value;
    return;
  }

  if (Array.isArray(value)) {
    sink += value.length;
    return;
  }

  if (typeof value !== 'object') {
    sink += 1;
    return;
  }

  const maybeRows = value as {
    overlayRows?: readonly unknown[];
    rows?: readonly unknown[];
    snapshot?: { physical?: { totalRowCount?: number } };
    visibleRows?: readonly unknown[];
  };
  sink += maybeRows.rows?.length ?? 0;
  sink += maybeRows.visibleRows?.length ?? 0;
  sink += maybeRows.overlayRows?.length ?? 0;
  sink += maybeRows.snapshot?.physical?.totalRowCount ?? 0;
}

function percentile(sortedValues: readonly number[], pct: number): number {
  if (sortedValues.length === 0) {
    return 0;
  }
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil((pct / 100) * sortedValues.length) - 1)
  );
  return sortedValues[index] ?? 0;
}

function summarizeSamples(samples: readonly number[]): BenchmarkStats {
  const sortedValues = [...samples].sort((left, right) => left - right);
  const total = samples.reduce((sum, sample) => sum + sample, 0);

  return {
    avg: samples.length === 0 ? 0 : total / samples.length,
    max: sortedValues.at(-1) ?? 0,
    min: sortedValues[0] ?? 0,
    p50: percentile(sortedValues, 50),
    p75: percentile(sortedValues, 75),
    p95: percentile(sortedValues, 95),
    p99: percentile(sortedValues, 99),
    ticks: samples.length,
  };
}

function measureScenario(
  factory: BenchmarkScenarioFactory,
  options: BenchmarkCliOptions
): BenchmarkResult {
  const preparationStartedAt = performance.now();
  const scenario = factory.build();
  const preparationTimeMs = performance.now() - preparationStartedAt;
  const warmupCount = scenario.warmupCount;
  const sampleCount = options.sampleCountOverride ?? scenario.sampleCount;

  for (let index = 0; index < warmupCount; index++) {
    const sample = scenario.createSample?.();
    try {
      consume(scenario.measure(sample, index));
    } finally {
      if (sample !== undefined) {
        scenario.destroySample?.(sample);
      }
    }
  }

  const samples: number[] = [];
  const measurementStartedAt = performance.now();
  try {
    for (let index = 0; index < sampleCount; index++) {
      const sample = scenario.createSample?.();
      try {
        const startedAt = process.hrtime.bigint();
        const result = scenario.measure(sample, index);
        const endedAt = process.hrtime.bigint();
        consume(result);
        samples.push(Number(endedAt - startedAt));
      } finally {
        if (sample !== undefined) {
          scenario.destroySample?.(sample);
        }
      }
    }
  } finally {
    scenario.destroy?.();
  }

  const stats = summarizeSamples(samples);
  if (options.includeSamples) {
    stats.samples = samples;
  }

  return {
    manifest: scenario.manifest,
    name: factory.name,
    preparationTimeMs,
    stats,
    wallTimeMs: performance.now() - measurementStartedAt,
  };
}

function createGetItemScenarioFactory(): BenchmarkScenarioFactory {
  const name = 'get-item/linux-5x';

  return {
    name,
    build() {
      const workload = getVirtualizationWorkload('linux-5x');
      const preparedInput = preparePresortedFileTreeInput(workload.files);
      const controller = new FileTreeController({
        flattenEmptyDirectories: true,
        initialExpandedPaths: workload.expandedFolders,
        preparedInput,
      });
      const fileHitPaths = workload.files.slice(0, 2_000);
      const directoryAliasHitPaths = workload.expandedFolders.slice(0, 2_000);
      const directoryCanonicalHitPaths = directoryAliasHitPaths.map(
        (path) => `${path}/`
      );
      const missPaths = fileHitPaths.map(
        (path, index) => `${path}.missing-${index.toString(36)}`
      );
      const pathSets = [
        fileHitPaths,
        directoryAliasHitPaths,
        directoryCanonicalHitPaths,
        missPaths,
      ];

      return {
        destroy() {
          controller.destroy();
        },
        manifest: {
          category: 'get-item',
          fileCount: workload.files.length,
          name,
          notes: [
            'Runs file hits, directory alias hits, canonical directory hits, and misses.',
          ],
          visibleCount: controller.getVisibleCount(),
          workload: 'linux-5x',
        },
        measure(_sample, sampleIndex) {
          const paths = pathSets[sampleIndex % pathSets.length] ?? fileHitPaths;
          for (const path of paths) {
            consume(controller.getItem(path));
          }
          return paths.length;
        },
        sampleCount: DEFAULT_SAMPLE_COUNT,
        warmupCount: DEFAULT_WARMUP_COUNT,
      };
    },
  };
}

function createStickyFullLayoutWarmScenarioFactory(): BenchmarkScenarioFactory {
  const name = 'sticky-scroll/full-layout/aosp/warm';

  return {
    name,
    build() {
      const workload = loadAospWorkload();
      const controller = createAospController(workload);
      const visibleCount = controller.getVisibleCount();
      const scrollTops = createAospScrollTops(visibleCount);
      computeFileTreeViewLayoutBenchmarkState({
        controller,
        scrollTop: scrollTops[0] ?? ITEM_HEIGHT,
        stickyFolders: true,
      });

      return {
        destroy() {
          controller.destroy();
        },
        manifest: {
          category: 'sticky-scroll',
          fileCount: workload.fileCount,
          name,
          notes: [
            'Reused controller; mirrors one scroll-layout update with sticky folders enabled.',
          ],
          visibleCount,
          workload: 'aosp',
        },
        measure(_sample, sampleIndex) {
          return computeFileTreeViewLayoutBenchmarkState({
            controller,
            scrollTop:
              scrollTops[sampleIndex % scrollTops.length] ?? ITEM_HEIGHT,
            stickyFolders: true,
          });
        },
        sampleCount: DEFAULT_SAMPLE_COUNT,
        warmupCount: DEFAULT_WARMUP_COUNT,
      };
    },
  };
}

function createStickyViewUpdateWindowReadScenarioFactory(): BenchmarkScenarioFactory {
  const name = 'sticky-scroll/view-update-plus-window-rows/aosp/warm';

  return {
    name,
    build() {
      const workload = loadAospWorkload();
      const controller = createAospController(workload);
      const visibleCount = controller.getVisibleCount();
      const scrollTops = createAospScrollTops(visibleCount);
      computeStickyViewUpdateWindowRead(
        controller,
        scrollTops[0] ?? ITEM_HEIGHT
      );

      return {
        destroy() {
          controller.destroy();
        },
        manifest: {
          category: 'sticky-scroll',
          fileCount: workload.fileCount,
          name,
          notes: [
            'Mirrors one warm sticky scroll update plus the mounted window row fetch/filter used by rendering.',
          ],
          visibleCount,
          workload: 'aosp',
        },
        measure(_sample, sampleIndex) {
          return computeStickyViewUpdateWindowRead(
            controller,
            scrollTops[sampleIndex % scrollTops.length] ?? ITEM_HEIGHT
          );
        },
        sampleCount: DEFAULT_SAMPLE_COUNT,
        warmupCount: DEFAULT_WARMUP_COUNT,
      };
    },
  };
}

function createStickyViewUpdateWindowReadColdProjectionScenarioFactory(): BenchmarkScenarioFactory {
  const name =
    'sticky-scroll/view-update-plus-window-rows/aosp/cold-projection';

  return {
    name,
    build() {
      const workload = loadAospWorkload();
      const previewController = createAospController(workload);
      const visibleCount = previewController.getVisibleCount();
      const scrollTops = createAospScrollTops(visibleCount);
      previewController.destroy();

      return {
        createSample() {
          return {
            controller: createAospController(workload),
          } satisfies AospBenchmarkSample;
        },
        destroySample(sample) {
          (sample as AospBenchmarkSample).controller.destroy();
        },
        manifest: {
          category: 'sticky-scroll',
          fileCount: workload.fileCount,
          name,
          notes: [
            'Fresh controller per sample; includes first sticky layout and mounted window row fetch/filter.',
          ],
          visibleCount,
          workload: 'aosp',
        },
        measure(sample, sampleIndex) {
          return computeStickyViewUpdateWindowRead(
            (sample as AospBenchmarkSample).controller,
            scrollTops[sampleIndex % scrollTops.length] ?? ITEM_HEIGHT
          );
        },
        sampleCount: COLD_SAMPLE_COUNT,
        warmupCount: 0,
      };
    },
  };
}

function createStickyScrollSequenceWindowReadScenarioFactory(): BenchmarkScenarioFactory {
  const name = 'sticky-scroll/scroll-sequence-plus-window-rows/aosp/warm';

  return {
    name,
    build() {
      const workload = loadAospWorkload();
      const controller = createAospController(workload);
      const visibleCount = controller.getVisibleCount();
      const baseScrollTops = createAospScrollTops(visibleCount);
      const scrollTops = [
        ...baseScrollTops,
        ...baseScrollTops.map((scrollTop) => scrollTop + ITEM_HEIGHT / 2),
        ...baseScrollTops.slice(0, 2).map((scrollTop) => scrollTop + 1),
      ];
      computeStickyScrollSequenceWindowRead(controller, scrollTops);

      return {
        destroy() {
          controller.destroy();
        },
        manifest: {
          category: 'sticky-scroll',
          fileCount: workload.fileCount,
          name,
          notes: [
            'Runs a 14-dispatch sticky scroll sequence including mounted window row fetch/filter to validate repeated app-like updates stay off the full-tree path.',
          ],
          visibleCount,
          workload: 'aosp',
        },
        measure() {
          return computeStickyScrollSequenceWindowRead(controller, scrollTops);
        },
        sampleCount: DEFAULT_SAMPLE_COUNT,
        warmupCount: DEFAULT_WARMUP_COUNT,
      };
    },
  };
}

function createStickyFullLayoutColdProjectionScenarioFactory(): BenchmarkScenarioFactory {
  const name = 'sticky-scroll/full-layout/aosp/cold-projection';

  return {
    name,
    build() {
      const workload = loadAospWorkload();
      const previewController = createAospController(workload);
      const visibleCount = previewController.getVisibleCount();
      const scrollTops = createAospScrollTops(visibleCount);
      previewController.destroy();

      return {
        createSample() {
          return {
            controller: createAospController(workload),
          } satisfies AospBenchmarkSample;
        },
        destroySample(sample) {
          (sample as AospBenchmarkSample).controller.destroy();
        },
        manifest: {
          category: 'sticky-scroll',
          fileCount: workload.fileCount,
          name,
          notes: [
            'Fresh controller per sample; timed region excludes store construction but includes first full projection.',
          ],
          visibleCount,
          workload: 'aosp',
        },
        measure(sample, sampleIndex) {
          return computeFileTreeViewLayoutBenchmarkState({
            controller: (sample as AospBenchmarkSample).controller,
            scrollTop:
              scrollTops[sampleIndex % scrollTops.length] ?? ITEM_HEIGHT,
            stickyFolders: true,
          });
        },
        sampleCount: COLD_SAMPLE_COUNT,
        warmupCount: 0,
      };
    },
  };
}

function createStickyGetVisibleRowsFullScenarioFactory(): BenchmarkScenarioFactory {
  const name = 'sticky-scroll/get-visible-rows-full/aosp/warm';

  return {
    name,
    build() {
      const workload = loadAospWorkload();
      const controller = createAospController(workload);
      const visibleCount = controller.getVisibleCount();
      controller.getVisibleRows(0, visibleCount - 1);

      return {
        destroy() {
          controller.destroy();
        },
        manifest: {
          category: 'sticky-scroll',
          fileCount: workload.fileCount,
          name,
          notes: [
            'Measures full visible-row materialization after the projection is already warm.',
          ],
          visibleCount,
          workload: 'aosp',
        },
        measure() {
          return controller.getVisibleRows(0, visibleCount - 1);
        },
        sampleCount: DEFAULT_SAMPLE_COUNT,
        warmupCount: DEFAULT_WARMUP_COUNT,
      };
    },
  };
}

function createStickyGetVisibleRowsWindowScenarioFactory(): BenchmarkScenarioFactory {
  const name = 'sticky-scroll/get-visible-rows-window/aosp/warm';

  return {
    name,
    build() {
      const workload = loadAospWorkload();
      const controller = createAospController(workload);
      const visibleCount = controller.getVisibleCount();
      const scrollTops = createAospScrollTops(visibleCount);

      return {
        destroy() {
          controller.destroy();
        },
        manifest: {
          category: 'sticky-scroll',
          fileCount: workload.fileCount,
          name,
          notes: ['Measures the O(window) row fetch target for comparison.'],
          visibleCount,
          workload: 'aosp',
        },
        measure(_sample, sampleIndex) {
          const start = Math.floor(
            (scrollTops[sampleIndex % scrollTops.length] ?? 0) / ITEM_HEIGHT
          );
          return controller.getVisibleRows(
            start,
            Math.min(visibleCount - 1, start + WINDOW_ROW_COUNT - 1)
          );
        },
        sampleCount: DEFAULT_SAMPLE_COUNT,
        warmupCount: DEFAULT_WARMUP_COUNT,
      };
    },
  };
}

function createStickyLayoutFromFullRowsScenarioFactory(): BenchmarkScenarioFactory {
  const name = 'sticky-scroll/compute-layout-sticky-full-rows/aosp/warm';

  return {
    name,
    build() {
      const workload = loadAospWorkload();
      const controller = createAospController(workload);
      const visibleCount = controller.getVisibleCount();
      const visibleRows = controller.getVisibleRows(0, visibleCount - 1);
      const scrollTops = createAospScrollTops(visibleCount);
      controller.destroy();

      return {
        manifest: {
          category: 'sticky-scroll',
          fileCount: workload.fileCount,
          name,
          notes: [
            'Measures sticky layout once full visible rows are already materialized.',
          ],
          visibleCount,
          workload: 'aosp',
        },
        measure(_sample, sampleIndex) {
          return computeFileTreeLayout(visibleRows, {
            itemHeight: ITEM_HEIGHT,
            overscan: OVERSCAN,
            scrollTop:
              scrollTops[sampleIndex % scrollTops.length] ?? ITEM_HEIGHT,
            totalRowCount: visibleCount,
            viewportHeight: VIEWPORT_HEIGHT,
          });
        },
        sampleCount: DEFAULT_SAMPLE_COUNT,
        warmupCount: DEFAULT_WARMUP_COUNT,
      };
    },
  };
}

function createNoStickyLayoutScenarioFactory(): BenchmarkScenarioFactory {
  const name = 'sticky-scroll/compute-layout-no-sticky/aosp/warm';

  return {
    name,
    build() {
      const workload = loadAospWorkload();
      const controller = createAospController(workload);
      const visibleCount = controller.getVisibleCount();
      const scrollTops = createAospScrollTops(visibleCount);
      controller.destroy();

      return {
        manifest: {
          category: 'sticky-scroll',
          fileCount: workload.fileCount,
          name,
          notes: [
            'Measures count-only virtual layout, the lower bound when sticky rows do not need full materialization.',
          ],
          visibleCount,
          workload: 'aosp',
        },
        measure(_sample, sampleIndex) {
          return computeFileTreeLayout([], {
            itemHeight: ITEM_HEIGHT,
            overscan: OVERSCAN,
            scrollTop:
              scrollTops[sampleIndex % scrollTops.length] ?? ITEM_HEIGHT,
            totalRowCount: visibleCount,
            viewportHeight: VIEWPORT_HEIGHT,
          });
        },
        sampleCount: DEFAULT_SAMPLE_COUNT,
        warmupCount: DEFAULT_WARMUP_COUNT,
      };
    },
  };
}

function createNoStickyWindowReadScenarioFactory(): BenchmarkScenarioFactory {
  const name = 'sticky-scroll/window-layout-plus-window-rows/aosp/warm';

  return {
    name,
    build() {
      const workload = loadAospWorkload();
      const controller = createAospController(workload);
      const visibleCount = controller.getVisibleCount();
      const scrollTops = createAospScrollTops(visibleCount);

      return {
        destroy() {
          controller.destroy();
        },
        manifest: {
          category: 'sticky-scroll',
          fileCount: workload.fileCount,
          name,
          notes: [
            'Combines count-only virtual layout with the mounted window row fetch.',
          ],
          visibleCount,
          workload: 'aosp',
        },
        measure(_sample, sampleIndex) {
          return computeNoStickyWindowRead(
            controller,
            scrollTops[sampleIndex % scrollTops.length] ?? ITEM_HEIGHT
          );
        },
        sampleCount: DEFAULT_SAMPLE_COUNT,
        warmupCount: DEFAULT_WARMUP_COUNT,
      };
    },
  };
}

function createScenarioFactories(): BenchmarkScenarioFactory[] {
  return [
    createGetItemScenarioFactory(),
    createStickyFullLayoutWarmScenarioFactory(),
    createStickyViewUpdateWindowReadScenarioFactory(),
    createStickyScrollSequenceWindowReadScenarioFactory(),
    createStickyFullLayoutColdProjectionScenarioFactory(),
    createStickyViewUpdateWindowReadColdProjectionScenarioFactory(),
    createStickyGetVisibleRowsFullScenarioFactory(),
    createStickyGetVisibleRowsWindowScenarioFactory(),
    createStickyLayoutFromFullRowsScenarioFactory(),
    createNoStickyLayoutScenarioFactory(),
    createNoStickyWindowReadScenarioFactory(),
  ];
}

function getPresetFilter(preset: BenchmarkPresetName): RegExp | undefined {
  switch (preset) {
    case 'all':
      return undefined;
    case 'get-item':
      return /^get-item\//;
    case 'sticky-scroll':
      return /^sticky-scroll\//;
  }
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

function getNameWidth(results: readonly { name: string }[]): number {
  let maxWidth = HUMAN_NAME_MIN_WIDTH;
  for (const result of results) {
    maxWidth = Math.max(maxWidth, result.name.length);
  }
  return Math.min(HUMAN_NAME_MAX_WIDTH, maxWidth);
}

function printHumanHeader(
  options: BenchmarkCliOptions,
  selectedFactories: readonly BenchmarkScenarioFactory[]
): void {
  console.log('trees benchmark');
  console.log(`preset: ${options.preset}`);
  console.log(`filter: ${options.filter?.source ?? 'none'}`);
  console.log(`scenarios: ${formatCount(selectedFactories.length)}`);
  console.log('');
}

function printHumanResults(results: readonly BenchmarkResult[]): void {
  const nameWidth = getNameWidth(results);
  console.log(
    `${'benchmark'.padEnd(nameWidth)} ${'p50'.padStart(10)} ${'p95'.padStart(10)} ${'min'.padStart(10)} ${'max'.padStart(10)} ${'prep'.padStart(10)} ${'wall'.padStart(10)} ${'samples'.padStart(8)}`
  );
  console.log('-'.repeat(nameWidth + 82));
  for (const result of results) {
    console.log(
      `${result.name.padEnd(nameWidth)} ${formatDuration(result.stats.p50).padStart(10)} ${formatDuration(result.stats.p95).padStart(10)} ${formatDuration(result.stats.min).padStart(10)} ${formatDuration(result.stats.max).padStart(10)} ${`${result.preparationTimeMs.toFixed(0)} ms`.padStart(10)} ${`${result.wallTimeMs.toFixed(0)} ms`.padStart(10)} ${formatCount(result.stats.ticks).padStart(8)}`
    );
  }
}

const cliOptions = parseArgs(process.argv.slice(2));
const presetFilter = getPresetFilter(cliOptions.preset);
const selectedFactories = createScenarioFactories().filter((factory) => {
  if (presetFilter != null && !presetFilter.test(factory.name)) {
    return false;
  }
  return cliOptions.filter == null || cliOptions.filter.test(factory.name);
});

if (selectedFactories.length === 0) {
  throw new Error('No benchmark scenarios matched the provided preset/filter.');
}

if (!cliOptions.json) {
  printHumanHeader(cliOptions, selectedFactories);
}

const results = selectedFactories.map((factory) =>
  measureScenario(factory, cliOptions)
);

if (cliOptions.json) {
  const output: BenchmarkRunOutput = {
    generatedAt: new Date().toISOString(),
    kind: 'trees-benchmark-run',
    preset: cliOptions.preset,
    results,
  };
  console.log(JSON.stringify(output));
} else {
  printHumanResults(results);
  console.log('');
  console.log(`Completed ${formatCount(results.length)} scenarios.`);
}

consume(sink);
