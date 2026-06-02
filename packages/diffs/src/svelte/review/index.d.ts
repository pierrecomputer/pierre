import type { Component } from 'svelte';

import type { WorkerInitializationRenderOptions } from '../../worker/types.js';
import type { WorkerPoolManager } from '../../worker/WorkerPoolManager.js';
import type {
  CreateReviewDiffItemsOptions,
  ResolvedReviewDiffLabels,
  ReviewDiffHandle,
  ReviewDiffItem,
  ReviewDiffLabels,
  ReviewDiffProps,
} from './types.js';

export type * from './types.js';

export declare function createReviewDiffItems<TCommentMetadata = unknown>(
  options: CreateReviewDiffItemsOptions<TCommentMetadata>
): ReviewDiffItem<TCommentMetadata>[];

export declare function resolveReviewDiffLabels(
  labels?: ReviewDiffLabels | null
): ResolvedReviewDiffLabels;

export declare const REVIEW_DIFF_CLASS: 'pierre-review-diff';

export declare const REVIEW_DIFF_UNSAFE_CSS: string;

export declare function acquireReviewWorkerPool(
  options?: WorkerInitializationRenderOptions
): WorkerPoolManager | undefined;

export declare function releaseReviewWorkerPool(): void;

declare const ReviewDiff: Component<ReviewDiffProps<unknown>, ReviewDiffHandle>;

export default ReviewDiff;
