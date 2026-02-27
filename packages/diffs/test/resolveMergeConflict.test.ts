import { describe, expect, test } from 'bun:test';

import type { MergeConflictActionPayload } from '../src/types';
import { getMergeConflictRegions } from '../src/utils/getMergeConflictLineTypes';
import { resolveMergeConflict } from '../src/utils/resolveMergeConflict';
import { splitFileContents } from '../src/utils/splitFileContents';

function getFirstConflict(contents: string) {
  const [conflict] = getMergeConflictRegions(splitFileContents(contents));
  if (conflict == null) {
    throw new Error('Expected at least one merge conflict region');
  }
  return conflict;
}

describe('resolveMergeConflict', () => {
  test('resolves two-way conflicts for current, incoming, and both', () => {
    const contents = [
      'before',
      '<<<<<<< HEAD',
      'ours',
      '=======',
      'theirs',
      '>>>>>>> topic',
      'after',
      '',
    ].join('\n');
    const conflict = getFirstConflict(contents);

    expect(
      resolveMergeConflict(contents, { resolution: 'current', conflict })
    ).toBe(['before', 'ours', 'after', ''].join('\n'));

    expect(
      resolveMergeConflict(contents, { resolution: 'incoming', conflict })
    ).toBe(['before', 'theirs', 'after', ''].join('\n'));

    expect(
      resolveMergeConflict(contents, { resolution: 'both', conflict })
    ).toBe(['before', 'ours', 'theirs', 'after', ''].join('\n'));
  });

  test('resolves three-way conflicts without including base lines', () => {
    const contents = [
      'before',
      '<<<<<<< HEAD',
      'ours',
      '||||||| base',
      'base line',
      '=======',
      'theirs',
      '>>>>>>> topic',
      'after',
      '',
    ].join('\n');
    const conflict = getFirstConflict(contents);

    expect(
      resolveMergeConflict(contents, { resolution: 'current', conflict })
    ).toBe(['before', 'ours', 'after', ''].join('\n'));

    expect(
      resolveMergeConflict(contents, { resolution: 'both', conflict })
    ).toBe(['before', 'ours', 'theirs', 'after', ''].join('\n'));
  });

  test('resolves by conflict index even when payload line metadata is stale', () => {
    const contents = [
      'before',
      '<<<<<<< HEAD',
      'ours',
      '=======',
      'theirs',
      '>>>>>>> topic',
      'after',
      '',
    ].join('\n');

    const payload: MergeConflictActionPayload = {
      resolution: 'incoming',
      conflict: {
        conflictIndex: 0,
        startLineIndex: 999,
        startLineNumber: 1_000,
        separatorLineIndex: 1_001,
        separatorLineNumber: 1_002,
        endLineIndex: 1_003,
        endLineNumber: 1_004,
      },
    };

    expect(resolveMergeConflict(contents, payload)).toBe(
      ['before', 'theirs', 'after', ''].join('\n')
    );
  });

  test('returns original contents when conflict index cannot be found', () => {
    const contents = [
      'before',
      '<<<<<<< HEAD',
      'ours',
      '=======',
      'theirs',
      '>>>>>>> topic',
      'after',
      '',
    ].join('\n');

    const payload: MergeConflictActionPayload = {
      resolution: 'current',
      conflict: {
        conflictIndex: 10,
        startLineIndex: 1,
        startLineNumber: 2,
        separatorLineIndex: 3,
        separatorLineNumber: 4,
        endLineIndex: 5,
        endLineNumber: 6,
      },
    };

    expect(resolveMergeConflict(contents, payload)).toBe(contents);
  });
});
