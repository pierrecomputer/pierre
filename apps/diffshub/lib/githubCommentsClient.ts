import {
  type GitHubCommentWire,
  isGitHubCommentWire,
  type PostGitHubCommentRequest,
} from './githubComments';

// Error carrying the proxy response status so callers can react to specific
// failures: 403 means the token lacks write permission (drives the stored
// capability downgrade), 429 means rate limited.
export class GitHubCommentPostError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// Posts a comment or reply through the same-origin /api/github-comments
// proxy and returns the created comment.
export async function postGitHubCommentRequest(
  path: string,
  token: string,
  request: PostGitHubCommentRequest
): Promise<GitHubCommentWire> {
  const params = new URLSearchParams({ path });
  const response = await fetch(`/api/github-comments?${params.toString()}`, {
    body: JSON.stringify(request),
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
  const data: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const message =
      typeof data === 'object' &&
      data != null &&
      typeof (data as Record<string, unknown>).error === 'string'
        ? ((data as Record<string, unknown>).error as string)
        : `Posting the comment failed (${response.status}).`;
    throw new GitHubCommentPostError(message, response.status);
  }
  if (!isGitHubCommentWire(data)) {
    throw new GitHubCommentPostError(
      'GitHub returned an unexpected comment shape.',
      502
    );
  }
  return data;
}
