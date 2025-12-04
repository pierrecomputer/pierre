declare const WorkerGlobalScope: new () => Worker;

export function isWorkerContext(): boolean {
  return (
    typeof WorkerGlobalScope !== 'undefined' &&
    typeof self !== 'undefined' &&
    self instanceof WorkerGlobalScope
  );
}
