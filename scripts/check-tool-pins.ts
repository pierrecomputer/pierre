import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { pinnedVersion, repoRoot } from './prototools';

/**
 * A tool version must have one source. This script fails when a copy of that
 * version disagrees with its source.
 *
 * `.prototools` is the source for every tool that proto installs, and proto puts
 * those versions on PATH. Six places cannot use proto, so each one repeats a
 * version:
 *
 * - `versionConstraint` in `.moon/workspace.yml` — moon refuses to run when its
 *   own version differs. It catches a stale shim or a global install.
 * - the `@moonrepo/cli` catalog entry — Vercel has no proto, so a Vercel build
 *   runs moon from `node_modules/.bin`.
 * - `packageManager` in the root package.json — pnpm and Corepack read it.
 * - `.node-version` — version managers read it. moon cannot write it.
 *   `syncVersionManagerConfig` needs an explicit `node.version`, and this repo
 *   keeps that version in `.prototools`.
 * - `engines.node` in the root package.json — Vercel reads it to select the build
 *   Node major. Compare the major only, because Vercel selects the patch itself.
 * - the `@types/bun` catalog entry — the types must match the bun runtime. Bun
 *   publishes the runtime and the types under one version.
 *
 * The catalog in `pnpm-workspace.yaml` is the source for an npm package version.
 * One place repeats a catalog version:
 *
 * - the `playwright@<version>` argument in `.github/workflows/ci.yml` — the
 *   browser that CI installs must match `@playwright/test`.
 *
 * moon drift is the reason for this script. CI runs the proto moon and never the
 * npm moon. So a stale `@moonrepo/cli` passes CI, then fails the Vercel deploy
 * after merge. This script moves that failure to the pull request.
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

// The version of `packageName` in the pnpm-workspace.yaml catalog. The pattern
// needs the colon, so a bare list item in minimumReleaseAgeExclude cannot match
// (- '@moonrepo/cli' is not the entry '@moonrepo/cli': '2.3.3').
function catalogVersion(packageName: string): string | null {
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return matchIn(
    'pnpm-workspace.yaml',
    new RegExp(`^\\s*'${escaped}':\\s*'([^']+)'`, 'm')
  );
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
const bunPin = pinnedVersion('bun');

if (
  moonPin === null ||
  pnpmPin === null ||
  nodePin === null ||
  bunPin === null
) {
  console.error(
    'Tool pin check failed: .prototools must pin moon, pnpm, node, and bun.'
  );
  process.exit(1);
}

expect(
  '.moon/workspace.yml versionConstraint',
  matchIn('.moon/workspace.yml', /^versionConstraint:\s*'?([^'\s#]+)/m),
  moonPin,
  `set versionConstraint: '${moonPin}'`
);

expect(
  "pnpm-workspace.yaml catalog '@moonrepo/cli'",
  catalogVersion('@moonrepo/cli'),
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

// Bun publishes @types/bun under the runtime version, so the two move together.
// A canary bun pin (1.3.13-canary.20260420.1) has no types of its own, so
// compare against the release it precedes.
const bunRelease = bunPin.split('-')[0];
expect(
  "pnpm-workspace.yaml catalog '@types/bun'",
  catalogVersion('@types/bun'),
  bunRelease,
  `set '@types/bun': '${bunRelease}' under catalog`
);

// The catalog owns the @playwright/test version, and CI installs the browser
// with `pnpm dlx playwright@<version>`. A mismatch installs a browser that the
// test runner does not drive.
const playwrightCatalog = catalogVersion('@playwright/test');

if (playwrightCatalog === null) {
  problems.push(
    "pnpm-workspace.yaml catalog '@playwright/test' is missing.\n" +
      "      Fix: add '@playwright/test' under catalog"
  );
} else {
  expect(
    '.github/workflows/ci.yml playwright install version',
    matchIn('.github/workflows/ci.yml', /playwright@([\w.-]+)/),
    playwrightCatalog,
    `run pnpm dlx playwright@${playwrightCatalog} install`
  );
}

if (problems.length > 0) {
  console.error(
    'Tool pin check failed. A version must match its source — .prototools ' +
      `(moon ${moonPin}, pnpm ${pnpmPin}, node ${nodePin}, bun ${bunPin}), or ` +
      'the pnpm-workspace.yaml catalog:\n'
  );
  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }
  console.error(
    '\nEdit the source first. For a proto tool that means .prototools, then ' +
      '`proto use`. Then update every file above. A stale @moonrepo/cli passes ' +
      'CI and fails the Vercel deploy.'
  );
  process.exit(1);
}

console.log(
  `Tool pin check passed: moon ${moonPin}, pnpm ${pnpmPin}, node ${nodePin}, ` +
    `bun ${bunPin}, playwright ${playwrightCatalog ?? 'unset'}.`
);
