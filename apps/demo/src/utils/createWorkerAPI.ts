import {
  type WorkerInitializationRenderOptions,
  type WorkerPoolManager,
  getOrCreateWorkerPoolSingleton,
} from '@pierre/diffs/worker';
import WorkerUrl from '@pierre/diffs/worker/worker.js?worker&url';

export function createWorkerAPI(
  highlighterOptions: WorkerInitializationRenderOptions
): WorkerPoolManager {
  return getOrCreateWorkerPoolSingleton({
    poolOptions: {
      workerFactory() {
        return new Worker(WorkerUrl, { type: 'module' });
      },
      poolSize: 3,
    },
    highlighterOptions,
  });
}
