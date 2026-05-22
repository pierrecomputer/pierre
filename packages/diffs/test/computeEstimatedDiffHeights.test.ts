import { describe, expect, test } from 'bun:test';

import { DEFAULT_COLLAPSED_CONTEXT_THRESHOLD } from '../src/constants';
import type { FileDiffMetadata, VirtualFileMetrics } from '../src/types';
import {
  computeEstimatedDiffHeights,
  type ComputeEstimatedDiffHeightsOptions,
} from '../src/utils/computeEstimatedDiffHeights';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';

const metrics: VirtualFileMetrics = {
  hunkLineCount: 2,
  lineHeight: 10,
  diffHeaderHeight: 30,
  spacing: 4,
};

function createTwoHunkDiff(): FileDiffMetadata {
  const oldLines = Array.from({ length: 140 }, (_, index) => `${index + 1}`);
  const newLines = oldLines.map((line, index) => {
    if (index === 39) return 'changed-40';
    if (index === 99) return 'changed-100';
    return line;
  });

  return parseDiffFromFile(
    { name: 'two-hunks.ts', contents: `${oldLines.join('\n')}\n` },
    { name: 'two-hunks.ts', contents: `${newLines.join('\n')}\n` }
  );
}

function compute(
  fileDiff: FileDiffMetadata,
  options: Partial<
    Omit<ComputeEstimatedDiffHeightsOptions, 'fileDiff' | 'metrics'>
  > & { metrics?: VirtualFileMetrics } = {}
) {
  const { metrics: overrideMetrics = metrics, ...rest } = options;
  return computeEstimatedDiffHeights({
    fileDiff,
    metrics: overrideMetrics,
    disableFileHeader: false,
    hunkSeparators: 'line-info',
    expandUnchanged: false,
    expandedHunks: undefined,
    collapsedContextThreshold: DEFAULT_COLLAPSED_CONTEXT_THRESHOLD,
    ...rest,
  });
}

describe('computeEstimatedDiffHeights', () => {
  test('returns only the top region when a diff has no hunks', () => {
    const fileDiff = parseDiffFromFile(
      { name: 'same.ts', contents: 'one\n' },
      { name: 'same.ts', contents: 'one\n' }
    );

    expect(
      compute(fileDiff, {
        metrics: { ...metrics, paddingTop: 6, paddingBottom: 13 },
      })
    ).toEqual({
      splitHeight: 36,
      unifiedHeight: 36,
    });
  });

  test('computes split and unified heights with no-newline metadata rows', () => {
    const fileDiff = parseDiffFromFile(
      { name: 'no-newline.ts', contents: 'one\ntwo' },
      { name: 'no-newline.ts', contents: 'one\nTWO' }
    );

    expect(compute(fileDiff)).toEqual({
      splitHeight: 64,
      unifiedHeight: 84,
    });
  });

  test('computes split metadata when the no-newline deletion side is shorter', () => {
    const fileDiff = parseDiffFromFile(
      { name: 'deletion-shorter.ts', contents: 'same\nold-final' },
      { name: 'deletion-shorter.ts', contents: 'same\nnew-a\nnew-b\n' }
    );

    expect(compute(fileDiff)).toEqual({
      splitHeight: 74,
      unifiedHeight: 84,
    });
  });

  test('computes split metadata when the no-newline addition side is shorter', () => {
    const fileDiff = parseDiffFromFile(
      { name: 'addition-shorter.ts', contents: 'same\nold-a\nold-b\n' },
      { name: 'addition-shorter.ts', contents: 'same\nnew-final' }
    );

    expect(compute(fileDiff)).toEqual({
      splitHeight: 74,
      unifiedHeight: 84,
    });
  });

  test('accounts for collapsed leading and trailing line-info separators', () => {
    const fileDiff = createTwoHunkDiff();

    expect(compute(fileDiff)).toEqual({
      splitHeight: 326,
      unifiedHeight: 346,
    });
  });

  test('preserves current simple separator behavior', () => {
    const fileDiff = createTwoHunkDiff();

    expect(compute(fileDiff, { hunkSeparators: 'simple' })).toEqual({
      splitHeight: 218,
      unifiedHeight: 238,
    });
  });

  test('expands unchanged context as rows without separators', () => {
    const fileDiff = createTwoHunkDiff();

    expect(compute(fileDiff, { expandUnchanged: true })).toEqual({
      splitHeight: 1434,
      unifiedHeight: 1454,
    });
  });

  test('accounts for partially expanded leading context', () => {
    const fileDiff = createTwoHunkDiff();
    const expandedHunks = new Map([[0, { fromStart: 2, fromEnd: 3 }]]);

    expect(compute(fileDiff, { expandedHunks })).toEqual({
      splitHeight: 376,
      unifiedHeight: 396,
    });
  });

  test('does not estimate trailing collapsed context for partial diffs', () => {
    const fileDiff = { ...createTwoHunkDiff(), isPartial: true };

    expect(compute(fileDiff)).toEqual({
      splitHeight: 290,
      unifiedHeight: 310,
    });
  });

  test('reserves metadata separators only for hunk specs', () => {
    const fileDiff = createTwoHunkDiff();

    expect(compute(fileDiff, { hunkSeparators: 'metadata' })).toEqual({
      splitHeight: 278,
      unifiedHeight: 298,
    });
  });
});
