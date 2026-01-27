import type {
  WorkerInitializationRenderOptions,
  WorkerPoolOptions,
} from './types';
import { WorkerPoolManager } from './WorkerPoolManager';

let workerPoolSingletone: WorkerPoolManager | undefined;

export interface SetupWorkerPoolProps {
  poolOptions: WorkerPoolOptions;
  highlighterOptions: WorkerInitializationRenderOptions;
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
