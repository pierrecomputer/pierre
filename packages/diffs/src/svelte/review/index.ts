import type { Component } from 'svelte';

import ReviewDiff from './ReviewDiff.svelte';
import type { ReviewDiffHandle, ReviewDiffProps } from './types.js';

export { default } from './ReviewDiff.svelte';
export { createReviewDiffItems } from './fileItems.js';
export { resolveReviewDiffLabels } from './labels.js';
export {
  REVIEW_DIFF_CLASS,
  REVIEW_DIFF_UNSAFE_CSS,
} from './reviewDiffTheme.js';
export {
  acquireReviewWorkerPool,
  releaseReviewWorkerPool,
} from './workerPool.js';

export type TypedReviewDiffComponent<TCommentMetadata = unknown> = Component<
  ReviewDiffProps<TCommentMetadata>,
  ReviewDiffHandle
>;

// Returns ReviewDiff with concrete comment metadata props for TypeScript callers
// whose component helpers cannot infer Svelte generic component parameters.
export function createTypedReviewDiff<
  TCommentMetadata = unknown,
>(): TypedReviewDiffComponent<TCommentMetadata> {
  return ReviewDiff as unknown as TypedReviewDiffComponent<TCommentMetadata>;
}
export type * from './types.js';
