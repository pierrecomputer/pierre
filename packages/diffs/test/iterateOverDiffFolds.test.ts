import { describe, expect, test } from 'bun:test';

import { parseDiffFromFile } from '../src';
import type { FileDiffMetadata, Hunk, SemanticDiffFold } from '../src/types';
import {
  type DiffLineCallbackProps,
  iterateOverDiff,
} from '../src/utils/iterateOverDiff';

function fold(start: number, end: number): SemanticDiffFold {
  return {
    old: { start, end },
    operations: [0],
    counts: { moved: end - start + 1, edited: 0, removed: 0 },
  };
}

// An 80-line file with three changes far enough apart to land in separate
// hunks: old lines 10-14 removed, old line 40 edited, old lines 60-63 removed.
function removedBlocksDiff(): FileDiffMetadata {
  const oldLines = Array.from(
    { length: 80 },
    (_, index) => `line ${index + 1}`
  );
  const newLines = oldLines
    .map((line, index) => (index + 1 === 40 ? 'line 40 edited' : line))
    .filter((_, index) => {
      const line = index + 1;
      return !(line >= 10 && line <= 14) && !(line >= 60 && line <= 63);
    });
  return parseDiffFromFile(
    { name: 'removed.txt', contents: `${oldLines.join('\n')}\n` },
    { name: 'removed.txt', contents: `${newLines.join('\n')}\n` }
  );
}

// The diff with `folds` as its semantic folds.
function withFolds(
  diff: FileDiffMetadata,
  folds: SemanticDiffFold[]
): FileDiffMetadata {
  return { ...diff, semanticFolds: folds };
}

const NONE_OPEN: ReadonlySet<number> = new Set();

interface RowSummary {
  old: number | undefined;
  new: number | undefined;
  splitRow: number;
  unifiedRow: number;
  collapsedBefore: number;
  collapsedAfter: number;
  // The old lines a closed fold's row stands for, and its last split and
  // unified rows.
  fold: string | undefined;
  // The old lines of the open fold this row starts.
  openFold: string | undefined;
}

type IterateOptions = Omit<Parameters<typeof iterateOverDiff>[0], 'callback'>;

function summarize(props: DiffLineCallbackProps): RowSummary {
  const { deletionLine, additionLine, foldRow, openFold } = props;
  const splitRow =
    deletionLine != null
      ? deletionLine.splitLineIndex
      : additionLine.splitLineIndex;
  return {
    old: deletionLine?.lineNumber,
    new: additionLine?.lineNumber,
    splitRow,
    unifiedRow:
      deletionLine != null
        ? deletionLine.unifiedLineIndex
        : additionLine.unifiedLineIndex,
    collapsedBefore: props.collapsedBefore,
    collapsedAfter: props.collapsedAfter,
    fold:
      foldRow != null
        ? `${foldRow.fold.old.start}-${foldRow.fold.old.end} through rows ${foldRow.lastSplitLineIndex}/${foldRow.lastUnifiedLineIndex}`
        : undefined,
    openFold:
      openFold != null
        ? `${openFold.old.start}-${openFold.old.end}`
        : undefined,
  };
}

function collectRows(options: IterateOptions): RowSummary[] {
  const rows: RowSummary[] = [];
  iterateOverDiff({
    ...options,
    callback: (props) => {
      rows.push(summarize(props));
    },
  });
  return rows;
}

// What a view should show: the rows of a walk without folding, with each
// closed fold's rows replaced by one row on its first line, and each open
// fold's first row marked.
function expectedRows(
  diff: FileDiffMetadata,
  diffStyle: 'split' | 'unified',
  openSemanticFolds: ReadonlySet<number> = NONE_OPEN
): RowSummary[] {
  const rows = collectRows({ diff, diffStyle });
  const expected: RowSummary[] = [];
  for (const row of rows) {
    const covering = diff.semanticFolds?.find(
      ({ old }) => row.old != null && row.old >= old.start && row.old <= old.end
    );
    if (covering == null) {
      expected.push(row);
    } else if (openSemanticFolds.has(covering.old.start)) {
      expected.push(
        row.old === covering.old.start
          ? { ...row, openFold: `${covering.old.start}-${covering.old.end}` }
          : row
      );
    } else if (row.old === covering.old.start) {
      const last = rows.find((other) => other.old === covering.old.end);
      expected.push({
        ...row,
        collapsedAfter: last?.collapsedAfter ?? 0,
        fold: `${covering.old.start}-${covering.old.end} through rows ${last?.splitRow}/${last?.unifiedRow}`,
      });
    }
  }
  return expected;
}

const VIEWS: ('split' | 'unified')[] = ['split', 'unified'];

