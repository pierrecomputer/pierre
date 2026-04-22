#!/usr/bin/env bun

import { spawn, type ChildProcess, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { delimiter, dirname, resolve } from 'node:path';

const args = process.argv.slice(2);
const cwd = process.cwd();

// Walk up from `startDir` looking for a `.env.worktree` file. Worktrees created
// by `scripts/wt.ts` write one at their root with `PIERRE_PORT_OFFSET` etc.
// The main clone has no such file, so this returns {} there and nothing changes.
//
// We stop at the git worktree root (the first ancestor containing a `.git`
// entry — dir in the main clone, file in a linked worktree). That cap prevents
// a stray `.env.worktree` in an ancestor directory (e.g. `$HOME`) from being
// silently picked up by anyone invoking `bun ws`.
function loadWorktreeEnv(startDir: string): Record<string, string> {
  let dir = resolve(startDir);
  while (true) {
    const candidate = resolve(dir, '.env.worktree');
    if (existsSync(candidate)) {
      return parseEnvFile(candidate);
    }
    if (existsSync(resolve(dir, '.git'))) {
      return {};
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return {};
    }
    dir = parent;
  }
}

function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  const text = readFileSync(path, 'utf8');
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // Strip matching surrounding quotes if present.
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const worktreeEnv = loadWorktreeEnv(cwd);

const SIGNAL_EXIT_CODES: Partial<Record<NodeJS.Signals, number>> = {
  SIGHUP: 129,
  SIGINT: 130,
  SIGTERM: 143,
};

const FORWARDED_SIGNALS: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];

// Some dev tools ask the terminal for state during shutdown. Their replies can
// arrive after the child exits, so briefly drain stdin until it has gone quiet.
const TTY_QUIET_MS = 25;
const TTY_MAX_DRAIN_MS = 250;
const TTY_DRAIN_POLL_MS = 5;

// After Ctrl+C, the wrapper process can close before grandchildren like
// `next dev` finish their own shutdown output. Wait briefly for the descendants
// we signaled so their final terminal writes happen before we restore the shell.
const CHILD_TREE_MAX_WAIT_MS = 1_000;
const CHILD_TREE_POLL_MS = 25;

let isExiting = false;

process.on('exit', restoreTTY);

// Put the terminal back into normal line-editing mode before returning control
// to the user's shell, even if a child process left it in a transient state.
function restoreTTY() {
  if (!process.stdin.isTTY) {
    return;
  }

  try {
    process.stdin.setRawMode?.(false);
  } catch {}

  try {
    const stdinFd = process.stdin.fd;
    if (typeof stdinFd === 'number') {
      spawnSync('stty', ['sane'], {
        stdio: [stdinFd, 'ignore', 'ignore'],
      });
    }
  } catch {}

  try {
    process.stdout.write('\x1b[?2004l\x1b[?2026l');
  } catch {}
}

// Consume any delayed terminal replies so they do not appear as typed text at
// the next shell prompt after Ctrl+C.
async function drainTTYInput() {
  if (!process.stdin.isTTY) {
    return;
  }

  const stdin = process.stdin;
  const wasRaw = stdin.isRaw;
  const discard = () => {};
  const startedAt = Date.now();
  let lastInputAt = startedAt;

  try {
    stdin.setRawMode?.(true);
    stdin.on('data', discard);
    stdin.resume();

    while (Date.now() - startedAt < TTY_MAX_DRAIN_MS) {
      let sawInput = false;
      while (stdin.read() !== null) {
        sawInput = true;
      }

      const now = Date.now();
      if (sawInput) {
        lastInputAt = now;
      } else if (now - lastInputAt >= TTY_QUIET_MS) {
        break;
      }

      await Bun.sleep(TTY_DRAIN_POLL_MS);
    }
  } catch {
  } finally {
    stdin.off('data', discard);
    stdin.pause();
    try {
      stdin.setRawMode?.(wasRaw ?? false);
    } catch {}
  }
}

async function exitCleanly(code: number) {
  if (isExiting) {
    return;
  }

  isExiting = true;
  restoreTTY();
  await drainTTYInput();
  restoreTTY();
  process.exit(code);
}

// Snapshot the child process tree immediately before forwarding a signal.
// Shell scripts often spawn grandchildren, and those descendants can still be
// writing to the inherited terminal after the direct child has closed.
function collectDescendantPids(rootPid: number) {
  const result = spawnSync('ps', ['-axo', 'pid=,ppid='], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (result.status !== 0) {
    return [];
  }

  const childrenByParent = new Map<number, number[]>();
  for (const line of result.stdout.split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length !== 2) {
      continue;
    }

    const pid = Number(parts[0]);
    const ppid = Number(parts[1]);
    if (!Number.isInteger(pid) || !Number.isInteger(ppid)) {
      continue;
    }

    const children = childrenByParent.get(ppid);
    if (children) {
      children.push(pid);
    } else {
      childrenByParent.set(ppid, [pid]);
    }
  }

  const descendants: number[] = [];
  const stack = [...(childrenByParent.get(rootPid) ?? [])];
  while (stack.length > 0) {
    const pid = stack.pop();
    if (pid === undefined) {
      continue;
    }

    descendants.push(pid);
    stack.push(...(childrenByParent.get(pid) ?? []));
  }

  return descendants;
}

// `kill(pid, 0)` checks whether a process still exists without sending it a
// signal. This lets shutdown wait for descendants without disturbing them again.
function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Wait for signaled descendants to exit before returning control to the user's
// shell. The timeout is only a safety cap for stuck children, not a TTY delay.
async function waitForProcessesToExit(pids: Set<number>) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < CHILD_TREE_MAX_WAIT_MS) {
    let hasAliveProcess = false;
    for (const pid of pids) {
      if (isProcessAlive(pid)) {
        hasAliveProcess = true;
        break;
      }
    }

    if (!hasAliveProcess) {
      return;
    }

    await Bun.sleep(CHILD_TREE_POLL_MS);
  }
}

function handleChildExit(proc: ChildProcess) {
  const listeners = new Map<NodeJS.Signals, () => void>();
  // Record descendants before forwarding SIGINT/SIGTERM/SIGHUP, because the
  // direct child may close before slower grandchildren finish their cleanup.
  const signaledDescendants = new Set<number>();

  for (const signal of FORWARDED_SIGNALS) {
    const handler = () => {
      if (proc.pid !== undefined) {
        for (const pid of collectDescendantPids(proc.pid)) {
          signaledDescendants.add(pid);
        }
      }

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

    void (async () => {
      await waitForProcessesToExit(signaledDescendants);
      await exitCleanly(
        signal ? (SIGNAL_EXIT_CODES[signal] ?? 1) : (code ?? 0)
      );
    })();
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
    ...worktreeEnv,
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
