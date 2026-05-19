import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { FileDiffMetadata, HunkExpansionRegion } from '../src/types';
import { baseline_iterateOverDiff } from '../src/utils/baseline_iterateOverDiff';
import type {
  DiffLineCallbackProps,
  DiffLineRangeCallbackProps,
  IterateOverDiffProps,
} from '../src/utils/iterateOverDiff';
import { iterateOverDiff } from '../src/utils/iterateOverDiff';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';

export type DiffStyle = 'unified' | 'split' | 'both';

export type CallbackMode =
  | 'noop'
  | 'checksum'
  | 'highlighter-ingest'
  | 'renderer-postprocess'
  | 'layout-size'
  | 'line-position'
  | 'scroll-anchor'
  | 'render-range';

export type BenchmarkPreset = 'smoke' | 'standard' | 'exhaustive' | 'stress';

export interface FixtureSummary {
  rank: number;
  name: string;
  type: FileDiffMetadata['type'];
  hunks: number;
  changedLines: number;
  hunkSpan: number;
  unifiedLineCount: number;
  splitLineCount: number;
  additionLines: number;
  deletionLines: number;
}

export interface FixtureEntry {
  rank: number;
  summary: FixtureSummary;
  diff: FileDiffMetadata;
}

export interface IterateOverDiffFixture {
  benchmark: 'iterateOverDiff';
  sourcePatch: string;
  rankMetric: string;
  count: number;
  files: FixtureEntry[];
}

export interface BenchmarkFixture {
  id: string;
  label: string;
  source: 'real-patch' | 'synthetic';
  summary: FixtureSummary;
  diff: FileDiffMetadata;
}

export interface BenchmarkConfig {
  runs: number;
  warmupRuns: number;
  batchRuns: number;
  preset: BenchmarkPreset;
  outputJson: boolean;
  measureMemory: boolean;
  includeSynthetic: boolean;
  compareBaseline: boolean;
  memoryChildImplementation: BenchmarkImplementationId | undefined;
  memoryChildCaseIndex: number | undefined;
  fixtureFilter: string | undefined;
  caseFilter: string | undefined;
  modeFilter: CallbackMode | undefined;
  fixturePath: string;
}

export interface BenchmarkCase {
  label: string;
  fixture: BenchmarkFixture;
  mode: CallbackMode;
  diffStyle: DiffStyle;
  startingLine: number;
  totalLines: number;
  expandedHunks: Map<number, HunkExpansionRegion> | true | undefined;
  targetLine: number;
  targetTop: number;
  viewportHeight: number;
}

interface RunResult {
  checksum: number;
  rows: number;
}

interface TimedResult extends RunResult {
  elapsedMs: number;
}

interface CaseStorage {
  samples: number[];
  checksum: number;
  rows: number;
}

interface CaseSummary {
  label: string;
  fixture: string;
  source: BenchmarkFixture['source'];
  mode: CallbackMode;
  diffStyle: DiffStyle;
  startingLine: number;
  totalLines: number | 'Infinity';
  runs: number;
  meanMs: number;
  medianMs: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
  stdDevMs: number;
  checksum: number;
  rows: number;
}

type BenchmarkImplementationId = 'baseline' | 'current';

interface BenchmarkImplementation {
  id: BenchmarkImplementationId;
  label: string;
  supportsRangeCallback: boolean;
  run(props: IterateOverDiffProps): void;
}

export interface BenchmarkRunSummary {
  score: number;
  checksum: number;
  summaries: CaseSummary[];
}

export interface ComparedSummary {
  label: string;
  baselineMeanMs: number;
  currentMeanMs: number;
  meanDeltaMs: number;
  meanDeltaPct: number;
  baselineP95Ms: number;
  currentP95Ms: number;
  p95DeltaPct: number;
  rowsMatch: boolean;
  checksumMatch: boolean;
}

interface MemorySnapshot {
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
}

interface MemorySummary {
  before: MemorySnapshot;
  after: MemorySnapshot;
  delta: MemorySnapshot;
}

interface MemoryChildOutput {
  implementation: BenchmarkImplementationId;
  implementationLabel: string;
  caseIndex: number;
  caseLabel: string;
  caseCount: number;
  fixtureCount: number;
  checksum: number;
  score: number;
  memory: MemorySummary;
}

interface Segment {
  targetIndex: number;
  originalOffset: number;
  count: number;
}

interface ContentCounter {
  length: number;
}

interface HighlighterBucket {
  deletionContent: ContentCounter;
  additionContent: ContentCounter;
  deletionSegments: Segment[];
  additionSegments: Segment[];
  deletionInfoCount: number;
  additionInfoCount: number;
  decorations: number;
}

interface BenchmarkRunner {
  callback(props: DiffLineCallbackProps): boolean | void;
  rangeCallback?(props: DiffLineRangeCallbackProps): boolean | void;
  readResult(): RunResult;
}

const CHECKSUM_MOD = 1_000_000_007;
const DEFAULT_WINDOW_LINES = 300;
const DEFAULT_LINE_HEIGHT = 10;
const DEFAULT_HUNK_LINE_COUNT = 50;
const DEFAULT_CONFIG: BenchmarkConfig = {
  runs: 50,
  warmupRuns: 5,
  batchRuns: 1,
  preset: 'standard',
  outputJson: false,
  measureMemory: false,
  includeSynthetic: false,
  compareBaseline: false,
  memoryChildImplementation: undefined,
  memoryChildCaseIndex: undefined,
  fixtureFilter: undefined,
  caseFilter: undefined,
  modeFilter: undefined,
  fixturePath: '',
};

const CALLBACK_MODES: CallbackMode[] = [
  'noop',
  'checksum',
  'highlighter-ingest',
  'renderer-postprocess',
  'layout-size',
  'line-position',
  'scroll-anchor',
  'render-range',
];

export const BASELINE_IMPLEMENTATION: BenchmarkImplementation = {
  id: 'baseline',
  label: 'baseline_iterateOverDiff',
  supportsRangeCallback: false,
  run(props) {
    const baselineProps: Parameters<typeof baseline_iterateOverDiff>[0] = {
      diff: props.diff,
      diffStyle: props.diffStyle,
      startingLine: props.startingLine,
      totalLines: props.totalLines,
      expandedHunks: props.expandedHunks,
      collapsedContextThreshold: props.collapsedContextThreshold,
      callback: props.callback,
    };
    baseline_iterateOverDiff(baselineProps);
  },
};

export const CURRENT_IMPLEMENTATION: BenchmarkImplementation = {
  id: 'current',
  label: 'iterateOverDiff',
  supportsRangeCallback: true,
  run: iterateOverDiff,
};

function getBenchmarkImplementation(
  id: BenchmarkImplementationId
): BenchmarkImplementation {
  return id === 'baseline' ? BASELINE_IMPLEMENTATION : CURRENT_IMPLEMENTATION;
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

function parseNonNegativeInteger(value: string, flagName: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(
      `Invalid ${flagName} value "${value}". Expected a non-negative integer.`
    );
  }
  return parsed;
}

function parsePreset(value: string): BenchmarkPreset {
  if (
    value === 'smoke' ||
    value === 'standard' ||
    value === 'exhaustive' ||
    value === 'stress'
  ) {
    return value;
  }
  throw new Error(
    `Invalid --preset value "${value}". Expected smoke, standard, exhaustive, or stress.`
  );
}

function parseMode(value: string): CallbackMode {
  if (CALLBACK_MODES.includes(value as CallbackMode)) {
    return value as CallbackMode;
  }
  throw new Error(
    `Invalid --mode value "${value}". Expected one of: ${CALLBACK_MODES.join(
      ', '
    )}.`
  );
}

