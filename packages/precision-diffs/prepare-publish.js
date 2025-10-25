import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// Read root package.json
const rootPkgPath = resolve('package.json');
const pkg = JSON.parse(readFileSync(rootPkgPath, 'utf-8'));

// Update exports to point to built files (relative to dist/)
const updateExports = (exports, key) => {
  if (typeof exports === 'string') {
    // Remove ./src/ prefix since we're now in dist/
    const updated = exports.replace(/\.\/src\//g, './');
    // For 'types' field, use .d.ts; for others use .js
    if (key === 'types') {
      return updated.replace(/\.ts$/, '.d.ts');
    }
    return updated.replace(/\.ts$/, '.js');
  }
  if (typeof exports === 'object' && exports !== null) {
    const updated = {};
    for (const [k, value] of Object.entries(exports)) {
      updated[k] = updateExports(value, k);
    }
    return updated;
  }
  return exports;
};

pkg.exports = updateExports(pkg.exports);

// Remove the "files" field since we're publishing from dist/
delete pkg.files;

// Remove scripts that shouldn't be in published package
delete pkg.scripts;
delete pkg.devDependencies;

// Write package.json to dist/
const distPkgPath = resolve('dist/package.json');
writeFileSync(distPkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log('✓ Created dist/package.json with updated exports');

// Copy README if it exists
const readmePath = resolve('README.md');
if (existsSync(readmePath)) {
  copyFileSync(readmePath, resolve('dist/README.md'));
  console.log('✓ Copied README.md to dist/');
}

// Copy LICENSE if it exists
const licensePath = resolve('LICENSE');
if (existsSync(licensePath)) {
  copyFileSync(licensePath, resolve('dist/LICENSE'));
  console.log('✓ Copied LICENSE to dist/');
}

// Copy workspace lockfile so catalog versions can be resolved
const lockfilePath = resolve('../../bun.lock');
if (existsSync(lockfilePath)) {
  copyFileSync(lockfilePath, resolve('dist/bun.lock'));
  console.log('✓ Copied bun.lock to dist/');
}
