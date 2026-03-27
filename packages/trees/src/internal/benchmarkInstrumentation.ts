export interface BenchmarkInstrumentation {
  measurePhase: <TValue>(name: string, fn: () => TValue) => TValue;
  setCounter: (name: string, value: number) => void;
}

/** Runs benchmark timing only when a fixture explicitly injects instrumentation hooks. */
export function withBenchmarkPhase<TValue>(
  instrumentation: BenchmarkInstrumentation | null | undefined,
  name: string,
  fn: () => TValue
): TValue {
  if (instrumentation == null) {
    return fn();
  }
  return instrumentation.measurePhase(name, fn);
}

export function setBenchmarkCounter(
  instrumentation: BenchmarkInstrumentation | null | undefined,
  name: string,
  value: number
): void {
  if (!Number.isFinite(value) || instrumentation == null) {
    return;
  }
  instrumentation.setCounter(name, value);
}
