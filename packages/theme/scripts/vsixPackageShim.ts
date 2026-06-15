import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface PackageJson {
  name?: unknown;
  [key: string]: unknown;
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
export const packageRoot = join(scriptDir, '..');
const packageJsonPath = join(packageRoot, 'package.json');
const readmePath = join(packageRoot, 'README.md');
const vsceReadmePath = join(scriptDir, 'README.package.md');
const readmeBackupPath = join(packageRoot, 'README.md.bak');

// VSIX tooling reads package.json and README.md from the extension root, while
// the npm package keeps a scoped name and a package-focused README.
export function withVsixPackageShim(action: () => void): void {
  const originalPackageJson = readFileSync(packageJsonPath, 'utf-8');
  const packageJson = JSON.parse(originalPackageJson) as PackageJson;

  if (typeof packageJson.name !== 'string') {
    throw new TypeError(
      'packages/theme/package.json must define a string name'
    );
  }

  const originalName = packageJson.name;
  const extensionName = 'pierre-theme';
  packageJson.name = extensionName;
  delete packageJson.files;

  console.log(
    `Temporarily renaming package: ${originalName} -> ${extensionName}\n`
  );

  const hadReadme = existsSync(readmePath);

  try {
    writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');

    if (hadReadme) {
      renameSync(readmePath, readmeBackupPath);
    }
    renameSync(vsceReadmePath, readmePath);

    action();
  } finally {
    if (existsSync(readmePath)) {
      renameSync(readmePath, vsceReadmePath);
    }
    if (hadReadme && existsSync(readmeBackupPath)) {
      renameSync(readmeBackupPath, readmePath);
    }

    writeFileSync(packageJsonPath, originalPackageJson);
    console.log(`\nRestored package name: ${originalName}`);
  }
}
