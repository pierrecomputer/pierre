import type { DiffsHubSavedCommentEntry } from './types';

export function insertCommentInLineOrder(
  comments: readonly DiffsHubSavedCommentEntry[],
  entry: DiffsHubSavedCommentEntry
): DiffsHubSavedCommentEntry[] {
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
