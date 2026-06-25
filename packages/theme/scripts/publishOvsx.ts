import { execFileSync } from 'node:child_process';

import { packageRoot, withVsixPackageShim } from './vsixPackageShim';

// Manual Open VSX publish. Publishing is intentionally not automated on release:
// it runs only when a maintainer invokes `moon run theme:publish-ovsx` with an
// Open VSX token in OVSX_PAT.
const ovsxPat = process.env.OVSX_PAT;

if (ovsxPat === undefined || ovsxPat.length === 0) {
  throw new Error('OVSX_PAT must be set to publish the Open VSX extension');
}

withVsixPackageShim(() => {
  execFileSync('pnpm', ['exec', 'ovsx', 'publish', '--no-dependencies'], {
    cwd: packageRoot,
    env: { ...process.env, OVSX_PAT: ovsxPat },
    stdio: 'inherit',
  });
});
