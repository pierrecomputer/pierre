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
  CommentLineType,
  CommentMetadata,
  DiffsHubCommentFileByItemId,
  DiffsHubDeletedCommentEvent,
  DiffsHubFileTreeSource,
  DiffsHubSavedCommentEntry,
  DiffsHubSavedCommentEvent,
  DiffsHubSavedCommentItem,
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

function insertCommentInLineOrder(
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

// Returns a filtered copy of the source keeping only paths whose effective git
// status is in `selectedStatuses`. An empty selection means "no filter" and
// returns the source unchanged (all paths shown). Paths absent from gitStatus
// are treated as 'modified' (the accumulator intentionally omits them so the
// tree renders them as the visual default). Patch order is preserved because
// the filtered `paths` keep their original relative order from the source.
export function filterDiffsHubFileTreeSource(
  source: DiffsHubFileTreeSource,
  selectedStatuses: ReadonlySet<GitStatus>
): DiffsHubFileTreeSource {
  if (selectedStatuses.size === 0) return source;

  const pathStatusMap = new Map<string, GitStatus>(
    source.gitStatus.map((e) => [e.path, e.status])
  );

  const filteredPaths = source.paths.filter((path) => {
    const status = pathStatusMap.get(path) ?? 'modified';
    return selectedStatuses.has(status);
  });

  const filteredGitStatus = source.gitStatus.filter((e) =>
    selectedStatuses.has(e.status)
  );

  const filteredPathToItemId = new Map<string, string>();
  for (const path of filteredPaths) {
    const id = source.pathToItemId.get(path);
    if (id != null) {
      filteredPathToItemId.set(path, id);
    }
  }

  return {
    gitStatus: filteredGitStatus,
    pathCount: filteredPaths.length,
    paths: filteredPaths,
    pathToItemId: filteredPathToItemId,
  };
}

// Returns the set of GitStatus values that are actually present in the source.
// Paths not listed in gitStatus are treated as 'modified'.
export function getDiffsHubFileTreeAvailableStatuses(
  source: DiffsHubFileTreeSource
): Set<GitStatus> {
  const statuses = new Set<GitStatus>(source.gitStatus.map((e) => e.status));
  const pathsWithExplicitStatus = new Set(source.gitStatus.map((e) => e.path));
  if (source.paths.some((p) => !pathsWithExplicitStatus.has(p))) {
    statuses.add('modified');
  }
  return statuses;
}

export function removeSavedCommentSidebarEntry(
  sections: readonly DiffsHubSavedCommentItem[],
  entry: DiffsHubDeletedCommentEvent
): DiffsHubSavedCommentItem[] {
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
