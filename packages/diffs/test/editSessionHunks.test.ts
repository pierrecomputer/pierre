import { describe, expect, test } from 'bun:test';

import type { FileDiffMetadata, HunkExpansionRegion } from '../src/types';
import {
  applySessionChangedLines,
  applySessionEditWindow,
  captureExpansionAnchors,
  findChangedLineWindow,
  finishEditSessionForDiff,
  normalizeEditorLines,
  rebuildExpansionFromAnchors,
  remapExpandedHunksForRegionChange,
} from '../src/utils/editSessionHunks';
import { iterateOverDiff } from '../src/utils/iterateOverDiff';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { getTrailingContextRangeSize } from '../src/utils/virtualDiffLayout';

// 30-line file with two separated changes -> two hunks with a collapsible
// unchanged gap between them and trailing unchanged context after the second.
function makeLines(
  count: number,
  edits: Record<number, string> = {}
): string[] {
  return Array.from(
    { length: count },
    (_, index) => (edits[index + 1] ?? `l${index + 1}`) + '\n'
  );
}

function makeDiff(
  newEdits: Record<number, string> = { 3: 'changed 3', 20: 'changed 20' }
): FileDiffMetadata {
  return parseDiffFromFile(
    { name: 'a.ts', contents: makeLines(30).join('') },
    { name: 'a.ts', contents: makeLines(30, newEdits).join('') }
  );
}

function hunkBounds(diff: FileDiffMetadata) {
  return diff.hunks.map((hunk) => ({
    additionLineIndex: hunk.additionLineIndex,
    additionCount: hunk.additionCount,
    deletionLineIndex: hunk.deletionLineIndex,
    deletionCount: hunk.deletionCount,
  }));
}

function countRenderedRows(diff: FileDiffMetadata): number {
  let rows = 0;
  iterateOverDiff({
    diff,
    diffStyle: 'split',
    expandedHunks: true,
    callback: () => {
      rows++;
    },
  });
  return rows;
}

describe('normalizeEditorLines', () => {
  test('drops only the phantom trailing empty line', () => {
    expect(normalizeEditorLines(['a\n', 'b\n', ''])).toEqual(['a\n', 'b\n']);
    expect(normalizeEditorLines(['a\n', 'b'])).toEqual(['a\n', 'b']);
    expect(normalizeEditorLines([''])).toEqual(['']);
  });
});

describe('findChangedLineWindow', () => {
  test('locates a replaced line', () => {
    expect(
      findChangedLineWindow(['a\n', 'b\n', 'c\n'], ['a\n', 'x\n', 'c\n'])
    ).toEqual({ start: 1, prevEnd: 2, nextEnd: 2 });
  });

  test('locates a pure insert', () => {
    expect(
      findChangedLineWindow(['a\n', 'c\n'], ['a\n', 'b\n', 'c\n'])
    ).toEqual({ start: 1, prevEnd: 1, nextEnd: 2 });
  });

  test('returns undefined for identical lines', () => {
    expect(findChangedLineWindow(['a\n'], ['a\n'])).toBeUndefined();
  });
});

