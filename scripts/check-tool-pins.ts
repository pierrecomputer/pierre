import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { pinnedVersion, repoRoot } from './prototools';

/**
 * `.prototools` pins every tool version, and proto puts those versions on PATH.
 * Four places cannot use proto, so each one repeats a version. This script fails
 * when one of them disagrees with `.prototools`:
 *
 * - `versionConstraint` in `.moon/workspace.yml` — moon refuses to run when its
 *   own version differs. It catches a stale shim or a global install.
 * - the `@moonrepo/cli` catalog entry — Vercel has no proto, so a Vercel build
 *   runs moon from `node_modules/.bin`.
 * - `packageManager` in the root package.json — pnpm and Corepack read it.
 * - `.node-version` — version managers read it. moon cannot write it.
 *   `syncVersionManagerConfig` needs an explicit `node.version`, and this repo
 *   keeps that version in `.prototools`.
 *
 * moon drift is the reason for this script. CI runs the proto moon and never the
 * npm moon. So a stale `@moonrepo/cli` passes CI, then fails the Vercel deploy
 * after merge. This script moves that failure to the pull request.
 *
 * Compare `engines.node` by major version only. Vercel supplies the major and
 * selects the patch itself.
 *
 * `check-pnpm-binary.ts` is the counterpart. It tests the pnpm binary. This
 * script compares files.
 */

const problems: string[] = [];

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

// Records a mismatch against the .prototools pin for one file.
function expect(
  label: string,
  found: string | null,
  expected: string,
  fix: string
): void {
  if (found === expected) {
    return;
  }
  problems.push(
    `${label} is ${found ?? 'missing'}, expected ${expected}.\n      Fix: ${fix}`
  );
}

// The first capture of `pattern` in the file, or null when it does not match.
function matchIn(relativePath: string, pattern: RegExp): string | null {
  return pattern.exec(read(relativePath))?.[1] ?? null;
}

// A field of the root package.json, or null when absent or not a string.
function packageJsonField(...path: string[]): string | null {
  let value: unknown = JSON.parse(read('package.json'));
  for (const key of path) {
    if (typeof value !== 'object' || value === null || !(key in value)) {
      return null;
    }
    value = (value as Record<string, unknown>)[key];
  }
  return typeof value === 'string' ? value : null;
}

const moonPin = pinnedVersion('moon');
const pnpmPin = pinnedVersion('pnpm');
const nodePin = pinnedVersion('node');

if (moonPin === null || pnpmPin === null || nodePin === null) {
  console.error(
    'Tool pin check failed: .prototools must pin moon, pnpm, and node.'
  );
  process.exit(1);
}

expect(
  '.moon/workspace.yml versionConstraint',
  matchIn('.moon/workspace.yml', /^versionConstraint:\s*'?([^'\s#]+)/m),
  moonPin,
  `set versionConstraint: '${moonPin}'`
);

// The colon separates the catalog entry ('@moonrepo/cli': '2.3.3') from the
// bare list item in minimumReleaseAgeExclude (- '@moonrepo/cli').
expect(
  "pnpm-workspace.yaml catalog '@moonrepo/cli'",
  matchIn('pnpm-workspace.yaml', /^\s*'@moonrepo\/cli':\s*'([^']+)'/m),
  moonPin,
  `set '@moonrepo/cli': '${moonPin}' under catalog`
);

expect(
  'package.json packageManager',
  packageJsonField('packageManager'),
  `pnpm@${pnpmPin}`,
  `set "packageManager": "pnpm@${pnpmPin}"`
);

expect(
  '.node-version',
  read('.node-version').trim() || null,
  nodePin,
  `write ${nodePin} to .node-version`
);

// Vercel resolves engines.node to a major and selects the patch itself. So the
// field must name the major and nothing narrower.
const nodeMajor = nodePin.split('.')[0];
expect(
  'package.json engines.node',
  packageJsonField('engines', 'node'),
  `${nodeMajor}.x`,
  `set "engines": { "node": "${nodeMajor}.x" }`
);

if (problems.length > 0) {
  console.error(
    'Tool pin check failed. .prototools is the source of truth ' +
      `(moon ${moonPin}, pnpm ${pnpmPin}, node ${nodePin}):\n`
  );
  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }
  console.error(
    '\nEdit .prototools first, run `proto use`, then update every file above. ' +
      'A stale @moonrepo/cli passes CI and fails the Vercel deploy.'
  );
  process.exit(1);
}

console.log(
  `Tool pin check passed: moon ${moonPin}, pnpm ${pnpmPin}, node ${nodePin}.`
);
