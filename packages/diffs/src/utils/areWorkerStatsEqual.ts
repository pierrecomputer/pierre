import type { WorkerStats } from '../worker';

export function areWorkerStatsEqual(
  statsA: WorkerStats | undefined,
  statsB: WorkerStats | undefined
): boolean {
  if (statsA == null || statsB == null) {
    return statsA === statsB;
  }
  return (
    statsA.busyWorkers === statsB.busyWorkers &&
    statsA.diffCacheSize === statsB.diffCacheSize &&
    statsA.fileCacheSize === statsB.fileCacheSize &&
    statsA.managerState === statsB.managerState &&
    statsA.pendingTasks === statsB.pendingTasks &&
    statsA.queuedTasks === statsB.queuedTasks &&
    statsA.themeSubscribers === statsB.themeSubscribers &&
    statsA.totalWorkers === statsB.totalWorkers &&
    statsA.workersFailed === statsB.workersFailed
  );
}
