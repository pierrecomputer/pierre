#!/usr/bin/env bun
//
// Worktree command suite for this monorepo.
//
//   bun run wt new <slug> [--branch <name>] [--base <ref>]
//   bun run wt rm <slug> [--keep-branch] [--force]
//   bun run wt clean [<slug>|--all]
//   bun run wt ps
//   bun run wt list
//
// Design notes (see AGENTS.md "Worktrees" section for the user-facing summary):
//
// - Worktrees live at ~/pierre/pierre-worktrees/<dir>/ where <dir> is the slug
//   with '/' replaced by '-'. Each worktree owns a port offset stored in
//   <worktree>/.env.worktree. Dev scripts resolve ports as
//   `${PIERRE_PORT_OFFSET:-0} + <default>` so the main clone (no env file) keeps
//   its historical ports unchanged.
// - Discovery is stateless: `git worktree list --porcelain` is the source of
//   truth. Each worktree's own `.env.worktree` is the source of truth for its
//   offset. There is no central registry.
// - Agent-created worktrees (e.g. under .omx/worktrees/, /private/tmp/pierre-*)
//   have no `.env.worktree`; they are visible to `wt list`/`wt ps` but they
//   don't claim offsets and are skipped by `wt clean --all`.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';

const WORKTREES_HOME = join(homedir(), 'pierre', 'pierre-worktrees');

// Port bases. The offset is added to these to get a worktree's actual ports.
const PORT_BASES = {
  docsDiffs: 3690,
  docsTrees: 3691,
  docsE2E: 4174,
  treesE2E: 4173,
  pathStoreE2E: 4176,
  chrome: 9222,
} as const;

type PortMap = Record<keyof typeof PORT_BASES, number>;

interface Worktree {
  path: string;
  branch: string | null;
  head: string | null;
  /** Null for worktrees that don't participate in our offset system (main clone, agent worktrees). */
  offset: number | null;
  /** Null when no `.env.worktree` / no claimed slug. */
  slug: string | null;
  /** True if this is the primary (non-linked) worktree — i.e. the main clone. */
  isMain: boolean;
}

// -----------------------------------------------------------------------------
// Entry point
// -----------------------------------------------------------------------------

const args = process.argv.slice(2);
const sub = args[0];

const commands: Record<string, (rest: string[]) => Promise<number> | number> = {
  new: cmdNew,
  rm: cmdRm,
  clean: cmdClean,
  ps: cmdPs,
  list: cmdList,
  help: cmdHelp,
  '--help': cmdHelp,
  '-h': cmdHelp,
};

if (!sub || !(sub in commands)) {
  cmdHelp();
  process.exit(sub ? 1 : 0);
}

