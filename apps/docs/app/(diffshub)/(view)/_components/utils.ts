import type {
  AnnotationSide,
  ChangeTypes,
  CodeViewDiffItem,
  CodeViewItem,
  DiffLineAnnotation,
  FileDiffMetadata,
} from '@pierre/diffs';
import type { GitStatus } from '@pierre/trees';

import type {
  CodeViewCommentFileByItemId,
  CodeViewDeletedCommentEvent,
  CodeViewSavedCommentEntry,
  CodeViewSavedCommentEvent,
  CodeViewSavedCommentItem,
  CommentLineType,
  CommentMetadata,
  DraftCommentMetadata,
  SavedCommentMetadata,
} from './types';

const GITHUB_HOST = 'github.com';
const GITHUB_RAW_DIFF_HOST = 'patch-diff.githubusercontent.com';
const RAW_GITHUB_DIFF_PATH_PATTERN =
  /^\/raw\/([^/]+)\/([^/]+)\/pull\/([^/]+\.(?:diff|patch))$/;
const GITHUB_PULL_TAB_PATH_PATTERN =
  /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/(?:changes|files)$/;
const GITHUB_PULL_COMMIT_PATH_PATTERN =
  /^\/([^/]+)\/([^/]+)\/pull\/\d+\/(?:changes|files)\/([0-9a-f]{4,40})$/i;

