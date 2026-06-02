import { describe, expect, test } from 'bun:test';

import {
  addDraftReviewCommentThread,
  createInitialReviewCommentThreads,
  removeReviewCommentThread,
  saveDraftReviewCommentThread,
  updateDraftReviewCommentThreadBody,
} from '../src/reviewComments';

const target = {
  fileId: 'src/lib/project-tools/review/create-review-panel.ts',
  side: 'additions' as const,
  lineNumber: 6,
};

describe('review comment helpers', () => {
  test('creates stable initial saved review threads', () => {
    const threads = createInitialReviewCommentThreads(1);

    expect(threads).toHaveLength(2);
    expect(threads.every((thread) => thread.metadata.kind === 'saved')).toBe(
      true
    );
    expect(threads[0]?.target.fileId).toBe(
      'src/lib/project-tools/review/create-review-panel.ts'
    );
  });

  test('adds one draft per target and reuses an existing draft on the same line', () => {
    const initial = createInitialReviewCommentThreads(1);
    const withDraft = addDraftReviewCommentThread(initial, target);
    const deduped = addDraftReviewCommentThread(withDraft, target);

    expect(withDraft).toHaveLength(initial.length + 1);
    expect(deduped).toHaveLength(withDraft.length);
    expect(
      deduped.filter((thread) => thread.metadata.kind === 'draft')
    ).toHaveLength(1);
  });

  test('updates and saves draft thread body', () => {
    const withDraft = addDraftReviewCommentThread([], target);
    const draftId = withDraft[0]?.id;
    if (draftId == null) {
      throw new Error('expected draft id');
    }

    const edited = updateDraftReviewCommentThreadBody(
      withDraft,
      draftId,
      'Ship this review comment.'
    );
    const saved = saveDraftReviewCommentThread(edited, draftId);

    expect(saved[0]?.metadata.kind).toBe('saved');
    expect(saved[0]?.metadata.body).toBe('Ship this review comment.');
    expect(
      saved[0]?.metadata.kind === 'saved' ? saved[0].metadata.author : undefined
    ).toBe('You');
  });

  test('does not save blank draft comments', () => {
    const withDraft = addDraftReviewCommentThread([], target);
    const draftId = withDraft[0]?.id;
    if (draftId == null) {
      throw new Error('expected draft id');
    }

    const saved = saveDraftReviewCommentThread(withDraft, draftId);

    expect(saved[0]?.metadata.kind).toBe('draft');
  });

  test('removes threads by id', () => {
    const withDraft = addDraftReviewCommentThread([], target);
    const draftId = withDraft[0]?.id;
    if (draftId == null) {
      throw new Error('expected draft id');
    }

    expect(removeReviewCommentThread(withDraft, draftId)).toEqual([]);
  });
});
