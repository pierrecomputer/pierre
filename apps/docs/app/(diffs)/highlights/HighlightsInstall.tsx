'use client';

import { IconBook } from '@pierre/icons';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { AgentSkillMenu } from '@/components/AgentSkillMenu';
import { COPY_FEEDBACK_MS, CopyStateIcon } from '@/components/CopyStateIcon';
import { Button } from '@/components/ui/button';

const installCommand = 'pnpm add @pierre/highlights';

export function HighlightsInstall() {
  const [copied, setCopied] = useState(false);
  const resetTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );

  useEffect(
    () => () => {
      clearTimeout(resetTimeoutRef.current);
    },
    []
  );

  const copyInstallCommand = async () => {
    try {
      await navigator.clipboard.writeText(installCommand);
      clearTimeout(resetTimeoutRef.current);
      setCopied(true);
      resetTimeoutRef.current = setTimeout(
        () => setCopied(false),
        COPY_FEEDBACK_MS
      );
    } catch (error) {
      console.error('Failed to copy install command', error);
    }
  };

  return (
    <section
      aria-labelledby="highlights-install"
      className="bg-muted/50 flex flex-col items-center gap-6 rounded-2xl py-24 text-center md:py-32"
    >
      <div className="max-w-xl space-y-2">
        <h2
          id="highlights-install"
          className="text-2xl font-semibold tracking-tight"
        >
          Install Highlights
        </h2>
        <p className="text-muted-foreground text-pretty">
          Add <code>@pierre/highlights</code>, then start with static HTML,
          streaming tokens, or live editor updates.
        </p>
      </div>

      <div className="flex w-full flex-col justify-center gap-3 min-[460px]:w-auto min-[460px]:flex-row min-[460px]:flex-wrap min-[460px]:items-center">
        <Button
          className="group max-w-full px-5 font-mono tracking-tight"
          size="xl"
          onClick={() => void copyInstallCommand()}
          aria-label={
            copied
              ? `Copied ${installCommand}`
              : `Copy install command: ${installCommand}`
          }
        >
          <div className="size-4 min-[460px]:hidden" />
          <span className="mx-auto min-[460px]:mx-0">{installCommand}</span>
          <CopyStateIcon copied={copied} />
        </Button>
        <AgentSkillMenu productId="highlights" />
        <Button variant="secondary" asChild size="xl">
          <Link href="/docs#highlights">
            <IconBook />
            Documentation
          </Link>
        </Button>
        <span className="sr-only" aria-live="polite">
          {copied ? 'Install command copied to clipboard' : ''}
        </span>
      </div>
    </section>
  );
}
