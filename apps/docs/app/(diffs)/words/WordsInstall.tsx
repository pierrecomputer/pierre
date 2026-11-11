'use client';

import { useEffect, useRef, useState } from 'react';

import { COPY_FEEDBACK_MS, CopyStateIcon } from '@/components/CopyStateIcon';
import { Button } from '@/components/ui/button';

const installCommand = 'pnpm add @pierre/words';

export function WordsInstall() {
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

  return (
    <>
      <Button
        type="button"
        size="xl"
        className="group max-w-full px-5 font-mono tracking-tight"
        aria-label={
          copied
            ? `Copied ${installCommand}`
            : `Copy install command: ${installCommand}`
        }
        onClick={() => {
          void (async () => {
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
          })();
        }}
      >
        <span className="size-4 min-[460px]:hidden" aria-hidden="true" />
        <span className="mx-auto min-[460px]:mx-0">{installCommand}</span>
        <CopyStateIcon copied={copied} />
      </Button>
      <span className="sr-only" aria-live="polite">
        {copied ? 'Install command copied to clipboard' : ''}
      </span>
    </>
  );
}
