import type {
  ChangeTypes,
  CodeViewDiffItem,
  CodeViewItem,
  DiffLineAnnotation,
} from '@pierre/diffs';
import type { GitStatus, GitStatusEntry } from '@pierre/trees';

import type {
  CodeViewCommentFileByItemId,
  CodeViewDeletedCommentEvent,
  CodeViewFileTreeSort,
  CodeViewFileTreeSource,
  CodeViewSavedCommentEntry,
  CodeViewSavedCommentEvent,
  CodeViewSavedCommentItem,
  CommentMetadata,
  DraftCommentMetadata,
  SavedCommentMetadata,
} from './types';

const PATCH_ORDER_FALLBACK_RANK = Number.MAX_SAFE_INTEGER;

export function incrementItemVersion(item: CodeViewItem<CommentMetadata>) {
  item.version = typeof item.version === 'number' ? item.version + 1 : 1;
}

export function isDiffItem(
  item: CodeViewItem<CommentMetadata>
): item is CodeViewDiffItem<CommentMetadata> {
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

function createPatchOrderSort(paths: readonly string[]): CodeViewFileTreeSort {
  const rankByPath = new Map<string, number>();
  for (let index = 0; index < paths.length; index++) {
    const path = paths[index];
    if (path == null || path.length === 0) {
      continue;
    }

    if (!rankByPath.has(path)) {
      rankByPath.set(path, index);
    }

    let slashIndex = path.lastIndexOf('/');
    while (slashIndex > 0) {
      const directory = path.slice(0, slashIndex);
      if (!rankByPath.has(directory)) {
        rankByPath.set(directory, index);
      }
      slashIndex = directory.lastIndexOf('/');
    }
  }

  return (left, right) => {
    const leftRank = rankByPath.get(left.path) ?? PATCH_ORDER_FALLBACK_RANK;
    const rightRank = rankByPath.get(right.path) ?? PATCH_ORDER_FALLBACK_RANK;
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    if (left.depth !== right.depth) {
      return left.depth - right.depth;
    }

    if (left.isDirectory !== right.isDirectory) {
      return left.isDirectory ? -1 : 1;
    }

    if (left.path === right.path) {
      return 0;
    }

    return left.path < right.path ? -1 : 1;
  };
}

// Finalizes the stable tree input from a fresh fetch. Callers are expected to
// populate paths, pathToItemId, and gitStatus in the same pass that builds
// the viewer items so the tree data structure does not require its own walk
// over items. Modified-status entries should be excluded from gitStatus before
// calling here so the tree renders them as the visual default (no tint or badge).
export function createCodeViewFileTreeSource(
  paths: readonly string[],
  pathToItemId: ReadonlyMap<string, string>,
  gitStatus: readonly GitStatusEntry[]
): CodeViewFileTreeSource {
  const sort = createPatchOrderSort(paths);
  return {
    gitStatus,
    paths,
    pathToItemId,
    sort,
  };
}

function insertCommentInLineOrder(
  comments: readonly CodeViewSavedCommentEntry[],
  entry: CodeViewSavedCommentEntry
): CodeViewSavedCommentEntry[] {
  let existingIndex = -1;
  for (let index = 0; index < comments.length; index++) {
    if (comments[index]?.key === entry.key) {
      existingIndex = index;
      break;
    }
  }

  const nextComments =
    existingIndex === -1
      ? [...comments]
      : comments.filter((_, index) => index !== existingIndex);

  let insertIndex = nextComments.length;
  for (let index = 0; index < nextComments.length; index++) {
    const comment = nextComments[index];
    if (comment != null && entry.lineNumber < comment.lineNumber) {
      insertIndex = index;
      break;
    }
  }

  nextComments.splice(insertIndex, 0, entry);
  return nextComments;
}

export function upsertSavedCommentSidebarEntry(
  sections: readonly CodeViewSavedCommentItem[],
  commentFileByItemId: CodeViewCommentFileByItemId | null,
  entry: CodeViewSavedCommentEvent
): CodeViewSavedCommentItem[] {
  const file = commentFileByItemId?.get(entry.itemId);
  if (file == null) {
    return [...sections];
  }

  const nextEntry: CodeViewSavedCommentEntry = {
    author: entry.author,
    itemId: entry.itemId,
    key: entry.key,
    lineNumber: entry.lineNumber,
    message: entry.message,
    range: entry.range,
    side: entry.side,
  };

  const nextSections = [...sections];
  let sectionIndex = -1;
  for (let index = 0; index < nextSections.length; index++) {
    if (nextSections[index]?.itemId === entry.itemId) {
      sectionIndex = index;
      break;
    }
  }

  if (sectionIndex === -1) {
    const nextSection: CodeViewSavedCommentItem = {
      comments: [nextEntry],
      fileOrder: file.fileOrder,
      itemId: entry.itemId,
      path: file.path,
    };

    let insertIndex = nextSections.length;
    for (let index = 0; index < nextSections.length; index++) {
      const section = nextSections[index];
      if (section != null && file.fileOrder < section.fileOrder) {
        insertIndex = index;
        break;
      }
    }

    nextSections.splice(insertIndex, 0, nextSection);
    return nextSections;
  }

  const section = nextSections[sectionIndex];
  if (section == null) {
    return sections.slice();
  }

  nextSections[sectionIndex] = {
    ...section,
    comments: insertCommentInLineOrder(section.comments, nextEntry),
  };
  return nextSections;
}

export function removeSavedCommentSidebarEntry(
  sections: readonly CodeViewSavedCommentItem[],
  entry: CodeViewDeletedCommentEvent
): CodeViewSavedCommentItem[] {
  let sectionIndex = -1;
  for (let index = 0; index < sections.length; index++) {
    if (sections[index]?.itemId === entry.itemId) {
      sectionIndex = index;
      break;
    }
  }

  if (sectionIndex === -1) {
    return sections.slice();
  }

  const section = sections[sectionIndex];
  if (section == null) {
    return sections.slice();
  }

  const nextComments = section.comments.filter(
    (comment) => comment.key !== entry.key
  );
  if (nextComments.length === section.comments.length) {
    return sections.slice();
  }

  if (nextComments.length === 0) {
    return sections.filter((_, index) => index !== sectionIndex);
  }

  const nextSections = [...sections];
  nextSections[sectionIndex] = {
    ...section,
    comments: nextComments,
  };
  return nextSections;
}
