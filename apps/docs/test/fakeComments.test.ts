import type { CodeViewDiffItem, FileDiffMetadata } from '@pierre/diffs';
import { describe, expect, test } from 'bun:test';

import type { CommentMetadata } from '../app/(diffshub)/(view)/_components/types';
import {
  createFakeCommentEvents,
  createSavedCommentAnnotation,
  type FakeCommentSourceItem,
} from '../app/(diffshub)/(view)/_components/utils';

describe('createFakeCommentEvents', () => {
  test('spreads fake saved comments across changed additions in file order', () => {
    const comments = createFakeCommentEvents(
      [
        sourceItem(0, diffItem('first', [additionHunk(10, 1)])),
        sourceItem(1, diffItem('second', [additionHunk(20, 1)])),
        sourceItem(2, diffItem('third', [additionHunk(30, 1)])),
      ],
      3,
      4
    );

    expect(
      comments.map(({ itemId, key, lineNumber, lineType, range, side }) => ({
        itemId,
        key,
        lineNumber,
        lineType,
        range,
        side,
      }))
    ).toEqual([
      {
        itemId: 'first',
        key: 'fake-4',
        lineNumber: 10,
        lineType: 'change',
        range: {
          end: 10,
          endSide: 'additions',
          side: 'additions',
          start: 10,
        },
        side: 'additions',
      },
      {
        itemId: 'second',
        key: 'fake-5',
        lineNumber: 20,
        lineType: 'change',
        range: {
          end: 20,
          endSide: 'additions',
          side: 'additions',
          start: 20,
        },
        side: 'additions',
      },
      {
        itemId: 'third',
        key: 'fake-6',
        lineNumber: 30,
        lineType: 'change',
        range: {
          end: 30,
          endSide: 'additions',
          side: 'additions',
          start: 30,
        },
        side: 'additions',
      },
    ]);
  });

  test('skips anchors that already have manual comments', () => {
    const comments = createFakeCommentEvents(
      [
        sourceItem(
          0,
          diffItem(
            'file',
            [additionHunk(10, 4)],
            [savedAnnotation('manual-0', 'additions', 10)]
          )
        ),
      ],
      3,
      0
    );

    expect(comments.map((comment) => comment.lineNumber)).toEqual([11, 12, 13]);
    expect(comments.map((comment) => comment.key)).toEqual([
      'fake-0',
      'fake-1',
      'fake-2',
    ]);
  });

  test('uses different files before adding another comment to a large diff', () => {
    const comments = createFakeCommentEvents(
      [
        sourceItem(0, diffItem('big', [additionHunk(1, 100)])),
        sourceItem(1, diffItem('small-a', [additionHunk(200, 1)])),
        sourceItem(2, diffItem('small-b', [additionHunk(300, 1)])),
      ],
      3,
      0
    );

    expect(comments.map((comment) => comment.itemId)).toEqual([
      'big',
      'small-a',
      'small-b',
    ]);
  });

  test('prefers diffs that do not already have comments', () => {
    const comments = createFakeCommentEvents(
      [
        sourceItem(
          0,
          diffItem(
            'already-commented-a',
            [additionHunk(10, 2)],
            [savedAnnotation('fake-0', 'additions', 10)]
          )
        ),
        sourceItem(1, diffItem('fresh-a', [additionHunk(20, 2)])),
        sourceItem(
          2,
          diffItem(
            'already-commented-b',
            [additionHunk(30, 2)],
            [savedAnnotation('fake-1', 'additions', 30)]
          )
        ),
        sourceItem(3, diffItem('fresh-b', [additionHunk(40, 2)])),
      ],
      2,
      2
    );

    expect(comments.map((comment) => comment.itemId)).toEqual([
      'fresh-a',
      'fresh-b',
    ]);
  });

  test('combines comment fragments into more than the original three messages', () => {
    const comments = createFakeCommentEvents(
      Array.from({ length: 9 }, (_, index) =>
        sourceItem(
          index,
          diffItem(`file-${index}`, [additionHunk(index + 1, 1)])
        )
      ),
      9,
      0
    );

    expect(new Set(comments.map((comment) => comment.message)).size).toBe(9);
  });

  test('uses deletion anchors when a change block has no additions', () => {
    const comments = createFakeCommentEvents(
      [sourceItem(0, diffItem('deleted', [deletionHunk(40, 2)]))],
      1,
      0
    );

    expect(comments).toMatchObject([
      {
        itemId: 'deleted',
        lineNumber: 40,
        lineType: 'change',
        range: {
          end: 40,
          endSide: 'deletions',
          side: 'deletions',
          start: 40,
        },
        side: 'deletions',
      },
    ]);
  });
});

