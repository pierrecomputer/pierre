'use client';

import { useSyncExternalStore } from 'react';

import {
  GITHUB_TOKEN_STORAGE_KEY,
  type GitHubTokenCapability,
  isSameStoredGitHubAuth,
  parseStoredGitHubAuth,
  serializeStoredGitHubAuth,
  type StoredGitHubAuth,
} from '@/lib/githubTokenStorage';

export interface GitHubTokenState {
  capability: GitHubTokenCapability;
  clearToken(): void;
  hasToken: boolean;
  setToken(token: string, capability: GitHubTokenCapability): void;
  token: string | undefined;
  tokenVersion: number;
}

// Every subscriber shares the auth and loader version. Explicit saves bump the
// version even when the token string is unchanged.
interface TokenSnapshot {
  auth: StoredGitHubAuth | undefined;
  tokenVersion: number;
}

const SERVER_SNAPSHOT: TokenSnapshot = { auth: undefined, tokenVersion: 0 };

// Keep auth in memory so all mounted forms stay in sync even when storage is
// disabled. Read storage on the first client snapshot; server rendering always
// uses the empty snapshot. The token is only sent when a loader reads it.
let snapshot: TokenSnapshot | undefined;
const listeners = new Set<() => void>();

function getSnapshot(): TokenSnapshot {
  if (snapshot == null) {
    const auth = readStoredAuth();
    snapshot = { auth, tokenVersion: auth == null ? 0 : 1 };
  }
  return snapshot;
}

function getServerSnapshot(): TokenSnapshot {
  return SERVER_SNAPSHOT;
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    window.addEventListener('storage', handleStorage);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener('storage', handleStorage);
    }
  };
}

// Apply cross-tab changes without writing them back or reloading unchanged auth.
function handleStorage(event: StorageEvent): void {
  if (event.key == null || event.key === GITHUB_TOKEN_STORAGE_KEY) {
    const auth = readStoredAuth();
    if (!isSameStoredGitHubAuth(getSnapshot().auth, auth)) {
      updateAuth(
        auth,
        auth?.token !== getSnapshot().auth?.token ||
          auth?.savedAt !== getSnapshot().auth?.savedAt
      );
    }
  }
}

// Capability-only sync updates posting UI without refetching every loader.
// Explicit saves still refresh loaders, including a repeated token string.
function updateAuth(
  auth: StoredGitHubAuth | undefined,
  refreshToken = true
): void {
  snapshot = {
    auth,
    tokenVersion: getSnapshot().tokenVersion + (refreshToken ? 1 : 0),
  };
  for (const listener of listeners) {
    listener();
  }
}

function setToken(nextToken: string, capability: GitHubTokenCapability): void {
  const token = nextToken.trim();
  const auth =
    token === ''
      ? undefined
      : { capability, savedAt: new Date().toISOString(), token };
  updateAuth(auth);
  writeStoredAuth(auth);
}

function clearToken(): void {
  setToken('', 'read');
}

export function useGitHubToken(): GitHubTokenState {
  const { auth, tokenVersion } = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot
  );
  const token = auth?.token;
  const capability = auth?.capability ?? 'read';
  return {
    capability,
    clearToken,
    hasToken: token != null,
    setToken,
    token,
    tokenVersion,
  };
}

function readStoredAuth(): StoredGitHubAuth | undefined {
  try {
    return parseStoredGitHubAuth(
      globalThis.localStorage?.getItem(GITHUB_TOKEN_STORAGE_KEY) ?? null
    );
  } catch {
    return undefined;
  }
}

function writeStoredAuth(auth: StoredGitHubAuth | undefined): void {
  try {
    if (auth == null) {
      globalThis.localStorage?.removeItem(GITHUB_TOKEN_STORAGE_KEY);
    } else {
      globalThis.localStorage?.setItem(
        GITHUB_TOKEN_STORAGE_KEY,
        serializeStoredGitHubAuth(auth)
      );
    }
  } catch {
    // Browsers can disable storage; in-memory state still works for the page.
  }
}
