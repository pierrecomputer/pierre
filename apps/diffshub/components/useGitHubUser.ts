'use client';

import { useEffect, useState } from 'react';

import type { GitHubCommentUser } from '@/lib/githubComments';

interface UseGitHubUserOptions {
  getToken(): string | undefined;
  hasToken: boolean;
  tokenVersion: number;
}

// Resolves the saved token's GitHub identity through the same-origin
// /api/github-user proxy. The identity is cosmetic (it puts the user's real
// avatar on the comment form), so failures resolve to undefined silently and
// callers fall back to the local persona avatar.
export function useGitHubUser({
  getToken,
  hasToken,
  tokenVersion,
}: UseGitHubUserOptions): GitHubCommentUser | undefined {
  const [user, setUser] = useState<GitHubCommentUser>();

  useEffect(() => {
    setUser(undefined);
    if (!hasToken) {
      return;
    }
    const controller = new AbortController();
    const load = async () => {
      try {
        const token = getToken();
        if (token == null) {
          return;
        }
        const response = await fetch('/api/github-user', {
          cache: 'no-store',
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        if (!response.ok) {
          return;
        }
        const data: unknown = await response.json();
        if (
          typeof data === 'object' &&
          data != null &&
          typeof (data as Record<string, unknown>).login === 'string'
        ) {
          const record = data as Record<string, unknown>;
          setUser({
            avatarUrl:
              typeof record.avatarUrl === 'string'
                ? record.avatarUrl
                : undefined,
            login: record.login as string,
          });
        }
      } catch {
        // Cosmetic lookup; stay silent on failure.
      }
    };
    void load();
    return () => controller.abort();
  }, [getToken, hasToken, tokenVersion]);

  return user;
}
