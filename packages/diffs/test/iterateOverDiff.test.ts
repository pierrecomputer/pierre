import { describe, expect, test } from 'bun:test';

import { parseDiffFromFile } from '../src';
import { DEFAULT_COLLAPSED_CONTEXT_THRESHOLD } from '../src/constants';
import type { ChangeContent, FileDiffMetadata, Hunk } from '../src/types';
import { type DiffLines, lineAt, plainLines } from '../src/utils/diffLines';
import {
  type DiffLineCallbackProps,
  type DiffLineMetadata,
  iterateOverDiff,
} from '../src/utils/iterateOverDiff';
import { fileNew, fileOld } from './mocks';
import { assertDefined, countDeclaredRows } from './testUtils';

// NOTE(amadeus): These tests were written by an AI and they are probably
// pretty sloppy, but keeping them for now until we can have better tests
describe('iterateOverDiff', () => {
  // Fixture geometry the big-fixture tests rely on: this diff parses to 14
  // hunks; hunk 0 has collapsedBefore 3, and three other hunks have
  // single-line collapsed gaps that fall at DEFAULT_COLLAPSED_CONTEXT_THRESHOLD
  // and are therefore emitted as auto-expanded context rows.
  const diff = parseDiffFromFile(
    { name: 'test.txt', contents: fileOld },
    { name: 'test.txt', contents: fileNew }
  );

  test('unified iteration produces expected sequence', () => {
    const results: Array<{
      type: string;
      hunkIndex: number;
      unifiedLineIndex: number;
      collapsedBefore: number;
    }> = [];

    iterateOverDiff({
      diff,
      diffStyle: 'unified',
      callback: (props) => {
        results.push({
          type: props.type,
          hunkIndex: props.hunkIndex,
          unifiedLineIndex:
            props.additionLine?.unifiedLineIndex ??
            props.deletionLine?.unifiedLineIndex ??
            0,
          collapsedBefore: props.collapsedBefore,
        });
      },
    });

    // The iterator must emit exactly the rows the hunk metadata declares plus
    // every collapsed gap at or under DEFAULT_COLLAPSED_CONTEXT_THRESHOLD,
    // which is emitted as auto-expanded context rows. For this fixture that is
    // 514 declared unified rows + 3 single-line gaps = 517.
    expect(results.length).toBe(countDeclaredRows(diff, 'unified'));

    // Hunk 0's collapsedBefore (3) exceeds the threshold, so its gap stays
    // collapsed: the first emitted row is hunk 0's first declared context row,
    // positioned at unifiedLineStart (not a sequential counter) and carrying
    // the collapsed separator size.
    const firstHunk = diff.hunks[0];
    expect(firstHunk.collapsedBefore).toBeGreaterThan(
      DEFAULT_COLLAPSED_CONTEXT_THRESHOLD
    );
    expect(results[0]).toEqual({
      type: 'context',
      hunkIndex: 0,
      unifiedLineIndex: firstHunk.unifiedLineStart,
      collapsedBefore: firstHunk.collapsedBefore,
    });
  });

  test('split iteration produces expected sequence', () => {
    const results: Array<{
      type: string;
      deletionSplitLineIndex: number | undefined;
      additionSplitLineIndex: number | undefined;
    }> = [];

    iterateOverDiff({
      diff,
      diffStyle: 'split',
      callback: (props) => {
        results.push({
          type: props.type,
          deletionSplitLineIndex: props.deletionLine?.splitLineIndex,
          additionSplitLineIndex: props.additionLine?.splitLineIndex,
        });
      },
    });

    // Same row contract as unified mode, in split coordinates: 487 declared
    // split rows across the 14 hunks + 3 auto-expanded single-line gaps = 490.
    expect(results.length).toBe(countDeclaredRows(diff, 'split'));

    // Split-specific pairing: a change block emits max(deletions, additions)
    // rows, the deletion and addition sides of one row share a splitLineIndex,
    // and the longer side then continues alone. Hunk 0's only change block is
    // a pure addition, so locate the first change block that pairs both sides
    // and derive its emitted-row position from hunk metadata.
    const pairedHunkIndex = diff.hunks.findIndex((hunk) =>
      hunk.hunkContent.some(isPairedChangeBlock)
    );
    const pairedHunk = diff.hunks[pairedHunkIndex];
    assertDefined(pairedHunk, 'fixture must contain a paired change block');

    let blockRowOffset = 0;
    let pairedBlock: ChangeContent | undefined;
    for (const content of pairedHunk.hunkContent) {
      if (content.type === 'change' && isPairedChangeBlock(content)) {
        pairedBlock = content;
        break;
      }
      blockRowOffset +=
        content.type === 'context'
          ? content.lines
          : Math.max(content.deletions, content.additions);
    }
    assertDefined(pairedBlock, 'paired change block must exist in this hunk');
    const { deletions, additions } = pairedBlock;

    // Rows emitted before the block: every earlier hunk's declared split rows
    // and auto-expanded gaps, this hunk's own gap if it auto-expands, then the
    // hunk-content rows preceding the block.
    const blockRowStart =
      countDeclaredRows(
        { ...diff, hunks: diff.hunks.slice(0, pairedHunkIndex) },
        'split'
      ) +
      (pairedHunk.collapsedBefore <= DEFAULT_COLLAPSED_CONTEXT_THRESHOLD
        ? pairedHunk.collapsedBefore
        : 0) +
      blockRowOffset;
    const blockSplitStart = pairedHunk.splitLineStart + blockRowOffset;
    const blockRowCount = Math.max(deletions, additions);

    expect(results.slice(blockRowStart, blockRowStart + blockRowCount)).toEqual(
      Array.from({ length: blockRowCount }, (_, index) => ({
        type: 'change',
        deletionSplitLineIndex:
          index < deletions ? blockSplitStart + index : undefined,
        additionSplitLineIndex:
          index < additions ? blockSplitStart + index : undefined,
      }))
    );
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

  test('windowed expanded iteration matches full iteration line identities for unified and split styles', () => {
    const expandedDiff = createWindowedSeparatorDiff([
      {
        type: 'context',
        lines: 2,
        deletionLineIndex: COLLAPSED_BEFORE,
        additionLineIndex: COLLAPSED_BEFORE,
      },
      {
        type: 'change',
        deletions: 2,
        deletionLineIndex: COLLAPSED_BEFORE + 2,
        additions: 3,
        additionLineIndex: COLLAPSED_BEFORE + 2,
      },
      {
        type: 'context',
        lines: 4,
        deletionLineIndex: COLLAPSED_BEFORE + 4,
        additionLineIndex: COLLAPSED_BEFORE + 5,
      },
    ]);
    const cases: Array<{
      name: string;
      expandedHunks: Map<number, { fromStart: number; fromEnd: number }>;
      startingLines: number[];
    }> = [
      {
        name: 'fromStart only',
        expandedHunks: new Map([[0, { fromStart: 2, fromEnd: 0 }]]),
        startingLines: [0, 1, 2, 3, 4, 6],
      },
      {
        name: 'fromEnd only',
        expandedHunks: new Map([[0, { fromStart: 0, fromEnd: 3 }]]),
        startingLines: [0, 1, 2, 3, 4, 6],
      },
      {
        name: 'fromStart and fromEnd',
        expandedHunks: new Map([[0, { fromStart: 2, fromEnd: 3 }]]),
        startingLines: [0, 1, 2, 3, 4, 5, 8],
      },
    ];

    for (const diffStyle of ['unified', 'split'] as const) {
      for (const testCase of cases) {
        const fullRows = collectRows({
          diff: expandedDiff,
          diffStyle,
          expandedHunks: testCase.expandedHunks,
        });

        for (const startingLine of testCase.startingLines) {
          const totalLines = Math.min(3, fullRows.length - startingLine);
          const windowedRows = collectRows({
            diff: expandedDiff,
            diffStyle,
            expandedHunks: testCase.expandedHunks,
            startingLine,
            totalLines,
          });

          expect({
            name: testCase.name,
            diffStyle,
            startingLine,
            rows: getRowIdentities(windowedRows),
          }).toEqual({
            name: testCase.name,
            diffStyle,
            startingLine,
            rows: getRowIdentities(
              fullRows.slice(startingLine, startingLine + totalLines)
            ),
          });
        }
      }
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

  test('expands every new-file line around a context-zero deletion', () => {
    const oldLines = Array.from(
      { length: 7 },
      (_, index) => `line ${index + 1}\n`
    );
    const newLines = oldLines.toSpliced(4, 1);
    const deletionDiff = parseDiffFromFile(
      { name: 'deletion.ts', contents: oldLines.join('') },
      { name: 'deletion.ts', contents: newLines.join('') },
      { context: 0 }
    );

    const additions = collectRows({
      diff: deletionDiff,
      diffStyle: 'split',
      expandedHunks: true,
    }).flatMap((row) => {
      if (row.additionLine == null) return [];
      return [
        {
          lineIndex: row.additionLine.lineIndex,
          lineNumber: row.additionLine.lineNumber,
          text: lineAt(deletionDiff.additionLines, row.additionLine.lineIndex),
        },
      ];
    });

    expect(additions).toEqual(
      newLines.map((text, lineIndex) => ({
        lineIndex,
        lineNumber: lineIndex + 1,
        text,
      }))
    );
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
        name: 'hunk context after expanded fromEnd boundary',
        diff: createWindowedSeparatorDiff([
          {
            type: 'context',
            lines: 3,
            deletionLineIndex: COLLAPSED_BEFORE,
            additionLineIndex: COLLAPSED_BEFORE,
          },
        ]),
        expandedHunks: new Map([[0, { fromStart: 0, fromEnd: 3 }]]),
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
      for (const diffStyle of ['unified', 'split'] as const) {
        const rows: Array<{ type: string; collapsedBefore: number }> = [];

        iterateOverDiff({
          diff: testCase.diff,
          diffStyle,
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

        expect({ name: testCase.name, diffStyle, rows }).toEqual({
          name: testCase.name,
          diffStyle,
          rows: [{ type: testCase.expectedType, collapsedBefore: 0 }],
        });
      }
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

function getRowIdentities(rows: RowSnapshot[]): Array<{
  type: DiffLineCallbackProps['type'];
  hunkIndex: number;
  deletionLine: LineSnapshot | undefined;
  additionLine: LineSnapshot | undefined;
}> {
  return rows.map((row) => ({
    type: row.type,
    hunkIndex: row.hunkIndex,
    deletionLine: row.deletionLine,
    additionLine: row.additionLine,
  }));
}

// A change block that pairs at least one deletion row with an addition row,
// which is what exercises split-mode row pairing (shared splitLineIndex).
function isPairedChangeBlock(content: Hunk['hunkContent'][number]): boolean {
  return (
    content.type === 'change' && content.deletions > 0 && content.additions > 0
  );
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

function createLines(count: number): DiffLines {
  return plainLines(
    Array.from({ length: count }, (_, index) => `line ${index}\n`)
  );
}
