import { performance } from 'node:perf_hooks';

import { createCase } from './cases.mjs';
import { summarize } from './statistics.mjs';

/** Time complete operations; long operations stay single-iteration batches. */
async function measure({ caseId, target, warmupMs, sampleMs, samples }) {
  const benchmark = await createCase(caseId, target);
  const verification = benchmark.verify();
  let sink = 0;
  const batch = (iterations) => {
    const started = performance.now();
    for (let i = 0; i < iterations; i++) sink ^= benchmark.run();
    return performance.now() - started;
  };
  const warmStarted = performance.now();
  let warmupOperations = 0;
  do {
    sink ^= benchmark.run();
    warmupOperations++;
  } while (performance.now() - warmStarted < warmupMs);
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
    warmupElapsedMs,
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
