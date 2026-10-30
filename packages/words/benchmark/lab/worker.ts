import { performance } from 'node:perf_hooks';

import { createCase } from './cases.ts';
import { summarize } from './statistics.ts';
import { warmup } from './warmup.ts';

/**
 * Time complete operations; long operations stay single-iteration batches.
 * Warmup time and work floors are calibration requirements, not proof of a JIT
 * tier. Record both achieved conditions and the trajectory for each process.
 */
export async function measure({
  caseId,
  target,
  warmupMs,
  warmupDeliveries,
  warmupOperations,
  warmupMaxMs,
  sampleMs,
  samples,
}: {
  caseId: string;
  target: string;
  warmupMs: number;
  warmupDeliveries: number;
  warmupOperations: number;
  warmupMaxMs: number;
  sampleMs: number;
  samples: number;
}) {
  if (warmupMaxMs < warmupMs)
    throw new RangeError('warmupMaxMs must be at least warmupMs');
  const benchmark = await createCase(caseId, target);
  const verification = benchmark.verify();
  // Replay floors count deliveries; static and kernel floors count operations.
  const replay = benchmark.descriptor.unit === 'replay';
  const updates = replay ? benchmark.descriptor.updates : 1;
  const warmupFloor = replay ? warmupDeliveries : warmupOperations;
  const warmed = warmup(benchmark.run, {
    warmupMs,
    warmupMaxMs,
    warmupFloor,
    updates,
  });
  let sink = warmed.sink;
  const batch = (iterations: number) => {
    const started = performance.now();
    for (let i = 0; i < iterations; i++) sink ^= benchmark.run();
    return performance.now() - started;
  };

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
    ...warmed,
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
  process.send!({ result });
} catch (error) {
  process.send!({
    error: error instanceof Error ? error.stack : String(error),
  });
  process.exitCode = 1;
}
