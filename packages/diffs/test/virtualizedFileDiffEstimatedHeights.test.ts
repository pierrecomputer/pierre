import { describe, expect, test } from 'bun:test';

import { VirtualizedFileDiff } from '../src/components/VirtualizedFileDiff';
import { DEFAULT_CODE_VIEW_FILE_METRICS } from '../src/constants';
import type { FileDiffMetadata, VirtualFileMetrics } from '../src/types';
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
    heights: Map<number, number>;
    estimatedSplitHeight: number | undefined;
    estimatedUnifiedHeight: number | undefined;
    checkpoints: unknown[];
    totalLines: number;
  };
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

describe('VirtualizedFileDiff estimated height cache', () => {
  test('computes split and unified estimates together on first prepare', () => {
    const instance = new VirtualizedFileDiff({}, virtualizer, metrics);

    instance.prepareCodeViewItem(createTwoHunkDiff());

    expect(inspect(instance).cache.estimatedSplitHeight).toBe(326);
    expect(inspect(instance).cache.estimatedUnifiedHeight).toBe(346);
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

    instance.prepareCodeViewItem(fileDiff);
    inspect(instance).cache.estimatedSplitHeight = 123;
    inspect(instance).cache.estimatedUnifiedHeight = 456;
    inspect(instance).cache.heights.set(0, 999);
    instance.prepareCodeViewItem(equivalentFileDiff);

    expect(inspect(instance).cache.estimatedSplitHeight).toBe(123);
    expect(inspect(instance).cache.estimatedUnifiedHeight).toBe(456);
    expect(inspect(instance).cache.heights.get(0)).toBe(999);
  });

  test('clears estimates and measurements for changed diff content', () => {
    const instance = new VirtualizedFileDiff({}, virtualizer, metrics);

    instance.prepareCodeViewItem(createTwoHunkDiff('first'));
    inspect(instance).cache.estimatedSplitHeight = 123;
    inspect(instance).cache.estimatedUnifiedHeight = 456;
    inspect(instance).cache.heights.set(0, 999);
    instance.prepareCodeViewItem(createTwoHunkDiff('second'));

    expect(inspect(instance).cache.estimatedSplitHeight).toBe(326);
    expect(inspect(instance).cache.estimatedUnifiedHeight).toBe(346);
    expect(inspect(instance).cache.heights.size).toBe(0);
  });

  test('reuses paired estimates across split and unified style changes', () => {
    const instance = new VirtualizedFileDiff({}, virtualizer, metrics);

    instance.prepareCodeViewItem(createTwoHunkDiff());
    instance.setOptions({ diffStyle: 'unified' });

    expect(inspect(instance).cache.estimatedSplitHeight).toBe(326);
    expect(inspect(instance).cache.estimatedUnifiedHeight).toBe(346);
    expect(instance.getVirtualizedHeight()).toBe(346);

    instance.setOptions({ diffStyle: 'split' });

    expect(inspect(instance).cache.estimatedSplitHeight).toBe(326);
    expect(inspect(instance).cache.estimatedUnifiedHeight).toBe(346);
    expect(instance.getVirtualizedHeight()).toBe(326);
  });

  test('keeps paired estimates across collapse changes', () => {
    const instance = new VirtualizedFileDiff({}, virtualizer, metrics);

    instance.prepareCodeViewItem(createTwoHunkDiff());
    instance.setOptions({ collapsed: true });

    expect(inspect(instance).cache.estimatedSplitHeight).toBe(326);
    expect(inspect(instance).cache.estimatedUnifiedHeight).toBe(346);
    expect(instance.getVirtualizedHeight()).toBe(metrics.diffHeaderHeight);

    instance.setOptions({ collapsed: false });

    expect(inspect(instance).cache.estimatedSplitHeight).toBe(326);
    expect(inspect(instance).cache.estimatedUnifiedHeight).toBe(346);
    expect(instance.getVirtualizedHeight()).toBe(326);
  });

  test('recomputes paired estimates when hunk expansion changes', () => {
    const instance = new VirtualizedFileDiff({}, virtualizer, metrics);

    instance.prepareCodeViewItem(createTwoHunkDiff());
    instance.expandHunk(0, 'down', 5);

    expect(inspect(instance).cache.estimatedSplitHeight).toBe(376);
    expect(inspect(instance).cache.estimatedUnifiedHeight).toBe(396);
    expect(instance.getVirtualizedHeight()).toBe(376);
  });
});
