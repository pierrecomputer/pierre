import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

// Read package.json
const pkgPath = resolve('package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));

// Update exports to point to dist instead of src
const updateExports = (exports, key) => {
  if (typeof exports === 'string') {
    const updated = exports.replace(/\.\/src\//g, './dist/');
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

// Write updated package.json
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log('✓ Updated package.json exports to point to dist/');
