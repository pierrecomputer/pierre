import type { AnnotationSide } from '@pierre/diffs';

// Wire model for GitHub comments as served by /api/github-comments. The
// server normalizes GitHub's REST payloads into this shape so the client
// never handles raw GitHub JSON.

export type GitHubCommentSide = 'LEFT' | 'RIGHT';

export interface GitHubCommentAuthor {
  avatarUrl?: string;
  login: string;
}

export interface GitHubCommentWire {
  author: GitHubCommentAuthor;
  body: string;
  createdAt?: string;
  htmlUrl?: string;
  id: number;
  inReplyToId?: number;
  // Line in the current head diff; absent when the comment is outdated
  // (anchored to an older commit of the PR).
  line?: number;
  // Line the comment was originally left on; the only anchor an outdated
  // comment still has.
  originalLine?: number;
  path: string;
  side?: GitHubCommentSide;
  startLine?: number;
  startSide?: GitHubCommentSide;
  subjectType: 'file' | 'line';
}

export interface GitHubCommentsPayload {
  comments: GitHubCommentWire[];
  // Pull sources only: the head commit id, required later to post comments.
  headSha?: string;
  // True when the source had more comments than the server-side page cap.
  truncated: boolean;
}

export interface GitHubCommentThread {
  replies: GitHubCommentWire[];
  root: GitHubCommentWire;
}

// GitHub anchors review comments to the LEFT (old) or RIGHT (new) version of
// a file; the diff viewer calls the same columns deletions/additions.
export function mapGitHubCommentSide(
  side: GitHubCommentSide | undefined
): AnnotationSide {
  return side === 'LEFT' ? 'deletions' : 'additions';
}

// Groups a flat comment list into threads. GitHub returns review comments in
// ascending id (chronological) order, and a reply references an earlier
// comment via inReplyToId — usually the thread root, but chains are tolerated
// by indexing every seen comment. A reply whose parent is missing (e.g.
// dropped by the server page cap) is promoted to a thread root so no comment
// silently disappears.
export function groupGitHubCommentThreads(
  comments: readonly GitHubCommentWire[]
): GitHubCommentThread[] {
  const threads: GitHubCommentThread[] = [];
  const threadByCommentId = new Map<number, GitHubCommentThread>();
  for (const comment of comments) {
    const parentThread =
      comment.inReplyToId == null
        ? undefined
        : threadByCommentId.get(comment.inReplyToId);
    if (parentThread == null) {
      const thread: GitHubCommentThread = { replies: [], root: comment };
      threads.push(thread);
      threadByCommentId.set(comment.id, thread);
    } else {
      parentThread.replies.push(comment);
      threadByCommentId.set(comment.id, parentThread);
    }
  }
  return threads;
}
