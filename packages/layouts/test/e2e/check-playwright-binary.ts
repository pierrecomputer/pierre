import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';

const executablePath = chromium.executablePath();
if (existsSync(executablePath)) process.exit(0);
console.error(
  `[layouts:e2e] Missing Playwright Chromium at: ${executablePath}`
);
process.exit(1);
