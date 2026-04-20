import { defineConfig, devices } from '@playwright/test';

import { loadWorktreeEnv } from '../../../../scripts/load-worktree-env.mjs';

// Pull `PIERRE_PORT_OFFSET` from `.env.worktree` when Playwright is launched
// outside a `bun ws` call (e.g. `bunx playwright test` from the package root).
loadWorktreeEnv();

const portOffset = Number(process.env.PIERRE_PORT_OFFSET ?? 0);
const e2ePort = 4174 + portOffset;
const e2eBaseUrl = `http://127.0.0.1:${e2ePort}`;
const e2eOutputDir = `/tmp/pierre-docs-playwright-results${portOffset > 0 ? `-${portOffset}` : ''}`;

export default defineConfig({
  testDir: '.',
  testMatch: ['**/*.pw.ts'],
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
    viewport: { width: 1400, height: 1000 },
  },
  webServer: {
    command: `PORT=${e2ePort} bun run start`,
    url: `${e2eBaseUrl}/trees-dev/react`,
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
