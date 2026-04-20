// Shared `.env.worktree` loader for JS/TS runtimes (Next's config, Playwright
// configs, anything else that runs in Node or Bun outside the `bun ws` call
// chain).
//
// Why this file exists: `scripts/wt.ts` writes `.env.worktree` at the worktree
// root with `PIERRE_WORKTREE_SLUG` / `PIERRE_PORT_OFFSET`. Neither Bun nor Next
// nor Playwright auto-load a file with that non-standard name — only the
// conventional `.env*` variants. `scripts/ws.ts` injects those vars when it is
// in the call chain, but direct invocations (e.g. `bun run trees:dev` inside
// `apps/docs`, or `bunx playwright test` inside a package) skip `ws` entirely.
// This helper closes that gap by letting configs pull the file in themselves.
//
// The walk starts at `startDir` (defaults to `process.cwd()`) and stops at
// either the first `.env.worktree` it finds or the nearest `.git` entry (the
// worktree root), whichever comes first. Values already present in
// `process.env` are *not* clobbered, so `ws`-injected vars still win.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Parse an env file into a plain record. Supports `KEY=value`, `# comments`,
// and optional surrounding single/double quotes on the value.
/** @param {string} path */
function parseEnvFile(path) {
  /** @type {Record<string, string>} */
  const out = {};
  const text = readFileSync(path, 'utf8');
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

// Walk up from `startDir` looking for `.env.worktree`. Returns the parsed
// contents, or an empty object if no file is found before hitting `.git` or
// the filesystem root.
/**
 * @param {string} [startDir]
 * @returns {Record<string, string>}
 */
export function findWorktreeEnv(startDir = process.cwd()) {
  let dir = resolve(startDir);
  while (true) {
    const candidate = resolve(dir, '.env.worktree');
    if (existsSync(candidate)) {
      return parseEnvFile(candidate);
    }
    if (existsSync(resolve(dir, '.git'))) return {};
    const parent = dirname(dir);
    if (parent === dir) return {};
    dir = parent;
  }
}

// Load `.env.worktree` values into `process.env`. Existing keys win so that
// anything `ws.ts` (or a caller) has already injected stays authoritative.
/**
 * @param {string} [startDir]
 * @returns {Record<string, string>}
 */
export function loadWorktreeEnv(startDir = process.cwd()) {
  const values = findWorktreeEnv(startDir);
  for (const [key, value] of Object.entries(values)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
  return values;
}
