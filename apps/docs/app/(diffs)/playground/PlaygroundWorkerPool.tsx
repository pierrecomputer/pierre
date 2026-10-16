'use client';

import {
  disposeHighlighter,
  getHighlighterType,
  type HighlighterTypes,
} from '@pierre/diffs';
import { WorkerPoolContext } from '@pierre/diffs/react';
import { WorkerPoolManager } from '@pierre/diffs/worker';
import { createContext, type ReactNode, useEffect, useState } from 'react';

export const PlaygroundHighlighterReadyContext = createContext(true);

// Rendering surfaces must unmount before their highlighter is disposed.
export function PlaygroundWorkerPool({
  highlighter,
  children,
}: {
  highlighter: HighlighterTypes;
  children: ReactNode;
}) {
  // Wait if navigation left a different highlighter type loaded.
  const [readyFor, setReadyFor] = useState<HighlighterTypes | undefined>(() => {
    const active =
      typeof window === 'undefined' ? undefined : getHighlighterType();
    return active == null || active === highlighter ? highlighter : undefined;
  });
  const [pool, setPool] = useState<WorkerPoolManager>();
  useEffect(() => {
    let cancelled = false;
    let manager: WorkerPoolManager | undefined;
    void (async () => {
      setPool(undefined);
      setReadyFor(undefined);
      const active = getHighlighterType();
      if (active != null && active !== highlighter) {
        await disposeHighlighter();
      }
      if (cancelled) return;
      manager = new WorkerPoolManager(
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
      await manager.initialize();
      if (!cancelled) {
        setPool(manager);
        setReadyFor(highlighter);
      }
    })().catch((error: unknown) => console.error(error));
    return () => {
      cancelled = true;
      manager?.terminate();
    };
  }, [highlighter]);
  // Other pages may need a different highlighter type.
  useEffect(
    () => () => {
      void disposeHighlighter();
    },
    []
  );
  return (
    <WorkerPoolContext.Provider
      value={
        readyFor === highlighter &&
        pool?.getPreferredHighlighter() === highlighter
          ? pool
          : undefined
      }
    >
      <PlaygroundHighlighterReadyContext.Provider
        value={readyFor === highlighter}
      >
        {children}
      </PlaygroundHighlighterReadyContext.Provider>
    </WorkerPoolContext.Provider>
  );
}
