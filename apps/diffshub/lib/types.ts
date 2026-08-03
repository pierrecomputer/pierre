import type { AnnotationSide, SelectedLineRange } from '@pierre/diffs';
import type { FileTreeGitStatusPatch, GitStatusEntry } from '@pierre/trees';

import type { GitHubCommentThread } from './githubComments';

export type ViewerLoadState =
  | 'fetching'
  | 'streaming'
  | 'parsing'
  | 'ready'
  | 'error';

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
  // True while the draft is being posted to GitHub; the form disables itself
  // until the post settles.
  pending?: boolean;
  range: SelectedLineRange;
}

// A real GitHub comment thread rendered inline. One annotation carries the
// whole thread (root plus replies), anchored where the root comment is.
export interface GitHubCommentMetadata {
  kind: 'github';
  key: string;
  // Selection range for the anchored lines; absent for file-level threads,
  // which have no line to select.
  range?: SelectedLineRange;
  thread: GitHubCommentThread;
}

export type CommentMetadata =
  | SavedCommentMetadata
  | DraftCommentMetadata
  | GitHubCommentMetadata;

export interface DiffsHubCommentSidebarFile {
  fileOrder: number;
  path: string;
}

export type DiffsHubCommentFileByItemId = ReadonlyMap<
  string,
  DiffsHubCommentSidebarFile
>;

// Whether the line the comment is anchored to is a real addition/deletion or
// an unchanged context line shown in the diff. Tracked so the sidebar can
// render "Line N" without a misleading + / - sigil for context lines.
export type CommentLineType = 'change' | 'context';

// Payloads for the viewer→app posting callbacks: a finished draft to publish
// as a new GitHub review comment, and a reply to an existing thread.
export interface DiffsHubPostDraftRequest {
  itemId: string;
  key: string;
  lineNumber: number;
  message: string;
  range: SelectedLineRange;
  side: AnnotationSide;
}

export interface DiffsHubPostReplyRequest {
  body: string;
  itemId: string;
  key: string;
  rootCommentId: number;
}

export interface DiffsHubDeletedCommentEvent {
  itemId: string;
  key: string;
}

export interface DiffsHubSavedCommentEntry {
  // How the comment attaches to the diff. Absent means a normal line anchor;
  // 'file' is a file-level comment; 'outdated' is a GitHub comment whose line
  // no longer exists in the current head diff (lineNumber then holds the
  // original line, or 0 when unknown). Non-line anchors navigate to the file
  // instead of selecting lines.
  anchor?: 'file' | 'outdated';
  author: string;
  avatarUrl?: string;
  itemId: string;
  key: string;
  lineNumber: number;
  lineType: CommentLineType;
  message: string;
  range: SelectedLineRange;
  replyCount?: number;
  side: AnnotationSide;
  thread?: GitHubCommentThread;
}

export interface DiffsHubSavedCommentItem {
  comments: DiffsHubSavedCommentEntry[];
  fileOrder: number;
  itemId: string;
  path: string;
}

// The fully pre-computed input this tree needs for a given fetch. It is built
// once at fetch time by snapshotDiffsHubTreeSource and stored alongside the
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
export interface DiffsHubFileTreeSource {
  gitStatus: readonly GitStatusEntry[];
  gitStatusPatch?: FileTreeGitStatusPatch;
  pathCount: number;
  paths: readonly string[];
  pathToItemId: ReadonlyMap<string, string>;
  previousSource?: DiffsHubFileTreeSource;
}

export interface DiffsHubDiffStats {
  addedLines: number;
  deletedLines: number;
  fileCount: number;
  totalLinesOfCode: number;
}
