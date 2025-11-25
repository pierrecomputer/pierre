import {
  type ShikiPoolManager,
  type WorkerHighlighterOptions,
  getOrCreateWorkerPoolSingleton,
} from '@pierre/precision-diffs/worker';
import ShikiWorkerUrl from '@pierre/precision-diffs/worker/shiki-worker.js?worker&url';

export function createWorkerAPI(
  highlighterOptions: WorkerHighlighterOptions
): ShikiPoolManager {
  return getOrCreateWorkerPoolSingleton({
    poolOptions: {
      workerFactory() {
        return new Worker(ShikiWorkerUrl, { type: 'module' });
      },
    },
    highlighterOptions,
  });
}
