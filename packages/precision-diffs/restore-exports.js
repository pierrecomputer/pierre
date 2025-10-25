import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

// Read package.json
const pkgPath = resolve('package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));

// Update exports to point to src instead of dist
const updateExports = (exports) => {
  if (typeof exports === 'string') {
    return exports
      .replace(/\.\/dist\//g, './src/')
      .replace(/\.d\.ts$/, '.ts')
      .replace(/\.js$/, '.ts');
  }
  if (typeof exports === 'object' && exports !== null) {
    const updated = {};
    for (const [key, value] of Object.entries(exports)) {
      updated[key] = updateExports(value);
    }
    return updated;
  }
  return exports;
};

pkg.exports = updateExports(pkg.exports);

// Write updated package.json
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log('✓ Restored package.json exports to point to src/');
