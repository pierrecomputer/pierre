import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { parseMergeConflictDiffFromFile } from '../src/utils/parseMergeConflictDiffFromFile';
import { splitFileContents } from '../src/utils/splitFileContents';

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

  test('large conflict harness snapshots and timing for multiple maxContentLines', () => {
    const maxContentLinesCases = [10, 3, Infinity] as const;

    for (const maxContextLines of maxContentLinesCases) {
      const result = parseMergeConflictDiffFromFile(
        { name: 'fileConflictLarge.ts', contents: fileConflictLarge },
        maxContextLines
      );
      expect(result).toMatchSnapshot(
        `fileConflictLarge raw-result maxContentLines=${maxContextLines}`
      );
    }
  });
});
