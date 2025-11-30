import {
  type WorkerHighlighterOptions,
  type WorkerPoolManager,
  getOrCreateWorkerPoolSingleton,
} from '@pierre/precision-diffs/worker';
import ShikiWorkerUrl from '@pierre/precision-diffs/worker/shiki-worker.js?worker&url';

export function createWorkerAPI(
  highlighterOptions: WorkerHighlighterOptions
): WorkerPoolManager {
  return getOrCreateWorkerPoolSingleton({
    poolOptions: {
      workerFactory() {
        return new Worker(ShikiWorkerUrl, { type: 'module' });
      },
    },
    highlighterOptions,
  });
}
