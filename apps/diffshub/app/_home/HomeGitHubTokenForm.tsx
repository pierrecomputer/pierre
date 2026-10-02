'use client';

import { memo } from 'react';

import { GitHubAccount } from '@/components/GitHubAccount';
import { GitHubTokenControl } from '@/components/GitHubTokenControl';
import { useGitHubToken } from '@/components/useGitHubToken';

export const HomeGitHubTokenForm = memo(function HomeGitHubTokenForm() {
  const { clearToken, hasToken, setToken } = useGitHubToken();
  return (
    <div className="border-border/70 flex flex-col gap-3 border-t px-4 py-3">
      <GitHubAccount />
      <GitHubTokenControl
        active={hasToken}
        onClear={clearToken}
        onSave={setToken}
        title="Private GitHub access"
      />
    </div>
  );
});
