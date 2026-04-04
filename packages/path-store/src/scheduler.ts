import {
  getBenchmarkInstrumentation,
  setBenchmarkCounter,
  withBenchmarkPhase,
} from './internal/benchmarkInstrumentation';
import type { PathStoreChildPatch, PathStoreLoadAttempt } from './public-types';
import { PathStore } from './store';

export type PathStoreSchedulerTaskStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'cancelled'
  | 'failed';

export interface PathStoreSchedulerMetrics {
  activeTaskCount: number;
  backlogDepth: number;
  cancelledTaskCount: number;
  completedTaskCount: number;
  failedTaskCount: number;
  rejectedTaskCount: number;
  runningTaskPath: string | null;
  yieldCount: number;
}

export interface PathStoreSchedulerTaskContext {
  attempt: PathStoreLoadAttempt;
  signal: AbortSignal;
  store: PathStore;
}

export interface PathStoreSchedulerTaskDescriptor {
  kind: string;
  payload?: unknown;
}

export interface PathStoreSchedulerTask {
  completeOnSuccess?: boolean;
  createPatch:
    | ((context: PathStoreSchedulerTaskContext) => PathStoreChildPatch)
    | ((
        context: PathStoreSchedulerTaskContext
      ) => Promise<PathStoreChildPatch>);
  descriptor?: PathStoreSchedulerTaskDescriptor;
  path: string;
  priority: number;
  signal?: AbortSignal;
}

export interface PathStoreSchedulerCompletion {
  error?: unknown;
  path: string;
  status: PathStoreSchedulerTaskStatus;
}

export interface PathStoreSchedulerHandle {
  cancel: () => boolean;
  id: number;
  path: string;
  priority: number;
  result: Promise<PathStoreSchedulerCompletion>;
  reused: boolean;
  status: () => PathStoreSchedulerTaskStatus;
}

export type PathStoreSchedulerEnqueueResult =
  | {
      handle: PathStoreSchedulerHandle;
      status: 'queued' | 'reused';
    }
  | {
      reason: 'disposed' | 'queue-overflow';
      status: 'rejected';
    };

export interface PathStoreSchedulerOptions {
  chunkBudgetMs?: number;
  maxQueueSize?: number;
  maxTasksPerSlice?: number;
  store: PathStore;
  yieldDelayMs?: number;
}

export interface PathStoreScheduler {
  cancel: (handleOrPath: PathStoreSchedulerHandle | string) => boolean;
  dispose: () => void;
  enqueue: (task: PathStoreSchedulerTask) => PathStoreSchedulerEnqueueResult;
  getMetrics: () => PathStoreSchedulerMetrics;
  subscribe: (
    listener: (metrics: PathStoreSchedulerMetrics) => void
  ) => () => void;
  whenIdle: () => Promise<void>;
}

interface InternalTask {
  abortController: AbortController;
  completion: Promise<PathStoreSchedulerCompletion>;
  completeOnSuccess?: boolean;
  descriptor?: PathStoreSchedulerTaskDescriptor;
  id: number;
  path: string;
  priority: number;
  resolveCompletion: (completion: PathStoreSchedulerCompletion) => void;
  run:
    | ((context: PathStoreSchedulerTaskContext) => PathStoreChildPatch)
    | ((
        context: PathStoreSchedulerTaskContext
      ) => Promise<PathStoreChildPatch>);
  signal?: AbortSignal;
  status: PathStoreSchedulerTaskStatus;
}

const DEFAULT_CHUNK_BUDGET_MS = 8;
const DEFAULT_MAX_QUEUE_SIZE = 256;
const DEFAULT_MAX_TASKS_PER_SLICE = 1;

// Keeps caller-supplied priority ordering stable without resorting the full
// queue after every enqueue.
function insertQueuedTask(queue: InternalTask[], task: InternalTask): void {
  let insertIndex = queue.length;
  while (insertIndex > 0) {
    const previousTask = queue[insertIndex - 1];
    if (previousTask.priority > task.priority) {
      break;
    }

    if (previousTask.priority === task.priority && previousTask.id < task.id) {
      break;
    }

    insertIndex -= 1;
  }

  queue.splice(insertIndex, 0, task);
}