describe('applySessionEditWindow', () => {
  test('re-diff inside a region keeps boundaries and reports no change', () => {
    const diff = makeDiff();
    const boundsBefore = hunkBounds(diff);
    diff.additionLines[2] = 'changed again\n';

    const change = applySessionEditWindow(diff, {
      start: 2,
      prevEnd: 3,
      nextEnd: 3,
    });

    expect(change).toBeUndefined();
    expect(hunkBounds(diff)).toEqual(boundsBefore);
    expect(diff.editSessionDirty).toBe(true);
  });

  test('a reverted region persists as a context-only hunk', () => {
    const diff = makeDiff();
    const boundsBefore = hunkBounds(diff);
    const rowsBefore = countRenderedRows(diff);
    diff.additionLines[2] = 'l3\n';

    const change = applySessionEditWindow(diff, {
      start: 2,
      prevEnd: 3,
      nextEnd: 3,
    });

    expect(change).toBeUndefined();
    expect(diff.hunks).toHaveLength(2);
    expect(hunkBounds(diff)).toEqual(boundsBefore);
    expect(diff.hunks[0].hunkContent).toEqual([
      {
        type: 'context',
        lines: boundsBefore[0].additionCount,
        additionLineIndex: boundsBefore[0].additionLineIndex,
        deletionLineIndex: boundsBefore[0].deletionLineIndex,
      },
    ]);
    expect(diff.hunks[0].additionLines).toBe(0);
    // The context-only hunk still renders every one of its rows.
    expect(countRenderedRows(diff)).toBe(rowsBefore);
  });

  test('an insert inside a region grows it and shifts later regions', () => {
    const diff = makeDiff();
    const boundsBefore = hunkBounds(diff);
    diff.additionLines.splice(3, 0, 'inserted\n');

    const change = applySessionEditWindow(diff, {
      start: 3,
      prevEnd: 3,
      nextEnd: 4,
    });

    expect(change).toBeUndefined();
    expect(diff.hunks).toHaveLength(2);
    expect(diff.hunks[0].additionCount).toBe(boundsBefore[0].additionCount + 1);
    expect(diff.hunks[0].deletionCount).toBe(boundsBefore[0].deletionCount);
    expect(diff.hunks[1].additionLineIndex).toBe(
      boundsBefore[1].additionLineIndex + 1
    );
    expect(diff.hunks[1].deletionLineIndex).toBe(
      boundsBefore[1].deletionLineIndex
    );
    // Trailing unchanged context must stay symmetric between sides.
    expect(() =>
      getTrailingContextRangeSize({ fileDiff: diff, errorPrefix: 'test' })
    ).not.toThrow();
  });

  test('an edit spanning the gap merges both regions and absorbs paired gap lines', () => {
    const diff = makeDiff();
    const boundsBefore = hunkBounds(diff);
    diff.additionLines[5] = 'edited 6\n';
    diff.additionLines[20] = 'edited 21\n';

    const change = applySessionEditWindow(diff, {
      start: 5,
      prevEnd: 21,
      nextEnd: 21,
    });

    expect(change).toEqual({
      type: 'merge',
      firstIndex: 0,
      lastIndex: 1,
      previousHunkCount: 2,
    });
    expect(diff.hunks).toHaveLength(1);
    const merged = diff.hunks[0];
    expect(merged.additionLineIndex).toBe(boundsBefore[0].additionLineIndex);
    expect(merged.additionCount).toBe(
      boundsBefore[1].additionLineIndex +
        boundsBefore[1].additionCount -
        boundsBefore[0].additionLineIndex
    );
    // Gap lines are absorbed in paired correspondence, so the deletion side
    // spans the same range.
    expect(merged.deletionLineIndex).toBe(boundsBefore[0].deletionLineIndex);
    expect(merged.deletionCount).toBe(
      boundsBefore[1].deletionLineIndex +
        boundsBefore[1].deletionCount -
        boundsBefore[0].deletionLineIndex
    );
    // The previously collapsed gap now renders as context inside the region.
    expect(
      merged.hunkContent.some((content) => content.type === 'context')
    ).toBe(true);
  });

  test('a pure insert into a gap synthesizes a region anchored on a context line', () => {
    const diff = makeDiff();
    const boundsBefore = hunkBounds(diff);
    diff.additionLines.splice(12, 0, 'new a\n', 'new b\n');

    const change = applySessionEditWindow(diff, {
      start: 12,
      prevEnd: 12,
      nextEnd: 14,
    });

    expect(change).toEqual({ type: 'insert', index: 1, previousHunkCount: 2 });
    expect(diff.hunks).toHaveLength(3);
    const synthesized = diff.hunks[1];
    // One preceding context line was absorbed to anchor the re-diff.
    expect(synthesized.additionLineIndex).toBe(11);
    expect(synthesized.additionCount).toBe(3);
    expect(synthesized.deletionLineIndex).toBe(11);
    expect(synthesized.deletionCount).toBe(1);
    expect(synthesized.additionLines).toBe(2);
    expect(synthesized.deletionLines).toBe(0);
    // The following region shifted by the insert, deletion side untouched.
    expect(diff.hunks[2].additionLineIndex).toBe(
      boundsBefore[1].additionLineIndex + 2
    );
    expect(diff.hunks[2].deletionLineIndex).toBe(
      boundsBefore[1].deletionLineIndex
    );
    expect(() =>
      getTrailingContextRangeSize({ fileDiff: diff, errorPrefix: 'test' })
    ).not.toThrow();
  });

  test('reverting every region keeps one context-only hunk per region', () => {
    const diff = makeDiff();
    diff.additionLines[2] = 'l3\n';
    applySessionEditWindow(diff, { start: 2, prevEnd: 3, nextEnd: 3 });
    diff.additionLines[19] = 'l20\n';
    applySessionEditWindow(diff, { start: 19, prevEnd: 20, nextEnd: 20 });

    expect(diff.hunks).toHaveLength(2);
    for (const hunk of diff.hunks) {
      expect(hunk.hunkContent).toHaveLength(1);
      expect(hunk.hunkContent[0].type).toBe('context');
    }
  });

  test('a blank pushed beside an existing blank stays anchored to the edit', () => {
    // Enter at the end of a changed line that is followed by a blank line:
    // the prefix scan slides the detected insert past the identical blank,
    // but the blank-run slide re-anchors it to the edited line, matching the
    // exit parse.
    const oldContents = 'a\nb\ntarget\n\nafter\nz1\nz2\nz3\nz4\nz5\n';
    const newContents = oldContents.replace('target\n', 'target!\n');
    const diff = parseDiffFromFile(
      { name: 't.ts', contents: oldContents },
      { name: 't.ts', contents: newContents }
    );
    diff.additionLines.splice(3, 0, '\n');
    // The scan reports the insert after the pre-existing blank at index 3.
    const change = applySessionEditWindow(diff, {
      start: 4,
      prevEnd: 4,
      nextEnd: 5,
    });

    expect(change).toBeUndefined();
    // The line pairing matches what the exit recompute will produce: the
    // change blocks are identical (hunk bounds legitimately differ — the
    // frozen region keeps its envelope while exit re-derives context).
    const exit = parseDiffFromFile(
      { name: 't.ts', contents: oldContents },
      { name: 't.ts', contents: diff.additionLines.join('') }
    );
    const changesOf = (hunkContent: (typeof diff.hunks)[0]['hunkContent']) =>
      hunkContent.filter((block) => block.type === 'change');
    expect(changesOf(diff.hunks[0].hunkContent)).toEqual(
      changesOf(exit.hunks[0].hunkContent)
    );
    // Anchored directly after the edited line, not after the old blank.
    expect(changesOf(diff.hunks[0].hunkContent)[1]).toEqual({
      type: 'change',
      deletions: 0,
      additions: 1,
      deletionLineIndex: 3,
      additionLineIndex: 3,
    });
  });
});

