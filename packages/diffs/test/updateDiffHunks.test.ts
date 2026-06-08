import { describe, expect, test } from 'bun:test';

import type { FileDiffMetadata, Hunk } from '../src/types';
import { cleanLastNewline } from '../src/utils/cleanLastNewline';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import {
  recomputeDiffHunks,
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
