'use client';

import { MultiFileDiff } from '@pierre/precision-diffs/react';
import type { PreloadedFileDiffResult } from '@pierre/precision-diffs/ssr';

interface OverviewInitialDiffProps {
  initialDiffProps: PreloadedFileDiffResult<undefined>;
}

export function OverviewInitialDiff({
  initialDiffProps,
}: OverviewInitialDiffProps) {
  return (
    <MultiFileDiff
      {...initialDiffProps}
      className="overflow-hidden rounded-lg border"
    />
  );
}
