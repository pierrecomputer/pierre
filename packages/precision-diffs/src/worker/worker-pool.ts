import type {
  RenderDiffResult,
  RenderFileResult,
  WorkerPoolOptions,
  WorkerRequest,
  WorkerRequestId,
  WorkerResponse,
  WorkerTask,
} from './types';

/**
 * Worker Pool Manager
 *
 * Manages a pool of Web Workers for parallel Shiki rendering.
 * Distributes work across workers and handles the request/response lifecycle.
 */

interface ManagedWorker {
  worker: Worker;
  busy: boolean;
  initialized: boolean;
}

export class WorkerPool {
  private workers: ManagedWorker[] = [];
  private taskQueue: WorkerTask[] = [];
  private pendingTasks = new Map<WorkerRequestId, WorkerTask>();
  private nextRequestId = 0;
  private options: Required<WorkerPoolOptions>;

  constructor(
    private workerFactory: () => Worker,
    options: WorkerPoolOptions = {}
  ) {
    this.options = {
      poolSize: options.poolSize ?? 4,
      initOptions: options.initOptions ?? {
        themes: ['pierre-dark', 'pierre-light'],
      },
    };
  }

  /**
   * Initialize the worker pool
   */
  async initialize(): Promise<void> {
    // Create workers
    for (let i = 0; i < this.options.poolSize; i++) {
      const worker = this.workerFactory();
      const managedWorker: ManagedWorker = {
        worker,
        busy: false,
        initialized: false,
      };

      // Set up message handler
      worker.addEventListener(
        'message',
        (event: MessageEvent<WorkerResponse>) => {
          this.handleWorkerMessage(managedWorker, event.data);
        }
      );

      // Set up error handler
      worker.addEventListener('error', (error) => {
        console.error('Worker error:', error);
        // TODO: Implement worker restart logic
      });

      this.workers.push(managedWorker);
    }

    // Initialize all workers
    const initPromises = this.workers.map((managedWorker) => {
      return new Promise<void>((resolve, reject) => {
        const requestId = this.generateRequestId();

        const task: WorkerTask = {
          type: 'initialize',
          id: requestId,
          request: {
            type: 'initialize',
            id: requestId,
            options: this.options.initOptions,
          },
          resolve: () => {
            managedWorker.initialized = true;
            resolve();
          },
          reject,
        };

        this.pendingTasks.set(requestId, task);
        managedWorker.worker.postMessage(task.request);
      });
    });

    await Promise.all(initPromises);
  }

  /**
   * Submit a task to the worker pool
   */
  submitTask<T extends RenderFileResult | RenderDiffResult | void>(
    request: Omit<WorkerRequest, 'id'>
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const requestId = this.generateRequestId();

      const task = (() => {
        switch (request.type) {
          case 'file':
            return {
              type: 'file',
              id: requestId,
              request: { ...request, id: requestId },
              resolve,
              reject,
            };
          case 'diff':
            return {
              type: 'diff',
              id: requestId,
              request: { ...request, id: requestId },
              resolve,
              reject,
            };
          case 'initialize':
            return {
              type: 'initialize',
              id: requestId,
              request: { ...request, id: requestId },
              resolve,
              reject,
            };
        }
      })() as WorkerTask;

      this.pendingTasks.set(requestId, task);

      // Try to execute immediately if a worker is available
      const availableWorker = this.getAvailableWorker();
      if (availableWorker != null) {
        this.executeTask(availableWorker, task);
      } else {
        // Queue the task for later
        this.taskQueue.push(task);
      }
    });
  }

  /**
   * Terminate all workers in the pool
   */
  terminate(): void {
    for (const managedWorker of this.workers) {
      managedWorker.worker.terminate();
    }
    this.workers = [];
    this.taskQueue = [];
    this.pendingTasks.clear();
  }

  /**
   * Get pool statistics
   */
  getStats(): {
    totalWorkers: number;
    busyWorkers: number;
    queuedTasks: number;
    pendingTasks: number;
  } {
    return {
      totalWorkers: this.workers.length,
      busyWorkers: this.workers.filter((w) => w.busy).length,
      queuedTasks: this.taskQueue.length,
      pendingTasks: this.pendingTasks.size,
    };
  }

  private handleWorkerMessage(
    managedWorker: ManagedWorker,
    response: WorkerResponse
  ): void {
    const task = this.pendingTasks.get(response.id);

    if (task == null) {
      console.warn('Received response for unknown task:', response.id);
      return;
    }

    // Remove from pending tasks
    this.pendingTasks.delete(response.id);

    // Handle response using discriminated unions - no casts needed!
    if (response.type === 'error') {
      const error = new Error(response.error);
      if (response.stack) {
        error.stack = response.stack;
      }
      task.reject(error);
    } else if (response.type === 'initialized') {
      if (task.type === 'initialize') {
        task.resolve();
      }
    } else if (response.type === 'success') {
      if (task.type === 'file' && response.requestType === 'render-file') {
        task.resolve(response.result);
      } else if (
        task.type === 'diff' &&
        response.requestType === 'render-diff'
      ) {
        task.resolve(response.result);
      }
    }

    // Mark worker as available
    managedWorker.busy = false;

    // Process next task in queue if any
    const nextTask = this.taskQueue.shift();
    if (nextTask != null) {
      this.executeTask(managedWorker, nextTask);
    }
  }

  private executeTask(managedWorker: ManagedWorker, task: WorkerTask): void {
    managedWorker.busy = true;
    managedWorker.worker.postMessage(task.request);
  }

  private getAvailableWorker(): ManagedWorker | undefined {
    return this.workers.find((worker) => worker.initialized && !worker.busy);
  }

  private generateRequestId(): WorkerRequestId {
    return `req_${++this.nextRequestId}`;
  }
}
