/*
 * While it's possible to set a higher default WorkerPool, we've found in
 * practice 3 to be a good maximum that balances memory, speed of
 * initialization and performance. If you go over 3, regardless of
 * hardwareConcurrency, you can easily overload the browser.
 */
export function getDefaultWorkerPoolSize(): number {
  const availableCores = globalThis.navigator?.hardwareConcurrency ?? 1;
  return Math.min(3, Math.max(1, availableCores - 1));
}