Promise.resolve(commands[sub](args.slice(1))).then(
  (code) => process.exit(code ?? 0),
  (err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
);

function cmdHelp(): number {
  console.log(`Usage: bun run wt <subcommand> [args]

Subcommands:
  new <slug> [--branch <name>] [--base <ref>]
      Create a new worktree at ~/pierre/pierre-worktrees/<slug>.
      Branch defaults to "$USER/<slug>". --branch attaches an existing branch.
      --base selects the starting ref (default: main).

  rm <slug> [--keep-branch] [--force]
      Kill any processes bound to the worktree's ports, then remove it.
      --force passes --force through to git worktree remove.

  clean [<slug>|--all]
      Kill processes bound to a worktree's expected ports. Without arguments
      or with --all, does this for every managed worktree.

  ps  List every worktree with per-service port status (LISTEN / —).
  list  One-line-per-worktree summary.
`);
  return 0;
}

// -----------------------------------------------------------------------------
// wt new
// -----------------------------------------------------------------------------

async function cmdNew(rest: string[]): Promise<number> {
  const { slug, branch: branchOverride, base } = parseNewArgs(rest);
  if (!slug) {
    console.error('wt new: missing <slug>');
    return 1;
  }

  const user = userInfo().username;
  const branch = branchOverride ?? `${user}/${slug}`;
  const dirName = slugify(slug);
  const worktreePath = join(WORKTREES_HOME, dirName);

  if (existsSync(worktreePath)) {
    console.error(`wt new: ${worktreePath} already exists`);
    return 1;
  }

  const worktrees = enumerateWorktrees();
  for (const wt of worktrees) {
    if (wt.branch === `refs/heads/${branch}` || wt.branch === branch) {
      console.error(
        `wt new: branch ${branch} is already checked out at ${wt.path}`
      );
      return 1;
    }
  }

  mkdirSync(WORKTREES_HOME, { recursive: true });

  const offset = allocateOffset(
    slug,
    worktrees.map((w) => w.offset).filter((o): o is number => o !== null)
  );

  // Decide how to invoke `git worktree add`:
  //   - If --branch was passed, the branch may already exist locally: use
  //     `git worktree add <path> <branch>` (no -b).
  //   - Otherwise create a new branch rooted at <base> (default: main):
  //     `git worktree add -b <branch> <path> <base>`.
  const gitArgs = branchOverride
    ? ['worktree', 'add', worktreePath, branch]
    : ['worktree', 'add', '-b', branch, worktreePath, base ?? 'main'];

  const gitResult = spawnSync('git', gitArgs, { stdio: 'inherit' });
  if (gitResult.status !== 0) {
    return gitResult.status ?? 1;
  }

  writeFileSync(
    join(worktreePath, '.env.worktree'),
    `PIERRE_WORKTREE_SLUG=${slug}\nPIERRE_PORT_OFFSET=${offset}\n`,
    'utf8'
  );

  // Belt-and-suspenders for direct `cd apps/docs && bun run trees:dev` runs:
  // Next auto-loads .env.local so the title tag still picks up the slug even
  // when ws.ts isn't in the call chain.
  const appsDocsEnvLocal = join(worktreePath, 'apps', 'docs', '.env.local');
  if (existsSync(dirname(appsDocsEnvLocal))) {
    writeFileSync(
      appsDocsEnvLocal,
      `NEXT_PUBLIC_WORKTREE_SLUG=${slug}\n`,
      'utf8'
    );
  }

  console.log(`\nInstalling dependencies in ${worktreePath}...`);
  const bunInstall = spawnSync('bun', ['install'], {
    cwd: worktreePath,
    stdio: 'inherit',
  });
  if (bunInstall.status !== 0) {
    console.error(
      'wt new: bun install failed; the worktree was created but may be incomplete'
    );
    return bunInstall.status ?? 1;
  }

  printPortMap(slug, offset, worktreePath);
  return 0;
}

function parseNewArgs(rest: string[]): {
  slug?: string;
  branch?: string;
  base?: string;
} {
  let slug: string | undefined;
  let branch: string | undefined;
  let base: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--branch') {
      branch = rest[++i];
    } else if (a === '--base') {
      base = rest[++i];
    } else if (!slug && !a.startsWith('--')) {
      slug = a;
    }
  }
  return { slug, branch, base };
}

// -----------------------------------------------------------------------------
// wt rm
// -----------------------------------------------------------------------------

