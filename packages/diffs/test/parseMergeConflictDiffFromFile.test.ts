import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { linesToArray } from '../src/utils/diffLines';
import { parseMergeConflictDiffFromFile } from '../src/utils/parseMergeConflictDiffFromFile';
import { splitFileContents } from '../src/utils/splitFileContents';
import { hunkDigest, verifyHunkLineValues } from './testUtils';

const fileConflictLarge = readFileSync(
  resolve(__dirname, '../../../apps/demo/src/mocks/fileConflictLarge.txt'),
  'utf-8'
);

describe('parseMergeConflictDiffFromFile', () => {
  test('creates a diff between current and incoming conflict sections', () => {
    const file = {
      name: 'session.ts',
      contents: [
        'const start = true;',
        '<<<<<<< HEAD',
        'const ttl = 12;',
        '=======',
        'const ttl = 24;',
        '>>>>>>> feature',
        'const end = true;',
        '',
      ].join('\n'),
    };

    const { currentFile, incomingFile, fileDiff, actions } =
      parseMergeConflictDiffFromFile(file);

    expect(currentFile.contents).toContain('const ttl = 12;\n');
    expect(currentFile.contents).not.toContain('<<<<<<< HEAD\n');
    expect(currentFile.contents).not.toContain('=======\n');
    expect(currentFile.contents).not.toContain('>>>>>>> feature\n');
    expect(currentFile.contents).not.toContain('const ttl = 24;\n');

    expect(incomingFile.contents).toContain('const ttl = 24;\n');
    expect(incomingFile.contents).not.toContain('<<<<<<< HEAD\n');
    expect(incomingFile.contents).not.toContain('=======\n');
    expect(incomingFile.contents).not.toContain('>>>>>>> feature\n');
    expect(incomingFile.contents).not.toContain('const ttl = 12;\n');

    expect(linesToArray(fileDiff.deletionLines)).toEqual(
      splitFileContents(currentFile.contents)
    );
    expect(linesToArray(fileDiff.additionLines)).toEqual(
      splitFileContents(incomingFile.contents)
    );

    expect(
      fileDiff.hunks.some((hunk) =>
        (hunk.hunkContent ?? []).some((content) => content.type === 'change')
      )
    ).toBe(true);
    expect(actions).toEqual([
      expect.objectContaining({
        conflictIndex: 0,
        hunkIndex: 0,
        startContentIndex: 1,
        currentContentIndex: 1,
        incomingContentIndex: 1,
        endMarkerContentIndex: 1,
        markerLines: {
          start: '<<<<<<< HEAD\n',
          separator: '=======\n',
          end: '>>>>>>> feature\n',
        },
        conflict: {
          conflictIndex: 0,
          startLineIndex: 1,
          startLineNumber: 2,
          separatorLineIndex: 3,
          separatorLineNumber: 4,
          endLineIndex: 5,
          endLineNumber: 6,
          baseMarkerLineIndex: undefined,
          baseMarkerLineNumber: undefined,
        },
      }),
    ]);
  });

  test('preserves three-way markers and base sections as context lines', () => {
    const file = {
      name: 'merge.ts',
      contents: [
        'before',
        '<<<<<<< HEAD',
        'ours',
        '||||||| base',
        'base value',
        '=======',
        'theirs',
        '>>>>>>> topic',
        'after',
        '',
      ].join('\n'),
    };

    const { currentFile, incomingFile, fileDiff, actions } =
      parseMergeConflictDiffFromFile(file);

    expect(currentFile.contents).toContain('ours\n');
    expect(currentFile.contents).toContain('base value\n');
    expect(currentFile.contents).not.toContain('<<<<<<< HEAD\n');
    expect(currentFile.contents).not.toContain('||||||| base\n');
    expect(currentFile.contents).not.toContain('=======\n');
    expect(currentFile.contents).not.toContain('>>>>>>> topic\n');
    expect(currentFile.contents).not.toContain('theirs\n');

    expect(incomingFile.contents).toContain('theirs\n');
    expect(incomingFile.contents).toContain('base value\n');
    expect(incomingFile.contents).not.toContain('<<<<<<< HEAD\n');
    expect(incomingFile.contents).not.toContain('||||||| base\n');
    expect(incomingFile.contents).not.toContain('=======\n');
    expect(incomingFile.contents).not.toContain('>>>>>>> topic\n');
    expect(incomingFile.contents).not.toContain('ours\n');

    expect(
      fileDiff.hunks.some((hunk) =>
        (hunk.hunkContent ?? []).some((content) => content.type === 'change')
      )
    ).toBe(true);
    expect(actions).toEqual([
      expect.objectContaining({
        conflictIndex: 0,
        hunkIndex: 0,
        startContentIndex: 1,
        currentContentIndex: 1,
        baseContentIndex: 2,
        incomingContentIndex: 3,
        endMarkerContentIndex: 3,
        markerLines: {
          start: '<<<<<<< HEAD\n',
          base: '||||||| base\n',
          separator: '=======\n',
          end: '>>>>>>> topic\n',
        },
        conflict: {
          conflictIndex: 0,
          startLineIndex: 1,
          startLineNumber: 2,
          separatorLineIndex: 5,
          separatorLineNumber: 6,
          endLineIndex: 7,
          endLineNumber: 8,
          baseMarkerLineIndex: 3,
          baseMarkerLineNumber: 4,
        },
      }),
    ]);
  });

  test('normalizes zero-count hunk sides for whole-file conflicts', () => {
    // A conflict with an empty incoming side and no surrounding context
    // produces a deletion-only hunk. Its addition side must land on the
    // unified `N,0` convention (additionStart 0 at file start) so boundary
    // math doesn't invent a collapsed row before the hunk.
    const currentOnly = parseMergeConflictDiffFromFile({
      name: 'deleted.ts',
      contents: '<<<<<<< HEAD\nalpha\nbeta\n=======\n>>>>>>> feature\n',
    });
    expect(verifyHunkLineValues(currentOnly.fileDiff)).toEqual([]);
    expect(currentOnly.fileDiff.type).toBe('deleted');
    expect(currentOnly.fileDiff.hunks).toHaveLength(1);
    expect(currentOnly.fileDiff.hunks[0]).toMatchObject({
      additionStart: 0,
      additionCount: 0,
      deletionStart: 1,
      deletionCount: 2,
      collapsedBefore: 0,
      splitLineStart: 0,
      unifiedLineStart: 0,
      hunkSpecs: '@@ -1,2 +0,0 @@\n',
    });
    expect(currentOnly.fileDiff.splitLineCount).toBe(2);
    expect(currentOnly.fileDiff.unifiedLineCount).toBe(2);

    // The mirrored case: empty current side, so the deletion side is the
    // zero-count one (matches git's `-0,0` header for new files).
    const incomingOnly = parseMergeConflictDiffFromFile({
      name: 'new.ts',
      contents: '<<<<<<< HEAD\n=======\nalpha\nbeta\n>>>>>>> feature\n',
    });
    expect(verifyHunkLineValues(incomingOnly.fileDiff)).toEqual([]);
    expect(incomingOnly.fileDiff.type).toBe('new');
    expect(incomingOnly.fileDiff.hunks).toHaveLength(1);
    expect(incomingOnly.fileDiff.hunks[0]).toMatchObject({
      additionStart: 1,
      additionCount: 2,
      deletionStart: 0,
      deletionCount: 0,
      collapsedBefore: 0,
      hunkSpecs: '@@ -0,0 +1,2 @@\n',
    });
    expect(incomingOnly.fileDiff.splitLineCount).toBe(2);
    expect(incomingOnly.fileDiff.unifiedLineCount).toBe(2);
  });

  test('large conflict harness stays consistent across maxContextLines', () => {
    const maxContextLinesCases = [3, 10, Infinity] as const;
    const hunkRowTotals = new Map<number, number>();

    for (const maxContextLines of maxContextLinesCases) {
      const { currentFile, incomingFile, fileDiff, actions } =
        parseMergeConflictDiffFromFile(
          { name: 'fileConflictLarge.ts', contents: fileConflictLarge },
          maxContextLines
        );

      // Hunk metadata must be internally consistent at every context width
      expect(verifyHunkLineValues(fileDiff)).toEqual([]);

      // The diff sides are exactly the conflict-free current/incoming texts
      expect(linesToArray(fileDiff.deletionLines)).toEqual(
        splitFileContents(currentFile.contents)
      );
      expect(linesToArray(fileDiff.additionLines)).toEqual(
        splitFileContents(incomingFile.contents)
      );
      expect(currentFile.contents).not.toMatch(/^<{7} /m);
      expect(currentFile.contents).not.toMatch(/^={7}$/m);
      expect(currentFile.contents).not.toMatch(/^>{7} /m);
      expect(incomingFile.contents).not.toMatch(/^<{7} /m);
      expect(incomingFile.contents).not.toMatch(/^={7}$/m);
      expect(incomingFile.contents).not.toMatch(/^>{7} /m);

      // One resolvable action per conflict region in the fixture
      expect(actions).toHaveLength(44);

      hunkRowTotals.set(
        maxContextLines,
        fileDiff.hunks.reduce((sum, hunk) => sum + hunk.unifiedLineCount, 0)
      );

      // Compact geometry lock; the full parse result is covered by the
      // invariants above
      expect(hunkDigest(fileDiff)).toMatchSnapshot(
        `fileConflictLarge digest maxContextLines=${maxContextLines}`
      );
    }

    // Wider context windows can only grow the rows that hunks occupy
    expect(hunkRowTotals.get(3)!).toBeLessThan(hunkRowTotals.get(10)!);
    expect(hunkRowTotals.get(10)!).toBeLessThan(hunkRowTotals.get(Infinity)!);
  });
});
