import { execFileSync } from 'node:child_process';

import { packageRoot, withVsixPackageShim } from './vsixPackageShim';

withVsixPackageShim(() => {
  execFileSync('bunx', ['vsce', 'package', '--no-dependencies'], {
    cwd: packageRoot,
    stdio: 'inherit',
  });
});
