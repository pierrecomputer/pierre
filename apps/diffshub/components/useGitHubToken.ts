'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  GITHUB_TOKEN_STORAGE_KEY,
  type GitHubTokenCapability,
  isSameStoredGitHubAuth,
  parseStoredGitHubAuth,
  serializeStoredGitHubAuth,
  type StoredGitHubAuth,
} from '@/lib/githubTokenStorage';

// Same-tab broadcast so every mounted useGitHubToken instance (home form,
// viewer header) sees a save/clear immediately; cross-tab sync rides the
// native 'storage' event. The event carries the new auth as detail so sync
// still works when localStorage itself is disabled.
const AUTH_CHANGE_EVENT = 'diffshub:github-auth-change';

export interface GitHubTokenState {
  capability: GitHubTokenCapability;
  clearToken(): void;
  hasToken: boolean;
  setToken(token: string, capability: GitHubTokenCapability): void;
  token: string | undefined;
  tokenVersion: number;
}

// Owns the optional user-provided GitHub token. The token is persisted only in
// localStorage for this browser and is not sent anywhere until the loader
// explicitly reads it. `capability` records what the user said the token can
// do; posting UI is gated on 'read-write'.
export function useGitHubToken(): GitHubTokenState {
  const [auth, setAuthState] = useState<StoredGitHubAuth | undefined>();
  const [tokenVersion, setTokenVersion] = useState(0);

  const applyAuth = useCallback((next: StoredGitHubAuth | undefined) => {
    setAuthState((previous) =>
      isSameStoredGitHubAuth(previous, next) ? previous : next
    );
  }, []);

  useEffect(() => {
    applyAuth(readStoredAuth());
    const handleAuthChange = (event: Event) => {
      applyAuth((event as CustomEvent<StoredGitHubAuth | undefined>).detail);
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key == null || event.key === GITHUB_TOKEN_STORAGE_KEY) {
        applyAuth(readStoredAuth());
      }
    };
    window.addEventListener(AUTH_CHANGE_EVENT, handleAuthChange);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(AUTH_CHANGE_EVENT, handleAuthChange);
      window.removeEventListener('storage', handleStorage);
    };
  }, [applyAuth]);

  const token = auth?.token;
  const capability = auth?.capability ?? 'read';
  const savedAt = auth?.savedAt;

  // tokenVersion is the cache-busting signal loaders key their effects on.
  // Bump it whenever the effective auth changes, but skip the initial mount so
  // an empty hydrate keeps version 0 and does not re-trigger the first load.
  const hasHydratedRef = useRef(false);
  useEffect(() => {
    if (!hasHydratedRef.current) {
      hasHydratedRef.current = true;
      return;
    }
    setTokenVersion((version) => version + 1);
  }, [capability, savedAt, token]);

  // Updates local state and persists the new auth; writeStoredAuth also
  // broadcasts the change to the other mounted hook instances (and other tabs
  // via the storage write).
  const commitAuth = useCallback(
    (nextAuth: StoredGitHubAuth | undefined) => {
      applyAuth(nextAuth);
      writeStoredAuth(nextAuth);
    },
    [applyAuth]
  );

  const setToken = useCallback(
    (nextToken: string, nextCapability: GitHubTokenCapability) => {
      const normalizedToken = nextToken.trim();
      commitAuth(
        normalizedToken === ''
          ? undefined
          : {
              capability: nextCapability,
              savedAt: new Date().toISOString(),
              token: normalizedToken,
            }
      );
    },
    [commitAuth]
  );

  const clearToken = useCallback(() => {
    commitAuth(undefined);
  }, [commitAuth]);

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

// Persists the auth to localStorage and always broadcasts the change to the
// other mounted hook instances, even when the storage write fails — the event
// carries the auth as detail, so in-memory sync keeps working with storage
// disabled.
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
  } finally {
    window.dispatchEvent(new CustomEvent(AUTH_CHANGE_EVENT, { detail: auth }));
  }
}
