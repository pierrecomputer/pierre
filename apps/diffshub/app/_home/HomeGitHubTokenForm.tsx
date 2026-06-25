'use client';

import { memo } from 'react';

import { GitHubTokenControl } from '@/components/GitHubTokenControl';
import { useGitHubToken } from '@/components/useGitHubToken';

export const HomeGitHubTokenForm = memo(function HomeGitHubTokenForm() {
  const { clearToken, hasToken, setToken } = useGitHubToken();
  return (
    <GitHubTokenControl
      active={hasToken}
      className="border-border/70 border-t px-4 py-3"
      onClear={clearToken}
      onSave={setToken}
      title="Private GitHub access"
    >
      Add a token to open private pull requests. Fine-grained tokens need repo
      access with Contents: read and Pull requests: read; a classic token with
      only the top-level repo scope should also work.
    </GitHubTokenControl>
  );
});
