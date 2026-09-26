'use client';

import { useSyncExternalStore } from 'react';

const GITHUB_TOKEN_STORAGE_KEY = 'diffshub.github.token';

export interface GitHubTokenState {
  clearToken(): void;
  hasToken: boolean;
  setToken(token: string): void;
  token: string;
  tokenVersion: number;
}

// The token as every subscriber sees it. `tokenVersion` increments on each
// write so loaders can re-run when the token changes, including a write of the
// same string.
interface TokenSnapshot {
  token: string;
  tokenVersion: number;
}

const SERVER_SNAPSHOT: TokenSnapshot = { token: '', tokenVersion: 0 };

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
    const token = readStoredToken();
    snapshot = { token, tokenVersion: token === '' ? 0 : 1 };
  }
  return snapshot;
}

function getServerSnapshot(): TokenSnapshot {
  return SERVER_SNAPSHOT;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function setToken(nextToken: string): void {
  const token = nextToken.trim();
  snapshot = { token, tokenVersion: getSnapshot().tokenVersion + 1 };
  writeStoredToken(token);
  for (const listener of listeners) {
    listener();
  }
}

function clearToken(): void {
  setToken('');
}

export function useGitHubToken(): GitHubTokenState {
  const { token, tokenVersion } = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot
  );
  return {
    clearToken,
    hasToken: token !== '',
    setToken,
    token,
    tokenVersion,
  };
}

function readStoredToken(): string {
  try {
    return globalThis.localStorage?.getItem(GITHUB_TOKEN_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

function writeStoredToken(token: string): void {
  try {
    if (token === '') {
      globalThis.localStorage?.removeItem(GITHUB_TOKEN_STORAGE_KEY);
    } else {
      globalThis.localStorage?.setItem(GITHUB_TOKEN_STORAGE_KEY, token);
    }
  } catch {
    // Browsers can disable storage; in-memory state still works for the page.
  }
}
