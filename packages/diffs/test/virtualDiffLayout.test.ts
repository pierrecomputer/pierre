import { describe, expect, test } from 'bun:test';

import type {
  FileDiffMetadata,
  Hunk,
  HunkSeparators,
  VirtualFileMetrics,
} from '../src/types';
import { type DiffLines, plainLines } from '../src/utils/diffLines';
import {
  getExpandedRegion,
  getLeadingHunkSeparatorLayout,
  getTrailingContextRangeSize,
  getTrailingExpandedRegion,
  getTrailingHunkSeparatorLayout,
} from '../src/utils/virtualDiffLayout';

const metrics: VirtualFileMetrics = {
  hunkLineCount: 2,
  lineHeight: 10,
  diffHeaderHeight: 30,
  spacing: 4,
};

describe('virtual diff layout helpers', () => {
  describe('getExpandedRegion', () => {
    test('keeps collapsed ranges collapsed by default', () => {
      expect(
        getExpandedRegion({
          isPartial: false,
          rangeSize: 10,
          expandedHunks: undefined,
          hunkIndex: 1,
          collapsedContextThreshold: 1,
        })
      ).toEqual({
        fromStart: 0,
        fromEnd: 0,
        rangeSize: 10,
        collapsedLines: 10,
        renderAll: false,
      });
    });

    test('expands all lines for expandUnchanged or small ranges', () => {
      expect(
        getExpandedRegion({
          isPartial: false,
          rangeSize: 10,
          expandedHunks: true,
          hunkIndex: 1,
          collapsedContextThreshold: 1,
        })
      ).toEqual({
        fromStart: 10,
        fromEnd: 0,
        rangeSize: 10,
        collapsedLines: 0,
        renderAll: true,
      });

      expect(
        getExpandedRegion({
          isPartial: false,
          rangeSize: 1,
          expandedHunks: undefined,
          hunkIndex: 1,
          collapsedContextThreshold: 1,
        })
      ).toEqual({
        fromStart: 1,
        fromEnd: 0,
        rangeSize: 1,
        collapsedLines: 0,
        renderAll: true,
      });
    });

    test('clamps explicit expansion regions to the collapsed range', () => {
      const expandedHunks = new Map([[1, { fromStart: 3, fromEnd: 20 }]]);

      expect(
        getExpandedRegion({
          isPartial: false,
          rangeSize: 10,
          expandedHunks,
          hunkIndex: 1,
          collapsedContextThreshold: 1,
        })
      ).toEqual({
        fromStart: 10,
        fromEnd: 0,
        rangeSize: 10,
        collapsedLines: 0,
        renderAll: true,
      });
    });

    test('keeps partial diffs collapsed even with expansion state', () => {
      expect(
        getExpandedRegion({
          isPartial: true,
          rangeSize: 10,
          expandedHunks: true,
          hunkIndex: 1,
          collapsedContextThreshold: 1,
        })
      ).toEqual({
        fromStart: 0,
        fromEnd: 0,
        rangeSize: 10,
        collapsedLines: 10,
        renderAll: false,
      });
    });
  });

  describe('getTrailingExpandedRegion', () => {
    test('preserves known trailing context only for full diffs', () => {
      const fileDiff = createTrailingDiff(5);

      expect(
        getTrailingContextRangeSize({
          fileDiff,
          errorPrefix: 'virtualDiffLayout.test',
        })
      ).toBe(5);
      expect(
        getTrailingContextRangeSize({
          fileDiff: { ...fileDiff, isPartial: true },
          errorPrefix: 'virtualDiffLayout.test',
        })
      ).toBe(0);
    });

    test('ignores unsupported final trailing fromEnd expansion', () => {
      const fileDiff = createTrailingDiff(5);

      expect(
        getTrailingExpandedRegion({
          fileDiff,
          hunkIndex: 0,
          expandedHunks: new Map([[1, { fromStart: 2, fromEnd: 3 }]]),
          collapsedContextThreshold: 0,
          errorPrefix: 'virtualDiffLayout.test',
        })
      ).toEqual({
        fromStart: 2,
        fromEnd: 0,
        rangeSize: 5,
        collapsedLines: 3,
        renderAll: false,
      });
    });

    test('expands all final trailing context from the start', () => {
      const fileDiff = createTrailingDiff(5);

      expect(
        getTrailingExpandedRegion({
          fileDiff,
          hunkIndex: 0,
          expandedHunks: true,
          collapsedContextThreshold: 0,
          errorPrefix: 'virtualDiffLayout.test',
        })
      ).toEqual({
        fromStart: 5,
        fromEnd: 0,
        rangeSize: 5,
        collapsedLines: 0,
        renderAll: true,
      });

      expect(
        getTrailingExpandedRegion({
          fileDiff,
          hunkIndex: 0,
          expandedHunks: new Map([
            [
              1,
              {
                fromStart: Number.POSITIVE_INFINITY,
                fromEnd: Number.POSITIVE_INFINITY,
              },
            ],
          ]),
          collapsedContextThreshold: 0,
          errorPrefix: 'virtualDiffLayout.test',
        })
      ).toEqual({
        fromStart: 5,
        fromEnd: 0,
        rangeSize: 5,
        collapsedLines: 0,
        renderAll: true,
      });
    });
  });

  describe('separator layouts', () => {
    test('preserves current leading separator rules', () => {
      const cases: [
        type: HunkSeparators,
        hunkIndex: number,
        hunkSpecs: string | undefined,
        totalHeight: number | undefined,
      ][] = [
        ['simple', 0, '@@ -1 +1 @@', undefined],
        ['simple', 1, '@@ -1 +1 @@', 4],
        ['metadata', 0, undefined, undefined],
        ['metadata', 0, '@@ -1 +1 @@', 32],
        ['line-info', 0, '@@ -1 +1 @@', 36],
        ['line-info', 1, '@@ -1 +1 @@', 40],
        ['line-info-basic', 0, '@@ -1 +1 @@', 32],
        ['custom', 0, '@@ -1 +1 @@', 36],
        ['custom', 1, '@@ -1 +1 @@', 40],
      ];

      for (const [type, hunkIndex, hunkSpecs, totalHeight] of cases) {
        expect(
          getLeadingHunkSeparatorLayout({
            type,
            metrics,
            hunkIndex,
            hunkSpecs,
          })?.totalHeight
        ).toBe(totalHeight);
      }
    });

    test('preserves current trailing separator rules', () => {
      const cases: [type: HunkSeparators, totalHeight: number | undefined][] = [
        ['simple', undefined],
        ['metadata', undefined],
        ['line-info', 36],
        ['line-info-basic', 32],
        ['custom', 36],
      ];

      for (const [type, totalHeight] of cases) {
        expect(
          getTrailingHunkSeparatorLayout({ type, metrics })?.totalHeight
        ).toBe(totalHeight);
      }
    });

    test('uses custom hunk separator height metrics', () => {
      expect(
        getLeadingHunkSeparatorLayout({
          type: 'line-info',
          metrics: { ...metrics, hunkSeparatorHeight: 12 },
          hunkIndex: 1,
          hunkSpecs: '@@ -1 +1 @@',
        })?.totalHeight
      ).toBe(20);
    });
  });
});