export function parseArgs(argv: string[]): BenchmarkConfig {
  const config: BenchmarkConfig = {
    ...DEFAULT_CONFIG,
    fixturePath:
      typeof import.meta.dir === 'string'
        ? resolve(import.meta.dir, 'fixtures/iterateOverDiffTopChanges.json')
        : 'fixtures/iterateOverDiffTopChanges.json',
  };

  for (let index = 0; index < argv.length; index++) {
    const rawArg = argv[index];
    if (rawArg === '--help' || rawArg === '-h') {
      printHelpAndExit();
    }

    if (rawArg === '--json') {
      config.outputJson = true;
      continue;
    }

    if (rawArg === '--memory') {
      config.measureMemory = true;
      continue;
    }

    if (rawArg === '--compare-baseline') {
      config.compareBaseline = true;
      continue;
    }

    if (rawArg === '--include-synthetic') {
      config.includeSynthetic = true;
      continue;
    }

    const [flag, inlineValue] = rawArg.split('=', 2);
    if (flag === '--memory-child') {
      const value = inlineValue ?? argv[index + 1];
      if (value == null) throw new Error('Missing value for --memory-child');
      if (inlineValue == null) index++;
      if (value !== 'baseline' && value !== 'current') {
        throw new Error(
          `Invalid --memory-child value "${value}". Expected baseline or current.`
        );
      }
      config.memoryChildImplementation = value;
      continue;
    }

    if (flag === '--memory-child-case-index') {
      const value = inlineValue ?? argv[index + 1];
      if (value == null)
        throw new Error('Missing value for --memory-child-case-index');
      if (inlineValue == null) index++;
      config.memoryChildCaseIndex = parseNonNegativeInteger(
        value,
        '--memory-child-case-index'
      );
      continue;
    }

    if (flag === '--runs') {
      const value = inlineValue ?? argv[index + 1];
      if (value == null) throw new Error('Missing value for --runs');
      if (inlineValue == null) index++;
      config.runs = parsePositiveInteger(value, '--runs');
      continue;
    }

    if (flag === '--warmup-runs') {
      const value = inlineValue ?? argv[index + 1];
      if (value == null) throw new Error('Missing value for --warmup-runs');
      if (inlineValue == null) index++;
      config.warmupRuns = parseNonNegativeInteger(value, '--warmup-runs');
      continue;
    }

    if (flag === '--batch-runs') {
      const value = inlineValue ?? argv[index + 1];
      if (value == null) throw new Error('Missing value for --batch-runs');
      if (inlineValue == null) index++;
      config.batchRuns = parsePositiveInteger(value, '--batch-runs');
      continue;
    }

    if (flag === '--preset') {
      const value = inlineValue ?? argv[index + 1];
      if (value == null) throw new Error('Missing value for --preset');
      if (inlineValue == null) index++;
      config.preset = parsePreset(value);
      continue;
    }

    if (flag === '--fixture') {
      const value = inlineValue ?? argv[index + 1];
      if (value == null) throw new Error('Missing value for --fixture');
      if (inlineValue == null) index++;
      config.fixtureFilter = value;
      continue;
    }

    if (flag === '--case') {
      const value = inlineValue ?? argv[index + 1];
      if (value == null) throw new Error('Missing value for --case');
      if (inlineValue == null) index++;
      config.caseFilter = value;
      continue;
    }

    if (flag === '--mode') {
      const value = inlineValue ?? argv[index + 1];
      if (value == null) throw new Error('Missing value for --mode');
      if (inlineValue == null) index++;
      config.modeFilter = parseMode(value);
      continue;
    }

    if (flag === '--fixture-path') {
      const value = inlineValue ?? argv[index + 1];
      if (value == null) throw new Error('Missing value for --fixture-path');
      if (inlineValue == null) index++;
      config.fixturePath = resolve(process.cwd(), value);
      continue;
    }

    throw new Error(`Unknown argument: ${rawArg}`);
  }

  return config;
}

function printHelpAndExit(): never {
  console.log('Usage: bun ws diffs benchmark:iterate-over-diff -- [options]');
  console.log('');
  console.log('Options:');
  console.log(
    '  --runs <number>          Measured runs per benchmark case (default: 50)'
  );
  console.log(
    '  --warmup-runs <number>   Warmup runs per benchmark case (default: 5)'
  );
  console.log(
    '  --batch-runs <number>    Invocations per timing sample, reported as per-invocation time (default: 1)'
  );
  console.log(
    '  --preset <name>          smoke, standard, exhaustive, or stress (default: standard)'
  );
  console.log('  --fixture <text>         Only run fixtures containing text');
  console.log('  --case <text>            Only run cases containing text');
  console.log(
    `  --mode <name>           Only run one callback mode: ${CALLBACK_MODES.join(
      ', '
    )}`
  );
  console.log('  --fixture-path <path>    Fixture JSON path');
  console.log(
    '  --include-synthetic      Include deterministic synthetic diffs'
  );
  console.log(
    '  --memory                 Run each selected case in fresh child processes and report GC-before/after memory deltas'
  );
  console.log(
    '  --compare-baseline       Run baseline_iterateOverDiff and iterateOverDiff, then compare'
  );
  console.log('  --json                   Emit machine-readable JSON output');
  console.log('  -h, --help               Show this help output');
  process.exit(0);
}

function addChecksum(current: number, value: number | undefined): number {
  if (value == null || !Number.isFinite(value)) {
    return current;
  }
  return (current + Math.abs(Math.trunc(value))) % CHECKSUM_MOD;
}

function addChecksumProduct(
  current: number,
  value: number | undefined,
  count: number
): number {
  if (value == null || !Number.isFinite(value) || count <= 0) {
    return current;
  }
  return (
    (current +
      (Math.abs(Math.trunc(value)) % CHECKSUM_MOD) * (count % CHECKSUM_MOD)) %
    CHECKSUM_MOD
  );
}

function addChecksumRange(
  current: number,
  start: number | undefined,
  count: number
): number {
  if (start == null || !Number.isFinite(start) || count <= 0) {
    return current;
  }
  const first = Math.abs(Math.trunc(start));
  return (
    (current + ((count * first + (count * (count - 1)) / 2) % CHECKSUM_MOD)) %
    CHECKSUM_MOD
  );
}

function getSplitLineIndex(props: DiffLineCallbackProps): number {
  return (
    props.additionLine?.splitLineIndex ??
    props.deletionLine?.splitLineIndex ??
    0
  );
}

function getUnifiedLineIndex(props: DiffLineCallbackProps): number {
  return (
    props.additionLine?.unifiedLineIndex ??
    props.deletionLine?.unifiedLineIndex ??
    0
  );
}

function getStyleLineIndex(
  props: DiffLineCallbackProps,
  diffStyle: DiffStyle
): number {
  return diffStyle === 'split'
    ? getSplitLineIndex(props)
    : getUnifiedLineIndex(props);
}

function getRangeStyleLineIndex(
  props: DiffLineRangeCallbackProps,
  diffStyle: DiffStyle
): number {
  return diffStyle === 'split'
    ? (props.additionLine?.splitLineIndex ??
        props.deletionLine?.splitLineIndex ??
        0)
    : (props.additionLine?.unifiedLineIndex ??
        props.deletionLine?.unifiedLineIndex ??
        0);
}

function getPositiveIntegerDigitCount(value: number): number {
  if (value < 10) return 1;
  if (value < 100) return 2;
  if (value < 1_000) return 3;
  if (value < 10_000) return 4;
  if (value < 100_000) return 5;
  if (value < 1_000_000) return 6;
  return String(value).length;
}

function getPositiveIntegerDigitLimit(digitCount: number): number {
  if (digitCount === 1) return 10;
  if (digitCount === 2) return 100;
  if (digitCount === 3) return 1_000;
  if (digitCount === 4) return 10_000;
  if (digitCount === 5) return 100_000;
  if (digitCount === 6) return 1_000_000;
  return 10 ** digitCount;
}

function getRenderedLineEstimate(
  diff: FileDiffMetadata,
  diffStyle: DiffStyle
): number {
  let splitCount = 0;
  let unifiedCount = 0;
  for (const hunk of diff.hunks) {
    splitCount += hunk.splitLineCount;
    unifiedCount += hunk.unifiedLineCount;
  }
  if (diffStyle === 'split') return splitCount;
  if (diffStyle === 'unified') return unifiedCount;
  return Math.max(splitCount, unifiedCount);
}

function getDeepStart(
  diff: FileDiffMetadata,
  diffStyle: DiffStyle,
  totalLines: number
) {
  const renderedRows = getRenderedLineEstimate(diff, diffStyle);
  return Math.max(
    0,
    Math.floor(renderedRows * 0.75) - Math.floor(totalLines / 2)
  );
}

function createHighlighterBucket(): HighlighterBucket {
  return {
    deletionContent: { length: 0 },
    additionContent: { length: 0 },
    deletionSegments: [],
    additionSegments: [],
    deletionInfoCount: 0,
    additionInfoCount: 0,
    decorations: 0,
  };
}

function appendContent(
  lineContent: string | undefined,
  lineIndex: number,
  segments: Segment[],
  content: ContentCounter,
  isWindowed: boolean
) {
  if (lineContent == null) {
    return;
  }
  if (isWindowed) {
    let segment = segments[segments.length - 1];
    if (segment == null || segment.targetIndex + segment.count !== lineIndex) {
      segment = {
        targetIndex: lineIndex,
        originalOffset: content.length,
        count: 0,
      };
      segments.push(segment);
    }
    segment.count++;
  }
  content.length++;
}

function appendContentRange(
  lines: string[],
  lineIndex: number | undefined,
  lineCount: number,
  segments: Segment[],
  content: ContentCounter,
  isWindowed: boolean
) {
  if (lineIndex == null || lineCount <= 0 || lines[lineIndex] == null) {
    return;
  }
  if (isWindowed) {
    let segment = segments[segments.length - 1];
    if (segment == null || segment.targetIndex + segment.count !== lineIndex) {
      segment = {
        targetIndex: lineIndex,
        originalOffset: content.length,
        count: 0,
      };
      segments.push(segment);
    }
    segment.count += lineCount;
  }

  content.length += lineCount;
}

function createNoopRunner(): BenchmarkRunner {
  let rows = 0;
  return {
    callback() {
      rows++;
    },
    rangeCallback(props) {
      rows += props.lineCount;
    },
    readResult() {
      return { checksum: rows, rows };
    },
  };
}

