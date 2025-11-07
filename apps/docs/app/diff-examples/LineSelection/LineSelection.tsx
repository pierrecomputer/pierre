'use client';

import { File } from '@pierre/precision-diffs/react';
import type { PreloadedFileResult } from '@pierre/precision-diffs/ssr';
import { useState } from 'react';

import { FeatureHeader } from '../FeatureHeader';

interface LineSelectionProps {
  prerenderedDiff: PreloadedFileResult<undefined>;
}

export function LineSelection({ prerenderedDiff }: LineSelectionProps) {
  const [selectedRange, setSelectedRange] = useState<{
    first: number;
    last: number;
  } | null>(null);

  return (
    <div className="space-y-5">
      <FeatureHeader
        title="Line selection"
        description="Click line numbers to select individual lines or ranges. Click and drag to select multiple lines, or hold Shift and click to extend your selection. Click a selected line again to deselect."
      />

      <div className="bg-muted rounded-lg border p-4 font-mono text-sm">
        {selectedRange ? (
          <>
            <span className="text-muted-foreground">Selected lines: </span>
            <span className="font-semibold">
              {selectedRange.first === selectedRange.last
                ? `Line ${selectedRange.first}`
                : `Lines ${selectedRange.first}–${selectedRange.last}`}
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">No lines selected</span>
        )}
      </div>

      <File
        {...prerenderedDiff}
        className="diff-container"
        enableLineSelection={true}
        onLineSelected={(range) => {
          setSelectedRange(range);
        }}
      />
    </div>
  );
}
