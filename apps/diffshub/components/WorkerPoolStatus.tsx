'use client';

import {
  areWorkerStatsEqual,
  DEFAULT_CODE_VIEW_FILE_METRICS,
  queueRender,
} from '@pierre/diffs';
import { useWorkerPool } from '@pierre/diffs/react';
import type { WorkerStats } from '@pierre/diffs/worker';
import {
  IconCircleFill,
  IconEye,
  IconEyeSlash,
  IconInfoFill,
  IconRepeat,
  IconSquircleLgFill,
  IconTriangleFill,
} from '@pierre/icons';
import Link from 'next/link';
import {
  memo,
  type MouseEvent,
  type RefObject,
  useEffect,
  useState,
} from 'react';

import { StatItem } from './StatItem';
import { StatusRow } from './StatusRow';
import type { ThemeCycleControls } from './useThemeCycle';
import { cn } from '@/lib/cn';

class AutoScrollTester {
  private running: 0 | 1 | 2 = 0;
  private direction = 1;

  constructor(
    private scrollRef: RefObject<HTMLDivElement | null>,
    private onStateChange?: (running: boolean) => unknown
  ) {}

  start() {
    if (this.running > 0) return;
    this.running = 1;
    this.onStateChange?.(true);
    this.render();
  }

  render = () => {
    if (this.running === 0 || this.scrollRef.current == null) {
      return;
    }
    const { scrollHeight, scrollTop, clientHeight } = this.scrollRef.current;

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
    this.scrollRef.current.scrollTo({
      top:
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

interface WorkerPoolStatusProps {
  expanded: boolean;
  onToggle(): void;
  scrollRef: RefObject<HTMLDivElement | null>;
  themeCycle: ThemeCycleControls;
}

export const WorkerPoolStatus = memo(function WorkerPoolStatus({
  expanded,
  onToggle,
  scrollRef,
  themeCycle,
}: WorkerPoolStatusProps) {
  const pool = useWorkerPool();
  const [stats, setStats] = useState<WorkerStats | undefined>(undefined);
  useEffect(() => {
    if (pool == null) {
      setStats(undefined);
      return undefined;
    } else {
      return pool.subscribeToStatChanges((newStats) => {
        setStats((prevStats): WorkerStats | undefined => {
          if (areWorkerStatsEqual(prevStats, newStats)) {
            return prevStats;
          }
          return newStats;
        });
      });
    }
  }, [pool]);
  return (
    stats != null && (
      <StatsDisplay
        expanded={expanded}
        onToggle={onToggle}
        stats={stats}
        scrollRef={scrollRef}
        themeCycle={themeCycle}
      />
    )
  );
});

interface StatsDisplayProps {
  expanded: boolean;
  onToggle(): void;
  stats: WorkerStats;
  scrollRef: RefObject<HTMLDivElement | null>;
  themeCycle: ThemeCycleControls;
}

// Map worker pool status to a single icon component + color so the legend row
// and the status indicator share one source of truth.
function getStatusIcon(stats: WorkerStats) {
  if (stats.workersFailed) {
    return { Icon: IconSquircleLgFill, className: 'text-red-400' };
  }
  if (stats.managerState === 'initializing') {
    return { Icon: IconTriangleFill, className: 'text-amber-400' };
  }
  if (stats.managerState === 'initialized') {
    return { Icon: IconCircleFill, className: 'text-green-400' };
  }
  return { Icon: IconCircleFill, className: 'text-muted-foreground' };
}

function StatsDisplay({
  expanded,
  onToggle,
  stats,
  scrollRef,
  themeCycle,
}: StatsDisplayProps) {
  const [isBrrt, setIsBrrt] = useState(false);
  const [scrollTester] = useState(
    () => new AutoScrollTester(scrollRef, setIsBrrt)
  );

  // Mirror the inline (F3) hint with an actual keybinding so the label
  // doesn't lie about how to toggle the panel.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'F3') {
        event.preventDefault();
        onToggle();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onToggle]);

  const { Icon: StatusIcon, className: statusIconClass } = getStatusIcon(stats);

  return (
    <div className="border-border shrink-0 overscroll-contain border-b text-sm md:border-b-0">
      <StatusRow icon={expanded ? IconEyeSlash : IconEye} className="md:pr-0">
        <button
          type="button"
          onClick={onToggle}
          className="text-muted-foreground hover:text-foreground flex min-w-0 flex-1 cursor-pointer items-center gap-1 text-sm focus:outline-none"
          aria-expanded={expanded}
        >
          <span className="truncate">System Monitor</span>
          <span className="text-muted-foreground/50 hidden md:inline">
            (F3)
          </span>
        </button>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <ThemeCycleToggle controls={themeCycle} />
          <button
            type="button"
            onClick={scrollTester.toggleState}
            className="hover:bg-muted/50 hover:text-foreground text-muted-foreground hidden size-5 cursor-pointer items-center justify-center rounded-md transition md:inline-flex"
            title={isBrrt ? 'Pause autoscroll' : 'Start autoscroll'}
            aria-label={isBrrt ? 'Pause autoscroll' : 'Start autoscroll'}
            aria-pressed={isBrrt}
          >
            <AutoScrollToggleIcon running={isBrrt} />
          </button>
          <StatusIcon className={`size-2 shrink-0 ${statusIconClass}`} />
        </div>
      </StatusRow>
      {expanded && (
        <div className="ml-10 md:mr-3">
          <StatItem
            label="Busy Workers"
            value={`${stats.busyWorkers}/${stats.totalWorkers}`}
          />
          <StatItem label="Task Queue" value={stats.queuedTasks} />
          <StatItem label="Rendered Diffs" value={stats.themeSubscribers} />
          <StatItem label="Diff Cache" value={stats.diffCacheSize} />
        </div>
      )}
      <StatusRow icon={IconInfoFill}>
        <div className="text-muted-foreground/75">
          Powered by{' '}
          <Link
            href="https://diffs.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-link text-muted-foreground hover:text-foreground no-underline"
          >
            Diffs
          </Link>{' '}
          and{' '}
          <Link
            href="https://trees.software"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-link text-muted-foreground hover:text-foreground no-underline"
          >
            Trees
          </Link>
        </div>
      </StatusRow>
    </div>
  );
}

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
      className="hover:bg-muted/50 hover:text-foreground text-muted-foreground hidden h-5 cursor-pointer items-center gap-1 rounded-md px-1 text-[10px] leading-none tabular-nums transition md:inline-flex"
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