function createChecksumRunner(diffStyle: DiffStyle): BenchmarkRunner {
  let rows = 0;
  let checksum = 0;
  return {
    callback(props) {
      rows++;
      checksum = addChecksum(checksum, props.hunkIndex);
      checksum = addChecksum(checksum, props.type.length);
      checksum = addChecksum(checksum, props.collapsedBefore);
      checksum = addChecksum(checksum, props.collapsedAfter);
      checksum = addChecksum(checksum, getStyleLineIndex(props, diffStyle));
      checksum = addChecksum(checksum, props.deletionLine?.lineNumber);
      checksum = addChecksum(checksum, props.additionLine?.lineNumber);
      checksum = addChecksum(checksum, props.deletionLine?.lineIndex);
      checksum = addChecksum(checksum, props.additionLine?.lineIndex);
    },
    rangeCallback(props) {
      const lineCount = props.lineCount;
      rows += lineCount;
      checksum = addChecksumProduct(checksum, props.hunkIndex, lineCount);
      checksum = addChecksumProduct(checksum, props.type.length, lineCount);
      checksum = addChecksum(checksum, props.collapsedBefore);
      checksum = addChecksumProduct(checksum, props.collapsedAfter, lineCount);
      checksum = addChecksumRange(
        checksum,
        getRangeStyleLineIndex(props, diffStyle),
        lineCount
      );
      checksum = addChecksumRange(
        checksum,
        props.deletionLine?.lineNumber,
        lineCount
      );
      checksum = addChecksumRange(
        checksum,
        props.additionLine?.lineNumber,
        lineCount
      );
      checksum = addChecksumRange(
        checksum,
        props.deletionLine?.lineIndex,
        lineCount
      );
      checksum = addChecksumRange(
        checksum,
        props.additionLine?.lineIndex,
        lineCount
      );
    },
    readResult() {
      return { checksum, rows };
    },
  };
}

function createHighlighterIngestRunner(
  diff: FileDiffMetadata,
  isWindowed: boolean
): BenchmarkRunner {
  const buckets = new Map<number, HighlighterBucket>();
  const shouldGroupAll = !diff.isPartial;
  let rows = 0;
  let checksum = 0;

  function getBucket(hunkIndex: number): HighlighterBucket {
    const index = shouldGroupAll ? 0 : hunkIndex;
    let bucket = buckets.get(index);
    if (bucket == null) {
      bucket = createHighlighterBucket();
      buckets.set(index, bucket);
    }
    return bucket;
  }

  return {
    callback({ hunkIndex, additionLine, deletionLine, type }) {
      rows++;
      const bucket = getBucket(hunkIndex);

      if (type === 'change' && additionLine != null && deletionLine != null) {
        const additionContent = diff.additionLines[additionLine.lineIndex];
        const deletionContent = diff.deletionLines[deletionLine.lineIndex];
        bucket.decorations +=
          (additionContent?.length ?? 0) ^ (deletionContent?.length ?? 0);
      }

      if (deletionLine != null) {
        appendContent(
          diff.deletionLines[deletionLine.lineIndex],
          deletionLine.lineIndex,
          bucket.deletionSegments,
          bucket.deletionContent,
          isWindowed
        );
        bucket.deletionInfoCount++;
      }

      if (additionLine != null) {
        appendContent(
          diff.additionLines[additionLine.lineIndex],
          additionLine.lineIndex,
          bucket.additionSegments,
          bucket.additionContent,
          isWindowed
        );
        bucket.additionInfoCount++;
      }
    },
    rangeCallback(props) {
      const { hunkIndex, additionLine, deletionLine, lineCount, type } = props;
      rows += lineCount;
      const bucket = getBucket(hunkIndex);

      if (type === 'change' && additionLine != null && deletionLine != null) {
        for (let offset = 0; offset < lineCount; offset++) {
          const additionContent =
            diff.additionLines[additionLine.lineIndex + offset];
          const deletionContent =
            diff.deletionLines[deletionLine.lineIndex + offset];
          bucket.decorations +=
            (additionContent?.length ?? 0) ^ (deletionContent?.length ?? 0);
        }
      }

      if (deletionLine != null) {
        appendContentRange(
          diff.deletionLines,
          deletionLine.lineIndex,
          lineCount,
          bucket.deletionSegments,
          bucket.deletionContent,
          isWindowed
        );
        bucket.deletionInfoCount += lineCount;
      }

      if (additionLine != null) {
        appendContentRange(
          diff.additionLines,
          additionLine.lineIndex,
          lineCount,
          bucket.additionSegments,
          bucket.additionContent,
          isWindowed
        );
        bucket.additionInfoCount += lineCount;
      }
    },
    readResult() {
      for (const bucket of buckets.values()) {
        checksum = addChecksum(checksum, bucket.deletionContent.length);
        checksum = addChecksum(checksum, bucket.additionContent.length);
        checksum = addChecksum(checksum, bucket.deletionSegments.length);
        checksum = addChecksum(checksum, bucket.additionSegments.length);
        checksum = addChecksum(checksum, bucket.deletionInfoCount);
        checksum = addChecksum(checksum, bucket.additionInfoCount);
        checksum = addChecksum(checksum, bucket.decorations);
      }
      return { checksum, rows };
    },
  };
}

function createRendererPostprocessRunner(
  diffStyle: DiffStyle
): BenchmarkRunner {
  // The renderer no longer retains idle per-row context objects; this benchmark
  // keeps the same row accounting without allocating throwaway synthetic rows.
  let gutterRows = 0;
  let contentRows = 0;
  let rows = 0;
  let checksum = 0;
  let unifiedDigitCount = 1;
  let unifiedDigitFloor = 0;
  let unifiedDigitLimit = 10;
  let splitDigitCount = 1;
  let splitDigitFloor = 0;
  let splitDigitLimit = 10;

  return {
    callback(props) {
      rows++;
      const splitLineIndex = getSplitLineIndex(props);
      const unifiedLineIndex = getUnifiedLineIndex(props);
      const lineIndex = getStyleLineIndex(props, diffStyle);
      if (
        unifiedLineIndex < unifiedDigitFloor ||
        unifiedLineIndex >= unifiedDigitLimit
      ) {
        unifiedDigitCount = getPositiveIntegerDigitCount(unifiedLineIndex);
        unifiedDigitLimit = getPositiveIntegerDigitLimit(unifiedDigitCount);
        unifiedDigitFloor =
          unifiedDigitCount === 1
            ? 0
            : getPositiveIntegerDigitLimit(unifiedDigitCount - 1);
      }
      if (
        splitLineIndex < splitDigitFloor ||
        splitLineIndex >= splitDigitLimit
      ) {
        splitDigitCount = getPositiveIntegerDigitCount(splitLineIndex);
        splitDigitLimit = getPositiveIntegerDigitLimit(splitDigitCount);
        splitDigitFloor =
          splitDigitCount === 1
            ? 0
            : getPositiveIntegerDigitLimit(splitDigitCount - 1);
      }
      const lineKeyLength = unifiedDigitCount + 1 + splitDigitCount;

      if (props.collapsedBefore > 0) {
        gutterRows++;
        checksum = addChecksum(checksum, props.collapsedBefore);
      }

      if (props.deletionLine != null) {
        gutterRows++;
        contentRows++;
      }

      if (props.additionLine != null) {
        gutterRows++;
        contentRows++;
      }

      if (props.collapsedAfter > 0) {
        gutterRows++;
        checksum = addChecksum(checksum, props.collapsedAfter);
      }
      checksum = addChecksum(checksum, lineIndex);
      checksum = addChecksum(checksum, lineKeyLength);
    },
    readResult() {
      checksum = addChecksum(checksum, gutterRows);
      checksum = addChecksum(checksum, contentRows);
      return { checksum, rows };
    },
  };
}

function createLayoutSizeRunner(diffStyle: DiffStyle): BenchmarkRunner {
  const checkpoints: number[] = [];
  let renderedLineIndex = 0;
  let height = 30;
  let rows = 0;
  let checksum = 0;

  return {
    callback(props) {
      rows++;
      const lineIndex = getStyleLineIndex(props, diffStyle);
      if (renderedLineIndex % 5_000 === 0) {
        checkpoints.push(height + lineIndex);
      }
      if (props.collapsedBefore > 0) {
        height += 16;
      }
      const hasMetadata =
        (props.additionLine?.noEOFCR ?? false) ||
        (props.deletionLine?.noEOFCR ?? false);
      height += hasMetadata ? DEFAULT_LINE_HEIGHT * 2 : DEFAULT_LINE_HEIGHT;
      if (props.collapsedAfter > 0) {
        height += 16;
      }
      checksum = addChecksum(checksum, lineIndex);
      renderedLineIndex++;
    },
    rangeCallback(props) {
      const lineCount = props.lineCount;
      const lineIndex = getRangeStyleLineIndex(props, diffStyle);
      if (props.collapsedBefore > 0) {
        height += 16;
      }
      const firstCheckpointOffset =
        (5_000 - (renderedLineIndex % 5_000)) % 5_000;
      for (
        let offset = firstCheckpointOffset;
        offset < lineCount;
        offset += 5_000
      ) {
        checkpoints.push(
          height + offset * DEFAULT_LINE_HEIGHT + lineIndex + offset
        );
      }
      checksum = addChecksumRange(checksum, lineIndex, lineCount);
      height += lineCount * DEFAULT_LINE_HEIGHT;
      renderedLineIndex += lineCount;
      rows += lineCount;
    },
    readResult() {
      checksum = addChecksum(checksum, height);
      checksum = addChecksum(checksum, checkpoints.length);
      return { checksum, rows };
    },
  };
}

