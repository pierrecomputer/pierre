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
  IconFire,
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
  scrollRef: RefObject<HTMLDivElement | null>;
}

export const WorkerPoolStatus = memo(function WorkerPoolStatus({
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
  return stats != null && <StatsDisplay stats={stats} scrollRef={scrollRef} />;
});

interface StatItemProps {
  label: string;
  value: string | number;
}

function StatItem({ label, value }: StatItemProps) {
  const isZero = value === 0 || value === '0';
  return (
    <div className="text-muted-foreground flex justify-between text-sm">
      <span className="font-medium">{label}</span>
      <span
        className="min-w-[3c] pl-[1ch] text-right tabular-nums"
        style={{
          fontFamily: 'var(--font-berkeley-mono)',
          opacity: isZero ? 0.5 : 1,
        }}
      >
        {value}
      </span>
    </div>
  );
}

interface StatsDisplayProps {
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

interface StatusRowProps {
  icon: ComponentType<{ className?: string }>;
  children: ReactNode;
}

function StatusRow({ icon: Icon, children }: StatusRowProps) {
  return (
    <div className="text-muted-foreground border-border mx-2 flex items-center gap-2 border-t p-2">
      <Icon className="size-3 opacity-50" />
      {children}
    </div>
  );
}

function StatsDisplay({ stats, scrollRef }: StatsDisplayProps) {
  const [isBrrt, setIsBrrt] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [scrollTester] = useState(
    () => new AutoScrollTester(scrollRef, setIsBrrt)
  );

  // Mirror the inline (F3) hint with an actual keybinding so the label
  // doesn't lie about how to toggle the panel.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'F3') {
        event.preventDefault();
        setShowStats((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const { Icon: StatusIcon, className: statusIconClass } = getStatusIcon(stats);

  return (
    <div className="shrink-0 text-sm">
      <StatusRow icon={showStats ? IconEyeSlash : IconEye}>
        <button
          type="button"
          onClick={() => setShowStats((prev) => !prev)}
          className="text-muted-foreground hover:text-foreground flex cursor-pointer items-center gap-1"
          aria-expanded={showStats}
        >
          {showStats ? 'Hide' : 'Show'} System Monitor
          <span className="text-muted-foreground/50">(F3)</span>
        </button>
        <div className="ml-auto flex items-center gap-1">
          <StatusIcon className={`size-2 ${statusIconClass}`} />
        </div>
      </StatusRow>
      {showStats && (
        <div className="m-2 grid grid-cols-2 gap-2 rounded-lg bg-neutral-100 p-2 px-2.5">
          <StatItem
            label="Busy Workers"
            value={`${stats.busyWorkers}/${stats.totalWorkers}`}
          />
          <StatItem label="Task Queue" value={stats.queuedTasks} />
          <StatItem label="Rendered Diffs" value={stats.themeSubscribers} />
          <StatItem label="Diff Cache" value={stats.diffCacheSize} />
        </div>
      )}
      <StatusRow icon={IconFire}>
        <button
          onClick={scrollTester.toggleState}
          className="text-muted-foreground hover:text-foreground flex cursor-pointer items-center"
          title={isBrrt ? 'Pause autoscroll' : 'Start autoscroll'}
        >
          {isBrrt ? 'No' : 'Go'} brrrt
        </button>
      </StatusRow>
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
