'use client';

import { IconBook } from '@pierre/icons';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { COPY_FEEDBACK_MS, CopyStateIcon } from '@/components/CopyStateIcon';
import { Button } from '@/components/ui/button';

const INSTALL_COMMAND = 'pnpm add @pierre/highlights';

export function HighlightsHero() {
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
    <section className="flex max-w-3xl flex-col gap-3 pt-20 pb-10 md:pb-20 lg:max-w-5xl">
      <span className="mb-2 self-start rounded-full bg-purple-100 px-3 py-1 text-sm font-medium tracking-wide text-purple-600 dark:bg-purple-900 dark:text-purple-400">
        Experimental
      </span>

      <h1 className="text-4xl font-semibold tracking-tight text-balance md:text-5xl lg:text-6xl">
        Syntax highlighting at native speed
      </h1>
      <p className="text-md text-muted-foreground mb-2 max-w-[760px] text-pretty md:text-lg lg:text-xl">
        <code>@pierre/highlights</code> is a fast, lightweight syntax
        highlighter hand-written in WebAssembly Text. Ships with built-in
        language lexers, runs across JavaScript runtimes, and supports familiar
        Shiki-compatible formats. Generates large-file HTML up to 279× faster
        than Shiki.
      </p>

      <div className="flex flex-col gap-3 min-[460px]:flex-row min-[460px]:flex-wrap min-[460px]:items-center">
        <Button
          onClick={() => void copyInstallCommand()}
          size="xl"
          className="group px-5 font-mono tracking-tight"
        >
          <div className="size-4 min-[460px]:hidden" />
          <span className="mx-auto min-[460px]:mx-0">{INSTALL_COMMAND}</span>
          <CopyStateIcon copied={copied} />
        </Button>
        <Button variant="secondary" asChild size="xl">
          <Link href="/docs#highlights">
            <IconBook />
            Documentation
          </Link>
        </Button>
      </div>

      <p className="text-muted-foreground mt-2 text-sm">
        73 built-in languages ·{' '}
        <Link
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-foreground muted-foreground hover:decoration-foreground underline decoration-[1px] underline-offset-4 transition-colors"
          href="https://github.com/pierrecomputer/pierre/tree/main/packages/highlights"
        >
          View on GitHub
        </Link>{' '}
        ·{' '}
        <Link
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-foreground muted-foreground hover:decoration-foreground underline decoration-[1px] underline-offset-4 transition-colors"
          href="https://github.com/pierrecomputer/pierre/tree/main/packages/highlights/benchmark#html-generation"
        >
          Benchmark methodology
        </Link>
        .
      </p>
    </section>
  );
}
