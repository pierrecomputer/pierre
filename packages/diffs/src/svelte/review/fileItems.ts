import type { FileContents, FileDiffMetadata } from '../../types.js';
import { parseDiffFromFile } from '../../utils/parseDiffFromFile.js';
import { processFile } from '../../utils/parsePatchFiles.js';
import { createReviewDiffCommentThreadGroups } from './commentThreads.js';
import type { ReviewDiffCommentThreadGroup } from './commentThreads.js';
import { resolveReviewDiffLabels } from './labels.js';
import type {
  CreateReviewDiffItemsOptions,
  ResolvedReviewDiffLabels,
  ReviewDiffConflictFile,
  ReviewDiffFile,
  ReviewDiffItem,
  ReviewDiffStateFile,
  ReviewDiffTextFile,
  ReviewDiffVirtualFile,
} from './types.js';

export function createReviewDiffItems<TCommentMetadata = unknown>({
  files,
  notices = [],
  collapsed = false,
  labels: unresolvedLabels,
  commentThreads,
}: CreateReviewDiffItemsOptions<TCommentMetadata>): ReviewDiffItem<TCommentMetadata>[] {
  const labels = resolveReviewDiffLabels(unresolvedLabels);
  const items: ReviewDiffItem<TCommentMetadata>[] = [];
  const itemIds = new Set(files.map((file) => file.id));
  const commentThreadGroups = createReviewDiffCommentThreadGroups(
    files,
    commentThreads
  );

  for (let index = 0; index < notices.length; index++) {
    const notice = notices[index] ?? '';
    const noticeItem = createNoticeItem<TCommentMetadata>(
      index,
      notice,
      collapsed,
      labels,
      itemIds
    );
    items.push(noticeItem);
    itemIds.add(noticeItem.id);
  }

  for (const file of files) {
    items.push(
      createFileItem(file, collapsed, labels, commentThreadGroups.get(file.id))
    );
  }

  return items;
}

function createNoticeItem<TCommentMetadata>(
  index: number,
  notice: string,
  collapsed: boolean,
  labels: ResolvedReviewDiffLabels,
  itemIds: ReadonlySet<string>
): ReviewDiffItem<TCommentMetadata> {
  return {
    id: createNoticeId(index, itemIds),
    type: 'file',
    file: {
      name: labels.noticeTitle,
      contents: `${labels.noticeTitle}\n\n${notice}`,
      cacheKey: fingerprintString('notice', labels.noticeTitle, notice),
    },
    version: fingerprint('notice', labels.noticeTitle, notice),
    collapsed,
  };
}

function createNoticeId(index: number, itemIds: ReadonlySet<string>): string {
  const baseId = `__pierre_review_notice:${index}`;

  if (!itemIds.has(baseId)) {
    return baseId;
  }

  let suffix = 1;
  while (itemIds.has(`${baseId}:${suffix}`)) {
    suffix++;
  }

  return `${baseId}:${suffix}`;
}

function createFileItem<TCommentMetadata>(
  file: ReviewDiffFile,
  collapsed: boolean,
  labels: ResolvedReviewDiffLabels,
  commentThreadGroup: ReviewDiffCommentThreadGroup<TCommentMetadata> | undefined
): ReviewDiffItem<TCommentMetadata> {
  switch (file.kind) {
    case 'text':
      return createTextItem(file, collapsed, commentThreadGroup);
    case 'virtual':
      return createVirtualItem(file, collapsed, labels, commentThreadGroup);
    case 'state':
      return createStateItem<TCommentMetadata>(file, collapsed, labels);
    case 'conflict':
      return createConflictItem(file, collapsed, commentThreadGroup);
  }
}

function createTextItem<TCommentMetadata>(
  file: ReviewDiffTextFile,
  collapsed: boolean,
  commentThreadGroup: ReviewDiffCommentThreadGroup<TCommentMetadata> | undefined
): ReviewDiffItem<TCommentMetadata> {
  const oldFile = createFileContents(
    file.oldPath ?? file.path,
    file.oldText,
    fingerprintString(file.id, 'old', file.oldPath ?? file.path, file.oldText)
  );
  const newFile = createFileContents(
    file.path,
    file.newText,
    fingerprintString(file.id, 'new', file.path, file.newText)
  );
  const annotations = commentThreadGroup?.annotations;

  return {
    id: file.id,
    type: 'diff',
    fileDiff: parseDiffFromFile(oldFile, newFile),
    ...(annotations == null ? {} : { annotations }),
    version: fingerprint(
      file.kind,
      file.id,
      file.path,
      file.oldPath ?? '',
      file.status,
      file.oldText,
      file.newText,
      commentThreadGroup?.version ?? ''
    ),
    collapsed,
  };
}

