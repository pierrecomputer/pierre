import { describe, expect, test } from 'bun:test';
import type { CreatePatchOptionsNonabortable } from 'diff';

import type { FileDiffMetadata, HunkExpansionRegion } from '../src/types';
import {
  joinLines,
  lineAt,
  linesToArray,
  plainLines,
} from '../src/utils/diffLines';
import {
  applySessionChangedLines,
  captureExpansionAnchors,
  findDivergenceCore,
  finishEditSessionForDiff,
  normalizeEditorLines,
  rebuildExpansionFromAnchors,
  rebuildSessionHunks,
  remapExpandedHunksForRegionChange,
} from '../src/utils/editSessionHunks';
import { iterateOverDiff } from '../src/utils/iterateOverDiff';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { getTrailingContextRangeSize } from '../src/utils/virtualDiffLayout';
import { verifyFileDiffHunkValues } from './testUtils';

// These fixtures stand in for an attached editor, which only ever edits the
// addition side through its plain-string form. Read the side out, apply the
// edit, and hand it back as a plain `DiffLines` the way the renderer does.
function editAdditionLines(
  diff: FileDiffMetadata,
  edit: (lines: string[]) => void
): void {
  const lines = linesToArray(diff.additionLines);
  edit(lines);
  diff.additionLines = plainLines(lines);
}

function setAdditionLine(
  diff: FileDiffMetadata,
  index: number,
  text: string
): void {
  editAdditionLines(diff, (lines) => {
    lines[index] = text;
  });
}

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

