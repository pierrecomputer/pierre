'use client';

import {
  type Context,
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useInsertionEffect,
  useState,
} from 'react';

import {
  getOrCreateWorkerPoolSingleton,
  type SetupWorkerPoolProps,
  terminateWorkerPoolSingleton,
  type WorkerInitializationRenderOptions,
  type WorkerPoolManager,
  type WorkerPoolOptions,
} from '../worker';

export type { WorkerPoolOptions, WorkerInitializationRenderOptions };

export const WorkerPoolContext: Context<WorkerPoolManager | undefined> =
  createContext<WorkerPoolManager | undefined>(undefined);

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

export function useWorkerPool(): WorkerPoolManager | undefined {
  return useContext(WorkerPoolContext);
}
