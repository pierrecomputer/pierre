import type { FileTreePreparedInput, GitStatusEntry } from '@pierre/trees';

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

// The fully pre-computed input this tree needs for a given fetch. It is built
// once at fetch time by createCodeViewerFileTreeSource and stored alongside
// the viewer items, so later per-item annotation updates do not feed into the
// tree and do not cause it to rebuild.
export interface CodeViewerFileTreeSource {
  gitStatus: readonly GitStatusEntry[];
  pathToItemId: ReadonlyMap<string, string>;
  preparedInput: FileTreePreparedInput;
}