function createLinePositionRunner(
  diffStyle: DiffStyle,
  targetLine: number
): BenchmarkRunner {
  let top = 30;
  let rows = 0;
  let checksum = 0;

  return {
    callback(props) {
      rows++;
      const lineIndex = getStyleLineIndex(props, diffStyle);
      if (props.collapsedBefore > 0) {
        top += 16;
      }
      const hasMetadata =
        (props.additionLine?.noEOFCR ?? false) ||
        (props.deletionLine?.noEOFCR ?? false);
      const lineHeight = hasMetadata
        ? DEFAULT_LINE_HEIGHT * 2
        : DEFAULT_LINE_HEIGHT;
      if (lineIndex >= targetLine) {
        checksum = addChecksum(checksum, top + lineIndex + lineHeight);
        return true;
      }
      top += lineHeight;
      if (props.collapsedAfter > 0) {
        top += 16;
      }
    },
    rangeCallback(props) {
      const lineCount = props.lineCount;
      const lineIndex = getRangeStyleLineIndex(props, diffStyle);
      if (props.collapsedBefore > 0) {
        top += 16;
      }
      const offset = Math.max(0, targetLine - lineIndex);
      if (offset < lineCount) {
        rows += offset + 1;
        top += offset * DEFAULT_LINE_HEIGHT;
        checksum = addChecksum(
          checksum,
          top + lineIndex + offset + DEFAULT_LINE_HEIGHT
        );
        return true;
      }
      rows += lineCount;
      top += lineCount * DEFAULT_LINE_HEIGHT;
    },
    readResult() {
      return { checksum, rows };
    },
  };
}

function createScrollAnchorRunner(
  diffStyle: DiffStyle,
  targetTop: number
): BenchmarkRunner {
  let top = 30;
  let rows = 0;
  let checksum = 0;

  return {
    callback(props) {
      rows++;
      if (props.collapsedBefore > 0) {
        top += 16;
      }
      const lineIndex = getStyleLineIndex(props, diffStyle);
      if (top >= targetTop) {
        checksum = addChecksum(checksum, top + lineIndex);
        checksum = addChecksum(checksum, props.deletionLine?.lineNumber);
        checksum = addChecksum(checksum, props.additionLine?.lineNumber);
        return true;
      }
      const hasMetadata =
        (props.additionLine?.noEOFCR ?? false) ||
        (props.deletionLine?.noEOFCR ?? false);
      top += hasMetadata ? DEFAULT_LINE_HEIGHT * 2 : DEFAULT_LINE_HEIGHT;
      if (props.collapsedAfter > 0) {
        top += 16;
      }
    },
    rangeCallback(props) {
      const lineCount = props.lineCount;
      const lineIndex = getRangeStyleLineIndex(props, diffStyle);
      if (props.collapsedBefore > 0) {
        top += 16;
      }
      const offset =
        top >= targetTop
          ? 0
          : Math.ceil((targetTop - top) / DEFAULT_LINE_HEIGHT);
      if (offset < lineCount) {
        rows += offset + 1;
        top += offset * DEFAULT_LINE_HEIGHT;
        checksum = addChecksum(checksum, top + lineIndex + offset);
        checksum = addChecksum(
          checksum,
          props.deletionLine == null
            ? undefined
            : props.deletionLine.lineNumber + offset
        );
        checksum = addChecksum(
          checksum,
          props.additionLine == null
            ? undefined
            : props.additionLine.lineNumber + offset
        );
        return true;
      }
      rows += lineCount;
      top += lineCount * DEFAULT_LINE_HEIGHT;
    },
    readResult() {
      return { checksum, rows };
    },
  };
}

function createRenderRangeRunner(
  diffStyle: DiffStyle,
  targetTop: number,
  viewportHeight: number
): BenchmarkRunner {
  const hunkOffsets: number[] = [];
  const viewportCenter = targetTop + viewportHeight / 2;
  const bottom = targetTop + viewportHeight;
  let currentLine = 0;
  let top = 30;
  let firstVisibleHunk: number | undefined;
  let centerHunk: number | undefined;
  let overflowCounter: number | undefined;
  let rows = 0;
  let checksum = 0;

  return {
    callback(props) {
      rows++;
      if (props.collapsedBefore > 0) {
        top += 16;
      }

      const isAtHunkBoundary = currentLine % DEFAULT_HUNK_LINE_COUNT === 0;
      const currentHunk = Math.floor(currentLine / DEFAULT_HUNK_LINE_COUNT);
      if (isAtHunkBoundary) {
        hunkOffsets[currentHunk] = top;
        if (overflowCounter != null) {
          if (overflowCounter <= 0) {
            return true;
          }
          overflowCounter--;
        }
      }

      const hasMetadata =
        (props.additionLine?.noEOFCR ?? false) ||
        (props.deletionLine?.noEOFCR ?? false);
      const lineHeight = hasMetadata
        ? DEFAULT_LINE_HEIGHT * 2
        : DEFAULT_LINE_HEIGHT;
      if (top > targetTop - lineHeight && top < bottom) {
        firstVisibleHunk ??= currentHunk;
      }
      if (centerHunk == null && top + lineHeight > viewportCenter) {
        centerHunk = currentHunk;
      }
      if (overflowCounter == null && top >= bottom && isAtHunkBoundary) {
        overflowCounter = Math.ceil(viewportHeight / DEFAULT_LINE_HEIGHT / 10);
      }

      currentLine++;
      top += lineHeight;
      if (props.collapsedAfter > 0) {
        top += 16;
      }
      checksum = addChecksum(checksum, getStyleLineIndex(props, diffStyle));
    },
    rangeCallback(props) {
      let remaining = props.lineCount;
      let lineIndex = getRangeStyleLineIndex(props, diffStyle);
      if (props.collapsedBefore > 0) {
        top += 16;
      }
      while (remaining > 0) {
        const isAtHunkBoundary = currentLine % DEFAULT_HUNK_LINE_COUNT === 0;
        const currentHunk = Math.floor(currentLine / DEFAULT_HUNK_LINE_COUNT);
        if (isAtHunkBoundary) {
          hunkOffsets[currentHunk] = top;
          if (overflowCounter != null) {
            if (overflowCounter <= 0) {
              rows++;
              return true;
            }
            overflowCounter--;
          }
        }

        const segmentCount = Math.min(
          remaining,
          isAtHunkBoundary
            ? DEFAULT_HUNK_LINE_COUNT
            : DEFAULT_HUNK_LINE_COUNT - (currentLine % DEFAULT_HUNK_LINE_COUNT)
        );
        const finalSegmentTop = top + (segmentCount - 1) * DEFAULT_LINE_HEIGHT;
        if (
          firstVisibleHunk == null &&
          finalSegmentTop > targetTop - DEFAULT_LINE_HEIGHT &&
          top < bottom
        ) {
          firstVisibleHunk = currentHunk;
        }
        if (
          centerHunk == null &&
          finalSegmentTop + DEFAULT_LINE_HEIGHT > viewportCenter
        ) {
          centerHunk = currentHunk;
        }
        if (overflowCounter == null && top >= bottom && isAtHunkBoundary) {
          overflowCounter = Math.ceil(
            viewportHeight / DEFAULT_LINE_HEIGHT / 10
          );
        }

        checksum = addChecksumRange(checksum, lineIndex, segmentCount);
        rows += segmentCount;
        currentLine += segmentCount;
        top += segmentCount * DEFAULT_LINE_HEIGHT;
        lineIndex += segmentCount;
        remaining -= segmentCount;
      }
      return false;
    },
    readResult() {
      checksum = addChecksum(checksum, firstVisibleHunk);
      checksum = addChecksum(checksum, centerHunk);
      checksum = addChecksum(checksum, hunkOffsets.length);
      checksum = addChecksum(checksum, top);
      return { checksum, rows };
    },
  };
}

function createRunner(benchmarkCase: BenchmarkCase): BenchmarkRunner {
  switch (benchmarkCase.mode) {
    case 'noop':
      return createNoopRunner();
    case 'checksum':
      return createChecksumRunner(benchmarkCase.diffStyle);
    case 'highlighter-ingest':
      return createHighlighterIngestRunner(
        benchmarkCase.fixture.diff,
        benchmarkCase.startingLine > 0 || benchmarkCase.totalLines < Infinity
      );
    case 'renderer-postprocess':
      return createRendererPostprocessRunner(benchmarkCase.diffStyle);
    case 'layout-size':
      return createLayoutSizeRunner(benchmarkCase.diffStyle);
    case 'line-position':
      return createLinePositionRunner(
        benchmarkCase.diffStyle,
        benchmarkCase.targetLine
      );
    case 'scroll-anchor':
      return createScrollAnchorRunner(
        benchmarkCase.diffStyle,
        benchmarkCase.targetTop
      );
    case 'render-range':
      return createRenderRangeRunner(
        benchmarkCase.diffStyle,
        benchmarkCase.targetTop,
        benchmarkCase.viewportHeight
      );
  }
}