describe('applySessionChangedLines', () => {
  test('changed lines inside regions re-diff in place', () => {
    const diff = makeDiff();
    const boundsBefore = hunkBounds(diff);
    diff.additionLines[2] = 'retyped 3\n';
    diff.additionLines[19] = 'retyped 20\n';

    const changes = applySessionChangedLines(diff, [2, 19]);

    expect(changes).toEqual([]);
    expect(hunkBounds(diff)).toEqual(boundsBefore);
  });

  test('a changed line inside a gap synthesizes a region', () => {
    const diff = makeDiff();
    diff.additionLines[11] = 'replaced in gap\n';

    const changes = applySessionChangedLines(diff, [11]);

    expect(changes).toEqual([
      { type: 'insert', index: 1, previousHunkCount: 2 },
    ]);
    expect(diff.hunks).toHaveLength(3);
    expect(diff.hunks[1].additionLineIndex).toBe(11);
    expect(diff.hunks[1].additionCount).toBe(1);
    expect(diff.hunks[1].deletionCount).toBe(1);
  });

  test('several changed lines in one gap synthesize a single region', () => {
    const diff = makeDiff();
    diff.additionLines[10] = 'replaced a\n';
    diff.additionLines[13] = 'replaced b\n';

    const changes = applySessionChangedLines(diff, [10, 13]);

    expect(changes).toHaveLength(1);
    expect(diff.hunks).toHaveLength(3);
    expect(diff.hunks[1].additionLineIndex).toBe(10);
    expect(diff.hunks[1].additionCount).toBe(4);
    // Unchanged lines between the two edits become context inside the region.
    expect(
      diff.hunks[1].hunkContent.some((content) => content.type === 'context')
    ).toBe(true);
  });
});

describe('remapExpandedHunksForRegionChange', () => {
  const region = (fromStart: number, fromEnd: number): HunkExpansionRegion => ({
    fromStart,
    fromEnd,
  });

  test('merge drops absorbed gap keys and shifts later ones', () => {
    const map = new Map([
      [0, region(2, 0)],
      [1, region(3, 1)],
      [2, region(0, 4)],
      [3, region(5, 5)],
    ]);
    const remapped = remapExpandedHunksForRegionChange(map, {
      type: 'merge',
      firstIndex: 1,
      lastIndex: 2,
      previousHunkCount: 3,
    });
    expect(remapped).toEqual(
      new Map([
        [0, region(2, 0)],
        [1, region(3, 1)],
        [2, region(5, 5)],
      ])
    );
  });

  test('insert splits the affected gap key across the two new gaps', () => {
    const map = new Map([
      [0, region(1, 0)],
      [1, region(5, 3)],
      [2, region(0, 2)],
    ]);
    const remapped = remapExpandedHunksForRegionChange(map, {
      type: 'insert',
      index: 1,
      previousHunkCount: 2,
    });
    expect(remapped).toEqual(
      new Map([
        [0, region(1, 0)],
        [1, region(5, 0)],
        [2, region(0, 3)],
        [3, region(0, 2)],
      ])
    );
  });
});

