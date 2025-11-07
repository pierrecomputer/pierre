'use client';

import { MultiFileDiff } from '@pierre/precision-diffs/react';
import type { PreloadMultiFileDiffResult } from '@pierre/precision-diffs/ssr';
import { useState } from 'react';

import { FeatureHeader } from '../FeatureHeader';

interface LineSelectionProps {
  prerenderedDiff: PreloadMultiFileDiffResult<undefined>;
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
        description="Click line numbers to select individual lines or ranges. Click and drag to select multiple lines, or hold Shift and click to extend your selection. You can also control the selection programmatically."
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

      <div className="flex gap-2">
        <button
          onClick={() => setSelectedRange({ first: 6, last: 6 })}
          className="bg-muted hover:bg-accent rounded-md px-3 py-2 text-sm font-medium transition-colors"
        >
          Select line 6
        </button>
        <button
          onClick={() => setSelectedRange({ first: 15, last: 20 })}
          className="bg-muted hover:bg-accent rounded-md px-3 py-2 text-sm font-medium transition-colors"
        >
          Select lines 15-20
        </button>
        <button
          onClick={() => setSelectedRange(null)}
          className="bg-muted hover:bg-accent rounded-md px-3 py-2 text-sm font-medium transition-colors"
        >
          Clear selection
        </button>
      </div>

      <MultiFileDiff
        {...prerenderedDiff}
        className="diff-container"
        enableLineSelection={true}
        selectedLines={selectedRange}
        onLineSelected={(range) => {
          setSelectedRange(range);
        }}
      />
    </div>
  );
}
