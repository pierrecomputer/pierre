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

    expect(currentFile.contents).toContain('<<<<<<< HEAD\n');
    expect(currentFile.contents).toContain('const ttl = 12;\n');
    expect(currentFile.contents).toContain('=======\n');
    expect(currentFile.contents).toContain('>>>>>>> feature\n');
    expect(currentFile.contents).not.toContain('const ttl = 24;\n');

    expect(incomingFile.contents).toContain('<<<<<<< HEAD\n');
    expect(incomingFile.contents).toContain('const ttl = 24;\n');
    expect(incomingFile.contents).toContain('=======\n');
    expect(incomingFile.contents).toContain('>>>>>>> feature\n');
    expect(incomingFile.contents).not.toContain('const ttl = 12;\n');

    const incomingSeparatorIndex = incomingFile.contents.indexOf('=======\n');
    const incomingLineIndex =
      incomingFile.contents.indexOf('const ttl = 24;\n');
    const incomingEndIndex = incomingFile.contents.indexOf('>>>>>>> feature\n');
    expect(incomingSeparatorIndex).toBeGreaterThan(-1);
    expect(incomingLineIndex).toBeGreaterThan(incomingSeparatorIndex);
    expect(incomingEndIndex).toBeGreaterThan(incomingLineIndex);

    expect(fileDiff.deletionLines).toEqual(
      splitFileContents(currentFile.contents)
    );
    expect(fileDiff.additionLines).toEqual(
      splitFileContents(incomingFile.contents)
    );

    expect(
      fileDiff.hunks.some((hunk) =>
        (hunk.hunkContent ?? []).some((content) => content.type === 'change')
      )
    ).toBe(true);
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

    expect(currentFile.contents).toContain('<<<<<<< HEAD\n');
    expect(currentFile.contents).toContain('ours\n');
    expect(currentFile.contents).toContain('||||||| base\n');
    expect(currentFile.contents).toContain('base value\n');
    expect(currentFile.contents).toContain('=======\n');
    expect(currentFile.contents).toContain('>>>>>>> topic\n');
    expect(currentFile.contents).not.toContain('theirs\n');

    expect(incomingFile.contents).toContain('<<<<<<< HEAD\n');
    expect(incomingFile.contents).toContain('theirs\n');
    expect(incomingFile.contents).toContain('||||||| base\n');
    expect(incomingFile.contents).toContain('base value\n');
    expect(incomingFile.contents).toContain('=======\n');
    expect(incomingFile.contents).toContain('>>>>>>> topic\n');
    expect(incomingFile.contents).not.toContain('ours\n');

    const baseIndex = incomingFile.contents.indexOf('||||||| base\n');
    const separatorIndex = incomingFile.contents.indexOf('=======\n');
    const theirsIndex = incomingFile.contents.indexOf('theirs\n');
    const endIndex = incomingFile.contents.indexOf('>>>>>>> topic\n');
    expect(baseIndex).toBeGreaterThan(-1);
    expect(separatorIndex).toBeGreaterThan(baseIndex);
    expect(theirsIndex).toBeGreaterThan(separatorIndex);
    expect(endIndex).toBeGreaterThan(theirsIndex);

    expect(
      fileDiff.hunks.some((hunk) =>
        (hunk.hunkContent ?? []).some((content) => content.type === 'change')
      )
    ).toBe(true);
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
