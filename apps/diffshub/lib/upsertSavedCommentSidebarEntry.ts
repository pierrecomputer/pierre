import { insertCommentInLineOrder } from './insertCommentInLineOrder';
import type {
  DiffsHubCommentFileByItemId,
  DiffsHubSavedCommentEntry,
  DiffsHubSavedCommentEvent,
  DiffsHubSavedCommentItem,
} from './types';

export function upsertSavedCommentSidebarEntry(
  sections: readonly DiffsHubSavedCommentItem[],
  commentFileByItemId: DiffsHubCommentFileByItemId | null,
  entry: DiffsHubSavedCommentEvent
): DiffsHubSavedCommentItem[] {
  const file = commentFileByItemId?.get(entry.itemId);
  if (file == null) {
    return [...sections];
  }

  const nextEntry: DiffsHubSavedCommentEntry = {
    author: entry.author,
    itemId: entry.itemId,
    key: entry.key,
    lineNumber: entry.lineNumber,
    lineType: entry.lineType,
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
    const nextSection: DiffsHubSavedCommentItem = {
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
