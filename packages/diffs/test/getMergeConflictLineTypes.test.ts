import { describe, expect, test } from 'bun:test';

import { getMergeConflictLineTypes } from '../src/utils/getMergeConflictLineTypes';
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
});
