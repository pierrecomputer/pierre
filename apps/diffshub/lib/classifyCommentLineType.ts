import type { AnnotationSide, FileDiffMetadata } from '@pierre/diffs';

import type { CommentLineType } from './types';

// Classifies a 1-based line number on a given diff side as either an actual
// addition/deletion or an unchanged context line. The sidebar uses this to
// avoid rendering "+13" / "-13" for comments anchored to lines that are
// rendered as context (and therefore weren't actually added or removed).
//
// Walks each hunk's ordered `hunkContent` while tracking the running line
// number on the requested side. A context block of N lines advances by N on
// both sides; a change block advances by `additions` on the addition side and
// `deletions` on the deletion side. Mirrors the walk pattern used by
// FileDiff.getLineIndex inside `@pierre/diffs`.
export function classifyCommentLineType(
  fileDiff: FileDiffMetadata,
  side: AnnotationSide,
  lineNumber: number
): CommentLineType {
  for (const hunk of fileDiff.hunks) {
    let currentLineNumber =
      side === 'additions' ? hunk.additionStart : hunk.deletionStart;
    const hunkCount =
      side === 'additions' ? hunk.additionCount : hunk.deletionCount;
    if (
      lineNumber < currentLineNumber ||
      lineNumber >= currentLineNumber + hunkCount
    ) {
      continue;
    }
    for (const content of hunk.hunkContent) {
      const blockLength =
        content.type === 'context'
          ? content.lines
          : side === 'additions'
            ? content.additions
            : content.deletions;
      if (blockLength === 0) {
        continue;
      }
      if (lineNumber < currentLineNumber + blockLength) {
        return content.type === 'context' ? 'context' : 'change';
      }
      currentLineNumber += blockLength;
    }
  }
  return 'change';
}