function runBenchmarkCase(
  benchmarkCase: BenchmarkCase,
  implementation: BenchmarkImplementation
): RunResult {
  const runner = createRunner(benchmarkCase);
  const props: IterateOverDiffProps = {
    diff: benchmarkCase.fixture.diff,
    diffStyle: benchmarkCase.diffStyle,
    startingLine: benchmarkCase.startingLine,
    totalLines: benchmarkCase.totalLines,
    expandedHunks: benchmarkCase.expandedHunks,
    callback: runner.callback,
  };
  if (implementation.supportsRangeCallback && runner.rangeCallback != null) {
    props.rangeCallback = runner.rangeCallback;
  }
  implementation.run(props);
  return runner.readResult();
}

function runTimedCase(
  benchmarkCase: BenchmarkCase,
  implementation: BenchmarkImplementation,
  batchRuns: number
): TimedResult {
  const startTime = performance.now();
  let checksum = 0;
  let rows = 0;
  for (let index = 0; index < batchRuns; index++) {
    const result = runBenchmarkCase(benchmarkCase, implementation);
    checksum = addChecksum(checksum, result.checksum);
    rows += result.rows;
  }
  const elapsedMs = performance.now() - startTime;
  return {
    checksum,
    rows,
    elapsedMs: elapsedMs / batchRuns,
  };
}

function percentile(sortedValues: number[], percentileRank: number): number {
  if (sortedValues.length === 0) return 0;
  const rank = (sortedValues.length - 1) * percentileRank;
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.ceil(rank);
  const lower = sortedValues[lowerIndex] ?? sortedValues[0] ?? 0;
  const upper =
    sortedValues[upperIndex] ?? sortedValues[sortedValues.length - 1] ?? lower;
  if (lowerIndex === upperIndex) return lower;
  return lower + (upper - lower) * (rank - lowerIndex);
}

function summarizeCase(
  benchmarkCase: BenchmarkCase,
  storage: CaseStorage
): CaseSummary {
  const samples = storage.samples;
  const sortedSamples = [...samples].sort((left, right) => left - right);
  const total = samples.reduce((sum, value) => sum + value, 0);
  const mean = samples.length > 0 ? total / samples.length : 0;
  const variance =
    samples.length > 0
      ? samples.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
        samples.length
      : 0;
  return {
    label: benchmarkCase.label,
    fixture: benchmarkCase.fixture.label,
    source: benchmarkCase.fixture.source,
    mode: benchmarkCase.mode,
    diffStyle: benchmarkCase.diffStyle,
    startingLine: benchmarkCase.startingLine,
    totalLines:
      benchmarkCase.totalLines === Infinity
        ? 'Infinity'
        : benchmarkCase.totalLines,
    runs: samples.length,
    meanMs: mean,
    medianMs: percentile(sortedSamples, 0.5),
    p95Ms: percentile(sortedSamples, 0.95),
    minMs: sortedSamples[0] ?? 0,
    maxMs: sortedSamples[sortedSamples.length - 1] ?? 0,
    stdDevMs: Math.sqrt(variance),
    checksum: storage.checksum,
    rows: storage.rows,
  };
}

export function formatMs(value: number): string {
  return value.toFixed(3);
}

export function formatPct(value: number | undefined): string {
  if (value == null) {
    return '-';
  }
  if (!Number.isFinite(value)) {
    return value > 0 ? '+Inf%' : '-Inf%';
  }
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

function formatDuration(milliseconds: number): string {
  const seconds = milliseconds / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}m${String(remainingSeconds).padStart(2, '0')}s`;
}

class ProgressReporter {
  private completedSteps = 0;
  private currentPhase = '';
  private readonly startTime = performance.now();
  private lastPrintedAt = this.startTime;

  constructor(
    private readonly totalSteps: number,
    private readonly enabled: boolean
  ) {
    if (enabled && totalSteps > 0) {
      this.print(`benchmark progress: 0/${totalSteps} samples`);
    }
  }

  step(phase: string) {
    if (!this.enabled || this.totalSteps <= 0) {
      return;
    }

    this.completedSteps++;
    const now = performance.now();
    const phaseChanged = phase !== this.currentPhase;
    const isDone = this.completedSteps >= this.totalSteps;
    if (!phaseChanged && !isDone && now - this.lastPrintedAt < 2000) {
      return;
    }

    this.currentPhase = phase;
    this.lastPrintedAt = now;
    const percent = (this.completedSteps / this.totalSteps) * 100;
    this.print(
      `benchmark progress: ${phase} ${this.completedSteps}/${this.totalSteps} samples (${percent.toFixed(
        1
      )}%, elapsed ${formatDuration(now - this.startTime)})`
    );
  }

  private print(message: string) {
    process.stderr.write(`${message}\n`);
  }
}

function forceGc() {
  const bun = globalThis as typeof globalThis & {
    Bun?: { gc?: (force?: boolean) => void };
  };
  const nodeGlobal = globalThis as typeof globalThis & { gc?: () => void };
  bun.Bun?.gc?.(true);
  nodeGlobal.gc?.();
}

function captureMemorySnapshot(): MemorySnapshot {
  forceGc();
  const memory = process.memoryUsage();
  return {
    rss: memory.rss,
    heapTotal: memory.heapTotal,
    heapUsed: memory.heapUsed,
    external: memory.external,
    arrayBuffers: memory.arrayBuffers,
  };
}

function subtractMemorySnapshots(
  after: MemorySnapshot,
  before: MemorySnapshot
): MemorySnapshot {
  return {
    rss: after.rss - before.rss,
    heapTotal: after.heapTotal - before.heapTotal,
    heapUsed: after.heapUsed - before.heapUsed,
    external: after.external - before.external,
    arrayBuffers: after.arrayBuffers - before.arrayBuffers,
  };
}

function createMemorySummary(
  before: MemorySnapshot,
  after: MemorySnapshot
): MemorySummary {
  return {
    before,
    after,
    delta: subtractMemorySnapshots(after, before),
  };
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
}

function formatMemoryChangePercent(before: number, after: number): string {
  return formatPct(percentDelta(before, after));
}

interface SummaryTableRow {
  case: string;
  runs: string;
  mean: string;
  p50: string;
  p95: string;
  min: string;
  max: string;
  rows: string;
  checksum: string;
}

function printSummaryTable(summaries: CaseSummary[]) {
  const rows: SummaryTableRow[] = summaries.map((summary) => ({
    case: summary.label,
    runs: String(summary.runs),
    mean: formatMs(summary.meanMs),
    p50: formatMs(summary.medianMs),
    p95: formatMs(summary.p95Ms),
    min: formatMs(summary.minMs),
    max: formatMs(summary.maxMs),
    rows: String(summary.rows),
    checksum: String(summary.checksum),
  }));
  const headers: (keyof SummaryTableRow)[] = [
    'case',
    'runs',
    'mean',
    'p50',
    'p95',
    'min',
    'max',
    'rows',
    'checksum',
  ];
  const widths = headers.map((header) =>
    rows.reduce((max, row) => Math.max(max, row[header].length), header.length)
  );
  const formatRow = (row: SummaryTableRow) =>
    headers
      .map((header, index) => row[header].padEnd(widths[index]))
      .join('  ')
      .trimEnd();
  const headerRow: SummaryTableRow = {
    case: 'case',
    runs: 'runs',
    mean: 'mean',
    p50: 'p50',
    p95: 'p95',
    min: 'min',
    max: 'max',
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

function makeSummary(rank: number, diff: FileDiffMetadata): FixtureSummary {
  let changedLines = 0;
  let hunkSpan = 0;
  for (const hunk of diff.hunks) {
    changedLines += hunk.additionLines + hunk.deletionLines;
    hunkSpan += hunk.additionCount + hunk.deletionCount;
  }
  return {
    rank,
    name: diff.name,
    type: diff.type,
    hunks: diff.hunks.length,
    changedLines,
    hunkSpan,
    unifiedLineCount: diff.unifiedLineCount,
    splitLineCount: diff.splitLineCount,
    additionLines: diff.additionLines.length,
    deletionLines: diff.deletionLines.length,
  };
}

function shortName(name: string): string {
  return name.split('/').at(-1) ?? name;
}

export function loadRealFixtures(fixturePath: string): BenchmarkFixture[] {
  const fixture = JSON.parse(
    readFileSync(fixturePath, 'utf8')
  ) as IterateOverDiffFixture;
  return fixture.files.map((entry) => ({
    id: `real-${entry.rank}`,
    label: `real#${entry.rank}:${shortName(entry.summary.name)}`,
    source: 'real-patch',
    summary: entry.summary,
    diff: entry.diff,
  }));
}

function createLineFile(name: string, lineCount: number): string {
  return Array.from(
    { length: lineCount },
    (_, index) => `${name}-${index + 1}`
  ).join('\n');
}

export function createSyntheticFixtures(): BenchmarkFixture[] {
  const largeOld = createLineFile('large', 12_000);
  const largeLines = largeOld.split('\n');
  largeLines[9_000] = 'large-changed-9001';
  const largeDiff = parseDiffFromFile(
    { name: 'synthetic-large-context.txt', contents: largeOld },
    { name: 'synthetic-large-context.txt', contents: largeLines.join('\n') }
  );

  const manyOldLines = Array.from(
    { length: 4_000 },
    (_, index) => `many-${index + 1}`
  );
  const manyNewLines = manyOldLines.map((line, index) =>
    index % 20 === 0 ? `${line}-changed` : line
  );
  const manyDiff = parseDiffFromFile(
    { name: 'synthetic-many-hunks.txt', contents: manyOldLines.join('\n') },
    { name: 'synthetic-many-hunks.txt', contents: manyNewLines.join('\n') }
  );

  const fixtures = [largeDiff, manyDiff];
  return fixtures.map((diff, index) => ({
    id: `synthetic-${index + 1}`,
    label: `synthetic#${index + 1}:${shortName(diff.name)}`,
    source: 'synthetic',
    summary: makeSummary(index + 1, diff),
    diff,
  }));
}

