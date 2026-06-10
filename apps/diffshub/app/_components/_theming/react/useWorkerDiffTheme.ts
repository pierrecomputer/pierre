'use client';

import type { ThemesType } from '@pierre/diffs';
import { useWorkerPool } from '@pierre/diffs/react';
import { useLayoutEffect } from 'react';

// Keeps the long-lived diffs worker pool on the same light/dark theme pair as
// the themed React surface. Non-worker rendering still receives the pair
// through component options; this hook only covers WorkerPoolContext consumers.
export function useWorkerDiffTheme(theme: ThemesType, disabled: boolean): void {
  const workerPool = useWorkerPool();
  useLayoutEffect(() => {
    if (disabled || workerPool == null) return;
    void workerPool.setRenderOptions({ theme });
  }, [disabled, theme, workerPool]);
}
