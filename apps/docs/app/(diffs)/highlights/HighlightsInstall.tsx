'use client';

import { IconArrowUpRight, IconBook } from '@pierre/icons';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { COPY_FEEDBACK_MS, CopyStateIcon } from '@/components/CopyStateIcon';
import { Button } from '@/components/ui/button';

const INSTALL_COMMAND = 'pnpm add @pierre/highlights';

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
      await navigator.clipboard.writeText(INSTALL_COMMAND);
      clearTimeout(resetTimeoutRef.current);
      setCopied(true);
      resetTimeoutRef.current = setTimeout(
        () => setCopied(false),
        COPY_FEEDBACK_MS
      );
    } catch (err) {
      console.error('Failed to copy to clipboard', err);
    }
  };

  return (
    <section
      aria-labelledby="highlights-install"
      className="bg-muted/50 flex flex-col justify-between gap-6 rounded-2xl p-6 sm:p-8 md:flex-row md:items-end md:gap-12 lg:p-10"
    >
      <div className="max-w-2xl space-y-2">
        <h2
          id="highlights-install"
          className="text-2xl font-semibold tracking-tight"
        >
          Start highlighting in seconds
        </h2>
        <p className="text-muted-foreground text-pretty">
          Install <code>@pierre/highlights</code>, then follow the documentation
          to render HTML, stream tokens, or add live highlighting to an editor.
        </p>
        <Link
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm underline decoration-[1px] underline-offset-4 transition-colors"
          href="https://github.com/pierrecomputer/pierre/tree/main/packages/highlights"
        >
          View the package on GitHub
          <IconArrowUpRight className="size-4" />
        </Link>
      </div>

      <div className="flex shrink-0 flex-col gap-3 min-[460px]:flex-row min-[460px]:flex-wrap">
        <Button
          onClick={() => void copyInstallCommand()}
          size="xl"
          className="group px-5 font-mono tracking-tight"
          aria-label={
            copied
              ? `Copied ${INSTALL_COMMAND}`
              : `Copy install command: ${INSTALL_COMMAND}`
          }
        >
          <span>{INSTALL_COMMAND}</span>
          <CopyStateIcon copied={copied} />
        </Button>
        <span className="sr-only" aria-live="polite">
          {copied ? 'Install command copied to clipboard' : ''}
        </span>
        <Button variant="secondary" asChild size="xl">
          <Link href="/docs#highlights">
            <IconBook />
            Documentation
          </Link>
        </Button>
      </div>
    </section>
  );
}
