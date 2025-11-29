'use client';

import {
  type Context,
  type ReactNode,
  createContext,
  useContext,
  useState,
} from 'react';
import {
  type SetupWorkerPoolProps,
  type ShikiPoolManager,
  type WorkerHighlighterOptions,
  type WorkerPoolOptions,
  getOrCreateWorkerPoolSingleton,
} from 'src/worker';

export type { WorkerPoolOptions, WorkerHighlighterOptions };

export const WorkerPoolContext: Context<ShikiPoolManager | undefined> =
  createContext<ShikiPoolManager | undefined>(undefined);

interface WorkerPoolContextProps extends SetupWorkerPoolProps {
  children: ReactNode;
}

export function WorkerPoolContextProvider({
  children,
  poolOptions,
  highlighterOptions,
}: WorkerPoolContextProps): React.JSX.Element {
  const [poolManager] = useState(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }
    return getOrCreateWorkerPoolSingleton({
      poolOptions,
      highlighterOptions,
    });
  });
  return (
    <WorkerPoolContext.Provider value={poolManager}>
      {children}
    </WorkerPoolContext.Provider>
  );
}

export function useWorkerPool(): ShikiPoolManager | undefined {
  return useContext(WorkerPoolContext);
}
