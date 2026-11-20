// Runs callbacks in their own tasks, the way `queueRender` runs them in frames.
// For work done a slice at a time so it does not block the page.

// How long one background task works before it queues itself again.
export const BACKGROUND_TASK_BUDGET_MS = 1;

export type BackgroundTask = () => void;

const tasks = new Map<number, BackgroundTask>();
const taskIds = new Map<BackgroundTask, number>();
let nextTaskId = 0;

// Runs the callback a posted message names. One callback per message.
export function runBackgroundTask(event: MessageEvent<unknown>): void {
  const { data } = event;
  if (typeof data !== 'string' || !data.startsWith('diffs-background-task:'))
    return;
  const id = Number(data.slice('diffs-background-task:'.length));
  const callback = tasks.get(id);
  if (callback == null) return;
  dequeueBackgroundTask(callback);
  callback();
}

// Queues a callback to run once in its own task, with no minimum delay.
export function queueBackgroundTask(callback: BackgroundTask): void {
  if (taskIds.has(callback)) return;
  if (tasks.size === 0) {
    globalThis.addEventListener('message', runBackgroundTask);
  }
  const id = ++nextTaskId;
  tasks.set(id, callback);
  taskIds.set(callback, id);
  globalThis.postMessage(`diffs-background-task:${id}`);
}

// Takes a queued callback back out before it runs.
export function dequeueBackgroundTask(callback: BackgroundTask): void {
  const id = taskIds.get(callback);
  if (id == null) return;
  taskIds.delete(callback);
  tasks.delete(id);
  if (tasks.size === 0) {
    globalThis.removeEventListener('message', runBackgroundTask);
  }
}
