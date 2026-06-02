import type {
  ReviewDiffCommentTarget,
  ReviewDiffCommentThread,
} from '@pierre/diffs/svelte/review';

export type ReviewDemoCommentThread =
  ReviewDiffCommentThread<ReviewDemoCommentThreadMetadata>;

export type ReviewDemoCommentThreadMetadata =
  | ReviewDemoSavedCommentThreadMetadata
  | ReviewDemoDraftCommentThreadMetadata;

export interface ReviewDemoSavedCommentThreadMetadata {
  kind: 'saved';
  author: string;
  body: string;
  createdAtLabel: string;
}

export interface ReviewDemoDraftCommentThreadMetadata {
  kind: 'draft';
  body: string;
}

const PRIMARY_FILE_ID = 'src/lib/project-tools/review/create-review-panel.ts';
const CONFLICT_FILE_ID =
  'src/lib/panel-kits/project-tools/review/review-options.ts';

let nextDraftId = 1;

export function createInitialReviewCommentThreads(
  seed: number
): ReviewDemoCommentThread[] {
  return [
    {
      id: `saved-refresh-${seed}`,
      target: {
        fileId: PRIMARY_FILE_ID,
        side: 'additions',
        lineNumber: 6,
      },
      metadata: {
        kind: 'saved',
        author: 'Avery',
        body: 'This refresh interval is now visible in the review thread demo.',
        createdAtLabel: '2m ago',
      },
    },
    {
      id: `saved-conflict-${seed}`,
      target: {
        fileId: CONFLICT_FILE_ID,
        side: 'additions',
        lineNumber: 4,
      },
      metadata: {
        kind: 'saved',
        author: 'Morgan',
        body: 'Conflict comments stay controlled by the consuming Svelte app.',
        createdAtLabel: 'just now',
      },
    },
  ];
}

export function addDraftReviewCommentThread(
  threads: readonly ReviewDemoCommentThread[],
  target: ReviewDiffCommentTarget
): ReviewDemoCommentThread[] {
  const existingDraft = threads.find(
    (thread) =>
      thread.metadata.kind === 'draft' &&
      isSameCommentTarget(thread.target, target)
  );

  if (existingDraft != null) {
    return threads.map((thread) =>
      thread.id === existingDraft.id
        ? {
            ...thread,
            target,
          }
        : thread
    );
  }

  return [
    ...threads,
    {
      id: `draft-${nextDraftId++}`,
      target,
      metadata: {
        kind: 'draft',
        body: '',
      },
    },
  ];
}

export function updateDraftReviewCommentThreadBody(
  threads: readonly ReviewDemoCommentThread[],
  threadId: string,
  body: string
): ReviewDemoCommentThread[] {
  return threads.map((thread) => {
    if (thread.id !== threadId || thread.metadata.kind !== 'draft') {
      return thread;
    }

    return {
      ...thread,
      metadata: {
        kind: 'draft',
        body,
      },
    };
  });
}

export function saveDraftReviewCommentThread(
  threads: readonly ReviewDemoCommentThread[],
  threadId: string
): ReviewDemoCommentThread[] {
  return threads.map((thread) => {
    if (thread.id !== threadId || thread.metadata.kind !== 'draft') {
      return thread;
    }

    const body = thread.metadata.body.trim();
    if (body.length === 0) {
      return thread;
    }

    return {
      ...thread,
      id: thread.id.replace(/^draft-/, 'saved-draft-'),
      metadata: {
        kind: 'saved',
        author: 'You',
        body,
        createdAtLabel: 'now',
      },
    };
  });
}

export function removeReviewCommentThread(
  threads: readonly ReviewDemoCommentThread[],
  threadId: string
): ReviewDemoCommentThread[] {
  return threads.filter((thread) => thread.id !== threadId);
}

export function formatReviewCommentTarget(
  target: ReviewDiffCommentTarget
): string {
  const side = target.side === 'additions' ? 'new' : 'old';
  return `${side} line ${target.lineNumber}`;
}

function isSameCommentTarget(
  targetA: ReviewDiffCommentTarget,
  targetB: ReviewDiffCommentTarget
): boolean {
  return (
    targetA.fileId === targetB.fileId &&
    targetA.side === targetB.side &&
    targetA.lineNumber === targetB.lineNumber
  );
}
