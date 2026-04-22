import type {
  WorkerInitializationRenderOptions,
  WorkerPoolOptions,
} from './types';
import { WorkerPoolManager } from './WorkerPoolManager';

let workerPoolSingleton: WorkerPoolManager | undefined;

export interface SetupWorkerPoolProps {
  poolOptions: WorkerPoolOptions;
  highlighterOptions: WorkerInitializationRenderOptions;
}

export function getOrCreateWorkerPoolSingleton({
  poolOptions,
  highlighterOptions,
}: SetupWorkerPoolProps): WorkerPoolManager {
  workerPoolSingleton ??= new WorkerPoolManager(
    poolOptions,
    highlighterOptions
  );
  return workerPoolSingleton;
}

export function terminateWorkerPoolSingleton(): void {
  if (workerPoolSingleton == null) {
    return;
  }
  workerPoolSingleton.terminate();
  workerPoolSingleton = undefined;
}
