// Published string-I/O results from packages/highlights/benchmark/README.md,
// recorded September 25, 2026. Keep the reported ratios rather than deriving
// them from the table's independently rounded throughput values.
export const HIGHLIGHTS_LARGE_FILE_RESULTS = [
  {
    language: 'TypeScript',
    size: '517 KiB',
    speedup: 294,
  },
  {
    language: 'HTML',
    size: '474 KiB',
    speedup: 237,
  },
  {
    language: 'CSS',
    size: '379 KiB',
    speedup: 248,
  },
  {
    language: 'JSONC',
    size: '292 KiB',
    speedup: 148,
  },
] as const;

export const HIGHLIGHTS_THROUGHPUT_MAXIMUM = 300;
