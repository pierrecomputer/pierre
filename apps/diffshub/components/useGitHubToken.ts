'use client';

import { useCallback, useState, useSyncExternalStore } from 'react';

const GITHUB_TOKEN_STORAGE_KEY = 'diffshub.github.token';

export interface GitHubTokenState {
  clearToken(): void;
  hasToken: boolean;
  setToken(token: string): void;
  token: string;
  tokenVersion: number;
}

interface StoredTokenState {
  hydrated: boolean;
  token: string;
  tokenVersion: number;
}

function subscribeToHydration(): () => void {
  return () => {};
}

function getClientHydrationSnapshot(): boolean {
  return true;
}

function getServerHydrationSnapshot(): boolean {
  return false;
}

// Owns the optional user-provided GitHub token. The token is persisted only in
// localStorage for this browser and is not sent anywhere until the loader
// explicitly reads it.
export function useGitHubToken(): GitHubTokenState {
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    getClientHydrationSnapshot,
    getServerHydrationSnapshot
  );
  const [state, setState] = useState<StoredTokenState>({
    hydrated: false,
    token: '',
    tokenVersion: 0,
  });

  if (hydrated && !state.hydrated) {
    const storedToken = readStoredToken();
    setState({
      hydrated: true,
      token: storedToken,
      tokenVersion: storedToken === '' ? 0 : 1,
    });
  }

  const setToken = useCallback((nextToken: string) => {
    const normalizedToken = nextToken.trim();
    setState((current) => ({
      hydrated: true,
      token: normalizedToken,
      tokenVersion: current.tokenVersion + 1,
    }));
    writeStoredToken(normalizedToken);
  }, []);

  const clearToken = useCallback(() => {
    setToken('');
  }, [setToken]);

  return {
    clearToken,
    hasToken: state.token !== '',
    setToken,
    token: state.token,
    tokenVersion: state.tokenVersion,
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
