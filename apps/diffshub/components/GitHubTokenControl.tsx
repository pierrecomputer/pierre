'use client';

import { IconBrandGithub } from '@pierre/icons';
import { type FormEvent, memo, useState } from 'react';

import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { cn } from '@/lib/cn';

export const CREATE_TOKEN_URL =
  'https://github.com/settings/personal-access-tokens/new?name=DiffsHub%20Private%20Repo%20Read%20Access&description=Read+private+PRs+and+expand+collapsed+hunks&expires_in=90&contents=read&pull_requests=write&issues=write';

export const CLASSIC_TOKEN_URL =
  'https://github.com/settings/tokens/new?description=DiffsHub%20Private%20Repo%20Read%20Access&scopes=repo&default_expires_at=90';

interface GitHubTokenControlProps {
  active: boolean;
  className?: string;
  onClear(): void;
  onSave(token: string): void;
  title?: string;
}

export const GitHubTokenControl = memo(function GitHubTokenControl({
  active,
  className,
  onClear,
  onSave,
  title = 'GitHub Token',
}: GitHubTokenControlProps) {
  const [draftToken, setDraftToken] = useState('');
  const canSave = draftToken.trim() !== '';
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSave) {
      return;
    }
    onSave(draftToken);
    setDraftToken('');
  };

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
          {active ? 'Active' : 'Optional'}
        </span>
      </div>
      {active ? (
        <>
          <p className="text-muted-foreground mt-1 max-w-124 text-[13px] text-pretty">
            Using your PAT from localStorage. Clear it to create a new one.
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
          <p className="text-muted-foreground mt-1 max-w-124 text-[13px] text-pretty">
            <a
              className="inline-link"
              href={CREATE_TOKEN_URL}
              target="_blank"
              rel="noreferrer noopener"
            >
              Create a fine-grained PAT
            </a>{' '}
            on GitHub to view private diffs, or{' '}
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
