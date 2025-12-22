'use client';

import { areWorkerStatsEqual } from '@pierre/diffs';
import { useWorkerPool } from '@pierre/diffs/react';
import type { WorkerStats } from '@pierre/diffs/worker';
import { useEffect, useState } from 'react';

export function WorkerPoolStatus() {
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
    <div className="fixed right-0 bottom-0 pr-4 pb-4">
      {stats == null ? 'initializing' : <StatsDisplay stats={stats} />}
    </div>
  );
}

interface StatItemProps {
  label: string;
  value: string | number;
}

function StatItem({ label, value }: StatItemProps) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-400">{label}:</span>
      <span className="min-w-[3c] pl-[1ch] text-right text-white tabular-nums">
        {value}
      </span>
    </div>
  );
}

interface StatsDisplayProps {
  stats: WorkerStats;
}

function StatsDisplay({ stats }: StatsDisplayProps) {
  const getStatusColor = () => {
    if (stats.workersFailed) return 'bg-red-500';
    if (stats.managerState === 'initialized') return 'bg-green-500';
    if (stats.managerState === 'initializing') return 'bg-yellow-500';
    return 'bg-gray-500';
  };

  const getStatusText = () => {
    if (stats.workersFailed) return 'failed';
    return stats.managerState;
  };

  return (
    <div
      className="rounded-lg border border-gray-700 bg-gray-900/95 px-3 py-2 text-xs shadow-lg"
      style={{ fontFamily: 'var(--font-berkeley-mono)' }}
    >
      <div className="mb-3 flex items-center justify-between gap-2 border-b border-gray-700 pb-2">
        <div className="flex items-center gap-2">
          <div className={`h-2 w-2 rounded-full ${getStatusColor()}`}></div>
          <span className="font-medium text-gray-300">Worker Pool</span>
        </div>
        <span className="text-gray-500">({getStatusText()})</span>
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
