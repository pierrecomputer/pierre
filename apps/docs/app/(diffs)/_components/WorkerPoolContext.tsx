'use client';

import { DEFAULT_THEMES } from '@pierre/diffs';
import {
  type WorkerInitializationRenderOptions,
  WorkerPoolContextProvider,
  type WorkerPoolOptions,
} from '@pierre/diffs/react';
import type { ReactNode } from 'react';

import { getPreferredHighlighter } from '@/lib/preferredHighlighter';

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

const WorkerResourceLimits = getWorkerResourceLimits();

// Files and diffs up to this many characters highlight on the main thread,
// where highlights finishes faster than a worker round trip.
export const MAIN_THREAD_MAX_CHARACTERS = 100_000;

const PoolOptions: WorkerPoolOptions = {
  // We really shouldn't let the pool get too big...
  poolSize: Math.min(
    Math.max(1, (global.navigator?.hardwareConcurrency ?? 1) - 1),
    WorkerResourceLimits.poolSize
  ),
  totalASTLRUCacheSize: WorkerResourceLimits.totalASTLRUCacheSize,
  // The shiki-js fallback leaves this unset so every
  // highlight goes through a worker.
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

const SITE = process.env.NEXT_PUBLIC_SITE;

const HighlighterOptions: WorkerInitializationRenderOptions = {
  preferredHighlighter: getPreferredHighlighter(),
  // diffshub intentionally previews on the soft Pierre pair (a deliberate
  // product choice) even though the canonical default is the non-soft pair.
  // Every other site preloads the shared default.
  theme:
    SITE === 'diffshub'
      ? { dark: 'pierre-dark-soft', light: 'pierre-light-soft' }
      : DEFAULT_THEMES,
  langs: [
    'cpp',
    'css',
    'go',
    'markdown',
    'python',
    'rust',
    'sh',
    'swift',
    'tsx',
    'typescript',
    'zig',
  ],
  useTokenTransformer: true,
};

interface WorkerPoolProps {
  children: ReactNode;
  highlighterOptions?: WorkerInitializationRenderOptions;
  poolOptions?: WorkerPoolOptions;
}

export function WorkerPoolContext({
  children,
  highlighterOptions = HighlighterOptions,
  poolOptions = PoolOptions,
}: WorkerPoolProps) {
  return (
    <WorkerPoolContextProvider
      poolOptions={poolOptions}
      highlighterOptions={highlighterOptions}
    >
      {children}
    </WorkerPoolContextProvider>
  );
}
