import type { ContentWeight } from './scenarios';

function list(name: string, fallback: string): string[] {
  return (process.env[name] ?? fallback)
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

export interface BenchOptions {
  runs: number;
  warmupRuns: number;
  panes: number[];
  content: ContentWeight[];
  scenarios: string[];
  save: boolean;
  mode: 'headless' | 'headed';
  /** Extra fixture parameters that select a variant, for example `geometry=host&contain=strict`. */
  query: string;
  /** One extra run of each record with invalidation tracking. */
  attribution: boolean;
  /** Memory values after the extra run of each record, and the repeat scenario. */
  memory: boolean;
}

/**
 * Run options from the environment, for example
 * `BENCH_RUNS=3 BENCH_SCENARIOS=zoom,focus moon run layouts:bench`.
 */
export const options: BenchOptions = {
  runs: Number(process.env.BENCH_RUNS ?? 5),
  warmupRuns: Number(process.env.BENCH_WARMUP ?? 1),
  panes: list('BENCH_PANES', '4,16').map(Number),
  content: list('BENCH_CONTENT', 'light,heavy,real') as ContentWeight[],
  scenarios: list('BENCH_SCENARIOS', ''),
  /** Write the report to `bench/results`. Set `BENCH_SAVE=0` for a trial run. */
  save: process.env.BENCH_SAVE !== '0',
  /** `headed` measures frames at the display rate; headless Chromium runs at 60 Hz. */
  mode: process.env.BENCH_MODE === 'headed' ? 'headed' : 'headless',
  query: process.env.BENCH_QUERY ?? '',
  /** Attribute work to panes in one extra run. Set `BENCH_ATTRIBUTION=0` to skip it. */
  attribution: process.env.BENCH_ATTRIBUTION !== '0',
  /** Measure memory after the extra run of each record. Set `BENCH_MEMORY=0` to skip it. */
  memory: process.env.BENCH_MEMORY !== '0',
};
