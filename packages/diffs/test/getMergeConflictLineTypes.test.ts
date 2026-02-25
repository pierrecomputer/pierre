import { describe, expect, test } from 'bun:test';

import {
  getMergeConflictActionLineNumber,
  getMergeConflictLineTypes,
  getMergeConflictRegions,
} from '../src/utils/getMergeConflictLineTypes';
import { splitFileContents } from '../src/utils/splitFileContents';

describe('getMergeConflictLineTypes', () => {
  test('returns none for files without conflict markers', () => {
    const lines = splitFileContents('const a = 1;\nconst b = 2;\n');
    expect(getMergeConflictLineTypes(lines)).toEqual(['none', 'none']);
  });

  test('classifies two-way and three-way conflict markers and bodies', () => {
    const lines = splitFileContents(
      [
        'before',
        '<<<<<<< HEAD',
        'ours',
        '||||||| base',
        'base',
        '=======',
        'theirs',
        '>>>>>>> feature',
        'after',
      ].join('\n')
    );

    expect(getMergeConflictLineTypes(lines)).toEqual([
      'none',
      'marker-start',
      'current',
      'marker-base',
      'base',
      'marker-separator',
      'incoming',
      'marker-end',
      'none',
    ]);
  });

  test('tracks nested conflicts using a stack', () => {
    const lines = splitFileContents(
      [
        '<<<<<<< HEAD',
        'outer ours',
        '<<<<<<< HEAD',
        'inner ours',
        '=======',
        'inner theirs',
        '>>>>>>> topic',
        '=======',
        'outer theirs',
        '>>>>>>> main',
      ].join('\n')
    );

    expect(getMergeConflictLineTypes(lines)).toEqual([
      'marker-start',
      'current',
      'marker-start',
      'current',
      'marker-separator',
      'incoming',
      'marker-end',
      'marker-separator',
      'incoming',
      'marker-end',
    ]);
  });

  test('extracts merge conflict regions with stable conflict indices', () => {
    const lines = splitFileContents(
      [
        'const before = true;',
        '<<<<<<< HEAD',
        'const ours = true;',
        '=======',
        'const theirs = true;',
        '>>>>>>> topic',
        'const between = true;',
        '<<<<<<< HEAD',
        'ours 2',
        '=======',
        'theirs 2',
        '>>>>>>> topic-2',
      ].join('\n')
    );

    expect(getMergeConflictRegions(lines)).toEqual([
      {
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
      {
        conflictIndex: 1,
        startLineIndex: 7,
        startLineNumber: 8,
        separatorLineIndex: 9,
        separatorLineNumber: 10,
        endLineIndex: 11,
        endLineNumber: 12,
        baseMarkerLineIndex: undefined,
        baseMarkerLineNumber: undefined,
      },
    ]);
  });

  test('computes merge conflict action line number as the previous line', () => {
    const [firstConflict] = getMergeConflictRegions(
      splitFileContents(
        [
          'line 1',
          '<<<<<<< HEAD',
          'ours',
          '=======',
          'theirs',
          '>>>>>>> x',
        ].join('\n')
      )
    );
    expect(getMergeConflictActionLineNumber(firstConflict)).toBe(1);
  });
});
