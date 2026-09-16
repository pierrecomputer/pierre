import type { SelectedLineRange } from '@pierre/diffs';

import type {
  GitHubCodeComment,
  GitHubComments,
  GitHubUser,
} from './githubTypes';

/** Requests stay on Diffshub; only the server can read the OAuth cookie. */
export async function fetchGitHubJSON(
  url: string,
  init?: RequestInit
): Promise<{ data: unknown } | { error: string }> {
  try {
    const response = await fetch(url, { ...init, cache: 'no-store' });
    if (response.status === 204) return { data: null };
    const data: unknown = await response.json();
    if (!response.ok) {
      return {
        error:
          data != null &&
          typeof data === 'object' &&
          'error' in data &&
          typeof data.error === 'string'
            ? data.error
            : 'GitHub could not complete the request. Try again.',
      };
    }
    return { data };
  } catch {
    return {
      error: 'Could not reach GitHub. Check your connection and try again.',
    };
  }
}

/** Checks public identity data without accepting credentials from the response. */
export function parseGitHubUser(value: unknown): GitHubUser | undefined {
  if (
    value == null ||
    typeof value !== 'object' ||
    !('id' in value) ||
    typeof value.id !== 'number' ||
    !Number.isSafeInteger(value.id) ||
    value.id <= 0 ||
    !('login' in value) ||
    typeof value.login !== 'string' ||
    value.login.length === 0 ||
    !('avatarUrl' in value) ||
    typeof value.avatarUrl !== 'string'
  )
    return;
  const avatar = URL.parse(value.avatarUrl);
  if (
    avatar?.protocol !== 'https:' ||
    avatar.hostname !== 'avatars.githubusercontent.com'
  )
    return;
  return { id: value.id, login: value.login, avatarUrl: avatar.href };
}

/** Parses a published comment before its URL or anchor reaches the UI. */
export function parseGitHubCodeComment(
  value: unknown
): GitHubCodeComment | undefined {
  if (
    value == null ||
    typeof value !== 'object' ||
    !('id' in value) ||
    typeof value.id !== 'number' ||
    !Number.isSafeInteger(value.id) ||
    value.id <= 0 ||
    !('path' in value) ||
    typeof value.path !== 'string' ||
    !('body' in value) ||
    typeof value.body !== 'string' ||
    !('url' in value) ||
    typeof value.url !== 'string' ||
    !('canDelete' in value) ||
    typeof value.canDelete !== 'boolean' ||
    !('author' in value) ||
    !('anchor' in value) ||
    value.anchor == null ||
    typeof value.anchor !== 'object' ||
    !('kind' in value.anchor)
  )
    return;
  const url = URL.parse(value.url);
  if (url?.protocol !== 'https:' || url.hostname !== 'github.com') return;
  const author = value.author === null ? null : parseGitHubUser(value.author);
  if (author === undefined) return;
  const base = {
    id: value.id,
    path: value.path,
    body: value.body,
    url: url.href,
    author,
    canDelete: value.canDelete,
  };
  if (value.anchor.kind === 'file')
    return { ...base, anchor: { kind: 'file' } };
  if (value.anchor.kind !== 'line' || !('range' in value.anchor)) return;
  const range = parseRange(value.anchor.range);
  return range == null
    ? undefined
    : { ...base, anchor: { kind: 'line', range } };
}

/** Rejects partial or malformed comment lists rather than showing missing data. */
export function parseGitHubComments(
  value: unknown
): GitHubComments | undefined {
  if (
    value == null ||
    typeof value !== 'object' ||
    !('commitId' in value) ||
    typeof value.commitId !== 'string' ||
    !/^[a-f0-9]{40}$/i.test(value.commitId) ||
    !('comments' in value) ||
    !Array.isArray(value.comments)
  )
    return;
  const comments: GitHubCodeComment[] = [];
  for (const entry of value.comments) {
    const comment = parseGitHubCodeComment(entry);
    if (comment == null) return;
    comments.push(comment);
  }
  return { commitId: value.commitId, comments };
}

function parseRange(value: unknown): SelectedLineRange | undefined {
  if (
    value == null ||
    typeof value !== 'object' ||
    !('start' in value) ||
    typeof value.start !== 'number' ||
    !Number.isSafeInteger(value.start) ||
    value.start <= 0 ||
    !('end' in value) ||
    typeof value.end !== 'number' ||
    !Number.isSafeInteger(value.end) ||
    value.end <= 0 ||
    !('side' in value) ||
    (value.side !== 'additions' && value.side !== 'deletions')
  )
    return;
  const endSide = 'endSide' in value ? value.endSide : value.side;
  if (endSide !== 'additions' && endSide !== 'deletions') return;
  return { start: value.start, end: value.end, side: value.side, endSide };
}
