import { ShikiPoolManager } from './ShikiPoolManager';
import type { WorkerHighlighterOptions, WorkerPoolOptions } from './types';

let managerSingleton: ShikiPoolManager | undefined;

export interface SetupWorkerPoolProps {
  poolOptions: WorkerPoolOptions;
  highlighterOptions: WorkerHighlighterOptions;
}

export async function setupWorkerPoolSingleton({
  poolOptions,
  highlighterOptions,
}: SetupWorkerPoolProps): Promise<ShikiPoolManager> {
  // FIXME(amadeus): We should probably do some shenans here to allow us to
  // update/preload themes and what not
  managerSingleton ??= new ShikiPoolManager(poolOptions, highlighterOptions);
  return await managerSingleton.initialize();
}

// NOTE(amadeus): Might be slick to have some getter in here that has stuff
// just automatically use the singleton if it exists?
