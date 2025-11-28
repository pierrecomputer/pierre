import type { SupportedLanguages } from '../types';
import { getFiletypeFromFileName } from '../utils/getFiletypeFromFileName';
import type {
  AllWorkerTasks,
  InitializeWorkerTask,
  RenderDiffMetadataTask,
  RenderDiffResult,
  RenderDiffTask,
  RenderFileResult,
  RenderFileTask,
  SubmitRequest,
  WorkerHighlighterOptions,
  WorkerPoolOptions,
  WorkerRequestId,
  WorkerResponse,
  WorkerStats,
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
  langs: Set<SupportedLanguages>;
}

export class WorkerPool {
  private workers: ManagedWorker[] = [];
  private taskQueue: AllWorkerTasks[] = [];
  private pendingTasks = new Map<WorkerRequestId, AllWorkerTasks>();
  private nextRequestId = 0;

  constructor(
    private options: WorkerPoolOptions,
    private highlighterOptions: WorkerHighlighterOptions
  ) {}

  private initialized: Promise<void> | true | undefined;

  async initialize(): Promise<void> {
    if (this.initialized === true) {
      return;
    } else if (this.initialized != null) {
      return this.initialized;
    }
    const initPromises: Promise<unknown>[] = [];
    for (let i = 0; i < (this.options.poolSize ?? 8); i++) {
      const worker = this.options.workerFactory();
      const managedWorker: ManagedWorker = {
        worker,
        busy: false,
        initialized: false,
        langs: new Set(['text', ...(this.highlighterOptions.langs ?? [])]),
      };
      worker.addEventListener(
        'message',
        (event: MessageEvent<WorkerResponse>) => {
          this.handleWorkerMessage(managedWorker, event.data);
        }
      );
      worker.addEventListener('error', (error) =>
        console.error('Worker error:', error)
      );
      this.workers.push(managedWorker);
      initPromises.push(
        new Promise<void>((resolve, reject) => {
          const requestId = this.generateRequestId();
          const task: InitializeWorkerTask = {
            type: 'initialize',
            id: requestId,
            request: {
              type: 'initialize',
              id: requestId,
              options: this.highlighterOptions,
            },
            resolve() {
              managedWorker.initialized = true;
              resolve();
            },
            reject,
            requestStart: Date.now(),
          };
          this.pendingTasks.set(requestId, task);
          this.executeTask(managedWorker, task);
        })
      );
    }

    this.initialized = Promise.all(initPromises).then(() => undefined);
    await this.initialized;
    this.initialized = true;
  }

  submitTask<T extends RenderDiffResult | RenderFileResult>(
    request: SubmitRequest
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = this.generateRequestId();
      const requestStart = Date.now();
      const task = (() => {
        switch (request.type) {
          case 'file':
            return {
              type: 'file',
              id,
              request: { ...request, id },
              resolve,
              reject,
              requestStart,
            };
          case 'diff-files':
            return {
              type: 'diff-files',
              id,
              request: { ...request, id },
              resolve,
              reject,
              requestStart,
            };
          case 'diff-metadata':
            return {
              type: 'diff-metadata',
              id,
              request: { ...request, id },
              resolve,
              reject,
              requestStart,
            };
        }
      })() as RenderFileTask | RenderDiffTask | RenderDiffMetadataTask;

      this.pendingTasks.set(id, task);

      // Try to execute immediately if a worker is available -- Should we wait
      // a tick for a pool of workers to build before trying again?
      const availableWorker = this.getAvailableWorker(getLangsFromTask(task));
      if (availableWorker != null) {
        this.executeTask(availableWorker, task);
      } else {
        // Queue the task for later
        this.taskQueue.push(task);
      }
    });
  }

  terminate(): void {
    for (const managedWorker of this.workers) {
      managedWorker.worker.terminate();
    }
    this.workers = [];
    this.taskQueue = [];
    this.pendingTasks.clear();
  }

  getStats(): WorkerStats {
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
      console.error(
        'handleWorkerMessage: Received response for unknown task:',
        response
      );
    } else if (response.type === 'error') {
      const error = new Error(response.error);
      if (response.stack) {
        error.stack = response.stack;
      }
      task.reject(error);
    } else {
      try {
        switch (response.requestType) {
          case 'initialize':
            if (task.type !== 'initialize') {
              throw new Error('handleWorkerMessage: task/response dont match');
            }
            task.resolve();
            break;
          case 'file':
            if (task.type !== 'file') {
              throw new Error('handleWorkerMessage: task/response dont match');
            }
            task.resolve(response.result);
            break;
          case 'diff-files':
            if (task.type !== 'diff-files') {
              throw new Error('handleWorkerMessage: task/response dont match');
            }
            task.resolve(response.result);
            break;
          case 'diff-metadata':
            if (task.type !== 'diff-metadata') {
              throw new Error('handleWorkerMessage: task/response dont match');
            }
            task.resolve(response.result);
            break;
        }
      } catch (e) {
        console.error(e, task, response);
      }
    }

    this.pendingTasks.delete(response.id);
    managedWorker.busy = false;
    const nextTask = this.taskQueue.shift();
    if (nextTask != null) {
      this.executeTask(managedWorker, nextTask);
    }
  }

  private executeTask(
    managedWorker: ManagedWorker,
    task: AllWorkerTasks
  ): void {
    managedWorker.busy = true;
    for (const lang of getLangsFromTask(task)) {
      managedWorker.langs.add(lang);
    }
    managedWorker.worker.postMessage(task.request);
  }

  private getAvailableWorker(
    langs: SupportedLanguages[]
  ): ManagedWorker | undefined {
    let worker: ManagedWorker | undefined;
    for (const managedWorker of this.workers) {
      if (managedWorker.busy || !managedWorker.initialized) {
        continue;
      }
      worker = managedWorker;
      if (langs.length === 0) {
        break;
      }
      let hasEveryLang = true;
      for (const lang of langs) {
        if (!managedWorker.langs.has(lang)) {
          hasEveryLang = false;
          break;
        }
      }
      if (hasEveryLang) {
        break;
      }
    }
    return worker;
  }

  private generateRequestId(): WorkerRequestId {
    return `req_${++this.nextRequestId}`;
  }
}

function getLangsFromTask(task: AllWorkerTasks): SupportedLanguages[] {
  const langs = new Set<SupportedLanguages>();
  const options = task.request.options ?? {};
  if ('lang' in options && options.lang != null) {
    langs.add(options.lang);
  } else {
    switch (task.type) {
      case 'file': {
        langs.add(getFiletypeFromFileName(task.request.file.name));
        break;
      }
      case 'diff-files': {
        langs.add(getFiletypeFromFileName(task.request.newFile.name));
        langs.add(getFiletypeFromFileName(task.request.oldFile.name));
        break;
      }
      case 'diff-metadata': {
        langs.add(getFiletypeFromFileName(task.request.diff.name));
        langs.add(getFiletypeFromFileName(task.request.diff.prevName ?? '-'));
        break;
      }
    }
  }
  // We can always assume text is available, so lets not bother with the
  // lookups for it
  langs.delete('text');
  return Array.from(langs);
}
