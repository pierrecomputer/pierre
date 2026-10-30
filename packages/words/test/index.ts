#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.argv.includes('--spec')) {
  const status = spawnSync(
    process.execPath,
    ['--test', fileURLToPath(new URL('spec_test.ts', import.meta.url))],
    { stdio: 'inherit' }
  ).status;
  process.exit(status ?? 1);
}

const files = [
  'html_test.ts',
  'ansi_test.ts',
  'frontmatter_test.ts',
  'api_test.ts',
  'fuzz_test.ts',
  'grow_test.ts',
].map((f) => fileURLToPath(new URL(f, import.meta.url)));

const unit = spawnSync(process.execPath, ['--test', ...files], {
  stdio: 'inherit',
});
process.exit(unit.status ?? 1);
