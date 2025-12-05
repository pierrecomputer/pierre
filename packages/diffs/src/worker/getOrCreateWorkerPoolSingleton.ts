import { WorkerPoolManager } from './WorkerPoolManager';
import type { WorkerHighlighterOptions, WorkerPoolOptions } from './types';

let workerPoolSingletone: WorkerPoolManager | undefined;

export interface SetupWorkerPoolProps {
  poolOptions: WorkerPoolOptions;
  highlighterOptions: WorkerHighlighterOptions;
}

export function getOrCreateWorkerPoolSingleton({
  poolOptions,
  highlighterOptions,
}: SetupWorkerPoolProps): WorkerPoolManager {
  if (workerPoolSingletone == null) {
    workerPoolSingletone = new WorkerPoolManager(
      poolOptions,
      highlighterOptions
    );
    void workerPoolSingletone.initialize();
  }
  return workerPoolSingletone;
}

export function terminateWorkerPoolSingleton(): void {
  if (workerPoolSingletone == null) {
    return;
  }
  workerPoolSingletone.terminate();
  workerPoolSingletone = undefined;
}
