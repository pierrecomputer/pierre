'use client';

import type { DiffLineAnnotation } from '@pierre/diffs';
import type { CodeViewHandle } from '@pierre/diffs/react';
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from 'react';

import { classifyCommentLineType } from '@/lib/classifyCommentLineType';
import {
  type GitHubCommentsPayload,
  type GitHubCommentThread,
  type GitHubCommentWire,
  groupGitHubCommentThreads,
  mapGitHubCommentSide,
} from '@/lib/githubComments';
import type {
  CommentMetadata,
  DiffsHubCommentFileByItemId,
  DiffsHubCommentSidebarFile,
  DiffsHubFileTreeSource,
  DiffsHubSavedCommentEntry,
  DiffsHubSavedCommentItem,
  ViewerLoadState,
} from '@/lib/types';
import { upsertSavedCommentSidebarEntry } from '@/lib/upsertSavedCommentSidebarEntry';

interface UseGitHubCommentsOptions {
  commentFileByItemId: DiffsHubCommentFileByItemId | null;
  domain?: string;
  getToken(): string | undefined;
  loadState: ViewerLoadState;
  path: string;
  setCommentSections: Dispatch<SetStateAction<DiffsHubSavedCommentItem[]>>;
  tokenVersion: number;
  treeSource: DiffsHubFileTreeSource | null;
  viewerRef: RefObject<CodeViewHandle<CommentMetadata> | null>;
}

interface UseGitHubCommentsResult {
  commentsError: string | undefined;
  payload: GitHubCommentsPayload | undefined;
}

// One thread mapped onto the rendered diff: the sidebar row plus, when the
// thread anchors to a visible line or a whole file, the inline annotation.
interface MappedGitHubThreadView {
  annotationsByItemId: ReadonlyMap<
    string,
    DiffLineAnnotation<CommentMetadata>[]
  >;
  sections: DiffsHubSavedCommentItem[];
}

// Loads the GitHub comments for the viewed source through the same-origin
// /api/github-comments proxy, renders each thread as an inline annotation,
// and feeds the sidebar's comments list. Fetching starts immediately, but
// applying waits until the patch loader reports 'ready' — items stream in
// incrementally and item ids can be renamed mid-stream, so anchoring against
// a half-built view is unsafe. A comments failure never blocks the diff
// itself; the error is only surfaced through the returned state.
export function useGitHubComments({
  commentFileByItemId,
  domain,
  getToken,
  loadState,
  path,
  setCommentSections,
  tokenVersion,
  treeSource,
  viewerRef,
}: UseGitHubCommentsOptions): UseGitHubCommentsResult {
  const [payload, setPayload] = useState<GitHubCommentsPayload>();
  const [commentsError, setCommentsError] = useState<string>();
  // Item ids that currently carry GitHub annotations, so a re-apply (e.g.
  // after a token change refetch) can clear annotations from items whose
  // threads disappeared.
  const annotatedItemIdsRef = useRef<ReadonlySet<string>>(new Set());

  useEffect(() => {
    setPayload(undefined);
    setCommentsError(undefined);
    // Non-GitHub sources (tangled.org etc.) have no GitHub comments and must
    // never see the PAT, mirroring the patch loader's domain gate.
    if (domain != null) {
      return;
    }
    const controller = new AbortController();
    const load = async () => {
      try {
        const params = new URLSearchParams({ path });
        const response = await fetch(
          `/api/github-comments?${params.toString()}`,
          createCommentsRequestInit(controller.signal, getToken())
        );
        const data: unknown = await response.json();
        if (!response.ok) {
          throw new Error(
            isRecord(data) && typeof data.error === 'string'
              ? data.error
              : `GitHub comments request failed (${response.status}).`
          );
        }
        setPayload(normalizeCommentsPayload(data));
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        setCommentsError(
          error instanceof Error
            ? error.message
            : 'Failed to load GitHub comments.'
        );
      }
    };
    void load();
    return () => controller.abort();
  }, [domain, getToken, path, tokenVersion]);

  useEffect(() => {
    if (payload == null || loadState !== 'ready' || treeSource == null) {
      return;
    }
    const viewer = viewerRef.current;
    const { annotationsByItemId, sections } = mapGitHubThreads(
      groupGitHubCommentThreads(payload.comments),
      treeSource.pathToItemId,
      commentFileByItemId,
      viewer
    );
    if (viewer != null) {
      annotatedItemIdsRef.current = applyGitHubAnnotations(
        viewer,
        annotationsByItemId,
        annotatedItemIdsRef.current
      );
    }
    setCommentSections((previous) =>
      restoreLocalEntries(sections, previous, commentFileByItemId)
    );
  }, [
    commentFileByItemId,
    loadState,
    payload,
    setCommentSections,
    treeSource,
    viewerRef,
  ]);

  return { commentsError, payload };
}

