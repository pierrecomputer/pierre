import type { WorkerInitializationRenderOptions } from '../../worker/types.js';
import { WorkerPoolManager } from '../../worker/WorkerPoolManager.js';

let sharedPool: WorkerPoolManager | undefined;
let references = 0;

export function acquireReviewWorkerPool(
  options: WorkerInitializationRenderOptions = {}
): WorkerPoolManager | undefined {
  if (typeof Worker === 'undefined') {
    return undefined;
  }

  references += 1;
  if (sharedPool != null) {
    return sharedPool;
  }

  try {
    sharedPool = new WorkerPoolManager(
      {
        workerFactory: () =>
          new Worker(
            new URL('../../worker/worker-portable.js', import.meta.url),
            { type: 'module' }
          ),
      },
      options
    );
    return sharedPool;
  } catch {
    references -= 1;
    sharedPool = undefined;
    return undefined;
  }
}

export function releaseReviewWorkerPool(): void {
  references = Math.max(0, references - 1);
  if (references === 0) {
    sharedPool?.terminate();
    sharedPool = undefined;
  }
}
