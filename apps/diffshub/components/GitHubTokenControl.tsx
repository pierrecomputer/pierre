'use client';

import { IconBrandGithub } from '@pierre/icons';
import { type FormEvent, memo, useState } from 'react';

import { Button } from '@/components/Button';
import { ButtonGroup, ButtonGroupItem } from '@/components/ButtonGroup';
import { Input } from '@/components/Input';
import { cn } from '@/lib/cn';
import type { GitHubTokenCapability } from '@/lib/githubTokenStorage';

export const CREATE_TOKEN_URL =
  'https://github.com/settings/personal-access-tokens/new?name=DiffsHub%20Private%20Repo%20Read%20Access&description=Read+private+PRs+and+expand+collapsed+hunks&expires_in=90&contents=read&pull_requests=read&issues=read';

export const CREATE_WRITE_TOKEN_URL =
  'https://github.com/settings/personal-access-tokens/new?name=DiffsHub%20GitHub%20Access&description=Read+private+PRs+and+post+review+comments&expires_in=90&contents=read&pull_requests=write&issues=write';

export const CLASSIC_TOKEN_URL =
  'https://github.com/settings/tokens/new?description=DiffsHub%20Private%20Repo%20Read%20Access&scopes=repo&default_expires_at=90';

interface GitHubTokenControlProps {
  active: boolean;
  capability: GitHubTokenCapability;
  className?: string;
  onClear(): void;
  onSave(token: string, capability: GitHubTokenCapability): void;
  // Owner (user or org) of the repo being viewed. Appended to the
  // fine-grained creation link as target_name so GitHub preselects the right
  // resource owner — a fine-grained PAT can only write to repos under its
  // resource owner, so for org repos the org must be selected there.
  resourceOwner?: string;
  title?: string;
}

export const GitHubTokenControl = memo(function GitHubTokenControl({
  active,
  capability,
  className,
  onClear,
  onSave,
  resourceOwner,
  title = 'GitHub Token',
}: GitHubTokenControlProps) {
  const [draftToken, setDraftToken] = useState('');
  const [draftCapability, setDraftCapability] =
    useState<GitHubTokenCapability>('read-write');
  const canSave = draftToken.trim() !== '';
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSave) {
      return;
    }
    onSave(draftToken, draftCapability);
    setDraftToken('');
  };
  const baseCreateTokenUrl =
    draftCapability === 'read-write'
      ? CREATE_WRITE_TOKEN_URL
      : CREATE_TOKEN_URL;
  const createTokenUrl =
    resourceOwner == null
      ? baseCreateTokenUrl
      : `${baseCreateTokenUrl}&target_name=${encodeURIComponent(resourceOwner)}`;

  return (
    <section className={cn('px-2 py-1.5', className)} aria-label={title}>
      <div className="flex items-center gap-1.5 text-sm font-medium">
        <IconBrandGithub className="size-4" />
        <span className="min-w-0 flex-1">{title}</span>
        <span
          className={cn(
            'rounded-full border px-1.5 py-0.5 text-[10px] leading-none tracking-wide uppercase',
            active
              ? 'border-green-600 bg-green-500 text-white dark:border-green-500 dark:bg-green-400 dark:text-black'
              : 'text-muted-foreground border-current/20'
          )}
        >
          {active
            ? capability === 'read-write'
              ? 'Active · Write'
              : 'Active'
            : 'Optional'}
        </span>
      </div>
      {active ? (
        <>
          <p className="text-muted-foreground mt-1 max-w-124 text-[13px] text-pretty">
            {capability === 'read-write'
              ? 'Using your PAT from localStorage. It can read private diffs and post comments. Clear it to create a new one.'
              : 'Using your read-only PAT from localStorage. Clear it and save a token with write access to post comments.'}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setDraftToken('');
                onClear();
              }}
            >
              Clear saved token
            </Button>
          </div>
        </>
      ) : (
        <>
          <ButtonGroup
            className="mt-2 flex w-full max-w-124"
            size="sm"
            value={draftCapability}
            onValueChange={(value) =>
              setDraftCapability(value === 'read' ? 'read' : 'read-write')
            }
          >
            <ButtonGroupItem className="flex-1" value="read" title="Read only">
              Read only
            </ButtonGroupItem>
            <ButtonGroupItem
              className="flex-1"
              value="read-write"
              title="Read and comment"
            >
              Read + comment
            </ButtonGroupItem>
          </ButtonGroup>
          <p className="text-muted-foreground mt-2 max-w-124 text-[13px] text-pretty">
            <a
              className="inline-link"
              href={createTokenUrl}
              target="_blank"
              rel="noreferrer noopener"
            >
              Create a fine-grained PAT
            </a>{' '}
            on GitHub
            {draftCapability === 'read-write'
              ? ' to view private diffs and post PR comments, or '
              : ' to view private diffs, or '}
            <a
              className="inline-link"
              href={CLASSIC_TOKEN_URL}
              target="_blank"
              rel="noreferrer noopener"
            >
              a classic token
            </a>{' '}
            with repo scope. Saved only in localStorage.
          </p>
          {draftCapability === 'read-write' && (
            <p className="text-muted-foreground mt-1 max-w-124 text-[12px] text-pretty">
              A fine-grained PAT only writes to repos under its{' '}
              <strong>Resource owner</strong> — for an org repo, pick the org
              there (even as an admin), and set{' '}
              <strong>Repository access</strong> to include the repo. For repos
              you can't select, use a classic token with repo scope.
            </p>
          )}
          <form className="mt-2 flex gap-1.5" onSubmit={handleSubmit}>
            <Input
              className="bg-background flex-1"
              inputSize="sm"
              type="password"
              autoComplete="off"
              data-1p-ignore
              data-lpignore="true"
              placeholder="Paste token"
              value={draftToken}
              onChange={({ currentTarget }) =>
                setDraftToken(currentTarget.value)
              }
            />
            <Button type="submit" size="sm" disabled={!canSave}>
              Save
            </Button>
          </form>
        </>
      )}
    </section>
  );
});
