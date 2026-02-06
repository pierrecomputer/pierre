import { describe, expect, test } from 'bun:test';

import { FLATTENED_PREFIX } from '../src/constants';
import type { FileChangeStatus, FileMetadata } from '../src/types';

describe('FileMetadata types', () => {
  test('accepts all valid status values', () => {
    const statuses: FileChangeStatus[] = [
      'added',
      'modified',
      'deleted',
      'renamed',
    ];
    for (const status of statuses) {
      const metadata: FileMetadata = { status };
      expect(metadata.status).toBe(status);
    }
  });

  test('accepts line counts without status', () => {
    const metadata: FileMetadata = { additions: 10, deletions: 5 };
    expect(metadata.additions).toBe(10);
    expect(metadata.deletions).toBe(5);
    expect(metadata.status).toBeUndefined();
  });

  test('all fields are optional', () => {
    const metadata: FileMetadata = {};
    expect(metadata.status).toBeUndefined();
    expect(metadata.additions).toBeUndefined();
    expect(metadata.deletions).toBeUndefined();
  });
});

describe('metadata path resolution', () => {
  const getMetadataPath = (path: string): string =>
    path.startsWith(FLATTENED_PREFIX)
      ? path.slice(FLATTENED_PREFIX.length)
      : path;

  test('returns file path unchanged', () => {
    expect(getMetadataPath('src/index.ts')).toBe('src/index.ts');
  });

  test('strips flattened prefix from paths', () => {
    expect(getMetadataPath(`${FLATTENED_PREFIX}src/components`)).toBe(
      'src/components'
    );
  });

  test('returns root-level path unchanged', () => {
    expect(getMetadataPath('README.md')).toBe('README.md');
  });

  test('handles nested paths', () => {
    expect(getMetadataPath('a/b/c/d.ts')).toBe('a/b/c/d.ts');
  });
});
