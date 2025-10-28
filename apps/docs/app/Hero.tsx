'use client';

import { IconBook, IconCheck, IconCopyFill } from '@/components/icons';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import Link from 'next/link';
import { useState } from 'react';

export function Hero() {
  const [copied, setCopied] = useState(false);

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText('bun i @pierre/precision-diffs');
      setCopied(true);
      setTimeout(() => setCopied(false), 5000);
    } catch (err) {
      console.error('Failed to copy to clipboard', err);
    }
  };

  return (
    <section className="flex max-w-3xl flex-col gap-2 py-16">
      <h1 className="text-3xl font-medium tracking-tight md:text-4xl">
        Precision Diffs
      </h1>
      <p className="text-md text-muted-foreground max-w-2x mb-2 md:text-lg">
        Fast, exact diffing for modern apps. Fully open source, built on Shiki,
        insanely customizable, and packed with the features you need. Made with
        love by{' '}
        <Link
          target="_blank"
          href="https://pierre.computer"
          className="hover:text-foreground decoration-[1px]muted-foreground hover:decoration-foreground underline decoration-[1px] underline-offset-3 transition-colors"
        >
          The Pierre Computer Company
        </Link>
        .
      </p>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => void copyToClipboard()}
              className="inline-flex items-center gap-2 rounded-md bg-gray-900 px-4 py-3 font-mono text-sm text-white transition-colors hover:bg-gray-800 dark:border dark:border-white/20 dark:bg-black dark:hover:border-white/30"
            >
              <span>bun i @pierre/precision-diffs</span>
              {copied ? <IconCheck /> : <IconCopyFill />}
            </button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{'Copy to clipboard'}</p>
          </TooltipContent>
        </Tooltip>
        <Button variant="secondary" asChild size="xl">
          <Link href="/docs">
            <IconBook />
            Documentation
          </Link>
        </Button>
      </div>
    </section>
  );
}
