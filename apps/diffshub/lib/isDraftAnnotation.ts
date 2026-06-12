import type { DiffLineAnnotation } from '@pierre/diffs';

import { isDraftMetadata } from './isDraftMetadata';
import type { CommentMetadata, DraftCommentMetadata } from './types';

export function isDraftAnnotation(
  annotation: DiffLineAnnotation<CommentMetadata>
): annotation is DiffLineAnnotation<DraftCommentMetadata> {
  return isDraftMetadata(annotation.metadata);
}
