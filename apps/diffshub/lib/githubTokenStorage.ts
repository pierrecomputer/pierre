// Storage codec for the user's GitHub PAT. The token is persisted in
// localStorage as a versioned JSON envelope that records what the token is
// allowed to do ('read' views private diffs; 'read-write' can also post
// comments). Legacy entries were the bare token string — those parse as
// read-only since that is all the app ever asked those tokens to grant.

export const GITHUB_TOKEN_STORAGE_KEY = 'diffshub.github.token';

export type GitHubTokenCapability = 'read' | 'read-write';

export interface StoredGitHubAuth {
  capability: GitHubTokenCapability;
  savedAt?: string;
  token: string;
}

// Parses a raw localStorage value into auth state. Returns undefined for
// empty/corrupt values so callers fall back to "no token". GitHub tokens
// (ghp_/github_pat_/legacy hex) never start with '{', which makes the
// envelope-vs-legacy check unambiguous.
export function parseStoredGitHubAuth(
  raw: string | null
): StoredGitHubAuth | undefined {
  if (raw == null || raw === '') {
    return undefined;
  }
  if (!raw.startsWith('{')) {
    return { capability: 'read', token: raw };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed == null) {
    return undefined;
  }
  const record = parsed as Record<string, unknown>;
  const token = typeof record.token === 'string' ? record.token.trim() : '';
  if (token === '') {
    return undefined;
  }
  return {
    capability: record.capability === 'read-write' ? 'read-write' : 'read',
    savedAt: typeof record.savedAt === 'string' ? record.savedAt : undefined,
    token,
  };
}

export function serializeStoredGitHubAuth(auth: StoredGitHubAuth): string {
  return JSON.stringify({
    capability: auth.capability,
    savedAt: auth.savedAt,
    token: auth.token,
    version: 1,
  });
}

// Equality over the fields that affect behavior; used to dedupe sync events
// between hook instances. savedAt participates so re-saving the same token
// still counts as a change (it re-triggers loads, matching the old behavior
// of bumping the version on every save).
export function isSameStoredGitHubAuth(
  a: StoredGitHubAuth | undefined,
  b: StoredGitHubAuth | undefined
): boolean {
  if (a == null || b == null) {
    return a == null && b == null;
  }
  return (
    a.capability === b.capability &&
    a.savedAt === b.savedAt &&
    a.token === b.token
  );
}
