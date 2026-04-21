import type { AnnotationSide } from '@pierre/diffs';
import type {
  FileTreeOptions,
  FileTreePreparedInput,
  GitStatusEntry,
} from '@pierre/trees';

type FileTreeInputSort = NonNullable<FileTreeOptions['sort']>;

export type CodeViewerFileTreeSort = Exclude<FileTreeInputSort, 'default'>;

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

export interface CodeViewerCommentSidebarFile {
  fileOrder: number;
  path: string;
}

export type CodeViewerCommentFileByItemId = ReadonlyMap<
  string,
  CodeViewerCommentSidebarFile
>;

export interface CodeViewerSavedCommentEvent {
  author: string;
  itemId: string;
  key: string;
  lineNumber: number;
  message: string;
  side: AnnotationSide;
}

export interface CodeViewerDeletedCommentEvent {
  itemId: string;
  key: string;
}

export interface CodeViewerSavedCommentEntry {
  author: string;
  itemId: string;
  key: string;
  lineNumber: number;
  message: string;
  side: AnnotationSide;
}

export interface CodeViewerSavedCommentItem {
  comments: CodeViewerSavedCommentEntry[];
  fileOrder: number;
  itemId: string;
  path: string;
}

// The fully pre-computed input this tree needs for a given fetch. It is built
// once at fetch time by createCodeViewerFileTreeSource and stored alongside
// the viewer items, so later per-item annotation updates do not feed into the
// tree and do not cause it to rebuild.
export interface CodeViewerFileTreeSource {
  gitStatus: readonly GitStatusEntry[];
  pathToItemId: ReadonlyMap<string, string>;
  preparedInput: FileTreePreparedInput;
  sort: CodeViewerFileTreeSort;
}
