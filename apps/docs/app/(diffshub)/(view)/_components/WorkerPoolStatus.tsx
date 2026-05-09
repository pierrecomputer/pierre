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
  IconSquircleLgFill,
  IconTriangleFill,
} from '@pierre/icons';
import Link from 'next/link';
import {
  type ComponentType,
  memo,
  type ReactNode,
  type RefObject,
  useEffect,
  useState,
} from 'react';

import { cn } from '@/lib/utils';

const NUMBER_FORMATTER = new Intl.NumberFormat('en-US');

class AutoScrollTester {
  static SPEED = 1000;

  private running = false;
  private direction = 1;

  constructor(
    private scrollRef: RefObject<HTMLDivElement | null>,
    private onStateChange?: (running: boolean) => unknown
  ) {}

  start() {
    if (this.running) return;
    this.running = true;
    this.onStateChange?.(true);
    this.render();
  }

  render = () => {
    if (!this.running || this.scrollRef.current == null) return;
    const { scrollHeight, scrollTop } = this.scrollRef.current;
    if (scrollTop <= 0 || scrollTop >= scrollHeight - innerHeight) {
      this.direction *= -1;
    }
    this.scrollRef.current.scrollTo({
      top:
        scrollTop +
        AutoScrollTester.SPEED * this.direction +
        Math.random() * DEFAULT_CODE_VIEW_FILE_METRICS.lineHeight,
    });
    queueRender(this.render);
  };

  stop() {
    this.running = false;
    this.onStateChange?.(false);
  }

  toggleState = () => {
    if (this.running) {
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
}

export const WorkerPoolStatus = memo(function WorkerPoolStatus({
  expanded,
  onToggle,
  scrollRef,
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
      />
    )
  );
});

export interface StatItemProps {
  label: string;
  value: string | number;
  valueClassName?: string;
}

export function StatItem({ label, value, valueClassName }: StatItemProps) {
  const isZero = value === 0 || value === '0';
  const formatted =
    typeof value === 'number' ? NUMBER_FORMATTER.format(value) : value;
  return (
    <div className="border-border/75 flex items-center justify-between border-t py-1 pr-4 text-[12px] md:pr-2">
      <div className="text-muted-foreground">{label}</div>
      <span
        className={cn('pl-[1ch] text-right tabular-nums', valueClassName)}
        style={{
          fontFamily: 'var(--font-berkeley-mono)',
          opacity: isZero ? 0.5 : 1,
        }}
      >
        {formatted}
      </span>
    </div>
  );
}

interface StatsDisplayProps {
  expanded: boolean;
  onToggle(): void;
  stats: WorkerStats;
  scrollRef: RefObject<HTMLDivElement | null>;
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

export interface StatusRowProps {
  icon: ComponentType<{ className?: string }>;
  children: ReactNode;
}

export function StatusRow({ icon: Icon, children }: StatusRowProps) {
  return (
    <div className="text-muted-foreground border-border flex min-w-0 items-center gap-2 border-t px-4 py-2 md:mr-1 md:ml-3 md:px-2">
      <Icon className="size-3 shrink-0 opacity-50" />
      {children}
    </div>
  );
}

function StatsDisplay({
  expanded,
  onToggle,
  stats,
  scrollRef,
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
      <StatusRow icon={expanded ? IconEyeSlash : IconEye}>
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
        <div className="ml-9 md:mr-1">
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
            href="https://trees.com"
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

function AutoScrollToggleIcon({ running }: { running: boolean }) {
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
