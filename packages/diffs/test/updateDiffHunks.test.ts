import { describe, expect, test } from 'bun:test';

import type { FileDiffMetadata, Hunk } from '../src/types';
import { cleanLastNewline } from '../src/utils/cleanLastNewline';
import { iterateOverDiff } from '../src/utils/iterateOverDiff';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import {
  recomputeDiffHunks,
  recomputeDiffHunksForEdit,
  updateDiffHunks,
} from '../src/utils/updateDiffHunks';
import { hasTrailingContextMismatch } from '../src/utils/virtualDiffLayout';
import { verifyFileDiffHunkValues } from './testUtils';

const PARSE_OPTIONS = { context: 1 } as const;

function createFixture(): FileDiffMetadata {
  const oldContents = [
    'line 01 stable',
    'line 02 add anchor',
    'line 03 stable',
    'line 04 stable',
    'line 05 stable',
    'line 06 delete me',
    'line 07 stable',
    'line 08 stable',
    'line 09 stable',
    'line 10 replace old',
    'line 11 stable',
    'line 12 stable',
    'line 13 stable',
    'line 14 mix old a',
    'line 15 mix shared',
    'line 16 mix old b',
    'line 17 stable',
    '',
  ].join('\n');
  const newContents = [
    'line 01 stable',
    'line 02 add anchor',
    'line 02.1 add first',
    'line 02.2 add second',
    'line 03 stable',
    'line 04 stable',
    'line 05 stable',
    'line 07 stable',
    'line 08 stable',
    'line 09 stable',
    'line 10 replace new',
    'line 11 stable',
    'line 12 stable',
    'line 13 stable',
    'line 14 mix new a',
    'line 15 mix shared',
    'line 16 mix new b',
    'line 17 stable',
    '',
  ].join('\n');

  return parseDiffFromFile(
    { name: 'example.ts', contents: oldContents },
    { name: 'example.ts', contents: newContents },
    PARSE_OPTIONS
  );
}

function findAdditionLineIndex(
  diff: FileDiffMetadata,
  lineText: string
): number {
  const line = diff.additionLines.findIndex(
    (value) => cleanLastNewline(value) === lineText
  );
  if (line < 0) {
    throw new Error(`Missing addition line: ${lineText}`);
  }
  return line;
}

function findHunkIndexForAdditionLine(
  diff: FileDiffMetadata,
  line: number
): number {
  for (const [hunkIndex, hunk] of diff.hunks.entries()) {
    const end = hunk.additionLineIndex + hunk.additionCount;
    if (line >= hunk.additionLineIndex && line < end) {
      return hunkIndex;
    }
  }
  throw new Error(`Line ${line} is not covered by any hunk`);
}

function setAdditionLineText(
  diff: FileDiffMetadata,
  line: number,
  lineText: string
): void {
  const prevLine = diff.additionLines[line];
  if (prevLine == null) {
    throw new Error(`Missing addition line ${line}`);
  }
  if (prevLine.endsWith('\r\n')) {
    diff.additionLines[line] = `${lineText}\r\n`;
  } else if (prevLine.endsWith('\n')) {
    diff.additionLines[line] = `${lineText}\n`;
  } else if (prevLine.endsWith('\r')) {
    diff.additionLines[line] = `${lineText}\r`;
  } else {
    diff.additionLines[line] = lineText;
  }
}

function cloneDiff(diff: FileDiffMetadata): FileDiffMetadata {
  return structuredClone(diff);
}

function applyFullRecompute(diff: FileDiffMetadata): void {
  Object.assign(diff, recomputeDiffHunks(diff, PARSE_OPTIONS));
}

function expectMatchesFullRecompute(
  updated: FileDiffMetadata,
  full: FileDiffMetadata
): void {
  expect(updated.hunks).toEqual(full.hunks);
  expect(updated.splitLineCount).toBe(full.splitLineCount);
  expect(updated.unifiedLineCount).toBe(full.unifiedLineCount);
  expect(verifyFileDiffHunkValues(updated)).toEqual({
    valid: true,
    errors: [],
  });
}

function runUpdateDiffHunksEdit(
  base: FileDiffMetadata,
  line: number,
  lineText: string
): FileDiffMetadata {
  const diff = cloneDiff(base);
  setAdditionLineText(diff, line, lineText);
  updateDiffHunks(diff, [line], PARSE_OPTIONS);
  return diff;
}

