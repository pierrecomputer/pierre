import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Direct `bun publish` would upload a package.json that still depends on the
// private workspace package. The release script removes that dependency from the
// final tarball before publishing.
const pkgPath = resolve(import.meta.dir, '..', 'package.json');
const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
const pathStoreVersion = pkg.dependencies?.['@pierre/path-store'];

if (pathStoreVersion != null) {
  console.error(
    [
      'Direct publish is disabled for @pierre/trees.',
      `package.json still depends on @pierre/path-store (${pathStoreVersion}), which is not published to npm.`,
      'Use `bun run publish-package -- --tag=beta` so the release script can publish the rewritten package.',
    ].join('\n')
  );
  process.exit(1);
}