// Matches GitHub shorthand "owner/repo#123" → /owner/repo/pull/123.
const GITHUB_SHORTHAND_PATTERN = /^([^/\s]+)\/([^/\s#]+)#(\d+)$/;

// Matches bare paths like "owner/repo/pull/123" where neither of the first two
// segments contains a dot — a dot would indicate a domain like "github.com".
const BARE_GITHUB_PATH_PATTERN = /^([^/\s.]+)\/([^/\s.]+)(\/[^\s]*)?$/;

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

export function getGitHubPath(input: string): string | undefined {
  try {
    const parsedURL = new URL(input);
    return getGitHubPathFromURL(parsedURL);
  } catch {
    return undefined;
  }
}

// Resolves a user-supplied string into a viewer href, or undefined if the
// input can't be mapped to a supported diff URL. Accepts full URLs, URLs
// without a protocol (e.g. "github.com/…"), bare "owner/repo/…" paths, and
// GitHub shorthand ("owner/repo#123").
export function getPatchViewerHref(input: string): string | undefined {
  const trimmed = input.trim();
  if (trimmed === '') return undefined;

  // GitHub shorthand: "owner/repo#123" → "/owner/repo/pull/123"
  const shorthandMatch = GITHUB_SHORTHAND_PATTERN.exec(trimmed);
  if (shorthandMatch != null) {
    return `/${shorthandMatch[1]}/${shorthandMatch[2]}/pull/${shorthandMatch[3]}`;
  }

  // Full URL with protocol (most common case).
  try {
    const parsedURL = new URL(trimmed);
    const githubPath = getGitHubPathFromURL(parsedURL);
    if (githubPath != null) return githubPath;
    if (parsedURL.pathname !== '/') {
      return `${parsedURL.pathname}?domain=${encodeURIComponent(parsedURL.hostname)}`;
    }
    return undefined;
  } catch {
    // Not a fully-qualified URL; try other interpretations.
  }

  // Domain-relative URL like "github.com/owner/repo/pull/123" — only attempt
  // when the first path segment contains a dot, indicating it's a hostname
  // rather than an owner name. Checking only the first segment avoids false
  // positives from dots in later segments (e.g. "v6.0...v7.0" in a compare URL).
  const firstSegment = trimmed.split('/')[0] ?? '';
  if (firstSegment.includes('.')) {
    try {
      const parsedURL = new URL(`https://${trimmed}`);
      const githubPath = getGitHubPathFromURL(parsedURL);
      if (githubPath != null) return githubPath;
      if (parsedURL.pathname !== '/') {
        return `${parsedURL.pathname}?domain=${encodeURIComponent(parsedURL.hostname)}`;
      }
    } catch {
      // Not parseable even with https:// prefix.
    }
  }

  // Bare GitHub path: "owner/repo/pull/123" or "owner/repo/compare/a...b".
  // The dot-free first segment check above ensures we don't land here for
  // domain-style inputs.
  const bareMatch = BARE_GITHUB_PATH_PATTERN.exec(trimmed);
  if (bareMatch != null) {
    const [, owner, repo, rest = ''] = bareMatch;
    return normalizeGitHubPath(`/${owner}/${repo}${rest}`);
  }

  return undefined;
}

export type DiffshubViewerRoute =
  | { kind: 'redirect'; target: string }
  | {
      kind: 'render';
      upstreamPath: string;
      url: string;
      domain: string | undefined;
    };

// Resolves the catch-all viewer route into either a redirect or the props the
// viewer needs to render. Extracted from the route page so it can be unit
// tested without spinning up Next.js. Empty paths redirect to the home page;
// GitHub paths are canonicalized via normalizeGitHubPath so direct navigation
// matches the hrefs getPatchViewerHref produces from form input. Non-GitHub
// hosts are passed through unchanged because their canonical form is unknown.
export function resolveDiffshubViewerRoute(
  pathSegments: readonly string[],
  requestedDomainInput: string | undefined
): DiffshubViewerRoute {
  if (pathSegments.length === 0) {
    return { kind: 'redirect', target: '/' };
  }

  const domain =
    requestedDomainInput == null || requestedDomainInput === ''
      ? undefined
      : requestedDomainInput;
  const joinedPath = `/${pathSegments.join('/')}`;
  const upstreamPath =
    domain == null ? normalizeGitHubPath(joinedPath) : joinedPath;

  if (upstreamPath !== joinedPath) {
    const query = domain == null ? '' : `?domain=${encodeURIComponent(domain)}`;
    return { kind: 'redirect', target: `${upstreamPath}${query}` };
  }

  const host = domain ?? GITHUB_HOST;
  return {
    domain,
    kind: 'render',
    upstreamPath,
    url: `https://${host}${upstreamPath}`,
  };
}

function getGitHubPathFromURL(parsedURL: URL): string | undefined {
  if (parsedURL.hostname === GITHUB_HOST) {
    if (parsedURL.pathname === '/') {
      return undefined;
    }
    return normalizeGitHubPath(parsedURL.pathname);
  }

  if (parsedURL.hostname !== GITHUB_RAW_DIFF_HOST) {
    return undefined;
  }

  const rawDiffMatch = RAW_GITHUB_DIFF_PATH_PATTERN.exec(parsedURL.pathname);
  if (rawDiffMatch == null) {
    return undefined;
  }

  const owner = rawDiffMatch[1];
  const repo = rawDiffMatch[2];
  const pullFile = rawDiffMatch[3];
  if (owner == null || repo == null || pullFile == null) {
    return undefined;
  }

  return `/${owner}/${repo}/pull/${pullFile}`;
}

export function normalizeGitHubPath(path: string): string {
  const pathWithoutTrailingSlash = path.replace(/\/+$/, '');
  const trimmedPath =
    pathWithoutTrailingSlash === '' ? '/' : pathWithoutTrailingSlash;
  const pullCommitMatch = GITHUB_PULL_COMMIT_PATH_PATTERN.exec(trimmedPath);
  if (pullCommitMatch != null) {
    return `/${pullCommitMatch[1]}/${pullCommitMatch[2]}/commit/${pullCommitMatch[3]}`;
  }

  const pullTabMatch = GITHUB_PULL_TAB_PATH_PATTERN.exec(trimmedPath);
  if (pullTabMatch == null) {
    return trimmedPath;
  }

  return `/${pullTabMatch[1]}/${pullTabMatch[2]}/pull/${pullTabMatch[3]}`;
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

const FAKE_COMMENT_AUTHORS = [
  'pia',
  'mdo',
  'nicolas',
  'alex',
  'cedric',
  'kris',
  'ed',
  'toshi',
  'zac',
] as const;
const FAKE_COMMENT_OPENERS = [
  'Could we',
  'Tiny thought:',
  'This reads well.',
  'Worth double-checking:',
  'I like this direction.',
] as const;
const FAKE_COMMENT_FOCUS = [
  'add a regression test around this path?',
  'make the state transition a little easier to scan?',
  'confirm this behaves correctly while the diff is still streaming?',
  'handle the empty-result case here as explicitly as the happy path?',
  'pull this condition into a named helper before it grows?',
] as const;
const FAKE_COMMENT_CONTEXT = [
  'It would make future review passes calmer.',
  'The surrounding code is carrying a lot of detail already.',
  'That would also make theme-swap regressions easier to spot.',
  'The current shape is close; this is mostly about guardrails.',
  'The behavior looks right, but the intent could be louder.',
] as const;

export interface FakeCommentSourceItem {
  fileOrder: number;
  item: CodeViewDiffItem<CommentMetadata>;
}

interface FakeCommentSpan {
  availableLineCount: number;
  lineCount: number;
  occupiedLines: readonly number[];
  side: AnnotationSide;
  startLine: number;
}

interface FakeCommentFileCandidate {
  availableLineCount: number;
  fileOrder: number;
  hasExistingComments: boolean;
  itemId: string;
  spans: FakeCommentSpan[];
}

// Builds saved-comment events for fake review comments. Candidates are
// gathered from real changed lines, but selected at file granularity first so
// repeated clicks move through different diffs before adding another comment to
// a file that already has one.
export function createFakeCommentEvents(
  sourceItems: readonly FakeCommentSourceItem[],
  count: number,
  keyStart: number
): CodeViewSavedCommentEvent[] {
  if (count <= 0) {
    return [];
  }

  const files = collectFakeCommentFileCandidates(sourceItems);
  const selectedCandidates = selectFakeCommentCandidates(
    files,
    count,
    keyStart
  );

  return selectedCandidates.map((candidate, index) => {
    const keyIndex = keyStart + index;
    const key = `fake-${keyIndex}`;
    const author = FAKE_COMMENT_AUTHORS[keyIndex % FAKE_COMMENT_AUTHORS.length];
    const message = getFakeCommentMessage(keyIndex);

    return {
      author,
      itemId: candidate.itemId,
      key,
      lineNumber: candidate.lineNumber,
      lineType: 'change',
      message,
      range: {
        end: candidate.lineNumber,
        endSide: candidate.side,
        side: candidate.side,
        start: candidate.lineNumber,
      },
      side: candidate.side,
    };
  });
}

export function createSavedCommentAnnotation(
  comment: CodeViewSavedCommentEvent
): DiffLineAnnotation<CommentMetadata> {
  return {
    lineNumber: comment.lineNumber,
    metadata: {
      author: comment.author,
      key: comment.key,
      kind: 'saved',
      message: comment.message,
      range: comment.range,
    },
    side: comment.side,
  };
}

function getFakeCommentMessage(keyIndex: number): string {
  const opener = FAKE_COMMENT_OPENERS[keyIndex % FAKE_COMMENT_OPENERS.length];
  const focus =
    FAKE_COMMENT_FOCUS[
      Math.floor(keyIndex / FAKE_COMMENT_OPENERS.length) %
        FAKE_COMMENT_FOCUS.length
    ];
  const context =
    FAKE_COMMENT_CONTEXT[
      Math.floor(
        keyIndex / (FAKE_COMMENT_OPENERS.length * FAKE_COMMENT_FOCUS.length)
      ) % FAKE_COMMENT_CONTEXT.length
    ];

  return `${opener} ${focus} ${context}`;
}

function collectFakeCommentFileCandidates(
  sourceItems: readonly FakeCommentSourceItem[]
): FakeCommentFileCandidate[] {
  const sortedItems = [...sourceItems].sort(
    (itemA, itemB) => itemA.fileOrder - itemB.fileOrder
  );
  const files: FakeCommentFileCandidate[] = [];

  for (const { fileOrder, item } of sortedItems) {
    const occupiedAnchors = getOccupiedCommentAnchors(item);
    const spans: FakeCommentSpan[] = [];
    for (const hunk of item.fileDiff.hunks) {
      let additionLineNumber = hunk.additionStart;
      let deletionLineNumber = hunk.deletionStart;

      for (const content of hunk.hunkContent) {
        if (content.type === 'context') {
          additionLineNumber += content.lines;
          deletionLineNumber += content.lines;
          continue;
        }

        if (content.additions > 0) {
          pushAvailableFakeCommentSpan(spans, {
            lineCount: content.additions,
            occupiedLines: getOccupiedLinesInSpan(
              occupiedAnchors.additions,
              additionLineNumber,
              content.additions
            ),
            side: 'additions',
            startLine: additionLineNumber,
          });
        } else if (content.deletions > 0) {
          pushAvailableFakeCommentSpan(spans, {
            lineCount: content.deletions,
            occupiedLines: getOccupiedLinesInSpan(
              occupiedAnchors.deletions,
              deletionLineNumber,
              content.deletions
            ),
            side: 'deletions',
            startLine: deletionLineNumber,
          });
        }

        additionLineNumber += content.additions;
        deletionLineNumber += content.deletions;
      }
    }

    let availableLineCount = 0;
    for (const span of spans) {
      availableLineCount += span.availableLineCount;
    }
    if (availableLineCount > 0) {
      files.push({
        availableLineCount,
        fileOrder,
        hasExistingComments: (item.annotations?.length ?? 0) > 0,
        itemId: item.id,
        spans,
      });
    }
  }

  return files;
}

function getOccupiedCommentAnchors(
  item: CodeViewDiffItem<CommentMetadata>
): Record<AnnotationSide, Set<number>> {
  const anchors = {
    additions: new Set<number>(),
    deletions: new Set<number>(),
  };
  for (const annotation of item.annotations ?? []) {
    anchors[annotation.side].add(annotation.lineNumber);
  }
  return anchors;
}

function getOccupiedLinesInSpan(
  occupiedLines: ReadonlySet<number>,
  startLine: number,
  lineCount: number
): number[] {
  if (occupiedLines.size === 0) {
    return [];
  }

  const endLine = startLine + lineCount;
  const linesInSpan: number[] = [];
  for (const lineNumber of occupiedLines) {
    if (lineNumber >= startLine && lineNumber < endLine) {
      linesInSpan.push(lineNumber);
    }
  }
  linesInSpan.sort((lineA, lineB) => lineA - lineB);
  return linesInSpan;
}

function pushAvailableFakeCommentSpan(
  spans: FakeCommentSpan[],
  span: Omit<FakeCommentSpan, 'availableLineCount'>
): void {
  const availableLineCount = span.lineCount - span.occupiedLines.length;
  if (availableLineCount <= 0) {
    return;
  }
  spans.push({ ...span, availableLineCount });
}

function selectFakeCommentCandidates(
  files: readonly FakeCommentFileCandidate[],
  count: number,
  keyStart: number
): FakeCommentCandidate[] {
  if (files.length === 0) {
    return [];
  }

  const selected: FakeCommentCandidate[] = [];
  const selectedAnchors = new Set<string>();
  const batchIndex = Math.floor(keyStart / Math.max(count, 1));
  const freshFiles = files.filter((file) => !file.hasExistingComments);
  const commentedFiles = files.filter((file) => file.hasExistingComments);

  addFakeCommentCandidatesFromFiles(
    selected,
    selectedAnchors,
    selectEvenlySpacedFiles(freshFiles, count, batchIndex),
    keyStart
  );

  if (selected.length < count) {
    addFakeCommentCandidatesFromFiles(
      selected,
      selectedAnchors,
      selectEvenlySpacedFiles(
        commentedFiles,
        count - selected.length,
        batchIndex
      ),
      keyStart + selected.length
    );
  }

  for (let pass = 0; selected.length < count && pass < count; pass++) {
    const rotatedFiles = rotateFiles(files, batchIndex + pass);
    addFakeCommentCandidatesFromFiles(
      selected,
      selectedAnchors,
      rotatedFiles,
      keyStart + selected.length + pass,
      count
    );
  }

  return selected;
}

function selectEvenlySpacedFiles(
  files: readonly FakeCommentFileCandidate[],
  count: number,
  seed: number
): FakeCommentFileCandidate[] {
  if (count <= 0) {
    return [];
  }
  if (files.length <= count) {
    return files.slice();
  }

  const rotatedFiles = rotateFiles(files, seed);
  const selected: FakeCommentFileCandidate[] = [];
  const step = rotatedFiles.length / count;
  for (let index = 0; index < count; index++) {
    const fileIndex = Math.min(
      rotatedFiles.length - 1,
      Math.floor(index * step + step / 2)
    );
    const file = rotatedFiles[fileIndex];
    if (file != null) {
      selected.push(file);
    }
  }
  return selected;
}

function rotateFiles(
  files: readonly FakeCommentFileCandidate[],
  seed: number
): FakeCommentFileCandidate[] {
  if (files.length === 0) {
    return [];
  }
  const offset = seed % files.length;
  return [...files.slice(offset), ...files.slice(0, offset)];
}

function addFakeCommentCandidatesFromFiles(
  selected: FakeCommentCandidate[],
  selectedAnchors: Set<string>,
  files: readonly FakeCommentFileCandidate[],
  seed: number,
  maxCount = Number.POSITIVE_INFINITY
): void {
  let fileOffset = 0;
  for (const file of files) {
    if (selected.length >= maxCount) {
      return;
    }

    const candidate = getFakeCommentCandidateForFile(
      file,
      seed + fileOffset,
      selectedAnchors
    );
    fileOffset++;
    if (candidate == null) {
      continue;
    }

    selected.push(candidate);
    selectedAnchors.add(getFakeCommentAnchorKey(candidate));
  }
}

interface FakeCommentCandidate {
  itemId: string;
  lineNumber: number;
  side: AnnotationSide;
}

function getFakeCommentCandidateForFile(
  file: FakeCommentFileCandidate,
  seed: number,
  selectedAnchors: ReadonlySet<string>
): FakeCommentCandidate | undefined {
  const startOffset = seed % file.availableLineCount;
  for (let offset = 0; offset < file.availableLineCount; offset++) {
    const candidate = getFakeCommentCandidateAtFileOffset(
      file,
      (startOffset + offset) % file.availableLineCount
    );
    if (
      candidate != null &&
      !selectedAnchors.has(getFakeCommentAnchorKey(candidate))
    ) {
      return candidate;
    }
  }
  return undefined;
}

function getFakeCommentCandidateAtFileOffset(
  file: FakeCommentFileCandidate,
  offset: number
): FakeCommentCandidate | undefined {
  let spanStartOffset = 0;
  for (const span of file.spans) {
    const spanEndOffset = spanStartOffset + span.availableLineCount;
    if (offset >= spanEndOffset) {
      spanStartOffset = spanEndOffset;
      continue;
    }

    const lineNumber = getAvailableLineAtOffset(span, offset - spanStartOffset);
    if (lineNumber == null) {
      return undefined;
    }

    return {
      itemId: file.itemId,
      lineNumber,
      side: span.side,
    };
  }
  return undefined;
}

function getFakeCommentAnchorKey(candidate: FakeCommentCandidate): string {
  return `${candidate.itemId}:${candidate.side}:${candidate.lineNumber}`;
}

function getAvailableLineAtOffset(
  span: FakeCommentSpan,
  offset: number
): number | undefined {
  let lineNumber = span.startLine + offset;
  for (const occupiedLine of span.occupiedLines) {
    if (occupiedLine > lineNumber) {
      break;
    }
    lineNumber++;
  }

  return lineNumber < span.startLine + span.lineCount ? lineNumber : undefined;
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
