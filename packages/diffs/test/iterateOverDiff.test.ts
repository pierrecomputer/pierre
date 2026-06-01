import { describe, expect, test } from 'bun:test';

import { parseDiffFromFile } from '../src';
import type { FileDiffMetadata, Hunk } from '../src/types';
import {
  type DiffLineCallbackProps,
  type DiffLineMetadata,
  iterateOverDiff,
} from '../src/utils/iterateOverDiff';
import { fileNew, fileOld } from './mocks';

// NOTE(amadeus): These tests were written by an AI and they are probably
// pretty sloppy, but keeping them for now until we can have better tests
describe('iterateOverDiff', () => {
  const diff = parseDiffFromFile(
    { name: 'test.txt', contents: fileOld },
    { name: 'test.txt', contents: fileNew }
  );

  test('unified iteration produces expected sequence', () => {
    const results: Array<{
      lineIndex: number;
      hunkIndex: number;
      type: string;
      additionLineIndex: number | undefined;
      deletionLineIndex: number | undefined;
      additionLineNumber: number | undefined;
      deletionLineNumber: number | undefined;
      collapsedBefore: number;
    }> = [];

    iterateOverDiff({
      diff,
      diffStyle: 'unified',
      callback: (props) => {
        results.push({
          lineIndex: (() => {
            return (
              props.additionLine?.unifiedLineIndex ??
              props.deletionLine?.unifiedLineIndex ??
              0
            );
          })(),
          hunkIndex: props.hunkIndex,
          type: props.type,
          additionLineIndex: props.additionLine?.lineIndex,
          deletionLineIndex: props.deletionLine?.lineIndex,
          additionLineNumber: props.additionLine?.lineNumber,
          deletionLineNumber: props.deletionLine?.lineNumber,
          collapsedBefore: props.collapsedBefore,
        });
      },
    });

    // Check total lines matches expected
    expect(results.length).toBe(517);

    // First hunk starts at its unifiedLineStart (which is 3 because collapsedBefore=3)
    // The lineIndex is the actual unified line index, not a sequential counter
    expect(results[0].lineIndex).toBe(diff.hunks[0].unifiedLineStart);
    expect(results[0].hunkIndex).toBe(0);

    // First line should be context with collapsedBefore = 3 (from hunk 0)
    // Actually, hunk 0 has collapsedBefore=3, so first rendered line should signal this
    expect(results[0].collapsedBefore).toBe(3);
  });

  test('split iteration produces expected sequence', () => {
    const results: Array<{
      lineIndex: number;
      type: string;
      additionLineIndex: number | undefined;
      deletionLineIndex: number | undefined;
    }> = [];

    iterateOverDiff({
      diff,
      diffStyle: 'split',
      callback: (props) => {
        results.push({
          lineIndex: (() => {
            return (
              props.additionLine?.unifiedLineIndex ??
              props.deletionLine?.unifiedLineIndex ??
              0
            );
          })(),
          type: props.type,
          additionLineIndex: props.additionLine?.lineIndex,
          deletionLineIndex: props.deletionLine?.lineIndex,
        });
      },
    });

    // Check total lines matches expected for split mode
    expect(results.length).toBe(490);
  });

  test('expanded hunks work correctly', () => {
    const expandedHunks = new Map<
      number,
      { fromStart: number; fromEnd: number }
    >();
    expandedHunks.set(0, { fromStart: 2, fromEnd: 1 });

    const results: Array<{
      lineIndex: number;
      type: string;
      collapsedBefore: number;
    }> = [];

    iterateOverDiff({
      diff,
      diffStyle: 'unified',
      expandedHunks,
      callback: (props) => {
        results.push({
          lineIndex: (() => {
            return (
              props.additionLine?.unifiedLineIndex ??
              props.deletionLine?.unifiedLineIndex ??
              0
            );
          })(),
          type: props.type,
          collapsedBefore: props.collapsedBefore,
        });
      },
    });

    // With 3 collapsedBefore and fromStart=2, fromEnd=1, we should have:
    // - 2 context-expanded lines (fromStart)
    // - collapsedBefore = 0 (3 - 2 - 1 = 0, fully expanded)
    // - 1 context-expanded line (fromEnd)
    // - then hunk content

    // First 2 lines should be context-expanded with collapsedBefore=0
    expect(results[0].type).toBe('context-expanded');
    expect(results[0].collapsedBefore).toBe(0);
    expect(results[1].type).toBe('context-expanded');
    expect(results[1].collapsedBefore).toBe(0);
    // Third line should also be context-expanded (fromEnd)
    expect(results[2].type).toBe('context-expanded');
    expect(results[2].collapsedBefore).toBe(0);
  });

  test('windowing skips lines correctly', () => {
    const results: number[] = [];

    iterateOverDiff({
      diff,
      diffStyle: 'unified',
      startingLine: 10,
      totalLines: 5,
      callback: (props) => {
        results.push(
          (() => {
            return (
              props.additionLine?.unifiedLineIndex ??
              props.deletionLine?.unifiedLineIndex ??
              0
            );
          })()
        );
      },
    });

    // Should get exactly 5 consecutive lines
    expect(results.length).toBe(5);
    // Lines should be consecutive
    for (let i = 1; i < results.length; i++) {
      expect(results[i]).toBe(results[i - 1] + 1);
    }
  });

  test('windowed iteration matches full iteration slices for unified and split styles', () => {
    const cases: Array<{
      diffStyle: 'unified' | 'split';
      startingLine: number;
      totalLines: number;
    }> = [
      { diffStyle: 'unified', startingLine: 0, totalLines: 8 },
      { diffStyle: 'unified', startingLine: 10, totalLines: 5 },
      { diffStyle: 'unified', startingLine: 150, totalLines: 13 },
      { diffStyle: 'split', startingLine: 0, totalLines: 8 },
      { diffStyle: 'split', startingLine: 10, totalLines: 5 },
      { diffStyle: 'split', startingLine: 120, totalLines: 17 },
    ];

    for (const testCase of cases) {
      const fullRows = collectRows({ diff, diffStyle: testCase.diffStyle });
      const windowedRows = collectRows({
        diff,
        diffStyle: testCase.diffStyle,
        startingLine: testCase.startingLine,
        totalLines: testCase.totalLines,
      });

      expect({ name: testCase, rows: windowedRows }).toEqual({
        name: testCase,
        rows: fullRows.slice(
          testCase.startingLine,
          testCase.startingLine + testCase.totalLines
        ),
      });
    }
  });

  test('both style includes rows visible in either split or unified coordinates for uneven changes', () => {
    const unevenDiff = createSingleHunkDiff({
      hunkContent: [
        {
          type: 'context',
          lines: 2,
          deletionLineIndex: 0,
          additionLineIndex: 0,
        },
        {
          type: 'change',
          deletions: 4,
          deletionLineIndex: 2,
          additions: 1,
          additionLineIndex: 2,
        },
      ],
    });

    const rows = collectRows({
      diff: unevenDiff,
      diffStyle: 'both',
      startingLine: 6,
      totalLines: 1,
    });

    expect(rows).toEqual([
      {
        type: 'change',
        hunkIndex: 0,
        collapsedBefore: 0,
        collapsedAfter: 0,
        deletionLine: {
          unifiedLineIndex: 2,
          splitLineIndex: 2,
          lineIndex: 2,
          lineNumber: 3,
          noEOFCR: false,
        },
        additionLine: {
          unifiedLineIndex: 6,
          splitLineIndex: 2,
          lineIndex: 2,
          lineNumber: 3,
          noEOFCR: false,
        },
      },
    ]);
  });

  test('both style skips gap rows between disjoint split and unified equal-row windows', () => {
    const gapDiff = createSingleHunkDiff({
      hunkContent: [
        {
          type: 'change',
          deletions: 5,
          deletionLineIndex: 0,
          additions: 5,
          additionLineIndex: 0,
        },
        {
          type: 'context',
          lines: 10,
          deletionLineIndex: 5,
          additionLineIndex: 5,
        },
      ],
    });

    const rows = collectRows({
      diff: gapDiff,
      diffStyle: 'both',
      startingLine: 12,
      totalLines: 1,
    });

    expect(
      rows.map((row) => ({
        type: row.type,
        unifiedLineIndex: row.deletionLine?.unifiedLineIndex,
        splitLineIndex: row.deletionLine?.splitLineIndex,
        lineIndex: row.deletionLine?.lineIndex,
      }))
    ).toEqual([
      {
        type: 'context',
        unifiedLineIndex: 12,
        splitLineIndex: 7,
        lineIndex: 7,
      },
      {
        type: 'context',
        unifiedLineIndex: 17,
        splitLineIndex: 12,
        lineIndex: 12,
      },
    ]);
  });

  test('expanded leading context preserves fromStart and fromEnd placement', () => {
    const leadingDiff = createSingleHunkDiff({
      collapsedBefore: 6,
      hunkContent: [
        {
          type: 'change',
          deletions: 1,
          deletionLineIndex: 6,
          additions: 1,
          additionLineIndex: 6,
        },
      ],
    });
    const rows = collectRows({
      diff: leadingDiff,
      diffStyle: 'unified',
      expandedHunks: new Map([[0, { fromStart: 2, fromEnd: 2 }]]),
    });

    expect(
      rows.slice(0, 5).map((row) => ({
        type: row.type,
        collapsedBefore: row.collapsedBefore,
        deletionLineIndex: row.deletionLine?.lineIndex,
        additionLineIndex: row.additionLine?.lineIndex,
      }))
    ).toEqual([
      {
        type: 'context-expanded',
        collapsedBefore: 0,
        deletionLineIndex: 0,
        additionLineIndex: 0,
      },
      {
        type: 'context-expanded',
        collapsedBefore: 0,
        deletionLineIndex: 1,
        additionLineIndex: 1,
      },
      {
        type: 'context-expanded',
        collapsedBefore: 2,
        deletionLineIndex: 4,
        additionLineIndex: 4,
      },
      {
        type: 'context-expanded',
        collapsedBefore: 0,
        deletionLineIndex: 5,
        additionLineIndex: 5,
      },
      {
        type: 'change',
        collapsedBefore: 0,
        deletionLineIndex: 6,
        additionLineIndex: undefined,
      },
    ]);
  });

  test('trailing context is collapsed after hunk content or emitted when expanded', () => {
    const trailingDiff = createSingleHunkDiff({
      hunkContent: [
        {
          type: 'context',
          lines: 2,
          deletionLineIndex: 0,
          additionLineIndex: 0,
        },
      ],
      trailingLineCount: 5,
    });

    const collapsedRows = collectRows({
      diff: trailingDiff,
      diffStyle: 'unified',
    });
    expect(collapsedRows).toHaveLength(2);
    expect(collapsedRows.at(-1)?.collapsedAfter).toBe(5);

    const expandedRows = collectRows({
      diff: trailingDiff,
      diffStyle: 'unified',
      expandedHunks: new Map([[1, { fromStart: 2, fromEnd: 1 }]]),
    });

    expect(
      expandedRows.slice(2).map((row) => ({
        type: row.type,
        collapsedAfter: row.collapsedAfter,
        deletionLineIndex: row.deletionLine?.lineIndex,
        additionLineIndex: row.additionLine?.lineIndex,
      }))
    ).toEqual([
      {
        type: 'context-expanded',
        collapsedAfter: 0,
        deletionLineIndex: 2,
        additionLineIndex: 2,
      },
      {
        type: 'context-expanded',
        collapsedAfter: 3,
        deletionLineIndex: 3,
        additionLineIndex: 3,
      },
    ]);
  });

  test('windowed iteration preserves collapsedBefore and collapsedAfter separator placement', () => {
    const leadingRows = collectRows({
      diff: createWindowedSeparatorDiff([
        {
          type: 'context',
          lines: 3,
          deletionLineIndex: COLLAPSED_BEFORE,
          additionLineIndex: COLLAPSED_BEFORE,
        },
      ]),
      diffStyle: 'unified',
      expandedHunks: new Map([[0, { fromStart: 2, fromEnd: 0 }]]),
      startingLine: 3,
      totalLines: 1,
    });
    expect(leadingRows).toEqual([
      expect.objectContaining({ type: 'context', collapsedBefore: 0 }),
    ]);

    const trailingRows = collectRows({
      diff: createSingleHunkDiff({
        hunkContent: [
          {
            type: 'context',
            lines: 3,
            deletionLineIndex: 0,
            additionLineIndex: 0,
          },
        ],
        trailingLineCount: 4,
      }),
      diffStyle: 'unified',
      startingLine: 2,
      totalLines: 1,
    });
    expect(trailingRows).toEqual([
      expect.objectContaining({ type: 'context', collapsedAfter: 4 }),
    ]);
  });

  test('callback can stop iteration early', () => {
    const rows: RowSnapshot[] = [];

    iterateOverDiff({
      diff,
      diffStyle: 'unified',
      callback: (props) => {
        rows.push(serializeRow(props));
        return rows.length === 3;
      },
    });

    expect(rows).toEqual(
      collectRows({ diff, diffStyle: 'unified' }).slice(0, rows.length)
    );
    expect(rows).toHaveLength(3);
  });

  test('windowed expansion does not attach skipped collapsed separators to visible rows', () => {
    const cases: Array<{
      name: string;
      diff: FileDiffMetadata;
      expandedHunks: Map<number, { fromStart: number; fromEnd: number }>;
      startingLine: number;
      expectedType: string;
    }> = [
      {
        name: 'expanded fromEnd context',
        diff: createWindowedSeparatorDiff([
          {
            type: 'context',
            lines: 1,
            deletionLineIndex: COLLAPSED_BEFORE,
            additionLineIndex: COLLAPSED_BEFORE,
          },
        ]),
        expandedHunks: new Map([[0, { fromStart: 2, fromEnd: 3 }]]),
        startingLine: 3,
        expectedType: 'context-expanded',
      },
      {
        name: 'hunk context content',
        diff: createWindowedSeparatorDiff([
          {
            type: 'context',
            lines: 3,
            deletionLineIndex: COLLAPSED_BEFORE,
            additionLineIndex: COLLAPSED_BEFORE,
          },
        ]),
        expandedHunks: new Map([[0, { fromStart: 2, fromEnd: 0 }]]),
        startingLine: 3,
        expectedType: 'context',
      },
      {
        name: 'hunk change content',
        diff: createWindowedSeparatorDiff([
          {
            type: 'change',
            deletions: 3,
            deletionLineIndex: COLLAPSED_BEFORE,
            additions: 3,
            additionLineIndex: COLLAPSED_BEFORE,
          },
        ]),
        expandedHunks: new Map([[0, { fromStart: 2, fromEnd: 0 }]]),
        startingLine: 3,
        expectedType: 'change',
      },
    ];

    for (const testCase of cases) {
      const rows: Array<{ type: string; collapsedBefore: number }> = [];

      iterateOverDiff({
        diff: testCase.diff,
        diffStyle: 'unified',
        expandedHunks: testCase.expandedHunks,
        startingLine: testCase.startingLine,
        totalLines: 1,
        callback: (props) => {
          rows.push({
            type: props.type,
            collapsedBefore: props.collapsedBefore,
          });
        },
      });

      expect({ name: testCase.name, rows }).toEqual({
        name: testCase.name,
        rows: [{ type: testCase.expectedType, collapsedBefore: 0 }],
      });
    }
  });
});

