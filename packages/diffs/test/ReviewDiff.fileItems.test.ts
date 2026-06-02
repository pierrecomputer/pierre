import { describe, expect, test } from 'bun:test';

import { applyReviewDiffCommentThreadGroupsToItems } from '../src/svelte/review/commentThreads';
import {
  createReviewDiffItems,
  resolveReviewDiffLabels,
  type ReviewDiffCommentThread,
  type ReviewDiffFile,
} from '../src/svelte/review/index';

describe('createReviewDiffItems', () => {
  test('converts notices and review files into stable CodeView items', () => {
    const labels = resolveReviewDiffLabels({
      noticeTitle: 'Review notice',
      binaryFile: 'Binary file skipped',
    });
    const files: ReviewDiffFile[] = [
      {
        id: 'src/app.ts',
        kind: 'text',
        path: 'src/app.ts',
        oldPath: null,
        status: 'modified',
        group: 'unstaged',
        oldText: 'const value = 1;\n',
        newText: 'const value = 2;\n',
        byteSize: 17,
        lineCount: 1,
        patch: '',
      },
      {
        id: 'src/virtual.ts',
        kind: 'virtual',
        path: 'src/virtual.ts',
        oldPath: null,
        status: 'modified',
        group: 'staged',
        patch: [
          'diff --git a/src/virtual.ts b/src/virtual.ts',
          'index 1111111..2222222 100644',
          '--- a/src/virtual.ts',
          '+++ b/src/virtual.ts',
          '@@ -1 +1 @@',
          '-export const virtual = false;',
          '+export const virtual = true;',
          '',
        ].join('\n'),
        byteSize: 28,
        lineCount: 1,
        contextLines: 3,
        canExpandContext: true,
      },
      {
        id: 'assets/logo.png',
        kind: 'state',
        path: 'assets/logo.png',
        oldPath: null,
        status: 'binary',
        group: 'branch',
        reason: 'binary_file',
        byteSize: 1234,
        message: null,
      },
    ];

    const items = createReviewDiffItems({
      files,
      notices: ['Only the first 300 files are shown.'],
      collapsed: true,
      labels,
    });

    expect(
      items.map(({ id, type, collapsed }) => ({ id, type, collapsed }))
    ).toEqual([
      { id: '__pierre_review_notice:0', type: 'file', collapsed: true },
      { id: 'src/app.ts', type: 'diff', collapsed: true },
      { id: 'src/virtual.ts', type: 'diff', collapsed: true },
      { id: 'assets/logo.png', type: 'diff', collapsed: true },
    ]);

    expect(items[0]?.type).toBe('file');
    expect(items[0]?.type === 'file' ? items[0].file.contents : '').toContain(
      'Review notice'
    );
    expect(items[3]?.type).toBe('diff');
    expect(
      items[3]?.type === 'diff' ? items[3].fileDiff.hunks.length : -1
    ).toBe(0);
  });

  test('keeps notice ids unique when caller file ids use notice-like values', () => {
    const files: ReviewDiffFile[] = [
      createTextReviewFile('__pierre_review_notice:0', 'first'),
      createTextReviewFile('__pierre_review_notice:0:1', 'second'),
      createTextReviewFile('notice:0', 'third'),
    ];

    const items = createReviewDiffItems({
      files,
      notices: ['A review notice.'],
    });
    const itemIds = items.map((item) => item.id);

    expect(new Set(itemIds).size).toBe(itemIds.length);
    expect(itemIds).toEqual([
      '__pierre_review_notice:0:2',
      '__pierre_review_notice:0',
      '__pierre_review_notice:0:1',
      'notice:0',
    ]);
  });

  test('creates safe numeric versions that differ when file contents differ', () => {
    const [firstItem] = createReviewDiffItems({
      files: [createTextReviewFile('src/app.ts', 'first')],
    });
    const [secondItem] = createReviewDiffItems({
      files: [createTextReviewFile('src/app.ts', 'second')],
    });

    expect(typeof firstItem?.version).toBe('number');
    expect(typeof secondItem?.version).toBe('number');
    expect(Number.isSafeInteger(firstItem?.version)).toBe(true);
    expect(Number.isSafeInteger(secondItem?.version)).toBe(true);
    expect(firstItem?.version).not.toBe(secondItem?.version);
  });

  test('attaches comment threads to commentable diff items', () => {
    const file = createTextReviewFile('src/app.ts', 'commented');
    const thread = {
      id: 'thread-1',
      target: {
        fileId: 'src/app.ts',
        side: 'additions' as const,
        lineNumber: 1,
      },
      metadata: { body: 'Looks good from the review thread.' },
    };

    const [item] = createReviewDiffItems({
      files: [file],
      commentThreads: [thread],
    });

    expect(item?.type).toBe('diff');
    if (item?.type !== 'diff') {
      throw new Error('expected diff item');
    }

    expect(item.annotations).toHaveLength(1);
    expect(item.annotations?.[0]?.side).toBe('additions');
    expect(item.annotations?.[0]?.lineNumber).toBe(1);
    expect(item.annotations?.[0]?.metadata.thread).toBe(thread);
    expect(item.annotations?.[0]?.metadata.target).toEqual(thread.target);
    expect(item.annotations?.[0]?.metadata.file.id).toBe('src/app.ts');
  });

  test('clears annotations when the controlled comment thread list is empty', () => {
    const file = createTextReviewFile('src/app.ts', 'cleared');
    const [baseItem] = createReviewDiffItems({ files: [file] });
    const [clearedItem] = createReviewDiffItems({
      files: [file],
      commentThreads: [],
    });

    expect(clearedItem?.type).toBe('diff');
    if (clearedItem?.type !== 'diff') {
      throw new Error('expected diff item');
    }

    expect(clearedItem.annotations).toEqual([]);
    expect(clearedItem.version).toBe(baseItem?.version);
  });

  test('overlays comment updates without replacing unparsed base diff data', () => {
    const files = [
      createTextReviewFile('a.ts', 'a'),
      createTextReviewFile('b.ts', 'b'),
      createTextReviewFile('c.ts', 'c'),
    ];
    const aThread: ReviewDiffCommentThread<{ body: string }> = {
      id: 'thread-a',
      target: {
        fileId: 'a.ts',
        side: 'additions',
        lineNumber: 1,
      },
      metadata: { body: 'Comment on a.ts.' },
    };
    const bThread: ReviewDiffCommentThread<{ body: string }> = {
      id: 'thread-b',
      target: {
        fileId: 'b.ts',
        side: 'additions',
        lineNumber: 1,
      },
      metadata: { body: 'Comment on b.ts.' },
    };

    const baseItems = createReviewDiffItems({ files });
    const baseAItem = getDiffItem(baseItems, 'a.ts');
    const baseBItem = getDiffItem(baseItems, 'b.ts');
    const baseCItem = getDiffItem(baseItems, 'c.ts');
    const withAItems = applyReviewDiffCommentThreadGroupsToItems(
      baseItems,
      files,
      [aThread]
    );
    const withABItems = applyReviewDiffCommentThreadGroupsToItems(
      baseItems,
      files,
      [aThread, bThread]
    );
    const clearedItems = applyReviewDiffCommentThreadGroupsToItems(
      baseItems,
      files,
      []
    );
    const withAAItem = getDiffItem(withAItems, 'a.ts');
    const withABAItem = getDiffItem(withABItems, 'a.ts');
    const withABBItem = getDiffItem(withABItems, 'b.ts');
    const withABCItem = getDiffItem(withABItems, 'c.ts');
    const clearedAItem = getDiffItem(clearedItems, 'a.ts');
    const clearedBItem = getDiffItem(clearedItems, 'b.ts');
    const clearedCItem = getDiffItem(clearedItems, 'c.ts');

    expect(withAAItem.fileDiff).toBe(baseAItem.fileDiff);
    expect(withABAItem.fileDiff).toBe(baseAItem.fileDiff);
    expect(withABBItem.fileDiff).toBe(baseBItem.fileDiff);
    expect(withABCItem).toBe(baseCItem);
    expect(withAAItem.version).toBe(withABAItem.version);
    expect(clearedAItem.annotations).toEqual([]);
    expect(clearedBItem.annotations).toEqual([]);
    expect(clearedAItem.version).toBe(baseAItem.version);
    expect(clearedBItem.version).toBe(baseBItem.version);
    expect(clearedCItem).toBe(baseCItem);
  });

  test('clears stale annotations when overlaying comments onto fresh base items', () => {
    const files = [
      createTextReviewFile('a.ts', 'a'),
      createTextReviewFile('b.ts', 'b'),
    ];
    const aThread: ReviewDiffCommentThread<{ body: string }> = {
      id: 'thread-a',
      target: {
        fileId: 'a.ts',
        side: 'additions',
        lineNumber: 1,
      },
      metadata: { body: 'Comment on a.ts.' },
    };
    const bThread: ReviewDiffCommentThread<{ body: string }> = {
      id: 'thread-b',
      target: {
        fileId: 'b.ts',
        side: 'additions',
        lineNumber: 1,
      },
      metadata: { body: 'Comment on b.ts.' },
    };

    const initialBaseItems = createReviewDiffItems({ files });
    const withAItems = applyReviewDiffCommentThreadGroupsToItems(
      initialBaseItems,
      files,
      [aThread]
    );
    const freshBaseItems = createReviewDiffItems({ files });
    const freshBaseAItem = getDiffItem(freshBaseItems, 'a.ts');
    const withBItems = applyReviewDiffCommentThreadGroupsToItems(
      freshBaseItems,
      files,
      [bThread]
    );
    const previousAItem = getDiffItem(withAItems, 'a.ts');
    const nextAItem = getDiffItem(withBItems, 'a.ts');
    const nextBItem = getDiffItem(withBItems, 'b.ts');

    expect(previousAItem.annotations).toHaveLength(1);
    expect(nextAItem.annotations).toEqual([]);
    expect(nextAItem.version).toBe(freshBaseAItem.version);
    expect(nextAItem.version).not.toBe(previousAItem.version);
    expect(nextBItem.annotations).toHaveLength(1);
  });

  test('clears stale annotations when a commented file becomes a state file', () => {
    const textFile = createTextReviewFile('src/app.ts', 'commented');
    const stateFile = createStateReviewFile('src/app.ts');
    const thread: ReviewDiffCommentThread<{ body: string }> = {
      id: 'thread-a',
      target: {
        fileId: 'src/app.ts',
        side: 'additions',
        lineNumber: 1,
      },
      metadata: { body: 'Comment on a file that became binary.' },
    };

    const textBaseItems = createReviewDiffItems({ files: [textFile] });
    const withCommentItems = applyReviewDiffCommentThreadGroupsToItems(
      textBaseItems,
      [textFile],
      [thread]
    );
    const stateBaseItems = createReviewDiffItems({ files: [stateFile] });
    const stateBaseItem = getDiffItem(stateBaseItems, 'src/app.ts');
    const stateOverlayItems = applyReviewDiffCommentThreadGroupsToItems(
      stateBaseItems,
      [stateFile],
      [thread]
    );
    const previousTextItem = getDiffItem(withCommentItems, 'src/app.ts');
    const nextStateItem = getDiffItem(stateOverlayItems, 'src/app.ts');

    expect(previousTextItem.annotations).toHaveLength(1);
    expect(nextStateItem.annotations).toEqual([]);
    expect(nextStateItem.version).toBe(stateBaseItem.version);
    expect(nextStateItem.version).not.toBe(previousTextItem.version);
  });

  test('keeps overlay versions stable when reapplying to overlaid items', () => {
    const files = [
      createTextReviewFile('a.ts', 'a'),
      createTextReviewFile('b.ts', 'b'),
    ];
    const thread: ReviewDiffCommentThread<{ body: string }> = {
      id: 'thread-a',
      target: {
        fileId: 'a.ts',
        side: 'additions',
        lineNumber: 1,
      },
      metadata: { body: 'Comment on a.ts.' },
    };

    const baseItems = createReviewDiffItems({ files });
    const baseAItem = getDiffItem(baseItems, 'a.ts');
    const withAItems = applyReviewDiffCommentThreadGroupsToItems(
      baseItems,
      files,
      [thread]
    );
    const withAAgainItems = applyReviewDiffCommentThreadGroupsToItems(
      withAItems,
      files,
      [thread]
    );
    const clearedFromWithAItems = applyReviewDiffCommentThreadGroupsToItems(
      withAItems,
      files,
      []
    );
    const withAItem = getDiffItem(withAItems, 'a.ts');
    const withAAgainItem = getDiffItem(withAAgainItems, 'a.ts');
    const clearedFromWithAItem = getDiffItem(clearedFromWithAItems, 'a.ts');

    expect(withAAgainItem.fileDiff).toBe(baseAItem.fileDiff);
    expect(withAAgainItem.version).toBe(withAItem.version);
    expect(clearedFromWithAItem.annotations).toEqual([]);
    expect(clearedFromWithAItem.version).toBe(baseAItem.version);
    expect(clearedFromWithAItem.version).not.toBe(withAItem.version);
  });

  test('keeps versions stable for files whose comment threads did not change', () => {
    const files: ReviewDiffFile[] = [
      createTextReviewFile('a.ts', 'a'),
      createTextReviewFile('b.ts', 'b'),
    ];
    const aThread: ReviewDiffCommentThread<{ body: string }> = {
      id: 'thread-a',
      target: {
        fileId: 'a.ts',
        side: 'additions',
        lineNumber: 1,
      },
      metadata: { body: 'Comment on a.ts.' },
    };
    const bThread: ReviewDiffCommentThread<{ body: string }> = {
      id: 'thread-b',
      target: {
        fileId: 'b.ts',
        side: 'additions',
        lineNumber: 1,
      },
      metadata: { body: 'Comment on b.ts.' },
    };

    const firstItems = createReviewDiffItems({
      files,
      commentThreads: [aThread],
    });
    const secondItems = createReviewDiffItems({
      files,
      commentThreads: [aThread, bThread],
    });
    const firstAItem = firstItems.find((item) => item.id === 'a.ts');
    const secondAItem = secondItems.find((item) => item.id === 'a.ts');
    const secondBItem = secondItems.find((item) => item.id === 'b.ts');

    expect(firstAItem?.version).toBe(secondAItem?.version);
    expect(secondBItem?.type).toBe('diff');
    if (secondBItem?.type !== 'diff') {
      throw new Error('expected b.ts diff item');
    }

    expect(secondBItem.annotations).toHaveLength(1);
    expect(secondBItem.annotations?.[0]?.metadata.thread).toBe(bThread);
  });

  test('changes same-file versions when a thread is pushed into the same array', () => {
    const file = createTextReviewFile('src/app.ts', 'commented');
    const commentThreads: ReviewDiffCommentThread<{ body: string }>[] = [
      {
        id: 'thread-1',
        target: {
          fileId: 'src/app.ts',
          side: 'additions',
          lineNumber: 1,
        },
        metadata: { body: 'First body.' },
      },
    ];

    const [firstItem] = createReviewDiffItems({
      files: [file],
      commentThreads,
    });

    commentThreads.push({
      id: 'thread-2',
      target: {
        fileId: 'src/app.ts',
        side: 'additions',
        lineNumber: 1,
      },
      metadata: { body: 'Second body.' },
    });

    const [secondItem] = createReviewDiffItems({
      files: [file],
      commentThreads,
    });

    expect(firstItem?.version).not.toBe(secondItem?.version);
    expect(secondItem?.type).toBe('diff');
    if (secondItem?.type !== 'diff') {
      throw new Error('expected diff item');
    }

    expect(secondItem.annotations).toHaveLength(2);
  });

  test('ignores comment threads for missing files and state files', () => {
    const textFile = createTextReviewFile('src/app.ts', 'commented');
    const stateFile: ReviewDiffFile = {
      id: 'assets/logo.png',
      kind: 'state',
      path: 'assets/logo.png',
      oldPath: null,
      status: 'binary',
      group: 'staged',
      reason: 'binary_file',
      byteSize: 256,
      message: null,
    };

    const items = createReviewDiffItems({
      files: [textFile, stateFile],
      commentThreads: [
        {
          id: 'missing-thread',
          target: {
            fileId: 'src/missing.ts',
            side: 'additions',
            lineNumber: 1,
          },
          metadata: { body: 'This file is not in the review.' },
        },
        {
          id: 'state-thread',
          target: {
            fileId: 'assets/logo.png',
            side: 'additions',
            lineNumber: 1,
          },
          metadata: { body: 'Binary files do not have line comments.' },
        },
      ],
    });

    const textItem = items.find((item) => item.id === 'src/app.ts');
    const stateItem = items.find((item) => item.id === 'assets/logo.png');

    expect(textItem?.type).toBe('diff');
    expect(
      textItem?.type === 'diff' ? textItem.annotations : undefined
    ).toEqual([]);
    expect(stateItem?.type).toBe('diff');
    expect(
      stateItem?.type === 'diff' ? stateItem.annotations : undefined
    ).toEqual([]);
  });

  test('changes item versions when controlled comment thread arrays change', () => {
    const file = createTextReviewFile('src/app.ts', 'commented');
    const firstThreads = [
      {
        id: 'thread-1',
        target: {
          fileId: 'src/app.ts',
          side: 'additions' as const,
          lineNumber: 1,
        },
        metadata: { body: 'First body.' },
      },
    ];
    const secondThreads = [
      {
        id: 'thread-1',
        target: {
          fileId: 'src/app.ts',
          side: 'additions' as const,
          lineNumber: 1,
        },
        metadata: { body: 'Updated body.' },
      },
    ];

    const [firstItem] = createReviewDiffItems({
      files: [file],
      commentThreads: firstThreads,
    });
    const [secondItem] = createReviewDiffItems({
      files: [file],
      commentThreads: secondThreads,
    });

    expect(typeof firstItem?.version).toBe('number');
    expect(typeof secondItem?.version).toBe('number');
    expect(firstItem?.version).not.toBe(secondItem?.version);
  });
});

function getDiffItem(
  items: ReturnType<typeof createReviewDiffItems>,
  itemId: string
) {
  const item = items.find((currentItem) => currentItem.id === itemId);
  if (item?.type !== 'diff') {
    throw new Error(`expected ${itemId} diff item`);
  }
  return item;
}

function createTextReviewFile(id: string, value: string): ReviewDiffFile {
  return {
    id,
    kind: 'text',
    path: id,
    oldPath: null,
    status: 'modified',
    group: 'unstaged',
    oldText: `const value = '${value}-old';\n`,
    newText: `const value = '${value}-new';\n`,
    byteSize: value.length,
    lineCount: 1,
    patch: '',
  };
}

function createStateReviewFile(id: string): ReviewDiffFile {
  return {
    id,
    kind: 'state',
    path: id,
    oldPath: null,
    status: 'binary',
    group: 'unstaged',
    reason: 'binary_file',
    byteSize: 256,
    message: null,
  };
}