describe('expansion anchors across the exit recompute', () => {
  const THRESHOLD = 1;

  test('a gap that still exists keeps its edge expansions', () => {
    const diff = makeDiff();
    const expandedHunks = new Map<number, HunkExpansionRegion>([
      [1, { fromStart: 2, fromEnd: 3 }],
    ]);
    const anchors = captureExpansionAnchors(diff, expandedHunks, THRESHOLD);
    expect(anchors.length).toBe(2);

    // A session insert inside the first hunk shifts the addition side but
    // leaves old-side coordinates alone.
    diff.additionLines.splice(3, 0, 'inserted\n');
    applySessionEditWindow(diff, { start: 3, prevEnd: 3, nextEnd: 4 });
    finishEditSessionForDiff(diff);

    const rebuilt = rebuildExpansionFromAnchors(diff, anchors);
    expect(rebuilt.get(1)).toEqual({ fromStart: 2, fromEnd: 3 });
  });

  test('anchors interior to a merged gap drop; edge-anchored ones survive', () => {
    const diff = makeDiff();
    const expandedHunks = new Map<number, HunkExpansionRegion>([
      [1, { fromStart: 2, fromEnd: 3 }],
    ]);
    const anchors = captureExpansionAnchors(diff, expandedHunks, THRESHOLD);

    // Reverting the first hunk removes it at exit, merging its leading gap
    // with the gap between the hunks.
    diff.additionLines[2] = 'l3\n';
    applySessionEditWindow(diff, { start: 2, prevEnd: 3, nextEnd: 3 });
    finishEditSessionForDiff(diff);
    expect(diff.hunks).toHaveLength(1);

    const rebuilt = rebuildExpansionFromAnchors(diff, anchors);
    // The fromEnd slice still touches the surviving gap's end edge; the
    // fromStart slice is now interior to the bigger gap and drops.
    expect(rebuilt.get(0)).toEqual({ fromStart: 0, fromEnd: 3 });
    expect(rebuilt.size).toBe(1);
  });

  test('trailing pseudo-key expansion survives', () => {
    const diff = makeDiff();
    const expandedHunks = new Map<number, HunkExpansionRegion>([
      [2, { fromStart: 4, fromEnd: 0 }],
    ]);
    const anchors = captureExpansionAnchors(diff, expandedHunks, THRESHOLD);
    expect(anchors.length).toBe(1);

    diff.additionLines[2] = 'changed differently\n';
    applySessionEditWindow(diff, { start: 2, prevEnd: 3, nextEnd: 3 });
    finishEditSessionForDiff(diff);

    const rebuilt = rebuildExpansionFromAnchors(diff, anchors);
    expect(rebuilt.get(diff.hunks.length)).toEqual({
      fromStart: 4,
      fromEnd: 0,
    });
  });
});

describe('finishEditSessionForDiff', () => {
  test('a dirty session recomputes to the plain edit pipeline result', () => {
    const diff = makeDiff();
    // Revert the first hunk, then edit inside the gap: session-shaped hunks.
    diff.additionLines[2] = 'l3\n';
    applySessionEditWindow(diff, { start: 2, prevEnd: 3, nextEnd: 3 });
    diff.additionLines[11] = 'gap edit\n';
    applySessionChangedLines(diff, [11]);
    expect(diff.hunks).toHaveLength(3);

    expect(finishEditSessionForDiff(diff)).toBe(true);
    expect(diff.editSessionDirty).toBeUndefined();

    const expected = parseDiffFromFile(
      { name: 'a.ts', contents: diff.deletionLines.join('') },
      { name: 'a.ts', contents: diff.additionLines.join('') }
    );
    expect(diff.hunks).toEqual(expected.hunks);
    expect(diff.splitLineCount).toBe(expected.splitLineCount);
    expect(diff.unifiedLineCount).toBe(expected.unifiedLineCount);
  });

  test('a zero-edit session leaves patch-derived hunks untouched', () => {
    const diff = makeDiff();
    const hunksBefore = diff.hunks;
    expect(finishEditSessionForDiff(diff)).toBe(false);
    expect(diff.hunks).toBe(hunksBefore);
  });
});
