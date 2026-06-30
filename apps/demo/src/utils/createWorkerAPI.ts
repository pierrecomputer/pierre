import {
  getOrCreateWorkerPoolSingleton,
  type WorkerInitializationRenderOptions,
  type WorkerPoolManager,
} from '@pierre/diffs/worker';
// oxlint-disable-next-line import/default -- Vite worker URL provides a default export
import WorkerUrl from '@pierre/diffs/worker/worker.js?worker&url';

// HACK(debug): Quick way to test worker initialization failure cases if needed
const FORCE_WORKER_POOL_FAILURE = false;

export function createWorkerAPI(
  highlighterOptions: WorkerInitializationRenderOptions
): WorkerPoolManager {
  return getOrCreateWorkerPoolSingleton({
    poolOptions: {
      workerFactory() {
        if (FORCE_WORKER_POOL_FAILURE) {
          throw new Error('HACK: forced worker pool initialization failure');
        }
        return new Worker(WorkerUrl, { type: 'module' });
      },
      poolSize: 3,
    },
    highlighterOptions,
  });
}
