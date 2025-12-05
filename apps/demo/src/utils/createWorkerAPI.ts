import {
  type WorkerHighlighterOptions,
  type WorkerPoolManager,
  getOrCreateWorkerPoolSingleton,
} from '@pierre/precision-diffs/worker';
import WorkerUrl from '@pierre/precision-diffs/worker/worker.js?worker&url';

export function createWorkerAPI(
  highlighterOptions: WorkerHighlighterOptions
): WorkerPoolManager {
  return getOrCreateWorkerPoolSingleton({
    poolOptions: {
      workerFactory() {
        return new Worker(WorkerUrl, { type: 'module' });
      },
      poolSize: 8,
      enableASTCache: true,
    },
    highlighterOptions,
  });
}
