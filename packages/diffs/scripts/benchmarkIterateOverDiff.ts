import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { FileDiffMetadata, HunkExpansionRegion } from '../src/types';
import type {
  DiffLineCallbackProps,
  DiffLineRangeCallbackProps,
} from '../src/utils/iterateOverDiff';
import { iterateOverDiff } from '../src/utils/iterateOverDiff';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';

type DiffStyle = 'unified' | 'split' | 'both';

type CallbackMode =
  | 'noop'
  | 'checksum'
  | 'highlighter-ingest'
  | 'renderer-postprocess'
  | 'layout-size'
  | 'line-position'
  | 'scroll-anchor'
  | 'render-range';

type BenchmarkPreset = 'smoke' | 'standard' | 'exhaustive' | 'stress';

interface FixtureSummary {
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

interface FixtureEntry {
  rank: number;
  summary: FixtureSummary;
  diff: FileDiffMetadata;
}

interface IterateOverDiffFixture {
  benchmark: 'iterateOverDiff';
  sourcePatch: string;
  rankMetric: string;
  count: number;
  files: FixtureEntry[];
}

interface BenchmarkFixture {
  id: string;
  label: string;
  source: 'real-patch' | 'synthetic';
  summary: FixtureSummary;
  diff: FileDiffMetadata;
}

interface BenchmarkConfig {
  runs: number;
  warmupRuns: number;
  memoryBatchRuns: number;
  preset: BenchmarkPreset;
  outputJson: boolean;
  measureMemory: boolean;
  includeSynthetic: boolean;
  fixtureFilter: string | undefined;
  caseFilter: string | undefined;
  modeFilter: CallbackMode | undefined;
  fixturePath: string;
}

interface BenchmarkCase {
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
  heapGrowth: number | undefined;
  retainedHeapDelta: number | undefined;
}

interface CaseStorage {
  samples: number[];
  heapGrowthDeltas: number[];
  retainedHeapDeltas: number[];
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
  meanHeapGrowth: number | undefined;
  meanRetainedHeapDelta: number | undefined;
  checksum: number;
  rows: number;
}

interface Segment {
  targetIndex: number;
  originalOffset: number;
  count: number;
}

interface HighlighterBucket {
  deletionContent: string[];
  additionContent: string[];
  deletionSegments: Segment[];
  additionSegments: Segment[];
  deletionInfo: number[];
  additionInfo: number[];
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
  memoryBatchRuns: 25,
  preset: 'standard',
  outputJson: false,
  measureMemory: false,
  includeSynthetic: false,
  fixtureFilter: undefined,
  caseFilter: undefined,
  modeFilter: undefined,
  fixturePath: resolve(
    import.meta.dir,
    'fixtures/iterateOverDiffTopChanges.json'
  ),
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

    if (rawArg === '--memory') {
      config.measureMemory = true;
      continue;
    }

    if (rawArg === '--include-synthetic') {
      config.includeSynthetic = true;
      continue;
    }

    const [flag, inlineValue] = rawArg.split('=', 2);
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

    if (flag === '--memory-batch-runs') {
      const value = inlineValue ?? argv[index + 1];
      if (value == null)
        throw new Error('Missing value for --memory-batch-runs');
      if (inlineValue == null) index++;
      config.memoryBatchRuns = parsePositiveInteger(
        value,
        '--memory-batch-runs'
      );
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
    '  --memory-batch-runs <n>  Case invocations per memory sample (default: 25)'
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
  console.log('  --memory                 Force GC and report heap deltas');
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
    deletionContent: [],
    additionContent: [],
    deletionSegments: [],
    additionSegments: [],
    deletionInfo: [],
    additionInfo: [],
    decorations: 0,
  };
}

function appendContent(
  lineContent: string | undefined,
  lineIndex: number,
  segments: Segment[],
  content: string[],
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
  content.push(lineContent);
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
      checksum = addChecksumProduct(checksum, props.collapsedBefore, lineCount);
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
      const splitLineIndex =
        additionLine?.splitLineIndex ?? deletionLine?.splitLineIndex ?? 0;

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
        bucket.deletionInfo.push(
          deletionLine.lineNumber +
            deletionLine.unifiedLineIndex +
            splitLineIndex
        );
      }

