import { execFileSync } from 'node:child_process';

import { packageRoot, withVsixPackageShim } from './vsixPackageShim';

const vscePat = process.env.VSCE_PAT;
const ovsxPat = process.env.OVSX_PAT;

if (vscePat === undefined || vscePat.length === 0) {
  throw new Error('VSCE_PAT must be set to publish the VS Code extension');
}

if (ovsxPat === undefined || ovsxPat.length === 0) {
  throw new Error('OVSX_PAT must be set to publish the Open VSX extension');
}

withVsixPackageShim(() => {
  const env = { ...process.env, OVSX_PAT: ovsxPat, VSCE_PAT: vscePat };

  execFileSync('bunx', ['vsce', 'publish', '--no-dependencies'], {
    cwd: packageRoot,
    env,
    stdio: 'inherit',
  });
  execFileSync('bunx', ['ovsx', 'publish', '--no-dependencies'], {
    cwd: packageRoot,
    env,
    stdio: 'inherit',
  });
});