const COLLAPSED_BEFORE = 10;

type IterateOptions = Omit<Parameters<typeof iterateOverDiff>[0], 'callback'>;

interface LineSnapshot {
  unifiedLineIndex: number;
  splitLineIndex: number;
  lineIndex: number;
  lineNumber: number;
  noEOFCR: boolean;
}

interface RowSnapshot {
  type: DiffLineCallbackProps['type'];
  hunkIndex: number;
  collapsedBefore: number;
  collapsedAfter: number;
  deletionLine: LineSnapshot | undefined;
  additionLine: LineSnapshot | undefined;
}

function collectRows(options: IterateOptions): RowSnapshot[] {
  const rows: RowSnapshot[] = [];

  iterateOverDiff({
    ...options,
    callback: (props) => {
      rows.push(serializeRow(props));
    },
  });

  return rows;
}

function serializeRow(props: DiffLineCallbackProps): RowSnapshot {
  return {
    type: props.type,
    hunkIndex: props.hunkIndex,
    collapsedBefore: props.collapsedBefore,
    collapsedAfter: props.collapsedAfter,
    deletionLine: serializeLine(props.deletionLine),
    additionLine: serializeLine(props.additionLine),
  };
}

function serializeLine(
  line: DiffLineMetadata | undefined
): LineSnapshot | undefined {
  if (line == null) {
    return undefined;
  }
  return {
    unifiedLineIndex: line.unifiedLineIndex,
    splitLineIndex: line.splitLineIndex,
    lineIndex: line.lineIndex,
    lineNumber: line.lineNumber,
    noEOFCR: line.noEOFCR,
  };
}

