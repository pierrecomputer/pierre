export interface SavedCommentMetadata {
  kind: 'saved';
  key: string;
  author: string;
  message: string;
}

export interface DraftCommentMetadata {
  kind: 'draft';
  key: string;
  message: string;
}

export type CommentMetadata = SavedCommentMetadata | DraftCommentMetadata;
