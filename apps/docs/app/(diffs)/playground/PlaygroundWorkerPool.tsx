'use client';

import type { HighlighterTypes } from '@pierre/diffs';
import { WorkerPoolContext } from '@pierre/diffs/react';
import { WorkerPoolManager } from '@pierre/diffs/worker';
import { type ReactNode, useEffect, useState } from 'react';

// Each selection owns its workers so changing backends cannot reuse old results.
export function PlaygroundWorkerPool({
  highlighter,
  children,
}: {
  highlighter: HighlighterTypes;
  children: ReactNode;
}) {
  const [pool, setPool] = useState<WorkerPoolManager>();
  useEffect(() => {
    const manager = new WorkerPoolManager(
      {
        poolSize: Math.min(
          3,
          Math.max(1, (navigator.hardwareConcurrency ?? 2) - 1)
        ),
        workerFactory: () =>
          new Worker(
            new URL('@pierre/diffs/worker/worker.js', import.meta.url)
          ),
      },
      { preferredHighlighter: highlighter, useTokenTransformer: true }
    );
    let cancelled = false;
    void manager
      .initialize()
      .then(() => {
        if (!cancelled) setPool(manager);
      })
      .catch((error: unknown) => console.error(error));
    return () => {
      cancelled = true;
      manager.terminate();
    };
  }, [highlighter]);
  return (
    <WorkerPoolContext.Provider
      value={pool?.getPreferredHighlighter() === highlighter ? pool : undefined}
    >
      {children}
    </WorkerPoolContext.Provider>
  );
}
