import type { WorkerPoolManager } from '../worker';

/**
 * Whether a surface's highlighting goes through its pool's workers. A pool
 * that failed, or that highlights on the main thread (see
 * `WorkerPoolManager.highlightsOnMainThread`), leaves highlighting to the
 * surface's local highlighter, which still uses the pool's render options.
 */
export function highlightsInWorkers(
  workerManager: WorkerPoolManager | undefined
): boolean {
  return (
    workerManager?.isWorkingPool() === true &&
    !workerManager.highlightsOnMainThread
  );
}
