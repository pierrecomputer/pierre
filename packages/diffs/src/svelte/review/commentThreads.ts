import type { DiffLineAnnotation } from '../../types.js';
import type {
  ReviewDiffCommentableFile,
  ReviewDiffCommentAnnotationMetadata,
  ReviewDiffCommentThread,
  ReviewDiffFile,
} from './types.js';

let nextCommentThreadsVersion = 1;
const commentThreadsVersions = new WeakMap<
  readonly ReviewDiffCommentThread<unknown>[],
  number
>();

export function isReviewDiffCommentableFile(
  file: ReviewDiffFile
): file is ReviewDiffCommentableFile {
  return file.kind !== 'state';
}

export function createReviewDiffCommentAnnotations<TMetadata>(
  file: ReviewDiffCommentableFile,
  commentThreads: readonly ReviewDiffCommentThread<TMetadata>[] | undefined
):
  | DiffLineAnnotation<ReviewDiffCommentAnnotationMetadata<TMetadata>>[]
  | undefined {
  if (commentThreads == null || commentThreads.length === 0) {
    return undefined;
  }

  const annotations: DiffLineAnnotation<
    ReviewDiffCommentAnnotationMetadata<TMetadata>
  >[] = [];

  for (const thread of commentThreads) {
    if (thread.target.fileId !== file.id) {
      continue;
    }

    annotations.push({
      side: thread.target.side,
      lineNumber: thread.target.lineNumber,
      metadata: {
        file,
        target: thread.target,
        thread,
      },
    });
  }

  return annotations.length === 0 ? undefined : annotations;
}

export function getReviewDiffCommentThreadsVersion(
  commentThreads: readonly ReviewDiffCommentThread<unknown>[] | undefined
): string {
  if (commentThreads == null || commentThreads.length === 0) {
    return '';
  }

  const existingVersion = commentThreadsVersions.get(commentThreads);
  if (existingVersion != null) {
    return existingVersion.toString(36);
  }

  const version = nextCommentThreadsVersion++;
  commentThreadsVersions.set(commentThreads, version);
  return version.toString(36);
}
