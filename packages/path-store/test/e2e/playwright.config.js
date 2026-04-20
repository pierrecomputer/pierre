import { defineConfig, devices } from '@playwright/test';

import { loadWorktreeEnv } from '../../../../scripts/load-worktree-env.mjs';

// Pull `PIERRE_PORT_OFFSET` from `.env.worktree` when Playwright is launched
// outside a `bun ws` call (e.g. `bunx playwright test` from the package root).
loadWorktreeEnv();

const portOffset = Number(process.env.PIERRE_PORT_OFFSET ?? 0);
const e2ePort = 4176 + portOffset;
const e2eBaseUrl = `http://127.0.0.1:${e2ePort}`;
const e2eOutputDir = `/tmp/pierre-path-store-playwright-results${portOffset > 0 ? `-${portOffset}` : ''}`;

export default defineConfig({
  testDir: '.',
  testMatch: ['**/*.pw.js'],
  outputDir: e2eOutputDir,
  fullyParallel: true,
  reporter: 'list',
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  use: {
    baseURL: e2eBaseUrl,
    headless: true,
    viewport: { width: 1200, height: 900 },
  },
  webServer: {
    command: `PATH_STORE_DEMO_E2E_PORT=${e2ePort} bun run test:demo:server`,
    url: `${e2eBaseUrl}/`,
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
