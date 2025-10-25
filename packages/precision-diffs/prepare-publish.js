import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

// Read package.json
const pkgPath = resolve('package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));

// Update exports to point to dist instead of src
const updateExports = (exports) => {
  if (typeof exports === 'string') {
    return exports.replace(/\.\/src\//g, './dist/').replace(/\.ts$/, '.js');
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
console.log('✓ Updated package.json exports to point to dist/');
