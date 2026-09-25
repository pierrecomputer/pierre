import type {
  GitHubCommentSide,
  GitHubCommentsPayload,
  GitHubCommentUser,
  GitHubCommentWire,
  PostGitHubCommentRequest,
} from './githubComments';
import {
  encodeURLSegment,
  type GitHubDiffSource,
  type GitHubRepo,
} from './githubDiffSource';

const GITHUB_API_ROOT = 'https://api.github.com';
const GITHUB_API_VERSION = '2022-11-28';
// GitHub caps per_page at 100. Ten pages bounds a pathological source at
// 1,000 comments; the payload reports `truncated` instead of silently
// dropping the tail.
const COMMENTS_PER_PAGE = 100;
const MAX_COMMENT_PAGES = 10;

type GitHubServerFetch = (url: string, init: RequestInit) => Promise<Response>;

interface GitHubCommentsServerOptions {
  fetch?: GitHubServerFetch;
  token?: string;
}

// Error carrying an HTTP status the proxy route can pass back to the client,
// so failures stay actionable there: 403 drives the capability downgrade, 429
// distinguishes rate limiting from missing write permission.
export class GitHubCommentsRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// Fetches and normalizes the GitHub comments for a diff source. Pull sources
// return PR review comments plus the head sha (needed later to post new
// comments); commit sources return commit comments; compare views have no
// GitHub comment API and resolve empty. Without a caller token the server env
// token (if any) raises the anonymous rate limit for public sources.
export async function loadGitHubComments(
  source: GitHubDiffSource,
  options: GitHubCommentsServerOptions = {}
): Promise<GitHubCommentsPayload> {
  const fetcher = options.fetch ?? fetch;
  const token = options.token ?? getEnvGitHubToken();

  if (source.kind === 'compare') {
    return { comments: [], truncated: false };
  }

  if (source.kind === 'commit') {
    const { comments, truncated } = await fetchCommentPages(
      `${createRepoAPIRoot(source.repo)}/commits/${encodeURLSegment(source.sha)}/comments`,
      fetcher,
      token
    );
    return { comments, truncated };
  }

  const repoRoot = createRepoAPIRoot(source.repo);
  const pullNumber = encodeURLSegment(source.number);
  const [{ comments, truncated }, headSha] = await Promise.all([
    fetchCommentPages(
      `${repoRoot}/pulls/${pullNumber}/comments`,
      fetcher,
      token
    ),
    fetchPullHeadSha(`${repoRoot}/pulls/${pullNumber}`, fetcher, token),
  ]);
  return { comments, headSha, truncated };
}

