import { describe, expect, test } from 'bun:test';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';

import { parseDiffFromFile } from '../src';
import { FileDiff as ReactFileDiff } from '../src/react/FileDiff';
import { DiffHunksRenderer } from '../src/renderers/DiffHunksRenderer';
import type {
  FileDiffMetadata,
  FoldedRange,
  ResolvedDiffFold,
  VirtualFileMetrics,
} from '../src/types';
import { computeEstimatedDiffHeights } from '../src/utils/computeEstimatedDiffHeights';
import { DiffRowCursor } from '../src/utils/DiffRowCursor';
import { resolveFoldedRanges } from '../src/utils/foldedDiffRanges';
import { getFoldSeparatorLayout } from '../src/utils/virtualDiffLayout';
import { installDom, wait, waitFor } from './domHarness';

const metrics: VirtualFileMetrics = {
  hunkLineCount: 8,
  lineHeight: 20,
  diffHeaderHeight: 30,
  spacing: 4,
};

function lines(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix} ${index + 1}`);
}

// Two hunks, each shaped context / change / context. Hunk 0's change block is
// 2 deletions against 3 additions, which is what makes the split-pairing and
// unified/split row counts differ.
//
// Hunk 0: context additions 7-10 (rows 6-9), change additions 11-13
// (unified rows 10-14, split rows 10-12), context additions 14-17.
// Hunk 1: context additions 30-33 (unified rows 31-34).
const diff: FileDiffMetadata = parseDiffFromFile(
  {
    name: 'fixture.txt',
    contents: [
      ...lines('head', 10),
      'old one',
      'old two',
      ...lines('middle', 20),
      'old three',
      ...lines('tail', 10),
    ].join('\n'),
  },
  {
    name: 'fixture.txt',
    contents: [
      ...lines('head', 10),
      'new one',
      'new two',
      'new three',
      ...lines('middle', 20),
      'new four',
      ...lines('tail', 10),
    ].join('\n'),
  }
);

interface CollectedRow {
  foldSeparators: ResolvedDiffFold[] | undefined;
  deletionLine: { lineNumber: number } | undefined;
  additionLine: { lineNumber: number } | undefined;
}

function collectRows(
  diffStyle: 'unified' | 'split',
  foldedRanges?: FoldedRange[],
  startingLine = 0
): CollectedRow[] {
  const rows: CollectedRow[] = [];
  const cursor = new DiffRowCursor({
    diff,
    diffStyle,
    startingLine,
    folds: resolve(foldedRanges),
  });
  while (cursor.next()) {
    rows.push({
      foldSeparators: cursor.foldSeparators,
      deletionLine: cursor.hasDeletion
        ? { lineNumber: cursor.deletionLineNumber }
        : undefined,
      additionLine: cursor.hasAddition
        ? { lineNumber: cursor.additionLineNumber }
        : undefined,
    });
  }
  return rows;
}

// One hunk: four unchanged lines, then a block of twenty added lines.
const addedBlockDiff: FileDiffMetadata = parseDiffFromFile(
  { name: 'added.ts', contents: [...lines('head', 5), ''].join('\n') },
  {
    name: 'added.ts',
    contents: [
      ...lines('head', 5),
      'function f() {',
      ...lines('  call', 18),
      '}',
      '',
    ].join('\n'),
  }
);

function resolve(
  foldedRanges: FoldedRange[] | undefined,
  expandedFolds?: number[]
): ResolvedDiffFold[] {
  return resolveFoldedRanges({
    fileDiff: diff,
    foldedRanges,
    expandedFolds,
  });
}

function estimate(foldedRanges?: FoldedRange[], expandedFolds?: number[]) {
  return computeEstimatedDiffHeights({
    fileDiff: diff,
    metrics,
    disableFileHeader: false,
    hunkSeparators: 'line-info',
    expandUnchanged: false,
    expandedHunks: undefined,
    collapsedContextThreshold: 2,
    canHydratePartialDiff: false,
    folds: resolve(foldedRanges, expandedFolds),
  });
}

function separators(rows: CollectedRow[]) {
  return rows.flatMap((row) => (row.foldSeparators == null ? [] : [row]));
}

describe('foldedRanges', () => {
  describe('rendered rows', () => {
    test('one separator replaces the run, on the first line after it', () => {
      const rows = collectRows('unified', [
        { side: 'additions', start: 7, end: 10, label: 'moved from utils.ts' },
      ]);
      const [separator, ...rest] = separators(rows);

      expect(rest).toEqual([]);
      expect(separator?.foldSeparators).toMatchObject([
        {
          index: 0,
          side: 'additions',
          start: 7,
          end: 10,
          lines: 4,
          label: 'moved from utils.ts',
          unifiedRows: 4,
          splitRows: 4,
        },
      ]);
      expect(separator?.deletionLine?.lineNumber).toBe(11);
    });

    test('a range inside a context run folds only its own slice', () => {
      const baseline = collectRows('unified');
      const rows = collectRows('unified', [
        { side: 'additions', start: 8, end: 9 },
      ]);

      expect(baseline.length - rows.length).toBe(2);
      expect(rows.some((row) => row.additionLine?.lineNumber === 7)).toBe(true);
      expect(rows.some((row) => row.additionLine?.lineNumber === 8)).toBe(
        false
      );
      expect(rows.some((row) => row.additionLine?.lineNumber === 10)).toBe(
        true
      );
    });

    test('folding a change block takes its paired rows in split view', () => {
      const range: FoldedRange[] = [{ side: 'additions', start: 11, end: 13 }];
      const unifiedBaseline = collectRows('unified');
      const splitBaseline = collectRows('split');

      // Unified renders the block's 2 deletions and 3 additions as 5 rows;
      // split pairs them into 3. The fold takes whichever the layout drew.
      expect(
        unifiedBaseline.length - collectRows('unified', range).length
      ).toBe(5);
      expect(splitBaseline.length - collectRows('split', range).length).toBe(3);

      // The paired deletions go with it rather than leaving orphaned rows.
      expect(
        collectRows('split', range).some(
          (row) => row.deletionLine?.lineNumber === 11
        )
      ).toBe(false);
    });

    test('a walk that starts mid-file yields the rows a full walk does', () => {
      const ranges: FoldedRange[] = [
        { side: 'additions', start: 8, end: 9 },
        { side: 'additions', start: 11, end: 13 },
        { side: 'additions', start: 30, end: 31 },
      ];
      for (const diffStyle of ['unified', 'split'] as const) {
        const full = collectRows(diffStyle, ranges);
        for (let start = 1; start < full.length; start++) {
          const windowed = collectRows(diffStyle, ranges, start);
          expect(windowed.map(({ foldSeparators: _, ...row }) => row)).toEqual(
            full.slice(start).map(({ foldSeparators: _, ...row }) => row)
          );
        }
      }
    });

    test('ranges resolve in render order however they are listed', () => {
      const folds = resolve([
        { side: 'additions', start: 30, end: 33 },
        { side: 'additions', start: 7, end: 10 },
      ]);

      expect(folds.map((fold) => fold.index)).toEqual([1, 0]);
      expect(folds.map((fold) => fold.hunkIndex)).toEqual([0, 1]);
    });
  });

  test('overlap is judged by rows, not line numbers', () => {
    // 90 removed lines shift the old side, so the change block's old and new
    // line numbers differ while both ranges hide the same rows.
    const shifted = parseDiffFromFile(
      {
        name: 'shifted.ts',
        contents: [
          ...lines('gone', 90),
          ...lines('ctx', 5),
          'old1',
          'old2',
          ...lines('tail', 5),
          '',
        ].join('\n'),
      },
      {
        name: 'shifted.ts',
        contents: [
          ...lines('ctx', 5),
          'new1',
          'new2',
          ...lines('tail', 5),
          '',
        ].join('\n'),
      }
    );
    const sides = resolveFoldedRanges({
      fileDiff: shifted,
      foldedRanges: [
        { side: 'additions', start: 6, end: 7 },
        { side: 'deletions', start: 96, end: 97 },
      ],
      expandedFolds: undefined,
    });
    const outOfOrder = resolve([
      { side: 'additions', start: 9, end: 9 },
      { side: 'additions', start: 7, end: 7 },
    ]);

    expect(sides.map((fold) => fold.index)).toEqual([0]);
    expect(outOfOrder.map((fold) => fold.index)).toEqual([1, 0]);
  });

  describe('height', () => {
    test('the file shrinks by the folded rows and grows by one separator', () => {
      const baseline = estimate();
      const folded = estimate([{ side: 'additions', start: 7, end: 10 }]);
      const separatorHeight = getFoldSeparatorLayout({
        type: 'line-info',
        metrics,
      }).totalHeight;
      const shrink = 4 * metrics.lineHeight - separatorHeight;

      expect(shrink).toBeGreaterThan(0);
      expect(folded.unifiedHeight).toBe(baseline.unifiedHeight - shrink);
      expect(folded.splitHeight).toBe(baseline.splitHeight - shrink);
    });

    test('an open fold keeps its rows and adds its separator', () => {
      const separatorHeight = getFoldSeparatorLayout({
        type: 'line-info',
        metrics,
      }).totalHeight;
      const open = estimate([{ side: 'additions', start: 7, end: 10 }], [0]);

      expect(open.unifiedHeight).toBe(
        estimate().unifiedHeight + separatorHeight
      );
    });
  });

  describe('expand state', () => {
    test('toggling a fold expands it and toggling again folds it back', () => {
      const renderer = new DiffHunksRenderer({
        foldedRanges: [{ side: 'additions', start: 7, end: 10 }],
      });

      const isOpen = () => renderer.getResolvedFolds(diff)[0]?.expanded;

      expect(isOpen()).toBe(false);
      renderer.toggleFold(0);
      expect(isOpen()).toBe(true);
      renderer.toggleFold(0);
      expect(isOpen()).toBe(false);
    });

    test('a controlled host owns the state and only gets the callback', () => {
      const toggled: Array<[number, boolean]> = [];
      const renderer = new DiffHunksRenderer({
        foldedRanges: [{ side: 'additions', start: 7, end: 10 }],
        expandedFolds: [],
        onFoldToggle: (index, expanded) => {
          toggled.push([index, expanded]);
        },
      });

      renderer.toggleFold(0);

      expect(toggled).toEqual([[0, true]]);
      // The option still says folded until the host changes it.
      expect(renderer.getResolvedFolds(diff)[0]?.expanded).toBe(false);
    });

    test('React fills each fold slot from renderFoldSeparator', async () => {
      const { cleanup } = installDom();
      Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = createRoot(container);
      const hasSlot = (name: string) =>
        container
          .querySelector('diffs-container')
          ?.shadowRoot?.querySelector(`slot[name="${name}"]`) != null;
      try {
        await act(async () => {
          root.render(
            createElement(ReactFileDiff<undefined>, {
              fileDiff: diff,
              options: {
                diffStyle: 'unified',
                foldedRanges: [
                  { side: 'additions', start: 7, end: 10, label: 'moved' },
                ],
              },
              renderFoldSeparator: (fold) => `${fold.label}:${fold.lines}`,
            })
          );
          await wait(0);
        });
        await waitFor(() => hasSlot('fold-separator-unified-0'), {
          timeout: 3000,
        });

        expect(hasSlot('fold-separator-unified-0')).toBe(true);
        expect(
          container.querySelector('[slot="fold-separator-unified-0"]')
            ?.textContent
        ).toBe('moved:4');
      } finally {
        await act(async () => {
          root.unmount();
          await wait(0);
        });
        Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
        cleanup();
      }
    });
  });

  describe('degrading', () => {
    test('the later of two overlapping ranges is dropped', () => {
      const folds = resolve([
        { side: 'additions', start: 7, end: 10 },
        { side: 'additions', start: 8, end: 9 },
      ]);

      expect(folds.map((fold) => fold.index)).toEqual([0]);
    });

    test('a range inside a one-sided change block folds only its slice', () => {
      const cursor = new DiffRowCursor({
        diff: addedBlockDiff,
        diffStyle: 'split',
        folds: resolveFoldedRanges({
          fileDiff: addedBlockDiff,
          foldedRanges: [{ side: 'additions', start: 10, end: 12 }],
          expandedFolds: undefined,
        }),
      });
      const lines: number[] = [];
      while (cursor.next()) {
        lines.push(cursor.additionLineNumber);
      }

      expect(lines).toHaveLength(22);
      expect(lines.slice(8, 10)).toEqual([9, 13]);
    });

    test('a range that hides a whole hunk is dropped', () => {
      // The hunk's collapsed-context separator renders on one of its rows.
      expect(resolve([{ side: 'additions', start: 7, end: 17 }])).toEqual([]);
    });

    test('a range at the end of the diff renders below the last row', () => {
      const cursor = new DiffRowCursor({
        diff: addedBlockDiff,
        diffStyle: 'unified',
        folds: resolveFoldedRanges({
          fileDiff: addedBlockDiff,
          foldedRanges: [{ side: 'additions', start: 20, end: 25 }],
          expandedFolds: undefined,
        }),
      });
      const after: number[] = [];
      while (cursor.next()) {
        after.push(
          ...(cursor.foldSeparatorsAfter?.map(
            () => cursor.additionLineNumber
          ) ?? [])
        );
      }

      expect(after).toEqual([19]);
    });
  });
});
