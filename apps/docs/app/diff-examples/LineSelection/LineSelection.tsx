'use client';

import { IconXSquircle } from '@/components/icons';
import { Button } from '@/components/ui/button';
import type { SelectedLineRange } from '@pierre/precision-diffs';
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
  const [selectedRange, setSelectedRange] = useState<SelectedLineRange | null>(
    null
  );

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
        description={
          <>
            Turn on line selection with <code>enableLineSelection: true</code>.
            When enabled, clicking a line number will select that line. Click
            and drag to select multiple lines, or hold Shift and click to extend
            your selection. You can also control the selection programmatically.
          </>
        }
      />

      <div className="bg-muted flex flex-col gap-2 rounded-lg p-3 sm:flex-row sm:items-center sm:gap-0 sm:pl-5">
        <div className="font-mono text-sm">
          {selectedRange != null ? (
            <>
              <span className="text-muted-foreground">Selected: </span>
              <span className="font-semibold">
                {selectedRange.start === selectedRange.end
                  ? `Line ${selectedRange.start}`
                  : `Lines ${selectedRange.start}–${selectedRange.end}`}
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">No selection</span>
          )}
        </div>
        <div className="flex gap-2 sm:ml-auto">
          <Button
            variant="outline"
            onClick={() => {
              setSelectedRange({ start: 6, end: 6 });
            }}
          >
            Select line 6
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setSelectedRange({ start: 15, end: 29 });
            }}
          >
            Select lines 15-29
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
          <Button
            variant="outline"
            onClick={() => {
              setSelectedRange(null);
            }}
            className="gap-1"
            disabled={selectedRange == null}
          >
            <IconXSquircle className="text-muted-foreground" />
            Clear
          </Button>
        </div>
      </div>

      <MultiFileDiff
        {...prerenderedDiff}
        className="overflow-hidden rounded-lg border dark:border-neutral-800"
        // Control selection programmatically (two-way binding with state)
        selectedLines={selectedRange}
        options={{
          ...prerenderedDiff.options,
          // Use the dynamic theme from state
          theme: theme,
          // Toggle background
          disableBackground: disableBackground,
          // Enable interactive line selection
          enableLineSelection: true,
          // Listen to selection changes from user interactions
          onLineSelected(range) {
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
