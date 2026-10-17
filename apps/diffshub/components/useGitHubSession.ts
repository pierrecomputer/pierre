'use client';

import { useEffect, useSyncExternalStore } from 'react';

import { fetchGitHubJSON, parseGitHubUser } from '@/lib/githubClient';
import type { GitHubUser } from '@/lib/githubTypes';

/** All sign-in controls share one public session; tokens remain server-side. */
export type GitHubSessionState =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; configured: boolean; user: GitHubUser | null };

const INITIAL: GitHubSessionState = { status: 'loading' };
let session: GitHubSessionState = INITIAL;
let pending: Promise<void> | undefined;
const listeners = new Set<() => void>();

/** Refreshes identity after navigation or another tab's sign-out. */
export function useGitHubSession(): GitHubSessionState {
  const value = useSyncExternalStore(
    subscribe,
    () => session,
    () => INITIAL
  );
  useEffect(() => {
    refreshSession();
    window.addEventListener('focus', refreshSession);
    return () => window.removeEventListener('focus', refreshSession);
  }, []);
  return value;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function refreshSession(): void {
  if (pending != null) return;
  pending = loadSession().finally(() => {
    pending = undefined;
  });
}

async function loadSession() {
  const result = await fetchGitHubJSON('/api/auth/session');
  if ('error' in result) {
    session = { status: 'error', error: result.error };
  } else {
    const value = result.data;
    if (
      value != null &&
      typeof value === 'object' &&
      'configured' in value &&
      typeof value.configured === 'boolean' &&
      'user' in value
    ) {
      const user = value.user === null ? null : parseGitHubUser(value.user);
      session =
        user === undefined
          ? {
              status: 'error',
              error: 'Could not read your GitHub session. Reload to try again.',
            }
          : { status: 'ready', configured: value.configured, user };
    } else {
      session = {
        status: 'error',
        error: 'Could not read your GitHub session. Reload to try again.',
      };
    }
  }
  for (const listener of listeners) listener();
}
