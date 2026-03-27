interface BenchmarkPhaseAggregate {
  totalMs: number;
  count: number;
}

interface BenchmarkProfileStore {
  enabled: boolean;
  phases?: Record<string, BenchmarkPhaseAggregate>;
  counters?: Record<string, number>;
}

interface BenchmarkProfileGlobal {
  __PIERRE_TREES_BENCHMARK_PROFILE__?: BenchmarkProfileStore;
}

const now = (): number => {
  if (typeof performance !== 'undefined') {
    return performance.now();
  }
  return Date.now();
};

function getActiveBenchmarkStore(): BenchmarkProfileStore | null {
  const benchmarkStore = (
    globalThis as typeof globalThis & BenchmarkProfileGlobal
  ).__PIERRE_TREES_BENCHMARK_PROFILE__;
  if (benchmarkStore == null || benchmarkStore.enabled !== true) {
    return null;
  }

  benchmarkStore.phases ??= {};
  benchmarkStore.counters ??= {};
  return benchmarkStore;
}

function recordBenchmarkPhaseDuration(
  store: BenchmarkProfileStore,
  name: string,
  durationMs: number
): void {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return;
  }

  const existingPhase = store.phases?.[name] ?? {
    totalMs: 0,
    count: 0,
  };
  existingPhase.totalMs += durationMs;
  existingPhase.count += 1;
  store.phases![name] = existingPhase;
}

/** Measures a synchronous benchmark phase only when the fixture has profiling enabled. */
export function withBenchmarkPhase<TValue>(
  name: string,
  fn: () => TValue
): TValue {
  const benchmarkStore = getActiveBenchmarkStore();
  if (benchmarkStore == null) {
    return fn();
  }

  const startedAt = now();
  try {
    return fn();
  } finally {
    recordBenchmarkPhaseDuration(benchmarkStore, name, now() - startedAt);
  }
}

export function setBenchmarkCounter(name: string, value: number): void {
  if (!Number.isFinite(value)) {
    return;
  }

  const benchmarkStore = getActiveBenchmarkStore();
  if (benchmarkStore == null) {
    return;
  }

  benchmarkStore.counters![name] = value;
}

export function addBenchmarkCounter(name: string, delta: number): void {
  if (!Number.isFinite(delta)) {
    return;
  }

  const benchmarkStore = getActiveBenchmarkStore();
  if (benchmarkStore == null) {
    return;
  }

  benchmarkStore.counters![name] =
    (benchmarkStore.counters![name] ?? 0) + delta;
}
