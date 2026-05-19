import type { AnnotationSide, SelectedLineRange } from '@pierre/diffs';
import type { FileTreeOptions, GitStatusEntry } from '@pierre/trees';

type FileTreeInputSort = NonNullable<FileTreeOptions['sort']>;

export type ViewerLoadState =
  | 'fetching'
  | 'streaming'
  | 'parsing'
  | 'ready'
  | 'error';

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
// once at fetch time by snapshotCodeViewTreeSource and stored alongside the
// viewer items, so later per-item annotation updates do not feed into the
// tree and do not cause it to rebuild.
//
// Streamed publishes link successive snapshots through `previousSource` so the
// tree consumer can recognize append-only growth and apply the delta as
// `model.batch` adds instead of rebuilding the entire path store. The link is
// present only on snapshots that share the same underlying accumulator; the
// initial publish and any non-streamed source leave it undefined and force a
// full reset.
//
// `paths` and `pathToItemId` may alias the live accumulator state for
// streamed sources, so consumers must treat them as read-only and must use
// `pathCount` (captured at snapshot time) as the exclusive upper bound when
// iterating `paths`. The `readonly` markers and ReadonlyMap type enforce the
// read-only side; pathCount is what keeps later in-place growth invisible to
// this snapshot.
export interface CodeViewFileTreeSource {
  gitStatus: readonly GitStatusEntry[];
  pathCount: number;
  paths: readonly string[];
  pathToItemId: ReadonlyMap<string, string>;
  previousSource?: CodeViewFileTreeSource;
  sort: CodeViewFileTreeSort;
}

export interface CodeViewDiffStats {
  addedLines: number;
  deletedLines: number;
  fileCount: number;
  totalLinesOfCode: number;
}
