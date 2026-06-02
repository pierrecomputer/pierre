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
