'use client';

import {
  type Context,
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useInsertionEffect,
  useState,
} from 'react';
import {
  type SetupWorkerPoolProps,
  type ShikiPoolManager,
  type WorkerHighlighterOptions,
  type WorkerPoolOptions,
  getOrCreateWorkerPoolSingleton,
  terminateWorkerPoolSingleton,
} from 'src/worker';

export type { WorkerPoolOptions, WorkerHighlighterOptions };

export const WorkerPoolContext: Context<ShikiPoolManager | undefined> =
  createContext<ShikiPoolManager | undefined>(undefined);

let instanceCount = 0;

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
  // We use insertion effect for the instance counting to essentially debounce
  // potentially conflicting mount/unmounts
  useInsertionEffect(() => {
    instanceCount++;
    return () => {
      instanceCount--;
    };
  }, []);
  useEffect(() => {
    return () => {
      if (instanceCount === 0) {
        terminateWorkerPoolSingleton();
      }
    };
  }, []);
  return (
    <WorkerPoolContext.Provider value={poolManager}>
      {children}
    </WorkerPoolContext.Provider>
  );
}

export function useWorkerPool(): ShikiPoolManager | undefined {
  return useContext(WorkerPoolContext);
}