// Converts GitHub comment threads into inline annotations plus the sidebar's
// per-file sections. One entry/annotation represents a whole thread, anchored
// where its root comment is:
// - current-line threads render inline and select their range on click;
// - file-level threads render as a lineNumber-0 annotation above the file;
// - outdated threads (no line in the head diff) are sidebar-only;
// - threads on files outside the rendered diff are dropped entirely.
function mapGitHubThreads(
  threads: readonly GitHubCommentThread[],
  pathToItemId: ReadonlyMap<string, string>,
  commentFileByItemId: DiffsHubCommentFileByItemId | null,
  viewer: CodeViewHandle<CommentMetadata> | null
): MappedGitHubThreadView {
  interface SectionAccumulator {
    comments: DiffsHubSavedCommentEntry[];
    file: DiffsHubCommentSidebarFile;
  }
  const sectionsByItemId = new Map<string, SectionAccumulator>();
  const annotationsByItemId = new Map<
    string,
    DiffLineAnnotation<CommentMetadata>[]
  >();

  const pushEntry = (itemId: string, entry: DiffsHubSavedCommentEntry) => {
    const section = sectionsByItemId.get(itemId);
    if (section != null) {
      section.comments.push(entry);
    }
  };
  const pushAnnotation = (
    itemId: string,
    annotation: DiffLineAnnotation<CommentMetadata>
  ) => {
    const annotations = annotationsByItemId.get(itemId);
    if (annotations == null) {
      annotationsByItemId.set(itemId, [annotation]);
    } else {
      annotations.push(annotation);
    }
  };

  for (const thread of threads) {
    const { root } = thread;
    const itemId = pathToItemId.get(root.path);
    const file = itemId == null ? null : commentFileByItemId?.get(itemId);
    if (itemId == null || file == null) {
      continue;
    }
    if (!sectionsByItemId.has(itemId)) {
      sectionsByItemId.set(itemId, { comments: [], file });
    }

    const key = `gh-${root.id}`;
    const side = mapGitHubCommentSide(root.side);
    const shared = {
      author: root.author.login,
      avatarUrl: root.author.avatarUrl,
      itemId,
      key,
      message: root.body,
      replyCount: thread.replies.length,
      side,
      thread,
    };

    if (root.subjectType === 'file') {
      pushEntry(itemId, {
        ...shared,
        anchor: 'file',
        lineNumber: 0,
        lineType: 'context',
        range: { start: 0, end: 0 },
      });
      pushAnnotation(itemId, {
        side,
        lineNumber: 0,
        metadata: { kind: 'github', key, thread },
      });
      continue;
    }

    if (root.line == null) {
      const lineNumber = root.originalLine ?? 0;
      pushEntry(itemId, {
        ...shared,
        anchor: 'outdated',
        lineNumber,
        lineType: 'context',
        range: { start: lineNumber, end: lineNumber },
      });
      continue;
    }

    const range = {
      start: root.startLine ?? root.line,
      side: mapGitHubCommentSide(root.startSide ?? root.side),
      end: root.line,
      endSide: side,
    };
    const item = viewer?.getItem(itemId);
    pushEntry(itemId, {
      ...shared,
      lineNumber: root.line,
      lineType:
        item?.type === 'diff'
          ? classifyCommentLineType(item.fileDiff, side, root.line)
          : 'change',
      range,
    });
    pushAnnotation(itemId, {
      side,
      lineNumber: root.line,
      metadata: { kind: 'github', key, range, thread },
    });
  }

  const sections: DiffsHubSavedCommentItem[] = [];
  for (const [itemId, { comments, file }] of sectionsByItemId) {
    if (comments.length === 0) {
      continue;
    }
    comments.sort((a, b) => a.lineNumber - b.lineNumber);
    sections.push({
      comments,
      fileOrder: file.fileOrder,
      itemId,
      path: file.path,
    });
  }
  sections.sort((a, b) => a.fileOrder - b.fileOrder);
  return { annotationsByItemId, sections };
}

