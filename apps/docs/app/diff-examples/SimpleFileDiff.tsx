'use client';

import { FileDiff } from '@pierre/precision-diffs/react';
import type { PreloadedFileDiffResult } from '@pierre/precision-diffs/ssr';

interface SimpleFileDiffProps {
  prerenderedDiff: PreloadedFileDiffResult<undefined>;
}

export function SimpleFileDiff({
  prerenderedDiff: { options: _options, ...props },
}: SimpleFileDiffProps) {
  return (
    <div className="space-y-5">
      <FileDiff
        {...props}
        className="overflow-hidden rounded-lg border"
        style={{
          width: 'calc(100vw - 48px)',
          marginLeft: 'calc(50% - 50vw + 24px)',
        }}
        options={{
          theme: 'pierre-dark',
          diffStyle: 'split',
          diffIndicators: 'bars',
          overflow: 'wrap',
          lineDiffType: 'word-alt',
        }}
      />
    </div>
  );
}