describe('iterateOverDiff with semantic folds', () => {
  // One whole block of removed lines, and the middle of another.
  const diff = withFolds(removedBlocksDiff(), [fold(10, 14), fold(61, 62)]);

  test('the fixture puts each change in its own hunk', () => {
    expect(diff.hunks).toHaveLength(3);
  });

  test.each(VIEWS)(
    'the %s view gets one row per fold, on its first line',
    (diffStyle) => {
      const rows = collectRows({
        diff,
        diffStyle,
        openSemanticFolds: NONE_OPEN,
      });
      expect(rows).toEqual(expectedRows(diff, diffStyle));

      const shownOldLines = rows.map((row) => row.old);
      for (const hidden of [11, 12, 13, 14, 62]) {
        expect(shownOldLines).not.toContain(hidden);
      }
      expect(rows.filter((row) => row.fold != null)).toEqual([
        expect.objectContaining({ old: 10, new: undefined }),
        expect.objectContaining({ old: 61, new: undefined }),
      ]);
      // Old lines 60 and 63 sit around the second fold and keep their rows.
      expect(shownOldLines).toContain(60);
      expect(shownOldLines).toContain(63);
    }
  );

  test.each(VIEWS)(
    'an open fold shows every line in the %s view, with its first line marked',
    (diffStyle) => {
      const openSemanticFolds = new Set([10]);
      const rows = collectRows({ diff, diffStyle, openSemanticFolds });
      expect(rows).toEqual(expectedRows(diff, diffStyle, openSemanticFolds));

      const shownOldLines = rows.map((row) => row.old);
      for (const shown of [10, 11, 12, 13, 14]) {
        expect(shownOldLines).toContain(shown);
      }
      expect(rows.filter((row) => row.openFold != null)).toEqual([
        expect.objectContaining({ old: 10, openFold: '10-14' }),
      ]);
      // The other fold stays closed.
      expect(shownOldLines).not.toContain(62);
    }
  );

  test.each(VIEWS)(
    'every window of the %s view is a slice of the full walk',
    (diffStyle) => {
      for (const openSemanticFolds of [
        NONE_OPEN,
        new Set([10]),
        new Set([61]),
      ]) {
        const full = collectRows({ diff, diffStyle, openSemanticFolds });
        for (const totalLines of [1, 2, 7]) {
          for (
            let startingLine = 0;
            startingLine < full.length;
            startingLine++
          ) {
            expect({
              startingLine,
              totalLines,
              rows: collectRows({
                diff,
                diffStyle,
                openSemanticFolds,
                startingLine,
                totalLines,
              }),
            }).toEqual({
              startingLine,
              totalLines,
              rows: full.slice(startingLine, startingLine + totalLines),
            });
          }
        }
      }
    }
  );

  test.each(VIEWS)("'both' walks cover the %s view's window", (diffStyle) => {
    const full = collectRows({
      diff,
      diffStyle,
      openSemanticFolds: NONE_OPEN,
    });
    for (let startingLine = 0; startingLine < full.length; startingLine += 3) {
      const both = collectRows({
        diff,
        diffStyle: 'both',
        openSemanticFolds: NONE_OPEN,
        startingLine,
        totalLines: 5,
      });
      for (const row of full.slice(startingLine, startingLine + 5)) {
        // A 'both' row pairs an old line with a new one; the unified view
        // shows them as two rows.
        if (row.old != null) {
          expect(both).toContainEqual(
            expect.objectContaining({ old: row.old, fold: row.fold })
          );
        }
        if (row.new != null) {
          expect(both).toContainEqual(
            expect.objectContaining({ new: row.new })
          );
        }
      }
      // No row that both views hide is walked.
      for (const hidden of [11, 12, 13, 14, 62]) {
        expect(both.map((row) => row.old)).not.toContain(hidden);
      }
    }
  });

  test("a fold's row closes the hunk when its last line does", () => {
    // Two unchanged lines, three removed lines, then unchanged lines that stay
    // collapsed: the separator follows the hunk's last row.
    const removed: Hunk['hunkContent'] = [
      { type: 'context', lines: 2, additionLineIndex: 0, deletionLineIndex: 0 },
      {
        type: 'change',
        deletions: 3,
        additions: 0,
        additionLineIndex: 2,
        deletionLineIndex: 2,
      },
    ];
    const trailing = 20;
    const hunk: Hunk = {
      collapsedBefore: 0,
      additionStart: 1,
      additionCount: 2,
      additionLines: 0,
      additionLineIndex: 0,
      deletionStart: 1,
      deletionCount: 5,
      deletionLines: 3,
      deletionLineIndex: 0,
      hunkContent: removed,
      hunkSpecs: '@@ -1,5 +1,2 @@',
      splitLineStart: 0,
      splitLineCount: 5,
      unifiedLineStart: 0,
      unifiedLineCount: 5,
      noEOFCRDeletions: false,
      noEOFCRAdditions: false,
    };
    const lines = (count: number) =>
      Array.from({ length: count }, (_, index) => `line ${index}\n`);
    const deletionLines = lines(5 + trailing);
    const additionLines = lines(2 + trailing);
    const tailDiff: FileDiffMetadata = {
      name: 'tail.txt',
      type: 'change',
      hunks: [hunk],
      splitLineCount: 5 + trailing,
      unifiedLineCount: 5 + trailing,
      isPartial: false,
      deletionLines,
      additionLines,
      deletionCharacterCount: deletionLines.join('').length,
      additionCharacterCount: additionLines.join('').length,
      semanticFolds: [fold(3, 5)],
    };
    const rows = collectRows({
      diff: tailDiff,
      diffStyle: 'split',
      openSemanticFolds: NONE_OPEN,
    });
    expect(rows.map((row) => [row.old, row.collapsedAfter])).toEqual([
      [1, 0],
      [2, 0],
      [3, trailing],
    ]);
    expect(rows[2].fold).toBe('3-5 through rows 4/4');

    // The same holds in the unified view.
    expect(
      collectRows({
        diff: tailDiff,
        diffStyle: 'unified',
        openSemanticFolds: NONE_OPEN,
      }).map((row) => [row.old, row.collapsedAfter])
    ).toEqual([
      [1, 0],
      [2, 0],
      [3, trailing],
    ]);
  });
});
