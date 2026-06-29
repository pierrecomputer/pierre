import { describe, expect, test } from 'bun:test';

import { VirtualizedFileDiff } from '../src/components/VirtualizedFileDiff';
import { DEFAULT_CODE_VIEW_FILE_METRICS } from '../src/constants';
import type {
  FileDiffLoadedFiles,
  FileDiffMetadata,
  HunkExpansionRegion,
  RenderRange,
  RenderWindow,
  VirtualFileMetrics,
} from '../src/types';
import { iterateOverDiff } from '../src/utils/iterateOverDiff';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { installDom } from './domHarness';

// Mirrors LAYOUT_CHECKPOINT_INTERVAL in src/components/VirtualizedFileDiff.ts:
// the source emits one layout checkpoint per this many diff rows.
const LAYOUT_CHECKPOINT_INTERVAL = 5_000;

const metrics: VirtualFileMetrics = {
  ...DEFAULT_CODE_VIEW_FILE_METRICS,
  hunkLineCount: 2,
  lineHeight: 10,
  diffHeaderHeight: 30,
  spacing: 4,
};
const lineInfoTrailingSeparatorHeight = metrics.spacing + 32;
const loadedFiles: FileDiffLoadedFiles = {
  oldFile: { name: 'file.ts', contents: 'const oldValue = 1;\n' },
  newFile: { name: 'file.ts', contents: 'const newValue = 2;\n' },
};

const virtualizer = {
  type: 'simple',
  config: {},
  connect() {},
  disconnect() {},
  getWindowSpecs() {
    return { top: 0, bottom: 1000 };
  },
  getOffsetInScrollContainer() {
    return 0;
  },
  instanceChanged() {},
  isInstanceVisible() {
    return true;
  },
} as never;

interface InspectableVirtualizedFileDiff {
  cache: {
    heightDeltas: Map<number, number>;
    measuredHeightDeltaTotal: number;
    estimatedSplitHeight: number | undefined;
    estimatedUnifiedHeight: number | undefined;
    checkpoints: unknown[];
    totalLines: number;
    fileAnnotationHeight: number;
  };
  lineAnnotations: unknown[];
  renderRange: RenderRange | undefined;
  getExpandedLineCount(
    fileDiff: FileDiffMetadata,
    diffStyle: 'split' | 'unified'
  ): number;
  fileContainer: HTMLElement | undefined;
  codeAdditions: HTMLElement | undefined;
  computeRenderRangeFromWindow(
    fileDiff: FileDiffMetadata,
    fileTop: number,
    window: RenderWindow
  ): RenderRange;
}

function inspect(
  instance: VirtualizedFileDiff
): InspectableVirtualizedFileDiff {
  return instance as unknown as InspectableVirtualizedFileDiff;
}

function createRenderRange(startingLine = 0): RenderRange {
  return {
    startingLine,
    totalLines: metrics.hunkLineCount,
    bufferBefore: 0,
    bufferAfter: 0,
  };
}

function createTwoHunkDiff(cacheKey = 'base'): FileDiffMetadata {
  const oldLines = Array.from({ length: 140 }, (_, index) => `${index + 1}`);
  const newLines = oldLines.map((line, index) => {
    if (index === 39) return `${cacheKey}-changed-40`;
    if (index === 99) return `${cacheKey}-changed-100`;
    return line;
  });

  return parseDiffFromFile(
    {
      name: 'two-hunks.ts',
      contents: `${oldLines.join('\n')}\n`,
      cacheKey: `${cacheKey}:old`,
    },
    {
      name: 'two-hunks.ts',
      contents: `${newLines.join('\n')}\n`,
      cacheKey: `${cacheKey}:new`,
    }
  );
}

function createLargeExpandedDiff(): FileDiffMetadata {
  const oldLines = Array.from({ length: 12_000 }, (_, index) => `${index + 1}`);
  const newLines = oldLines.map((line, index) =>
    index === 5_999 ? 'changed-6000' : line
  );

  return parseDiffFromFile(
    { name: 'large.ts', contents: `${oldLines.join('\n')}\n` },
    { name: 'large.ts', contents: `${newLines.join('\n')}\n` }
  );
}