function createVirtualItem<TCommentMetadata>(
  file: ReviewDiffVirtualFile,
  collapsed: boolean,
  labels: ResolvedReviewDiffLabels,
  commentThreadGroup: ReviewDiffCommentThreadGroup<TCommentMetadata> | undefined
): ReviewDiffItem<TCommentMetadata> {
  const fileDiff = processFile(file.patch, { cacheKey: file.id });
  const version = fingerprint(
    file.kind,
    file.id,
    file.path,
    file.oldPath ?? '',
    file.status,
    file.patch,
    commentThreadGroup?.version ?? ''
  );

  if (fileDiff == null) {
    return createMessageItem<TCommentMetadata>(
      file.id,
      file.path,
      `${labels.readError}\n\nUnable to render partial diff for ${file.path}.`,
      version,
      collapsed
    );
  }

  const annotations = commentThreadGroup?.annotations;

  return {
    id: file.id,
    type: 'diff',
    fileDiff,
    ...(annotations == null ? {} : { annotations }),
    version,
    collapsed,
  };
}

function createStateItem<TCommentMetadata>(
  file: ReviewDiffStateFile,
  collapsed: boolean,
  labels: ResolvedReviewDiffLabels
): ReviewDiffItem<TCommentMetadata> {
  const title = getStateTitle(file, labels);
  const fileDiff = createStateFileDiff(file, title);

  return {
    id: file.id,
    type: 'diff',
    fileDiff,
    version: fingerprint(
      file.kind,
      file.id,
      file.path,
      file.oldPath ?? '',
      file.status,
      file.reason,
      file.message ?? '',
      title,
      fileDiff.cacheKey ?? ''
    ),
    collapsed,
  };
}

function createConflictItem<TCommentMetadata>(
  file: ReviewDiffConflictFile,
  collapsed: boolean,
  commentThreadGroup: ReviewDiffCommentThreadGroup<TCommentMetadata> | undefined
): ReviewDiffItem<TCommentMetadata> {
  const oldText = file.oursText ?? file.baseText ?? '';
  const oldFile = createFileContents(
    file.oldPath ?? file.path,
    oldText,
    fingerprintString(
      file.id,
      'conflict-old',
      file.oldPath ?? file.path,
      oldText
    )
  );
  const newFile = createFileContents(
    file.path,
    file.worktreeText,
    fingerprintString(file.id, 'conflict-new', file.path, file.worktreeText)
  );
  const annotations = commentThreadGroup?.annotations;

  return {
    id: file.id,
    type: 'diff',
    fileDiff: parseDiffFromFile(oldFile, newFile),
    ...(annotations == null ? {} : { annotations }),
    version: fingerprint(
      file.kind,
      file.id,
      file.path,
      file.oldPath ?? '',
      file.status,
      oldText,
      file.worktreeText,
      commentThreadGroup?.version ?? ''
    ),
    collapsed,
  };
}

function createMessageItem<TCommentMetadata>(
  id: string,
  path: string,
  contents: string,
  version: number,
  collapsed: boolean
): ReviewDiffItem<TCommentMetadata> {
  return {
    id,
    type: 'file',
    file: {
      name: path,
      contents,
      cacheKey: fingerprintString(id, path, contents),
    },
    version,
    collapsed,
  };
}

function createFileContents(
  name: string,
  contents: string,
  cacheKey: string
): FileContents {
  return { name, contents, cacheKey };
}

function createStateFileDiff(
  file: ReviewDiffStateFile,
  title: string
): FileDiffMetadata {
  const patch = [
    `diff --git a/${file.path} b/${file.path}`,
    'index 0000000..0000000 100644',
    `--- a/${file.path}`,
    `+++ b/${file.path}`,
    '',
  ].join('\n');
  const fileDiff = processFile(patch, {
    cacheKey: fingerprintString(
      file.kind,
      file.id,
      file.path,
      file.oldPath ?? '',
      file.status,
      file.reason,
      file.message ?? '',
      title
    ),
  });

  if (fileDiff == null) {
    return {
      name: file.path,
      type: 'change',
      hunks: [],
      splitLineCount: 0,
      unifiedLineCount: 0,
      isPartial: true,
      deletionLines: [],
      additionLines: [],
      cacheKey: fingerprintString(
        file.kind,
        file.id,
        file.path,
        file.oldPath ?? '',
        file.status,
        file.reason,
        file.message ?? '',
        title,
        'fallback'
      ),
    };
  }

  return fileDiff;
}

function getStateTitle(
  file: ReviewDiffStateFile,
  labels: ResolvedReviewDiffLabels
): string {
  switch (file.reason) {
    case 'binary_file':
      return labels.binaryFile;
    case 'symlink_file':
      return labels.symlinkFile;
    case 'invalid_text_encoding':
      return labels.invalidTextEncoding;
    case 'read_error':
      return labels.readError;
  }
}

function fingerprintString(...parts: readonly string[]): string {
  return fingerprint32(FNV_OFFSET_BASIS, parts).toString(36);
}

function fingerprint(...parts: readonly string[]): number {
  const low = fingerprint32(FNV_OFFSET_BASIS, parts);
  const high = fingerprint32(FNV_ALTERNATE_OFFSET_BASIS, parts);

  return (high & 0x1f_ffff) * 0x1_0000_0000 + low;
}

const FNV_OFFSET_BASIS = 2_166_136_261;
const FNV_ALTERNATE_OFFSET_BASIS = 3_805_222_743;

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
