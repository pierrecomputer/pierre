import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const docsRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const componentRoot = path.join(docsRoot, 'app', '(trees)', '_components');
const componentFiles = ['TreeApp.tsx', 'DemoTreeApp.tsx'];
const CACHE_KEY_ASSIGNMENT = /(?:\bcacheKey\s*:|\.cacheKey\s*=)/;

describe('TreeApp cache keys', () => {
  for (const filename of componentFiles) {
    test(`${filename} does not generate cache keys`, () => {
      const source = readFileSync(path.join(componentRoot, filename), 'utf8');
      expect(source).not.toMatch(CACHE_KEY_ASSIGNMENT);
    });
  }
});
