import { describe, expect, test } from 'bun:test';

import { parseMergeConflictDiffFromFile } from '../src/utils/parseMergeConflictDiffFromFile';
import { splitFileContents } from '../src/utils/splitFileContents';

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

    expect(currentFile.contents).toBe(
      [
        'const start = true;',
        '<<<<<<< HEAD',
        'const ttl = 12;',
        '=======',
        '>>>>>>> feature',
        'const end = true;',
        '',
      ].join('\n')
    );
    expect(incomingFile.contents).toBe(
      [
        'const start = true;',
        '<<<<<<< HEAD',
        'const ttl = 24;',
        '=======',
        '>>>>>>> feature',
        'const end = true;',
        '',
      ].join('\n')
    );

    expect(fileDiff.deletionLines).toEqual(
      splitFileContents(currentFile.contents)
    );
    expect(fileDiff.additionLines).toEqual(
      splitFileContents(incomingFile.contents)
    );

    expect(fileDiff.hunks).toHaveLength(1);
    expect(fileDiff.hunks[0]?.hunkContent).toEqual([
      {
        type: 'context',
        lines: 2,
        additionLineIndex: 0,
        deletionLineIndex: 0,
      },
      {
        type: 'change',
        additions: 1,
        deletions: 1,
        additionLineIndex: 2,
        deletionLineIndex: 2,
      },
      {
        type: 'context',
        lines: 3,
        additionLineIndex: 3,
        deletionLineIndex: 3,
      },
    ]);
    expect(actions).toEqual([
      {
        actionOriginalLineIndex: 0,
        actionOriginalLineNumber: 1,
        currentLineNumber: 1,
        incomingLineNumber: 1,
        conflictIndex: 0,
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
      },
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

    expect(currentFile.contents).toBe(
      [
        'before',
        '<<<<<<< HEAD',
        'ours',
        '||||||| base',
        'base value',
        '=======',
        '>>>>>>> topic',
        'after',
        '',
      ].join('\n')
    );
    expect(incomingFile.contents).toBe(
      [
        'before',
        '<<<<<<< HEAD',
        'theirs',
        '||||||| base',
        'base value',
        '=======',
        '>>>>>>> topic',
        'after',
        '',
      ].join('\n')
    );
    expect(fileDiff.hunks[0]?.hunkContent).toEqual([
      {
        type: 'context',
        lines: 2,
        additionLineIndex: 0,
        deletionLineIndex: 0,
      },
      {
        type: 'change',
        additions: 1,
        deletions: 1,
        additionLineIndex: 2,
        deletionLineIndex: 2,
      },
      {
        type: 'context',
        lines: 5,
        additionLineIndex: 3,
        deletionLineIndex: 3,
      },
    ]);
    expect(actions).toEqual([
      {
        actionOriginalLineIndex: 0,
        actionOriginalLineNumber: 1,
        currentLineNumber: 1,
        incomingLineNumber: 1,
        conflictIndex: 0,
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
      },
    ]);
  });

  test('returns a context-only diff for files without conflict markers', () => {
    const file = {
      name: 'plain.ts',
      contents: ['const a = 1;', 'const b = 2;', ''].join('\n'),
    };

    const { currentFile, incomingFile, fileDiff, actions } =
      parseMergeConflictDiffFromFile(file);

    expect(currentFile.contents).toBe(file.contents);
    expect(incomingFile.contents).toBe(file.contents);
    expect(fileDiff.hunks[0]?.hunkContent).toEqual([
      {
        type: 'context',
        lines: 2,
        additionLineIndex: 0,
        deletionLineIndex: 0,
      },
    ]);
    expect(actions).toEqual([]);
  });
});
