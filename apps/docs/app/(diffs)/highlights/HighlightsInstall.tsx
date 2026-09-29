'use client';

import { IconArrowUpRight, IconBrandGithub } from '@pierre/icons';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { COPY_FEEDBACK_MS, CopyStateIcon } from '@/components/CopyStateIcon';
import { Button } from '@/components/ui/button';

const INSTALL_COMMAND = 'pnpm add @pierre/highlights';

export function HighlightsInstall({ gzipBytes }: { gzipBytes: number }) {
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
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <Button
          variant="outline"
          onClick={() => void copyInstallCommand()}
          className="group gap-3 font-mono text-xs sm:text-sm"
          aria-label={
            copied ? 'Copied install command' : 'Copy install command'
          }
        >
          {INSTALL_COMMAND}
          <CopyStateIcon copied={copied} />
        </Button>
        <Button variant="outline" asChild>
          <Link
            href="https://github.com/pierrecomputer/pierre/tree/main/packages/highlights"
            target="_blank"
            rel="noopener noreferrer"
          >
            <IconBrandGithub />
            View on GitHub
            <IconArrowUpRight />
          </Link>
        </Button>
      </div>
      <span role="status" className="sr-only">
        {copied ? 'Install command copied to clipboard.' : ''}
      </span>
      <p className="text-muted-foreground text-sm">
        {(gzipBytes / 1024).toFixed(1)} KiB gzipped Wasm · 73 built-in languages
        · Apache 2.0
      </p>
    </div>
  );
}
