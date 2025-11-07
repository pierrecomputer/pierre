import {
  ShikiPoolManager,
  type WorkerPoolOptions,
} from '@pierre/precision-diffs/worker';
// Import worker using Vite's special syntax
import ShikiWorkerUrl from '@pierre/precision-diffs/worker/shiki-worker.js?worker&url';

export function createWorkerAPI(
  poolOptions?: WorkerPoolOptions
): ShikiPoolManager {
  return new ShikiPoolManager(
    () => new Worker(ShikiWorkerUrl, { type: 'module' }),
    poolOptions
  );
}
