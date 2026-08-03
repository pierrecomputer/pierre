'use client';

import type { CodeViewHandle } from '@pierre/diffs/react';
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useEffect,
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

// Loads the GitHub comments for the viewed source through the same-origin
// /api/github-comments proxy and feeds the anchorable threads into the
// comments sidebar. Fetching starts immediately, but applying waits until the
// patch loader reports 'ready' — items stream in incrementally and item ids
// can be renamed mid-stream, so anchoring against a half-built view is
// unsafe. A comments failure never blocks the diff itself; the error is only
// surfaced through the returned state.
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
    const githubSections = buildGitHubCommentSections(
      groupGitHubCommentThreads(payload.comments),
      treeSource.pathToItemId,
      commentFileByItemId,
      viewerRef.current
    );
    setCommentSections((previous) =>
      restoreLocalEntries(githubSections, previous, commentFileByItemId)
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

// Converts GitHub comment threads into the sidebar's per-file sections. One
// entry represents a whole thread, anchored where its root comment is.
// Threads that cannot be anchored are skipped for now: outdated comments (no
// current line), file-level comments, and comments on files that are not part
// of the rendered diff get their own UI in a later phase.
function buildGitHubCommentSections(
  threads: readonly GitHubCommentThread[],
  pathToItemId: ReadonlyMap<string, string>,
  commentFileByItemId: DiffsHubCommentFileByItemId | null,
  viewer: CodeViewHandle<CommentMetadata> | null
): DiffsHubSavedCommentItem[] {
  interface SectionAccumulator {
    comments: DiffsHubSavedCommentEntry[];
    file: DiffsHubCommentSidebarFile;
  }
  const sectionsByItemId = new Map<string, SectionAccumulator>();
  for (const thread of threads) {
    const { root } = thread;
    if (root.line == null || root.subjectType === 'file') {
      continue;
    }
    const itemId = pathToItemId.get(root.path);
    const file = itemId == null ? null : commentFileByItemId?.get(itemId);
    if (itemId == null || file == null) {
      continue;
    }
    const side = mapGitHubCommentSide(root.side);
    const item = viewer?.getItem(itemId);
    const entry: DiffsHubSavedCommentEntry = {
      author: root.author.login,
      avatarUrl: root.author.avatarUrl,
      itemId,
      key: `gh-${root.id}`,
      lineNumber: root.line,
      lineType:
        item?.type === 'diff'
          ? classifyCommentLineType(item.fileDiff, side, root.line)
          : 'change',
      message: root.body,
      range: {
        start: root.startLine ?? root.line,
        side: mapGitHubCommentSide(root.startSide ?? root.side),
        end: root.line,
        endSide: side,
      },
      side,
    };
    const section = sectionsByItemId.get(itemId);
    if (section == null) {
      sectionsByItemId.set(itemId, { comments: [entry], file });
    } else {
      section.comments.push(entry);
    }
  }

  const sections: DiffsHubSavedCommentItem[] = [];
  for (const [itemId, { comments, file }] of sectionsByItemId) {
    comments.sort((a, b) => a.lineNumber - b.lineNumber);
    sections.push({
      comments,
      fileOrder: file.fileOrder,
      itemId,
      path: file.path,
    });
  }
  sections.sort((a, b) => a.fileOrder - b.fileOrder);
  return sections;
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
// fields the mapping below dereferences rather than re-validating every
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
