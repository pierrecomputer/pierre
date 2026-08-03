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

// The auth as every subscriber sees it. `tokenVersion` increments on each
// write so loaders can re-run when the token changes, including a write of the
// same string.
interface TokenSnapshot {
  auth: StoredGitHubAuth | undefined;
  tokenVersion: number;
}

const SERVER_SNAPSHOT: TokenSnapshot = { auth: undefined, tokenVersion: 0 };

// Module-level store for the optional user-provided GitHub token. Every
// `useGitHubToken` instance subscribes here, so the home form and the review UI
// stay in sync without prop threading. The value lives in memory for the page
// and is mirrored to localStorage; storage is read once, on the first client
// snapshot, so a browser with storage disabled still has a working in-memory
// token. The token is not sent anywhere until the loader explicitly reads it.
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

// Applies changes from other tabs without writing them back to storage.
function handleStorage(event: StorageEvent): void {
  if (event.key == null || event.key === GITHUB_TOKEN_STORAGE_KEY) {
    const auth = readStoredAuth();
    const previous = getSnapshot();
    if (!isSameStoredGitHubAuth(previous.auth, auth)) {
      // Capability only gates posting UI; changing it alone must not refetch.
      const tokenChanged =
        previous.auth?.token !== auth?.token ||
        previous.auth?.savedAt !== auth?.savedAt;
      updateAuth(auth, previous.tokenVersion + (tokenChanged ? 1 : 0));
    }
  }
}

// Publishes auth and its loader version together to all mounted consumers.
function updateAuth(
  auth: StoredGitHubAuth | undefined,
  tokenVersion: number
): void {
  snapshot = { auth, tokenVersion };
  for (const listener of listeners) {
    listener();
  }
}

function setToken(
  nextToken: string,
  nextCapability: GitHubTokenCapability
): void {
  const token = nextToken.trim();
  const auth =
    token === ''
      ? undefined
      : {
          capability: nextCapability,
          savedAt: new Date().toISOString(),
          token,
        };
  updateAuth(auth, getSnapshot().tokenVersion + 1);
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
  return {
    capability: auth?.capability ?? 'read',
    clearToken,
    hasToken: auth != null,
    setToken,
    token: auth?.token,
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