function createTrailingDiff(trailingLineCount: number): FileDiffMetadata {
  const hunk: Hunk = {
    collapsedBefore: 0,
    additionStart: 1,
    additionCount: 2,
    additionLines: 0,
    additionLineIndex: 0,
    deletionStart: 1,
    deletionCount: 2,
    deletionLines: 0,
    deletionLineIndex: 0,
    hunkContent: [
      {
        type: 'context',
        lines: 2,
        deletionLineIndex: 0,
        additionLineIndex: 0,
      },
    ],
    hunkSpecs: '@@ -1,2 +1,2 @@',
    splitLineStart: 0,
    splitLineCount: 2,
    unifiedLineStart: 0,
    unifiedLineCount: 2,
    noEOFCRDeletions: false,
    noEOFCRAdditions: false,
  };

  return {
    name: 'trailing.ts',
    type: 'change',
    hunks: [hunk],
    splitLineCount: 2 + trailingLineCount,
    unifiedLineCount: 2 + trailingLineCount,
    isPartial: false,
    deletionLines: createLines(2 + trailingLineCount),
    additionLines: createLines(2 + trailingLineCount),
  };
}

function createLines(count: number): DiffLines {
  return plainLines(
    Array.from({ length: count }, (_, index) => `line ${index}\n`)
  );
}
