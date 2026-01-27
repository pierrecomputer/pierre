import {
  type WorkerInitializationRenderOptions,
  type WorkerPoolManager,
  getOrCreateWorkerPoolSingleton,
} from '@pierre/diffs/worker';
// oxlint-disable-next-line import/default -- Vite worker URL provides a default export
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
