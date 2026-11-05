import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// `workspace:*` deps publish as exact versions, so a version that is not on npm
// breaks `npm install` of this package for every consumer.
const packagesDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'packages'
);
const versions = new Map<string, string>();
for (const dir of readdirSync(packagesDir)) {
  try {
    const { name, version } = JSON.parse(
      readFileSync(resolve(packagesDir, dir, 'package.json'), 'utf8')
    ) as { name: string; version: string };
    versions.set(name, version);
  } catch {
    // not a package directory
  }
}

const { dependencies = {} } = JSON.parse(
  readFileSync('package.json', 'utf8')
) as { dependencies?: Record<string, string> };

const missing = Object.entries(dependencies)
  .filter(([, range]) => range.startsWith('workspace:'))
  .map(([name]) => `${name}@${versions.get(name)}`)
  .filter(
    (id) =>
      spawnSync('pnpm', ['view', id, 'version'], { stdio: 'ignore' }).status !==
      0
  );

if (missing.length > 0) {
  console.error(
    `Publish these workspace dependencies first: ${missing.join(', ')}`
  );
  process.exit(1);
}
