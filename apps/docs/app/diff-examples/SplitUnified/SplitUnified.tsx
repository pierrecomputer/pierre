'use client';

import { IconDiffSplit, IconDiffUnified } from '@/components/icons';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';
import { MultiFileDiff } from '@pierre/precision-diffs/react';
import type { PreloadMultiFileDiffResult } from '@pierre/precision-diffs/ssr';
import { useState } from 'react';

import { FeatureHeader } from '../FeatureHeader';

interface SplitUnifiedProps {
  prerenderedDiff: PreloadMultiFileDiffResult<undefined>;
}

export function SplitUnified({
  prerenderedDiff: { options, ...props },
}: SplitUnifiedProps) {
  const [diffStyle, setDiffStyle] = useState<'split' | 'unified'>('split');
  return (
    <div className="scroll-mt-[20px] space-y-5" id="layout">
      <FeatureHeader
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
        options={{
          theme: options?.theme ?? 'pierre-dark',
          diffStyle,
        }}
      />
    </div>
  );
}
