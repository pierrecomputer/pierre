import {
  createReviewDiffItems,
  resolveReviewDiffLabels,
} from '@pierre/diffs/svelte/review';
import { describe, expect, test } from 'bun:test';

import { createInitialReviewCommentThreads } from '../src/reviewComments';
import { createReviewFiles } from '../src/reviewFiles';

describe('createReviewFiles', () => {
  test('creates initial review comment threads for rendered demo files', () => {
    const files = createReviewFiles(2);
    const fileIds = new Set(files.map((file) => file.id));
    const threads = createInitialReviewCommentThreads(2);

    expect(threads).toHaveLength(2);
    expect(threads.every((thread) => fileIds.has(thread.target.fileId))).toBe(
      true
    );
  });

  test('builds a large review data set with a folded large file', () => {
    const files = createReviewFiles(3);
    const largeFile = files.find(
      (file) =>
        file.path ===
        'src/lib/panel-kits/project-tools/review/review-diff-body-large.svelte'
    );

    expect(files.length).toBeGreaterThan(100);
    expect(new Set(files.map((file) => file.id)).size).toBe(files.length);
    expect(largeFile?.kind).toBe('text');
    expect(largeFile?.lineCount).toBeGreaterThanOrEqual(1000);

    const binaryFile = files.find(
      (file) => file.kind === 'state' && file.reason === 'binary_file'
    );
    expect(binaryFile).toBeDefined();
    expect(binaryFile?.status).toBe('binary');

    if (largeFile != null) {
      const [largeItem] = createReviewDiffItems({
        files: [largeFile],
        labels: resolveReviewDiffLabels(),
      });

      expect(largeItem?.type).toBe('diff');
      expect(
        largeItem?.type === 'diff' ? largeItem.fileDiff.hunks.length : 0
      ).toBeGreaterThan(1);
      expect(
        largeItem?.type === 'diff'
          ? largeItem.fileDiff.hunks.some((hunk) => hunk.collapsedBefore > 0)
          : false
      ).toBe(true);
    }
  });
});