function runFullRecomputeEdit(
  base: FileDiffMetadata,
  line: number,
  lineText: string
): FileDiffMetadata {
  const diff = cloneDiff(base);
  setAdditionLineText(diff, line, lineText);
  applyFullRecompute(diff);
  return diff;
}

describe('updateDiffHunks', () => {
  test('matches full recompute when a stable context line is edited', () => {
    const base = createFixture();
    const line = findAdditionLineIndex(base, 'line 03 stable');
    const editedText = 'line 03 edited in place';

    expectMatchesFullRecompute(
      runUpdateDiffHunksEdit(base, line, editedText),
      runFullRecomputeEdit(base, line, editedText)
    );
  });

  test('matches full recompute when a change line is edited', () => {
    const base = createFixture();
    const line = findAdditionLineIndex(base, 'line 10 replace new');

    expectMatchesFullRecompute(
      runUpdateDiffHunksEdit(base, line, 'line 10 replace newer'),
      runFullRecomputeEdit(base, line, 'line 10 replace newer')
    );
  });

  test('matches full recompute when a changed line is restored to the old text', () => {
    const base = createFixture();
    const line = findAdditionLineIndex(base, 'line 14 mix new a');

    expectMatchesFullRecompute(
      runUpdateDiffHunksEdit(base, line, 'line 14 mix old a'),
      runFullRecomputeEdit(base, line, 'line 14 mix old a')
    );
  });

  test('keeps hunk structure when only change-block line text changes', () => {
    const base = createFixture();
    const line = findAdditionLineIndex(base, 'line 10 replace new');
    const hunkIndex = findHunkIndexForAdditionLine(base, line);
    const hunkBefore: Hunk = structuredClone(base.hunks[hunkIndex]);

    const diff = runUpdateDiffHunksEdit(base, line, 'line 10 replace newer');

    expect(diff.hunks[hunkIndex]).toEqual(hunkBefore);
    expect(cleanLastNewline(diff.additionLines[line])).toBe(
      'line 10 replace newer'
    );
  });

  test('recomputeDiffHunks matches parseDiffFromFile for edited file contents', () => {
    const base = createFixture();
    const line = findAdditionLineIndex(base, 'line 03 stable');
    const diff = cloneDiff(base);
    setAdditionLineText(diff, line, 'line 03 edited in place');

    const fromHelper = recomputeDiffHunks(diff, PARSE_OPTIONS);
    const fromParse = parseDiffFromFile(
      {
        name: diff.prevName ?? diff.name,
        contents: diff.deletionLines.join(''),
      },
      {
        name: diff.name,
        contents: diff.additionLines.join(''),
        lang: diff.lang,
      },
      PARSE_OPTIONS
    );

    expect(fromHelper.hunks).toEqual(fromParse.hunks);
    expect(fromHelper.splitLineCount).toBe(fromParse.splitLineCount);
    expect(fromHelper.unifiedLineCount).toBe(fromParse.unifiedLineCount);
  });

  test('accepts single-use iterables without falling back to full recompute', () => {
    const base = createFixture();
    const line = findAdditionLineIndex(base, 'line 10 replace new');
    const hunkIndex = findHunkIndexForAdditionLine(base, line);
    const hunkBefore: Hunk = structuredClone(base.hunks[hunkIndex]);

    const diff = cloneDiff(base);
    setAdditionLineText(diff, line, 'line 10 replace newer');
    updateDiffHunks(
      diff,
      (function* () {
        yield line;
      })(),
      PARSE_OPTIONS
    );

    expect(diff.hunks[hunkIndex]).toEqual(hunkBefore);
    expect(cleanLastNewline(diff.additionLines[line])).toBe(
      'line 10 replace newer'
    );
  });

  test('returns unchanged metadata when no lines changed', () => {
    const base = createFixture();
    const diff = cloneDiff(base);
    const hunksBefore = structuredClone(diff.hunks);

    updateDiffHunks(diff, [], PARSE_OPTIONS);

    expect(diff.hunks).toEqual(hunksBefore);
    expect(diff.splitLineCount).toBe(base.splitLineCount);
    expect(diff.unifiedLineCount).toBe(base.unifiedLineCount);
  });

  test('falls back to full recompute when incremental hunk metadata desyncs trailing context', () => {
    const base = createFixture();
    const diff = cloneDiff(base);
    const line = findAdditionLineIndex(base, 'line 10 replace new');
    setAdditionLineText(diff, line, 'line 10 replace newer');

    updateDiffHunks(diff, [line], PARSE_OPTIONS);

    // Simulate deferred tokenization growing additionLines for an editor-only
    // trailing line without updating hunk metadata.
    diff.additionLines.push('');

    expect(hasTrailingContextMismatch(diff)).toBe(true);

    updateDiffHunks(diff, [line], PARSE_OPTIONS);

    expect(hasTrailingContextMismatch(diff)).toBe(false);
    expectMatchesFullRecompute(
      diff,
      runFullRecomputeEdit(base, line, 'line 10 replace newer')
    );
  });

  test('preserves context when a contentful edit has an editor-only trailing blank line', () => {
    const oldContents = ['drop 1', 'kept', 'drop 2', ''].join('\n');
    const diff = parseDiffFromFile(
      { name: 'example.ts', contents: oldContents },
      { name: 'example.ts', contents: 'kept\n' },
      { context: 3 }
    );

    // Mirrors edit mode after deleting all but one matching line in a longer
    // file and pressing Enter: the editor has a final logical empty line that
    // patch-style splitting would normally drop.
    diff.additionLines = ['kept\n', ''];

    const recomputed = recomputeDiffHunksForEdit(diff, { context: 3 });

    expect(recomputed.additionLines).toEqual(['kept\n', '']);
    expect(recomputed.splitLineCount).toBe(3);
    expect(recomputed.unifiedLineCount).toBe(4);
    expect(recomputed.hunks[0]?.hunkContent).toEqual([
      {
        type: 'change',
        additions: 0,
        deletions: 1,
        additionLineIndex: 0,
        deletionLineIndex: 0,
      },
      {
        type: 'context',
        lines: 1,
        additionLineIndex: 0,
        deletionLineIndex: 1,
      },
      {
        type: 'change',
        additions: 1,
        deletions: 1,
        additionLineIndex: 1,
        deletionLineIndex: 2,
      },
    ]);

    Object.assign(diff, recomputed);
    const splitRows: Array<{
      deletionLineIndex: number | undefined;
      additionLineIndex: number | undefined;
    }> = [];
    iterateOverDiff({
      diff,
      diffStyle: 'split',
      callback(row) {
        splitRows.push({
          deletionLineIndex: row.deletionLine?.lineIndex,
          additionLineIndex: row.additionLine?.lineIndex,
        });
      },
    });

    expect(splitRows).toEqual([
      { deletionLineIndex: 0, additionLineIndex: undefined },
      { deletionLineIndex: 1, additionLineIndex: 0 },
      { deletionLineIndex: 2, additionLineIndex: 1 },
    ]);
  });

  test('top-aligns an editor-only trailing blank line after replacing a longer file', () => {
    const oldContents = ['old 1', 'old 2', 'old 3', 'old 4', ''].join('\n');
    const diff = parseDiffFromFile(
      { name: 'example.ts', contents: oldContents },
      { name: 'example.ts', contents: 'a\n' },
      { context: 3 }
    );

    // Mirrors select-all, type "a", then press Enter: the editor has a second
    // logical row for the trailing blank line before tokenization sees content
    // on that row.
    diff.additionLines = ['a\n', ''];

    const recomputed = recomputeDiffHunksForEdit(diff, { context: 3 });

    expect(recomputed.additionLines).toEqual(['a\n', '']);
    expect(recomputed.splitLineCount).toBe(4);
    expect(recomputed.unifiedLineCount).toBe(6);
    expect(recomputed.hunks[0]?.hunkContent).toEqual([
      {
        type: 'change',
        additions: 2,
        deletions: 4,
        additionLineIndex: 0,
        deletionLineIndex: 0,
      },
    ]);

    Object.assign(diff, recomputed);
    const splitRows: Array<{
      deletionLineIndex: number | undefined;
      additionLineIndex: number | undefined;
    }> = [];
    iterateOverDiff({
      diff,
      diffStyle: 'split',
      callback(row) {
        splitRows.push({
          deletionLineIndex: row.deletionLine?.lineIndex,
          additionLineIndex: row.additionLine?.lineIndex,
        });
      },
    });

    expect(splitRows).toEqual([
      { deletionLineIndex: 0, additionLineIndex: 0 },
      { deletionLineIndex: 1, additionLineIndex: 1 },
      { deletionLineIndex: 2, additionLineIndex: undefined },
      { deletionLineIndex: 3, additionLineIndex: undefined },
    ]);
  });

  test('does not append an editor-only trailing blank line as an EOF change addition', () => {
    const oldContents = ['line 1', 'remove me', 'line 3', ''].join('\n');
    const diff = parseDiffFromFile(
      { name: 'example.ts', contents: oldContents },
      {
        name: 'example.ts',
        contents: ['line 1', 'add me', 'line 3', ''].join('\n'),
      },
      { context: 3 }
    );

    // The editor exposes the final logical empty row for a file ending in a
    // newline. That row belongs to document state, not to diff hunk metadata.
    diff.additionLines = ['line 1\n', 'add me\n', 'line 3\n', ''];

    const recomputed = recomputeDiffHunksForEdit(diff, { context: 3 });

    expect(recomputed.additionLines).toEqual([
      'line 1\n',
      'add me\n',
      'line 3\n',
    ]);
    expect(recomputed.hunks[0]?.hunkContent).toEqual([
      {
        type: 'context',
        lines: 1,
        additionLineIndex: 0,
        deletionLineIndex: 0,
      },
      {
        type: 'change',
        additions: 1,
        deletions: 1,
        additionLineIndex: 1,
        deletionLineIndex: 1,
      },
      {
        type: 'context',
        lines: 1,
        additionLineIndex: 2,
        deletionLineIndex: 2,
      },
    ]);

    Object.assign(diff, recomputed);
    const rows: Array<{
      type: string;
      deletionLineIndex: number | undefined;
      additionLineIndex: number | undefined;
    }> = [];
    iterateOverDiff({
      diff,
      diffStyle: 'both',
      expandedHunks: true,
      callback(row) {
        rows.push({
          type: row.type,
          deletionLineIndex: row.deletionLine?.lineIndex,
          additionLineIndex: row.additionLine?.lineIndex,
        });
      },
    });

    expect(
      rows.some(
        (row) =>
          row.type === 'change' &&
          row.deletionLineIndex == null &&
          row.additionLineIndex === 3
      )
    ).toBe(false);
  });

  test('translates reparsed hunk coordinates when context lines become changes', () => {
    const oldContents = [
      'ctx01',
      'ctx02',
      'ctx03',
      'old line',
      'ctx04',
      'ctx05',
      'ctx06',
    ].join('\n');
    const newContents = [
      'ctx01',
      'ctx02',
      'ctx03',
      'new line',
      'ctx04',
      'ctx05',
      'ctx06',
    ].join('\n');
    const base = parseDiffFromFile(
      { name: 'example.ts', contents: oldContents },
      { name: 'example.ts', contents: newContents },
      { context: 3 }
    );
    const line = findAdditionLineIndex(base, 'ctx03');
    const hunkIndex = findHunkIndexForAdditionLine(base, line);

    const diff = runUpdateDiffHunksEdit(base, line, 'ctx03-edited');

    const hunk = diff.hunks[hunkIndex];
    expect(hunk?.additionLineIndex).toBe(2);
    expect(hunk?.additionStart).toBe(3);
    expect(hunk?.additionCount).toBe(2);
    expect(hunk?.deletionLineIndex).toBe(2);
    expect(hunk?.deletionStart).toBe(3);
    expect(hunk?.deletionCount).toBe(2);
    expect(hunk?.hunkContent[0]).toMatchObject({
      type: 'change',
      additionLineIndex: 2,
      deletionLineIndex: 2,
    });
    expect(verifyFileDiffHunkValues(diff)).toEqual({
      valid: true,
      errors: [],
    });
  });

  test('does not mark noEOFCR on non-final hunks after incremental reparse', () => {
    const old = 'a\n'.repeat(20) + 'old1\n' + 'b\n'.repeat(20) + 'old-final';
    const neu = 'a\n'.repeat(20) + 'new1\n' + 'b\n'.repeat(20) + 'new-final\n';
    const base = parseDiffFromFile(
      { name: 'f.txt', contents: old },
      { name: 'f.txt', contents: neu },
      { context: 3 }
    );
    const diff = cloneDiff(base);
    const line = findAdditionLineIndex(diff, 'new1');
    setAdditionLineText(diff, line, 'new1 edited');

    updateDiffHunks(diff, [line], { context: 3 });

    expect(diff.hunks[0]?.noEOFCRAdditions).toBe(false);
    expect(diff.hunks.at(-1)?.noEOFCRAdditions).toBe(false);
  });
});
