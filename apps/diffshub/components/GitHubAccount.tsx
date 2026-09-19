'use client';

import { useState } from 'react';

import { Button } from './Button';
import { useGitHubSession } from './useGitHubSession';
import { fetchGitHubJSON } from '@/lib/githubClient';

/** Sign-in returns to the current file and selected lines. */
export function GitHubAccount() {
  const session = useGitHubSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const user = session.status === 'ready' ? session.user : null;
  const configured = session.status === 'ready' && session.configured;

  async function signOut() {
    if (busy) return;
    setBusy(true);
    const result = await fetchGitHubJSON('/api/auth/session', {
      method: 'DELETE',
    });
    if ('error' in result) {
      setError(result.error);
      setBusy(false);
      return;
    }
    window.location.reload();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {user != null ? (
        <>
          <span className="text-sm">@{user.login}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void signOut()}
          >
            Sign out
          </Button>
        </>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!configured}
          title={
            session.status === 'loading'
              ? 'Checking GitHub sign-in'
              : !configured
                ? 'GitHub sign-in is not configured on this server.'
                : undefined
          }
          onClick={() => {
            const returnTo =
              window.location.pathname +
              window.location.search +
              window.location.hash;
            window.location.assign(
              `/api/auth/github?${new URLSearchParams({ returnTo })}`
            );
          }}
        >
          Sign in with GitHub
        </Button>
      )}
      {(error != null || session.status === 'error') && (
        <span role="alert" className="text-destructive text-xs">
          {error ?? (session.status === 'error' ? session.error : '')}
        </span>
      )}
    </div>
  );
}
