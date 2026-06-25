import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const expectedVersion = '11.9.0';
const scriptDir = dirname(fileURLToPath(import.meta.url));
const protoToolsPath = resolve(scriptDir, '..', '.prototools');
const protoTools = readFileSync(protoToolsPath, 'utf8');
const pnpmVersionMatch = /^pnpm\s*=\s*["']([^"']+)["']\s*(?:#.*)?$/m.exec(
  protoTools
);

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

if (pnpmVersionMatch == null) {
  fail(
    [
      `Could not find a pinned pnpm version in ${protoToolsPath}.`,
      `Install or activate the pnpm version pinned in ${protoToolsPath} before publishing.`,
    ].join('\n')
  );
}

const pinnedVersion = pnpmVersionMatch[1];

if (pinnedVersion !== expectedVersion) {
  fail(
    [
      `Expected .prototools to pin pnpm ${expectedVersion}, but found ${pinnedVersion}.`,
      `Install or activate the pnpm version pinned in ${protoToolsPath} before publishing.`,
    ].join('\n')
  );
}

const pnpmVersion = spawnSync('pnpm', ['--version'], {
  encoding: 'utf8',
});

if (pnpmVersion.error != null) {
  fail(
    [
      `Could not run pnpm --version: ${pnpmVersion.error.message}.`,
      `Install or activate the pnpm version pinned in ${protoToolsPath} before publishing.`,
    ].join('\n')
  );
}

if (pnpmVersion.status !== 0) {
  fail(
    [
      `pnpm --version exited with status ${pnpmVersion.status ?? 'unknown'}.`,
      pnpmVersion.stderr.trim(),
      `Install or activate the pnpm version pinned in ${protoToolsPath} before publishing.`,
    ]
      .filter(Boolean)
      .join('\n')
  );
}

const actualVersion = pnpmVersion.stdout.trim();

if (actualVersion !== expectedVersion || actualVersion !== pinnedVersion) {
  fail(
    [
      `Expected pnpm ${expectedVersion}, but this command is running pnpm ${actualVersion || '(empty version output)'}.`,
      `Install or activate the pnpm version pinned in ${protoToolsPath} before publishing.`,
    ].join('\n')
  );
}
