'use client';

import { MultiFileDiff } from '@pierre/diffs/react';
import type { PreloadMultiFileDiffResult } from '@pierre/diffs/ssr';
import { IconDiffSplit, IconDiffUnified } from '@pierre/icons';
import { useState } from 'react';

import { FeatureHeader } from '../FeatureHeader';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';

interface SplitUnifiedProps {
  prerenderedDiff: PreloadMultiFileDiffResult<undefined>;
}

export function SplitUnified({
  prerenderedDiff: { options, ...props },
}: SplitUnifiedProps) {
  const [diffStyle, setDiffStyle] = useState<'split' | 'unified'>(
    options?.diffStyle ?? 'split'
  );
  return (
    <div className="space-y-5">
      <FeatureHeader
        id="layout"
        title="Diff layout styles"
        description="Choose from stacked (unified) or split (side-by-side). Both use CSS Grid and Shadow DOM under the hood, meaning fewer DOM nodes and faster rendering."
      />
      <ButtonGroup
        value={diffStyle}
        onValueChange={(value) => setDiffStyle(value as 'split' | 'unified')}
      >
        <ButtonGroupItem value="split">
          <IconDiffSplit />
          Split
        </ButtonGroupItem>
        <ButtonGroupItem value="unified">
          <IconDiffUnified />
          Stacked
        </ButtonGroupItem>
      </ButtonGroup>

      <MultiFileDiff
        {...props}
        className="diff-container"
        options={{ ...options, diffStyle }}
      />
    </div>
  );
}
