// Error types shared by the worker pool and its consumers. Keep this module
// free of imports so components can handle pool errors without loading the
// pool implementation and its dependencies.

/** The pool was terminated while the operation was pending. */
export class WorkerPoolTerminatedError extends Error {
  constructor() {
    super('WorkerPoolManager: operation canceled because the pool terminated');
    this.name = 'WorkerPoolTerminatedError';
  }
}

/** The task was replaced or removed before it completed. */
export class WorkerPoolTaskCanceledError extends Error {
  constructor() {
    super('WorkerPoolManager: operation canceled before the task completed');
    this.name = 'WorkerPoolTaskCanceledError';
  }
}

/**
 * A worker failed during initialization. The pool rejects initialization and
 * pending highlight requests with this error. Components then highlight on
 * the main thread.
 */
export class WorkerPoolWorkerError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'WorkerPoolWorkerError';
  }
}

// Track errors passed to onWorkerError without adding fields to the errors.
const reportedWorkerErrors = new WeakSet<WorkerPoolWorkerError>();

/**
 * Mark a worker error as reported so the pool and its consumers do not log it
 * again. Used internally by the pool; not exported from the package entry.
 */
export function markWorkerErrorReported(error: WorkerPoolWorkerError): void {
  reportedWorkerErrors.add(error);
}

/**
 * Returns true when an operation was canceled because the pool was terminated
 * or the task was replaced or removed before completion.
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
 * Returns true for cancellations and worker errors passed to onWorkerError.
 * Callers use this to skip cancellation logs and duplicate error reports.
 */
export function isHandledWorkerPoolError(error: unknown): boolean {
  return (
    isWorkerPoolCancellation(error) ||
    (error instanceof WorkerPoolWorkerError && reportedWorkerErrors.has(error))
  );
}
