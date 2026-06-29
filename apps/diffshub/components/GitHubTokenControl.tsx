'use client';

import { IconBrandGithub, IconShare } from '@pierre/icons';
import { type FormEvent, memo, type ReactNode, useState } from 'react';

import { Button } from '@/components/Button';
import { cn } from '@/lib/cn';

interface GitHubTokenControlProps {
  active: boolean;
  className?: string;
  onClear(): void;
  onSave(token: string): void;
  title?: string;
  children?: ReactNode;
}

export const GitHubTokenControl = memo(function GitHubTokenControl({
  active,
  className,
  children = 'Stored only in this browser and sent to GitHub through the DiffsHub proxy. Fine-grained tokens need repo access with Contents: read and Pull requests: read; a classic token with only the top-level repo scope works.',
  onClear,
  onSave,
  title = 'GitHub token',
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
      <div className="flex items-center gap-2 text-sm font-medium">
        <IconBrandGithub className="size-3.5" />
        <span className="min-w-0 flex-1">{title}</span>
        <span
          className={cn(
            'rounded-full border px-1.5 py-0.5 text-[10px] leading-none tracking-wide uppercase',
            active
              ? 'border-black/10 bg-white text-black shadow-xs'
              : 'text-muted-foreground border-current/20'
          )}
        >
          {active ? 'Active' : 'Optional'}
        </span>
      </div>
      <p className="text-muted-foreground mt-1 text-xs leading-snug">
        {children}
        {!active && (
          <>
            {' '}
            <a
              className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 underline underline-offset-4"
              href="https://github.com/settings/tokens/new"
              target="_blank"
              rel="noreferrer noopener"
            >
              Create token
              <IconShare aria-hidden="true" className="size-3" />
            </a>
          </>
        )}
      </p>
      {active ? (
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
      ) : (
        <form className="mt-2 flex gap-1.5" onSubmit={handleSubmit}>
          <input
            className="border-border bg-background text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-8 min-w-0 flex-1 rounded-md border px-2 text-xs outline-none focus-visible:ring-[3px]"
            type="password"
            autoComplete="off"
            placeholder="Paste token"
            value={draftToken}
            onChange={({ currentTarget }) => setDraftToken(currentTarget.value)}
          />
          <Button type="submit" size="sm" disabled={!canSave}>
            Save
          </Button>
        </form>
      )}
    </section>
  );
});
