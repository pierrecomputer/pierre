import { mount } from 'svelte';

import {
  createTypedReviewDiff,
  type ReviewDiffCommentThread,
} from '../src/svelte/review/index';

interface ReviewDiffTypeTestMetadata {
  body: string;
  resolved: boolean;
}

const typedThread: ReviewDiffCommentThread<ReviewDiffTypeTestMetadata> = {
  id: 'thread-1',
  target: {
    fileId: 'src/app.ts',
    side: 'additions',
    lineNumber: 1,
  },
  metadata: {
    body: 'Typed body.',
    resolved: false,
  },
};

function assertTypedReviewDiffMount(target: Element): void {
  const ReviewDiff = createTypedReviewDiff<ReviewDiffTypeTestMetadata>();

  mount(ReviewDiff, {
    target,
    props: {
      files: [],
      commentThreads: [typedThread],
      renderCommentThread: (thread, context) => {
        const body: string = thread.metadata.body;
        const resolved: boolean = context.thread.metadata.resolved;
        const targetFileId: string = context.target.fileId;
        void body;
        void resolved;
        void targetFileId;
        return undefined;
      },
    },
  });
}

void assertTypedReviewDiffMount;