function createSingleAdditionHunkDiff(lineCount: number): FileDiffMetadata {
  const additionLines = Array.from(
    { length: lineCount },
    (_, index) => `stress-addition-${index + 1}`
  );
  return {
    name: `synthetic-single-${lineCount}-line-hunk.txt`,
    type: 'new',
    hunks: [
      {
        collapsedBefore: 0,
        additionStart: 1,
        additionCount: lineCount,
        additionLines: lineCount,
        additionLineIndex: 0,
        deletionStart: 0,
        deletionCount: 0,
        deletionLines: 0,
        deletionLineIndex: 0,
        hunkContent: [
          {
            type: 'change',
            deletions: 0,
            deletionLineIndex: 0,
            additions: lineCount,
            additionLineIndex: 0,
          },
        ],
        hunkSpecs: `@@ -0,0 +1,${lineCount} @@`,
        splitLineStart: 0,
        splitLineCount: lineCount,
        unifiedLineStart: 0,
        unifiedLineCount: lineCount,
        noEOFCRDeletions: false,
        noEOFCRAdditions: false,
      },
    ],
    splitLineCount: lineCount,
    unifiedLineCount: lineCount,
    isPartial: false,
    deletionLines: [],
    additionLines,
  };
}

export function createStressFixtures(): BenchmarkFixture[] {
  const diff = createSingleAdditionHunkDiff(500_000);
  return [
    {
      id: 'stress-500k-single-hunk',
      label: `stress#1:${shortName(diff.name)}`,
      source: 'synthetic',
      summary: makeSummary(1, diff),
      diff,
    },
  ];
}

function createPartialExpansionMap(): Map<number, HunkExpansionRegion> {
  return new Map([
    [0, { fromStart: 40, fromEnd: 40 }],
    [1, { fromStart: 20, fromEnd: 80 }],
  ]);
}

function makeCase(
  fixture: BenchmarkFixture,
  mode: CallbackMode,
  diffStyle: DiffStyle,
  variant: string,
  options: Partial<
    Pick<
      BenchmarkCase,
      | 'startingLine'
      | 'totalLines'
      | 'expandedHunks'
      | 'targetLine'
      | 'targetTop'
      | 'viewportHeight'
    >
  > = {}
): BenchmarkCase {
  const totalLines = options.totalLines ?? Infinity;
  const startingLine = options.startingLine ?? 0;
  const renderedRows = getRenderedLineEstimate(fixture.diff, diffStyle);
  const targetLine = options.targetLine ?? Math.floor(renderedRows * 0.75);
  const targetTop = options.targetTop ?? targetLine * DEFAULT_LINE_HEIGHT;
  const viewportHeight =
    options.viewportHeight ?? DEFAULT_WINDOW_LINES * DEFAULT_LINE_HEIGHT;
  const expansionLabel =
    options.expandedHunks === true
      ? ':expanded-all'
      : options.expandedHunks instanceof Map
        ? ':expanded-partial'
        : '';

  return {
    label: `${fixture.label}:${mode}:${diffStyle}:${variant}${expansionLabel}`,
    fixture,
    mode,
    diffStyle,
    startingLine,
    totalLines,
    expandedHunks: options.expandedHunks,
    targetLine,
    targetTop,
    viewportHeight,
  };
}

function createStandardCases(fixture: BenchmarkFixture): BenchmarkCase[] {
  const cases: BenchmarkCase[] = [];
  for (const diffStyle of ['unified', 'split', 'both'] satisfies DiffStyle[]) {
    cases.push(makeCase(fixture, 'checksum', diffStyle, 'full'));
    cases.push(
      makeCase(fixture, 'checksum', diffStyle, 'deep-window', {
        startingLine: getDeepStart(
          fixture.diff,
          diffStyle,
          DEFAULT_WINDOW_LINES
        ),
        totalLines: DEFAULT_WINDOW_LINES,
      })
    );
  }

  cases.push(makeCase(fixture, 'highlighter-ingest', 'both', 'full'));
  cases.push(
    makeCase(fixture, 'highlighter-ingest', 'both', 'deep-window', {
      startingLine: getDeepStart(fixture.diff, 'both', DEFAULT_WINDOW_LINES),
      totalLines: DEFAULT_WINDOW_LINES,
    })
  );

  for (const diffStyle of ['unified', 'split'] satisfies DiffStyle[]) {
    cases.push(
      makeCase(fixture, 'renderer-postprocess', diffStyle, 'deep-window', {
        startingLine: getDeepStart(
          fixture.diff,
          diffStyle,
          DEFAULT_WINDOW_LINES
        ),
        totalLines: DEFAULT_WINDOW_LINES,
      })
    );
    cases.push(makeCase(fixture, 'layout-size', diffStyle, 'full'));
    cases.push(makeCase(fixture, 'line-position', diffStyle, 'deep-target'));
  }

  cases.push(makeCase(fixture, 'scroll-anchor', 'split', 'deep-target'));
  cases.push(makeCase(fixture, 'render-range', 'split', 'deep-target'));
  return cases;
}

function createSmokeCases(fixture: BenchmarkFixture): BenchmarkCase[] {
  return [
    makeCase(fixture, 'checksum', 'split', 'full'),
    makeCase(fixture, 'checksum', 'both', 'deep-window', {
      startingLine: getDeepStart(fixture.diff, 'both', DEFAULT_WINDOW_LINES),
      totalLines: DEFAULT_WINDOW_LINES,
    }),
    makeCase(fixture, 'layout-size', 'split', 'full'),
    makeCase(fixture, 'line-position', 'split', 'deep-target'),
  ];
}

function createExhaustiveCases(fixture: BenchmarkFixture): BenchmarkCase[] {
  const cases = createStandardCases(fixture);
  const partialExpansion = createPartialExpansionMap();
  for (const diffStyle of ['unified', 'split', 'both'] satisfies DiffStyle[]) {
    cases.push(makeCase(fixture, 'noop', diffStyle, 'full'));
    cases.push(
      makeCase(fixture, 'checksum', diffStyle, 'full', { expandedHunks: true })
    );
    cases.push(
      makeCase(fixture, 'checksum', diffStyle, 'deep-window', {
        startingLine: getDeepStart(
          fixture.diff,
          diffStyle,
          DEFAULT_WINDOW_LINES
        ),
        totalLines: DEFAULT_WINDOW_LINES,
        expandedHunks: partialExpansion,
      })
    );
  }
  return cases;
}

function createStressCases(fixture: BenchmarkFixture): BenchmarkCase[] {
  const cases: BenchmarkCase[] = [];
  for (const diffStyle of ['unified', 'split', 'both'] satisfies DiffStyle[]) {
    cases.push(makeCase(fixture, 'noop', diffStyle, 'full'));
    cases.push(makeCase(fixture, 'checksum', diffStyle, 'full'));
  }
  for (const diffStyle of ['unified', 'split'] satisfies DiffStyle[]) {
    cases.push(makeCase(fixture, 'layout-size', diffStyle, 'full'));
  }
  return cases;
}

export function createBenchmarkCases(
  fixtures: BenchmarkFixture[],
  config: BenchmarkConfig
): BenchmarkCase[] {
  const selectedFixtures = fixtures.filter((fixture) => {
    if (config.fixtureFilter == null) return true;
    return (
      fixture.label.includes(config.fixtureFilter) ||
      fixture.summary.name.includes(config.fixtureFilter)
    );
  });
  const baseFixtures =
    config.preset === 'smoke' ? selectedFixtures.slice(0, 1) : selectedFixtures;
  const cases = baseFixtures.flatMap((fixture) => {
    if (config.preset === 'smoke') return createSmokeCases(fixture);
    if (config.preset === 'exhaustive') return createExhaustiveCases(fixture);
    if (config.preset === 'stress') return createStressCases(fixture);
    return createStandardCases(fixture);
  });

  return cases.filter((benchmarkCase) => {
    if (
      config.caseFilter != null &&
      !benchmarkCase.label.includes(config.caseFilter)
    ) {
      return false;
    }
    if (config.modeFilter != null && benchmarkCase.mode !== config.modeFilter) {
      return false;
    }
    return true;
  });
}

function createCaseStorage(cases: BenchmarkCase[]): CaseStorage[] {
  return cases.map(() => ({
    samples: [],
    checksum: 0,
    rows: 0,
  }));
}

function recordTimingResult(storage: CaseStorage, result: TimedResult) {
  storage.checksum = addChecksum(storage.checksum, result.checksum);
  storage.rows += result.rows;
  storage.samples.push(result.elapsedMs);
}

