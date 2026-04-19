import type {
  ChangeTypes,
  CodeViewerDiffItem,
  CodeViewerItem,
  DiffLineAnnotation,
} from '@pierre/diffs';
import {
  type GitStatus,
  type GitStatusEntry,
  prepareFileTreeInput,
} from '@pierre/trees';

import { BASE_FILE_TREE_OPTIONS } from './constants';
import type {
  CodeViewerFileTreeSource,
  CommentMetadata,
  DraftCommentMetadata,
  SavedCommentMetadata,
} from './types';

export function incrementItemVersion(item: CodeViewerItem<CommentMetadata>) {
  item.version = typeof item.version === 'number' ? item.version + 1 : 1;
}

export function isDiffItem(
  item: CodeViewerItem<CommentMetadata>
): item is CodeViewerDiffItem<CommentMetadata> {
  return item.type === 'diff';
}

export function isDraftMetadata(
  metadata: CommentMetadata
): metadata is DraftCommentMetadata {
  return metadata.kind === 'draft';
}

export function isDraftAnnotation(
  annotation: DiffLineAnnotation<CommentMetadata>
): annotation is DiffLineAnnotation<DraftCommentMetadata> {
  return isDraftMetadata(annotation.metadata);
}

export function isSavedAnnotation(
  annotation: DiffLineAnnotation<CommentMetadata>
): annotation is DiffLineAnnotation<SavedCommentMetadata> {
  return annotation.metadata.kind === 'saved';
}

export function getPullRequestPath(input: string): string | undefined {
  try {
    const parsedURL = new URL(input);
    if (parsedURL.hostname !== 'github.com') {
      return undefined;
    }
    const [finalSegment, pullSegment] = parsedURL.pathname.split('/').reverse();
    if (
      finalSegment == null ||
      !/^\d+(\.patch)?$/.test(finalSegment) ||
      pullSegment !== 'pull'
    ) {
      return undefined;
    }
    return parsedURL.pathname;
  } catch {
    return undefined;
  }
}

// Translates the diff-level change type surfaced by @pierre/diffs into the
// git-status vocabulary the file tree understands. Both rename variants fold
// into 'renamed' so the tree shows a consistent rename badge regardless of
// whether content also changed.
export function mapChangeTypeToGitStatus(type: ChangeTypes): GitStatus {
  switch (type) {
    case 'new':
      return 'added';
    case 'deleted':
      return 'deleted';
    case 'rename-pure':
    case 'rename-changed':
      return 'renamed';
    case 'change':
      return 'modified';
  }
}

// Finalizes the stable tree input from a fresh fetch. Callers are expected to
// populate paths, pathToItemId, and gitStatus in the same pass that builds
// the viewer items so the tree data structure does not require its own walk
// over items.
export function createCodeViewerFileTreeSource(
  paths: readonly string[],
  pathToItemId: ReadonlyMap<string, string>,
  gitStatus: readonly GitStatusEntry[]
): CodeViewerFileTreeSource {
  return {
    gitStatus,
    pathToItemId,
    preparedInput: prepareFileTreeInput(paths, {
      flattenEmptyDirectories: BASE_FILE_TREE_OPTIONS.flattenEmptyDirectories,
    }),
  };
}
