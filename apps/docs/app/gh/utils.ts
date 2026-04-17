import type {
  CodeViewerDiffItem,
  CodeViewerItem,
  DiffLineAnnotation,
} from '@pierre/diffs';

import type {
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
