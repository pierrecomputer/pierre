#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';

const args = process.argv.slice(2);

// Check for --verbose or -v flag
const verboseIndex = args.findIndex(
  (arg) => arg === '--verbose' || arg === '-v'
);
const isVerbose = verboseIndex !== -1;
if (isVerbose) {
  args.splice(verboseIndex, 1);
}

const [pkgArg, ...scriptArgs] = args;

if (!pkgArg || scriptArgs.length === 0) {
  console.log('Usage: bun ws <package> <script> [args...] [--verbose]');
  console.log('');
  console.log('Filters:');
  console.log('  <name>           Matches @pierre/<name> in package.json');
  console.log('  packages/<name>  Matches directory on filesystem');
  console.log('  apps/<name>      Matches directory on filesystem');
  console.log('');
  console.log('Options:');
  console.log('  -v, --verbose    Show full output (no line elision)');
  console.log('');
  console.log('Examples:');
  console.log('  bun ws diffs build');
  console.log('  bun ws diffs test');
  console.log('  bun ws diffs test --verbose    # full output');
  console.log('  bun ws packages/diffs build    # path-based');
  console.log("  bun ws 'packages/*' test       # all packages");
  console.log("  bun ws 'apps/*' dev            # all apps");
  console.log("  bun ws '*' build               # all workspaces");
  process.exit(0);
}

const isPath = pkgArg.startsWith('packages/') || pkgArg.startsWith('apps/');
const filter = isPath ? `./${pkgArg}` : `@pierre/${pkgArg}`;

const elideLines = ['--elide-lines=0'];

const SIGNAL_EXIT_CODES = {
  SIGHUP: 129,
  SIGINT: 130,
  SIGTERM: 143,
};

let didRestoreTTY = false;
const restoreTTY = () => {
  if (didRestoreTTY) {
    return;
  }

  didRestoreTTY = true;

  if (!process.stdin.isTTY) {
    return;
  }

  try {
    process.stdin.setRawMode?.(false);
  } catch {
    // Ignore raw mode restoration errors.
  }

  try {
    const stdinFd = process.stdin.fd;
    if (typeof stdinFd === 'number') {
      spawnSync('stty', ['sane'], {
        stdio: [stdinFd, 'ignore', 'ignore'],
      });
    }
  } catch {
    // Ignore stty errors and allow normal exit handling.
  }
};

const proc = spawn('bun', ['run', '-F', filter, ...elideLines, ...scriptArgs], {
  stdio: 'inherit',
  cwd: process.cwd(),
  env: { ...process.env, FORCE_COLOR: '1' },
});

const forwardSignal = (signal) => {
  if (proc.exitCode === null && proc.signalCode === null) {
    proc.kill(signal);
  }
};

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    forwardSignal(signal);
  });
}

proc.on('close', (code, signal) => {
  restoreTTY();
  if (signal) {
    process.exit(SIGNAL_EXIT_CODES[signal] ?? 1);
  }
  process.exit(code ?? 0);
});
