import type { AnnotationSide } from '@pierre/diffs';

// Wire model for GitHub comments as served by /api/github-comments. The
// server normalizes GitHub's REST payloads into this shape so the client
// never handles raw GitHub JSON.

export type GitHubCommentSide = 'LEFT' | 'RIGHT';

// GitHub's user objects use `login` for the @-handle; deleted accounts are
// normalized to 'ghost', mirroring GitHub's own rendering.
export interface GitHubCommentUser {
  avatarUrl?: string;
  login: string;
}

export interface GitHubCommentWire {
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
  user: GitHubCommentUser;
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

// Body of a POST /api/github-comments request: either a new review comment
// anchored to a line (or line range) of the pull's head diff, or a reply to
// an existing thread. The pull request itself is addressed by the `path`
// query parameter, like the GET.
export type PostGitHubCommentRequest =
  | { kind: 'reply'; body: string; commentId: number }
  | {
      kind: 'comment';
      body: string;
      commitId: string;
      filePath: string;
      line: number;
      side: GitHubCommentSide;
      startLine?: number;
      startSide?: GitHubCommentSide;
    };

// GitHub anchors review comments to the LEFT (old) or RIGHT (new) version of
// a file; the diff viewer calls the same columns deletions/additions.
export function mapGitHubCommentSide(
  side: GitHubCommentSide | undefined
): AnnotationSide {
  return side === 'LEFT' ? 'deletions' : 'additions';
}

export function mapAnnotationSideToGitHub(
  side: AnnotationSide
): GitHubCommentSide {
  return side === 'deletions' ? 'LEFT' : 'RIGHT';
}

// Guards the wire-comment fields client code dereferences. Payloads come from
// our own same-origin route, so this intentionally checks only what is used
// rather than re-validating every property the server already normalized.
export function isGitHubCommentWire(
  value: unknown
): value is GitHubCommentWire {
  if (typeof value !== 'object' || value == null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const user = record.user as Record<string, unknown> | undefined;
  return (
    typeof record.id === 'number' &&
    typeof record.path === 'string' &&
    typeof record.body === 'string' &&
    typeof user === 'object' &&
    user != null &&
    typeof user.login === 'string'
  );
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
