import { describe, expect, test } from 'bun:test';

import type {
  FileDiffMetadata,
  HunkExpansionRegion,
  SelectionSide,
} from '../src/types';
import { iterateOverDiff } from '../src/utils/iterateOverDiff';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import {
  getNearestRenderableAdditionLine,
  isDiffLineInCollapsedContext,
} from '../src/utils/virtualDiffLayout';

const COLLAPSED_CONTEXT_THRESHOLD = 1;

function makeDiff(): FileDiffMetadata {
  const oldContents =
    Array.from({ length: 40 }, (_, index) => `line ${index + 1}`).join('\n') +
    '\n';
  const newContents = oldContents
    .replace('line 10\n', 'line 10 changed\n')
    .replace('line 30\n', 'line 30 changed\n');
  return parseDiffFromFile(
    { name: 'a.ts', contents: oldContents },
    { name: 'a.ts', contents: newContents }
  );
}

// Lines are added near the top and removed further down, so the two sides
// number the same unchanged row differently.
function makeShiftedDiff(): FileDiffMetadata {
  const oldLines = Array.from({ length: 60 }, (_, index) => `line ${index}`);
  const newLines = [...oldLines];
  newLines.splice(40, 3);
  newLines.splice(10, 0, 'added a', 'added b');
  return parseDiffFromFile(
    { name: 'a.ts', contents: oldLines.join('\n') + '\n' },
    { name: 'a.ts', contents: newLines.join('\n') + '\n' }
  );
}

// Collects the one-based line numbers of one side that iterateOverDiff emits
// rows for under the given expansion state — the ground truth the oracle must
// match.
function collectRenderedLines(
  diff: FileDiffMetadata,
  side: SelectionSide,
  expandedHunks: Map<number, HunkExpansionRegion> | true | undefined
): Set<number> {
  const rendered = new Set<number>();
  iterateOverDiff({
    diff,
    diffStyle: 'split',
    expandedHunks,
    collapsedContextThreshold: COLLAPSED_CONTEXT_THRESHOLD,
    callback: ({ additionLine, deletionLine }) => {
      const line = side === 'additions' ? additionLine : deletionLine;
      if (line != null) {
        rendered.add(line.lineNumber);
      }
    },
  });
  return rendered;
}

function assertOracleMatches(
  diff: FileDiffMetadata,
  expandedHunks: Map<number, HunkExpansionRegion> | true | undefined,
  side: SelectionSide = 'additions'
): void {
  const rendered = collectRenderedLines(diff, side, expandedHunks);
  const lineCount =
    side === 'additions'
      ? diff.additionLines.length
      : diff.deletionLines.length;
  for (let lineNumber = 1; lineNumber <= lineCount; lineNumber++) {
    expect({
      lineNumber,
      collapsed: isDiffLineInCollapsedContext({
        fileDiff: diff,
        lineNumber,
        side,
        expandedHunks,
        collapsedContextThreshold: COLLAPSED_CONTEXT_THRESHOLD,
      }),
    }).toEqual({ lineNumber, collapsed: !rendered.has(lineNumber) });
  }
}

describe('isDiffLineInCollapsedContext', () => {
  test.each(['additions', 'deletions'] as const)(
    'matches iterateOverDiff on the %s side when the sides number rows differently',
    (side) => {
      const diff = makeShiftedDiff();
      assertOracleMatches(diff, new Map(), side);
      assertOracleMatches(
        diff,
        new Map<number, HunkExpansionRegion>([
          [0, { fromStart: 3, fromEnd: 0 }],
          [1, { fromStart: 2, fromEnd: 4 }],
          [2, { fromStart: 3, fromEnd: 0 }],
        ]),
        side
      );
      assertOracleMatches(diff, true, side);
    }
  );

  test('matches iterateOverDiff with everything collapsed', () => {
    assertOracleMatches(makeDiff(), new Map());
  });

  test('matches iterateOverDiff with partially expanded regions', () => {
    assertOracleMatches(
      makeDiff(),
      new Map<number, HunkExpansionRegion>([
        // Leading gap of the first hunk, expanded from its start.
        [0, { fromStart: 3, fromEnd: 0 }],
        // Gap between the hunks, expanded from both edges.
        [1, { fromStart: 2, fromEnd: 4 }],
        // Trailing pseudo-key: context after the last hunk.
        [2, { fromStart: 3, fromEnd: 0 }],
      ])
    );
  });

  test('matches iterateOverDiff with a fully expanded gap', () => {
    assertOracleMatches(
      makeDiff(),
      new Map<number, HunkExpansionRegion>([[1, { fromStart: 99, fromEnd: 0 }]])
    );
  });

  test('reports no line collapsed when everything is expanded', () => {
    assertOracleMatches(makeDiff(), true);
  });

  test('reports lines beyond the modeled range as not collapsed', () => {
    const diff = makeDiff();
    // The editor document exposes one phantom line past the file end.
    expect(
      isDiffLineInCollapsedContext({
        fileDiff: diff,
        lineNumber: 41,
        side: 'additions',
        expandedHunks: new Map(),
        collapsedContextThreshold: COLLAPSED_CONTEXT_THRESHOLD,
      })
    ).toBe(false);
  });
});

describe('getNearestRenderableAdditionLine', () => {
  // The 40-line fixture's hunks (context 4) cover lines 6-14 and 26-34;
  // gaps are 1-5, 15-25, and trailing 35-40.
  function nearest(
    lineNumber: number,
    direction: 'up' | 'down',
    expandedHunks: Map<number, HunkExpansionRegion> = new Map()
  ): number | undefined {
    return getNearestRenderableAdditionLine({
      fileDiff: makeDiff(),
      lineNumber,
      direction,
      expandedHunks,
      collapsedContextThreshold: COLLAPSED_CONTEXT_THRESHOLD,
    });
  }

  test('returns renderable lines unchanged', () => {
    expect(nearest(10, 'down')).toBe(10);
    expect(nearest(10, 'up')).toBe(10);
  });

  test('skips down across the collapsed gap to the next hunk', () => {
    expect(nearest(15, 'down')).toBe(26);
  });

  test('skips up across the collapsed gap to the previous hunk', () => {
    expect(nearest(25, 'up')).toBe(14);
  });

  test('lands on partially expanded gap edges', () => {
    const expanded = new Map<number, HunkExpansionRegion>([
      [1, { fromStart: 2, fromEnd: 3 }],
    ]);
    // Gap 15-25: lines 15-16 and 23-25 render.
    expect(nearest(15, 'down', expanded)).toBe(15);
    expect(nearest(17, 'down', expanded)).toBe(23);
    expect(nearest(22, 'up', expanded)).toBe(16);
  });

  test('stays put inside the collapsed trailing gap going down', () => {
    expect(nearest(36, 'down')).toBeUndefined();
    expect(nearest(36, 'up')).toBe(34);
  });

  test('stays put inside the collapsed leading gap going up', () => {
    expect(nearest(3, 'up')).toBeUndefined();
    expect(nearest(3, 'down')).toBe(6);
  });

  test('treats lines beyond the modeled range as renderable', () => {
    expect(nearest(41, 'down')).toBe(41);
  });
});
