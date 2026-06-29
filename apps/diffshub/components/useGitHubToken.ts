'use client';

import { useCallback, useEffect, useState } from 'react';

const GITHUB_TOKEN_STORAGE_KEY = 'diffshub.github.token';

export interface GitHubTokenState {
  clearToken(): void;
  hasToken: boolean;
  setToken(token: string): void;
  token: string;
  tokenVersion: number;
}

// Owns the optional user-provided GitHub token. The token is persisted only in
// localStorage for this browser and is not sent anywhere until the loader
// explicitly reads it.
export function useGitHubToken(): GitHubTokenState {
  const [token, setTokenState] = useState('');
  const [tokenVersion, setTokenVersion] = useState(0);

  useEffect(() => {
    const storedToken = readStoredToken();
    if (storedToken !== '') {
      setTokenState(storedToken);
      setTokenVersion((version) => version + 1);
    }
  }, []);

  const setToken = useCallback((nextToken: string) => {
    const normalizedToken = nextToken.trim();
    setTokenState(normalizedToken);
    setTokenVersion((version) => version + 1);
    writeStoredToken(normalizedToken);
  }, []);

  const clearToken = useCallback(() => {
    setToken('');
  }, [setToken]);

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
