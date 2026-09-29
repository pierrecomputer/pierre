import { afterEach, describe, expect, test } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { checkPrerenderSize } from '../scripts/check-prerender-size';

const directories: string[] = [];

// Sparse files exercise response-size limits without allocating large strings.
function createBuild(files: Record<string, number>) {
  const directory = mkdtempSync(join(tmpdir(), 'docs-prerender-'));
  directories.push(directory);
  for (const [name, size] of Object.entries(files)) {
    const path = join(directory, 'server', 'app', name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '');
    truncateSync(path, size);
  }
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('prerendered page size budget', () => {
  test('checks nested pages and accepts the exact budget', () => {
    const directory = createBuild({
      'index.html': 1,
      'guides/example.html': 16_000_000,
      'page.js': 20_000_001,
    });
    expect(checkPrerenderSize(directory)).toEqual({
      path: 'guides/example.html',
      bytes: 16_000_000,
    });
  });

  test('rejects growth before reaching the Vercel limit', () => {
    const directory = createBuild({ 'docs.html': 16_000_001 });
    expect(() => checkPrerenderSize(directory)).toThrow(
      'docs.html is 16,000,001 bytes, exceeding the 16,000,000-byte page budget'
    );
  });

  test('fails when the build has no prerendered pages', () => {
    const directory = createBuild({ 'page.js': 1 });
    expect(() => checkPrerenderSize(directory)).toThrow(
      'No prerendered HTML found'
    );
  });
});
