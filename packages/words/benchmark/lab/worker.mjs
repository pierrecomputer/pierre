import { performance } from 'node:perf_hooks';

import { createCase } from './cases.mjs';
import { summarize } from './statistics.mjs';

/** Static and kernel cases reach steady state within a few hundred operations. */
const staticWarmupOperations = 400;

/**
 * Time complete operations; long operations stay single-iteration batches.
 * Warmup must outlast V8 tier-up: for the streaming glue, TurboFan code arrives
 * after roughly 12–15k per-update invocations and runs 1.6–2.5× slower than the
 * Maglev code before it. A time floor alone measures the wrong regime, so replay
 * warmup also requires `warmupDeliveries` per-update invocations, and every
 * process records its warmup trajectory.
 */
async function measure({
  caseId,
  target,
  warmupMs,
  warmupDeliveries,
  warmupMaxMs,
  sampleMs,
  samples,
}) {
  const benchmark = await createCase(caseId, target);
  const verification = benchmark.verify();
  // Static and kernel cases run one glue invocation per operation and are flat
  // after a few hundred operations; only replays need the delivery floor.
  const replay = benchmark.descriptor.unit === 'replay';
  const updates = benchmark.descriptor.updates;
  const warmupFloor = replay ? warmupDeliveries : staticWarmupOperations;
  let sink = 0;
  const batch = (iterations) => {
    const started = performance.now();
    for (let i = 0; i < iterations; i++) sink ^= benchmark.run();
    return performance.now() - started;
  };
  const warmStarted = performance.now();
  const warmupTrajectory = [];
  let warmupOperations = 0;
  let windowStarted = warmStarted;
  let windowOperations = 0;
  for (;;) {
    sink ^= benchmark.run();
    warmupOperations++;
    windowOperations++;
    const now = performance.now();
    if (now - windowStarted >= 25) {
      warmupTrajectory.push({
        operations: warmupOperations,
        millisecondsPerOperation: (now - windowStarted) / windowOperations,
      });
      windowStarted = now;
      windowOperations = 0;
    }
    const elapsed = now - warmStarted;
    if (elapsed >= warmupMaxMs) break;
    if (elapsed >= warmupMs && warmupOperations * updates >= warmupFloor) break;
  }
  const warmupElapsedMs = performance.now() - warmStarted;

  let iterations = 1;
  for (;;) {
    const elapsed = batch(iterations);
    if (elapsed >= sampleMs || iterations >= 1048576) break;
    iterations = Math.min(
      1048576,
      iterations *
        Math.min(8, Math.max(2, Math.ceil(sampleMs / Math.max(elapsed, 0.001))))
    );
  }
  const memoryBefore = process.memoryUsage();
  const raw = [];
  for (let i = 0; i < samples; i++) {
    const elapsedMs = batch(iterations);
    raw.push({
      iterations,
      elapsedMs,
      millisecondsPerOperation: elapsedMs / iterations,
    });
  }
  const memoryAfter = process.memoryUsage();
  // Exact output validation is outside all timers, both before and after reuse.
  const after = benchmark.verify();
  if (verification.outputSha256 !== after.outputSha256)
    throw new Error(`${caseId}: output changed after repeated execution`);
  return {
    descriptor: benchmark.descriptor,
    verification,
    warmupOperations,
    warmupDeliveries: warmupOperations * updates,
    warmupFloor,
    warmupReachedFloor: warmupOperations * updates >= warmupFloor,
    warmupElapsedMs,
    warmupTrajectory,
    raw,
    summary: summarize(raw.map((sample) => sample.millisecondsPerOperation)),
    sink,
    memoryBefore,
    memoryAfter,
    runtime: process.version,
    pid: process.pid,
  };
}

try {
  const result = await measure(JSON.parse(process.argv[2]));
  process.send({ result });
} catch (error) {
  process.send({ error: error.stack ?? String(error) });
  process.exitCode = 1;
}
