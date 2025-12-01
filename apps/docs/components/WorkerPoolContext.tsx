'use client';

import {
  type WorkerHighlighterOptions,
  WorkerPoolContextProvider,
  type WorkerPoolOptions,
} from '@pierre/precision-diffs/react';
import type { ReactNode } from 'react';

const PoolOptions: WorkerPoolOptions = {
  workerFactory() {
    return new Worker(
      new URL('@pierre/precision-diffs/worker/shiki-worker.js', import.meta.url)
    );
  },
};

const HighlighterOptions: WorkerHighlighterOptions = {
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
