import type { CodeViewOptions } from '../../components/CodeView.js';
import type { CodeViewItem } from '../../types.js';

export type ReviewDiffFileGroup =
  | 'unstaged'
  | 'staged'
  | 'committed'
  | 'branch'
  | (string & {});

export type ReviewDiffFileStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'conflicted'
  | 'binary';

interface ReviewDiffFileBase {
  id: string;
  path: string;
  oldPath: string | null;
  status: ReviewDiffFileStatus;
  group: ReviewDiffFileGroup;
}

export interface ReviewDiffTextFile extends ReviewDiffFileBase {
  kind: 'text';
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  oldText: string;
  newText: string;
  byteSize: number;
  lineCount: number;
  patch: string;
}

export interface ReviewDiffVirtualFile extends ReviewDiffFileBase {
  kind: 'virtual';
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  patch: string;
  byteSize: number;
  lineCount: number;
  contextLines: number;
  canExpandContext: boolean;
}

export interface ReviewDiffStateFile extends ReviewDiffFileBase {
  kind: 'state';
  reason:
    | 'binary_file'
    | 'symlink_file'
    | 'invalid_text_encoding'
    | 'read_error';
  byteSize: number | null;
  message: string | null;
}

export interface ReviewDiffConflictFile extends ReviewDiffFileBase {
  kind: 'conflict';
  status: 'conflicted';
  baseText: string | null;
  oursText: string | null;
  theirsText: string | null;
  worktreeText: string;
  patch: string;
  byteSize: number;
  lineCount: number;
}

export type ReviewDiffFile =
  | ReviewDiffTextFile
  | ReviewDiffVirtualFile
  | ReviewDiffStateFile
  | ReviewDiffConflictFile;

export type ReviewDiffCommentSide = 'additions' | 'deletions';

export interface ReviewDiffCommentTarget {
  fileId: string;
  side: ReviewDiffCommentSide;
  lineNumber: number;
}

export interface ReviewDiffCommentThread<TMetadata = unknown> {
  /** Stable unique id for this thread within the review diff. */
  id: string;
  target: ReviewDiffCommentTarget;
  metadata: TMetadata;
}

export type ReviewDiffCommentableFile = Exclude<
  ReviewDiffFile,
  ReviewDiffStateFile
>;

export interface ReviewDiffCommentAnnotationMetadata<TMetadata = unknown> {
  file: ReviewDiffCommentableFile;
  target: ReviewDiffCommentTarget;
  thread: ReviewDiffCommentThread<TMetadata>;
}

export interface ReviewDiffCommentThreadRenderContext<TMetadata = unknown> {
  file: ReviewDiffCommentableFile;
  target: ReviewDiffCommentTarget;
  thread: ReviewDiffCommentThread<TMetadata>;
}

export interface ReviewDiffCommentAddContext {
  file: ReviewDiffCommentableFile;
  target: ReviewDiffCommentTarget;
}

export interface ReviewDiffLabels {
  ariaLabel?: string;
  collapseFile?: string;
  expandFile?: string;
  noticeTitle?: string;
  binaryFile?: string;
  symlinkFile?: string;
  invalidTextEncoding?: string;
  readError?: string;
  formatUnmodifiedLines?: (count: number) => string;
}

export interface ResolvedReviewDiffLabels {
  ariaLabel: string;
  collapseFile: string;
  expandFile: string;
  noticeTitle: string;
  binaryFile: string;
  symlinkFile: string;
  invalidTextEncoding: string;
  readError: string;
  formatUnmodifiedLines: (count: number) => string;
}

export interface ReviewDiffProps<TCommentMetadata = unknown> {
  files: readonly ReviewDiffFile[];
  notices?: readonly string[];
  wrap?: boolean;
  collapsed?: boolean;
  diffStyle?: 'split' | 'unified';
  labels?: ReviewDiffLabels;
  onHydrationRequested?: (fileId: string) => void;
  class?: string;
  codeViewOptions?: Partial<
    CodeViewOptions<ReviewDiffCommentAnnotationMetadata<TCommentMetadata>>
  >;
  commentThreads?: readonly ReviewDiffCommentThread<TCommentMetadata>[];
  renderCommentThread?: (
    thread: ReviewDiffCommentThread<TCommentMetadata>,
    context: ReviewDiffCommentThreadRenderContext<TCommentMetadata>
  ) => HTMLElement | undefined;
  onCommentThreadAddRequested?: (
    target: ReviewDiffCommentTarget,
    context: ReviewDiffCommentAddContext
  ) => void;
}

export interface ReviewDiffHandle {
  applyCollapseModeToLoaded(nextCollapsed: boolean): void;
  hydrateFile(
    fileId: string,
    patch: string,
    oldText: string,
    newText: string
  ): void;
}

export interface CreateReviewDiffItemsOptions<TCommentMetadata = unknown> {
  files: readonly ReviewDiffFile[];
  notices?: readonly string[];
  collapsed?: boolean;
  labels?: ReviewDiffLabels | ResolvedReviewDiffLabels;
  commentThreads?: readonly ReviewDiffCommentThread<TCommentMetadata>[];
}

export type ReviewDiffItem<TCommentMetadata = unknown> = CodeViewItem<
  ReviewDiffCommentAnnotationMetadata<TCommentMetadata>
>;
