'use client';

import {
  type WorkerInitializationRenderOptions,
  WorkerPoolContextProvider,
  type WorkerPoolOptions,
} from '@pierre/diffs/react';
import type { ReactNode } from 'react';

const PoolOptions: WorkerPoolOptions = {
  // We really shouldn't let the pool get too big...
  poolSize: Math.min(
    Math.max(1, (global.navigator?.hardwareConcurrency ?? 1) - 1),
    3
  ),
  workerFactory() {
    return new Worker(
      new URL('@pierre/diffs/worker/worker.js', import.meta.url)
    );
  },
};

const HighlighterOptions: WorkerInitializationRenderOptions = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  langs: ['zig', 'typescript', 'tsx', 'css', 'sh'],
};

interface WorkerPoolProps {
  children: ReactNode;
}

export function WorkerPoolContext({ children }: WorkerPoolProps) {
  return (
    <WorkerPoolContextProvider
      poolOptions={PoolOptions}
      highlighterOptions={HighlighterOptions}
    >
      {children}
    </WorkerPoolContextProvider>
  );
}
