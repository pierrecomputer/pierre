#!/usr/bin/env bun

import { execSync, spawnSync } from 'node:child_process';

const stagedFiles = execSync('git diff --cached --name-only', {
  encoding: 'utf8',
})
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);

const workspaceDirs = new Set<string>();

for (const file of stagedFiles) {
  const parts = file.split('/');
  if (parts.length >= 2 && (parts[0] === 'apps' || parts[0] === 'packages')) {
    workspaceDirs.add(`${parts[0]}/${parts[1]}`);
  }
}

if (workspaceDirs.size === 0) {
  console.log('[precommit-tsc] no workspace changes detected');
  process.exit(0);
}

for (const workspace of workspaceDirs) {
  console.log(`[precommit-tsc][${workspace}] running tsc`);
  const result = spawnSync('bun', ['run', 'tsc'], {
    cwd: workspace,
    stdio: 'inherit',
    env: { ...process.env, FORCE_COLOR: '1' },
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
