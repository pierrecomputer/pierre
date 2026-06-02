import type { DiffLineAnnotation } from '../../types.js';
import type {
  ReviewDiffCommentableFile,
  ReviewDiffCommentAnnotationMetadata,
  ReviewDiffCommentThread,
  ReviewDiffFile,
  ReviewDiffItem,
} from './types.js';

export interface ReviewDiffCommentThreadGroup<TMetadata = unknown> {
  annotations: DiffLineAnnotation<
    ReviewDiffCommentAnnotationMetadata<TMetadata>
  >[];
  version: string;
}

let nextCommentThreadIdentityId = 1;
let nextCommentRendererIdentityId = 1;
const commentThreadIdentityIds = new WeakMap<
  ReviewDiffCommentThread<unknown>,
  number
>();
const commentRendererIdentityIds = new WeakMap<object, number>();
const itemOverlayStates = new WeakMap<
  readonly ReviewDiffItem<unknown>[],
  ReviewDiffCommentOverlayState
>();

interface ReviewDiffCommentOverlayState {
  baseVersionsByFileId: ReadonlyMap<string, number | undefined>;
  commentedFileIds: ReadonlySet<string>;
}

export function isReviewDiffCommentableFile(
  file: ReviewDiffFile
): file is ReviewDiffCommentableFile {
  return file.kind !== 'state';
}

// Applies the controlled comment-thread overlay to already-created diff items.
// This keeps comment-only updates from re-parsing file contents or virtual patches.
export function applyReviewDiffCommentThreadGroupsToItems<TMetadata>(
  items: readonly ReviewDiffItem<TMetadata>[],
  files: readonly ReviewDiffFile[],
  commentThreads: readonly ReviewDiffCommentThread<TMetadata>[] | undefined,
  commentRenderer: unknown = undefined
): ReviewDiffItem<TMetadata>[] {
  if (commentThreads == null) {
    return [...items];
  }

  const groups = createReviewDiffCommentThreadGroups(files, commentThreads);
  const nextCommentedFileIds = new Set(groups.keys());
  const previousState = itemOverlayStates.get(
    items as readonly ReviewDiffItem<unknown>[]
  );
  const previousCommentedFileIds = previousState?.commentedFileIds;
  const nextBaseVersionsByFileId = new Map<string, number | undefined>();
  const shouldClearEveryUncommentedItem = previousState == null;
  let didChange = false;
  const nextItems: ReviewDiffItem<TMetadata>[] = [];

  for (const item of items) {
    if (item.type !== 'diff') {
      nextItems.push(item);
      continue;
    }

    const baseVersion = getCommentOverlayBaseVersion(previousState, item);
    nextBaseVersionsByFileId.set(item.id, baseVersion);

    const group = groups.get(item.id);
    if (group != null) {
      nextItems.push({
        ...item,
        annotations: group.annotations,
        version: createCommentOverlayVersion(
          baseVersion,
          group.version,
          commentRenderer
        ),
      });
      didChange = true;
      continue;
    }

    if (
      shouldClearEveryUncommentedItem ||
      previousCommentedFileIds?.has(item.id) === true
    ) {
      nextItems.push({
        ...item,
        annotations: [],
        version: baseVersion,
      });
      didChange = true;
      continue;
    }

    nextItems.push(item);
  }

  const nextState = {
    baseVersionsByFileId: nextBaseVersionsByFileId,
    commentedFileIds: nextCommentedFileIds,
  };
  const result = didChange ? nextItems : [...items];
  itemOverlayStates.set(items as readonly ReviewDiffItem<unknown>[], nextState);
  itemOverlayStates.set(
    result as readonly ReviewDiffItem<unknown>[],
    nextState
  );

  return result;
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

function getCommentOverlayBaseVersion<TMetadata>(
  state: ReviewDiffCommentOverlayState | undefined,
  item: ReviewDiffItem<TMetadata>
): number | undefined {
  if (state?.baseVersionsByFileId.has(item.id) === true) {
    return state.baseVersionsByFileId.get(item.id);
  }

  return item.version;
}

function createCommentOverlayVersion(
  baseVersion: number | undefined,
  commentThreadVersion: string,
  commentRenderer: unknown
): number {
  return fingerprint(
    baseVersion == null ? '' : baseVersion.toString(36),
    commentThreadVersion,
    getCommentRendererIdentityId(commentRenderer)
  );
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

function getCommentRendererIdentityId(commentRenderer: unknown): string {
  if (
    (typeof commentRenderer !== 'function' &&
      typeof commentRenderer !== 'object') ||
    commentRenderer == null
  ) {
    return '';
  }

  let identityId = commentRendererIdentityIds.get(commentRenderer);
  if (identityId == null) {
    identityId = nextCommentRendererIdentityId++;
    commentRendererIdentityIds.set(commentRenderer, identityId);
  }

  return identityId.toString(36);
}

const COMMENT_THREAD_PART_SEPARATOR = '\u001f';
const COMMENT_THREAD_SEPARATOR = '\u001e';
const FNV_OFFSET_BASIS = 2_166_136_261;
const FNV_ALTERNATE_OFFSET_BASIS = 3_805_222_743;

function fingerprint(...parts: readonly string[]): number {
  const low = fingerprint32(FNV_OFFSET_BASIS, parts);
  const high = fingerprint32(FNV_ALTERNATE_OFFSET_BASIS, parts);

  return (high & 0x1f_ffff) * 0x1_0000_0000 + low;
}

function fingerprint32(seed: number, parts: readonly string[]): number {
  let hash = seed;
  for (const part of parts) {
    hash = updateHash(hash, part.length.toString());
    hash = updateHash(hash, ':');
    hash = updateHash(hash, part);
    hash = updateHash(hash, ';');
  }

  return hash >>> 0;
}

function updateHash(hash: number, value: string): number {
  let nextHash = hash;

  for (let index = 0; index < value.length; index++) {
    nextHash ^= value.charCodeAt(index);
    nextHash = Math.imul(nextHash, 16_777_619);
  }

  return nextHash;
}
