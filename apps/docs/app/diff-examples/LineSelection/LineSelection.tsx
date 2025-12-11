'use client';

import {
  IconCodeStyleBars,
  IconCodeStyleBg,
  IconDiffSplit,
  IconDiffUnified,
  IconMoon,
  IconSun,
  IconXSquircle,
} from '@/components/icons';
import { Button } from '@/components/ui/button';
import type { SelectedLineRange } from '@pierre/diffs';
import { MultiFileDiff } from '@pierre/diffs/react';
import type { PreloadMultiFileDiffResult } from '@pierre/diffs/ssr';
import { useState } from 'react';

import { FeatureHeader } from '../FeatureHeader';

interface LineSelectionProps {
  prerenderedDiff: PreloadMultiFileDiffResult<undefined>;
}

export function LineSelection({ prerenderedDiff }: LineSelectionProps) {
  const [selectedRange, setSelectedRange] = useState<SelectedLineRange | null>(
    null
  );
  const [themeType, setThemeType] = useState<'dark' | 'light'>(
    prerenderedDiff.options?.themeType === 'light' ? 'light' : 'dark'
  );
  const [disableBackground, setDisableBackground] = useState(
    prerenderedDiff.options?.disableBackground ?? false
  );
  const [diffStyle, setDiffStyle] = useState<'split' | 'unified'>(
    prerenderedDiff.options?.diffStyle ?? 'split'
  );

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
            Also selections will elegantly manage the differences between{' '}
            <code>split</code> and <code>unified</code> views.
          </>
        }
      />

      <div className="bg-muted flex flex-col gap-2 rounded-lg p-3 sm:flex-row sm:items-center sm:gap-0">
        <div className="self-start p-2 font-mono text-sm text-nowrap">
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
        <div className="flex min-w-0 flex-wrap gap-2 sm:ml-auto">
          <Button
            variant="outline"
            onClick={() => {
              setSelectedRange({ start: 23, side: 'additions', end: 23 });
            }}
            title="{ start: 23, side: 'additions', end: 23 }"
          >
            Select line 23
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setSelectedRange({
                start: 32,
                side: 'deletions',
                end: 41,
                endSide: 'additions',
              });
            }}
            title="{ start: 32, side: 'deletions', end: 41, endSide: 'additions' }"
          >
            Select lines 32-41
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
          </Button>
        </div>
      </div>

      <MultiFileDiff
        {...prerenderedDiff}
        className="overflow-hidden rounded-lg border dark:border-neutral-800"
        selectedLines={selectedRange}
        options={{
          ...prerenderedDiff.options,
          themeType,
          diffStyle,
          disableBackground,
          onLineSelected(range) {
            setSelectedRange(range);
          },
        }}
        renderHeaderMetadata={() => {
          return (
            <div className="-mr-1.5 flex items-center gap-1">
              <button
                type="button"
                onClick={() =>
                  setDiffStyle((current) =>
                    current === 'split' ? 'unified' : 'split'
                  )
                }
                className="cursor-pointer p-1 opacity-60 hover:opacity-100"
                title={
                  diffStyle === 'split'
                    ? 'Switch to unified'
                    : 'Switch to split'
                }
              >
                {diffStyle === 'split' ? (
                  <IconDiffSplit size={16} />
                ) : (
                  <IconDiffUnified size={16} />
                )}
              </button>
              <button
                type="button"
                onClick={() => setDisableBackground((current) => !current)}
                className="cursor-pointer p-1 opacity-60 hover:opacity-100"
                title={
                  disableBackground ? 'Enable background' : 'Disable background'
                }
              >
                {disableBackground ? (
                  <IconCodeStyleBars size={16} />
                ) : (
                  <IconCodeStyleBg size={16} />
                )}
              </button>
              <button
                type="button"
                onClick={() =>
                  setThemeType((current) =>
                    current === 'dark' ? 'light' : 'dark'
                  )
                }
                className="cursor-pointer p-1 opacity-60 hover:opacity-100"
                title={
                  themeType === 'dark' ? 'Switch to light' : 'Switch to dark'
                }
              >
                {themeType === 'dark' ? (
                  <IconMoon size={16} />
                ) : (
                  <IconSun size={16} />
                )}
              </button>
            </div>
          );
        }}
      />
    </div>
  );
}
