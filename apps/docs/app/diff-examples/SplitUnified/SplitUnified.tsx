'use client';

import { IconDiffSplit, IconDiffUnified } from '@/components/icons';
import { MultiFileDiff } from '@pierre/diffs/react';
import type { PreloadMultiFileDiffResult } from '@pierre/diffs/ssr';
import { useState } from 'react';

interface SplitUnifiedProps {
  prerenderedDiff: PreloadMultiFileDiffResult<undefined>;
}

export function SplitUnified({
  prerenderedDiff: { options, ...props },
}: SplitUnifiedProps) {
  const [diffStyle, setDiffStyle] = useState<'split' | 'unified'>('split');
  return (
    <div className="scroll-mt-[20px] space-y-5" id="layout">
      <MultiFileDiff
        {...props}
        className="diff-container"
        options={{
          theme: options?.theme ?? 'pierre-dark',
          diffStyle,
          enableLineSelection: true,
        }}
        renderHeaderMetadata={() => (
          <div className="-mr-2 inline-flex gap-2">
            <button
              onClick={() => setDiffStyle('split')}
              className={
                diffStyle === 'split'
                  ? 'border-border bg-background hover:bg-background cursor-pointer rounded-md border p-1 text-white transition-colors'
                  : 'text-muted-foreground hover:text-foreground cursor-pointer rounded-md border border-transparent bg-transparent p-1 transition-colors'
              }
              aria-label="Split view"
            >
              <IconDiffSplit />
            </button>
            <button
              onClick={() => setDiffStyle('unified')}
              className={
                diffStyle === 'unified'
                  ? 'border-border bg-background hover:bg-background cursor-pointer rounded-md border p-1 text-white transition-colors'
                  : 'text-muted-foreground hover:text-foreground cursor-pointer rounded-md border border-transparent bg-transparent p-1 transition-colors'
              }
              aria-label="Unified view"
            >
              <IconDiffUnified />
            </button>
          </div>
        )}
      />
    </div>
  );
}
