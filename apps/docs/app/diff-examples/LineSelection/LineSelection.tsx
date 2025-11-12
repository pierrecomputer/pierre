'use client';

import { Button } from '@/components/ui/button';
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

  // Store the current theme
  const [theme, setTheme] = useState<'pierre-dark' | 'pierre-light'>(
    'pierre-dark'
  );

  // Store the background toggle state
  const [disableBackground, setDisableBackground] = useState(false);

  return (
    <div className="space-y-5">
      <FeatureHeader
        title="Line selection"
        description="You can optionally turn on line selection support. When on, clicking line numbers will select the line. Click and drag to select multiple lines, or hold Shift and click to - extend your selection. You can also control the selection programmatically."
      />

      {/* Display current selection state */}
      <div className="bg-muted space-y-2 rounded-lg border p-4 font-mono text-sm">
        <div>
          {selectedRange != null ? (
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
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => {
            setSelectedRange({ first: 6, last: 6 });
          }}
        >
          Select line 6
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setSelectedRange({ first: 15, last: 29 });
          }}
        >
          Select lines 15-29
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setSelectedRange(null);
          }}
        >
          Clear selection
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setTheme((current) =>
              current === 'pierre-dark' ? 'pierre-light' : 'pierre-dark'
            );
          }}
        >
          Toggle theme ({theme === 'pierre-dark' ? 'Dark' : 'Light'})
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setDisableBackground((current) => !current);
          }}
        >
          Background: {disableBackground ? 'Off' : 'On'}
        </Button>
      </div>

      <MultiFileDiff
        {...prerenderedDiff}
        className="overflow-hidden rounded-lg border dark:border-neutral-800"
        options={{
          ...prerenderedDiff.options,
          // Use the dynamic theme from state
          theme: theme,
          // Toggle background
          disableBackground: disableBackground,
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