function createHugeSingleBlockDiff(lineCount: number): FileDiffMetadata {
  return {
    name: 'huge.ts',
    type: 'change',
    hunks: [
      {
        collapsedBefore: 0,
        additionStart: 1,
        additionCount: lineCount,
        additionLines: 0,
        additionLineIndex: 0,
        deletionStart: 1,
        deletionCount: lineCount,
        deletionLines: 0,
        deletionLineIndex: 0,
        hunkContent: [
          {
            type: 'context',
            lines: lineCount,
            additionLineIndex: 0,
            deletionLineIndex: 0,
          },
        ],
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
    isPartial: true,
    deletionLines: [],
    additionLines: [],
  };
}

function createNoHunkDiff(): FileDiffMetadata {
  return {
    name: 'renamed.ts',
    prevName: 'old-name.ts',
    type: 'rename-pure',
    hunks: [],
    splitLineCount: 0,
    unifiedLineCount: 0,
    isPartial: false,
    deletionLines: [],
    additionLines: [],
  };
}

class FakeHTMLElement {
  public children: FakeHTMLElement[] = [];
  public dataset: Record<string, string> = {};
  public nextElementSibling: FakeHTMLElement | undefined;

  constructor(private readonly getHeight = () => 0) {}

  public append(...elements: FakeHTMLElement[]): void {
    this.children.push(...elements);
  }

  public getBoundingClientRect(): DOMRect {
    return { height: this.getHeight() } as DOMRect;
  }
}

function installFakeHTMLElement() {
  const originalValues = {
    HTMLElement: Reflect.get(globalThis, 'HTMLElement'),
  };

  Object.assign(globalThis, {
    HTMLElement: FakeHTMLElement,
  });

  return {
    cleanup() {
      for (const [key, value] of Object.entries(originalValues)) {
        if (value === undefined) {
          Reflect.deleteProperty(globalThis, key);
        } else {
          Object.assign(globalThis, { [key]: value });
        }
      }
    },
  };
}

function createMeasuredCodeGroup(
  lineIndex: string,
  getMeasuredHeight: () => number
): HTMLElement {
  const group = new FakeHTMLElement();
  const gutter = new FakeHTMLElement();
  const content = new FakeHTMLElement();
  const line = new FakeHTMLElement(getMeasuredHeight);
  line.dataset.lineIndex = lineIndex;
  content.append(line);
  group.append(gutter, content);
  return group as unknown as HTMLElement;
}

function createMeasuredCodeGroupWithFileLevelAnnotation(
  lineIndex: string,
  getAnnotationHeight: () => number,
  getMeasuredHeight: () => number
): HTMLElement {
  const group = new FakeHTMLElement();
  const gutter = new FakeHTMLElement();
  const content = new FakeHTMLElement();
  const annotation = new FakeHTMLElement(getAnnotationHeight);
  const line = new FakeHTMLElement(getMeasuredHeight);
  annotation.dataset.lineAnnotation = '-1,-1';
  line.dataset.lineIndex = lineIndex;
  content.append(annotation, line);
  group.append(gutter, content);
  return group as unknown as HTMLElement;
}

function createMeasuredCodeGroupWithCompetingAnnotationKeys(
  lineIndex: string,
  getFileAnnotationHeight: () => number,
  getFirstRowAnnotationHeight: () => number,
  getMeasuredHeight: () => number
): HTMLElement {
  const group = new FakeHTMLElement();
  const gutter = new FakeHTMLElement();
  const content = new FakeHTMLElement();
  const fileAnnotation = new FakeHTMLElement(getFileAnnotationHeight);
  const firstRowAnnotation = new FakeHTMLElement(getFirstRowAnnotationHeight);
  const line = new FakeHTMLElement(getMeasuredHeight);
  fileAnnotation.dataset.lineAnnotation = '-1,-1';
  firstRowAnnotation.dataset.lineAnnotation = '0,0';
  line.dataset.lineIndex = lineIndex;
  content.append(fileAnnotation, firstRowAnnotation, line);
  group.append(gutter, content);
  return group as unknown as HTMLElement;
}

function countIteratedRows(
  fileDiff: FileDiffMetadata,
  diffStyle: 'split' | 'unified',
  expandedHunks: Map<number, HunkExpansionRegion>
): number {
  let count = 0;
  iterateOverDiff({
    diff: fileDiff,
    diffStyle,
    expandedHunks,
    callback: () => {
      count++;
    },
  });
  return count;
}

describe('VirtualizedFileDiff estimated height cache', () => {
  test('computes split and unified estimates together on first prepare', () => {
    const instance = new VirtualizedFileDiff({}, virtualizer, metrics);

    instance.prepareCodeViewItem(createTwoHunkDiff(), 0);

    expect(inspect(instance).cache.estimatedSplitHeight).toBe(326);
    expect(inspect(instance).cache.estimatedUnifiedHeight).toBe(346);
    expect(inspect(instance).cache.measuredHeightDeltaTotal).toBe(0);
    expect(inspect(instance).cache.totalLines).toBe(0);
    expect(inspect(instance).cache.checkpoints).toEqual([]);
    expect(instance.getVirtualizedHeight()).toBe(326);
  });

  test('reserves synthetic bottom separator height for hydratable partial diffs', () => {
    const lineCount = 8;
    const instance = new VirtualizedFileDiff(
      { loadDiffFiles: () => Promise.resolve(loadedFiles) },
      virtualizer,
      metrics
    );

    instance.prepareCodeViewItem(createHugeSingleBlockDiff(lineCount), 0);

    expect(instance.getVirtualizedHeight()).toBe(
      metrics.diffHeaderHeight +
        lineCount * metrics.lineHeight +
        lineInfoTrailingSeparatorHeight +
        metrics.spacing
    );
  });

  test('recomputes estimates when file loader availability changes', () => {
    const lineCount = 8;
    const instance = new VirtualizedFileDiff({}, virtualizer, metrics);

    instance.prepareCodeViewItem(createHugeSingleBlockDiff(lineCount), 0);
    inspect(instance).cache.estimatedSplitHeight = 123;
    inspect(instance).cache.estimatedUnifiedHeight = 456;
    inspect(instance).cache.heightDeltas.set(0, 7);
    inspect(instance).cache.measuredHeightDeltaTotal = 7;

    instance.setOptions({ loadDiffFiles: () => Promise.resolve(loadedFiles) });

    expect(inspect(instance).cache.estimatedSplitHeight).toBe(
      metrics.diffHeaderHeight +
        lineCount * metrics.lineHeight +
        lineInfoTrailingSeparatorHeight +
        metrics.spacing
    );
    expect(inspect(instance).cache.estimatedUnifiedHeight).toBe(
      metrics.diffHeaderHeight +
        lineCount * metrics.lineHeight +
        lineInfoTrailingSeparatorHeight +
        metrics.spacing
    );
    expect(inspect(instance).cache.heightDeltas.size).toBe(0);
    expect(inspect(instance).cache.measuredHeightDeltaTotal).toBe(0);
    expect(instance.getVirtualizedHeight()).toBe(
      metrics.diffHeaderHeight +
        lineCount * metrics.lineHeight +
        lineInfoTrailingSeparatorHeight +
        metrics.spacing
    );
  });

  test('keeps estimates and measurements for an equivalent diff cache key', () => {
    const fileDiff = createTwoHunkDiff('same');
    const equivalentFileDiff = {
      ...fileDiff,
      hunks: [...fileDiff.hunks],
    };
    const instance = new VirtualizedFileDiff({}, virtualizer, metrics);

    instance.prepareCodeViewItem(fileDiff, 0);
    inspect(instance).cache.estimatedSplitHeight = 123;
    inspect(instance).cache.estimatedUnifiedHeight = 456;
    inspect(instance).cache.heightDeltas.set(0, 7);
    inspect(instance).cache.measuredHeightDeltaTotal = 7;
    instance.prepareCodeViewItem(equivalentFileDiff, 0);

    expect(inspect(instance).cache.estimatedSplitHeight).toBe(123);
    expect(inspect(instance).cache.estimatedUnifiedHeight).toBe(456);
    expect(inspect(instance).cache.heightDeltas.get(0)).toBe(7);
    expect(inspect(instance).cache.measuredHeightDeltaTotal).toBe(7);
  });

  test('clears estimates and measurements for changed diff content', () => {
    const instance = new VirtualizedFileDiff({}, virtualizer, metrics);

    instance.prepareCodeViewItem(createTwoHunkDiff('first'), 0);
    inspect(instance).cache.estimatedSplitHeight = 123;
    inspect(instance).cache.estimatedUnifiedHeight = 456;
    inspect(instance).cache.heightDeltas.set(0, 7);
    inspect(instance).cache.measuredHeightDeltaTotal = 7;
    instance.prepareCodeViewItem(createTwoHunkDiff('second'), 0);

    expect(inspect(instance).cache.estimatedSplitHeight).toBe(326);
    expect(inspect(instance).cache.estimatedUnifiedHeight).toBe(346);
    expect(inspect(instance).cache.heightDeltas.size).toBe(0);
    expect(inspect(instance).cache.measuredHeightDeltaTotal).toBe(0);
  });

  test('reuses paired estimates across split and unified style changes', () => {
    const instance = new VirtualizedFileDiff({}, virtualizer, metrics);

    instance.prepareCodeViewItem(createTwoHunkDiff(), 0);
    inspect(instance).cache.heightDeltas.set(0, 7);
    inspect(instance).cache.measuredHeightDeltaTotal = 7;
    expect(instance.getLinePosition(40, 'additions')).toBeDefined();
    expect(inspect(instance).cache.checkpoints.length).toBeGreaterThan(0);
    instance.setOptions({ diffStyle: 'unified' });

    expect(inspect(instance).cache.estimatedSplitHeight).toBe(326);
    expect(inspect(instance).cache.estimatedUnifiedHeight).toBe(346);
    expect(inspect(instance).cache.heightDeltas.size).toBe(0);
    expect(inspect(instance).cache.measuredHeightDeltaTotal).toBe(0);
    expect(inspect(instance).cache.checkpoints).toEqual([]);
    expect(inspect(instance).cache.totalLines).toBe(0);
    expect(instance.getVirtualizedHeight()).toBe(346);

    instance.setOptions({ diffStyle: 'split' });

    expect(inspect(instance).cache.estimatedSplitHeight).toBe(326);
    expect(inspect(instance).cache.estimatedUnifiedHeight).toBe(346);
    expect(instance.getVirtualizedHeight()).toBe(326);
  });

  test('keeps paired estimates across collapse changes', () => {
    const instance = new VirtualizedFileDiff({}, virtualizer, metrics);

    instance.prepareCodeViewItem(createTwoHunkDiff(), 0);
    inspect(instance).cache.heightDeltas.set(0, 7);
    inspect(instance).cache.measuredHeightDeltaTotal = 7;
    expect(instance.getLinePosition(40, 'additions')).toBeDefined();
    expect(inspect(instance).cache.checkpoints.length).toBeGreaterThan(0);
    instance.setOptions({ collapsed: true });

    expect(inspect(instance).cache.estimatedSplitHeight).toBe(326);
    expect(inspect(instance).cache.estimatedUnifiedHeight).toBe(346);
    expect(inspect(instance).cache.heightDeltas.size).toBe(0);
    expect(inspect(instance).cache.measuredHeightDeltaTotal).toBe(0);
    expect(inspect(instance).cache.checkpoints).toEqual([]);
    expect(inspect(instance).cache.totalLines).toBe(0);
    expect(instance.getVirtualizedHeight()).toBe(metrics.diffHeaderHeight);

    instance.setOptions({ collapsed: false });

    expect(inspect(instance).cache.estimatedSplitHeight).toBe(326);
    expect(inspect(instance).cache.estimatedUnifiedHeight).toBe(346);
    expect(instance.getVirtualizedHeight()).toBe(326);
  });

  test('recomputes paired estimates when hunk expansion changes', () => {
    const instance = new VirtualizedFileDiff({}, virtualizer, metrics);

    instance.prepareCodeViewItem(createTwoHunkDiff(), 0);
    inspect(instance).cache.heightDeltas.set(0, 7);
    inspect(instance).cache.measuredHeightDeltaTotal = 7;
    expect(instance.getLinePosition(40, 'additions')).toBeDefined();
    expect(inspect(instance).cache.checkpoints.length).toBeGreaterThan(0);
    instance.expandHunk(0, 'down', 5);

    expect(inspect(instance).cache.estimatedSplitHeight).toBe(376);
    expect(inspect(instance).cache.estimatedUnifiedHeight).toBe(396);
    expect(inspect(instance).cache.heightDeltas.size).toBe(0);
    expect(inspect(instance).cache.measuredHeightDeltaTotal).toBe(0);
    expect(inspect(instance).cache.checkpoints).toEqual([]);
    expect(inspect(instance).cache.totalLines).toBe(0);
    expect(instance.getVirtualizedHeight()).toBe(376);
  });

  test('applies measured height deltas without replaying full diff layout', () => {
    const { cleanup } = installFakeHTMLElement();
    try {
      const instance = new VirtualizedFileDiff(
        { overflow: 'wrap' },
        virtualizer,
        metrics
      );
      let measuredHeight = 17;

      instance.prepareCodeViewItem(createTwoHunkDiff(), 0);
      inspect(instance).fileContainer =
        new FakeHTMLElement() as unknown as HTMLElement;
      inspect(instance).codeAdditions = createMeasuredCodeGroup(
        '0,0',
        () => measuredHeight
      );

      expect(instance.reconcileHeights()).toBe(true);
      expect(inspect(instance).cache.heightDeltas.get(0)).toBe(7);
      expect(inspect(instance).cache.measuredHeightDeltaTotal).toBe(7);
      expect(inspect(instance).cache.totalLines).toBe(0);
      expect(inspect(instance).cache.checkpoints).toEqual([]);
      expect(instance.getVirtualizedHeight()).toBe(333);

      measuredHeight = 10;

      expect(instance.reconcileHeights()).toBe(true);
      expect(inspect(instance).cache.heightDeltas.size).toBe(0);
      expect(inspect(instance).cache.measuredHeightDeltaTotal).toBe(0);
      expect(inspect(instance).cache.totalLines).toBe(0);
      expect(inspect(instance).cache.checkpoints).toEqual([]);
      expect(instance.getVirtualizedHeight()).toBe(326);
    } finally {
      cleanup();
    }
  });

  test('does not reserve unmeasured file-level annotations above diff source rows', () => {
    const instance = new VirtualizedFileDiff({}, virtualizer, metrics);
    const lineCount = 1_000_000;

    instance.prepareCodeViewItem(
      createHugeSingleBlockDiff(lineCount),
      0,
      undefined,
      [{ side: 'additions', lineNumber: 0 }]
    );

    expect(instance.getVirtualizedHeight()).toBe(
      metrics.diffHeaderHeight +
        lineCount * metrics.lineHeight +
        metrics.spacing
    );
    expect(instance.getLinePosition(0, 'additions')).toBeUndefined();
    expect(instance.getLinePosition(900_000, 'additions')).toEqual({
      top: metrics.diffHeaderHeight + 899_999 * metrics.lineHeight,
      height: metrics.lineHeight,
    });
  });

  test('uses a top render range when measured file-level annotations are visible', () => {
    const instance = new VirtualizedFileDiff({}, virtualizer, metrics);
    const fileDiff = createTwoHunkDiff();

    instance.prepareCodeViewItem(fileDiff, 0, undefined, [
      { side: 'additions', lineNumber: 0 },
    ]);
    inspect(instance).cache.fileAnnotationHeight = 25;
    inspect(instance).cache.measuredHeightDeltaTotal = 25;
    instance.height = 351;

    const range = inspect(instance).computeRenderRangeFromWindow(fileDiff, 0, {
      top: metrics.diffHeaderHeight + 1,
      bottom: metrics.diffHeaderHeight + 24,
    });

    expect(range.startingLine).toBe(0);
    expect(range.totalLines).toBeGreaterThan(0);
    expect(range.bufferBefore).toBe(0);
  });

  test('does not use file-level annotation height to force top render ranges when only the header is visible', () => {
    const instance = new VirtualizedFileDiff({}, virtualizer, metrics);
    const fileDiff = createTwoHunkDiff();

    instance.prepareCodeViewItem(fileDiff, 0, undefined, [
      { side: 'additions', lineNumber: 0 },
    ]);
    inspect(instance).cache.fileAnnotationHeight = 25;
    inspect(instance).cache.measuredHeightDeltaTotal = 25;
    instance.height = 351;

    const range = inspect(instance).computeRenderRangeFromWindow(fileDiff, 0, {
      top: 1,
      bottom: metrics.diffHeaderHeight,
    });

    expect(range.totalLines).toBe(0);
  });

  test('includes top render range when the first diff row is visible with a zero-height file-level annotation', () => {
    const instance = new VirtualizedFileDiff({}, virtualizer, metrics);
    const fileDiff = createHugeSingleBlockDiff(1_000_000);

    instance.prepareCodeViewItem(fileDiff, 0, undefined, [
      { side: 'additions', lineNumber: 0 },
    ]);

    const range = inspect(instance).computeRenderRangeFromWindow(fileDiff, 0, {
      top: metrics.diffHeaderHeight,
      bottom: metrics.diffHeaderHeight + metrics.lineHeight,
    });

    expect(range.startingLine).toBe(0);
    expect(range.totalLines).toBeGreaterThan(0);
  });

  test('uses a final render range when only the synthetic bottom separator is visible', () => {
    const lineCount = 8;
    const fileDiff = createHugeSingleBlockDiff(lineCount);
    const instance = new VirtualizedFileDiff(
      { loadDiffFiles: () => Promise.resolve(loadedFiles) },
      virtualizer,
      metrics
    );

    instance.prepareCodeViewItem(fileDiff, 0);
    const separatorTop =
      metrics.diffHeaderHeight + lineCount * metrics.lineHeight;
    const range = inspect(instance).computeRenderRangeFromWindow(fileDiff, 0, {
      top: separatorTop + metrics.spacing + 1,
      bottom: separatorTop + metrics.spacing + 2,
    });

    expect(range.startingLine).toBe(4);
    expect(range.totalLines).toBeGreaterThan(0);
  });

  test('does not require measured file-level annotation height to render top content', () => {
    const instance = new VirtualizedFileDiff({}, virtualizer, metrics);
    const fileDiff = createHugeSingleBlockDiff(1_000_000);

    instance.prepareCodeViewItem(fileDiff, 0, undefined, [
      { side: 'additions', lineNumber: 0 },
    ]);
    inspect(instance).cache.fileAnnotationHeight = 0;

    const range = inspect(instance).computeRenderRangeFromWindow(fileDiff, 0, {
      top: metrics.diffHeaderHeight + 1,
      bottom: metrics.diffHeaderHeight + 2,
    });

    expect(range.startingLine).toBe(0);
    expect(range.totalLines).toBeGreaterThan(0);
    expect(range.bufferBefore).toBe(0);
  });

  test('uses a top render range for no-hunk diffs with file-level annotations', () => {
    const instance = new VirtualizedFileDiff({}, virtualizer, metrics);
    const fileDiff = createNoHunkDiff();

    instance.prepareCodeViewItem(fileDiff, 0, undefined, [
      { side: 'additions', lineNumber: 0 },
    ]);

    const range = inspect(instance).computeRenderRangeFromWindow(fileDiff, 0, {
      top: 0,
      bottom: 1,
    });

    expect(range.startingLine).toBe(0);
    expect(range.totalLines).toBeGreaterThan(0);
  });

  test('applies measured file-level annotation height', () => {
    const { cleanup } = installFakeHTMLElement();
    try {
      const instance = new VirtualizedFileDiff({}, virtualizer, metrics);
      let annotationHeight = 25;

      instance.prepareCodeViewItem(createTwoHunkDiff(), 0, undefined, [
        { side: 'additions', lineNumber: 0 },
      ]);
      inspect(instance).renderRange = createRenderRange();
      inspect(instance).fileContainer =
        new FakeHTMLElement() as unknown as HTMLElement;
      inspect(instance).codeAdditions =
        createMeasuredCodeGroupWithFileLevelAnnotation(
          '0,0',
          () => annotationHeight,
          () => metrics.lineHeight
        );

      expect(instance.getVirtualizedHeight()).toBe(326);
      expect(inspect(instance).cache.fileAnnotationHeight).toBe(0);
      expect(inspect(instance).cache.measuredHeightDeltaTotal).toBe(0);
      expect(instance.reconcileHeights()).toBe(true);
      expect(instance.getVirtualizedHeight()).toBe(351);
      expect(inspect(instance).cache.fileAnnotationHeight).toBe(25);
      expect(inspect(instance).cache.measuredHeightDeltaTotal).toBe(25);

      annotationHeight = metrics.lineHeight;

      expect(instance.reconcileHeights()).toBe(true);
      expect(instance.getVirtualizedHeight()).toBe(336);
      expect(inspect(instance).cache.fileAnnotationHeight).toBe(
        metrics.lineHeight
      );
      expect(inspect(instance).cache.measuredHeightDeltaTotal).toBe(
        metrics.lineHeight
      );
    } finally {
      cleanup();
    }
  });

  test('ignores first-row annotation keys when measuring file-level annotation height', () => {
    const { cleanup } = installFakeHTMLElement();
    try {
      const instance = new VirtualizedFileDiff({}, virtualizer, metrics);

      instance.prepareCodeViewItem(createTwoHunkDiff(), 0, undefined, [
        { side: 'additions', lineNumber: 0 },
      ]);
      inspect(instance).renderRange = createRenderRange();
      inspect(instance).fileContainer =
        new FakeHTMLElement() as unknown as HTMLElement;
      inspect(instance).codeAdditions =
        createMeasuredCodeGroupWithCompetingAnnotationKeys(
          '0,0',
          () => 25,
          () => 100,
          () => metrics.lineHeight
        );

      expect(instance.reconcileHeights()).toBe(true);
      expect(inspect(instance).cache.fileAnnotationHeight).toBe(25);
      expect(inspect(instance).cache.measuredHeightDeltaTotal).toBe(25);
      expect(instance.getVirtualizedHeight()).toBe(351);
    } finally {
      cleanup();
    }
  });

  test('preserves measured file-level annotation height when the row is not rendered', () => {
    const { cleanup } = installFakeHTMLElement();
    try {
      const instance = new VirtualizedFileDiff({}, virtualizer, metrics);
      const fileDiff = createTwoHunkDiff();

      instance.prepareCodeViewItem(fileDiff, 0, undefined, [
        { side: 'additions', lineNumber: 0 },
      ]);
      inspect(instance).renderRange = createRenderRange();
      inspect(instance).fileContainer =
        new FakeHTMLElement() as unknown as HTMLElement;
      inspect(instance).codeAdditions =
        createMeasuredCodeGroupWithFileLevelAnnotation(
          '0,0',
          () => 25,
          () => metrics.lineHeight
        );

      expect(instance.reconcileHeights()).toBe(true);
      expect(inspect(instance).cache.fileAnnotationHeight).toBe(25);
      expect(inspect(instance).cache.measuredHeightDeltaTotal).toBe(25);

      inspect(instance).renderRange = createRenderRange(metrics.hunkLineCount);
      inspect(instance).codeAdditions = createMeasuredCodeGroup(
        '0,0',
        () => metrics.lineHeight
      );

      expect(instance.reconcileHeights()).toBe(false);
      expect(inspect(instance).cache.fileAnnotationHeight).toBe(25);
      expect(inspect(instance).cache.measuredHeightDeltaTotal).toBe(25);
      expect(instance.getVirtualizedHeight()).toBe(351);
    } finally {
      cleanup();
    }
  });

  test('clears measured file-level annotation height when the expected row is missing', () => {
    const { cleanup } = installFakeHTMLElement();
    try {
      const instance = new VirtualizedFileDiff({}, virtualizer, metrics);
      const fileDiff = createTwoHunkDiff();

      instance.prepareCodeViewItem(fileDiff, 0, undefined, [
        { side: 'additions', lineNumber: 0 },
      ]);
      inspect(instance).renderRange = createRenderRange();
      inspect(instance).fileContainer =
        new FakeHTMLElement() as unknown as HTMLElement;
      inspect(instance).codeAdditions =
        createMeasuredCodeGroupWithFileLevelAnnotation(
          '0,0',
          () => 25,
          () => metrics.lineHeight
        );

      expect(instance.reconcileHeights()).toBe(true);
      expect(inspect(instance).cache.fileAnnotationHeight).toBe(25);
      expect(inspect(instance).cache.measuredHeightDeltaTotal).toBe(25);

      inspect(instance).codeAdditions = createMeasuredCodeGroup(
        '0,0',
        () => metrics.lineHeight
      );

      expect(instance.reconcileHeights()).toBe(true);
      expect(inspect(instance).cache.fileAnnotationHeight).toBe(0);
      expect(inspect(instance).cache.measuredHeightDeltaTotal).toBe(0);
      expect(instance.getVirtualizedHeight()).toBe(326);
    } finally {
      cleanup();
    }
  });

  test('clears measured file-level annotation height when annotations change', () => {
    const { cleanup } = installFakeHTMLElement();
    try {
      const instance = new VirtualizedFileDiff({}, virtualizer, metrics);
      const fileDiff = createTwoHunkDiff();

      instance.prepareCodeViewItem(fileDiff, 0, undefined, [
        { side: 'additions', lineNumber: 0 },
      ]);
      inspect(instance).renderRange = createRenderRange();
      inspect(instance).fileContainer =
        new FakeHTMLElement() as unknown as HTMLElement;
      inspect(instance).codeAdditions =
        createMeasuredCodeGroupWithFileLevelAnnotation(
          '0,0',
          () => 25,
          () => metrics.lineHeight
        );

      expect(instance.reconcileHeights()).toBe(true);
      expect(inspect(instance).cache.fileAnnotationHeight).toBe(25);
      expect(inspect(instance).cache.measuredHeightDeltaTotal).toBe(25);
      expect(instance.getVirtualizedHeight()).toBe(351);

      instance.prepareCodeViewItem(fileDiff, 0, undefined, [
        { side: 'additions', lineNumber: 1 },
      ]);

      expect(inspect(instance).cache.fileAnnotationHeight).toBe(0);
      expect(inspect(instance).cache.measuredHeightDeltaTotal).toBe(0);
      expect(instance.getVirtualizedHeight()).toBe(326);
    } finally {
      cleanup();
    }
  });

  test('clears measured file-level annotation height when recycled without annotations', () => {
    const { cleanup } = installFakeHTMLElement();
    try {
      const instance = new VirtualizedFileDiff({}, virtualizer, metrics);
      const fileDiff = createTwoHunkDiff();

      instance.prepareCodeViewItem(fileDiff, 0, undefined, [
        { side: 'additions', lineNumber: 0 },
      ]);
      inspect(instance).renderRange = createRenderRange();
      inspect(instance).fileContainer =
        new FakeHTMLElement() as unknown as HTMLElement;
      inspect(instance).codeAdditions =
        createMeasuredCodeGroupWithFileLevelAnnotation(
          '0,0',
          () => 25,
          () => metrics.lineHeight
        );
      expect(instance.reconcileHeights()).toBe(true);
      expect(instance.getVirtualizedHeight()).toBe(351);
      expect(inspect(instance).cache.fileAnnotationHeight).toBe(25);
      expect(inspect(instance).cache.measuredHeightDeltaTotal).toBe(25);

      inspect(instance).fileContainer = undefined;
      instance.cleanUp(true);

      expect(inspect(instance).lineAnnotations).toHaveLength(1);

      instance.prepareCodeViewItem(fileDiff, 0, undefined, []);

      expect(inspect(instance).cache.fileAnnotationHeight).toBe(0);
      expect(inspect(instance).cache.measuredHeightDeltaTotal).toBe(0);
      expect(inspect(instance).lineAnnotations).toHaveLength(0);
      expect(instance.getVirtualizedHeight()).toBe(326);
    } finally {
      cleanup();
    }
  });

  test('builds layout checkpoints lazily for deep geometry lookups', () => {
    const instance = new VirtualizedFileDiff(
      { expandUnchanged: true },
      virtualizer,
      metrics
    );

    instance.prepareCodeViewItem(createLargeExpandedDiff(), 0);
    const estimatedHeight = instance.getVirtualizedHeight();

    expect(inspect(instance).cache.totalLines).toBe(0);
    expect(inspect(instance).cache.checkpoints).toEqual([]);

    expect(instance.getLinePosition(10_000, 'additions')).toBeDefined();

    expect(instance.getVirtualizedHeight()).toBe(estimatedHeight);
    expect(inspect(instance).cache.totalLines).toBeGreaterThan(10_000);
    expect(inspect(instance).cache.checkpoints.length).toBeGreaterThan(1);
  });

  test('builds layout checkpoints lazily for deep render windows', () => {
    const instance = new VirtualizedFileDiff(
      { expandUnchanged: true },
      virtualizer,
      metrics
    );

    instance.prepareCodeViewItem(createLargeExpandedDiff(), 0);
    const estimatedHeight = instance.getVirtualizedHeight();

    expect(inspect(instance).cache.totalLines).toBe(0);
    expect(inspect(instance).cache.checkpoints).toEqual([]);

    expect(
      instance.getAdvancedStickySpecs({ top: 100_000, bottom: 100_500 })
    ).toBeDefined();

    expect(instance.getVirtualizedHeight()).toBe(estimatedHeight);
    expect(inspect(instance).cache.totalLines).toBeGreaterThan(10_000);
    expect(inspect(instance).cache.checkpoints.length).toBeGreaterThan(1);
  });

  test('ignores trailing fromEnd expansion in render range line totals', () => {
    const { cleanup } = installDom();
    const fileDiff = createTwoHunkDiff();
    const trailingHunkIndex = fileDiff.hunks.length;
    const fromStartOnly = new Map<number, HunkExpansionRegion>([
      [trailingHunkIndex, { fromStart: 2, fromEnd: 0 }],
    ]);
    const instance = new VirtualizedFileDiff({}, virtualizer, metrics);

    try {
      instance.render({
        fileContainer: document.createElement('div'),
        fileDiff,
        deferManagers: true,
        preventEmit: true,
      });
      instance.expandHunk(trailingHunkIndex, 'up', 2);
      instance.expandHunk(trailingHunkIndex, 'down', 3);

      expect(inspect(instance).getExpandedLineCount(fileDiff, 'split')).toBe(
        countIteratedRows(fileDiff, 'split', fromStartOnly)
      );
      expect(inspect(instance).getExpandedLineCount(fileDiff, 'unified')).toBe(
        countIteratedRows(fileDiff, 'unified', fromStartOnly)
      );
    } finally {
      instance.cleanUp();
      cleanup();
    }
  });

  test('checkpoint generation jumps through large uniform blocks', () => {
    const instance = new VirtualizedFileDiff({}, virtualizer, metrics);
    const lineCount = 1_000_000;

    instance.prepareCodeViewItem(createHugeSingleBlockDiff(lineCount), 0);

    expect(instance.getLinePosition(900_000, 'additions')).toEqual({
      top: metrics.diffHeaderHeight + 899_999 * metrics.lineHeight,
      height: metrics.lineHeight,
    });
    expect(inspect(instance).cache.totalLines).toBe(lineCount);
    expect(inspect(instance).cache.checkpoints.length).toBe(
      Math.floor((lineCount - 1) / LAYOUT_CHECKPOINT_INTERVAL) + 1
    );
  });
});
