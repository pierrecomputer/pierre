import type { CommentMetadata, DraftCommentMetadata } from './types';

export function isDraftMetadata(
  metadata: CommentMetadata
): metadata is DraftCommentMetadata {
  return metadata.kind === 'draft';
}
