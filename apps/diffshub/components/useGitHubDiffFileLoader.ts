'use client';

import { type FileDiffContentsLoader } from '@pierre/diffs';
import { useCallback, useMemo } from 'react';

import { useLatestValueRef } from './useLatestValueRef';
import { createGitHubDiffFileLoader } from '@/lib/githubDiffFileLoader';

interface UseGitHubDiffFileLoaderOptions {
  domain?: string;
  hasGitHubToken: boolean;
  path: string;
  token: string;
  tokenVersion: number;
}

interface UseGitHubDiffFileLoaderResult {
  getGitHubToken(): string;
  loadDiffFiles: FileDiffContentsLoader | undefined;
}

// Keeps the loader and its cache stable while its deferred auth callbacks read
// the latest committed token. The token refs update in the insertion phase, so
// a load started from any effect in the same commit already sees the new token.
// Lives in its own hook so the ref reads the loader factory retains do not stop
// the React Compiler from compiling the calling component.
export function useGitHubDiffFileLoader({
  domain,
  hasGitHubToken,
  path,
  token,
  tokenVersion,
}: UseGitHubDiffFileLoaderOptions): UseGitHubDiffFileLoaderResult {
  const tokenRef = useLatestValueRef(token);
  const tokenVersionRef = useLatestValueRef(tokenVersion);
  const getGitHubToken = useCallback(() => tokenRef.current, [tokenRef]);
  /* oxlint-disable react/refs -- the factory retains these getters for the
   * returned loader; it does not invoke them during render */
  const loadDiffFiles = useMemo(
    () =>
      domain == null && hasGitHubToken
        ? createGitHubDiffFileLoader(path, {
            getAuthVersion: () => tokenVersionRef.current,
            getToken: () => tokenRef.current,
          })
        : undefined,
    [domain, hasGitHubToken, path, tokenRef, tokenVersionRef]
  );
  /* oxlint-enable react/refs */

  return { getGitHubToken, loadDiffFiles };
}