function createSingleHunkDiff({
  collapsedBefore = 0,
  hunkContent,
  trailingLineCount = 0,
}: {
  collapsedBefore?: number;
  hunkContent: Hunk['hunkContent'];
  trailingLineCount?: number;
}): FileDiffMetadata {
  const counts = getHunkContentCounts(hunkContent);

  const hunk: Hunk = {
    collapsedBefore,
    additionStart: collapsedBefore + 1,
    additionCount: counts.additionCount,
    additionLines: counts.additionLines,
    additionLineIndex: collapsedBefore,
    deletionStart: collapsedBefore + 1,
    deletionCount: counts.deletionCount,
    deletionLines: counts.deletionLines,
    deletionLineIndex: collapsedBefore,
    hunkContent,
    hunkSpecs: `@@ -${collapsedBefore + 1},${counts.deletionCount} +${collapsedBefore + 1},${counts.additionCount} @@`,
    splitLineStart: collapsedBefore,
    splitLineCount: counts.splitLineCount,
    unifiedLineStart: collapsedBefore,
    unifiedLineCount: counts.unifiedLineCount,
    noEOFCRDeletions: false,
    noEOFCRAdditions: false,
  };

  return {
    name: 'single-hunk.ts',
    type: 'change',
    hunks: [hunk],
    splitLineCount: collapsedBefore + counts.splitLineCount + trailingLineCount,
    unifiedLineCount:
      collapsedBefore + counts.unifiedLineCount + trailingLineCount,
    isPartial: false,
    deletionLines: createLines(
      collapsedBefore + counts.deletionCount + trailingLineCount
    ),
    additionLines: createLines(
      collapsedBefore + counts.additionCount + trailingLineCount
    ),
  };
}

