// The errors the worker pool settles a promise with when no worker result is
// coming, and the predicates a caller uses to tell them from highlight
// failures. This module imports nothing: the components and renderers of the
// main `@pierre/diffs` entry use the predicates, and importing them from
// `WorkerPoolManager` would pull the pool and its dependencies into that
// bundle.

/** The pool was terminated while the operation was pending. */
export class WorkerPoolTerminatedError extends Error {
  constructor() {
    super('WorkerPoolManager: operation canceled because the pool terminated');
    this.name = 'WorkerPoolTerminatedError';
  }
}

/** The task was superseded or dropped before a worker answered it. */
export class WorkerPoolTaskCanceledError extends Error {
  constructor() {
    super('WorkerPoolManager: operation canceled before the task completed');
    this.name = 'WorkerPoolTaskCanceledError';
  }
}

/**
 * A pooled worker fired an `error` event while it initialized: an uncaught
 * exception inside the worker, or a worker script that failed to load. The
 * pool rejects `initialize()` and the cache primes it had queued with this
 * error, then falls back to main-thread rendering.
 */
export class WorkerPoolWorkerError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'WorkerPoolWorkerError';
  }
}

// The worker errors whose `error` event the host received through
// `WorkerPoolOptions.onWorkerError`. Tracked here rather than as a field so the
// error's public shape carries no pool state.
const reportedWorkerErrors = new WeakSet<WorkerPoolWorkerError>();

/**
 * Records that the host received the `error` event behind this error, so the
 * pool and the components do not log the failure a second time. Called by the
 * pool only; not exported from the package entry.
 */
export function markWorkerErrorReported(error: WorkerPoolWorkerError): void {
  reportedWorkerErrors.add(error);
}

/**
 * True for the two errors the pool uses to settle a promise it will never
 * fulfill: the pool was terminated, or the task was superseded or dropped
 * before a worker answered. Neither is a failure of the highlight itself.
 */
export function isWorkerPoolCancellation(
  error: unknown
): error is WorkerPoolTerminatedError | WorkerPoolTaskCanceledError {
  return (
    error instanceof WorkerPoolTerminatedError ||
    error instanceof WorkerPoolTaskCanceledError
  );
}

/**
 * True when the pool has already accounted for a rejection: a cancellation, or
 * a worker failure the host received through `onWorkerError`. A caller that
 * logs highlight failures skips these, otherwise one handled event is reported
 * as several errors.
 */
export function isHandledWorkerPoolError(error: unknown): boolean {
  return (
    isWorkerPoolCancellation(error) ||
    (error instanceof WorkerPoolWorkerError && reportedWorkerErrors.has(error))
  );
}