describe('createSavedCommentAnnotation', () => {
  test('preserves saved comment event metadata for diff annotations', () => {
    const annotation = createSavedCommentAnnotation({
      author: 'pia',
      itemId: 'file',
      key: 'fake-0',
      lineNumber: 12,
      lineType: 'change',
      message: 'Looks worth testing.',
      range: {
        end: 12,
        endSide: 'additions',
        side: 'additions',
        start: 12,
      },
      side: 'additions',
    });

    expect(annotation).toEqual({
      lineNumber: 12,
      metadata: {
        author: 'pia',
        key: 'fake-0',
        kind: 'saved',
        message: 'Looks worth testing.',
        range: {
          end: 12,
          endSide: 'additions',
          side: 'additions',
          start: 12,
        },
      },
      side: 'additions',
    });
  });
});

function sourceItem(
  fileOrder: number,
  item: CodeViewDiffItem<CommentMetadata>
): FakeCommentSourceItem {
  return { fileOrder, item };
}

function diffItem(
  id: string,
  hunks: FileDiffMetadata['hunks'],
  annotations: CodeViewDiffItem<CommentMetadata>['annotations'] = []
): CodeViewDiffItem<CommentMetadata> {
  return {
    annotations,
    fileDiff: {
      additionLines: [],
      cacheKey: id,
      deletionLines: [],
      hunks,
      isPartial: true,
      name: `${id}.ts`,
      splitLineCount: 1,
      type: 'change',
      unifiedLineCount: 1,
    },
    id,
    type: 'diff',
  };
}

function additionHunk(
  additionStart: number,
  additions: number
): FileDiffMetadata['hunks'][number] {
  return {
    additionCount: additions,
    additionLineIndex: 0,
    additionLines: additions,
    additionStart,
    collapsedBefore: 0,
    deletionCount: 0,
    deletionLineIndex: 0,
    deletionLines: 0,
    deletionStart: 1,
    hunkContent: [
      {
        additionLineIndex: 0,
        additions,
        deletionLineIndex: 0,
        deletions: 0,
        type: 'change',
      },
    ],
    noEOFCRAdditions: false,
    noEOFCRDeletions: false,
    splitLineCount: additions,
    splitLineStart: 0,
    unifiedLineCount: additions,
    unifiedLineStart: 0,
  };
}

function deletionHunk(
  deletionStart: number,
  deletions: number
): FileDiffMetadata['hunks'][number] {
  return {
    additionCount: 0,
    additionLineIndex: 0,
    additionLines: 0,
    additionStart: 1,
    collapsedBefore: 0,
    deletionCount: deletions,
    deletionLineIndex: 0,
    deletionLines: deletions,
    deletionStart,
    hunkContent: [
      {
        additionLineIndex: 0,
        additions: 0,
        deletionLineIndex: 0,
        deletions,
        type: 'change',
      },
    ],
    noEOFCRAdditions: false,
    noEOFCRDeletions: false,
    splitLineCount: deletions,
    splitLineStart: 0,
    unifiedLineCount: deletions,
    unifiedLineStart: 0,
  };
}

function savedAnnotation(
  key: string,
  side: 'additions' | 'deletions',
  lineNumber: number
): NonNullable<CodeViewDiffItem<CommentMetadata>['annotations']>[number] {
  return {
    lineNumber,
    metadata: {
      author: 'nicolas',
      key,
      kind: 'saved',
      message: 'Existing manual comment',
      range: {
        end: lineNumber,
        endSide: side,
        side,
        start: lineNumber,
      },
    },
    side,
  };
}
