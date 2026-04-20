import { defineConfig, devices } from '@playwright/test';

const e2ePort = 4173;
const e2eBaseUrl = `http://127.0.0.1:${e2ePort}`;
const e2eOutputDir = '/tmp/pierre-trees-playwright-results';

export default defineConfig({
  testDir: '.',
  testMatch: ['**/*.pw.ts'],
  outputDir: e2eOutputDir,
  fullyParallel: true,
  reporter: 'list',
  timeout: 30_000,
  // Two retries in CI absorb the rare HTML5-drag flake when mousemove events
  // race with the browser's dragover handoff under parallel worker pressure.
  // Local runs keep retries off so flakes stay visible during development.
  retries: process.env.CI ? 2 : 0,
  expect: {
    timeout: 5_000,
  },
  use: {
    baseURL: e2eBaseUrl,
    headless: true,
    viewport: { width: 1200, height: 800 },
  },
  webServer: {
    command: `FILE_TREE_E2E_PORT=${e2ePort} bun run test:e2e:server`,
    url: `${e2eBaseUrl}/test/e2e/fixtures/file-tree-style-isolation.html`,
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