function cmdRm(rest: string[]): number {
  const keepBranch = rest.includes('--keep-branch');
  const force = rest.includes('--force');
  const slug = rest.find((a) => !a.startsWith('--'));
  if (!slug) {
    console.error('wt rm: missing <slug>');
    return 1;
  }

  const wt = findWorktreeBySlug(slug);
  if (!wt) {
    console.error(`wt rm: no managed worktree with slug "${slug}"`);
    return 1;
  }

  killWorktreePorts(wt);

  const removeArgs = ['worktree', 'remove'];
  if (force) removeArgs.push('--force');
  removeArgs.push(wt.path);
  const removeResult = spawnSync('git', removeArgs, { stdio: 'inherit' });
  if (removeResult.status !== 0) {
    return removeResult.status ?? 1;
  }

  if (!keepBranch && wt.branch) {
    const branchName = wt.branch.replace(/^refs\/heads\//, '');
    // `git branch -d` is safe: it refuses to delete unmerged branches.
    const del = spawnSync('git', ['branch', '-d', branchName], {
      stdio: 'pipe',
      encoding: 'utf8',
    });
    if (del.status === 0) {
      console.log(`Deleted branch ${branchName} (was merged).`);
    } else {
      console.log(
        `Left branch ${branchName} in place (${del.stderr.trim() || 'unmerged'}).`
      );
    }
  }

  return 0;
}

// -----------------------------------------------------------------------------
// wt clean
// -----------------------------------------------------------------------------

function cmdClean(rest: string[]): number {
  const all = rest.length === 0 || rest.includes('--all');
  const targets: Worktree[] = [];
  if (all) {
    for (const wt of enumerateWorktrees()) {
      if (wt.offset !== null || wt.isMain) targets.push(wt);
    }
  } else {
    const slug = rest.find((a) => !a.startsWith('--'));
    if (!slug) {
      console.error('wt clean: missing <slug> (or pass --all)');
      return 1;
    }
    const wt = findWorktreeBySlug(slug);
    if (!wt) {
      console.error(`wt clean: no managed worktree with slug "${slug}"`);
      return 1;
    }
    targets.push(wt);
  }

  for (const wt of targets) {
    killWorktreePorts(wt);
  }
  return 0;
}

// -----------------------------------------------------------------------------
// wt ps
// -----------------------------------------------------------------------------

function cmdPs(): number {
  const worktrees = enumerateWorktrees();
  const services: Array<[keyof typeof PORT_BASES, string]> = [
    ['docsDiffs', 'diffs'],
    ['docsTrees', 'trees'],
    ['docsE2E', 'docsE2E'],
    ['treesE2E', 'treesE2E'],
    ['pathStoreE2E', 'psE2E'],
    ['chrome', 'chrome'],
  ];

  const header = [
    padRight('worktree', 28),
    padRight('offset', 8),
    ...services.map(([, label]) => padRight(label, 14)),
  ].join(' ');
  console.log(header);
  console.log('-'.repeat(header.length));

  for (const wt of worktrees) {
    const label =
      wt.slug ?? (wt.isMain ? '(main)' : `(unmanaged:${basename(wt.path)})`);
    const offsetCell = wt.offset === null ? '—' : String(wt.offset);
    const portMap = wt.offset === null ? null : resolvePortMap(wt.offset);
    const cells = services.map(([key]) => {
      if (!portMap) return padRight('—', 14);
      const port = portMap[key];
      const pid = pidOnPort(port);
      return padRight(pid ? `${port}:${pid}` : `${port}`, 14);
    });
    console.log(
      [padRight(label, 28), padRight(offsetCell, 8), ...cells].join(' ')
    );
  }
  return 0;
}

// -----------------------------------------------------------------------------
// wt list
// -----------------------------------------------------------------------------

function cmdList(): number {
  for (const wt of enumerateWorktrees()) {
    const offset = wt.offset === null ? '—' : String(wt.offset);
    const slug = wt.slug ?? (wt.isMain ? '(main)' : '(unmanaged)');
    const branch = wt.branch
      ? wt.branch.replace(/^refs\/heads\//, '')
      : '(detached)';
    console.log(
      `${padRight(slug, 28)} offset=${padRight(offset, 4)} ${padRight(branch, 40)} ${wt.path}`
    );
  }
  return 0;
}

// -----------------------------------------------------------------------------
// Shared helpers
// -----------------------------------------------------------------------------

// Parse `git worktree list --porcelain`. Each record is terminated by a blank
// line. Fields we care about: `worktree <path>`, `HEAD <sha>`, `branch
// refs/heads/<name>` (or `detached`).
function enumerateWorktrees(): Worktree[] {
  const result = spawnSync('git', ['worktree', 'list', '--porcelain'], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`git worktree list failed:\n${result.stderr}`);
  }

  const records: Worktree[] = [];
  let current: Partial<Worktree> & { path?: string } = {};
  let primarySeen = false;
  const flush = () => {
    if (!current.path) return;
    const path = current.path;
    const isMain = !primarySeen;
    primarySeen = true;
    const envPath = join(path, '.env.worktree');
    let offset: number | null = null;
    let slug: string | null = null;
    if (existsSync(envPath)) {
      try {
        const parsed = parseEnvFile(envPath);
        if (parsed.PIERRE_PORT_OFFSET !== undefined) {
          const n = Number(parsed.PIERRE_PORT_OFFSET);
          if (Number.isFinite(n)) offset = n;
        }
        if (parsed.PIERRE_WORKTREE_SLUG !== undefined) {
          slug = parsed.PIERRE_WORKTREE_SLUG;
        }
      } catch {
        // Malformed env file; treat as unmanaged.
      }
    }
    records.push({
      path,
      branch: current.branch ?? null,
      head: current.head ?? null,
      offset,
      slug,
      isMain,
    });
    current = {};
  };

  for (const rawLine of result.stdout.split('\n')) {
    const line = rawLine.trim();
    if (line === '') {
      flush();
      continue;
    }
    if (line.startsWith('worktree ')) {
      current.path = line.slice('worktree '.length);
    } else if (line.startsWith('HEAD ')) {
      current.head = line.slice('HEAD '.length);
    } else if (line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length);
    }
  }
  flush();
  return records;
}

