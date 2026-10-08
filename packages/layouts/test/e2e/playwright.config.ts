import { defineConfig, type PlaywrightTestConfig } from '@playwright/test';

import { loadWorktreeEnv } from '../../../../scripts/load-worktree-env.mjs';

loadWorktreeEnv();
const offset = Number(process.env.PIERRE_PORT_OFFSET ?? 0);
const port = 4177 + offset;
const config: PlaywrightTestConfig = defineConfig({
  testDir: '.',
  testMatch: '**/*.pw.ts',
  outputDir: `/tmp/pierre-layouts-playwright-${offset}`,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1200, height: 900 },
  },
  webServer: {
    command: `LAYOUTS_E2E_PORT=${port} moon run layouts:test-e2e-server`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
  },
});

export default config;
