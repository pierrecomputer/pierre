'use client';

import { IconArrowUpRight, IconBrandGithub } from '@pierre/icons';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { COPY_FEEDBACK_MS, CopyStateIcon } from '@/components/CopyStateIcon';
import { Button } from '@/components/ui/button';

const INSTALL_COMMAND = 'pnpm add @pierre/chamele';

export function ChameleHero({ gzipBytes }: { gzipBytes: number }) {
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
    <section className="flex max-w-3xl flex-col gap-3 pt-20 pb-10 md:pb-20 lg:max-w-4xl">
      <span className="mb-2 self-start rounded-full bg-purple-100 px-3 py-1 text-sm font-medium tracking-wide text-purple-600 dark:bg-purple-900 dark:text-purple-400">
        Experimental
      </span>

      <h1 className="text-4xl font-semibold tracking-tight text-balance md:text-5xl lg:text-6xl">
        Highlight code at WebAssembly speed
      </h1>
      <p className="text-md text-muted-foreground mb-2 max-w-[740px] text-pretty md:text-lg lg:text-xl">
        <code>@pierre/chamele</code> is a fast code highlighter written by hand
        in WebAssembly Text. It ships with built-in language lexers, works
        across runtimes, and speaks familiar Shiki-compatible formats. Made by{' '}
        <Link
          target="_blank"
          href="https://pierre.computer"
          className="hover:text-foreground muted-foreground hover:decoration-foreground underline decoration-[1px] underline-offset-4 transition-colors"
        >
          The Pierre Computer Company
        </Link>
        .
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
          <Link
            href="https://github.com/pierrecomputer/pierre/tree/main/packages/chamele"
            target="_blank"
            rel="noopener noreferrer"
          >
            <IconBrandGithub />
            View on GitHub
            <IconArrowUpRight />
          </Link>
        </Button>
      </div>

      <p className="text-muted-foreground mt-2 text-sm">
        {(gzipBytes / 1024).toFixed(1)} kB gzipped Wasm · 32 built-in languages
      </p>
    </section>
  );
}
