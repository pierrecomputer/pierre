import { execFileSync } from 'node:child_process';

import { packageRoot, withVsixPackageShim } from './vsixPackageShim';

// Manual VS Marketplace publish. Publishing is intentionally not automated on
// release: it runs only when a maintainer invokes `moon run theme:publish-vsce`
// with a VS Marketplace token in VSCE_PAT.
const vscePat = process.env.VSCE_PAT;

if (vscePat === undefined || vscePat.length === 0) {
  throw new Error('VSCE_PAT must be set to publish the VS Code extension');
}

withVsixPackageShim(() => {
  execFileSync('bunx', ['vsce', 'publish', '--no-dependencies'], {
    cwd: packageRoot,
    env: { ...process.env, VSCE_PAT: vscePat },
    stdio: 'inherit',
  });
});