// External AbortSignals can cancel work before or during a slice, so treat the
// internal scheduler signal and caller signal as one combined cancellation gate.
function isTaskAborted(task: InternalTask): boolean {
  return task.abortController.signal.aborted || task.signal?.aborted === true;
}

function waitForTaskAbort(task: InternalTask): Promise<void> {
  if (isTaskAborted(task)) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const cleanup = () => {
      task.abortController.signal.removeEventListener('abort', handleAbort);
      task.signal?.removeEventListener('abort', handleAbort);
    };

    const handleAbort = () => {
      cleanup();
      resolve();
    };

    task.abortController.signal.addEventListener('abort', handleAbort, {
      once: true,
    });
    task.signal?.addEventListener('abort', handleAbort, {
      once: true,
    });
  });
}

export function createPathStoreScheduler(
  options: PathStoreSchedulerOptions
): PathStoreScheduler {
  const instrumentation = getBenchmarkInstrumentation(options);
  const listeners = new Set<(metrics: PathStoreSchedulerMetrics) => void>();
  const queue: InternalTask[] = [];
  const taskByPath = new Map<string, InternalTask>();
  const idleResolvers = new Set<() => void>();
  let activeTaskCount = 0;
  let cancelledTaskCount = 0;
  let completedTaskCount = 0;
  let failedTaskCount = 0;
  let rejectedTaskCount = 0;
  let runningTaskPath: string | null = null;
  let yieldCount = 0;
  let disposed = false;
  let drainScheduled = false;
  let drainActive = false;
  let nextTaskId = 1;

  const chunkBudgetMs = options.chunkBudgetMs ?? DEFAULT_CHUNK_BUDGET_MS;
  const maxQueueSize = options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE;
  const maxTasksPerSlice =
    options.maxTasksPerSlice ?? DEFAULT_MAX_TASKS_PER_SLICE;

  function getMetrics(): PathStoreSchedulerMetrics {
    return {
      activeTaskCount,
      backlogDepth: queue.length,
      cancelledTaskCount,
      completedTaskCount,
      failedTaskCount,
      rejectedTaskCount,
      runningTaskPath,
      yieldCount,
    };
  }

  function notify(): void {
    const metrics = getMetrics();
    setBenchmarkCounter(
      instrumentation,
      'scheduler.queueDepth',
      metrics.backlogDepth
    );
    setBenchmarkCounter(
      instrumentation,
      'scheduler.yieldCount',
      metrics.yieldCount
    );
    setBenchmarkCounter(
      instrumentation,
      'scheduler.cancelledTaskCount',
      metrics.cancelledTaskCount
    );
    setBenchmarkCounter(
      instrumentation,
      'scheduler.rejectedTaskCount',
      metrics.rejectedTaskCount
    );
    setBenchmarkCounter(
      instrumentation,
      'scheduler.activeTaskCount',
      metrics.activeTaskCount
    );
    setBenchmarkCounter(
      instrumentation,
      'scheduler.completedTaskCount',
      metrics.completedTaskCount
    );
    setBenchmarkCounter(
      instrumentation,
      'scheduler.failedTaskCount',
      metrics.failedTaskCount
    );
    for (const listener of listeners) {
      listener(metrics);
    }

    if (!drainActive && queue.length === 0 && activeTaskCount === 0) {
      for (const resolve of idleResolvers) {
        resolve();
      }
      idleResolvers.clear();
    }
  }

  async function yieldToMainThread(): Promise<void> {
    yieldCount += 1;
    notify();
    await new Promise((resolve) =>
      setTimeout(resolve, options.yieldDelayMs ?? 0)
    );
  }

  function scheduleDrain(): void {
    if (drainScheduled || disposed) {
      return;
    }

    drainScheduled = true;
    queueMicrotask(() => {
      drainScheduled = false;
      void drainQueue();
    });
  }

  function settleTask(
    task: InternalTask,
    completion: PathStoreSchedulerCompletion
  ): void {
    if (
      task.status === 'cancelled' ||
      task.status === 'completed' ||
      task.status === 'failed'
    ) {
      return;
    }

    task.status = completion.status;
    taskByPath.delete(task.path);
    switch (completion.status) {
      case 'cancelled':
        cancelledTaskCount += 1;
        break;
      case 'completed':
        completedTaskCount += 1;
        break;
      case 'failed':
        failedTaskCount += 1;
        break;
      case 'queued':
      case 'running':
        break;
    }
    task.resolveCompletion(completion);
    notify();
  }

  async function runTask(task: InternalTask): Promise<void> {
    task.status = 'running';
    activeTaskCount += 1;
    runningTaskPath = task.path;
    notify();

    let attempt: PathStoreLoadAttempt | null = null;

    try {
      if (isTaskAborted(task)) {
        settleTask(task, {
          path: task.path,
          status: 'cancelled',
        });
        return;
      }

      attempt = withBenchmarkPhase(instrumentation, 'scheduler.begin', () =>
        options.store.beginChildLoad(task.path)
      );

      if (isTaskAborted(task)) {
        withBenchmarkPhase(instrumentation, 'scheduler.cancel', () => {
          options.store.failChildLoad(
            attempt as PathStoreLoadAttempt,
            'cancelled'
          );
        });
        settleTask(task, {
          path: task.path,
          status: 'cancelled',
        });
        return;
      }

      const patch = await withBenchmarkPhase(
        instrumentation,
        'scheduler.createPatch',
        async () => {
          const patchPromise = Promise.resolve(
            task.run({
              attempt: attempt as PathStoreLoadAttempt,
              signal: task.abortController.signal,
              store: options.store,
            })
          );
          const result = await Promise.race([
            patchPromise.then(
              (patch) => ({
                kind: 'patch' as const,
                patch,
              }),
              (error) => ({
                error,
                kind: 'error' as const,
              })
            ),
            waitForTaskAbort(task).then(() => ({
              kind: 'aborted' as const,
            })),
          ]);

          if (result.kind === 'aborted') {
            void patchPromise.catch(() => undefined);
            return null;
          }

          if (result.kind === 'error') {
            throw result.error;
          }

          return result.patch;
        }
      );

      if (patch == null || isTaskAborted(task)) {
        withBenchmarkPhase(instrumentation, 'scheduler.cancel', () => {
          options.store.failChildLoad(
            attempt as PathStoreLoadAttempt,
            'cancelled'
          );
        });
        settleTask(task, {
          path: task.path,
          status: 'cancelled',
        });
        return;
      }

      withBenchmarkPhase(instrumentation, 'scheduler.apply', () => {
        options.store.applyChildPatch(attempt as PathStoreLoadAttempt, patch);
      });
      if (task.completeOnSuccess !== false) {
        withBenchmarkPhase(instrumentation, 'scheduler.complete', () => {
          options.store.completeChildLoad(attempt as PathStoreLoadAttempt);
        });
      }
      settleTask(task, {
        path: task.path,
        status: 'completed',
      });
    } catch (error) {
      if (attempt != null) {
        withBenchmarkPhase(instrumentation, 'scheduler.fail', () => {
          options.store.failChildLoad(
            attempt as PathStoreLoadAttempt,
            error instanceof Error ? error.message : String(error)
          );
        });
      }
      settleTask(task, {
        error,
        path: task.path,
        status: 'failed',
      });
    } finally {
      activeTaskCount -= 1;
      runningTaskPath = null;
      notify();
    }
  }

  async function drainQueue(): Promise<void> {
    if (drainActive || disposed) {
      return;
    }

    drainActive = true;
    notify();

    try {
      while (!disposed && queue.length > 0) {
        const sliceStartedAt = performance.now();
        let processedTaskCount = 0;

        // chunkBudgetMs is wall time between yields. Awaited createPatch work
        // stays inside the same slice budget, so one slow async task can still
        // stretch the slice even when maxTasksPerSlice is greater than one.
        while (
          !disposed &&
          queue.length > 0 &&
          processedTaskCount < maxTasksPerSlice &&
          (processedTaskCount === 0 ||
            performance.now() - sliceStartedAt < chunkBudgetMs)
        ) {
          const task = queue.shift();
          if (task == null) {
            break;
          }

          if (isTaskAborted(task)) {
            taskByPath.delete(task.path);
            settleTask(task, {
              path: task.path,
              status: 'cancelled',
            });
            continue;
          }

          await runTask(task);
          processedTaskCount += 1;
        }

        if (!disposed && queue.length > 0) {
          await withBenchmarkPhase(instrumentation, 'scheduler.yield', () =>
            yieldToMainThread()
          );
        }
      }
    } finally {
      drainActive = false;
      notify();
    }
  }

  function cancelTask(task: InternalTask): boolean {
    if (task.status === 'completed' || task.status === 'failed') {
      return false;
    }

    task.abortController.abort();
    if (task.status === 'queued') {
      const queueIndex = queue.findIndex(
        (queuedTask) => queuedTask.id === task.id
      );
      if (queueIndex >= 0) {
        queue.splice(queueIndex, 1);
      }
      settleTask(task, {
        path: task.path,
        status: 'cancelled',
      });
    }
    notify();
    return true;
  }

  return {
    cancel(handleOrPath) {
      const path =
        typeof handleOrPath === 'string' ? handleOrPath : handleOrPath.path;
      const task = taskByPath.get(path);
      if (task == null) {
        return false;
      }
      return cancelTask(task);
    },

    dispose() {
      disposed = true;
      for (const task of taskByPath.values()) {
        task.abortController.abort();
      }
      for (const task of queue.splice(0)) {
        settleTask(task, {
          path: task.path,
          status: 'cancelled',
        });
      }
      notify();
    },

    enqueue(task) {
      return withBenchmarkPhase(instrumentation, 'scheduler.enqueue', () => {
        if (disposed) {
          rejectedTaskCount += 1;
          notify();
          return {
            reason: 'disposed' as const,
            status: 'rejected' as const,
          };
        }

        const existingTask = taskByPath.get(task.path);
        if (existingTask != null) {
          return {
            handle: createHandle(existingTask, true),
            status: 'reused' as const,
          };
        }

        if (queue.length >= maxQueueSize) {
          rejectedTaskCount += 1;
          notify();
          return {
            reason: 'queue-overflow' as const,
            status: 'rejected' as const,
          };
        }

        const abortController = new AbortController();
        let resolveCompletion!: (
          completion: PathStoreSchedulerCompletion
        ) => void;
        const result = new Promise<PathStoreSchedulerCompletion>((resolve) => {
          resolveCompletion = resolve;
        });

        const internalTask: InternalTask = {
          abortController,
          completion: result,
          completeOnSuccess: task.completeOnSuccess,
          descriptor: task.descriptor,
          id: nextTaskId++,
          path: task.path,
          priority: task.priority,
          resolveCompletion,
          run: task.createPatch,
          signal: task.signal,
          status: 'queued',
        };

        taskByPath.set(internalTask.path, internalTask);
        insertQueuedTask(queue, internalTask);
        notify();
        scheduleDrain();

        return {
          handle: createHandle(internalTask, false),
          status: 'queued' as const,
        };
      });
    },

    getMetrics() {
      return getMetrics();
    },

    subscribe(listener) {
      listeners.add(listener);
      listener(getMetrics());
      return () => {
        listeners.delete(listener);
      };
    },

    whenIdle() {
      if (!drainActive && queue.length === 0 && activeTaskCount === 0) {
        return Promise.resolve();
      }

      return new Promise<void>((resolve) => {
        idleResolvers.add(resolve);
      });
    },
  };

  function createHandle(
    task: InternalTask,
    reused: boolean
  ): PathStoreSchedulerHandle {
    return {
      cancel: () => cancelTask(task),
      id: task.id,
      path: task.path,
      priority: task.priority,
      result: task.completion,
      reused,
      status: () => task.status,
    };
  }
}
