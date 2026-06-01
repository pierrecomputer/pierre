import { describe, expect, test } from 'bun:test';

import { VirtualizedFileDiff } from '../src/components/VirtualizedFileDiff';
import { DEFAULT_CODE_VIEW_FILE_METRICS } from '../src/constants';
import type {
  FileDiffMetadata,
  HunkExpansionRegion,
  VirtualFileMetrics,
} from '../src/types';
import { iterateOverDiff } from '../src/utils/iterateOverDiff';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';

const metrics: VirtualFileMetrics = {
  ...DEFAULT_CODE_VIEW_FILE_METRICS,
  hunkLineCount: 2,
  lineHeight: 10,
  diffHeaderHeight: 30,
  spacing: 4,
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
  };
  getExpandedLineCount(
    fileDiff: FileDiffMetadata,
    diffStyle: 'split' | 'unified'
  ): number;
  fileContainer: HTMLElement | undefined;
  codeAdditions: HTMLElement | undefined;
}

function inspect(
  instance: VirtualizedFileDiff
): InspectableVirtualizedFileDiff {
  return instance as unknown as InspectableVirtualizedFileDiff;
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
    const fileDiff = createTwoHunkDiff();
    const trailingHunkIndex = fileDiff.hunks.length;
    const fromStartOnly = new Map<number, HunkExpansionRegion>([
      [trailingHunkIndex, { fromStart: 2, fromEnd: 0 }],
    ]);
    const instance = new VirtualizedFileDiff({}, virtualizer, metrics);

    instance.expandHunk(trailingHunkIndex, 'up', 2);
    instance.expandHunk(trailingHunkIndex, 'down', 3);

    expect(inspect(instance).getExpandedLineCount(fileDiff, 'split')).toBe(
      countIteratedRows(fileDiff, 'split', fromStartOnly)
    );
    expect(inspect(instance).getExpandedLineCount(fileDiff, 'unified')).toBe(
      countIteratedRows(fileDiff, 'unified', fromStartOnly)
    );
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
      Math.floor((lineCount - 1) / 5_000) + 1
    );
  });
});
