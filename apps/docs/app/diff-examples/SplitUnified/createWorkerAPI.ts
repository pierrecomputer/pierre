'use client';

import {
  type ShikiPoolManager,
  type WorkerHighlighterOptions,
  setupWorkerPoolSingleton,
} from '@pierre/precision-diffs/worker';

export async function createWorkerAPI(
  highlighterOptions: WorkerHighlighterOptions
): Promise<ShikiPoolManager> {
  return await setupWorkerPoolSingleton({
    poolOptions: {
      workerFactory() {
        return new Worker(
          new URL(
            '@pierre/precision-diffs/worker/shiki-worker.js',
            import.meta.url
          )
        );
      },
    },
    highlighterOptions,
  });
}