// Build a minimal full-file diff where a collapsed leading gap can be partially
// expanded, letting windowed iteration start after the separator boundary.
function createWindowedSeparatorDiff(
  hunkContent: Hunk['hunkContent']
): FileDiffMetadata {
  const counts = getHunkContentCounts(hunkContent);

  const hunk: Hunk = {
    collapsedBefore: COLLAPSED_BEFORE,
    additionStart: COLLAPSED_BEFORE + 1,
    additionCount: counts.additionCount,
    additionLines: counts.additionLines,
    additionLineIndex: COLLAPSED_BEFORE,
    deletionStart: COLLAPSED_BEFORE + 1,
    deletionCount: counts.deletionCount,
    deletionLines: counts.deletionLines,
    deletionLineIndex: COLLAPSED_BEFORE,
    hunkContent,
    hunkSpecs: `@@ -${COLLAPSED_BEFORE + 1},${counts.deletionCount} +${COLLAPSED_BEFORE + 1},${counts.additionCount} @@`,
    splitLineStart: COLLAPSED_BEFORE,
    splitLineCount: counts.splitLineCount,
    unifiedLineStart: COLLAPSED_BEFORE,
    unifiedLineCount: counts.unifiedLineCount,
    noEOFCRDeletions: false,
    noEOFCRAdditions: false,
  };

  return {
    name: 'windowed-separator.ts',
    type: 'change',
    hunks: [hunk],
    splitLineCount: COLLAPSED_BEFORE + counts.splitLineCount,
    unifiedLineCount: COLLAPSED_BEFORE + counts.unifiedLineCount,
    isPartial: false,
    deletionLines: createLines(COLLAPSED_BEFORE + counts.deletionCount),
    additionLines: createLines(COLLAPSED_BEFORE + counts.additionCount),
  };
}

function getHunkContentCounts(hunkContent: Hunk['hunkContent']): {
  additionCount: number;
  deletionCount: number;
  additionLines: number;
  deletionLines: number;
  splitLineCount: number;
  unifiedLineCount: number;
} {
  let additionCount = 0;
  let deletionCount = 0;
  let additionLines = 0;
  let deletionLines = 0;
  let splitLineCount = 0;
  let unifiedLineCount = 0;

  for (const content of hunkContent) {
    if (content.type === 'context') {
      additionCount += content.lines;
      deletionCount += content.lines;
      splitLineCount += content.lines;
      unifiedLineCount += content.lines;
    } else {
      additionCount += content.additions;
      deletionCount += content.deletions;
      additionLines += content.additions;
      deletionLines += content.deletions;
      splitLineCount += Math.max(content.additions, content.deletions);
      unifiedLineCount += content.additions + content.deletions;
    }
  }

  return {
    additionCount,
    deletionCount,
    additionLines,
    deletionLines,
    splitLineCount,
    unifiedLineCount,
  };
}

function createLines(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `line ${index}\n`);
}
