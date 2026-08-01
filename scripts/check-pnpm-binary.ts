import { spawnSync } from 'node:child_process';

import { pinnedVersion, protoToolsPath } from './prototools';

/**
 * Fails a publish when the pnpm binary on PATH is not the version `.prototools`
 * pins. A different pnpm can resolve or pack a package another way, so the
 * published artifact may not match the repo.
 *
 * This script tests a binary, not a file. The publish chain therefore runs it
 * (`.moon/tasks/tag-publishable.yml`), and CI does not. CI has no publish to
 * protect. `check-tool-pins.ts` is the counterpart. It compares the version in
 * each file that repeats a pin, and CI runs it on every pull request.
 *
 * Run `proto use` after a pin bump. A publish fails until you do.
 */

const expectedVersion = pinnedVersion('pnpm');

function fail(message: string): never {
  console.error(message);
  console.error(
    `Install or activate the pnpm version pinned in ${protoToolsPath} before publishing.`
  );
  process.exit(1);
}

if (expectedVersion === null) {
  fail(`Could not find a pinned pnpm version in ${protoToolsPath}.`);
}

const pnpmVersion = spawnSync('pnpm', ['--version'], { encoding: 'utf8' });

if (pnpmVersion.error != null) {
  fail(`Could not run pnpm --version: ${pnpmVersion.error.message}.`);
}

if (pnpmVersion.status !== 0) {
  fail(
    [
      `pnpm --version exited with status ${pnpmVersion.status ?? 'unknown'}.`,
      pnpmVersion.stderr.trim(),
    ]
      .filter(Boolean)
      .join('\n')
  );
}

// The last version-shaped line of stdout. proto's shim prepends a notice when
// it must resolve or install a version first, and prints that notice as NDJSON
// under AGENT=1. So the whole buffer is not the version.
const actualVersion =
  pnpmVersion.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^\d+\.\d+\.\d+/.test(line))
    .pop() ?? '';

if (actualVersion !== expectedVersion) {
  fail(
    `Expected pnpm ${expectedVersion}, but this command is running pnpm ${actualVersion || '(empty version output)'}.`
  );
}