      if (additionLine != null) {
        appendContent(
          diff.additionLines[additionLine.lineIndex],
          additionLine.lineIndex,
          bucket.additionSegments,
          bucket.additionContent,
          isWindowed
        );
        bucket.additionInfo.push(
          additionLine.lineNumber +
            additionLine.unifiedLineIndex +
            splitLineIndex
        );
      }
    },
    readResult() {
      for (const bucket of buckets.values()) {
        checksum = addChecksum(checksum, bucket.deletionContent.length);
        checksum = addChecksum(checksum, bucket.additionContent.length);
        checksum = addChecksum(checksum, bucket.deletionSegments.length);
        checksum = addChecksum(checksum, bucket.additionSegments.length);
        checksum = addChecksum(checksum, bucket.deletionInfo.length);
        checksum = addChecksum(checksum, bucket.additionInfo.length);
        checksum = addChecksum(checksum, bucket.decorations);
      }
      return { checksum, rows };
    },
  };
}

function createRendererPostprocessRunner(
  diffStyle: DiffStyle
): BenchmarkRunner {
  const gutterRows: object[] = [];
  const contentRows: object[] = [];
  let rows = 0;
  let checksum = 0;

  return {
    callback(props) {
      rows++;
      const splitLineIndex = getSplitLineIndex(props);
      const unifiedLineIndex = getUnifiedLineIndex(props);
      const lineIndex = getStyleLineIndex(props, diffStyle);
      const lineKey = `${unifiedLineIndex},${splitLineIndex}`;

      if (props.collapsedBefore > 0) {
        gutterRows.push({ type: 'separator', hunkIndex: props.hunkIndex });
        checksum = addChecksum(checksum, props.collapsedBefore);
      }

      if (props.deletionLine != null) {
        gutterRows.push({
          side: diffStyle === 'unified' ? 'unified' : 'deletions',
          type: props.type,
          lineNumber: props.deletionLine.lineNumber,
          lineKey,
        });
        contentRows.push({ side: 'deletions', lineIndex, lineKey });
      }

      if (props.additionLine != null) {
        gutterRows.push({
          side: diffStyle === 'unified' ? 'unified' : 'additions',
          type: props.type,
          lineNumber: props.additionLine.lineNumber,
          lineKey,
        });
        contentRows.push({ side: 'additions', lineIndex, lineKey });
      }

      if (props.collapsedAfter > 0) {
        gutterRows.push({
          type: 'trailing-separator',
          hunkIndex: props.hunkIndex,
        });
        checksum = addChecksum(checksum, props.collapsedAfter);
      }
      checksum = addChecksum(checksum, lineIndex);
      checksum = addChecksum(checksum, lineKey.length);
    },
    readResult() {
      checksum = addChecksum(checksum, gutterRows.length);
      checksum = addChecksum(checksum, contentRows.length);
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

function runBenchmarkCase(benchmarkCase: BenchmarkCase): RunResult {
  const runner = createRunner(benchmarkCase);
  iterateOverDiff({
    diff: benchmarkCase.fixture.diff,
    diffStyle: benchmarkCase.diffStyle,
    startingLine: benchmarkCase.startingLine,
    totalLines: benchmarkCase.totalLines,
    expandedHunks: benchmarkCase.expandedHunks,
    callback: runner.callback,
    rangeCallback: runner.rangeCallback,
  });
  return runner.readResult();
}

function forceGc() {
  const bun = globalThis as typeof globalThis & {
    Bun?: { gc?: (force?: boolean) => void };
  };
  const nodeGlobal = globalThis as typeof globalThis & { gc?: () => void };
  bun.Bun?.gc?.(true);
  nodeGlobal.gc?.();
}

function getTrackedHeapSize(): number {
  return process.memoryUsage().heapTotal;
}

function runTimedCase(
  benchmarkCase: BenchmarkCase,
  measureMemory: boolean,
  batchRuns: number
): TimedResult {
  if (measureMemory) {
    forceGc();
  }
  const heapBefore = measureMemory ? getTrackedHeapSize() : undefined;
  const startTime = performance.now();
  let checksum = 0;
  let rows = 0;
  for (let index = 0; index < batchRuns; index++) {
    const result = runBenchmarkCase(benchmarkCase);
    checksum = addChecksum(checksum, result.checksum);
    rows += result.rows;
  }
  const elapsedMs = performance.now() - startTime;
  const heapAfterRun = measureMemory ? getTrackedHeapSize() : undefined;
  if (measureMemory) {
    forceGc();
  }
  const heapAfterGc = measureMemory ? getTrackedHeapSize() : undefined;
  return {
    checksum,
    rows,
    elapsedMs: elapsedMs / batchRuns,
    heapGrowth:
      heapBefore != null && heapAfterRun != null
        ? heapAfterRun - heapBefore
        : undefined,
    retainedHeapDelta:
      heapBefore != null && heapAfterGc != null
        ? heapAfterGc - heapBefore
        : undefined,
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
  const heapGrowthDeltas = storage.heapGrowthDeltas;
  const meanHeapGrowth =
    heapGrowthDeltas.length > 0
      ? heapGrowthDeltas.reduce((sum, value) => sum + value, 0) /
        heapGrowthDeltas.length
      : undefined;
  const retainedHeapDeltas = storage.retainedHeapDeltas;
  const meanRetainedHeapDelta =
    retainedHeapDeltas.length > 0
      ? retainedHeapDeltas.reduce((sum, value) => sum + value, 0) /
        retainedHeapDeltas.length
      : undefined;

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
    meanHeapGrowth,
    meanRetainedHeapDelta,
    checksum: storage.checksum,
    rows: storage.rows,
  };
}

function formatMs(value: number): string {
  return value.toFixed(3);
}

function formatHeap(value: number | undefined): string {
  if (value == null) return '-';
  return `${(value / 1024).toFixed(1)}KiB`;
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
  heap: string;
  retained: string;
}

function printSummaryTable(summaries: CaseSummary[], includeMemory: boolean) {
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
    heap: formatHeap(summary.meanHeapGrowth),
    retained: formatHeap(summary.meanRetainedHeapDelta),
  }));
  const headers: (keyof SummaryTableRow)[] = includeMemory
    ? [
        'case',
        'runs',
        'mean',
        'p50',
        'p95',
        'min',
        'max',
        'rows',
        'checksum',
        'heap',
        'retained',
      ]
    : ['case', 'runs', 'mean', 'p50', 'p95', 'min', 'max', 'rows', 'checksum'];
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
    heap: 'heap',
    retained: 'retained',
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

function loadRealFixtures(fixturePath: string): BenchmarkFixture[] {
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

function createSyntheticFixtures(): BenchmarkFixture[] {
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

function createStressFixtures(): BenchmarkFixture[] {
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

function createBenchmarkCases(
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
    heapGrowthDeltas: [],
    retainedHeapDeltas: [],
    checksum: 0,
    rows: 0,
  }));
}

function runCaseSet(
  cases: BenchmarkCase[],
  storages: CaseStorage[],
  runs: number,
  measureMemory: boolean,
  memoryBatchRuns: number,
  recordSamples: boolean
) {
  for (let runIndex = 0; runIndex < runs; runIndex++) {
    for (let caseOffset = 0; caseOffset < cases.length; caseOffset++) {
      const caseIndex = (runIndex + caseOffset) % cases.length;
      const benchmarkCase = cases[caseIndex];
      const storage = storages[caseIndex];
      const result = runTimedCase(
        benchmarkCase,
        measureMemory && recordSamples,
        measureMemory && recordSamples ? memoryBatchRuns : 1
      );
      if (recordSamples) {
        storage.checksum = addChecksum(storage.checksum, result.checksum);
        storage.rows += result.rows;
        storage.samples.push(result.elapsedMs);
        if (result.heapGrowth != null) {
          storage.heapGrowthDeltas.push(result.heapGrowth);
        }
        if (result.retainedHeapDelta != null) {
          storage.retainedHeapDeltas.push(result.retainedHeapDelta);
        }
      }
    }
  }
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

  const storages = createCaseStorage(cases);
  runCaseSet(
    cases,
    storages,
    config.warmupRuns,
    config.measureMemory,
    config.memoryBatchRuns,
    false
  );
  runCaseSet(
    cases,
    storages,
    config.runs,
    config.measureMemory,
    config.memoryBatchRuns,
    true
  );

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

  if (config.outputJson) {
    console.log(
      JSON.stringify(
        {
          benchmark: 'iterateOverDiff',
          fixturePath: config.fixturePath,
          config,
          caseCount: cases.length,
          fixtureCount: fixtures.length,
          checksum,
          score,
          summaries,
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
    `preset=${config.preset} runsPerCase=${config.runs} warmupRunsPerCase=${config.warmupRuns}`
  );
  console.log(`checksum=${checksum}`);
  if (config.measureMemory) {
    console.log(
      `memory=heap is pre-GC heapTotal growth over ${config.memoryBatchRuns} invocations; retained is after forced post-run GC`
    );
  }
  console.log('');
  printSummaryTable(summaries, config.measureMemory);
  console.log('');
  console.log(`score=${formatMs(score)}ms`);
}

main();
