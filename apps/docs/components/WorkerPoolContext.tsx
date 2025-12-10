'use client';

import {
  type WorkerInitializationRenderOptions,
  WorkerPoolContextProvider,
  type WorkerPoolOptions,
} from '@pierre/diffs/react';
import type { ReactNode } from 'react';

const PoolOptions: WorkerPoolOptions = {
  poolSize: Math.max(1, navigator.hardwareConcurrency - 1),
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
