'use client';

import type { ThemesType } from '@pierre/diffs';
import { useWorkerPool } from '@pierre/diffs/react';
import { useLayoutEffect } from 'react';

// Keeps the long-lived diffs worker pool on the same light/dark theme pair as
// the themed React surface. Non-worker rendering still receives the pair
// through component options; this hook only covers WorkerPoolContext consumers.
export function useWorkerDiffTheme(theme: ThemesType): void {
  const workerPool = useWorkerPool();
  useLayoutEffect(() => {
    if (workerPool == null) return;
    workerPool.setRenderOptions({ theme }).catch((error: unknown) => {
      console.error('Failed to update the worker pool theme', error);
    });
  }, [theme, workerPool]);
}
