import type { AnnotationSide, SelectedLineRange } from '@pierre/diffs';
import type { FileTreeOptions, GitStatusEntry } from '@pierre/trees';

type FileTreeInputSort = NonNullable<FileTreeOptions['sort']>;

export type CodeViewFileTreeSort = Exclude<FileTreeInputSort, 'default'>;

export interface SavedCommentMetadata {
  kind: 'saved';
  key: string;
  author: string;
  message: string;
  range: SelectedLineRange;
}

export interface DraftCommentMetadata {
  kind: 'draft';
  key: string;
  message: string;
  range: SelectedLineRange;
}

export type CommentMetadata = SavedCommentMetadata | DraftCommentMetadata;

export interface CodeViewCommentSidebarFile {
  fileOrder: number;
  path: string;
}

export type CodeViewCommentFileByItemId = ReadonlyMap<
  string,
  CodeViewCommentSidebarFile
>;

export interface CodeViewSavedCommentEvent {
  author: string;
  itemId: string;
  key: string;
  lineNumber: number;
  message: string;
  range: SelectedLineRange;
  side: AnnotationSide;
}

export interface CodeViewDeletedCommentEvent {
  itemId: string;
  key: string;
}

export interface CodeViewSavedCommentEntry {
  author: string;
  itemId: string;
  key: string;
  lineNumber: number;
  message: string;
  range: SelectedLineRange;
  side: AnnotationSide;
}

export interface CodeViewSavedCommentItem {
  comments: CodeViewSavedCommentEntry[];
  fileOrder: number;
  itemId: string;
  path: string;
}

// The fully pre-computed input this tree needs for a given fetch. It is built
// once at fetch time by createCodeViewFileTreeSource and stored alongside
// the viewer items, so later per-item annotation updates do not feed into the
// tree and do not cause it to rebuild.
export interface CodeViewFileTreeSource {
  gitStatus: readonly GitStatusEntry[];
  paths: readonly string[];
  pathToItemId: ReadonlyMap<string, string>;
  sort: CodeViewFileTreeSort;
}

export interface CodeViewDiffStats {
  addedLines: number;
  deletedLines: number;
  fileCount: number;
  totalLinesOfCode: number;
}
