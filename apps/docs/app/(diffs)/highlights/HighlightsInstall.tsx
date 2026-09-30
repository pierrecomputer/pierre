'use client';

import { useEffect, useRef, useState } from 'react';

import { COPY_FEEDBACK_MS, CopyStateIcon } from '@/components/CopyStateIcon';
import { Button } from '@/components/ui/button';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';

const packageManagers = ['pnpm', 'npm', 'bun', 'yarn'] as const;
type PackageManager = (typeof packageManagers)[number];

const installCommands: Record<PackageManager, string> = {
  pnpm: 'pnpm add @pierre/highlights',
  npm: 'npm install @pierre/highlights',
  bun: 'bun add @pierre/highlights',
  yarn: 'yarn add @pierre/highlights',
};

export function HighlightsInstall() {
  const [packageManager, setPackageManager] = useState<PackageManager>('pnpm');
  const [copied, setCopied] = useState(false);
  const resetTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );
  const installCommand = installCommands[packageManager];

  useEffect(
    () => () => {
      clearTimeout(resetTimeoutRef.current);
    },
    []
  );

  const selectPackageManager = (value: string) => {
    clearTimeout(resetTimeoutRef.current);
    setCopied(false);
    setPackageManager(value as PackageManager);
  };

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
      className="flex flex-col items-center gap-6 py-24 text-center md:py-32"
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

      <div className="flex w-full flex-col items-center gap-3">
        <ButtonGroup
          aria-label="Package manager"
          className="self-center"
          value={packageManager}
          onValueChange={selectPackageManager}
        >
          {packageManagers.map((manager) => (
            <ButtonGroupItem
              key={manager}
              value={manager}
              aria-pressed={packageManager === manager}
            >
              {manager}
            </ButtonGroupItem>
          ))}
        </ButtonGroup>
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
          <span>{installCommand}</span>
          <CopyStateIcon copied={copied} />
        </Button>
        <span className="sr-only" aria-live="polite">
          {copied ? 'Install command copied to clipboard' : ''}
        </span>
      </div>
    </section>
  );
}
