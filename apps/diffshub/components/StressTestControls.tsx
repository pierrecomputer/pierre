'use client';

import { DEFAULT_CODE_VIEW_FILE_METRICS, queueRender } from '@pierre/diffs';
import type { CodeViewHandle } from '@pierre/diffs/react';
import { IconBolt, IconRepeat } from '@pierre/icons';
import { memo, type MouseEvent, type RefObject, useState } from 'react';

import { StatusRow } from './StatusRow';
import type { ThemeCycleControls } from './useThemeCycle';
import { cn } from '@/lib/cn';
import type { CommentMetadata } from '@/lib/types';

class AutoScrollTester<LAnnotation> {
  private running: 0 | 1 | 2 = 0;
  private direction = 1;

  constructor(
    private viewerRef: RefObject<CodeViewHandle<LAnnotation, undefined> | null>,
    private onStateChange?: (running: boolean) => unknown
  ) {}

  start() {
    if (this.running > 0) return;
    this.running = 1;
    this.onStateChange?.(true);
    this.render();
  }

  render = () => {
    const { current: viewerHandle } = this.viewerRef;
    if (this.running === 0 || viewerHandle == null) {
      return;
    }
    const viewer = viewerHandle.getInstance();
    if (viewer == null) {
      return;
    }
    const scrollHeight = viewer.getScrollHeight();
    const scrollTop = viewer.getScrollTop();
    const clientHeight = viewer.getHeight();

    // The first scroll tick should always attempt to scroll
    if (this.running === 1) {
      this.running = 2;
    }
    // If we're scrolling and we hit a boundary, lets stop, and invert the
    // direction, so next click will scroll us the other direction
    else if (
      this.running === 2 &&
      (scrollTop <= 0 || scrollTop >= scrollHeight - clientHeight)
    ) {
      this.direction *= -1;
      this.stop();
      return;
    }
    viewerHandle.scrollTo({
      type: 'position',
      position:
        scrollTop +
        clientHeight * 2 * this.direction +
        Math.random() * DEFAULT_CODE_VIEW_FILE_METRICS.lineHeight,
    });
    queueRender(this.render);
  };

  stop() {
    this.running = 0;
    this.onStateChange?.(false);
  }

  toggleState = () => {
    if (this.running > 0) {
      this.stop();
    } else {
      this.start();
    }
  };
}

interface StressTestControlsProps {
  themeCycle: ThemeCycleControls;
  viewerRef: RefObject<CodeViewHandle<CommentMetadata, undefined> | null>;
}

// Desktop-only sidebar row with rendering stress tests: sweep through themes
// and autoscroll the CodeView at two viewports per frame.
export const StressTestControls = memo(function StressTestControls({
  themeCycle,
  viewerRef,
}: StressTestControlsProps) {
  const [isAutoScrolling, setIsAutoScrolling] = useState(false);
  const [scrollTester] = useState(
    () => new AutoScrollTester(viewerRef, setIsAutoScrolling)
  );
  const autoScrollLabel = isAutoScrolling
    ? 'Pause autoscroll'
    : 'Start autoscroll';
  return (
    <StatusRow icon={IconBolt} className="hidden text-sm md:flex md:pr-0">
      <span className="min-w-0 flex-1 truncate">Stress Test</span>
      <div className="flex shrink-0 items-center gap-1.5">
        <ThemeCycleToggle controls={themeCycle} />
        <button
          type="button"
          onClick={scrollTester.toggleState}
          className="hover:bg-muted/50 hover:text-foreground text-muted-foreground inline-flex size-5 cursor-pointer items-center justify-center rounded-md transition"
          title={autoScrollLabel}
          aria-label={autoScrollLabel}
          aria-pressed={isAutoScrolling}
        >
          <AutoScrollToggleIcon running={isAutoScrolling} />
        </button>
      </div>
    </StatusRow>
  );
});

interface ThemeCycleToggleProps {
  controls: ThemeCycleControls;
}

// Sweep-through-themes button. Plain click matches the neighboring
// autoscroll button's primary affordance — it starts (and stops) the
// rotation. Shift-click bumps the per-step duration through
// [1s, 3s, 5s, 10s]; the current value is rendered next to the icon so
// every shift-click visibly steps through the presets.
function ThemeCycleToggle({ controls }: ThemeCycleToggleProps) {
  const { cycling, stepSeconds, bumpDuration, toggleCycle } = controls;
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.shiftKey) {
      bumpDuration();
    } else {
      toggleCycle();
    }
  };
  const title = cycling
    ? `Stop cycling themes (every ${stepSeconds}s) — shift+click to change speed`
    : `Cycle themes every ${stepSeconds}s — shift+click to change speed`;
  return (
    <button
      type="button"
      onClick={handleClick}
      className="hover:bg-muted/50 hover:text-foreground text-muted-foreground inline-flex h-5 cursor-pointer items-center gap-1 rounded-md px-1 text-[10px] leading-none tabular-nums transition"
      title={title}
      aria-label={title}
      aria-pressed={cycling}
    >
      <IconRepeat
        aria-hidden="true"
        className={cn('size-3', cycling && 'animate-pulse')}
      />
      <span>{stepSeconds}s</span>
    </button>
  );
}

interface AutoScrollToggleIconProps {
  running: boolean;
}

function AutoScrollToggleIcon({ running }: AutoScrollToggleIconProps) {
  if (running) {
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
