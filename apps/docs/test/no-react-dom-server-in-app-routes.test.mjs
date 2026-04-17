import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const docsRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const appRoot = path.join(docsRoot, 'app');
const SOURCE_FILE_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.ts', '.tsx']);
const REACT_DOM_SERVER_PATTERN =
  /(?:from\s+['"]react-dom\/server['"]|import\(\s*['"]react-dom\/server['"]\s*\)|require\(\s*['"]react-dom\/server['"]\s*\))/;

/** @returns {string[]} */
function collectSourceFiles(rootDir) {
  const entries = readdirSync(rootDir, { withFileTypes: true });
  /** @type {string[]} */
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(entryPath));
      continue;
    }

    if (SOURCE_FILE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(entryPath);
    }
  }

  return files;
}

describe('docs app route import guard', () => {
  test('app routes do not import react-dom/server', () => {
    const offenders = collectSourceFiles(appRoot)
      .filter((filePath) =>
        REACT_DOM_SERVER_PATTERN.test(readFileSync(filePath, 'utf8'))
      )
      .map((filePath) => path.relative(docsRoot, filePath))
      .sort();

    expect(offenders).toEqual([]);
  });
});
