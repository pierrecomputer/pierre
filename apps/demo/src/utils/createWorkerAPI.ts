import {
  type WorkerHighlighterOptions,
  type WorkerPoolManager,
  getOrCreateWorkerPoolSingleton,
} from '@pierre/diffs/worker';
import WorkerUrl from '@pierre/diffs/worker/worker.js?worker&url';

export function createWorkerAPI(
  highlighterOptions: WorkerHighlighterOptions
): WorkerPoolManager {
  return getOrCreateWorkerPoolSingleton({
    poolOptions: {
      workerFactory() {
        return new Worker(WorkerUrl, { type: 'module' });
      },
      poolSize: 8,
    },
    highlighterOptions,
  });
}
