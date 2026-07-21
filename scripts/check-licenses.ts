import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Fails the process unless every workspace package (and the repo root) is
 * licensed under Apache 2.0. A package passes when its package.json declares
 * `"license": "apache-2.0"` AND a sibling LICENSE / LICENSE.md file contains the
 * Apache License 2.0 text. Packages under packages/* or apps/* are discovered
 * automatically, so a newly added package that forgets the license is caught.
 *
 * Vendored third-party code keeps its own license and is credited in a
 * NOTICE.md; this check only inspects each package's own LICENSE file, so those
 * attributions are intentionally left alone.
 */

const EXPECTED_LICENSE = 'apache-2.0';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');

// Mirrors the package globs in pnpm-workspace.yaml (packages/* and apps/*).
const workspaceGroups = ['packages', 'apps'];

// The repo root plus every directory one level under packages/ or apps/ that
// contains a package.json.
function findPackageDirs(): string[] {
  const dirs: string[] = [repoRoot];
  for (const group of workspaceGroups) {
    const groupDir = join(repoRoot, group);
    if (!existsSync(groupDir)) {
      continue;
    }
    for (const entry of readdirSync(groupDir, { withFileTypes: true })) {
      if (
        entry.isDirectory() &&
        existsSync(join(groupDir, entry.name, 'package.json'))
      ) {
        dirs.push(join(groupDir, entry.name));
      }
    }
  }
  return dirs;
}

// The "license" field from a package.json, or null when absent / not a string.
function readLicenseField(packageJsonPath: string): string | null {
  const parsed: unknown = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  if (typeof parsed === 'object' && parsed !== null && 'license' in parsed) {
    const { license } = parsed as { license: unknown };
    return typeof license === 'string' ? license : null;
  }
  return null;
}

// True when the text is the body of the Apache License, Version 2.0.
function isApacheLicense(text: string): boolean {
  return text.includes('Apache License') && text.includes('Version 2.0');
}

const problems: string[] = [];

for (const dir of findPackageDirs()) {
  const label =
    dir === repoRoot ? '<repo root>' : dir.slice(repoRoot.length + 1);

  const license = readLicenseField(join(dir, 'package.json'));
  if (license !== EXPECTED_LICENSE) {
    problems.push(
      `${label}: package.json "license" is ${license ?? 'missing'}, expected "${EXPECTED_LICENSE}".`
    );
  }

  const licenseFile = ['LICENSE.md', 'LICENSE']
    .map((name) => join(dir, name))
    .find((path) => existsSync(path));
  if (licenseFile === undefined) {
    problems.push(`${label}: missing a LICENSE or LICENSE.md file.`);
  } else if (!isApacheLicense(readFileSync(licenseFile, 'utf8'))) {
    problems.push(`${label}: LICENSE file is not the Apache License 2.0.`);
  }
}

if (problems.length > 0) {
  console.error('License check failed. Every package must be Apache-2.0:\n');
  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }
  console.error(
    '\nDeclare "license": "apache-2.0" and add an Apache 2.0 LICENSE file ' +
      '(copy packages/trees/LICENSE.md). See AGENTS.md > Licensing.'
  );
  process.exit(1);
}

console.log('License check passed: all packages are Apache-2.0.');
