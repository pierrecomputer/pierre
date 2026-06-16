import type { DiffLineAnnotation } from '@pierre/diffs';

import type { CommentMetadata, SavedCommentMetadata } from './types';

export function isSavedAnnotation(
  annotation: DiffLineAnnotation<CommentMetadata>
): annotation is DiffLineAnnotation<SavedCommentMetadata> {
  return annotation.metadata.kind === 'saved';
}
