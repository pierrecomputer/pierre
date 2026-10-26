#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.argv.includes('--spec')) {
  const status = spawnSync(
    process.execPath,
    ['--test', fileURLToPath(new URL('spec_test.mjs', import.meta.url))],
    { stdio: 'inherit' }
  ).status;
  process.exit(status ?? 1);
}

const files = [
  'html_test.mjs',
  'ansi_test.mjs',
  'frontmatter_test.mjs',
  'api_test.mjs',
  'fuzz_test.mjs',
  'grow_test.mjs',
].map((f) => fileURLToPath(new URL(f, import.meta.url)));

const unit = spawnSync(process.execPath, ['--test', ...files], {
  stdio: 'inherit',
});
process.exit(unit.status ?? 1);
