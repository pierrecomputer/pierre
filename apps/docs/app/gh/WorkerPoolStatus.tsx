'use client';

import {
  areWorkerStatsEqual,
  DEFAULT_CODE_VIEW_FILE_METRICS,
  queueRender,
} from '@pierre/diffs';
import { useWorkerPool } from '@pierre/diffs/react';
import type { WorkerStats } from '@pierre/diffs/worker';
import { memo, type RefObject, useEffect, useState } from 'react';

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
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}:</span>
      <span className="text-foreground min-w-[3c] pl-[1ch] text-right tabular-nums">
        {value}
      </span>
    </div>
  );
}

interface StatsDisplayProps {
  stats: WorkerStats;
  scrollRef: RefObject<HTMLDivElement | null>;
}

function StatsDisplay({ stats, scrollRef }: StatsDisplayProps) {
  const [isBrrt, setIsBrrt] = useState(false);
  const [scrollTester] = useState(
    () => new AutoScrollTester(scrollRef, setIsBrrt)
  );

  const getStatusColor = () => {
    if (stats.workersFailed) return 'bg-destructive';
    if (stats.managerState === 'initialized') return 'bg-emerald-500';
    if (stats.managerState === 'initializing') return 'bg-amber-500';
    return 'bg-muted-foreground';
  };

  return (
    <div
      className="border-border bg-background text-muted-foreground shrink-0 border-t px-3 py-2 text-xs"
      style={{ fontFamily: 'var(--font-berkeley-mono)' }}
    >
      <div className="border-border mb-3 flex items-center justify-between gap-2 border-b pb-2">
        <div className="flex items-center gap-2">
          <div className={`h-2 w-2 rounded-full ${getStatusColor()}`}></div>
          <span className="text-foreground font-medium">CodeView Status</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={scrollTester.toggleState}
            className="text-muted-foreground hover:bg-muted hover:text-foreground -mr-1 flex h-5 cursor-pointer items-center justify-center rounded p-2"
            title={isBrrt ? 'Pause autoscroll' : 'Start autoscroll'}
          >
            {isBrrt ? 'no' : 'go'} brrt {isBrrt ? '⏸' : '▶'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <StatItem
          label="Busy Workers"
          value={`${stats.busyWorkers}/${stats.totalWorkers}`}
        />
        <StatItem label="Task Queue" value={stats.queuedTasks} />
        <StatItem label="Rendered Diffs" value={stats.themeSubscribers} />
        <StatItem label="Diff Cache" value={stats.diffCacheSize} />
      </div>
    </div>
  );
}
