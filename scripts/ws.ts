#!/usr/bin/env bun

import { spawn, type ChildProcess, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, resolve } from 'node:path';

const args = process.argv.slice(2);
const cwd = process.cwd();

const SIGNAL_EXIT_CODES: Partial<Record<NodeJS.Signals, number>> = {
  SIGHUP: 129,
  SIGINT: 130,
  SIGTERM: 143,
};

const FORWARDED_SIGNALS: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];

let didRestoreTTY = false;

process.on('exit', restoreTTY);

function restoreTTY() {
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

  try {
    process.stdout.write('\x1b[?2004l\x1b[?2026l');
  } catch {
    // Ignore terminal mode restoration write errors.
  }
}

function handleChildExit(proc: ChildProcess) {
  const listeners = new Map<NodeJS.Signals, () => void>();

  for (const signal of FORWARDED_SIGNALS) {
    const handler = () => {
      restoreTTY();

      if (proc.exitCode === null && proc.signalCode === null) {
        proc.kill(signal);
      }
    };

    listeners.set(signal, handler);
    process.on(signal, handler);
  }

  proc.on('close', (code, signal) => {
    for (const [forwardedSignal, handler] of listeners) {
      process.off(forwardedSignal, handler);
    }

    restoreTTY();

    if (signal) {
      process.exit(SIGNAL_EXIT_CODES[signal] ?? 1);
    }

    process.exit(code ?? 0);
  });
}

function createScriptEnv(pkgDir: string) {
  const pathParts = [
    resolve(pkgDir, 'node_modules/.bin'),
    resolve(cwd, 'node_modules/.bin'),
    process.env.PATH ?? '',
  ];
  return {
    ...process.env,
    FORCE_COLOR: '1',
    PATH: pathParts.join(delimiter),
  };
}

// Check for --verbose or -v flag (kept for backwards compat, now a no-op)
const verboseIndex = args.findIndex(
  (arg) => arg === '--verbose' || arg === '-v'
);
if (verboseIndex !== -1) {
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

// Resolve package directory for direct execution
function resolvePackageDir(pkg: string): string | null {
  // Check if it's already a path
  if (pkg.startsWith('packages/') || pkg.startsWith('apps/')) {
    const dir = resolve(process.cwd(), pkg);
    return existsSync(dir) ? dir : null;
  }
  // Try packages/<name> then apps/<name>
  for (const prefix of ['packages', 'apps']) {
    const dir = resolve(process.cwd(), prefix, pkg);
    if (existsSync(dir)) return dir;
  }
  return null;
}

// Glob patterns (e.g. '*', 'packages/*') must use bun run -F
if (pkgArg.includes('*')) {
  const isPath = pkgArg.startsWith('packages/') || pkgArg.startsWith('apps/');
  let filter: string;
  if (pkgArg === '*') {
    filter = '*';
  } else if (isPath) {
    filter = `./${pkgArg}`;
  } else {
    filter = `@pierre/${pkgArg}`;
  }

  const proc = spawn(
    'bun',
    ['run', '-F', filter, '--elide-lines=0', ...scriptArgs],
    {
      stdio: 'inherit',
      cwd,
      env: createScriptEnv(cwd),
    }
  );
  handleChildExit(proc);
} else {
  // Single package: run directly so stdin/stdout pass through cleanly
  const pkgDir = resolvePackageDir(pkgArg);
  if (!pkgDir) {
    console.error(`Package not found: ${pkgArg}`);
    process.exit(1);
  }

  const pkgJsonPath = resolve(pkgDir, 'package.json');
  const pkgJson = JSON.parse(await Bun.file(pkgJsonPath).text());
  const scriptName = scriptArgs[0];
  const scriptCmd = pkgJson.scripts?.[scriptName];

  if (!scriptCmd) {
    console.error(`Script "${scriptName}" not found in ${pkgArg}/package.json`);
    process.exit(1);
  }

  const restArgs = scriptArgs.slice(1); // args after script name (e.g., -- --update-snapshots)

  // If the script contains shell operators, run via shell
  const needsShell = /&&|\|\||[|;]/.test(scriptCmd);
  const fullCmd =
    restArgs.length > 0 ? `${scriptCmd} ${restArgs.join(' ')}` : scriptCmd;
  const scriptEnv = createScriptEnv(pkgDir);

  const proc = needsShell
    ? spawn('sh', ['-c', fullCmd], {
        stdio: 'inherit',
        cwd: pkgDir,
        env: scriptEnv,
      })
    : (() => {
        const cmdParts = scriptCmd.split(/\s+/);
        return spawn(cmdParts[0], [...cmdParts.slice(1), ...restArgs], {
          stdio: 'inherit',
          cwd: pkgDir,
          env: scriptEnv,
        });
      })();
  handleChildExit(proc);
}
