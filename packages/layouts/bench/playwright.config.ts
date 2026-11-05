import { defineConfig, type PlaywrightTestConfig } from '@playwright/test';

import { loadWorktreeEnv } from '../../../scripts/load-worktree-env.mjs';
import { options } from './lib/options';

loadWorktreeEnv();
const offset = Number(process.env.PIERRE_PORT_OFFSET ?? 0);
const port = 4178 + offset;

export const BENCH_VIEWPORT: { width: number; height: number } = {
  width: 1440,
  height: 900,
};
export const BENCH_OUTPUT_DIR: string = `/tmp/pierre-layouts-bench-${offset}`;

// Benchmarks run one at a time in one browser, so that runs do not compete for the CPU.
const config: PlaywrightTestConfig = defineConfig({
  testDir: '.',
  testMatch: '**/*.bench.ts',
  outputDir: BENCH_OUTPUT_DIR,
  reporter: 'list',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 10 * 60_000,
  globalTeardown: './global-teardown.ts',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: BENCH_VIEWPORT,
    // The full Chromium build in new headless mode uses the same compositor as headed Chrome.
    channel: 'chromium',
    headless: options.mode === 'headless',
    launchOptions: {
      args: [
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
      ],
    },
  },
  webServer: {
    command: `pnpm exec vite build --config vite.config.ts && LAYOUTS_BENCH_PORT=${port} pnpm exec vite preview --config vite.config.ts`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});

export default config;