function runImplementationCaseSet(
  implementation: BenchmarkImplementation,
  cases: BenchmarkCase[],
  storages: CaseStorage[],
  runs: number,
  batchRuns: number,
  recordSamples: boolean,
  progress: ProgressReporter | undefined,
  phase: string
) {
  for (let runIndex = 0; runIndex < runs; runIndex++) {
    for (let caseOffset = 0; caseOffset < cases.length; caseOffset++) {
      const caseIndex = (runIndex + caseOffset) % cases.length;
      const benchmarkCase = cases[caseIndex];
      const result = runTimedCase(benchmarkCase, implementation, batchRuns);
      if (recordSamples) {
        recordTimingResult(storages[caseIndex], result);
      }
      progress?.step(phase);
    }
  }
}

function runComparisonCaseSet(
  cases: BenchmarkCase[],
  baselineStorages: CaseStorage[],
  currentStorages: CaseStorage[],
  runs: number,
  batchRuns: number,
  recordSamples: boolean,
  progress: ProgressReporter | undefined,
  phase: string
) {
  for (let runIndex = 0; runIndex < runs; runIndex++) {
    for (let caseOffset = 0; caseOffset < cases.length; caseOffset++) {
      const caseIndex = (runIndex + caseOffset) % cases.length;
      const benchmarkCase = cases[caseIndex];
      const baselineFirst = (runIndex + caseOffset) % 2 === 0;
      const implementations = baselineFirst
        ? [BASELINE_IMPLEMENTATION, CURRENT_IMPLEMENTATION]
        : [CURRENT_IMPLEMENTATION, BASELINE_IMPLEMENTATION];

      for (const implementation of implementations) {
        const result = runTimedCase(benchmarkCase, implementation, batchRuns);
        if (!recordSamples) {
          progress?.step(phase);
          continue;
        }
        const storage =
          implementation.id === 'baseline'
            ? baselineStorages[caseIndex]
            : currentStorages[caseIndex];
        recordTimingResult(storage, result);
        progress?.step(phase);
      }
    }
  }
}

function summarizeBenchmarkRun(
  cases: BenchmarkCase[],
  storages: CaseStorage[]
): BenchmarkRunSummary {
  const summaries = cases.map((benchmarkCase, index) =>
    summarizeCase(benchmarkCase, storages[index])
  );
  const allSamples = storages
    .flatMap((storage) => storage.samples)
    .sort((a, b) => a - b);
  const score = percentile(allSamples, 0.5);
  const checksum = summaries.reduce(
    (sum, summary) => addChecksum(sum, summary.checksum),
    0
  );
  return { score, checksum, summaries };
}

export function runSingleImplementationBenchmark(
  implementation: BenchmarkImplementation,
  cases: BenchmarkCase[],
  config: BenchmarkConfig,
  progress: ProgressReporter | undefined
): BenchmarkRunSummary {
  const storages = createCaseStorage(cases);
  runImplementationCaseSet(
    implementation,
    cases,
    storages,
    config.warmupRuns,
    config.batchRuns,
    false,
    progress,
    'warmup'
  );
  runImplementationCaseSet(
    implementation,
    cases,
    storages,
    config.runs,
    config.batchRuns,
    true,
    progress,
    'timing'
  );
  return summarizeBenchmarkRun(cases, storages);
}

export function runBaselineComparisonBenchmark(
  cases: BenchmarkCase[],
  config: BenchmarkConfig,
  progress: ProgressReporter | undefined
): { baseline: BenchmarkRunSummary; current: BenchmarkRunSummary } {
  const baselineStorages = createCaseStorage(cases);
  const currentStorages = createCaseStorage(cases);
  runComparisonCaseSet(
    cases,
    baselineStorages,
    currentStorages,
    config.warmupRuns,
    config.batchRuns,
    false,
    progress,
    'warmup'
  );
  runComparisonCaseSet(
    cases,
    baselineStorages,
    currentStorages,
    config.runs,
    config.batchRuns,
    true,
    progress,
    'timing'
  );
  return {
    baseline: summarizeBenchmarkRun(cases, baselineStorages),
    current: summarizeBenchmarkRun(cases, currentStorages),
  };
}

function runMemoryChildBenchmark(
  config: BenchmarkConfig,
  fixtures: BenchmarkFixture[],
  cases: BenchmarkCase[]
) {
  const implementationId = config.memoryChildImplementation;
  const caseIndex = config.memoryChildCaseIndex;
  if (implementationId == null || caseIndex == null) {
    throw new Error('Missing memory child implementation or case index.');
  }
  const benchmarkCase = cases[caseIndex];
  if (benchmarkCase == null) {
    throw new Error(`Invalid memory child case index: ${caseIndex}`);
  }

  const implementation = getBenchmarkImplementation(implementationId);
  const before = captureMemorySnapshot();
  const result = runSingleImplementationBenchmark(
    implementation,
    [benchmarkCase],
    config,
    undefined
  );
  const after = captureMemorySnapshot();
  const output: MemoryChildOutput = {
    implementation: implementation.id,
    implementationLabel: implementation.label,
    caseIndex,
    caseLabel: benchmarkCase.label,
    caseCount: cases.length,
    fixtureCount: fixtures.length,
    checksum: result.checksum,
    score: result.score,
    memory: createMemorySummary(before, after),
  };
  console.log(JSON.stringify(output));
}

export function percentDelta(baseline: number, current: number): number {
  if (baseline === 0) {
    return current === 0 ? 0 : Infinity;
  }
  return ((current - baseline) / baseline) * 100;
}

export function compareSummaries(
  baseline: BenchmarkRunSummary,
  current: BenchmarkRunSummary
): ComparedSummary[] {
  const baselineByLabel = new Map(
    baseline.summaries.map((summary) => [summary.label, summary])
  );

  return current.summaries
    .map((currentSummary) => {
      const baselineSummary = baselineByLabel.get(currentSummary.label);
      if (baselineSummary == null) {
        return undefined;
      }
      return {
        label: currentSummary.label,
        baselineMeanMs: baselineSummary.meanMs,
        currentMeanMs: currentSummary.meanMs,
        meanDeltaMs: currentSummary.meanMs - baselineSummary.meanMs,
        meanDeltaPct: percentDelta(
          baselineSummary.meanMs,
          currentSummary.meanMs
        ),
        baselineP95Ms: baselineSummary.p95Ms,
        currentP95Ms: currentSummary.p95Ms,
        p95DeltaPct: percentDelta(baselineSummary.p95Ms, currentSummary.p95Ms),
        rowsMatch: baselineSummary.rows === currentSummary.rows,
        checksumMatch: baselineSummary.checksum === currentSummary.checksum,
      } satisfies ComparedSummary;
    })
    .filter((summary): summary is ComparedSummary => summary != null)
    .sort(
      (left, right) =>
        Math.abs(right.meanDeltaPct) - Math.abs(left.meanDeltaPct)
    );
}

interface ComparisonTableRow {
  case: string;
  meanBase: string;
  meanNow: string;
  meanDelta: string;
  p95Delta: string;
  rows: string;
  checksum: string;
}

