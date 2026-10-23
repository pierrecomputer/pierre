import { fileURLToPath } from 'node:url';

import { options } from './lib/options';
import { formatChecks, writeReport } from './lib/report';
import { BENCH_OUTPUT_DIR, BENCH_VIEWPORT } from './playwright.config';

/** Merge the records of every benchmark test into one report and print the baseline checks. */
export default function globalTeardown(): void {
  const result = writeReport({
    recordsDirectory: BENCH_OUTPUT_DIR,
    resultsDirectory: options.save
      ? fileURLToPath(new URL('results', import.meta.url))
      : `${BENCH_OUTPUT_DIR}/report`,
    headless: true,
    viewport: BENCH_VIEWPORT,
    runs: options.runs,
    warmupRuns: options.warmupRuns,
  });
  if (result === null) {
    console.log('[layouts:bench] No records to report.');
    return;
  }
  console.log(`\n[layouts:bench] Report: ${result.path}\n`);
  console.log(formatChecks(result.report.checks));
}
