import type { ElementContent } from 'hast';

import type { FileContents, FileDiffMetadata } from '../types';
import { WorkerPool } from './WorkerPool';
import type {
  RenderDiffResult,
  RenderFileResult,
  RenderOptions,
  WorkerPoolOptions,
  WorkerStats,
} from './types';

export class ShikiPoolManager {
  private pool: WorkerPool | undefined;
  private workerFactory: () => Worker;
  private options: WorkerPoolOptions | undefined;

  constructor(workerFactory: () => Worker, options: WorkerPoolOptions) {
    this.workerFactory = workerFactory;
    this.options = options;
  }

  async ensureInitialized(): Promise<WorkerPool> {
    this.pool ??= new WorkerPool(this.workerFactory, this.options);
    await this.pool.initialize();
    return this.pool;
  }

  async renderFileToHast(
    file: FileContents,
    options?: RenderOptions
  ): Promise<ElementContent[]> {
    const pool = await this.ensureInitialized();
    const { lines } = await pool.submitTask<RenderFileResult>({
      type: 'file',
      file,
      options,
    });
    return lines;
  }

  async renderDiffToHast(
    oldFile: FileContents,
    newFile: FileContents,
    options?: RenderOptions
  ): Promise<RenderDiffResult> {
    const pool = await this.ensureInitialized();
    return pool.submitTask<RenderDiffResult>({
      type: 'diff-files',
      oldFile,
      newFile,
      options,
    });
  }

  async renderDiffMetadataToHast(
    diff: FileDiffMetadata,
    options?: RenderOptions
  ): Promise<RenderDiffResult> {
    const pool = await this.ensureInitialized();
    return pool.submitTask<RenderDiffResult>({
      type: 'diff-metadata',
      diff,
      options,
    });
  }

  terminate(): void {
    if (this.pool != null) {
      this.pool.terminate();
      this.pool = undefined;
    }
  }

  getStats(): WorkerStats {
    return (
      this.pool?.getStats() ?? {
        totalWorkers: 0,
        busyWorkers: 0,
        queuedTasks: 0,
        pendingTasks: 0,
      }
    );
  }
}
