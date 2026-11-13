// Published string-I/O results from packages/highlights/benchmark/README.md,
// recorded November 13, 2026. Keep the reported ratios rather than deriving
// them from the table's independently rounded throughput values.
export const HIGHLIGHTS_LARGE_FILE_RESULTS = [
  {
    language: 'TypeScript',
    size: '517 KiB',
    speedup: 282,
  },
  {
    language: 'HTML',
    size: '474 KiB',
    speedup: 255,
  },
  {
    language: 'CSS',
    size: '379 KiB',
    speedup: 227,
  },
  {
    language: 'JSONC',
    size: '292 KiB',
    speedup: 142,
  },
] as const;

export const HIGHLIGHTS_LARGE_FILE_MAXIMUM_SPEEDUP = Math.max(
  ...HIGHLIGHTS_LARGE_FILE_RESULTS.map(({ speedup }) => speedup)
);

export const HIGHLIGHTS_THROUGHPUT_MAXIMUM = 300;