// Replaces the GitHub-derived annotations on viewer items with the freshly
// mapped set, leaving local draft/saved annotations untouched. Items that had
// GitHub annotations in the previous apply but not in this one are cleared.
// Returns the item ids that now carry GitHub annotations.
function applyGitHubAnnotations(
  viewer: CodeViewHandle<CommentMetadata>,
  annotationsByItemId: ReadonlyMap<
    string,
    DiffLineAnnotation<CommentMetadata>[]
  >,
  previouslyAnnotatedItemIds: ReadonlySet<string>
): ReadonlySet<string> {
  for (const [itemId, annotations] of annotationsByItemId) {
    setGitHubAnnotationsOnItem(viewer, itemId, annotations);
  }
  for (const itemId of previouslyAnnotatedItemIds) {
    if (!annotationsByItemId.has(itemId)) {
      setGitHubAnnotationsOnItem(viewer, itemId, undefined);
    }
  }
  return new Set(annotationsByItemId.keys());
}

function setGitHubAnnotationsOnItem(
  viewer: CodeViewHandle<CommentMetadata>,
  itemId: string,
  annotations: readonly DiffLineAnnotation<CommentMetadata>[] | undefined
): void {
  const item = viewer.getItem(itemId);
  if (item == null || item.type !== 'diff') {
    return;
  }
  const localAnnotations = (item.annotations ?? []).filter(
    (annotation) => annotation.metadata.kind !== 'github'
  );
  const nextAnnotations =
    annotations == null
      ? localAnnotations
      : [...localAnnotations, ...annotations];
  if (nextAnnotations.length === 0 && (item.annotations?.length ?? 0) === 0) {
    return;
  }
  item.annotations = nextAnnotations;
  item.version = typeof item.version === 'number' ? item.version + 1 : 1;
  viewer.updateItem(item);
}

// Re-applies locally created comments on top of freshly mapped GitHub
// sections so a refetch (e.g. after a token change) does not wipe comments
// the user added in this session. GitHub-derived entries are recognizable by
// their `gh-` key prefix.
function restoreLocalEntries(
  githubSections: DiffsHubSavedCommentItem[],
  previousSections: readonly DiffsHubSavedCommentItem[],
  commentFileByItemId: DiffsHubCommentFileByItemId | null
): DiffsHubSavedCommentItem[] {
  let next = githubSections;
  for (const section of previousSections) {
    for (const entry of section.comments) {
      if (entry.key.startsWith('gh-')) {
        continue;
      }
      next = upsertSavedCommentSidebarEntry(next, commentFileByItemId, entry);
    }
  }
  return next;
}

function normalizeCommentsPayload(data: unknown): GitHubCommentsPayload {
  if (!isRecord(data) || !Array.isArray(data.comments)) {
    throw new Error('DiffsHub GitHub comments response was malformed.');
  }
  return {
    comments: data.comments.filter(isWireComment),
    headSha: typeof data.headSha === 'string' ? data.headSha : undefined,
    truncated: data.truncated === true,
  };
}

// The payload comes from our own same-origin route, so this only guards the
// fields the mapping above dereferences rather than re-validating every
// property the server already normalized.
function isWireComment(value: unknown): value is GitHubCommentWire {
  return (
    isRecord(value) &&
    typeof value.id === 'number' &&
    typeof value.path === 'string' &&
    typeof value.body === 'string' &&
    isRecord(value.author) &&
    typeof value.author.login === 'string'
  );
}

function createCommentsRequestInit(
  signal: AbortSignal,
  token: string | undefined
): RequestInit {
  const normalizedToken = token?.trim();
  if (normalizedToken == null || normalizedToken === '') {
    return { cache: 'no-store', signal };
  }
  return {
    cache: 'no-store',
    headers: { Authorization: `Bearer ${normalizedToken}` },
    signal,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
