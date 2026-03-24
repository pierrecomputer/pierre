import { describe, expect, test } from 'bun:test';

import {
  remapExpandedPathsForFolderRename,
  renameFileTreePaths,
} from '../src/utils/renameFileTreePaths';

describe('renameFileTreePaths', () => {
  test('renames a file', () => {
    const files = ['a.txt', 'b.txt'];
    const result = renameFileTreePaths({
      files,
      path: 'a.txt',
      isFolder: false,
      nextBasename: 'c.txt',
    });

    expect(result).toEqual({
      nextFiles: ['c.txt', 'b.txt'],
      sourcePath: 'a.txt',
      destinationPath: 'c.txt',
      isFolder: false,
    });
  });

  test('renames a folder and updates child paths', () => {
    const files = ['src/index.ts', 'src/utils/helpers.ts'];
    const result = renameFileTreePaths({
      files,
      path: 'src',
      isFolder: true,
      nextBasename: 'lib',
    });

    expect(result).toEqual({
      nextFiles: ['lib/index.ts', 'lib/utils/helpers.ts'],
      sourcePath: 'src',
      destinationPath: 'lib',
      isFolder: true,
    });
  });

  test('renames a nested folder', () => {
    const files = ['src/deep/a.ts', 'src/deep/b.ts', 'src/other.ts'];
    const result = renameFileTreePaths({
      files,
      path: 'src/deep',
      isFolder: true,
      nextBasename: 'nested',
    });

    expect(result).toEqual({
      nextFiles: ['src/nested/a.ts', 'src/nested/b.ts', 'src/other.ts'],
      sourcePath: 'src/deep',
      destinationPath: 'src/nested',
      isFolder: true,
    });
  });

  test('returns original files array by reference when name is unchanged', () => {
    const files = ['a.txt', 'b.txt'];
    const result = renameFileTreePaths({
      files,
      path: 'a.txt',
      isFolder: false,
      nextBasename: 'a.txt',
    });

    expect(result).toEqual({
      nextFiles: files,
      sourcePath: 'a.txt',
      destinationPath: 'a.txt',
      isFolder: false,
    });
    if (!('error' in result)) {
      expect(result.nextFiles).toBe(files);
    }
  });

  test('rejects empty basename', () => {
    const result = renameFileTreePaths({
      files: ['a.txt'],
      path: 'a.txt',
      isFolder: false,
      nextBasename: '   ',
    });

    expect(result).toEqual({ error: 'Name cannot be empty.' });
  });

  test('rejects basename containing "/"', () => {
    const result = renameFileTreePaths({
      files: ['a.txt'],
      path: 'a.txt',
      isFolder: false,
      nextBasename: 'a/b',
    });

    expect(result).toEqual({ error: 'Name cannot include "/".' });
  });

  test('rejects file rename when destination path is an existing folder prefix', () => {
    const result = renameFileTreePaths({
      files: ['README.md', 'src/index.ts', 'src/utils/helpers.ts'],
      path: 'README.md',
      isFolder: false,
      nextBasename: 'src',
    });

    expect(result).toEqual({
      error: '"src" already exists.',
    });
  });

  test('rejects file rename when destination collides with existing file', () => {
    const result = renameFileTreePaths({
      files: ['a.txt', 'b.txt'],
      path: 'a.txt',
      isFolder: false,
      nextBasename: 'b.txt',
    });

    expect(result).toEqual({ error: '"b.txt" already exists.' });
  });

  test('rejects folder rename when destination collides with existing folder', () => {
    const result = renameFileTreePaths({
      files: ['src/index.ts', 'lib/index.ts'],
      path: 'src',
      isFolder: true,
      nextBasename: 'lib',
    });

    expect(result).toEqual({ error: '"lib" already exists.' });
  });

  test('returns error when file to rename is not found', () => {
    const result = renameFileTreePaths({
      files: ['a.txt'],
      path: 'missing.txt',
      isFolder: false,
      nextBasename: 'renamed.txt',
    });

    expect(result).toEqual({
      error: 'Could not find the selected file to rename.',
    });
  });

  test('returns error when folder to rename is not found', () => {
    const result = renameFileTreePaths({
      files: ['a.txt'],
      path: 'missing',
      isFolder: true,
      nextBasename: 'renamed',
    });

    expect(result).toEqual({
      error: 'Could not find the selected folder to rename.',
    });
  });
});

describe('remapExpandedPathsForFolderRename', () => {
  test('returns empty array for empty input', () => {
    const result = remapExpandedPathsForFolderRename({
      expandedPaths: [],
      sourcePath: 'src',
      destinationPath: 'lib',
    });

    expect(result).toEqual([]);
  });

  test('returns same array by reference when source equals destination', () => {
    const expandedPaths = ['src', 'src/utils'];
    const result = remapExpandedPathsForFolderRename({
      expandedPaths,
      sourcePath: 'src',
      destinationPath: 'src',
    });

    expect(result).toBe(expandedPaths);
  });

  test('remaps source and child paths to destination', () => {
    const result = remapExpandedPathsForFolderRename({
      expandedPaths: ['src', 'src/utils', 'src/utils/deep'],
      sourcePath: 'src',
      destinationPath: 'lib',
    });

    expect(result).toEqual(['lib', 'lib/utils', 'lib/utils/deep']);
  });

  test('preserves unrelated paths alongside remapped ones', () => {
    const result = remapExpandedPathsForFolderRename({
      expandedPaths: ['docs', 'src', 'src/utils'],
      sourcePath: 'src',
      destinationPath: 'lib',
    });

    expect(result).toEqual(['docs', 'lib', 'lib/utils']);
  });

  test('deduplicates when remap produces collisions', () => {
    const result = remapExpandedPathsForFolderRename({
      expandedPaths: ['lib', 'src'],
      sourcePath: 'src',
      destinationPath: 'lib',
    });

    expect(result).toEqual(['lib']);
  });
});
