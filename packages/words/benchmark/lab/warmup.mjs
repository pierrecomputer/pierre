import { performance } from 'node:perf_hooks';

/** Floors are calibration requirements, not evidence of a particular JIT tier. */
export function warmup(
  run,
  { warmupMs, warmupMaxMs, warmupFloor, updates },
  now = () => performance.now()
) {
  if (warmupMaxMs < warmupMs)
    throw new RangeError('warmupMaxMs must be at least warmupMs');

  const started = now();
  const warmupTrajectory = [];
  let warmupOperations = 0;
  let warmupElapsedMs = 0;
  let windowStarted = started;
  let windowOperations = 0;
  let sink = 0;
  while (
    warmupElapsedMs < warmupMaxMs &&
    (warmupElapsedMs < warmupMs || warmupOperations * updates < warmupFloor)
  ) {
    sink ^= run();
    warmupOperations++;
    windowOperations++;
    const current = now();
    if (current - windowStarted >= 25) {
      warmupTrajectory.push({
        operations: warmupOperations,
        millisecondsPerOperation: (current - windowStarted) / windowOperations,
      });
      windowStarted = current;
      windowOperations = 0;
    }
    warmupElapsedMs = current - started;
  }
  const warmupDeliveries = warmupOperations * updates;
  const warmupReachedTimeFloor = warmupElapsedMs >= warmupMs;
  const warmupReachedCountFloor = warmupDeliveries >= warmupFloor;
  return {
    warmupOperations,
    warmupDeliveries,
    warmupFloor,
    warmupReachedTimeFloor,
    warmupReachedCountFloor,
    warmupReachedFloor: warmupReachedTimeFloor && warmupReachedCountFloor,
    warmupElapsedMs,
    warmupTrajectory,
    sink,
  };
}
