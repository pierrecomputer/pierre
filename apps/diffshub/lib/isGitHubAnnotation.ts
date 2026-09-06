import type { DiffLineAnnotation } from '@pierre/diffs';

import type { CommentMetadata, GitHubCommentMetadata } from './types';

export function isGitHubAnnotation(
  annotation: DiffLineAnnotation<CommentMetadata>
): annotation is DiffLineAnnotation<GitHubCommentMetadata> {
  return annotation.metadata.kind === 'github';
}
