import type { DiffLineAnnotation } from '../../types.js';
import type {
  ReviewDiffCommentableFile,
  ReviewDiffCommentAnnotationMetadata,
  ReviewDiffCommentThread,
  ReviewDiffFile,
} from './types.js';

export interface ReviewDiffCommentThreadGroup<TMetadata = unknown> {
  annotations: DiffLineAnnotation<
    ReviewDiffCommentAnnotationMetadata<TMetadata>
  >[];
  version: string;
}

let nextCommentThreadIdentityId = 1;
const commentThreadIdentityIds = new WeakMap<
  ReviewDiffCommentThread<unknown>,
  number
>();

export function isReviewDiffCommentableFile(
  file: ReviewDiffFile
): file is ReviewDiffCommentableFile {
  return file.kind !== 'state';
}

// Groups comment threads by rendered file so item creation can attach annotations
// and calculate versions without scanning every thread for every file.
export function createReviewDiffCommentThreadGroups<TMetadata>(
  files: readonly ReviewDiffFile[],
  commentThreads: readonly ReviewDiffCommentThread<TMetadata>[] | undefined
): Map<string, ReviewDiffCommentThreadGroup<TMetadata>> {
  const commentableFilesById = new Map<string, ReviewDiffCommentableFile>();

  for (const file of files) {
    if (isReviewDiffCommentableFile(file)) {
      commentableFilesById.set(file.id, file);
    }
  }

  const groups = new Map<string, ReviewDiffCommentThreadGroup<TMetadata>>();

  if (commentThreads == null || commentThreads.length === 0) {
    return groups;
  }

  const versionPartsByFileId = new Map<string, string[]>();

  for (const thread of commentThreads) {
    const file = commentableFilesById.get(thread.target.fileId);
    if (file == null) {
      continue;
    }

    let group = groups.get(file.id);
    let versionParts = versionPartsByFileId.get(file.id);
    if (group == null || versionParts == null) {
      group = { annotations: [], version: '' };
      versionParts = [];
      groups.set(file.id, group);
      versionPartsByFileId.set(file.id, versionParts);
    }

    group.annotations.push({
      side: thread.target.side,
      lineNumber: thread.target.lineNumber,
      metadata: {
        file,
        target: thread.target,
        thread,
      },
    });

    versionParts.push(createCommentThreadVersionPart(thread));
  }

  for (const [fileId, group] of groups) {
    group.version = (versionPartsByFileId.get(fileId) ?? []).join(
      COMMENT_THREAD_SEPARATOR
    );
  }

  return groups;
}

function createCommentThreadVersionPart<TMetadata>(
  thread: ReviewDiffCommentThread<TMetadata>
): string {
  return [
    thread.id,
    thread.target.fileId,
    thread.target.side,
    thread.target.lineNumber.toString(),
    getCommentThreadIdentityId(thread),
  ].join(COMMENT_THREAD_PART_SEPARATOR);
}

function getCommentThreadIdentityId<TMetadata>(
  thread: ReviewDiffCommentThread<TMetadata>
): string {
  let identityId = commentThreadIdentityIds.get(thread);
  if (identityId == null) {
    identityId = nextCommentThreadIdentityId++;
    commentThreadIdentityIds.set(thread, identityId);
  }

  return identityId.toString(36);
}

const COMMENT_THREAD_PART_SEPARATOR = '\u001f';
const COMMENT_THREAD_SEPARATOR = '\u001e';
