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

export interface ReviewDiffProps {
  files: readonly ReviewDiffFile[];
  notices?: readonly string[];
  wrap?: boolean;
  collapsed?: boolean;
  diffStyle?: 'split' | 'unified';
  labels?: ReviewDiffLabels;
  onHydrationRequested?: (fileId: string) => void;
  class?: string;
  codeViewOptions?: Partial<CodeViewOptions<undefined>>;
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

export interface CreateReviewDiffItemsOptions {
  files: readonly ReviewDiffFile[];
  notices?: readonly string[];
  collapsed?: boolean;
  labels?: ReviewDiffLabels | ResolvedReviewDiffLabels;
}

export type ReviewDiffItem = CodeViewItem<undefined>;
