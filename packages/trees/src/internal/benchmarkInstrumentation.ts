export interface BenchmarkInstrumentation {
  measurePhase: <TValue>(name: string, fn: () => TValue) => TValue;
  setCounter: (name: string, value: number) => void;
}

const BENCHMARK_INSTRUMENTATION = Symbol('benchmarkInstrumentation');

type BenchmarkInstrumentationCarrier = {
  [BENCHMARK_INSTRUMENTATION]?: BenchmarkInstrumentation;
};

/** Attaches instrumentation to an internal object without exposing it in public option types. */
export function attachBenchmarkInstrumentation<TValue extends object>(
  value: TValue,
  instrumentation: BenchmarkInstrumentation | null | undefined
): TValue {
  if (instrumentation == null) {
    return value;
  }

  Object.defineProperty(value, BENCHMARK_INSTRUMENTATION, {
    configurable: true,
    enumerable: false,
    value: instrumentation,
    writable: false,
  });
  return value;
}

/** Copies hidden instrumentation onto a freshly cloned object. */
export function inheritBenchmarkInstrumentation<TValue extends object>(
  source: object | null | undefined,
  value: TValue
): TValue {
  return attachBenchmarkInstrumentation(
    value,
    getBenchmarkInstrumentation(source)
  );
}

export function getBenchmarkInstrumentation(
  value: object | null | undefined
): BenchmarkInstrumentation | null {
  if (value == null) {
    return null;
  }

  return (
    (value as BenchmarkInstrumentationCarrier)[BENCHMARK_INSTRUMENTATION] ??
    null
  );
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