// Creates a review comment or a thread reply on a pull request using the
// caller's token — posting never falls back to the server env token, because
// the server's identity must not author user comments.
export async function postGitHubComment(
  source: GitHubDiffSource,
  request: PostGitHubCommentRequest,
  options: { fetch?: GitHubServerFetch; token: string }
): Promise<GitHubCommentWire> {
  if (source.kind !== 'pull') {
    throw new GitHubCommentsRequestError(
      'Posting comments is only supported on pull requests.',
      400
    );
  }
  const fetcher = options.fetch ?? fetch;
  const repoRoot = createRepoAPIRoot(source.repo);
  const pullNumber = encodeURLSegment(source.number);
  const target =
    request.kind === 'reply'
      ? {
          url: `${repoRoot}/pulls/${pullNumber}/comments/${request.commentId}/replies`,
          payload: { body: request.body },
        }
      : {
          url: `${repoRoot}/pulls/${pullNumber}/comments`,
          payload: {
            body: request.body,
            commit_id: request.commitId,
            path: request.filePath,
            line: request.line,
            side: request.side,
            // GitHub rejects start_line == line; only send the start pair for
            // real multi-line ranges.
            ...(request.startLine != null && request.startLine !== request.line
              ? {
                  start_line: request.startLine,
                  start_side: request.startSide ?? request.side,
                }
              : {}),
          },
        };
  const response = await fetcher(target.url, {
    body: JSON.stringify(target.payload),
    cache: 'no-store',
    headers: {
      ...createGitHubJSONHeaders(options.token),
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });
  await assertGitHubResponseOK(response, `GitHub API ${target.url}`);
  const comment = normalizeGitHubComment(await response.json());
  if (comment == null) {
    throw new GitHubCommentsRequestError(
      'GitHub returned an unexpected comment shape.',
      502
    );
  }
  return comment;
}

// Resolves the identity (login + avatar) of the token's owner, so the
// posting UI can show who a comment will be authored as.
export async function loadGitHubTokenUser(options: {
  fetch?: GitHubServerFetch;
  token: string;
}): Promise<GitHubCommentUser> {
  const fetcher = options.fetch ?? fetch;
  const url = `${GITHUB_API_ROOT}/user`;
  const response = await fetcher(url, {
    cache: 'no-store',
    headers: createGitHubJSONHeaders(options.token),
  });
  await assertGitHubResponseOK(response, `GitHub API ${url}`);
  const data: unknown = await response.json();
  const login = isRecord(data) ? readString(data.login) : undefined;
  if (login == null) {
    throw new GitHubCommentsRequestError(
      'GitHub returned an unexpected user shape.',
      502
    );
  }
  return {
    avatarUrl: isRecord(data) ? readString(data.avatar_url) : undefined,
    login,
  };
}

// Validates an untrusted POST body into a PostGitHubCommentRequest, or
// undefined when the shape is unusable.
export function parsePostGitHubCommentRequest(
  data: unknown
): PostGitHubCommentRequest | undefined {
  if (!isRecord(data) || typeof data.body !== 'string') {
    return undefined;
  }
  const body = data.body.trim();
  if (body === '') {
    return undefined;
  }
  if (data.kind === 'reply') {
    return typeof data.commentId === 'number'
      ? { kind: 'reply', body, commentId: data.commentId }
      : undefined;
  }
  if (data.kind !== 'comment') {
    return undefined;
  }
  const side = readCommentSide(data.side);
  if (
    typeof data.commitId !== 'string' ||
    typeof data.filePath !== 'string' ||
    typeof data.line !== 'number' ||
    side == null
  ) {
    return undefined;
  }
  return {
    kind: 'comment',
    body,
    commitId: data.commitId,
    filePath: data.filePath,
    line: data.line,
    side,
    startLine: readNumber(data.startLine),
    startSide: readCommentSide(data.startSide),
  };
}

function createRepoAPIRoot(repo: GitHubRepo): string {
  return `${GITHUB_API_ROOT}/repos/${encodeURLSegment(repo.owner)}/${encodeURLSegment(repo.repo)}`;
}

async function fetchCommentPages(
  baseURL: string,
  fetcher: GitHubServerFetch,
  token: string | undefined
): Promise<{ comments: GitHubCommentWire[]; truncated: boolean }> {
  const comments: GitHubCommentWire[] = [];
  for (let page = 1; page <= MAX_COMMENT_PAGES; page++) {
    const url = `${baseURL}?per_page=${COMMENTS_PER_PAGE}&page=${page}`;
    const response = await fetcher(url, {
      cache: 'no-store',
      headers: createGitHubJSONHeaders(token),
    });
    await assertGitHubResponseOK(response, `GitHub API ${url}`);
    const data: unknown = await response.json();
    if (!Array.isArray(data)) {
      throw new Error(`GitHub API ${baseURL} returned an unexpected shape.`);
    }
    for (const entry of data) {
      const comment = normalizeGitHubComment(entry);
      if (comment != null) {
        comments.push(comment);
      }
    }
    // A short page means it was the last one. (A source whose total is an
    // exact multiple of the page size reads as truncated; that false positive
    // is harmless and avoids parsing Link headers.)
    if (data.length < COMMENTS_PER_PAGE) {
      return { comments, truncated: false };
    }
  }
  return { comments, truncated: true };
}

// The head sha only matters for posting comments later, so a failure here
// degrades to an undefined sha instead of failing the whole comments load.
async function fetchPullHeadSha(
  url: string,
  fetcher: GitHubServerFetch,
  token: string | undefined
): Promise<string | undefined> {
  try {
    const response = await fetcher(url, {
      cache: 'no-store',
      headers: createGitHubJSONHeaders(token),
    });
    await assertGitHubResponseOK(response, `GitHub API ${url}`);
    const data: unknown = await response.json();
    if (!isRecord(data) || !isRecord(data.head)) {
      return undefined;
    }
    return readString(data.head.sha);
  } catch {
    return undefined;
  }
}

// Normalizes one raw GitHub comment (PR review comment or commit comment)
// into the wire model. Comments without an id or a file path are dropped —
// path-less commit comments are commit-level discussion with no diff anchor,
// which is out of scope.
function normalizeGitHubComment(data: unknown): GitHubCommentWire | undefined {
  if (!isRecord(data)) {
    return undefined;
  }
  const id = readNumber(data.id);
  const path = readString(data.path);
  if (id == null || path == null) {
    return undefined;
  }
  const user = isRecord(data.user) ? data.user : undefined;
  return {
    body: typeof data.body === 'string' ? data.body : '',
    createdAt: readString(data.created_at),
    htmlUrl: readString(data.html_url),
    id,
    inReplyToId: readNumber(data.in_reply_to_id),
    line: readNumber(data.line),
    originalLine: readNumber(data.original_line),
    path,
    side: readCommentSide(data.side),
    startLine: readNumber(data.start_line),
    startSide: readCommentSide(data.start_side),
    subjectType: data.subject_type === 'file' ? 'file' : 'line',
    user: {
      avatarUrl: readString(user?.avatar_url),
      // GitHub renders deleted accounts as "ghost"; mirror that.
      login: readString(user?.login) ?? 'ghost',
    },
  };
}

function createGitHubJSONHeaders(
  token: string | undefined
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'pierre-diffshub',
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
  };
  if (token != null && token !== '') {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function assertGitHubResponseOK(
  response: Response,
  label: string
): Promise<void> {
  if (response.ok) {
    return;
  }

  const detail = (await response.text()).trim();
  if (isGitHubRateLimitResponse(response, detail)) {
    // 429 keeps rate limiting distinguishable from a 403 permission failure,
    // which the client reacts to by downgrading the stored capability.
    throw new GitHubCommentsRequestError(
      'GitHub rate limit exceeded. Add a GitHub token in DiffsHub settings to raise the limit.',
      429
    );
  }

  throw new GitHubCommentsRequestError(
    detail.length > 0
      ? `${label} failed (${response.status}): ${detail}`
      : `${label} failed (${response.status}).`,
    response.status
  );
}

function isGitHubRateLimitResponse(
  response: Response,
  detail: string
): boolean {
  if (response.status !== 403) {
    return false;
  }
  return (
    response.headers.get('x-ratelimit-remaining') === '0' ||
    /rate limit/i.test(detail)
  );
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function readCommentSide(value: unknown): GitHubCommentSide | undefined {
  return value === 'LEFT' || value === 'RIGHT' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getEnvGitHubToken(): string | undefined {
  return (
    process.env.DIFFSHUB_GITHUB_TOKEN ??
    process.env.GITHUB_TOKEN ??
    process.env.GH_TOKEN
  );
}