function oldBounds(diff: FileDiffMetadata) {
  return diff.hunks.map((hunk) => [hunk.deletionLineIndex, hunk.deletionCount]);
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

function pairingProjection(diff: FileDiffMetadata) {
  const rows: Array<{
    deletionIndex: number | undefined;
    deletionText: string | undefined;
    additionIndex: number | undefined;
    additionText: string | undefined;
  }> = [];
  for (const hunk of diff.hunks) {
    for (const content of hunk.hunkContent) {
      if (content.type !== 'change') continue;
      const rowCount = Math.max(content.deletions, content.additions);
      for (let offset = 0; offset < rowCount; offset++) {
        const deletionIndex =
          offset < content.deletions
            ? content.deletionLineIndex + offset
            : undefined;
        const additionIndex =
          offset < content.additions
            ? content.additionLineIndex + offset
            : undefined;
        rows.push({
          deletionIndex,
          deletionText:
            deletionIndex == null
              ? undefined
              : lineAt(diff.deletionLines, deletionIndex),
          additionIndex,
          additionText:
            additionIndex == null
              ? undefined
              : lineAt(diff.additionLines, additionIndex),
        });
      }
    }
  }
  return rows;
}

function expectPairingParity(
  diff: FileDiffMetadata,
  parseDiffOptions?: CreatePatchOptionsNonabortable
): void {
  const expected = parseDiffFromFile(
    {
      name: diff.prevName ?? diff.name,
      contents: joinLines(diff.deletionLines),
    },
    {
      name: diff.name,
      contents: joinLines(diff.additionLines),
      lang: diff.lang,
    },
    parseDiffOptions
  );
  expect(pairingProjection(diff)).toEqual(pairingProjection(expected));
  expect(verifyFileDiffHunkValues(diff)).toEqual({ valid: true, errors: [] });
}

describe('normalizeEditorLines', () => {
  const normalized = (lines: string[]) =>
    linesToArray(normalizeEditorLines(plainLines(lines)));

  test('drops only the phantom trailing empty line', () => {
    expect(normalized(['a\n', 'b\n', ''])).toEqual(['a\n', 'b\n']);
    expect(normalized(['a\n', 'b'])).toEqual(['a\n', 'b']);
    expect(normalized([''])).toEqual(['']);
  });
});

describe('findDivergenceCore', () => {
  const divergence = (deletions: string[], additions: string[]) =>
    findDivergenceCore(plainLines(deletions), plainLines(additions));

  test('finds replacement, insertion, and the identical case', () => {
    expect(divergence(['a\n', 'b\n', 'c\n'], ['a\n', 'x\n', 'c\n'])).toEqual({
      start: 1,
      deletionEnd: 2,
      additionEnd: 2,
    });
    expect(divergence(['a\n', 'c\n'], ['a\n', 'b\n', 'c\n'])).toEqual({
      start: 1,
      deletionEnd: 1,
      additionEnd: 2,
    });
    expect(divergence(['a\n'], ['a\n'])).toBeUndefined();
  });
});

describe('rebuildSessionHunks', () => {
  test('derives downstream coordinates without moving old-side boundaries', () => {
    const diff = makeDiff();
    const before = oldBounds(diff);
    editAdditionLines(diff, (lines) => lines.splice(3, 0, 'inserted\n'));

    const change = rebuildSessionHunks(diff);

    expect(change).toBeDefined();
    expect(oldBounds(diff)).toEqual(before);
    expect(diff.hunks[0].additionCount).toBe(8);
    expect(diff.hunks[1].additionLineIndex).toBe(16);
    expect(() =>
      getTrailingContextRangeSize({ fileDiff: diff, errorPrefix: 'test' })
    ).not.toThrow();
    expectPairingParity(diff);
  });

  test('keeps a reverted region as context until session exit', () => {
    const diff = makeDiff();
    const before = hunkBounds(diff);
    const rowsBefore = countRenderedRows(diff);
    setAdditionLine(diff, 2, 'l3\n');

    expect(rebuildSessionHunks(diff)).toBeUndefined();

    expect(hunkBounds(diff)).toEqual(before);
    expect(diff.hunks[0].hunkContent).toEqual([
      {
        type: 'context',
        lines: before[0].additionCount,
        additionLineIndex: before[0].additionLineIndex,
        deletionLineIndex: before[0].deletionLineIndex,
      },
    ]);
    expect(countRenderedRows(diff)).toBe(rowsBefore);
    expectPairingParity(diff);
  });

  test('synthesizes separate regions for separate canonical blocks in one gap', () => {
    const diff = makeDiff();
    const before = oldBounds(diff);
    setAdditionLine(diff, 10, 'replaced a\n');
    setAdditionLine(diff, 13, 'replaced b\n');

    const change = rebuildSessionHunks(diff);

    expect(change?.regions).toEqual([
      { firstIndex: 0, lastIndex: 0 },
      undefined,
      undefined,
      { firstIndex: 1, lastIndex: 1 },
    ]);
    expect(diff.hunks).toHaveLength(4);
    expect(diff.hunks[1].deletionLineIndex).toBe(10);
    expect(diff.hunks[2].deletionLineIndex).toBe(13);
    expect(oldBounds(diff)[0]).toEqual(before[0]);
    expect(oldBounds(diff)[3]).toEqual(before[1]);
    expectPairingParity(diff);
  });

  test('merges regions only when a canonical block crosses their gap', () => {
    const diff = makeDiff();
    const before = oldBounds(diff);
    editAdditionLines(diff, (lines) =>
      lines.splice(5, 16, 'one bridge\n', 'two bridge\n')
    );

    const change = rebuildSessionHunks(diff);

    expect(change?.regions).toEqual([{ firstIndex: 0, lastIndex: 1 }]);
    expect(diff.hunks).toHaveLength(1);
    expect(diff.hunks[0].deletionLineIndex).toBe(before[0][0]);
    expect(diff.hunks[0].deletionLineIndex + diff.hunks[0].deletionCount).toBe(
      before[1][0] + before[1][1]
    );
    expectPairingParity(diff);
  });

  test('keeps full-parse pairing through repeated lines and sequential passes', () => {
    const oldContents = [
      '<main>',
      '<section>',
      '</div>',
      '</div>',
      '</div>',
      '</div>',
      '</div>',
      '</div>',
      '<footer>',
      '}',
      '}',
      '}',
      '</main>',
    ]
      .map((line) => `${line}\n`)
      .join('');
    const initialContents = oldContents
      .replace('<section>\n', '<section class="changed">\n')
      .replace('<footer>\n', '<footer class="changed">\n');
    const diff = parseDiffFromFile(
      { name: 'repeated.tsx', contents: oldContents },
      { name: 'repeated.tsx', contents: initialContents }
    );

    editAdditionLines(diff, (lines) => lines.splice(4, 0, '</div>\n'));
    rebuildSessionHunks(diff);
    expectPairingParity(diff);

    editAdditionLines(diff, (lines) => lines.splice(6, 1));
    rebuildSessionHunks(diff);
    expectPairingParity(diff);

    setAdditionLine(diff, 3, '</article>\n');
    rebuildSessionHunks(diff);
    expectPairingParity(diff);
  });

  test('retains repeated equal boundaries in the canonical parser input', () => {
    const oldLines = [
      'y\n',
      'x\n',
      '}\n',
      'same\n',
      '}\n',
      '</div>\n',
      '}\n',
      'x\n',
      '}\n',
      'same\n',
      '\n',
      'same\n',
      'y\n',
      'x\n',
    ];
    const initialLines = [...oldLines];
    initialLines[2] = 'initial a\n';
    initialLines[3] = 'initial b\n';
    const diff = parseDiffFromFile(
      { name: 'boundary.ts', contents: oldLines.join('') },
      { name: 'boundary.ts', contents: initialLines.join('') }
    );
    editAdditionLines(diff, (lines) => lines.splice(1, 0, 'y\n'));

    rebuildSessionHunks(diff);

    expectPairingParity(diff);
  });

  test('keeps blank insertion pairing identical to the exit parse', () => {
    const oldContents = 'a\nb\ntarget\n\nafter\nz1\nz2\nz3\nz4\nz5\n';
    const newContents = oldContents.replace('target\n', 'target!\n');
    const diff = parseDiffFromFile(
      { name: 't.ts', contents: oldContents },
      { name: 't.ts', contents: newContents }
    );
    editAdditionLines(diff, (lines) => lines.splice(3, 0, '\n'));

    rebuildSessionHunks(diff);

    expectPairingParity(diff);
  });

  test('supports a pure insertion into an unchanged file', () => {
    const contents = makeLines(8).join('');
    const diff = parseDiffFromFile(
      { name: 'plain.ts', contents },
      { name: 'plain.ts', contents }
    );
    editAdditionLines(diff, (lines) => lines.splice(4, 0, 'inserted\n'));

    expect(rebuildSessionHunks(diff)).toBeDefined();

    expect(diff.hunks).toHaveLength(1);
    expect(diff.hunks[0].deletionCount).toBe(1);
    expect(diff.hunks[0].additionCount).toBe(2);
    expectPairingParity(diff);
  });

  test('anchors a pure trailing deletion so the session hunk stays renderable', () => {
    const diff = makeDiff();
    editAdditionLines(diff, (lines) => lines.splice(29, 1));

    rebuildSessionHunks(diff);

    expect(diff.hunks).toHaveLength(3);
    expect(diff.hunks[2].additionCount).toBe(1);
    expect(diff.hunks[2].deletionCount).toBe(2);
    expect(() => countRenderedRows(diff)).not.toThrow();
    expect(() =>
      getTrailingContextRangeSize({ fileDiff: diff, errorPrefix: 'test' })
    ).not.toThrow();
    expectPairingParity(diff);
  });

  test('keeps trailing context valid when a persisted region becomes deletion-only', () => {
    const diff = makeDiff();
    setAdditionLine(diff, 27, 'temporary region\n');
    rebuildSessionHunks(diff);
    editAdditionLines(diff, (lines) => lines.splice(27, 1));

    rebuildSessionHunks(diff);

    expect(diff.hunks.at(-1)?.additionCount).toBe(0);
    expect(
      getTrailingContextRangeSize({ fileDiff: diff, errorPrefix: 'test' })
    ).toBe(2);
    expect(countRenderedRows(diff)).toBe(30);
    expectPairingParity(diff);
  });

  test('does not slide an already-canonical blank insertion a second time', () => {
    // The blank run outruns the diff context, so the canonical parse keeps
    // the library's bottom-of-run anchor (a hunk-edge-capped slide does not
    // apply); the session pass must land on the same anchor, not move it.
    const oldLines = ['first\n', ...Array(9).fill('\n'), 'last\n'];
    const initialLines = [...oldLines];
    initialLines[0] = 'changed\n';
    const diff = parseDiffFromFile(
      { name: 'blank-run.ts', contents: oldLines.join('') },
      { name: 'blank-run.ts', contents: initialLines.join('') }
    );
    editAdditionLines(diff, (lines) => lines.splice(1, 0, '\n'));

    rebuildSessionHunks(diff);

    expectPairingParity(diff);
    const insertion = diff.hunks
      .flatMap((hunk) => hunk.hunkContent)
      .find(
        (content) =>
          content.type === 'change' &&
          content.deletions === 0 &&
          content.additions === 1
      );
    expect(insertion).toMatchObject({
      deletionLineIndex: 10,
      additionLineIndex: 10,
    });
  });
});

describe('applySessionChangedLines', () => {
  test('uses the contained one-region fast path without replacing other hunks', () => {
    const diff = makeDiff();
    const hunksBefore = diff.hunks;
    const firstBefore = diff.hunks[0];
    const secondBefore = diff.hunks[1];
    const boundsBefore = oldBounds(diff);
    const previousLine = lineAt(diff.additionLines, 2);
    setAdditionLine(diff, 2, 'retyped 3\n');

    const change = applySessionChangedLines(
      diff,
      [2],
      undefined,
      new Map([[2, previousLine]])
    );

    expect(change).toBeUndefined();
    expect(diff.hunks).toBe(hunksBefore);
    expect(diff.hunks[0]).toBe(firstBefore);
    expect(diff.hunks[1]).toBe(secondBefore);
    expect(oldBounds(diff)).toEqual(boundsBefore);
    expectPairingParity(diff);
  });

  test('routes a gap edit through the structural rebuild', () => {
    const diff = makeDiff();
    setAdditionLine(diff, 11, 'replaced in gap\n');

    const change = applySessionChangedLines(diff, [11]);

    expect(change).toBeDefined();
    expect(diff.hunks).toHaveLength(3);
    expect(diff.hunks[1].additionLineIndex).toBe(11);
    expectPairingParity(diff);
  });

  test('routes edits in several regions through one rebuild without merging them', () => {
    const diff = makeDiff();
    setAdditionLine(diff, 2, 'retyped 3\n');
    setAdditionLine(diff, 19, 'retyped 20\n');

    const change = applySessionChangedLines(diff, [2, 19]);

    expect(change).toBeUndefined();
    expect(diff.hunks).toHaveLength(2);
    expectPairingParity(diff);
  });

  test('falls back when a local alignment reaches a repeated slice edge', () => {
    const oldLines = [
      'same\n',
      'y\n',
      'same\n',
      '\n',
      '</div>\n',
      '}\n',
      '</div>\n',
      '}\n',
      '</div>\n',
      '}\n',
      '</div>\n',
      '\n',
      'same\n',
      'y\n',
      '</div>\n',
      'y\n',
      'same\n',
      '}\n',
      'x\n',
      '\n',
    ];
    const initialLines = [...oldLines];
    initialLines[5] = 'initial\n';
    const diff = parseDiffFromFile(
      { name: 'edge.ts', contents: oldLines.join('') },
      { name: 'edge.ts', contents: initialLines.join('') }
    );
    setAdditionLine(diff, 6, 'x!\n');

    applySessionChangedLines(diff, [6]);

    expectPairingParity(diff);
  });

  test('falls back when a blank run can cross contextual slice edges', () => {
    const oldLines = ['x\n', ...Array(5).fill('\n'), 'z\n'];
    const initialLines = [...oldLines];
    initialLines.splice(1, 0, 'extra\n');
    const diff = parseDiffFromFile(
      { name: 'blank-edge.ts', contents: oldLines.join('') },
      { name: 'blank-edge.ts', contents: initialLines.join('') }
    );
    const hunksBefore = diff.hunks;
    setAdditionLine(diff, 1, '\n');

    applySessionChangedLines(diff, [1]);

    expect(diff.hunks).not.toBe(hunksBefore);
    expectPairingParity(diff);
  });

  test('falls back at a file edge when context-zero pairing is ambiguous', () => {
    const parseDiffOptions = { context: 0 };
    const diff = parseDiffFromFile(
      { name: 'context-zero.ts', contents: '\n\n' },
      { name: 'context-zero.ts', contents: 'a\n' },
      parseDiffOptions
    );
    const previousLine = lineAt(diff.additionLines, 0);
    setAdditionLine(diff, 0, '\n');

    applySessionChangedLines(
      diff,
      [0],
      parseDiffOptions,
      new Map([[0, previousLine]])
    );

    expectPairingParity(diff, parseDiffOptions);
  });

  test('falls back for balanced blocks produced by similarity realignment', () => {
    const diff = parseDiffFromFile(
      { name: 'realigned.ts', contents: 'target\n' },
      { name: 'realigned.ts', contents: 'junk\ntarget!\n' }
    );
    const hunksBefore = diff.hunks;
    const previousLine = lineAt(diff.additionLines, 1);
    setAdditionLine(diff, 1, 'other\n');

    applySessionChangedLines(
      diff,
      [1],
      undefined,
      new Map([[1, previousLine]])
    );

    expect(diff.hunks).not.toBe(hunksBefore);
    expectPairingParity(diff);
  });

  test('falls back when blank sliding separates realignment segments', () => {
    const diff = parseDiffFromFile(
      { name: 'slid-realignment.ts', contents: 'anchor\n\ntarget\n' },
      {
        name: 'slid-realignment.ts',
        contents: 'anchor\n\n\ntarget!\n',
      }
    );
    const hunksBefore = diff.hunks;
    const previousLine = lineAt(diff.additionLines, 3);
    setAdditionLine(diff, 3, 'other\n');

    applySessionChangedLines(
      diff,
      [3],
      undefined,
      new Map([[3, previousLine]])
    );

    expect(diff.hunks).not.toBe(hunksBefore);
    expectPairingParity(diff);
  });
});

describe('remapExpandedHunksForRegionChange', () => {
  const region = (fromStart: number, fromEnd: number): HunkExpansionRegion => ({
    fromStart,
    fromEnd,
  });

  test('drops merged-away gaps and preserves outer expansion edges', () => {
    const map = new Map([
      [0, region(2, 1)],
      [1, region(3, 4)],
      [2, region(5, 0)],
    ]);
    expect(
      remapExpandedHunksForRegionChange(map, {
        regions: [{ firstIndex: 0, lastIndex: 1 }],
      })
    ).toEqual(
      new Map([
        [0, region(2, 1)],
        [1, region(5, 0)],
      ])
    );
  });

  test('splits a gap expansion around synthesized regions', () => {
    const map = new Map([
      [0, region(1, 0)],
      [1, region(5, 3)],
      [2, region(4, 0)],
    ]);
    expect(
      remapExpandedHunksForRegionChange(map, {
        regions: [
          { firstIndex: 0, lastIndex: 0 },
          undefined,
          { firstIndex: 1, lastIndex: 1 },
        ],
      })
    ).toEqual(
      new Map([
        [0, region(1, 0)],
        [1, region(5, 0)],
        [2, region(0, 3)],
        [3, region(4, 0)],
      ])
    );
  });
});

describe('expansion anchors across the exit recompute', () => {
  const THRESHOLD = 1;

  test('anchors a context-zero insertion to the consumed old-side gap', () => {
    const oldLines = makeLines(12);
    const additionLines = oldLines.toSpliced(10, 0, 'inserted\n');
    const diff = parseDiffFromFile(
      { name: 'insertion.ts', contents: oldLines.join('') },
      { name: 'insertion.ts', contents: additionLines.join('') },
      { context: 0 }
    );

    const anchors = captureExpansionAnchors(
      diff,
      new Map([[0, { fromStart: 2, fromEnd: 2 }]]),
      THRESHOLD
    );

    expect(anchors).toEqual([
      [0, 2],
      [8, 10],
    ]);
    expect(rebuildExpansionFromAnchors(diff, anchors)).toEqual(
      new Map([[0, { fromStart: 2, fromEnd: 2 }]])
    );
  });

  test('a surviving gap keeps its edge expansions', () => {
    const diff = makeDiff();
    const expandedHunks = new Map<number, HunkExpansionRegion>([
      [1, { fromStart: 2, fromEnd: 3 }],
    ]);
    const anchors = captureExpansionAnchors(diff, expandedHunks, THRESHOLD);
    editAdditionLines(diff, (lines) => lines.splice(3, 0, 'inserted\n'));
    rebuildSessionHunks(diff);
    finishEditSessionForDiff(diff);

    expect(rebuildExpansionFromAnchors(diff, anchors).get(1)).toEqual({
      fromStart: 2,
      fromEnd: 3,
    });
  });

  test('interior anchors drop when exit removes a reverted region', () => {
    const diff = makeDiff();
    const expandedHunks = new Map<number, HunkExpansionRegion>([
      [1, { fromStart: 2, fromEnd: 3 }],
    ]);
    const anchors = captureExpansionAnchors(diff, expandedHunks, THRESHOLD);
    setAdditionLine(diff, 2, 'l3\n');
    rebuildSessionHunks(diff);
    finishEditSessionForDiff(diff);

    expect(diff.hunks).toHaveLength(1);
    expect(rebuildExpansionFromAnchors(diff, anchors)).toEqual(
      new Map([[0, { fromStart: 0, fromEnd: 3 }]])
    );
  });

  test('trailing pseudo-key expansion survives session exit', () => {
    const diff = makeDiff();
    const expandedHunks = new Map<number, HunkExpansionRegion>([
      [diff.hunks.length, { fromStart: 4, fromEnd: 0 }],
    ]);
    const anchors = captureExpansionAnchors(diff, expandedHunks, THRESHOLD);
    setAdditionLine(diff, 2, 'changed differently\n');
    rebuildSessionHunks(diff);
    finishEditSessionForDiff(diff);

    expect(rebuildExpansionFromAnchors(diff, anchors)).toEqual(
      new Map([[diff.hunks.length, { fromStart: 4, fromEnd: 0 }]])
    );
  });
});

describe('finishEditSessionForDiff', () => {
  test('a dirty session recomputes to the plain edit pipeline result', () => {
    const diff = makeDiff();
    setAdditionLine(diff, 2, 'l3\n');
    rebuildSessionHunks(diff);
    setAdditionLine(diff, 11, 'gap edit\n');
    applySessionChangedLines(diff, [11]);
    expect(diff.hunks).toHaveLength(3);

    expect(finishEditSessionForDiff(diff)).toBe(true);
    expect(diff.editSessionDirty).toBeUndefined();

    const expected = parseDiffFromFile(
      { name: 'a.ts', contents: joinLines(diff.deletionLines) },
      { name: 'a.ts', contents: joinLines(diff.additionLines) }
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