function findWorktreeBySlug(slug: string): Worktree | undefined {
  return enumerateWorktrees().find((w) => w.slug === slug);
}

// Stable, deterministic offset candidate from slug. Steps by 10 so ports in
// adjacent slots (e.g. docsDiffs=3690 and docsTrees=3691) never overlap across
// worktrees. Main clone is offset 0 — reserved, never allocated to a worktree.
function allocateOffset(slug: string, inUse: number[]): number {
  const taken = new Set<number>(inUse);
  taken.add(0);
  let hash = 0;
  for (let i = 0; i < slug.length; i++) {
    hash = (hash * 31 + slug.charCodeAt(i)) >>> 0;
  }
  let offset = ((hash % 10) + 1) * 10; // starts at 10, wraps through 100
  for (let i = 0; i < 100; i++) {
    if (!taken.has(offset)) return offset;
    offset += 10;
  }
  throw new Error('wt new: could not allocate a free port offset');
}

function resolvePortMap(offset: number): PortMap {
  const out: Partial<PortMap> = {};
  for (const key of Object.keys(PORT_BASES) as (keyof typeof PORT_BASES)[]) {
    out[key] = PORT_BASES[key] + offset;
  }
  return out as PortMap;
}

// Find listener PIDs for `port`, SIGTERM them, wait, then SIGKILL survivors.
function killPorts(ports: number[]): void {
  for (const port of ports) {
    const pids = pidsOnPort(port);
    if (pids.length === 0) continue;
    console.log(`[wt clean] port ${port}: killing ${pids.join(', ')}`);
    spawnSync('kill', ['-TERM', ...pids.map(String)], { stdio: 'ignore' });
  }
  // Single shared pause, then kill survivors.
  if (ports.some((p) => pidsOnPort(p).length > 0)) {
    spawnSync('sleep', ['0.3']);
  }
  for (const port of ports) {
    const survivors = pidsOnPort(port);
    if (survivors.length === 0) continue;
    console.log(`[wt clean] port ${port}: SIGKILL ${survivors.join(', ')}`);
    spawnSync('kill', ['-KILL', ...survivors.map(String)], { stdio: 'ignore' });
  }
}

// The main clone has no `.env.worktree` and therefore no offset, but it still
// owns the default ports (offset 0). Treat it as offset 0 so `wt clean` on the
// main clone terminates stale servers on 3690/3691/4173/4174/4176/9222.
function killWorktreePorts(wt: Worktree): void {
  const offset = wt.offset ?? (wt.isMain ? 0 : null);
  if (offset === null) return;
  killPorts(Object.values(resolvePortMap(offset)));
}

function pidsOnPort(port: number): number[] {
  const r = spawnSync('lsof', ['-ti', `:${port}`, '-sTCP:LISTEN'], {
    encoding: 'utf8',
  });
  if (r.status !== 0) return [];
  return r.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n));
}

function pidOnPort(port: number): number | null {
  const pids = pidsOnPort(port);
  return pids[0] ?? null;
}

function parseEnvFile(path: string): Record<string, string> {
  const text = readFileSync(path, 'utf8');
  const out: Record<string, string> = {};
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
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

function slugify(input: string): string {
  return input.replace(/[/\\]+/g, '-').replace(/^-+|-+$/g, '');
}

function padRight(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function basename(p: string): string {
  return p.split('/').filter(Boolean).pop() ?? p;
}

function printPortMap(slug: string, offset: number, path: string): void {
  const ports = resolvePortMap(offset);
  console.log(`
Worktree: ${slug} (offset ${offset})
  diffs dev:    http://localhost:${ports.docsDiffs}
  trees dev:    http://localhost:${ports.docsTrees}
  docs E2E:     http://localhost:${ports.docsE2E}
  trees E2E:    http://localhost:${ports.treesE2E}
  path-store:   http://localhost:${ports.pathStoreE2E}
  chrome debug: localhost:${ports.chrome} (user-data-dir /tmp/chrome-devtools-${slug})

cd ${path}
`);
}
