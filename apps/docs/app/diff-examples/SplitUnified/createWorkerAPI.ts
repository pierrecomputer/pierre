'use client';

import {
  type ShikiPoolManager,
  type WorkerHighlighterOptions,
  getOrCreateWorkerPoolSingleton,
} from '@pierre/precision-diffs/worker';

export function createWorkerAPI(
  highlighterOptions: WorkerHighlighterOptions
): ShikiPoolManager {
  return getOrCreateWorkerPoolSingleton({
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
