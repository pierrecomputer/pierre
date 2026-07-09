import {
  defineConfig,
  devices,
  type PlaywrightTestConfig,
} from '@playwright/test';

import { loadWorktreeEnv } from '../../../../scripts/load-worktree-env.mjs';

// Pull `PIERRE_PORT_OFFSET` from `.env.worktree` when Playwright is launched
// outside a moon task (e.g. `pnpm exec playwright test` from the package root).
loadWorktreeEnv();

const portOffset = Number(process.env.PIERRE_PORT_OFFSET ?? 0);
const e2ePort = 4175 + portOffset;
const e2eBaseUrl = `http://127.0.0.1:${e2ePort}`;
const e2eOutputDir = `/tmp/pierre-diffs-playwright-results${portOffset > 0 ? `-${portOffset}` : ''}`;

const config: PlaywrightTestConfig = defineConfig({
  testDir: '.',
  testMatch: ['**/*.pw.ts'],
  outputDir: e2eOutputDir,
  fullyParallel: true,
  reporter: 'list',
  timeout: 30_000,
  // A single retry in CI absorbs the rare highlighter/tokenizer warm-up race
  // when the first paint lands a frame late under parallel worker pressure.
  // Local runs keep retries off so flakes stay visible during development.
  retries: process.env.CI ? 1 : 0,
  expect: {
    timeout: 5_000,
  },
  use: {
    baseURL: e2eBaseUrl,
    headless: true,
    viewport: { width: 1200, height: 800 },
  },
  webServer: {
    command: `DIFFS_E2E_PORT=${e2ePort} moon run diffs:test-e2e-server`,
    url: `${e2eBaseUrl}/test/e2e/fixtures/diff-render.html`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});

export default config;
