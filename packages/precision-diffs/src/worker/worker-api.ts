import type { ElementContent } from 'hast';

import type { FileContents, FileDiffMetadata } from '../types';
import type {
  RenderDiffResult,
  RenderFileResult,
  RenderOptions,
  WorkerPoolOptions,
} from './types';
import { WorkerPool } from './worker-pool';

/**
 * High-level API for using the Shiki worker pool
 *
 * This provides a clean interface for rendering code with Shiki in background threads.
 * The worker pool is lazily initialized on first use.
 */

export interface ShikiWorkerAPI {
  /**
   * Render a single file to HAST using a worker thread
   * Returns an array of line nodes (ElementContent[])
   */
  renderFileToHast(
    file: FileContents,
    options?: RenderOptions
  ): Promise<ElementContent[]>;

  /**
   * Render a diff (old/new file pair) to HAST using a worker thread
   * Returns an object with oldLines and newLines arrays
   */
  renderDiffToHast(
    oldFile: FileContents,
    newFile: FileContents,
    options?: RenderOptions
  ): Promise<RenderDiffResult>;

  renderDiffMetadataToHast(
    diff: FileDiffMetadata,
    options?: RenderOptions
  ): Promise<RenderDiffResult>;

  /**
   * Initialize the worker pool explicitly
   * (optional - pool is auto-initialized on first use)
   */
  initialize(): Promise<void>;

  // Terminate all workers and clean up resources
  terminate(): void;

  getStats(): {
    totalWorkers: number;
    busyWorkers: number;
    queuedTasks: number;
    pendingTasks: number;
  };
}

/**
 * Create a new Shiki Worker API instance
 *
 * The worker script is automatically inlined and created from a Blob URL,
 * so no external worker files are needed.
 *
 * @param workerFactory - Optional factory function to create workers (for advanced use cases)
 * @param poolOptions - Options for configuring the worker pool
 */
export function createShikiWorkerAPI(
  workerFactory?: () => Worker,
  poolOptions?: WorkerPoolOptions
): ShikiWorkerAPI;

/**
 * Create a new Shiki Worker API instance
 *
 * @param poolOptions - Options for configuring the worker pool
 */
export function createShikiWorkerAPI(
  poolOptions?: WorkerPoolOptions
): ShikiWorkerAPI;

export function createShikiWorkerAPI(
  workerFactoryOrOptions?: (() => Worker) | WorkerPoolOptions,
  poolOptionsArg?: WorkerPoolOptions
): ShikiWorkerAPI {
  // Parse overloaded arguments
  const workerFactory =
    typeof workerFactoryOrOptions === 'function'
      ? workerFactoryOrOptions
      : undefined;
  const poolOptions =
    typeof workerFactoryOrOptions === 'object'
      ? workerFactoryOrOptions
      : poolOptionsArg;

  let pool: WorkerPool | undefined;
  let initPromise: Promise<void> | undefined;

  async function ensureInitialized() {
    if (pool == null) {
      pool = new WorkerPool(
        workerFactory ??
          (() => {
            throw new Error(
              'Worker creation not yet implemented. Please provide a workerFactory or use the workerFactory helper from your bundler.'
            );
          }),
        poolOptions
      );
      initPromise = pool.initialize();
    }
    if (initPromise != null) {
      await initPromise;
      initPromise = undefined;
    }
  }

  return {
    async renderFileToHast(file: FileContents, options?: RenderOptions) {
      await ensureInitialized();
      if (pool == null) throw new Error('Worker pool not initialized');

      const result = await pool.submitTask<RenderFileResult>({
        type: 'file',
        file,
        options,
      });

      return result.lines;
    },

    async renderDiffToHast(
      oldFile: FileContents,
      newFile: FileContents,
      options?: RenderOptions
    ) {
      await ensureInitialized();
      if (pool == null) throw new Error('Worker pool not initialized');

      return pool.submitTask<RenderDiffResult>({
        type: 'diff-files',
        oldFile,
        newFile,
        options,
      });
    },

    async renderDiffMetadataToHast(
      diff: FileDiffMetadata,
      options?: RenderOptions
    ) {
      await ensureInitialized();
      if (pool == null) throw new Error('Worker pool not initialized');

      return pool.submitTask<RenderDiffResult>({
        type: 'diff-metadata',
        diff,
        options,
      });
    },

    async initialize() {
      await ensureInitialized();
    },

    terminate() {
      if (pool != null) {
        pool.terminate();
        pool = undefined;
        initPromise = undefined;
      }
    },

    getStats() {
      if (pool == null) {
        return {
          totalWorkers: 0,
          busyWorkers: 0,
          queuedTasks: 0,
          pendingTasks: 0,
        };
      }
      return pool.getStats();
    },
  };
}
