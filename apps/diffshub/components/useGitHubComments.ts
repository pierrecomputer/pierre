'use client';

import type { DiffLineAnnotation } from '@pierre/diffs';
import { type CodeViewHandle, useStableCallback } from '@pierre/diffs/react';
import { type RefObject, useEffect, useMemo, useState } from 'react';

import { classifyCommentLineType } from '@/lib/classifyCommentLineType';
import {
  fetchGitHubJSON,
  parseGitHubCodeComment,
  parseGitHubComments,
} from '@/lib/githubClient';
import type {
  GitHubCodeComment,
  GitHubCommentAnchor,
  GitHubComments,
} from '@/lib/githubTypes';
import type {
  CommentMetadata,
  DiffsHubCommentFileByItemId,
  DiffsHubCommentSidebarFile,
  DiffsHubSavedCommentItem,
} from '@/lib/types';

const EMPTY_COMMENTS: GitHubCodeComment[] = [];
type CommentsState =
  | { key: string; kind: 'error'; error: string }
  | { key: string; kind: 'ready'; data: GitHubComments };

/** Writes are explicit and never retried; a failed post keeps the draft intact. */
export interface GitHubCommentControls {
  comments: readonly GitHubCodeComment[];
  ready: boolean;
  error: string | null;
  create(
    filePath: string,
    anchor: GitHubCommentAnchor,
    body: string
  ): Promise<string | undefined>;
  remove(id: number): Promise<string | undefined>;
}

/** Loads GitHub as the source of truth and updates the imperative code viewer. */
export function useGitHubComments({
  path,
  commitId,
  userId,
  viewerKey,
  files,
  viewerRef,
}: {
  path: string;
  commitId: string | null;
  userId: number | undefined;
  viewerKey: number;
  files: DiffsHubCommentFileByItemId | null;
  viewerRef: RefObject<CodeViewHandle<CommentMetadata, undefined> | null>;
}): GitHubCommentControls & {
  sections: DiffsHubSavedCommentItem[];
  sync(): void;
} {
  const key = `${path}:${commitId ?? ''}:${userId ?? ''}:${viewerKey}`;
  const [state, setState] = useState<CommentsState | null>(null);
  const active = state?.key === key ? state : null;
  const data = active?.kind === 'ready' ? active.data : null;
  const comments = data?.comments ?? EMPTY_COMMENTS;
  const ready = data != null && commitId != null && data.commitId === commitId;
  const error =
    active?.kind === 'error'
      ? active.error
      : data != null && !ready
        ? 'The code changed on GitHub. Reload the diff before commenting.'
        : null;

  useEffect(() => {
    if (userId == null || commitId == null) return;
    const controller = new AbortController();
    void fetchGitHubJSON(
      `/api/github-comments?${new URLSearchParams({ path })}`,
      { signal: controller.signal }
    ).then((result) => {
      if (controller.signal.aborted) return;
      if ('error' in result) {
        setState({ key, kind: 'error', error: result.error });
        return;
      }
      const parsed = parseGitHubComments(result.data);
      setState(
        parsed == null
          ? {
              key,
              kind: 'error',
              error: 'Could not read GitHub comments. Reload to try again.',
            }
          : { key, kind: 'ready', data: parsed }
      );
    });
    return () => controller.abort();
  }, [commitId, key, path, userId]);

  const sections = useMemo(() => {
    const byPath = new Map<string, DiffsHubSavedCommentItem>();
    const fileByPath = new Map<
      string,
      { itemId: string; file: DiffsHubCommentSidebarFile }
    >();
    for (const [itemId, file] of files ?? [])
      fileByPath.set(file.path, { itemId, file });
    for (const comment of comments) {
      const match = fileByPath.get(comment.path);
      if (match == null) continue;
      let section = byPath.get(comment.path);
      if (section == null) {
        section = {
          itemId: match.itemId,
          fileOrder: match.file.fileOrder,
          path: comment.path,
          comments: [],
        };
        byPath.set(comment.path, section);
      }
      const range =
        comment.anchor.kind === 'line' ? comment.anchor.range : null;
      section.comments.push({
        itemId: match.itemId,
        comment,
        lineType:
          range == null
            ? 'context'
            : classifyCommentLineType(
                match.file.fileDiff,
                range.endSide ?? range.side ?? 'additions',
                range.end
              ),
      });
    }
    return [...byPath.values()].sort((a, b) => a.fileOrder - b.fileOrder);
  }, [comments, files]);

  const sync = useStableCallback(() => {
    const viewer = viewerRef.current;
    if (viewer == null || files == null) return;
    const byItem = new Map(
      sections.map((section) => [section.itemId, section.comments])
    );
    for (const itemId of files.keys()) {
      const item = viewer.getItem(itemId);
      if (item?.type !== 'diff') continue;
      const entries = byItem.get(itemId) ?? [];
      if (
        entries.length === 0 &&
        item.annotations?.some(
          (annotation) => annotation.metadata.kind === 'saved'
        ) !== true
      )
        continue;
      const annotations: DiffLineAnnotation<CommentMetadata>[] = (
        item.annotations ?? []
      ).filter((annotation) => annotation.metadata.kind === 'draft');
      for (const { comment } of entries) {
        if (comment.anchor.kind !== 'line') continue;
        const { range } = comment.anchor;
        annotations.push({
          side: range.endSide ?? range.side ?? 'additions',
          lineNumber: range.end,
          metadata: {
            kind: 'saved',
            key: `github-${comment.id}`,
            range,
            comment,
          },
        });
      }
      item.annotations = annotations;
      item.version = typeof item.version === 'number' ? item.version + 1 : 1;
      viewer.updateItem(item);
    }
  });

  useEffect(sync, [sync, sections, viewerKey]);

  async function create(
    filePath: string,
    anchor: GitHubCommentAnchor,
    body: string
  ) {
    if (!ready) return error ?? 'Sign in and wait for GitHub comments to load.';
    const result = await fetchGitHubJSON('/api/github-comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, commitId, filePath, body, anchor }),
    });
    if ('error' in result) return result.error;
    const comment = parseGitHubCodeComment(result.data);
    if (comment == null)
      return 'GitHub may have saved the comment, but the response could not be read. Check GitHub before posting again.';
    setState((previous) =>
      previous?.key === key && previous.kind === 'ready'
        ? {
            ...previous,
            data: {
              ...previous.data,
              comments: [
                ...previous.data.comments.filter(
                  (entry) => entry.id !== comment.id
                ),
                comment,
              ],
            },
          }
        : previous
    );
    return undefined;
  }

  async function remove(id: number) {
    const result = await fetchGitHubJSON(
      `/api/github-comments?${new URLSearchParams({ path, id: String(id) })}`,
      { method: 'DELETE' }
    );
    if ('error' in result) return result.error;
    setState((previous) =>
      previous?.key === key && previous.kind === 'ready'
        ? {
            ...previous,
            data: {
              ...previous.data,
              comments: previous.data.comments.filter(
                (comment) => comment.id !== id
              ),
            },
          }
        : previous
    );
    return undefined;
  }

  return { comments, ready, error, create, remove, sections, sync };
}
