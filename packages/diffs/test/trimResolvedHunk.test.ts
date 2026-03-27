import { describe, expect, test } from 'bun:test';

import type { ChangeContent, ContextContent, Hunk } from '../src/types';
import { trimResolvedHunk } from '../src/utils/trimResolvedHunk';

function context(lines: number, lineIndex: number): ContextContent {
  return {
    type: 'context',
    lines,
    additionLineIndex: lineIndex,
    deletionLineIndex: lineIndex,
  };
}

function change(
  deletions: number,
  additions: number,
  deletionLineIndex: number,
  additionLineIndex = deletionLineIndex
): ChangeContent {
  return {
    type: 'change',
    deletions,
    additions,
    deletionLineIndex,
    additionLineIndex,
  };
}

function createHunk(
  hunkContent: (ContextContent | ChangeContent)[],
  collapsedBefore = 0
): Hunk {
  const first = hunkContent[0] ?? context(0, 0);

  let additionCount = 0;
  let deletionCount = 0;
  let additionLines = 0;
  let deletionLines = 0;
  let splitLineCount = 0;
  let unifiedLineCount = 0;

  for (const content of hunkContent) {
    if (content.type === 'context') {
      additionCount += content.lines;
      deletionCount += content.lines;
      splitLineCount += content.lines;
      unifiedLineCount += content.lines;
      continue;
    }

    additionCount += content.additions;
    deletionCount += content.deletions;
    additionLines += content.additions;
    deletionLines += content.deletions;
    splitLineCount += Math.max(content.additions, content.deletions);
    unifiedLineCount += content.additions + content.deletions;
  }

  return {
    collapsedBefore,
    additionStart: first.additionLineIndex + 1,
    additionCount,
    additionLines,
    additionLineIndex: first.additionLineIndex,
    deletionStart: first.deletionLineIndex + 1,
    deletionCount,
    deletionLines,
    deletionLineIndex: first.deletionLineIndex,
    hunkContent,
    splitLineStart: 0,
    splitLineCount,
    unifiedLineStart: 0,
    unifiedLineCount,
    noEOFCRAdditions: false,
    noEOFCRDeletions: false,
  };
}

describe('trimResolvedHunk', () => {
  test('drops hunks that are pure context after resolution', () => {
    const hunk = createHunk([context(9, 4)]);

    expect(trimResolvedHunk(hunk, 3)).toEqual([]);
  });

  test('trims excess leading and trailing context around a remaining change', () => {
    const hunk = createHunk([context(5, 10), change(1, 1, 15), context(6, 16)]);

    const result = trimResolvedHunk(hunk, 3);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      additionStart: 13,
      additionCount: 7,
      additionLines: 1,
      additionLineIndex: 12,
      deletionStart: 13,
      deletionCount: 7,
      deletionLines: 1,
      deletionLineIndex: 12,
      splitLineCount: 7,
      unifiedLineCount: 8,
      hunkContent: [context(3, 12), change(1, 1, 15), context(3, 16)],
    });
  });

  test('splits a hunk when the remaining changes are separated by a large context run', () => {
    const hunk = createHunk([
      context(1, 10),
      change(1, 1, 11),
      context(8, 12),
      change(1, 1, 20),
      context(1, 21),
    ]);

    const result = trimResolvedHunk(hunk, 3);

    expect(result).toEqual([
      {
        additionStart: 11,
        additionCount: 5,
        additionLines: 1,
        additionLineIndex: 10,
        deletionStart: 11,
        deletionCount: 5,
        deletionLines: 1,
        deletionLineIndex: 10,
        splitLineCount: 5,
        unifiedLineCount: 6,
        hunkContent: [context(1, 10), change(1, 1, 11), context(3, 12)],
      },
      {
        additionStart: 18,
        additionCount: 5,
        additionLines: 1,
        additionLineIndex: 17,
        deletionStart: 18,
        deletionCount: 5,
        deletionLines: 1,
        deletionLineIndex: 17,
        splitLineCount: 5,
        unifiedLineCount: 6,
        hunkContent: [context(3, 17), change(1, 1, 20), context(1, 21)],
      },
    ]);
  });
});
