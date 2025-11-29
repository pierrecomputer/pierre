import { ShikiPoolManager } from './ShikiPoolManager';
import type { WorkerHighlighterOptions, WorkerPoolOptions } from './types';

let managerSingleton: ShikiPoolManager | undefined;

export interface SetupWorkerPoolProps {
  poolOptions: WorkerPoolOptions;
  highlighterOptions: WorkerHighlighterOptions;
}

export function getOrCreateWorkerPoolSingleton({
  poolOptions,
  highlighterOptions,
}: SetupWorkerPoolProps): ShikiPoolManager {
  if (managerSingleton == null) {
    managerSingleton = new ShikiPoolManager(poolOptions, highlighterOptions);
    void managerSingleton.initialize();
  }
  return managerSingleton;
}

export function terminateWorkerPoolSingleton(): void {
  if (managerSingleton == null) {
    return;
  }
  managerSingleton.terminate();
  managerSingleton = undefined;
}
