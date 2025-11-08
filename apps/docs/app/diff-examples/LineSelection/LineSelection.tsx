'use client';

import { MultiFileDiff } from '@pierre/precision-diffs/react';
import type { PreloadMultiFileDiffResult } from '@pierre/precision-diffs/ssr';
import { useState } from 'react';

import { FeatureHeader } from '../FeatureHeader';

interface LineSelectionProps {
  prerenderedDiff: PreloadMultiFileDiffResult<undefined>;
}

export function LineSelection({ prerenderedDiff }: LineSelectionProps) {
  // Store the selected line range in state
  // This can be a single line (first === last) or a range (first < last)
  const [selectedRange, setSelectedRange] = useState<{
    first: number;
    last: number;
  } | null>(null);

  return (
    <div className="space-y-5">
      <FeatureHeader
        title="Line selection"
        description="Enable interactive line selection by clicking line numbers. Click to select a single line, click and drag to select a range, or hold Shift and click to extend your selection. Control selection programmatically via the selectedLines prop, and respond to changes with onLineSelected, onLineSelectionStart, and onLineSelectionEnd callbacks. Customize selection colors using CSS variables like --pjs-selection-color-override and --pjs-bg-selection-override."
      />

      {/* Display current selection state */}
      <div className="bg-muted space-y-2 rounded-lg border p-4 font-mono text-sm">
        <div>
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
      </div>

      {/* Demonstrate programmatic control via selectedLines prop */}
      <div className="flex gap-2">
        <button
          onClick={() => {
            setSelectedRange({ first: 6, last: 6 });
          }}
          className="bg-muted hover:bg-accent rounded-md px-3 py-2 text-sm font-medium transition-colors"
        >
          Select line 6
        </button>
        <button
          onClick={() => {
            setSelectedRange({ first: 15, last: 20 });
          }}
          className="bg-muted hover:bg-accent rounded-md px-3 py-2 text-sm font-medium transition-colors"
        >
          Select lines 15-20
        </button>
        <button
          onClick={() => {
            setSelectedRange(null);
          }}
          className="bg-muted hover:bg-accent rounded-md px-3 py-2 text-sm font-medium transition-colors"
        >
          Clear selection
        </button>
      </div>

      <MultiFileDiff
        {...prerenderedDiff}
        className="diff-container"
        options={{
          ...prerenderedDiff.options,
          // Enable interactive line selection
          enableLineSelection: true,
          // Control selection programmatically (two-way binding with state)
          selectedLines: selectedRange,
          // Listen to selection changes from user interactions
          onLineSelected: (range) => {
            setSelectedRange(range);
          },
          // Optional: Use onLineSelectionStart and onLineSelectionEnd to
          // differentiate between in-progress and final selections
          // onLineSelectionStart: (range) => console.log('Started:', range),
          // onLineSelectionEnd: (range) => console.log('Completed:', range),
        }}
      />
    </div>
  );
}
