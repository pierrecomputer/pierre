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

import { getPreferredHighlighter } from '@/lib/preferredHighlighter';

// Files and diffs up to this many characters highlight on the main thread,
// where highlights finishes faster than a worker round trip.
const MAIN_THREAD_MAX_CHARACTERS = 100_000;

// Provides the diffs worker pool. With WebAssembly the pool runs highlights and
// keeps small files on the main thread. Without it highlights can't load, so
// the pool falls back to shiki-js and every highlight goes through a worker.
export function WorkerPoolProvider({ children }: { children: ReactNode }) {
  const [poolManager] = useState((): WorkerPoolManager | undefined => {
    if (typeof window === 'undefined') {
      return undefined;
    }
    return getOrCreateWorkerPoolSingleton({
      poolOptions: getPoolOptions(),
      highlighterOptions: getHighlighterOptions(),
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
    // The shiki-js fallback leaves this unset so every highlight goes through
    // a worker.
    mainThreadMaxCharacters:
      getPreferredHighlighter() === 'highlights'
        ? MAIN_THREAD_MAX_CHARACTERS
        : undefined,
    workerFactory() {
      return new Worker(
        new URL('@pierre/diffs/worker/worker.js', import.meta.url)
      );
    },
  };
}

function getHighlighterOptions(): WorkerInitializationRenderOptions {
  return {
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
    preferredHighlighter: getPreferredHighlighter(),
  };
}
