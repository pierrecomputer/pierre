import {
  type ShikiPoolManager,
  type WorkerHighlighterOptions,
  setupWorkerPoolSingleton,
} from '@pierre/precision-diffs/worker';
import ShikiWorkerUrl from '@pierre/precision-diffs/worker/shiki-worker.js?worker&url';

export async function createWorkerAPI(
  highlighterOptions: WorkerHighlighterOptions
): Promise<ShikiPoolManager> {
  return await setupWorkerPoolSingleton({
    poolOptions: {
      workerFactory() {
        return new Worker(ShikiWorkerUrl, { type: 'module' });
      },
    },
    highlighterOptions,
  });
}
