'use client';

import { DEFAULT_THEMES } from '@pierre/diffs';
import { WorkerPoolContext } from '@pierre/diffs/react';
import {
  getOrCreateWorkerPoolSingleton,
  type WorkerInitializationRenderOptions,
  type WorkerPoolManager,
  type WorkerPoolOptions,
} from '@pierre/diffs/worker';
import { type ReactNode, useState } from 'react';

import { canUseWasm } from '@/lib/canUseWasm';

const HighlighterOptions: WorkerInitializationRenderOptions = {
  theme: DEFAULT_THEMES,
  langs: [
    'cpp',
    'css',
    'go',
    'python',
    'rust',
    'sh',
    'swift',
    'tsx',
    'typescript',
    'zig',
  ],
  // highlights and shiki-wasm both need WebAssembly.
  preferredHighlighter: 'shiki-js',
};

// Provides a shiki-js worker pool only when WebAssembly is unavailable
export function WorkerPoolFallback({ children }: { children: ReactNode }) {
  const [poolManager] = useState((): WorkerPoolManager | undefined => {
    if (typeof window === 'undefined' || canUseWasm()) {
      return undefined;
    }
    return getOrCreateWorkerPoolSingleton({
      poolOptions: getPoolOptions(),
      highlighterOptions: HighlighterOptions,
    });
  });
  return (
    <WorkerPoolContext.Provider value={poolManager}>
      {children}
    </WorkerPoolContext.Provider>
  );
}

function isMobileBrowser(): boolean {
  const navigator = global.navigator;
  if (navigator == null) {
    return false;
  }

  return (
    navigator.maxTouchPoints > 0 &&
    global.matchMedia?.('(max-width: 767px), (pointer: coarse)').matches ===
      true
  );
}

function getWorkerResourceLimits(): Pick<
  Required<WorkerPoolOptions>,
  'poolSize' | 'totalASTLRUCacheSize'
> {
  return isMobileBrowser()
    ? { poolSize: 1, totalASTLRUCacheSize: 10 }
    : { poolSize: 3, totalASTLRUCacheSize: 100 };
}

// Built lazily so the browser globals are only read when a pool is created.
function getPoolOptions(): WorkerPoolOptions {
  const limits = getWorkerResourceLimits();
  return {
    // We really shouldn't let the pool get too big...
    poolSize: Math.min(
      Math.max(1, (global.navigator?.hardwareConcurrency ?? 1) - 1),
      limits.poolSize
    ),
    totalASTLRUCacheSize: limits.totalASTLRUCacheSize,
    workerFactory() {
      return new Worker(
        new URL('@pierre/diffs/worker/worker.js', import.meta.url)
      );
    },
  };
}
