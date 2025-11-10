'use client';

import {
  ShikiPoolManager,
  type WorkerPoolOptions,
} from '@pierre/precision-diffs/worker';

let instance: ShikiPoolManager | undefined;

export function createWorkerAPI(poolOptions?: WorkerPoolOptions) {
  instance ??= new ShikiPoolManager(
    () =>
      new Worker(
        new URL(
          '@pierre/precision-diffs/worker/shiki-worker.js',
          import.meta.url
        )
      ),
    poolOptions
  );
  return instance;
}
