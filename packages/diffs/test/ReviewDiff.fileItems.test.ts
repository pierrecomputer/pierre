import { describe, expect, test } from 'bun:test';

import {
  createReviewDiffItems,
  resolveReviewDiffLabels,
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
    ).toBeUndefined();
    expect(stateItem?.type).toBe('diff');
    expect(
      stateItem?.type === 'diff' ? stateItem.annotations : undefined
    ).toBeUndefined();
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