function printComparisonTable(comparisons: ComparedSummary[]) {
  const rows: ComparisonTableRow[] = comparisons.map((comparison) => ({
    case: comparison.label,
    meanBase: formatMs(comparison.baselineMeanMs),
    meanNow: formatMs(comparison.currentMeanMs),
    meanDelta: `${formatMs(comparison.meanDeltaMs)} (${formatPct(
      comparison.meanDeltaPct
    )})`,
    p95Delta: formatPct(comparison.p95DeltaPct),
    rows: comparison.rowsMatch ? 'ok' : 'DIFF',
    checksum: comparison.checksumMatch ? 'ok' : 'DIFF',
  }));
  const headers: (keyof ComparisonTableRow)[] = [
    'case',
    'meanBase',
    'meanNow',
    'meanDelta',
    'p95Delta',
    'rows',
    'checksum',
  ];
  const widths = headers.map((header) =>
    rows.reduce((max, row) => Math.max(max, row[header].length), header.length)
  );
  const formatRow = (row: ComparisonTableRow) =>
    headers
      .map((header, index) => row[header].padEnd(widths[index]))
      .join('  ')
      .trimEnd();
  const headerRow: ComparisonTableRow = {
    case: 'case',
    meanBase: 'meanBase',
    meanNow: 'meanNow',
    meanDelta: 'meanDelta',
    p95Delta: 'p95Delta',
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

function buildMemoryChildArgs(
  config: BenchmarkConfig,
  implementation: BenchmarkImplementationId,
  caseIndex: number
): string[] {
  const args = [
    resolve(import.meta.dir, 'benchmarkIterateOverDiff.ts'),
    '--memory-child',
    implementation,
    '--memory-child-case-index',
    String(caseIndex),
    '--runs',
    String(config.runs),
    '--warmup-runs',
    String(config.warmupRuns),
    '--batch-runs',
    String(config.batchRuns),
    '--preset',
    config.preset,
    '--fixture-path',
    config.fixturePath,
  ];
  if (config.includeSynthetic) {
    args.push('--include-synthetic');
  }
  if (config.fixtureFilter != null) {
    args.push('--fixture', config.fixtureFilter);
  }
  if (config.caseFilter != null) {
    args.push('--case', config.caseFilter);
  }
  if (config.modeFilter != null) {
    args.push('--mode', config.modeFilter);
  }
  return args;
}

function runMemoryChildProcess(
  config: BenchmarkConfig,
  implementation: BenchmarkImplementationId,
  caseIndex: number
): MemoryChildOutput {
  const child = spawnSync(
    process.execPath,
    buildMemoryChildArgs(config, implementation, caseIndex),
    {
      encoding: 'utf8',
      env: { ...process.env, AGENT: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  if (child.error != null) {
    throw child.error;
  }
  if (child.status !== 0) {
    throw new Error(
      `Memory child failed for ${implementation} case ${caseIndex}:\n${child.stderr}`
    );
  }
  return JSON.parse(child.stdout) as MemoryChildOutput;
}

interface MemoryComparisonRow {
  case: string;
  memoryBaseline: string;
  memoryCurrent: string;
  change: string;
}

function printFreshProcessMemoryTable(
  baselineOutputs: MemoryChildOutput[],
  currentOutputs: MemoryChildOutput[]
) {
  const currentByCase = new Map(
    currentOutputs.map((output) => [output.caseLabel, output])
  );
  const rows: MemoryComparisonRow[] = baselineOutputs.map((baseline) => {
    const current = currentByCase.get(baseline.caseLabel);
    if (current == null) {
      throw new Error(
        `Missing current memory output for ${baseline.caseLabel}`
      );
    }
    return {
      case: baseline.caseLabel,
      memoryBaseline: formatMegabytes(baseline.memory.after.rss),
      memoryCurrent: formatMegabytes(current.memory.after.rss),
      change: formatMemoryChangePercent(
        baseline.memory.after.rss,
        current.memory.after.rss
      ),
    };
  });
  const headers: (keyof MemoryComparisonRow)[] = [
    'case',
    'memoryBaseline',
    'memoryCurrent',
    'change',
  ];
  const widths = headers.map((header) =>
    rows.reduce((max, row) => Math.max(max, row[header].length), header.length)
  );
  const formatRow = (row: MemoryComparisonRow) =>
    headers
      .map((header, index) => row[header].padEnd(widths[index]))
      .join('  ')
      .trimEnd();
  const headerRow: MemoryComparisonRow = {
    case: 'case',
    memoryBaseline: 'memoryBaseline',
    memoryCurrent: 'memoryCurrent',
    change: 'change',
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

interface SingleMemoryRow {
  case: string;
  memoryBefore: string;
  memoryAfter: string;
  change: string;
}

function printFreshProcessSingleMemoryTable(outputs: MemoryChildOutput[]) {
  const rows: SingleMemoryRow[] = outputs.map((output) => ({
    case: output.caseLabel,
    memoryBefore: formatMegabytes(output.memory.before.rss),
    memoryAfter: formatMegabytes(output.memory.after.rss),
    change: formatMemoryChangePercent(
      output.memory.before.rss,
      output.memory.after.rss
    ),
  }));
  const headers: (keyof SingleMemoryRow)[] = [
    'case',
    'memoryBefore',
    'memoryAfter',
    'change',
  ];
  const widths = headers.map((header) =>
    rows.reduce((max, row) => Math.max(max, row[header].length), header.length)
  );
  const formatRow = (row: SingleMemoryRow) =>
    headers
      .map((header, index) => row[header].padEnd(widths[index]))
      .join('  ')
      .trimEnd();
  const headerRow: SingleMemoryRow = {
    case: 'case',
    memoryBefore: 'memoryBefore',
    memoryAfter: 'memoryAfter',
    change: 'change',
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

function runFreshProcessMemoryComparison(
  cases: BenchmarkCase[],
  config: BenchmarkConfig,
  progressEnabled: boolean
): { baseline: MemoryChildOutput[]; current: MemoryChildOutput[] } {
  const implementationIds: BenchmarkImplementationId[] = config.compareBaseline
    ? ['baseline', 'current']
    : ['current'];
  const totalSteps = cases.length * implementationIds.length;
  const progress = new ProgressReporter(totalSteps, progressEnabled);
  const baseline: MemoryChildOutput[] = [];
  const current: MemoryChildOutput[] = [];

  for (let caseIndex = 0; caseIndex < cases.length; caseIndex++) {
    for (const implementationId of implementationIds) {
      const output = runMemoryChildProcess(config, implementationId, caseIndex);
      if (implementationId === 'baseline') {
        baseline.push(output);
      } else {
        current.push(output);
      }
      progress.step('memory');
    }
  }

  return { baseline, current };
}

function getProgressStepCount(
  cases: BenchmarkCase[],
  config: BenchmarkConfig
): number {
  const implementationCount = config.compareBaseline ? 2 : 1;
  const runs = config.warmupRuns + config.runs;
  return cases.length * implementationCount * runs;
}

function main() {
  const config = parseArgs(process.argv.slice(2));
  const fixtures =
    config.preset === 'stress'
      ? createStressFixtures()
      : [
          ...loadRealFixtures(config.fixturePath),
          ...(config.includeSynthetic ? createSyntheticFixtures() : []),
        ];
  const cases = createBenchmarkCases(fixtures, config);
  if (cases.length === 0) {
    throw new Error('No benchmark cases matched the provided filters.');
  }
  if (config.memoryChildImplementation != null) {
    runMemoryChildBenchmark(config, fixtures, cases);
    return;
  }
  const progress = new ProgressReporter(
    getProgressStepCount(cases, config),
    !config.outputJson
  );

  if (config.compareBaseline) {
    const { baseline, current } = runBaselineComparisonBenchmark(
      cases,
      config,
      progress
    );
    const comparisons = compareSummaries(baseline, current);
    const scoreDeltaPct = percentDelta(baseline.score, current.score);
    const checksumMatch = baseline.checksum === current.checksum;
    const freshProcessMemory = config.measureMemory
      ? runFreshProcessMemoryComparison(cases, config, !config.outputJson)
      : undefined;

    if (config.outputJson) {
      console.log(
        JSON.stringify(
          {
            benchmark: 'iterateOverDiff:baseline-compare',
            fixturePath: config.fixturePath,
            config,
            implementations: {
              baseline: BASELINE_IMPLEMENTATION.label,
              current: CURRENT_IMPLEMENTATION.label,
            },
            caseCount: cases.length,
            fixtureCount: fixtures.length,
            baseline,
            current,
            scoreDeltaPct,
            checksumMatch,
            comparedCases: comparisons.length,
            comparisons,
            freshProcessMemory,
          },
          null,
          2
        )
      );
      return;
    }

    console.log('iterateOverDiff benchmark comparison');
    console.log(`fixture=${config.fixturePath}`);
    console.log(`fixtures=${fixtures.length} cases=${cases.length}`);
    console.log(
      `preset=${config.preset} runsPerCase=${config.runs} warmupRunsPerCase=${config.warmupRuns} batchRuns=${config.batchRuns}`
    );
    console.log(
      `baseline=${BASELINE_IMPLEMENTATION.label} current=${CURRENT_IMPLEMENTATION.label}`
    );
    console.log(
      `score ${formatMs(baseline.score)}ms -> ${formatMs(
        current.score
      )}ms (${formatPct(scoreDeltaPct)})`
    );
    console.log(`checksum=${checksumMatch ? 'ok' : 'DIFF'}`);
    console.log('');
    printComparisonTable(comparisons);
    if (freshProcessMemory != null) {
      console.log('');
      console.log(
        'fresh process memory comparison (post-GC RSS after baseline/current case processes)'
      );
      printFreshProcessMemoryTable(
        freshProcessMemory.baseline,
        freshProcessMemory.current
      );
    }
    return;
  }

  const { checksum, score, summaries } = runSingleImplementationBenchmark(
    CURRENT_IMPLEMENTATION,
    cases,
    config,
    progress
  );
  const freshProcessMemory = config.measureMemory
    ? runFreshProcessMemoryComparison(cases, config, !config.outputJson)
    : undefined;

  if (config.outputJson) {
    console.log(
      JSON.stringify(
        {
          benchmark: 'iterateOverDiff',
          implementation: CURRENT_IMPLEMENTATION.label,
          fixturePath: config.fixturePath,
          config,
          caseCount: cases.length,
          fixtureCount: fixtures.length,
          checksum,
          score,
          summaries,
          freshProcessMemory,
        },
        null,
        2
      )
    );
    return;
  }

  console.log('iterateOverDiff benchmark');
  console.log(`fixture=${config.fixturePath}`);
  console.log(`fixtures=${fixtures.length} cases=${cases.length}`);
  console.log(
    `preset=${config.preset} runsPerCase=${config.runs} warmupRunsPerCase=${config.warmupRuns} batchRuns=${config.batchRuns}`
  );
  console.log(`implementation=${CURRENT_IMPLEMENTATION.label}`);
  console.log(`checksum=${checksum}`);
  console.log('');
  printSummaryTable(summaries);
  if (freshProcessMemory != null) {
    console.log('');
    console.log(
      'fresh process memory (post-GC RSS before/after each current case process)'
    );
    printFreshProcessSingleMemoryTable(freshProcessMemory.current);
  }
  console.log('');
  console.log(`score=${formatMs(score)}ms`);
}

if (
  typeof process !== 'undefined' &&
  process.argv[1]?.endsWith('benchmarkIterateOverDiff.ts')
) {
  main();
}
