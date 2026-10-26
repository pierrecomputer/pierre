'use client';

import {
  IconArrowsUpDown,
  IconBolt,
  IconRepeat,
  IconSparkles,
} from '@pierre/icons';
import { memo } from 'react';

import { StatusRow } from './StatusRow';
import type { StressTestState } from './useStressTest';
import { cn } from '@/lib/cn';

const BUTTON_CLASS_NAME =
  'hover:bg-muted/50 hover:text-foreground text-muted-foreground inline-flex h-5 cursor-pointer items-center justify-center rounded-md transition disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent';

interface StressTestControlsProps {
  stressTest: StressTestState;
}

// Desktop-only sidebar row for the rendering stress test: pick the stresses
// (theme interval, fast scroll), then play/pause runs them. With theme
// switching enabled the row becomes Party Mode.
export const StressTestControls = memo(function StressTestControls({
  stressTest,
}: StressTestControlsProps) {
  const {
    playing,
    canPlay,
    scrollEnabled,
    themeStepSeconds,
    togglePlaying,
    toggleScroll,
    bumpThemeInterval,
  } = stressTest;
  const partyMode = themeStepSeconds != null;
  const themeLabel = partyMode
    ? `Switch themes every ${themeStepSeconds}s — click to change interval`
    : 'Theme switching off — click to set an interval';
  const scrollLabel = scrollEnabled
    ? 'Disable fast scrolling'
    : 'Enable fast scrolling';
  const playLabel = playing ? 'Pause stress test' : 'Start stress test';
  return (
    <StatusRow
      icon={partyMode ? IconSparkles : IconBolt}
      className="hidden text-sm md:flex md:pr-0"
    >
      <span className="min-w-0 flex-1 truncate">
        {partyMode ? 'Party Mode' : 'Stress Test'}
      </span>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={bumpThemeInterval}
          className={cn(
            BUTTON_CLASS_NAME,
            'gap-1 px-1 text-[10px] leading-none tabular-nums',
            partyMode && 'text-foreground'
          )}
          title={themeLabel}
          aria-label={themeLabel}
        >
          <IconRepeat aria-hidden="true" className="size-3" />
          <span>{partyMode ? `${themeStepSeconds}s` : 'Off'}</span>
        </button>
        <button
          type="button"
          onClick={toggleScroll}
          className={cn(
            BUTTON_CLASS_NAME,
            'size-5',
            scrollEnabled && 'text-foreground'
          )}
          title={scrollLabel}
          aria-label={scrollLabel}
          aria-pressed={scrollEnabled}
        >
          <span className="relative inline-flex">
            <IconArrowsUpDown aria-hidden="true" className="size-3" />
            {!scrollEnabled && (
              <span
                aria-hidden="true"
                className="absolute top-1/2 left-1/2 h-px w-4 -translate-x-1/2 -translate-y-1/2 -rotate-45 rounded-full bg-current"
              />
            )}
          </span>
        </button>
        <button
          type="button"
          onClick={togglePlaying}
          disabled={!canPlay}
          className={cn(BUTTON_CLASS_NAME, 'size-5')}
          title={playLabel}
          aria-label={playLabel}
          aria-pressed={playing}
        >
          <PlayPauseIcon playing={playing} />
        </button>
      </div>
    </StatusRow>
  );
});

interface PlayPauseIconProps {
  playing: boolean;
}

function PlayPauseIcon({ playing }: PlayPauseIconProps) {
  if (playing) {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        className="size-3 fill-current"
      >
        <rect x="4" y="3" width="3" height="10" rx="1" />
        <rect x="9" y="3" width="3" height="10" rx="1" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3 fill-current">
      <path d="M5 3.75v8.5a.75.75 0 0 0 1.14.64l6.5-4.25a.75.75 0 0 0 0-1.28l-6.5-4.25A.75.75 0 0 0 5 3.75Z" />
    </svg>
  );
}
